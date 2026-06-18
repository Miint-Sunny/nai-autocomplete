function renderPresetSelector() {
  const select = ui.settings.activePresetId;
  if (!select) return;
  const all = getAllPresets();
  select.innerHTML = all.map((p) =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.builtIn ? '' : ' ✦'}</option>`
  ).join('');
  select.value = state.settings.activePresetId || 'nai-v4';
  const active = getActivePreset();
  const isBuiltIn = active.builtIn;
  const isModifiedBuiltIn = isBuiltIn && state.customPresets.some((p) => p.id === active.id);
  if (ui.settings.presetDeleteBtn) {
    ui.settings.presetDeleteBtn.classList.toggle('nai-hidden', isBuiltIn);
  }
  if (ui.settings.presetResetBtn) {
    ui.settings.presetResetBtn.classList.toggle('nai-hidden', !isModifiedBuiltIn);
  }
}

function renderPresetBlocks() {
  const container = ui.settings.presetBlocksContainer;
  if (!container) return;
  const preset = getActivePreset();
  container.innerHTML = preset.blocks.map((block, idx) => `
    <div class="nai-preset-block" data-block-id="${escapeHtml(block.id)}">
      <span class="nai-preset-block-handle" draggable="true" title="拖动排序">≡</span>
      <input type="checkbox" class="nai-preset-block-enabled" ${block.enabled ? 'checked' : ''} />
      <select class="nai-preset-block-role">
        <option value="system" ${block.role === 'system' ? 'selected' : ''}>system</option>
        <option value="user" ${block.role === 'user' ? 'selected' : ''}>user</option>
        <option value="assistant" ${block.role === 'assistant' ? 'selected' : ''}>assistant</option>
      </select>
      <textarea class="nai-md3-input nai-preset-block-content" rows="3">${escapeHtml(block.content)}</textarea>
      <button type="button" class="nai-preset-block-delete" data-block-idx="${idx}" title="删除">×</button>
    </div>
  `).join('');
}

function readBlocksFromEditor() {
  const container = ui.settings.presetBlocksContainer;
  if (!container) return [];
  return readPresetBlockElements(container);
}

function readWorkbenchBlocksFromEditor() {
  if (!ui.wb?.blocksContainer) return [];
  return readPresetBlockElements(ui.wb.blocksContainer);
}

function readPresetBlockElements(container) {
  return Array.from(container.querySelectorAll('.nai-preset-block')).map((el) => {
    const roleEl = el.querySelector('.nai-preset-block-role');
    const contentEl = el.querySelector('.nai-preset-block-content');
    const enabledEl = el.querySelector('.nai-preset-block-enabled');
    return {
      id: el.dataset.blockId || generateBlockId(),
      role: roleEl?.value || 'user',
      content: contentEl?.value || '',
      enabled: enabledEl ? enabledEl.checked : true,
    };
  });
}

function syncBlocksToPreset() {
  const blocks = readBlocksFromEditor();
  if (blocks.length) persistActivePreset(blocks);
}

function updateRoleSectionVisibility() {
  if (!ui.settings.roleSection) return;
  const preset = getActivePreset();
  const hasRoleVar = preset.blocks.some((b) => b.enabled && b.content.includes('{{role_prompt}}'));
  ui.settings.roleSection.classList.toggle('nai-hidden', !hasRoleVar);
}

function updateBooruTagTypesVisibility() {
  if (ui.settings.booruTagTypesSection) {
    ui.settings.booruTagTypesSection.classList.toggle('nai-hidden', !ui.settings.enableBooruTagContext.checked);
  }
}

function handleDuplicatePreset() {
  const dup = duplicatePreset(state.settings.activePresetId);
  if (!dup) return;
  state.settings.activePresetId = dup.id;
  renderPresetSelector();
  renderPresetBlocks();
  saveCustomPresets();
}

function handleNewPreset() {
  const np = createPreset('自定义预设');
  state.settings.activePresetId = np.id;
  renderPresetSelector();
  renderPresetBlocks();
  saveCustomPresets();
}

function handleDeletePreset() {
  const active = getActivePreset();
  if (active.builtIn) return;
  deletePreset(active.id);
  state.settings.activePresetId = 'nai-v4';
  renderPresetSelector();
  renderPresetBlocks();
  bindBlockDragListeners();
  updateRoleSectionVisibility();
  saveCustomPresets();
}

function handleResetPreset() {
  const active = getActivePreset();
  if (!active.builtIn) return;
  resetPresetToDefault(active.id);
  renderPresetSelector();
  renderPresetBlocks();
  bindBlockDragListeners();
  updateRoleSectionVisibility();
  saveCustomPresets();
}

function handleAddBlock() {
  appendActivePresetBlock('settings');
}

function handleDeleteBlock(idx) {
  syncActivePresetIdFromUI();
  const blocks = readBlocksFromEditor();
  if (blocks.length <= 1) return;
  blocks.splice(idx, 1);
  persistActivePreset(blocks);
  renderPresetEditor('settings');
}

function bindPresetTextareaFocus(container, focusKey) {
  if (!container) return;
  container.querySelectorAll('.nai-preset-block-content').forEach((textarea) => {
    textarea.addEventListener('focus', () => {
      state[focusKey] = textarea;
    });
  });
}

function insertPresetVariable(variable, editor) {
  const container = editor === 'workbench' ? ui.wb?.blocksContainer : ui.settings.presetBlocksContainer;
  const focusKey = editor === 'workbench' ? 'lastWorkbenchPresetTextarea' : 'lastSettingsPresetTextarea';
  if (!container || !variable) return;

  const focused = container.querySelector('.nai-preset-block-content:focus');
  const tracked = state[focusKey];
  const target = focused instanceof HTMLTextAreaElement
    ? focused
    : (tracked instanceof HTMLTextAreaElement && container.contains(tracked)
      ? tracked
      : container.querySelector('.nai-preset-block-content'));

  if (!(target instanceof HTMLTextAreaElement)) return;

  const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
  const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
  target.value = target.value.slice(0, start) + variable + target.value.slice(end);
  const cursor = start + variable.length;
  target.focus();
  target.setSelectionRange(cursor, cursor);
  state[focusKey] = target;
}

function insertVariableAtCursor(variable) {
  insertPresetVariable(variable, 'settings');
}

function bindPresetBlockDragListeners(container, readBlocks, onReordered) {
  if (!container) return;
  let dragSrc = null;

  container.querySelectorAll('.nai-preset-block-handle').forEach((handle) => {
    handle.addEventListener('dragstart', (e) => {
      const block = handle.closest('.nai-preset-block');
      if (!block) return;
      dragSrc = block;
      block.classList.add('nai-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.dataset.blockId || '');
    });
    handle.addEventListener('dragend', () => {
      const block = handle.closest('.nai-preset-block');
      block?.classList.remove('nai-dragging');
      dragSrc = null;
      container.querySelectorAll('.nai-preset-block').forEach((b) => b.classList.remove('nai-drag-over'));
    });
  });

  container.querySelectorAll('.nai-preset-block').forEach((block) => {
    block.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (block !== dragSrc) block.classList.add('nai-drag-over');
    });
    block.addEventListener('dragleave', () => { block.classList.remove('nai-drag-over'); });
    block.addEventListener('drop', (e) => {
      e.preventDefault();
      block.classList.remove('nai-drag-over');
      if (!dragSrc || dragSrc === block) return;
      const blocks = readBlocks();
      if (!blocks.length) return;
      const fromIdx = [...container.children].indexOf(dragSrc);
      const toIdx = [...container.children].indexOf(block);
      const [moved] = blocks.splice(fromIdx, 1);
      blocks.splice(toIdx, 0, moved);
      onReordered(blocks);
    });
  });
}

function bindBlockDragListeners() {
  const container = ui.settings.presetBlocksContainer;
  if (!container) return;
  bindPresetTextareaFocus(container, 'lastSettingsPresetTextarea');
  bindPresetBlockDragListeners(container, readBlocksFromEditor, (blocks) => {
    persistActivePreset(blocks);
    renderPresetBlocks();
    bindBlockDragListeners();
  });

  container.querySelectorAll('.nai-preset-block-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteBlock(Number(btn.dataset.blockIdx));
    });
  });

  container.querySelectorAll('.nai-preset-block-enabled').forEach((cb) => {
    cb.addEventListener('change', () => updateRoleSectionVisibility());
  });
}

function renderWorkbenchPresetSelector() {
  if (!ui.wb?.presetId) return;
  const all = getAllPresets();
  ui.wb.presetId.innerHTML = all.map((p) =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.builtIn ? '' : ' ✦'}</option>`
  ).join('');
  ui.wb.presetId.value = state.settings.activePresetId || 'nai-v4';
  const active = getActivePreset();
  const isBuiltIn = active.builtIn;
  const isModifiedBuiltIn = isBuiltIn && state.customPresets.some((p) => p.id === active.id);
  if (ui.wb.deleteBtn) ui.wb.deleteBtn.classList.toggle('nai-hidden', isBuiltIn);
  if (ui.wb.resetBtn) ui.wb.resetBtn.classList.toggle('nai-hidden', !isModifiedBuiltIn);
}

