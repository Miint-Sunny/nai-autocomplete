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

  // 不用再往外发消息通知助手面板：词库是写进 chrome.storage.local 的，
  // 助手侧的 storage.onChanged 已经在同步了。
  // 而且 runtime.sendMessage **到不了同一个页面里的别的 content script**（实测过），
  // 这条消息从来没送达过，只留下一个没人收的 lastError。
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

  // 不用再往外发消息通知助手面板：词库是写进 chrome.storage.local 的，
  // 助手侧的 storage.onChanged 已经在同步了。
  // 而且 runtime.sendMessage **到不了同一个页面里的别的 content script**（实测过），
  // 这条消息从来没送达过，只留下一个没人收的 lastError。
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

// 单个 tag 的分类与权重，用的是流编辑器那套两层分类（js/flow/02-classify.js）。
// 原来的着色是六色轮换、按组序号取，颜色不带任何含义。
//
// 必须走 flowParseItem 而不是只剥括号：`1.3::soft lighting::` 是 NAI 的数值权重语法，
// 不解开的话查词典必然落空，整个 tag 会被误标成「词典查不到」。
function describePromptBlockTag(rawTag) {
  const parsed = flowParseItem(String(rawTag || '').trim());
  if (!parsed) return { name: '', weight: 1, semantic: 'other', known: true, zh: '', posts: 0 };

  // 自然语言被逗号切出来的碎片不是 tag，别拿去查词典，更不能标红
  if (parsed.kind === 'sentence') {
    return { name: parsed.raw, weight: parsed.weight ?? 1, semantic: 'other', known: true, zh: '', posts: 0 };
  }

  const item = parsed.kind === 'group' ? parsed.items[0] : parsed;
  const name = String(item?.name || '').replace(/[.。]$/, '').trim();
  const info = flowClassify(name, flowLookupTag(name));
  return {
    name,
    weight: parsed.kind === 'group' ? parsed.weight : (item?.weight ?? 1),
    semantic: info.semantic,
    known: info.known,
    zh: info.zh,
    posts: info.posts,
  };
}

// 来源类（画师/角色/版权/元）用的是 --nai-flow-src-* 那组变量，名字对不上就整条变量失效
const PROMPT_BLOCK_ACCENT_VARS = {
  artist: '--nai-flow-src-artist',
  character: '--nai-flow-src-character',
  copyright: '--nai-flow-src-copyright',
  meta: '--nai-flow-src-meta',
};

function promptBlockAccent(semantic) {
  return `var(${PROMPT_BLOCK_ACCENT_VARS[semantic] || `--nai-flow-${semantic}`})`;
}

