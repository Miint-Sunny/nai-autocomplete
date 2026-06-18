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