function renderWorkbenchPresetBlocks() {
  if (!ui.wb?.blocksContainer) return;
  const preset = getActivePreset();
  ui.wb.blocksContainer.innerHTML = preset.blocks.map((block, idx) => `
    <div class="nai-preset-block" data-block-id="${escapeHtml(block.id)}">
      <span class="nai-preset-block-handle" draggable="true" title="拖动排序">≡</span>
      <input type="checkbox" class="nai-preset-block-enabled" ${block.enabled ? 'checked' : ''} />
      <select class="nai-preset-block-role">
        <option value="system" ${block.role === 'system' ? 'selected' : ''}>system</option>
        <option value="user" ${block.role === 'user' ? 'selected' : ''}>user</option>
        <option value="assistant" ${block.role === 'assistant' ? 'selected' : ''}>assistant</option>
      </select>
      <textarea class="nai-md3-input nai-preset-block-content" rows="3">${escapeHtml(block.content)}</textarea>
      <button type="button" class="nai-preset-block-delete" data-block-idx="${idx}" title="删除">×</button>
    </div>
  `).join('');
  if (ui.wb.rolePrompt) ui.wb.rolePrompt.value = state.settings.rolePrompt || '';
}

function syncWorkbenchBlocksToPreset() {
  const blocks = readWorkbenchBlocksFromEditor();
  if (blocks.length) persistActivePreset(blocks);
}

