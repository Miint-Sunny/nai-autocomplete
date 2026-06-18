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
