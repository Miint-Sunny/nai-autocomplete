/**
 * NovelAI 提示词自动补全 - Content Script
 */
(function() {
  'use strict';

  const ASSISTANT_SETTINGS_KEY = 'nai-llm-assistant-settings';
  const DEFAULT_THEME = 'sunrise';
  const PROMPT_BLOCK_STORAGE_PREFIX = 'nai-ac-prompt-blocks';
  const PROMPT_LIBRARY_KEY = 'nai-shared-prompt-library';
  const PRESET_PROMPT_LIBRARY_CATEGORIES = [
    { id: 'char', label: '角色' },
    { id: 'style', label: '风格' },
    { id: 'scene', label: '场景' },
    { id: 'outfit', label: '服装' },
    { id: 'pose', label: '动作' },
  ];

  const CONFIG = {
    CSV_URL: 'https://raw.githubusercontent.com/saltysalrua/nai-discordbot/refs/heads/main/danbooru_all_2.csv',
    MAX_RESULTS: 8,
    MIN_QUERY_LENGTH: 1,
    DEBOUNCE_DELAY: 150,
  };
  const CONTENT_SCRIPT_VERSION = '1.5.1-official-chunk-bridge.1';

  // 全局设置
  let settings = {
    convertSlashToSpace: false, // 下划线与空格互转
  };

  let allTags = [];
  let isLoading = true;
  let activeEditor = null;
  let selectedIndex = 0;
  let currentResults = [];
  let currentQuery = '';
  let lastRenderedQuery = '';
  let autocompleteContainer = null;
  let lastAutocompleteContext = null;
  let promptBlockPanel = null;
  let promptBlockToolbar = null;
  let promptBlocks = [];
  let promptBlockSignature = '';
  let promptBlockDragId = null;
  let promptBlockDropIndicator = null;
  let promptLibraryDialog = null;
  let promptLibraryDialogState = { blockId: '', mode: 'block', selection: null };
  let promptBlockStates = new WeakMap();
  let promptBlockHistoryStates = new WeakMap();
  let isPromptBlockDragMode = false;
  let promptLibrary = [];
  let autocompleteRepositionFrame = 0;
  let promptBlockRenderFrame = 0;
  let pendingPromptBlockRenderEditor = null;
  let pendingPromptBlockToolbarUpdate = false;
  let autocompletePointerDownAt = 0;
  let autocompleteItemHandledAt = 0;
  const PROMPT_BLOCK_COLORS = ['#f08a5d', '#7aa7ff', '#76b89a', '#c68cff', '#f4b860', '#e97a9a'];
  const PROMPT_SEGMENT_SEPARATORS = new Set([',', '，', '\n', '|']);

  function isPromptSegmentSeparator(char) {
    return PROMPT_SEGMENT_SEPARATORS.has(char);
  }

  function findLastPromptSegmentBreak(text) {
    const source = String(text || '');
    let index = -1;
    PROMPT_SEGMENT_SEPARATORS.forEach(separator => {
      index = Math.max(index, source.lastIndexOf(separator));
    });
    return index;
  }

  function isPromptBoundaryChar(char) {
    return !char || isPromptSegmentSeparator(char);
  }

  function createId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeTagValue(tag) {
    return String(tag || '').replace(/\s+/g, ' ').trim();
  }

  function getMacroExpansion(node) {
    if (!(node instanceof HTMLElement)) return '';
    if (!node.classList.contains('macro-node')) return '';
    return node.dataset.macroExpansion || node.getAttribute('data-macro-expansion') || '';
  }

  function getEditorNodeText(node) {
    if (!node) return '';

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (!(node instanceof HTMLElement)) {
      return '';
    }

    const macroExpansion = getMacroExpansion(node);
    if (macroExpansion) {
      return macroExpansion;
    }

    if (node.tagName === 'BR') {
      return '\n';
    }

    const isBlock = /^(P|DIV|LI)$/.test(node.tagName) && !node.classList.contains('macro-node');
    const text = Array.from(node.childNodes).map(getEditorNodeText).join('');
    return isBlock ? `${text}\n` : text;
  }

  function getEditorText(editor) {
    return getEditorNodeText(editor).replace(/\u200b/g, '').trim();
  }

  function parsePromptTokens(text) {
    const source = String(text || '');
    const tokens = [];
    let current = '';
    let index = 0;

    while (index < source.length) {
      const char = source[index];
      if (isPromptSegmentSeparator(char)) {
        const tag = current.trim();
        let delimiter = char;
        index += 1;

        while (index < source.length) {
          const next = source[index];
          if (isPromptSegmentSeparator(next) || /\s/.test(next)) {
            delimiter += next;
            index += 1;
            continue;
          }
          break;
        }

        if (tag) {
          tokens.push({ tag, delimiter });
        }
        current = '';
        continue;
      }

      current += char;
      index += 1;
    }

    const lastTag = current.trim();
    if (lastTag) {
      tokens.push({ tag: lastTag, delimiter: '' });
    }

    return tokens;
  }

  function splitPromptTags(text) {
    return parsePromptTokens(text).map(token => token.tag);
  }

  function serializePromptBlocks(blocks) {
    return blocks.map(block => block.tags.map((tag, index) => `${tag}${block.delimiters?.[index] || ''}`).join('')).join('');
  }

  function flattenPromptBlocks(blocks) {
    return blocks.flatMap(block => block.tags.map(tag => normalizeTagValue(tag)));
  }

  function getPlainQueryMatch(text) {
    const source = String(text || '');
    return source.match(/^(.*?)([\p{L}\p{N}_][\p{L}\p{N}_ '"\-./()]*)$/u);
  }

  function createSingleBlocksFromText(text) {
    return parsePromptTokens(text).map(token => ({
      id: createId('tag'),
      tags: [token.tag],
      delimiters: [token.delimiter],
      locked: false,
      isGroup: false,
    }));
  }

  function clonePromptBlocks(blocks) {
    return blocks.map(block => ({
      ...block,
      tags: [...block.tags],
      delimiters: [...(block.delimiters || block.tags.map((_, index) => index === block.tags.length - 1 ? '' : ', '))],
    }));
  }

  function hasCompletePromptBlockDelimiters(blocks) {
    return blocks.every(block => Array.isArray(block.delimiters) && block.delimiters.length === block.tags.length);
  }

  function normalizePromptLibraryCategory(category) {
    return String(category || '')
      .trim()
      .toLowerCase()
      .replace(/[:\s]+/g, '_')
      .replace(/[^\p{L}\p{N}_-]/gu, '');
  }

  function normalizePromptLibraryName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/:+/g, '_')
      .replace(/[^\p{L}\p{N}_-]/gu, '');
  }

  function splitPromptLibraryAlias(alias) {
    const normalized = String(alias || '').trim().toLowerCase();
    const [rawCategory, ...rest] = normalized.split(':');
    const category = normalizePromptLibraryCategory(rawCategory);
    const name = normalizePromptLibraryName(rest.join(':'));
    return {
      category: category || 'char',
      name,
    };
  }

  function normalizePromptLibraryAlias(alias, fallbackCategory = 'char') {
    const raw = String(alias || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes(':')) {
      const parts = splitPromptLibraryAlias(raw);
      return parts.name ? `${parts.category}:${parts.name}` : '';
    }

    const category = normalizePromptLibraryCategory(fallbackCategory) || 'char';
    const name = normalizePromptLibraryName(raw);
    return name ? `${category}:${name}` : '';
  }

  function normalizePromptLibraryEntry(entry) {
    const category = normalizePromptLibraryCategory(entry?.category || splitPromptLibraryAlias(entry?.alias || '').category || 'char') || 'char';
    const name = normalizePromptLibraryName(entry?.name || splitPromptLibraryAlias(entry?.alias || '').name || entry?.shortAlias || '');
    const alias = normalizePromptLibraryAlias(entry?.alias || (name ? `${category}:${name}` : ''), category);
    const tags = Array.isArray(entry?.tags) ? entry.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [];
    if (!alias || !tags.length) return null;
    const parts = splitPromptLibraryAlias(alias);

    const delimiters = Array.isArray(entry?.delimiters)
      ? entry.delimiters.map(delimiter => String(delimiter || ''))
      : tags.map((_, index) => index === tags.length - 1 ? '' : ', ');

    while (delimiters.length < tags.length) {
      delimiters.push(tags.length === delimiters.length + 1 ? '' : ', ');
    }

    return {
      id: String(entry.id || createId('library')),
      alias,
      shortAlias: parts.name,
      prefix: parts.category,
      category: parts.category,
      name: parts.name,
      tags,
      delimiters: delimiters.slice(0, tags.length),
      promptText: serializePromptBlocks([{ tags, delimiters }]),
      officialChunkId: entry?.officialChunkId ? String(entry.officialChunkId) : '',
      officialContainerId: entry?.officialContainerId ? String(entry.officialContainerId) : '',
      officialRemoteId: entry?.officialRemoteId ? String(entry.officialRemoteId) : '',
      officialSyncedAt: Number(entry?.officialSyncedAt) || 0,
      createdAt: Number(entry.createdAt) || Date.now(),
      updatedAt: Number(entry.updatedAt) || Date.now(),
    };
  }

  function getPromptLibrarySearchKeys(entry) {
    return [
      entry.alias,
      entry.shortAlias,
      entry.alias.replace(/_/g, ' '),
      entry.shortAlias.replace(/_/g, ' '),
    ].filter(Boolean);
  }

  function getPromptLibrarySummary(entry) {
    const preview = entry.tags.slice(0, 3).join(', ');
    const remain = Math.max(0, entry.tags.length - 3);
    return remain > 0 ? `${preview} ... +${remain}` : preview;
  }

  function getPromptLibraryMacroLabel(entry) {
    return entry.shortAlias || entry.alias || 'chunk';
  }

  function syncPromptLibraryEntryToOfficialChunk(entry, timeout = 5000) {
    if (!entry) return Promise.resolve({ ok: false, skipped: true });
    ensureOfficialChunkBridgeScript();

    return new Promise((resolve) => {
      const requestId = createId('official-chunk-sync');
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('nai-official-chunk-sync-response', handleResponse);
        resolve(result);
      };
      const handleResponse = (event) => {
        if (event?.detail?.requestId !== requestId) return;
        finish(event.detail.error
          ? { ok: false, error: event.detail.error }
          : event.detail.result);
      };

      window.addEventListener('nai-official-chunk-sync-response', handleResponse);
      window.dispatchEvent(new CustomEvent('nai-official-chunk-sync-request', {
        detail: {
          requestId,
          entry: {
            id: entry.officialChunkId || entry.id,
            officialChunkId: entry.officialChunkId,
            officialContainerId: entry.officialContainerId,
            officialRemoteId: entry.officialRemoteId,
            alias: entry.alias,
            name: entry.name,
            shortAlias: entry.shortAlias,
            label: getPromptLibraryMacroLabel(entry),
            promptText: entry.promptText || serializePromptBlocks([{ tags: entry.tags, delimiters: entry.delimiters }]),
          },
        },
      }));
      setTimeout(() => finish({ ok: false, error: '官方 Prompt Chunk 同步超时' }), timeout);
    });
  }

  function patchPromptLibraryOfficialSyncResult(entryId, result) {
    if (!entryId || !result?.ok) return;
    const index = promptLibrary.findIndex(entry => entry.id === entryId);
    if (index < 0) return;
    const nextEntry = normalizePromptLibraryEntry({
      ...promptLibrary[index],
      officialChunkId: result.id,
      officialContainerId: result.containerId,
      officialRemoteId: result.remoteId,
      officialSyncedAt: Date.now(),
    });
    if (!nextEntry) return;
    promptLibrary[index] = nextEntry;
    storageSetLocalStrict({ [PROMPT_LIBRARY_KEY]: promptLibrary }).catch(() => {});
  }

  function createRangeForCurrentTextSegment(context, start, includeTail, options = {}) {
    const {
      editor,
      caretNode,
      caretNodeOffset,
      nodeSegmentStartOffset,
      nodeSegmentTailText,
      scope,
      scopeSegmentStartOffset,
      scopeSegmentText,
      scopeCaretOffset,
      scopeSegmentTailText,
      segmentText,
      segmentTailText,
      segmentStartOffset,
      caretOffset,
    } = context;

    const nodeSegmentTextLength = caretNode?.nodeType === Node.TEXT_NODE
      ? Math.max(0, caretNodeOffset - nodeSegmentStartOffset)
      : 0;
    const segmentNodeStart = Math.max(0, segmentText.length - nodeSegmentTextLength);
    const hasExplicitEnd = Number.isFinite(options.end);
    const shouldUseScopeRange =
      scope &&
      (options.preferScope ||
        start < segmentNodeStart ||
        (includeTail && scopeSegmentTailText.length > nodeSegmentTailText.length));

    if (shouldUseScopeRange) {
      return createRangeFromTextOffsets(
        scope,
        scopeSegmentStartOffset + start,
        hasExplicitEnd
          ? scopeSegmentStartOffset + options.end
          : (includeTail ? scopeCaretOffset + scopeSegmentTailText.length : scopeCaretOffset)
      );
    }

    if (caretNode?.nodeType === Node.TEXT_NODE) {
      const nodeTextLength = caretNode.textContent?.length || 0;
      const nodeStart = Math.max(0, Math.min(nodeTextLength, nodeSegmentStartOffset + start));
      const nodeEnd = hasExplicitEnd
        ? Math.max(nodeStart, Math.min(nodeTextLength, nodeSegmentStartOffset + options.end))
        : (includeTail
            ? Math.max(nodeStart, Math.min(nodeTextLength, caretNodeOffset + nodeSegmentTailText.length))
            : caretNodeOffset);
      const range = document.createRange();
      range.setStart(caretNode, nodeStart);
      range.setEnd(caretNode, nodeEnd);
      return range;
    }

    if (scope && scope !== editor) {
      return createRangeFromTextOffsets(
        scope,
        scopeSegmentStartOffset + start,
        includeTail ? scopeCaretOffset + scopeSegmentTailText.length : scopeCaretOffset
      );
    }

    return createRangeFromTextOffsets(
      editor,
      segmentStartOffset + start,
      hasExplicitEnd
        ? segmentStartOffset + options.end
        : (includeTail ? caretOffset + segmentTailText.length : caretOffset)
    );
  }

  function createWeightPrefixRange(context, length) {
    if (!context || !Number.isFinite(length) || length <= 0) return null;

    const {
      editor,
      scope,
      scopeSegmentStartOffset,
      scopeSegmentText,
      segmentStartOffset,
      segmentText,
    } = context;
    const expectedPrefix = segmentText.slice(0, length);

    if (scope && scopeSegmentText?.startsWith(expectedPrefix)) {
      return createRangeFromTextOffsets(
        scope,
        scopeSegmentStartOffset,
        scopeSegmentStartOffset + length
      );
    }

    return createRangeFromTextOffsets(
      editor,
      segmentStartOffset,
      segmentStartOffset + length
    );
  }

  function getLibraryDefaultName(block) {
    const firstTag = normalizeTagValue(block?.tags?.[0] || '');
    if (!firstTag) return 'new_entry';
    return normalizePromptLibraryName(firstTag);
  }

  function getStorageArea() {
    try {
      if (chrome?.storage?.local) return chrome.storage.local;
    } catch (error) {}
    return null;
  }

  function getPromptLibraryStorageError(error) {
    const message = String(error?.message || error || '');
    if (/Extension context invalidated/i.test(message) || !getStorageArea()) {
      return '扩展刚刚重载，当前页面还是旧脚本。请刷新页面后再保存词库。';
    }
    return '词库保存失败，请稍后重试。';
  }

  function readPromptLibraryLocalBackup() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROMPT_LIBRARY_KEY) || 'null');
      return Array.isArray(parsed) ? parsed.map(normalizePromptLibraryEntry).filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function clearPromptLibraryLocalBackup() {
    try {
      localStorage.removeItem(PROMPT_LIBRARY_KEY);
    } catch (error) {}
  }

  function mergePromptLibraryEntries(primaryEntries, secondaryEntries) {
    const merged = [];
    const aliasIndexMap = new Map();
    const idIndexMap = new Map();

    const upsert = (entry) => {
      const normalized = normalizePromptLibraryEntry(entry);
      if (!normalized) return;

      const aliasKey = normalized.alias;
      const idKey = normalized.id ? String(normalized.id) : '';
      const existingIndex = aliasIndexMap.get(aliasKey) ?? (idKey ? idIndexMap.get(idKey) : undefined);

      if (existingIndex === undefined) {
        merged.push(normalized);
        const index = merged.length - 1;
        aliasIndexMap.set(aliasKey, index);
        if (idKey) idIndexMap.set(idKey, index);
        return;
      }

      const existing = merged[existingIndex];
      const existingTime = Number(existing.updatedAt || existing.createdAt || 0);
      const incomingTime = Number(normalized.updatedAt || normalized.createdAt || 0);
      if (incomingTime < existingTime) return;

      merged[existingIndex] = normalized;
      aliasIndexMap.set(aliasKey, existingIndex);
      if (idKey) idIndexMap.set(idKey, existingIndex);
    };

    (primaryEntries || []).forEach(upsert);
    (secondaryEntries || []).forEach(upsert);
    return merged;
  }

  function storageGetLocal(key) {
    const area = getStorageArea();
    if (!area) {
      try {
        return Promise.resolve({ [key]: JSON.parse(localStorage.getItem(key) || 'null') });
      } catch (error) {
        return Promise.resolve({ [key]: null });
      }
    }

    return new Promise(resolve => {
      try {
        area.get([key], result => resolve(result || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  function storageSetLocal(data) {
    const area = getStorageArea();
    if (!area) {
      Object.entries(data || {}).forEach(([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value));
      });
      return Promise.resolve();
    }

    return new Promise(resolve => {
      try {
        area.set(data, () => resolve());
      } catch (error) {
        resolve();
      }
    });
  }

  function storageGetLocalStrict(key) {
    const area = getStorageArea();
    if (!area) {
      return Promise.reject(new Error('Extension context invalidated'));
    }

    return new Promise((resolve, reject) => {
      try {
        area.get([key], (result) => {
          const message = chrome?.runtime?.lastError?.message;
          if (message) {
            reject(new Error(message));
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSetLocalStrict(data) {
    const area = getStorageArea();
    if (!area) {
      return Promise.reject(new Error('Extension context invalidated'));
    }

    return new Promise((resolve, reject) => {
      try {
        area.set(data, () => {
          const message = chrome?.runtime?.lastError?.message;
          if (message) {
            reject(new Error(message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function loadPromptLibrary() {
    const backupEntries = readPromptLibraryLocalBackup();

    try {
      const stored = await storageGetLocalStrict(PROMPT_LIBRARY_KEY);
      const extensionEntries = Array.isArray(stored[PROMPT_LIBRARY_KEY])
        ? stored[PROMPT_LIBRARY_KEY].map(normalizePromptLibraryEntry).filter(Boolean)
        : [];
      const mergedEntries = mergePromptLibraryEntries(extensionEntries, backupEntries);

      promptLibrary = mergedEntries;

      if (backupEntries.length) {
        const extensionSnapshot = JSON.stringify(extensionEntries);
        const mergedSnapshot = JSON.stringify(mergedEntries);
        if (extensionSnapshot !== mergedSnapshot) {
          await storageSetLocalStrict({ [PROMPT_LIBRARY_KEY]: mergedEntries });
        }
        clearPromptLibraryLocalBackup();
      }
    } catch (error) {
      promptLibrary = backupEntries;
    }
  }

  async function savePromptLibrary(entries) {
    promptLibrary = entries.map(normalizePromptLibraryEntry).filter(Boolean);
    await storageSetLocalStrict({ [PROMPT_LIBRARY_KEY]: promptLibrary });
    clearPromptLibraryLocalBackup();
  }

  function getEditorStorageKey(editor) {
    if (!editor) return null;
    const editors = Array.from(document.querySelectorAll('.ProseMirror'));
    const index = editors.indexOf(editor);
    if (index === -1) return null;
    return `${PROMPT_BLOCK_STORAGE_PREFIX}:${location.origin}${location.pathname}:${index}`;
  }

  function loadPersistedPromptBlockState(editor) {
    const storageKey = getEditorStorageKey(editor);
    if (!storageKey) return null;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.blocks)) return null;
      return {
        blocks: parsed.blocks.map(block => ({
          id: block.id || createId(block.isGroup ? 'block' : 'tag'),
          tags: Array.isArray(block.tags) ? block.tags.map(tag => String(tag)) : [],
          delimiters: Array.isArray(block.delimiters) ? block.delimiters.map(delimiter => String(delimiter)) : [],
          locked: Boolean(block.locked),
          isGroup: Boolean(block.isGroup),
          libraryId: block.libraryId ? String(block.libraryId) : undefined,
          libraryAlias: block.libraryAlias ? String(block.libraryAlias) : undefined,
          libraryCategory: block.libraryCategory ? String(block.libraryCategory) : undefined,
        })).filter(block => block.tags.length > 0),
        signature: typeof parsed.signature === 'string' ? parsed.signature : '',
      };
    } catch (error) {
      return null;
    }
  }

  function persistPromptBlockState(editor, state) {
    const storageKey = getEditorStorageKey(editor);
    if (!storageKey) return;

    try {
      if (!state?.blocks?.length) {
        localStorage.removeItem(storageKey);
        return;
      }

      localStorage.setItem(storageKey, JSON.stringify({
        blocks: state.blocks,
        signature: state.signature,
      }));
    } catch (error) {}
  }

  function loadPromptBlockState(editor) {
    const state = editor ? (promptBlockStates.get(editor) || loadPersistedPromptBlockState(editor)) : null;
    promptBlocks = clonePromptBlocks(state?.blocks || []);
    promptBlockSignature = state?.signature || '';
    if (editor && state) {
      promptBlockStates.set(editor, {
        blocks: clonePromptBlocks(promptBlocks),
        signature: promptBlockSignature,
      });
    }
  }

  function savePromptBlockState(editor) {
    if (!editor) return;
    const state = {
      blocks: clonePromptBlocks(promptBlocks),
      signature: promptBlockSignature,
    };
    promptBlockStates.set(editor, state);
    persistPromptBlockState(editor, state);
  }

  function getPromptBlockHistory(editor) {
    if (!editor) return [];
    let history = promptBlockHistoryStates.get(editor);
    if (!history) {
      history = [];
      promptBlockHistoryStates.set(editor, history);
    }
    return history;
  }

  function snapshotPromptBlockState(editor) {
    return {
      blocks: clonePromptBlocks(promptBlocks),
      signature: promptBlockSignature,
      text: getEditorText(editor),
    };
  }

  function pushPromptBlockHistory(editor) {
    if (!editor) return;
    const history = getPromptBlockHistory(editor);
    history.push(snapshotPromptBlockState(editor));
    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }
  }

  function restorePromptBlockHistory(editor) {
    if (!editor) return false;
    const history = getPromptBlockHistory(editor);
    if (!history.length) return false;

    const currentText = getEditorText(editor);
    let targetIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].text === currentText) {
        targetIndex = index;
        break;
      }
    }

    if (targetIndex === -1) return false;

    const [snapshot] = history.splice(targetIndex, 1);
    promptBlocks = clonePromptBlocks(snapshot.blocks);
    promptBlockSignature = snapshot.signature;
    savePromptBlockState(editor);
    renderPromptBlockPanel(editor);
    updatePromptBlockToolbar(editor);
    if (!promptBlocks.some(block => block.isGroup)) {
      hidePromptBlockToolbar();
    }
    return true;
  }

  function schedulePromptBlockUndoSync(editor) {
    if (!editor) return;
    setTimeout(() => {
      if (!editor.isConnected) return;
      activeEditor = editor;
      if (!restorePromptBlockHistory(editor)) {
        ensurePromptBlockModel(editor);
      }
      updatePromptBlockToolbar(editor);
    }, 0);
  }

  function rebuildPromptBlocksFromTokens(tokens) {
    if (!promptBlocks.length) {
      return tokens.map(token => ({
        id: createId('tag'),
        tags: [token.tag],
        delimiters: [token.delimiter],
        locked: false,
        isGroup: false,
      }));
    }

    const nextBlocks = [];
    let cursor = 0;

    promptBlocks.forEach(block => {
      if (cursor >= tokens.length) return;
      const remaining = tokens.length - cursor;
      const blockSize = Math.min(block.tags.length, remaining);
      const nextTokens = tokens.slice(cursor, cursor + blockSize);
      cursor += blockSize;

      if (!nextTokens.length) return;

      const isGroup = block.isGroup && nextTokens.length > 1;

      nextBlocks.push({
        ...block,
        id: block.id,
        tags: nextTokens.map(token => token.tag),
        delimiters: nextTokens.map(token => token.delimiter),
        locked: block.locked && isGroup,
        isGroup,
        libraryId: isGroup ? block.libraryId : undefined,
        libraryAlias: isGroup ? block.libraryAlias : undefined,
        libraryCategory: isGroup ? block.libraryCategory : undefined,
      });
    });

    while (cursor < tokens.length) {
      nextBlocks.push({
        id: createId('tag'),
        tags: [tokens[cursor].tag],
        delimiters: [tokens[cursor].delimiter],
        locked: false,
        isGroup: false,
      });
      cursor += 1;
    }

    return nextBlocks;
  }

  function getTextOffsetForTokenIndex(tokens, tokenIndex) {
    if (tokenIndex <= 0) return 0;
    return tokens
      .slice(0, tokenIndex)
      .reduce((sum, token) => sum + token.tag.length + (token.delimiter?.length || 0), 0);
  }

  function replaceEditorText(editor, text) {
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
    activeEditor = editor;
  }

  function getPromptBlockIcon(type) {
    const icons = {
      group: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h5A1.5 1.5 0 0 1 12 7.5v5A1.5 1.5 0 0 1 10.5 14h-5A1.5 1.5 0 0 1 4 12.5zm8 0A1.5 1.5 0 0 1 13.5 6h5A1.5 1.5 0 0 1 20 7.5v5A1.5 1.5 0 0 1 18.5 14h-5A1.5 1.5 0 0 1 12 12.5zM8 15.5a.75.75 0 0 1 .75.75V18H10.5a.75.75 0 0 1 0 1.5H8.75v1.75a.75.75 0 0 1-1.5 0V19.5H5.5a.75.75 0 0 1 0-1.5h1.75v-1.75A.75.75 0 0 1 8 15.5z" fill="currentColor"/></svg>',
      save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.25 3h9.69a2.25 2.25 0 0 1 1.6.66l2.8 2.8a2.25 2.25 0 0 1 .66 1.59v9.7A3.25 3.25 0 0 1 17.75 21h-11.5A3.25 3.25 0 0 1 3 17.75v-11.5A3.25 3.25 0 0 1 6.25 3m1.25 1.5v4.25h8V6.5H13a.75.75 0 0 1-.75-.75V4.5zm4.5 11.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5" fill="currentColor"/></svg>',
      grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1.6" fill="currentColor"/><circle cx="8" cy="12" r="1.6" fill="currentColor"/><circle cx="8" cy="17" r="1.6" fill="currentColor"/><circle cx="16" cy="7" r="1.6" fill="currentColor"/><circle cx="16" cy="12" r="1.6" fill="currentColor"/><circle cx="16" cy="17" r="1.6" fill="currentColor"/></svg>',
      lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8.5a5 5 0 1 1 10 0V10h.75A2.25 2.25 0 0 1 20 12.25v7.5A2.25 2.25 0 0 1 17.75 22h-11.5A2.25 2.25 0 0 1 4 19.75v-7.5A2.25 2.25 0 0 1 6.25 10zm1.5 0h7V8.5a3.5 3.5 0 1 0-7 0z" fill="currentColor"/></svg>',
      unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 10V8.5a3.5 3.5 0 0 0-6.86-.98.75.75 0 1 1-1.47-.3A5 5 0 0 1 17 8.5V10h.75A2.25 2.25 0 0 1 20 12.25v7.5A2.25 2.25 0 0 1 17.75 22h-11.5A2.25 2.25 0 0 1 4 19.75v-7.5A2.25 2.25 0 0 1 6.25 10z" fill="currentColor"/></svg>',
      remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.53 5.47a.75.75 0 0 1 1.06 0L12 6.88l1.41-1.41a.75.75 0 1 1 1.06 1.06L13.06 7.94l1.41 1.41a.75.75 0 1 1-1.06 1.06L12 9l-1.41 1.41a.75.75 0 1 1-1.06-1.06l1.41-1.41-1.41-1.41a.75.75 0 0 1 0-1.06M7 4.25A2.25 2.25 0 0 1 9.25 2h5.5A2.25 2.25 0 0 1 17 4.25V5h1.25a.75.75 0 0 1 0 1.5h-.45l-.63 10.12A2.25 2.25 0 0 1 14.92 19H9.08a2.25 2.25 0 0 1-2.25-2.38L6.2 6.5h-.45a.75.75 0 0 1 0-1.5H7zm1.5.75h7v-.75a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75z" fill="currentColor"/></svg>',
    };
    return icons[type] || '';
  }

  function applyThemePreset(themePreset) {
    document.documentElement.dataset.naiTheme = themePreset || DEFAULT_THEME;
  }

  function syncThemeFromStorage() {
    try {
      chrome.storage.local.get([ASSISTANT_SETTINGS_KEY], (data) => {
        applyThemePreset(data?.[ASSISTANT_SETTINGS_KEY]?.themePreset || DEFAULT_THEME);
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[ASSISTANT_SETTINGS_KEY]) return;
        applyThemePreset(changes[ASSISTANT_SETTINGS_KEY].newValue?.themePreset || DEFAULT_THEME);
      });
    } catch (error) {
      applyThemePreset(DEFAULT_THEME);
    }
  }

  function ensureOfficialChunkBridgeScript() {
    if (document.documentElement.dataset.naiOfficialChunkBridgeInjected === 'true') return;
    document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'true';

    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('official-chunk-bridge.js');
      script.async = false;
      script.onload = () => script.remove();
      script.onerror = () => {
        document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
    }
  }

  // CSV 解析，正确处理引号中的逗号
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  // 加载标签
  async function loadTags() {
    try {
      const cached = localStorage.getItem('nai-ac-tags');
      const cacheTime = localStorage.getItem('nai-ac-tags-time');
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 86400000) {
        allTags = JSON.parse(cached);
        isLoading = false;
        console.log(`[NAI-AC] 已从缓存加载 ${allTags.length} 个标签`);
        return;
      }

      const response = await fetch(CONFIG.CSV_URL);
      const text = await response.text();
      const lines = text.split('\n');
      allTags = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = parseCSVLine(line);
        if (parts[0]) {
          allTags.push({
            tag: parts[0].trim(),
            category: parts[1]?.trim() || '0',
            postCount: parseInt(parts[2]) || 0,
            aliases: parts[3]?.split(',').map(a => a.trim()).filter(Boolean) || [],
            translation: parts[4]?.split('|')[0]?.trim() || '',
          });
        }
      }

      allTags.sort((a, b) => b.postCount - a.postCount);
      localStorage.setItem('nai-ac-tags', JSON.stringify(allTags.slice(0, 50000)));
      localStorage.setItem('nai-ac-tags-time', Date.now().toString());
      isLoading = false;
      console.log(`[NAI-AC] 已加载 ${allTags.length} 个标签`);
    } catch (e) {
      console.error('[NAI-AC] 标签加载失败:', e);
      isLoading = false;
    }
  }

  // 搜索标签
  function searchTags(query) {
    if (!query || query.length < CONFIG.MIN_QUERY_LENGTH) return [];
    if (String(query || '').startsWith('@')) return [];
    const q = query.toLowerCase().replace(/_/g, ' ');
    const results = [];

    promptLibrary.forEach(entry => {
      const keys = getPromptLibrarySearchKeys(entry);
      let score = 0;
      for (const key of keys) {
        const normalizedKey = key.toLowerCase().replace(/_/g, ' ');
        if (normalizedKey === q) {
          score = Math.max(score, 3000);
        } else if (normalizedKey.startsWith(q)) {
          score = Math.max(score, 2400);
        } else if (normalizedKey.includes(q)) {
          score = Math.max(score, 1800);
        }
      }

      if (score > 0) {
        results.push({
          ...entry,
          resultType: 'prompt-library',
          category: 'library',
          translation: getPromptLibrarySummary(entry),
          postCount: entry.tags.length,
          score: score + entry.tags.length / 100,
        });
      }
    });

    for (const tag of allTags) {
      if (results.length >= CONFIG.MAX_RESULTS * 3) break;
      const t = tag.tag.toLowerCase().replace(/_/g, ' ');
      const tr = tag.translation?.toLowerCase() || '';
      const aliases = tag.aliases || [];

      if (t.startsWith(q)) {
        results.push({ ...tag, score: 1000 + tag.postCount / 1e6 });
      } else if (t.includes(q)) {
        results.push({ ...tag, score: 500 + tag.postCount / 1e6 });
      } else if (tr.includes(q)) {
        results.push({ ...tag, score: 300 + tag.postCount / 1e6 });
      } else if (aliases.some(a => a.toLowerCase().replace(/_/g, ' ').includes(q))) {
        results.push({ ...tag, score: 200 + tag.postCount / 1e6, matchedAlias: aliases.find(a => a.toLowerCase().includes(q)) });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, CONFIG.MAX_RESULTS);
  }

  // 创建补全容器
  function createContainer() {
    if (autocompleteContainer) return autocompleteContainer;
    const c = document.createElement('div');
    c.className = 'nai-autocomplete-container';
    c.innerHTML = `
      <div class="nai-autocomplete-header">
        <span class="nai-autocomplete-title">标签补全</span>
        <label class="nai-slash-toggle" title="下划线与空格互转">
          <input type="checkbox" id="nai-slash-switch">
          <span>_ ⇄ 空格</span>
        </label>
      </div>
      <div class="nai-autocomplete-list"></div>
      <div class="nai-autocomplete-footer"><span class="nai-autocomplete-count-info"></span><span>↑↓ 选择 · Tab 确认</span></div>
    `;
    document.body.appendChild(c);
    autocompleteContainer = c;

    const holdAutocompleteInteraction = event => {
      autocompletePointerDownAt = Date.now();
    };
    const handleAutocompleteContainerPick = event => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest('.nai-autocomplete-item');
      if (!item || !c.contains(item)) return;
      handleAutocompleteItemEvent(item, event);
    };
    c.addEventListener('pointerdown', holdAutocompleteInteraction, true);
    c.addEventListener('mousedown', holdAutocompleteInteraction, true);
    c.addEventListener('pointerdown', handleAutocompleteContainerPick, true);
    c.addEventListener('mousedown', handleAutocompleteContainerPick, true);
    c.addEventListener('click', handleAutocompleteContainerPick, true);

    // 下划线互转开关
    const slashSwitch = c.querySelector('#nai-slash-switch');
    slashSwitch.checked = settings.convertSlashToSpace;
    slashSwitch.addEventListener('change', (e) => {
      e.stopPropagation();
      settings.convertSlashToSpace = slashSwitch.checked;
      localStorage.setItem('nai-ac-settings', JSON.stringify(settings));
    });

    document.addEventListener('click', e => {
      if (!c.contains(e.target) && e.target !== activeEditor) hideAutocomplete();
    });
    return c;
  }

  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  function highlight(text, query) {
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) + '<span class="highlight">' + escapeHtml(text.slice(i, i + query.length)) + '</span>' + escapeHtml(text.slice(i + query.length));
  }

  function formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function slicePromptBlock(block, startIndex, endIndexExclusive) {
    const tags = block.tags.slice(startIndex, endIndexExclusive);
    const delimiters = (block.delimiters || []).slice(startIndex, endIndexExclusive);
    if (!tags.length) return null;
    const isGroup = block.isGroup && tags.length > 1;
    const isWholeBlock = startIndex === 0 && endIndexExclusive === block.tags.length;
    return {
      ...(isWholeBlock ? block : {}),
      id: tags.length === block.tags.length ? block.id : createId(isGroup ? 'block' : 'tag'),
      tags,
      delimiters,
      locked: isGroup && block.locked,
      isGroup,
      libraryId: isGroup && isWholeBlock ? block.libraryId : undefined,
      libraryAlias: isGroup && isWholeBlock ? block.libraryAlias : undefined,
      libraryCategory: isGroup && isWholeBlock ? block.libraryCategory : undefined,
    };
  }

  function replacePromptBlocksByTokenRange(startTokenIndex, endTokenIndex, insertedBlocks) {
    let cursor = 0;
    const before = [];
    const after = [];

    promptBlocks.forEach(block => {
      const blockStart = cursor;
      const blockEnd = cursor + block.tags.length - 1;

      if (blockEnd < startTokenIndex) {
        before.push(block);
      } else if (blockStart > endTokenIndex) {
        after.push(block);
      } else {
        const startOffset = Math.max(0, startTokenIndex - blockStart);
        const endOffset = Math.min(block.tags.length, endTokenIndex - blockStart + 1);
        const leading = slicePromptBlock(block, 0, startOffset);
        const trailing = slicePromptBlock(block, endOffset, block.tags.length);
        if (leading) before.push(leading);
        if (trailing) after.push(trailing);
      }

      cursor += block.tags.length;
    });

    return [...before, ...insertedBlocks, ...after];
  }

  function getEditorFromRange(range) {
    const node = range.startContainer;
    return node.nodeType === Node.TEXT_NODE
      ? node.parentElement?.closest('.ProseMirror')
      : node.closest?.('.ProseMirror');
  }

  function getPromptSegmentScope(editor, node) {
    let element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof HTMLElement)) return editor;

    while (element.parentElement && element.parentElement !== editor) {
      element = element.parentElement;
    }

    return editor.contains(element) ? element : editor;
  }

  function createRangeFromTextOffsets(root, startOffset, endOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node = null;
    let currentOffset = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;
    let lastNode = null;
    let lastNodeLength = 0;
    const normalizedStart = Math.max(0, startOffset);
    const normalizedEnd = Math.max(normalizedStart, endOffset);

    while ((node = walker.nextNode())) {
      const textLength = node.textContent?.length || 0;
      const nextOffset = currentOffset + textLength;
      lastNode = node;
      lastNodeLength = textLength;

      if (!startNode && normalizedStart <= nextOffset) {
        startNode = node;
        startNodeOffset = Math.max(0, Math.min(textLength, normalizedStart - currentOffset));
      }

      if (!endNode && normalizedEnd <= nextOffset) {
        endNode = node;
        endNodeOffset = Math.max(0, Math.min(textLength, normalizedEnd - currentOffset));
        break;
      }

      currentOffset = nextOffset;
    }

    if (!startNode && lastNode) {
      startNode = lastNode;
      startNodeOffset = lastNodeLength;
    }
    if (!endNode && lastNode) {
      endNode = lastNode;
      endNodeOffset = lastNodeLength;
    }
    if (!startNode || !endNode) return null;

    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
  }

  function getSegmentContext() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;

    const range = sel.getRangeAt(0);
    const editor = activeEditor || getEditorFromRange(range);
    if (!editor) return null;
    const caretNode = range.startContainer;
    const caretNodeOffset = range.startOffset;
    const scope = getPromptSegmentScope(editor, caretNode);

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(editor);
    afterRange.setStart(range.startContainer, range.startOffset);

    const beforeText = beforeRange.toString();
    const afterText = afterRange.toString();
    const segmentBreak = findLastPromptSegmentBreak(beforeText);
    const rawSegment = beforeText.slice(segmentBreak + 1);
    const leadingSpaceLength = rawSegment.match(/^\s*/)?.[0].length || 0;
    const segmentText = rawSegment.slice(leadingSpaceLength);
    const caretOffset = beforeText.length;
    const segmentStartOffset = caretOffset - segmentText.length;
    const segmentTailMatch = afterText.match(/^[^,，\n|]*/);
    const segmentTailText = segmentTailMatch ? segmentTailMatch[0] : '';
    const afterSegmentText = afterText.slice(segmentTailText.length);
    const nextMeaningfulChar = afterSegmentText.replace(/^\s+/, '').charAt(0);
    const segmentRange = createRangeFromTextOffsets(editor, segmentStartOffset, caretOffset);

    const scopeBeforeRange = range.cloneRange();
    scopeBeforeRange.selectNodeContents(scope);
    scopeBeforeRange.setEnd(range.startContainer, range.startOffset);

    const scopeAfterRange = range.cloneRange();
    scopeAfterRange.selectNodeContents(scope);
    scopeAfterRange.setStart(range.startContainer, range.startOffset);

    const scopeBeforeText = scopeBeforeRange.toString();
    const scopeAfterText = scopeAfterRange.toString();
    const scopeSegmentBreak = findLastPromptSegmentBreak(scopeBeforeText);
    const scopeRawSegment = scopeBeforeText.slice(scopeSegmentBreak + 1);
    const scopeLeadingSpaceLength = scopeRawSegment.match(/^\s*/)?.[0].length || 0;
    const scopeSegmentText = scopeRawSegment.slice(scopeLeadingSpaceLength);
    const scopeCaretOffset = scopeBeforeText.length;
    const scopeSegmentStartOffset = scopeCaretOffset - scopeSegmentText.length;
    const scopeSegmentTailMatch = scopeAfterText.match(/^[^,，\n|]*/);
    const scopeSegmentTailText = scopeSegmentTailMatch ? scopeSegmentTailMatch[0] : '';

    const nodeText = caretNode.nodeType === Node.TEXT_NODE ? caretNode.textContent || '' : '';
    const nodeBeforeCaret = caretNode.nodeType === Node.TEXT_NODE ? nodeText.slice(0, caretNodeOffset) : '';
    const nodeAfterCaret = caretNode.nodeType === Node.TEXT_NODE ? nodeText.slice(caretNodeOffset) : '';
    const nodeSegmentBreak = findLastPromptSegmentBreak(nodeBeforeCaret);
    const nodeRawSegment = nodeBeforeCaret.slice(nodeSegmentBreak + 1);
    const nodeLeadingSpaceLength = nodeRawSegment.match(/^\s*/)?.[0].length || 0;
    const nodeSegmentStartOffset = nodeSegmentBreak + 1 + nodeLeadingSpaceLength;
    const nodeSegmentTailMatch = nodeAfterCaret.match(/^[^,，\n|]*/);
    const nodeSegmentTailText = nodeSegmentTailMatch ? nodeSegmentTailMatch[0] : '';

    if (!segmentRange) return null;

    return {
      editor,
      caretNode,
      caretNodeOffset,
      nodeSegmentStartOffset,
      nodeSegmentTailText,
      scope,
      scopeSegmentStartOffset,
      scopeCaretOffset,
      scopeSegmentTailText,
      segmentText,
      segmentTailText,
      segmentStartOffset,
      caretOffset,
      nextMeaningfulChar,
      segmentRange,
    };
  }

  // 解析当前上下文（权重、artist 前缀等）
  function parseCurrentContext() {
    const context = getSegmentContext();
    if (!context) return { weight: 1.0, hasArtist: false };

    const { segmentText: segment } = context;
    const weightMatch = segment.match(/^(-?\d+\.?\d*)(?::|：){2}/);

    return {
      weight: weightMatch ? parseFloat(weightMatch[1]) : 1.0,
      hasArtist: /artist(?::|：)/.test(segment),
    };
  }

  function showAutocomplete(editor, results, query) {
    const c = createContainer();
    const list = c.querySelector('.nai-autocomplete-list');

    if (query === lastRenderedQuery && currentResults.length > 0) {
      lastAutocompleteContext = getSegmentContext();
      positionAutocomplete(editor);
      c.classList.add('visible');
      return;
    }

    lastRenderedQuery = query;
    currentResults = results;
    currentQuery = query;
    selectedIndex = 0;

    const context = parseCurrentContext();
    lastAutocompleteContext = getSegmentContext();

    if (isLoading) {
      list.innerHTML = '<div class="nai-autocomplete-loading"><span class="nai-autocomplete-spinner"></span>加载中...</div>';
    } else if (!results.length) {
      list.innerHTML = '<div class="nai-autocomplete-empty"><div class="nai-autocomplete-empty-icon">-</div>无匹配结果</div>';
    } else {
      list.innerHTML = results.map((tag, i) => {
        const isLibrary = tag.resultType === 'prompt-library';
        const isArtist = tag.category === '1';
        const showArtistChecked = isArtist && context.hasArtist;
        const weightControl = isLibrary ? '' : `
          <div class="nai-autocomplete-weight">
            <button class="nai-weight-btn nai-weight-down" data-index="${i}">-</button>
            <span class="nai-weight-value" data-index="${i}">${context.weight.toFixed(1)}</span>
            <button class="nai-weight-btn nai-weight-up" data-index="${i}">+</button>
          </div>
        `;
        const countLabel = isLibrary ? `${tag.tags.length} tags` : formatCount(tag.postCount);
        const libraryBadge = isLibrary ? '<span class="nai-autocomplete-badge">词库</span>' : '';
        const tagTitle = isLibrary
          ? `<div class="nai-autocomplete-tag"><span class="nai-autocomplete-tag-text">${highlight(tag.alias, query)}</span></div>`
          : `<div class="nai-autocomplete-tag"><span class="nai-autocomplete-tag-text">${highlight(tag.tag, query)}</span></div>`;
        const subTitle = isLibrary
          ? `<div class="nai-autocomplete-translation">${escapeHtml(tag.translation || '')}</div>`
          : (tag.matchedAlias ? `<div class="nai-autocomplete-translation">别名 · ${tag.matchedAlias}</div>` :
              tag.translation ? `<div class="nai-autocomplete-translation">${tag.translation}</div>` : '');
        return `
        <div class="nai-autocomplete-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
          <div class="nai-autocomplete-category" data-category="${isLibrary ? 'library' : tag.category}"></div>
          <div class="nai-autocomplete-content">
            ${tagTitle}
            ${subTitle}
          </div>
          <div class="nai-autocomplete-meta">
            ${libraryBadge}
            ${isArtist && !isLibrary ? `<label class="nai-artist-toggle" title="使用 artist: 前缀" data-index="${i}">
              <input type="checkbox" class="nai-artist-check" data-index="${i}" ${showArtistChecked ? 'checked' : ''}>
              <span>artist:</span>
            </label>` : ''}
            ${weightControl}
            <div class="nai-autocomplete-count">${countLabel}</div>
          </div>
        </div>
      `;
      }).join('');

      results.forEach(tag => {
        if (tag.resultType === 'prompt-library') return;
        tag.weight = context.weight;
        if (tag.category === '1') {
          tag.useArtistPrefix = context.hasArtist;
        }
      });

      list.querySelectorAll('.nai-artist-check').forEach(chk => {
        chk.addEventListener('mousedown', e => e.stopPropagation());
        chk.addEventListener('click', e => e.stopPropagation());
        chk.addEventListener('change', e => {
          e.stopPropagation();
          currentResults[+chk.dataset.index].useArtistPrefix = chk.checked;
        });
      });

      list.querySelectorAll('.nai-artist-toggle').forEach(label => {
        label.addEventListener('click', e => {
          if (!e.target.classList.contains('nai-artist-check')) {
            e.preventDefault();
            e.stopPropagation();
          }
        });

        label.addEventListener('mousedown', e => {
          if (e.target.classList.contains('nai-artist-check')) return;
          e.preventDefault();
          e.stopPropagation();
          const chk = label.querySelector('.nai-artist-check');
          chk.checked = !chk.checked;
          currentResults[+label.dataset.index].useArtistPrefix = chk.checked;
        });
      });

      list.querySelectorAll('.nai-weight-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          e.stopPropagation();
          const idx = +btn.dataset.index;
          const valueEl = list.querySelector(`.nai-weight-value[data-index="${idx}"]`);
          const currentValue = parseFloat(valueEl.textContent);
          let val = Number.isFinite(currentValue) ? currentValue : 1.0;
          val = btn.classList.contains('nai-weight-up') ? val + 0.1 : val - 0.1;
          val = Math.max(-2.0, Math.min(2.0, val));
          valueEl.textContent = val.toFixed(1);
          currentResults[idx].weight = val;
        });
      });

      list.querySelectorAll('.nai-autocomplete-item').forEach(item => {
        const handleAutocompleteItemPointer = e => handleAutocompleteItemEvent(item, e);
        item.addEventListener('pointerdown', handleAutocompleteItemPointer);
        item.addEventListener('mousedown', handleAutocompleteItemPointer);
        item.addEventListener('click', handleAutocompleteItemPointer);
        item.onmouseenter = () => {
          selectedIndex = +item.dataset.index;
          updateSelection();
        };
      });
    }

    c.querySelector('.nai-autocomplete-count-info').textContent = `${results.length} 条结果`;
    positionAutocomplete(editor);
    c.classList.add('visible');
  }

  function hideAutocomplete() {
    autocompleteContainer?.classList.remove('visible');
    autocompleteContainer?.querySelector('.nai-autocomplete-list')?.replaceChildren();
    currentResults = [];
    selectedIndex = 0;
    lastRenderedQuery = '';
    lastAutocompleteContext = null;
  }

  function getCaretRect(editor) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return editor.getBoundingClientRect();

    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    let rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;

    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    marker.setAttribute('data-nai-caret-marker', 'true');

    try {
      range.insertNode(marker);
      rect = marker.getBoundingClientRect();
    } finally {
      marker.remove();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    return rect && (rect.width || rect.height) ? rect : editor.getBoundingClientRect();
  }

  function positionAutocomplete(editor) {
    if (!autocompleteContainer || !editor) return;
    const editorRect = editor.getBoundingClientRect();
    const caretRect = getCaretRect(editor);
    const viewportPadding = 8;
    const gap = 10;
    const panelWidth = Math.min(
      Math.max(autocompleteContainer.offsetWidth || 360, 280),
      400
    );
    const panelHeight = Math.min(
      Math.max(autocompleteContainer.offsetHeight || 320, 180),
      320
    );

    const spaceBelow = window.innerHeight - caretRect.bottom - viewportPadding;
    const spaceAbove = caretRect.top - viewportPadding;

    let top;
    if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
      top = caretRect.bottom + gap;
    } else {
      top = caretRect.top - panelHeight - gap;
    }

    top = Math.min(
      Math.max(viewportPadding, top),
      Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding)
    );

    let left = caretRect.left;
    if (left + panelWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - panelWidth - viewportPadding;
    }
    left = Math.max(viewportPadding, left);

    if (left < editorRect.left - panelWidth * 0.5) {
      left = Math.max(viewportPadding, editorRect.left);
    }

    autocompleteContainer.style.top = `${top}px`;
    autocompleteContainer.style.left = `${left}px`;
  }

  function repositionVisibleAutocomplete() {
    autocompleteRepositionFrame = 0;
    if (!autocompleteContainer?.classList.contains('visible') || !activeEditor?.isConnected) return;
    positionAutocomplete(activeEditor);
  }

  function scheduleAutocompleteReposition() {
    if (autocompleteRepositionFrame) return;
    autocompleteRepositionFrame = requestAnimationFrame(repositionVisibleAutocomplete);
  }

  function updateSelection() {
    let selectedItem = null;
    autocompleteContainer?.querySelectorAll('.nai-autocomplete-item').forEach((item, i) => {
      const isSelected = i === selectedIndex;
      item.classList.toggle('selected', isSelected);
      if (isSelected) selectedItem = item;
    });
    selectedItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function stopAutocompleteEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function handleAutocompleteItemEvent(item, event) {
    if (
      event.target.closest('.nai-weight-btn') ||
      event.target.closest('.nai-artist-toggle') ||
      event.target.closest('.nai-artist-check')
    ) {
      return;
    }

    stopAutocompleteEvent(event);

    if (event.type !== 'click') {
      return;
    }

    const now = Date.now();
    if (now - autocompleteItemHandledAt < 80) return;
    autocompleteItemHandledAt = now;

    const index = Number(item.dataset.index);
    if (!Number.isInteger(index)) return;
    applyAutocompleteResult(currentResults[index]);
  }

  function getCurrentWord() {
    const context = getSegmentContext();
    if (!context) return '';

    const word = context.segmentText.trim();
    if (!word) return '';

    let match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)([^:：]+)(?::|：){2}$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}([^:：]+)(?::|：){2}$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)([^:：]+)(?::|：)$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}([^:：]+)(?::|：)$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)[^:：]+(?::|：){2}(.+)$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}[^:：]+(?::|：){2}(.+)$/);
    if (match) return match[2];

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}.*[,，|]([^,，|]*)$/);
    if (match) return match[2].trim();

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)(.*)$/);
    if (match) return match[2].replace(/(?::|：)+$/, '');

    match = word.match(/^(-?\d+\.?\d*)(?::|：){2}(.*)$/);
    if (match) return match[2].replace(/(?::|：)+$/, '');

    match = word.match(/^artist(?::|：)(.*)$/);
    if (match) return match[1];

    const plainQueryMatch = getPlainQueryMatch(word);
    if (plainQueryMatch) return plainQueryMatch[2];

    return word;
  }

  function isOfficialPromptChunkQuery() {
    const context = getSegmentContext();
    if (!context) return false;
    return /(^|[\s,，|])@[\p{L}\p{N}_ '"\-./()]*$/u.test(context.segmentText.trim());
  }

  function applyAutocompleteResult(item) {
    if (!item) return;
    if (item.resultType === 'prompt-library') {
      selectPromptLibrary(item);
      return;
    }
    selectTag(item);
  }

  function selectPromptLibrary(entry) {
    if (!activeEditor || !entry) return;
    const context = lastAutocompleteContext || getSegmentContext();
    if (!context) return;

    const chunkQueryMatch = context.segmentText.match(/(^|[\s,，|])(@[\p{L}\p{N}_ '"\-./()]*$)/u);
    const replaceStart = chunkQueryMatch
      ? chunkQueryMatch.index + chunkQueryMatch[1].length
      : Math.max(0, context.segmentText.lastIndexOf('@'));
    const replacementRange = createRangeForCurrentTextSegment(context, replaceStart, false);
    if (!replacementRange) return;

    hideAutocomplete();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(replacementRange);
    document.execCommand('insertText', false, entry.promptText || entry.tags.join(', '));
    ensurePromptBlockModel(activeEditor);
  }

  function selectTag(tag) {
    if (!activeEditor || !tag) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const context = lastAutocompleteContext || getSegmentContext();
    if (!context) return;

    const {
      editor,
      caretNode,
      caretNodeOffset,
      nodeSegmentStartOffset,
      segmentText: currentSegment,
      segmentTailText,
      segmentStartOffset,
      caretOffset,
      nextMeaningfulChar,
    } = context;

    let start = 0;
    let isAfterComplete = false;
    let isMultiTagFormat = false;
    let replaceTail = false;
    const weight = Number.isFinite(tag.weight) ? tag.weight : 1.0;
    const currentWeightMatch = currentSegment.match(/^(-?\d+\.?\d*)(?::|：){2}/);
    const preservedSuffixMatch = segmentTailText.match(/[\)\]\}]+$/);
    const preservedSuffix = preservedSuffixMatch ? preservedSuffixMatch[0] : '';
    const normalizedTail = segmentTailText.slice(0, segmentTailText.length - preservedSuffix.length);
    const fullSegment = `${currentSegment}${normalizedTail}`;
    const hasTrailingText = Boolean(normalizedTail.trim());
    const shouldAppendComma = hasTrailingText || !isPromptBoundaryChar(nextMeaningfulChar);

    const exactCompleteMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}(artist(?::|：))?[^:：]+(?::|：){1,2})$/);
    const afterCompleteMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}(artist(?::|：))?[^:：]+(?::|：){2})(.+)$/);
    if (exactCompleteMatch) {
      isAfterComplete = false;
      replaceTail = true;
    } else if (afterCompleteMatch) {
      start = afterCompleteMatch[1].length;
      isAfterComplete = true;
      replaceTail = true;
    } else {
      const multiTagMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}.*[,，|])/);
      if (multiTagMatch) {
        start = multiTagMatch[1].length;
        isMultiTagFormat = true;
        replaceTail = true;
      } else {
        const plainQueryMatch = getPlainQueryMatch(currentSegment);
        if (plainQueryMatch) {
          start = plainQueryMatch[1].length;
        }
      }
    }

    const currentWeight = currentWeightMatch ? parseFloat(currentWeightMatch[1]) : NaN;
    const shouldRewriteWeightedSegment =
      currentWeightMatch &&
      Number.isFinite(currentWeight) &&
      Math.abs(weight - currentWeight) > 0.0001 &&
      !isAfterComplete &&
      !isMultiTagFormat;
    if (shouldRewriteWeightedSegment) {
      const replacementRange = createWeightPrefixRange(context, currentWeightMatch[1].length);
      if (!replacementRange) return;

      sel.removeAllRanges();
      sel.addRange(replacementRange);
      document.execCommand('insertText', false, weight.toFixed(1));
      hideAutocomplete();
      return;
    }

    const replacementRange = createRangeForCurrentTextSegment(context, start, replaceTail, {
      preferScope: false,
    });
    if (!replacementRange) return;

    sel.removeAllRanges();
    sel.addRange(replacementRange);

    let tagName = tag.tag;
    if (settings.convertSlashToSpace) {
      tagName = tagName.replace(/_/g, ' ');
    } else {
      tagName = tagName.replace(/ /g, '_');
    }

    const useArtist = tag.category === '1' && tag.useArtistPrefix;
    const commaSuffix = shouldAppendComma ? ', ' : '';
    const existingPrefix = currentSegment.slice(0, start);
    const hasExplicitArtistPrefix = /artist(?::|：)$/i.test(existingPrefix);
    const hasExplicitWeightedPrefix = /-?\d+\.?\d*(?::|：){2}(artist(?::|：))?$/i.test(existingPrefix);

    let output;
    if (isAfterComplete || isMultiTagFormat) {
      output = `${tagName}${preservedSuffix}${shouldAppendComma ? ',' : ''}`;
    } else if (hasExplicitWeightedPrefix) {
      output = `${tagName}::${preservedSuffix}${commaSuffix}`;
    } else if (hasExplicitArtistPrefix) {
      output = `${tagName}${preservedSuffix}${commaSuffix}`;
    } else if (weight !== 1.0) {
      const weightStr = weight.toFixed(1);
      output = useArtist
        ? `${weightStr}::artist:${tagName}::${preservedSuffix}${commaSuffix}`
        : `${weightStr}::${tagName}::${preservedSuffix}${commaSuffix}`;
    } else {
      output = useArtist
        ? `artist:${tagName}${preservedSuffix}${commaSuffix}`
        : `${tagName}${preservedSuffix}${commaSuffix}`;
    }

    document.execCommand('insertText', false, output);
    hideAutocomplete();
  }

  // 防抖
  function debounce(fn, delay) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
  }

  const handleInput = debounce(editor => {
    if (isOfficialPromptChunkQuery()) {
      hideAutocomplete();
      return;
    }

    const word = getCurrentWord();
    if (word.length >= CONFIG.MIN_QUERY_LENGTH) {
      const results = searchTags(word);
      if (results.length || isLoading) showAutocomplete(editor, results, word);
      else hideAutocomplete();
    } else hideAutocomplete();
  }, CONFIG.DEBOUNCE_DELAY);

  function refreshAutocomplete(editor) {
    if (isOfficialPromptChunkQuery()) {
      hideAutocomplete();
      return;
    }

    handleInput(editor);
  }

  function handleKeyDown(e) {
    if (!autocompleteContainer?.classList.contains('visible')) return;
    if (isOfficialPromptChunkQuery()) {
      hideAutocomplete();
      return;
    }

    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1); updateSelection(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); updateSelection(); }
    else if (e.key === 'Tab' || e.key === 'Enter') { if (currentResults[selectedIndex]) { e.preventDefault(); applyAutocompleteResult(currentResults[selectedIndex]); } }
    else if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); }
  }

  function ensurePromptBlockModel(editor, options = {}) {
    if (!editor) return [];
    const shouldRender = options.render !== false;
    loadPromptBlockState(editor);
    const text = getEditorText(editor);
    const tokens = parsePromptTokens(text);
    const tags = tokens.map(token => token.tag);
    const signature = tags.map(tag => normalizeTagValue(tag)).join('\n');

    if (!signature) {
      promptBlocks = [];
      promptBlockSignature = '';
      savePromptBlockState(editor);
      if (shouldRender) renderPromptBlockPanel(editor);
      return promptBlocks;
    }

    if (signature !== promptBlockSignature || !hasCompletePromptBlockDelimiters(promptBlocks)) {
      promptBlocks = rebuildPromptBlocksFromTokens(tokens);
      promptBlockSignature = signature;
      savePromptBlockState(editor);
    }

    if (shouldRender) renderPromptBlockPanel(editor);
    return promptBlocks;
  }

  function createPromptBlockPanel() {
    if (promptBlockPanel) return promptBlockPanel;
    const panel = document.createElement('div');
    panel.className = 'nai-prompt-block-panel nai-hidden';

    panel.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (!activeEditor) return;
      ensurePromptBlockModel(activeEditor);

      const blockId = target.closest('[data-block-id]')?.dataset.blockId;
      const blockIndex = promptBlocks.findIndex(block => block.id === blockId);

      if (blockIndex === -1) return;

      if (target.dataset.action === 'toggle-lock') {
        pushPromptBlockHistory(activeEditor);
        promptBlocks[blockIndex] = {
          ...promptBlocks[blockIndex],
          locked: !promptBlocks[blockIndex].locked,
        };
        savePromptBlockState(activeEditor);
        renderPromptBlockPanel(activeEditor);
        return;
      }

      if (target.dataset.action === 'remove-block' && promptBlocks[blockIndex].isGroup) {
        pushPromptBlockHistory(activeEditor);
        const singles = promptBlocks[blockIndex].tags.map((tag, index) => ({
          id: createId('tag'),
          tags: [tag],
          delimiters: [promptBlocks[blockIndex].delimiters?.[index] || ''],
          locked: false,
          isGroup: false,
        }));
        promptBlocks.splice(blockIndex, 1, ...singles);
        commitPromptBlocks(activeEditor);
        return;
      }

      if (target.dataset.action === 'save-library' && promptBlocks[blockIndex].isGroup) {
        openPromptLibraryDialog(promptBlocks[blockIndex].id);
      }
    });

    panel.addEventListener('dragstart', (event) => {
      const item = event.target.closest('.nai-prompt-block-drag-hitbox[data-block-id]');
      if (!item) return;
      if (!isPromptBlockDragMode) {
        event.preventDefault();
        return;
      }
      const block = promptBlocks.find(entry => entry.id === item.dataset.blockId);
      if (!block || block.locked) {
        event.preventDefault();
        return;
      }
      promptBlockDragId = block.id;
      item.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', block.id);
      }
    });

    panel.addEventListener('dragend', (event) => {
      promptBlockDragId = null;
      event.target.closest('.nai-prompt-block-drag-hitbox')?.classList.remove('is-dragging');
      hidePromptBlockDropIndicator();
      setPromptBlockDragMode(false);
    });

    document.body.appendChild(panel);
    promptBlockPanel = panel;
    return panel;
  }

  function createPromptBlockDropIndicator() {
    if (promptBlockDropIndicator) return promptBlockDropIndicator;
    const indicator = document.createElement('div');
    indicator.className = 'nai-prompt-block-drop-indicator nai-hidden';
    document.body.appendChild(indicator);
    promptBlockDropIndicator = indicator;
    return indicator;
  }

  function createPromptLibraryDialog() {
    if (promptLibraryDialog) return promptLibraryDialog;
    const dialog = document.createElement('div');
    dialog.className = 'nai-prompt-library-dialog nai-hidden';
    dialog.innerHTML = `
      <div class="nai-prompt-library-backdrop" data-action="close-library-dialog"></div>
      <div class="nai-prompt-library-card" role="dialog" aria-modal="true" aria-label="保存词库">
        <div class="nai-prompt-library-head">
          <div class="nai-prompt-library-title">保存到词库</div>
          <div class="nai-prompt-library-note">保存为本地词库条目，并尝试同步到官方 Prompt Chunk</div>
        </div>
        <div class="nai-prompt-library-grid">
          <label class="nai-prompt-library-field">
            <span>预设分类</span>
            <select data-field="preset-category">
              ${PRESET_PROMPT_LIBRARY_CATEGORIES.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}
              <option value="custom">自定义</option>
            </select>
          </label>
          <label class="nai-prompt-library-field nai-hidden" data-custom-category-wrap>
            <span>自定义分类</span>
            <input data-field="custom-category" type="text" placeholder="例如 role_alt" />
          </label>
          <label class="nai-prompt-library-field">
            <span>名称</span>
            <input data-field="entry-name" type="text" placeholder="例如 yuukarin" />
          </label>
        </div>
        <div class="nai-prompt-library-preview" data-field="alias-preview">char:yuukarin</div>
        <div class="nai-prompt-library-error nai-hidden" data-field="alias-error"></div>
        <div class="nai-prompt-library-actions">
          <button type="button" data-action="close-library-dialog">取消</button>
          <button type="button" class="is-primary" data-action="confirm-library-save">保存</button>
        </div>
      </div>
    `;

    dialog.addEventListener('click', async (event) => {
      const actionTarget = event.target.closest('[data-action]');
      if (!actionTarget) return;
      const action = actionTarget.getAttribute('data-action');
      if (action === 'close-library-dialog') {
        closePromptLibraryDialog();
      } else if (action === 'confirm-library-save') {
        await savePromptLibraryFromDialog();
      }
    });

    dialog.querySelector('[data-field="preset-category"]')?.addEventListener('change', updatePromptLibraryDialogPreview);
    dialog.querySelector('[data-field="custom-category"]')?.addEventListener('input', updatePromptLibraryDialogPreview);
    dialog.querySelector('[data-field="entry-name"]')?.addEventListener('input', updatePromptLibraryDialogPreview);
    dialog.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePromptLibraryDialog();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        await savePromptLibraryFromDialog();
      }
    });

    document.body.appendChild(dialog);
    promptLibraryDialog = dialog;
    return dialog;
  }

  function getPromptLibraryDialogAlias() {
    const dialog = createPromptLibraryDialog();
    const presetValue = dialog.querySelector('[data-field="preset-category"]')?.value || 'char';
    const customValue = dialog.querySelector('[data-field="custom-category"]')?.value || '';
    const nameValue = dialog.querySelector('[data-field="entry-name"]')?.value || '';
    const category = presetValue === 'custom' ? customValue : presetValue;
    const normalizedCategory = normalizePromptLibraryCategory(category);
    const normalizedName = normalizePromptLibraryName(nameValue);
    return {
      alias: normalizePromptLibraryAlias(`${category}:${nameValue}`, category),
      normalizedCategory,
      normalizedName,
      hasCategory: Boolean(String(category || '').trim()),
      hasName: Boolean(String(nameValue || '').trim()),
    };
  }

  function updatePromptLibraryDialogPreview() {
    const dialog = createPromptLibraryDialog();
    const presetValue = dialog.querySelector('[data-field="preset-category"]')?.value || 'char';
    const customWrap = dialog.querySelector('[data-custom-category-wrap]');
    if (customWrap) {
      customWrap.classList.toggle('nai-hidden', presetValue !== 'custom');
    }
    const preview = dialog.querySelector('[data-field="alias-preview"]');
    const error = dialog.querySelector('[data-field="alias-error"]');
    const submit = dialog.querySelector('[data-action="confirm-library-save"]');
    const draft = getPromptLibraryDialogAlias();
    let errorText = '';

    if (presetValue === 'custom' && !draft.hasCategory) {
      errorText = '请先填写自定义分类。';
    } else if (!draft.normalizedCategory) {
      errorText = '分类仅支持字母、数字、下划线、短横线或常见文字。';
    } else if (!draft.hasName) {
      errorText = '请先填写名称。';
    } else if (!draft.normalizedName) {
      errorText = '名称仅支持字母、数字、下划线、短横线或常见文字。';
    }

    if (preview) {
      preview.textContent = draft.alias || '分类:名称';
    }
    if (error) {
      error.textContent = errorText;
      error.classList.toggle('nai-hidden', !errorText);
    }
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = Boolean(errorText);
    }
  }

  function setPromptLibraryDialogError(message) {
    const dialog = createPromptLibraryDialog();
    const error = dialog.querySelector('[data-field="alias-error"]');
    if (!error) return;
    error.textContent = String(message || '').trim();
    error.classList.toggle('nai-hidden', !error.textContent);
  }

  function openPromptLibraryDialog(blockId) {
    const block = promptBlocks.find((entry) => entry.id === blockId && entry.isGroup);
    if (!block) return;
    const dialog = createPromptLibraryDialog();
    const existing = splitPromptLibraryAlias(block.libraryAlias || '');
    const presetField = dialog.querySelector('[data-field="preset-category"]');
    const customField = dialog.querySelector('[data-field="custom-category"]');
    const nameField = dialog.querySelector('[data-field="entry-name"]');
    const isPreset = PRESET_PROMPT_LIBRARY_CATEGORIES.some((item) => item.id === existing.category);

    promptLibraryDialogState.blockId = blockId;
    promptLibraryDialogState.mode = 'block';
    promptLibraryDialogState.selection = null;
    if (presetField) presetField.value = block.libraryAlias ? (isPreset ? existing.category : 'custom') : 'char';
    if (customField) customField.value = block.libraryAlias && !isPreset ? existing.category : '';
    if (nameField) nameField.value = block.libraryAlias ? existing.name : getLibraryDefaultName(block);
    updatePromptLibraryDialogPreview();
    dialog.classList.remove('nai-hidden');
    requestAnimationFrame(() => {
      (nameField || customField)?.focus();
      (nameField || customField)?.select?.();
    });
  }

  function openPromptLibraryDialogForSelection() {
    if (!activeEditor) return;
    const context = getPromptSelectionContext(activeEditor);
    if (!context) return;

    const dialog = createPromptLibraryDialog();
    const presetField = dialog.querySelector('[data-field="preset-category"]');
    const customField = dialog.querySelector('[data-field="custom-category"]');
    const nameField = dialog.querySelector('[data-field="entry-name"]');
    const defaultName = normalizePromptLibraryName(context.selectedTags[0] || 'chunk') || 'chunk';

    promptLibraryDialogState = {
      blockId: '',
      mode: 'selection',
      selection: context,
    };

    if (presetField) presetField.value = 'char';
    if (customField) customField.value = '';
    if (nameField) nameField.value = defaultName;
    updatePromptLibraryDialogPreview();
    dialog.classList.remove('nai-hidden');
    hidePromptBlockToolbar();
    requestAnimationFrame(() => {
      nameField?.focus();
      nameField?.select?.();
    });
  }

  function closePromptLibraryDialog() {
    if (!promptLibraryDialog) return;
    promptLibraryDialog.classList.add('nai-hidden');
    promptLibraryDialogState = { blockId: '', mode: 'block', selection: null };
  }

  async function savePromptLibraryFromDialog() {
    if (!activeEditor) return;
    if (promptLibraryDialogState.mode === 'selection') {
      await savePromptLibrarySelectionFromDialog();
      return;
    }
    if (!promptLibraryDialogState.blockId) return;
    ensurePromptBlockModel(activeEditor);
    const blockIndex = promptBlocks.findIndex((entry) => entry.id === promptLibraryDialogState.blockId && entry.isGroup);
    if (blockIndex === -1) {
      closePromptLibraryDialog();
      return;
    }

    const draft = getPromptLibraryDialogAlias();
    if (!draft.alias || !draft.normalizedCategory || !draft.normalizedName) {
      updatePromptLibraryDialogPreview();
      return;
    }

    const block = promptBlocks[blockIndex];
    const nextEntry = normalizePromptLibraryEntry({
      id: block.libraryId || createId('library'),
      alias: draft.alias,
      category: draft.normalizedCategory,
      name: draft.normalizedName,
      tags: block.tags,
      delimiters: block.delimiters,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (!nextEntry) return;

    const existingIndex = promptLibrary.findIndex((entry) => entry.alias === draft.alias || entry.id === nextEntry.id);
    const nextLibrary = [...promptLibrary];
    if (existingIndex >= 0) {
      nextEntry.createdAt = promptLibrary[existingIndex].createdAt || nextEntry.createdAt;
      nextLibrary.splice(existingIndex, 1, nextEntry);
    } else {
      nextLibrary.unshift(nextEntry);
    }

    try {
      await savePromptLibrary(nextLibrary);
    } catch (error) {
      setPromptLibraryDialogError(getPromptLibraryStorageError(error));
      return;
    }

    promptBlocks[blockIndex] = {
      ...promptBlocks[blockIndex],
      libraryId: nextEntry.id,
      libraryAlias: nextEntry.alias,
      libraryCategory: nextEntry.category,
    };
    savePromptBlockState(activeEditor);
    renderPromptBlockPanel(activeEditor);
    closePromptLibraryDialog();

    syncPromptLibraryEntryToOfficialChunk(nextEntry)
      .then(result => {
        if (result?.ok) {
          patchPromptLibraryOfficialSyncResult(nextEntry.id, result);
          console.log('[NAI-AC] 已同步到官方 Prompt Chunk:', nextEntry.alias, result.remoteId || result.id);
        } else if (result?.error) {
          console.warn('[NAI-AC] 官方 Prompt Chunk 同步失败，本地词库已保留:', result.error);
        }
      })
      .catch(error => {
        console.warn('[NAI-AC] 官方 Prompt Chunk 同步失败，本地词库已保留:', error);
      });

    try {
      chrome.runtime?.sendMessage?.({ type: 'nai-prompt-library-updated' });
    } catch (error) {}
  }

  async function savePromptLibrarySelectionFromDialog() {
    const selection = promptLibraryDialogState.selection;
    if (!activeEditor || !selection) return;

    const draft = getPromptLibraryDialogAlias();
    if (!draft.alias || !draft.normalizedCategory || !draft.normalizedName) {
      updatePromptLibraryDialogPreview();
      return;
    }

    const tokens = parsePromptTokens(selection.selectedText);
    const tags = tokens.map(token => token.tag);
    const delimiters = tokens.map(token => token.delimiter);
    if (!tags.length) {
      setPromptLibraryDialogError('选区里没有可保存的提示词。');
      return;
    }

    const nextEntry = normalizePromptLibraryEntry({
      id: createId('library'),
      alias: draft.alias,
      category: draft.normalizedCategory,
      name: draft.normalizedName,
      tags,
      delimiters,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (!nextEntry) return;

    const existingIndex = promptLibrary.findIndex((entry) => entry.alias === draft.alias);
    const nextLibrary = [...promptLibrary];
    if (existingIndex >= 0) {
      nextEntry.id = promptLibrary[existingIndex].id || nextEntry.id;
      nextEntry.createdAt = promptLibrary[existingIndex].createdAt || nextEntry.createdAt;
      nextLibrary.splice(existingIndex, 1, nextEntry);
    } else {
      nextLibrary.unshift(nextEntry);
    }

    try {
      await savePromptLibrary(nextLibrary);
    } catch (error) {
      setPromptLibraryDialogError(getPromptLibraryStorageError(error));
      return;
    }

    closePromptLibraryDialog();

    syncPromptLibraryEntryToOfficialChunk(nextEntry)
      .then(result => {
        if (result?.ok) {
          patchPromptLibraryOfficialSyncResult(nextEntry.id, result);
          console.log('[NAI-AC] 已同步到官方 Prompt Chunk:', nextEntry.alias, result.remoteId || result.id);
        } else if (result?.error) {
          console.warn('[NAI-AC] 官方 Prompt Chunk 同步失败，本地词库已保留:', result.error);
        }
      })
      .catch(error => {
        console.warn('[NAI-AC] 官方 Prompt Chunk 同步失败，本地词库已保留:', error);
      });

    try {
      chrome.runtime?.sendMessage?.({ type: 'nai-prompt-library-updated' });
    } catch (error) {}
  }

  function hidePromptBlockDropIndicator() {
    if (!promptBlockDropIndicator) return;
    promptBlockDropIndicator.classList.add('nai-hidden');
  }

  function setPromptBlockDragMode(enabled) {
    isPromptBlockDragMode = enabled;
    document.documentElement.classList.toggle('nai-block-drag-mode', enabled);
  }

  function createPromptBlockToolbar() {
    if (promptBlockToolbar) return promptBlockToolbar;
    const toolbar = document.createElement('div');
    toolbar.className = 'nai-prompt-block-toolbar nai-hidden';
    toolbar.innerHTML = `<button type="button" data-action="save-selection-library" title="保存到词库" aria-label="保存到词库">${getPromptBlockIcon('save')}</button>`;
    toolbar.querySelector('button').addEventListener('click', () => openPromptLibraryDialogForSelection());
    document.body.appendChild(toolbar);
    promptBlockToolbar = toolbar;
    return toolbar;
  }

  function positionPromptBlockPanel(editor) {
    if (!promptBlockPanel || !editor) return;
    promptBlockPanel.style.top = '0px';
    promptBlockPanel.style.left = '0px';
  }

  function getPromptBlockVisuals(editor) {
    const tokens = parsePromptTokens(getEditorText(editor));

    return promptBlocks.filter(block => block.isGroup).map((block, index) => {
      const label = block.tags.join(', ');
      const startTokenIndex = promptBlocks
        .slice(0, promptBlocks.findIndex(entry => entry.id === block.id))
        .reduce((sum, entry) => sum + entry.tags.length, 0);
      const startOffset = getTextOffsetForTokenIndex(tokens, startTokenIndex);
      const endOffset = startOffset + block.tags.reduce((sum, tag, tagIndex) => (
        sum + tag.length + (block.delimiters?.[tagIndex] || '').length
      ), 0) - ((block.delimiters?.[block.tags.length - 1] || '').length);

      const range = createRangeFromTextOffsets(editor, startOffset, endOffset);
      if (!range) return null;

      const rects = Array.from(range.getClientRects())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }));

      if (!rects.length) {
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rects.push({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      }

      if (!rects.length) return null;

      const firstRect = rects[0];
      const unionRect = rects.reduce((acc, rect) => ({
        left: Math.min(acc.left, rect.left),
        top: Math.min(acc.top, rect.top),
        right: Math.max(acc.right, rect.left + rect.width),
        bottom: Math.max(acc.bottom, rect.top + rect.height),
      }), {
        left: firstRect.left,
        top: firstRect.top,
        right: firstRect.left + firstRect.width,
        bottom: firstRect.top + firstRect.height,
      });
      return {
        id: block.id,
        label,
        locked: block.locked,
        accent: PROMPT_BLOCK_COLORS[index % PROMPT_BLOCK_COLORS.length],
        rects,
        unionRect: {
          left: unionRect.left,
          top: unionRect.top,
          width: unionRect.right - unionRect.left,
          height: unionRect.bottom - unionRect.top,
        },
        anchorLeft: Math.min(window.innerWidth - 34, Math.max(6, unionRect.right + 4)),
        anchorTop: Math.max(6, firstRect.top - 6),
      };
    }).filter(Boolean);
  }

  function renderPromptBlockPanel(editor) {
    const panel = createPromptBlockPanel();
    if (!editor) {
      panel.classList.add('nai-hidden');
      panel.innerHTML = '';
      return;
    }

    positionPromptBlockPanel(editor);
    if (!promptBlocks.length) {
      panel.classList.add('nai-hidden');
      panel.innerHTML = '';
      return;
    }

    const visuals = getPromptBlockVisuals(editor);
    if (!visuals.length) {
      panel.classList.add('nai-hidden');
      panel.innerHTML = '';
      return;
    }

    panel.innerHTML = visuals.map(block => `
      ${block.rects.map(rect => `
        <div
          class="nai-prompt-block-highlight ${block.locked ? 'is-locked' : ''}"
          style="--nai-block-accent: ${block.accent}; left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px;"
        ></div>
      `).join('')}
      <div
        class="nai-prompt-block-drag-hitbox ${block.locked ? 'is-locked' : ''}"
        data-block-id="${block.id}"
        draggable="${block.locked ? 'false' : 'true'}"
        title="${escapeHtml(block.label)}"
        style="--nai-block-accent: ${block.accent}; left: ${block.unionRect.left}px; top: ${block.unionRect.top}px; width: ${block.unionRect.width}px; height: ${block.unionRect.height}px;"
      ></div>
      <div
        class="nai-prompt-block-anchor"
        data-block-id="${block.id}"
        style="--nai-block-accent: ${block.accent}; left: ${block.anchorLeft}px; top: ${block.anchorTop}px;"
      >
        <button
          type="button"
          class="nai-prompt-block-save"
          data-action="save-library"
          title="${block.libraryAlias ? `更新词库：${escapeHtml(block.libraryAlias)}` : '保存到词库'}"
          aria-label="${block.libraryAlias ? `更新词库：${escapeHtml(block.libraryAlias)}` : '保存到词库'}"
        >${getPromptBlockIcon('save')}</button>
        <button
          type="button"
          class="nai-prompt-block-remove"
          data-action="remove-block"
          title="取消区块"
          aria-label="取消区块"
        >${getPromptBlockIcon('remove')}</button>
        <button
          type="button"
          class="nai-prompt-block-lock"
          data-action="toggle-lock"
          title="${block.locked ? '解锁区块' : '锁定区块'}"
          aria-label="${block.locked ? '解锁区块' : '锁定区块'}"
        >${getPromptBlockIcon(block.locked ? 'unlock' : 'lock')}</button>
      </div>
    `).join('');

    panel.classList.remove('nai-hidden');
  }

  function renderPromptBlockPanelSoon(editor, updateToolbar = false) {
    if (!editor) return;
    pendingPromptBlockRenderEditor = editor;
    pendingPromptBlockToolbarUpdate = pendingPromptBlockToolbarUpdate || updateToolbar;
    if (promptBlockRenderFrame) return;

    promptBlockRenderFrame = requestAnimationFrame(() => {
      promptBlockRenderFrame = 0;
      const nextEditor = pendingPromptBlockRenderEditor;
      const shouldUpdateToolbar = pendingPromptBlockToolbarUpdate;
      pendingPromptBlockRenderEditor = null;
      pendingPromptBlockToolbarUpdate = false;

      if (!nextEditor?.isConnected || nextEditor !== activeEditor) return;
      renderPromptBlockPanel(nextEditor);
      if (shouldUpdateToolbar) updatePromptBlockToolbar(nextEditor);
    });
  }

  function commitPromptBlocks(editor) {
    if (!editor) return;
    const text = serializePromptBlocks(promptBlocks);
    promptBlockSignature = flattenPromptBlocks(promptBlocks).join('\n');
    savePromptBlockState(editor);
    replaceEditorText(editor, text);
    renderPromptBlockPanel(editor);
    handleInput(editor);
  }

  function hidePromptBlockToolbar() {
    if (!promptBlockToolbar) return;
    promptBlockToolbar.classList.add('nai-hidden');
  }

  function getPromptSelectionContext(editor) {
    const sel = window.getSelection();
    if (!editor || !sel?.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const editorRange = document.createRange();
    editorRange.selectNodeContents(editor);
    if (
      range.compareBoundaryPoints(Range.START_TO_START, editorRange) < 0 ||
      range.compareBoundaryPoints(Range.END_TO_END, editorRange) > 0
    ) {
      return null;
    }

    const selectedText = range.toString();
    const selectedTags = splitPromptTags(selectedText);
    if (!selectedTags.length) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const startTokenIndex = splitPromptTags(beforeRange.toString()).length;
    const rect = range.getBoundingClientRect();

    return {
      startTokenIndex,
      endTokenIndex: startTokenIndex + selectedTags.length - 1,
      selectedTags,
      selectedText,
      range: range.cloneRange(),
      rect,
    };
  }

  function updatePromptBlockToolbar(editor) {
    const toolbar = createPromptBlockToolbar();
    const context = getPromptSelectionContext(editor);
    if (!context || !context.selectedTags.length) {
      hidePromptBlockToolbar();
      return;
    }

    const width = toolbar.offsetWidth || 120;
    const top = context.rect.top - 44 >= 8 ? context.rect.top - 44 : context.rect.bottom + 8;
    const left = Math.min(Math.max(8, context.rect.left), window.innerWidth - width - 8);
    toolbar.style.top = `${Math.max(8, top)}px`;
    toolbar.style.left = `${left}px`;
    toolbar.classList.remove('nai-hidden');
  }

  function groupPromptSelection() {
    if (!activeEditor) return;
    ensurePromptBlockModel(activeEditor);
    const context = getPromptSelectionContext(activeEditor);
    if (!context) return;

    let cursor = 0;
    const before = [];
    const groupedTags = [];
    const groupedDelimiters = [];
    const after = [];
    let blocked = false;

    promptBlocks.forEach(block => {
      const blockStart = cursor;
      const blockEnd = cursor + block.tags.length - 1;

      if (blockEnd < context.startTokenIndex) {
        before.push(block);
      } else if (blockStart > context.endTokenIndex) {
        after.push(block);
      } else {
        if (block.locked) blocked = true;
        const startOffset = Math.max(0, context.startTokenIndex - blockStart);
        const endOffset = Math.min(block.tags.length - 1, context.endTokenIndex - blockStart);
        const beforeTags = block.tags.slice(0, startOffset);
        const beforeDelimiters = (block.delimiters || []).slice(0, startOffset);
        const selectedTags = block.tags.slice(startOffset, endOffset + 1);
        const selectedDelimiters = (block.delimiters || []).slice(startOffset, endOffset + 1);
        const afterTags = block.tags.slice(endOffset + 1);
        const afterDelimiters = (block.delimiters || []).slice(endOffset + 1);

        if (beforeTags.length) {
          before.push({ id: createId('tag'), tags: beforeTags, delimiters: beforeDelimiters, locked: false, isGroup: false });
        }
        groupedTags.push(...selectedTags);
        groupedDelimiters.push(...selectedDelimiters);
        if (afterTags.length) {
          after.push({ id: createId('tag'), tags: afterTags, delimiters: afterDelimiters, locked: false, isGroup: false });
        }
      }

      cursor += block.tags.length;
    });

    if (blocked || groupedTags.length <= 1) {
      hidePromptBlockToolbar();
      return;
    }

    pushPromptBlockHistory(activeEditor);
    promptBlocks = [
      ...before,
      { id: createId('block'), tags: groupedTags, delimiters: groupedDelimiters, locked: false, isGroup: true },
      ...after,
    ];
    hidePromptBlockToolbar();
    commitPromptBlocks(activeEditor);
  }

  function getTokenIndexFromPoint(editor, clientX, clientY) {
    if (!editor) return 0;

    const pointTarget = document.elementFromPoint(clientX, clientY);
    if (!pointTarget?.closest('.ProseMirror')) {
      return splitPromptTags(getEditorText(editor)).length;
    }

    let caretRange = null;
    if (document.caretRangeFromPoint) {
      caretRange = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        caretRange = document.createRange();
        caretRange.setStart(position.offsetNode, position.offset);
        caretRange.collapse(true);
      }
    }

    if (!caretRange) {
      return splitPromptTags(getEditorText(editor)).length;
    }

    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(caretRange.startContainer, caretRange.startOffset);
    return splitPromptTags(beforeRange.toString()).length;
  }

  function showPromptBlockDropIndicator(editor, tokenIndex) {
    const indicator = createPromptBlockDropIndicator();
    const tokens = parsePromptTokens(getEditorText(editor));
    const offset = getTextOffsetForTokenIndex(tokens, Math.max(0, Math.min(tokenIndex, tokens.length)));
    const range = createRangeFromTextOffsets(editor, offset, offset);
    const fallbackRect = editor.getBoundingClientRect();
    const rect = range?.getBoundingClientRect?.() || fallbackRect;
    const left = Math.max(6, Math.min(window.innerWidth - 6, rect.left || fallbackRect.left));
    const top = (rect.top && rect.height) ? rect.top : fallbackRect.top;
    const height = Math.max(18, rect.height || 24);

    indicator.style.left = `${left}px`;
    indicator.style.top = `${top}px`;
    indicator.style.height = `${height}px`;
    indicator.classList.remove('nai-hidden');
  }

  function movePromptBlockToToken(sourceId, tokenIndex) {
    if (!activeEditor) return;
    const fromIndex = promptBlocks.findIndex(block => block.id === sourceId);
    if (fromIndex === -1 || promptBlocks[fromIndex].locked || !promptBlocks[fromIndex].isGroup) return;

    const sourceStartToken = promptBlocks
      .slice(0, fromIndex)
      .reduce((sum, block) => sum + block.tags.length, 0);

    pushPromptBlockHistory(activeEditor);
    const [block] = promptBlocks.splice(fromIndex, 1);
    let insertIndex = promptBlocks.length;
    let cursor = 0;

    for (let i = 0; i < promptBlocks.length; i++) {
      if (tokenIndex <= cursor) {
        insertIndex = i;
        break;
      }
      cursor += promptBlocks[i].tags.length;
      if (tokenIndex < cursor) {
        insertIndex = i + 1;
        break;
      }
    }

    const targetStartToken = promptBlocks
      .slice(0, insertIndex)
      .reduce((sum, entry) => sum + entry.tags.length, 0);

    const rangeStart = Math.min(sourceStartToken, targetStartToken);
    const rangeEnd = Math.max(sourceStartToken + block.tags.length - 1, targetStartToken);
    const crossesLocked = promptBlocks.some((entry, index) => {
      const entryStart = promptBlocks.slice(0, index).reduce((sum, item) => sum + item.tags.length, 0);
      const entryEnd = entryStart + entry.tags.length - 1;
      return entry.locked && entryStart <= rangeEnd && entryEnd >= rangeStart;
    });

    if (crossesLocked) {
      promptBlocks.splice(fromIndex, 0, block);
      const history = getPromptBlockHistory(activeEditor);
      history.pop();
      return;
    }

    promptBlocks.splice(insertIndex, 0, block);
    commitPromptBlocks(activeEditor);
  }

  async function init() {
    document.documentElement.dataset.naiAcVersion = CONTENT_SCRIPT_VERSION;
    console.log(`[NAI-AC] 扩展已加载 ${CONTENT_SCRIPT_VERSION}`);

    try {
      const saved = localStorage.getItem('nai-ac-settings');
      if (saved) Object.assign(settings, JSON.parse(saved));
    } catch (e) {}

    syncThemeFromStorage();
    ensureOfficialChunkBridgeScript();
    await loadPromptLibrary();
    loadTags();

    try {
      chrome?.storage?.onChanged?.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[PROMPT_LIBRARY_KEY]) return;
        promptLibrary = Array.isArray(changes[PROMPT_LIBRARY_KEY].newValue)
          ? changes[PROMPT_LIBRARY_KEY].newValue.map(normalizePromptLibraryEntry).filter(Boolean)
          : [];
      });
    } catch (error) {}

    document.addEventListener('input', e => {
      const editor = e.target.closest('.ProseMirror');
      if (!editor) return;
      activeEditor = editor;
      ensurePromptBlockModel(editor, { render: false });
      renderPromptBlockPanelSoon(editor);
      updatePromptBlockToolbar(editor);
      refreshAutocomplete(editor);
    }, true);

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) {
        hidePromptBlockToolbar();
        if (activeEditor?.isConnected) {
          renderPromptBlockPanelSoon(activeEditor);
        }
        return;
      }

      const node = sel.getRangeAt(0).startContainer;
      const editor = node.nodeType === Node.TEXT_NODE
        ? node.parentElement?.closest('.ProseMirror')
        : node.closest?.('.ProseMirror');

      if (!editor) {
        hidePromptBlockToolbar();
        if (activeEditor?.isConnected) {
          renderPromptBlockPanelSoon(activeEditor);
        }
        return;
      }

      const previousEditor = activeEditor;
      activeEditor = editor;
      if (previousEditor !== editor) {
        ensurePromptBlockModel(editor, { render: false });
      }
      renderPromptBlockPanelSoon(editor);
      updatePromptBlockToolbar(editor);
      refreshAutocomplete(editor);
      scheduleAutocompleteReposition();
    });

    document.addEventListener('scroll', scheduleAutocompleteReposition, true);
    window.addEventListener('scroll', scheduleAutocompleteReposition, true);
    window.addEventListener('resize', scheduleAutocompleteReposition);

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', event => {
      if (event.altKey) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== 'z') return;

      const selection = window.getSelection();
      const editor = activeEditor || (selection?.rangeCount ? getEditorFromRange(selection.getRangeAt(0)) : null);
      if (!editor) return;

      schedulePromptBlockUndoSync(editor);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Alt') {
        setPromptBlockDragMode(true);
      }
    }, true);
    document.addEventListener('keyup', event => {
      if (event.key === 'Alt') {
        setPromptBlockDragMode(false);
      }
    }, true);
    window.addEventListener('blur', () => setPromptBlockDragMode(false));
    document.addEventListener('focusout', () => setTimeout(() => {
      const isAutocompleteInteraction = Date.now() - autocompletePointerDownAt < 350;
      if (!isAutocompleteInteraction && !autocompleteContainer?.contains(document.activeElement)) hideAutocomplete();
      if (!promptBlockPanel?.contains(document.activeElement)) hidePromptBlockToolbar();
    }, 150), true);

    document.addEventListener('dragover', event => {
      if (!promptBlockDragId || !activeEditor) return;
      const editor = document.elementFromPoint(event.clientX, event.clientY)?.closest('.ProseMirror');
      if (editor !== activeEditor) return;
      event.preventDefault();
      showPromptBlockDropIndicator(activeEditor, getTokenIndexFromPoint(activeEditor, event.clientX, event.clientY));
    }, true);

    document.addEventListener('drop', event => {
      if (!promptBlockDragId || !activeEditor) return;
      const editor = document.elementFromPoint(event.clientX, event.clientY)?.closest('.ProseMirror');
      if (editor !== activeEditor) return;
      event.preventDefault();
      const tokenIndex = getTokenIndexFromPoint(activeEditor, event.clientX, event.clientY);
      hidePromptBlockDropIndicator();
      movePromptBlockToToken(promptBlockDragId, tokenIndex);
    }, true);

    window.addEventListener('resize', () => {
      if (!activeEditor) return;
      renderPromptBlockPanelSoon(activeEditor, true);
    });

    document.addEventListener('scroll', () => {
      if (!activeEditor) return;
      renderPromptBlockPanelSoon(activeEditor, true);
      hidePromptBlockDropIndicator();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