function getPromptBlockVisuals(editor) {
  const tokens = parsePromptTokens(getEditorText(editor));

  // 以前只有成组的才画高亮，单个 tag 一律不管。现在每个 tag 都上色，
  // 词典里查不到的单独标出来 —— 那是最该被看见的一类。
  return promptBlocks.map((block, index) => {
    const label = block.tags.join(', ');
    const described = block.tags.map(describePromptBlockTag);
    const lead = described[0] || { semantic: 'other', known: true, weight: 1 };
    const unknown = described.some(item => !item.known);
    const hint = described.length === 1 && lead.known
      ? `${lead.name}${lead.zh ? ` · ${lead.zh}` : ''} · ${flowFormatPosts(lead.posts)} post`
      : label;
    const startTokenIndex = promptBlocks
      .slice(0, index)
      .reduce((sum, entry) => sum + entry.tags.length, 0);
    const endTokenIndex = startTokenIndex + block.tags.length - 1;
    // 模型可能比正文晚一拍（正在输入），对不上就干脆不画，别画到别人身上
    if (!tokens[startTokenIndex] || !tokens[endTokenIndex]) return null;

    const range = createRangeFromEditorTextOffsets(
      editor,
      getTextOffsetForTokenIndex(tokens, startTokenIndex),
      getTextEndOffsetForTokenIndex(tokens, endTokenIndex),
    );
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
      hint,
      locked: block.locked,
      isGroup: Boolean(block.isGroup),
      libraryAlias: block.libraryAlias,
      semantic: lead.semantic,
      unknown,
      accent: promptBlockAccent(lead.semantic),
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

  const uiScale = getPromptEditorUiScale(editor);

  // 下划线是可以关的（设置里那个「TAG 下划线」），但成组的按钮和拖拽热区不受影响 ——
  // 那是功能，不是装饰
  const showHighlights = settings.highlightTags !== false;

  panel.innerHTML = visuals.map(block => `
    ${showHighlights ? block.rects.map(rect => `
      <div
        class="nai-prompt-block-highlight ${block.locked ? 'is-locked' : ''} ${block.isGroup ? 'is-group' : ''} ${block.unknown ? 'is-unknown' : ''}"
        style="--nai-block-accent: ${block.accent}; left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px;"
      ></div>
    `).join('') : ''}
    <div
      class="nai-prompt-block-drag-hitbox ${block.locked ? 'is-locked' : ''}"
      data-block-id="${block.id}"
      draggable="${block.locked ? 'false' : 'true'}"
      title="${escapeHtml(block.hint)}"
      style="--nai-block-accent: ${block.accent}; left: ${block.unionRect.left}px; top: ${block.unionRect.top}px; width: ${block.unionRect.width}px; height: ${block.unionRect.height}px;"
    ></div>
    ${block.isGroup ? `
    <div
      class="nai-prompt-block-anchor"
      data-block-id="${block.id}"
      style="--nai-block-accent: ${block.accent}; left: ${block.anchorLeft}px; top: ${block.anchorTop}px; zoom: ${uiScale};"
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
    </div>` : ''}
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
  clearOverlayUiScale(promptBlockToolbar);
  promptBlockToolbar.classList.add('nai-hidden');
}

function getPromptSelectionContext(editor) {
  if (isPlainTextPromptEditor(editor)) {
    return getTextareaSelectionContext(editor);
  }

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
  if (!safeSetRangeBoundary(beforeRange, 'end', range.startContainer, range.startOffset)) return null;
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

  const uiScale = getPromptEditorUiScale(editor);
  const width = (toolbar.offsetWidth || 120) * uiScale;
  const top = context.rect.top - 44 * uiScale >= 8
    ? context.rect.top - 44 * uiScale
    : context.rect.bottom + 8;
  const left = Math.min(Math.max(8, context.rect.left), window.innerWidth - width - 8);
  toolbar.style.top = `${Math.max(8, top)}px`;
  toolbar.style.left = `${left}px`;
  applyOverlayUiScale(toolbar, uiScale);
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

  if (isPlainTextPromptEditor(editor)) {
    const offset = getTextOffsetBeforeTextareaPoint(editor, clientX, clientY);
    const beforeText = (editor.value || '').slice(0, offset);
    return splitPromptTags(beforeText).length;
  }

  const pointTarget = document.elementFromPoint(clientX, clientY);
  if (!findPromptEditor(pointTarget)) {
    return splitPromptTags(getEditorText(editor)).length;
  }

  let caretRange = null;
  if (document.caretRangeFromPoint) {
    caretRange = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(clientX, clientY);
    if (position) {
      caretRange = document.createRange();
      if (!safeSetRangeBoundary(caretRange, 'start', position.offsetNode, position.offset)) {
        caretRange = null;
      } else {
        caretRange.collapse(true);
      }
    }
  }

  if (!caretRange) {
    return splitPromptTags(getEditorText(editor)).length;
  }

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(editor);
  if (!safeSetRangeBoundary(beforeRange, 'end', caretRange.startContainer, caretRange.startOffset)) {
    return splitPromptTags(getEditorText(editor)).length;
  }
  return splitPromptTags(beforeRange.toString()).length;
}

function showPromptBlockDropIndicator(editor, tokenIndex) {
  const indicator = createPromptBlockDropIndicator();
  const tokens = parsePromptTokens(getEditorText(editor));
  const offset = getTextOffsetForTokenIndex(tokens, Math.max(0, Math.min(tokenIndex, tokens.length)));
  const range = createRangeFromEditorTextOffsets(editor, offset, offset);
  const fallbackRect = editor.getBoundingClientRect();
  const rect = range?.getBoundingClientRect?.() || fallbackRect;
  const left = Math.max(6, Math.min(window.innerWidth - 6, rect.left || fallbackRect.left));
  const top = (rect.top && rect.height) ? rect.top : fallbackRect.top;
  const height = Math.max(18, rect.height || 24);

  indicator.style.left = `${left}px`;
  indicator.style.top = `${top}px`;
  indicator.style.height = `${height}px`;
  applyOverlayUiScale(indicator, getPromptEditorUiScale(editor));
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