function updateWorkbenchRoleSectionVisibility() {
  if (!ui.wb?.roleSection) return;
  const preset = getActivePreset();
  const hasRoleVar = preset.blocks.some((b) => b.enabled && b.content.includes('{{role_prompt}}'));
  ui.wb.roleSection.classList.toggle('nai-hidden', !hasRoleVar);
}

function insertWorkbenchVariableAtCursor(variable) {
  insertPresetVariable(variable, 'workbench');
}

function bindWorkbenchBlockDragListeners() {
  const container = ui.wb?.blocksContainer;
  if (!container) return;
  bindPresetTextareaFocus(container, 'lastWorkbenchPresetTextarea');
  bindPresetBlockDragListeners(container, readWorkbenchBlocksFromEditor, (blocks) => {
    persistActivePreset(blocks);
    renderWorkbenchPresetBlocks();
    bindWorkbenchBlockDragListeners();
  });

  container.querySelectorAll('.nai-preset-block-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      syncActivePresetIdFromUI();
      const blocks = readWorkbenchBlocksFromEditor();
      if (blocks.length <= 1) return;
      blocks.splice(Number(btn.dataset.blockIdx), 1);
      persistActivePreset(blocks);
      renderPresetEditor('workbench');
    });
  });

  container.querySelectorAll('.nai-preset-block-enabled').forEach((cb) => {
    cb.addEventListener('change', () => updateWorkbenchRoleSectionVisibility());
  });
}

async function saveWorkbenchPresets() {
  if (!ensureExtensionContext()) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }

  syncActivePresetIdFromUI();
  syncWorkbenchBlocksToPreset();
  if (ui.wb?.rolePrompt) state.settings.rolePrompt = ui.wb.rolePrompt.value.trim();

  const settingsSaved = await storageSet({ [SETTINGS_KEY]: state.settings });
  if (!settingsSaved) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }

  const presetsSaved = await saveCustomPresets();
  if (!presetsSaved) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }

  renderWorkbenchPresetSelector();
  renderPresetEditor('workbench');
  renderPresetSelector();
  renderPresetEditor('settings');
  setStatus(T.statusSaved, false);
}

