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
