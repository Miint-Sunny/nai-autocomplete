function upgradePromptSettings(settings) {
  const next = { ...settings };

  next.providerConnections = normalizeProviderConnections(next.providerConnections);
  next.fallbackProviderConnections = normalizeProviderConnections(next.fallbackProviderConnections);

  if (typeof next.showReverseFloatingBall !== 'boolean') {
    next.showReverseFloatingBall = typeof next.showFloatingBall === 'boolean'
      ? next.showFloatingBall
      : DEFAULT_SETTINGS.showReverseFloatingBall;
  }

  if (typeof next.showWorkbenchFloatingBall !== 'boolean') {
    next.showWorkbenchFloatingBall = typeof next.showFloatingBall === 'boolean'
      ? next.showFloatingBall
      : DEFAULT_SETTINGS.showWorkbenchFloatingBall;
  }

  if (!next.systemPrompt || LEGACY_DEFAULT_PROMPTS.systemPrompt.includes(next.systemPrompt)) {
    next.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
  }

  if (!next.reversePrompt || LEGACY_DEFAULT_PROMPTS.reversePrompt.includes(next.reversePrompt)) {
    next.reversePrompt = DEFAULT_SETTINGS.reversePrompt;
  }

  if (!next.roleSystemPrompt || LEGACY_DEFAULT_PROMPTS.roleSystemPrompt.includes(next.roleSystemPrompt)) {
    next.roleSystemPrompt = DEFAULT_SETTINGS.roleSystemPrompt;
  }

  if (!next.roleReversePrompt || LEGACY_DEFAULT_PROMPTS.roleReversePrompt.includes(next.roleReversePrompt)) {
    next.roleReversePrompt = DEFAULT_SETTINGS.roleReversePrompt;
  }

  if (!next.activePresetId) {
    if (next.enableRoleReplaceMode) {
      next.activePresetId = 'role-swap';
    } else {
      next.activePresetId = 'nai-v4';
    }
    next.enableRoleReplace = Boolean(next.enableRoleReplaceMode);

    const hasCustomSystem = next.systemPrompt && next.systemPrompt !== DEFAULT_SETTINGS.systemPrompt;
    const hasCustomReverse = next.reversePrompt && next.reversePrompt !== DEFAULT_SETTINGS.reversePrompt;
    if (hasCustomSystem || hasCustomReverse) {
      next._migrationPreset = {
        id: 'migrated-' + Date.now().toString(36),
        name: '我的预设',
        builtIn: false,
        blocks: [
          { id: 'mig-sys', role: 'system', content: next.systemPrompt, enabled: true },
          { id: 'mig-user', role: 'user', content: next.reversePrompt + '\n\n{{booru_tags}}', enabled: true },
        ],
      };
      next.activePresetId = next._migrationPreset.id;
    }
  }

  if (!next.booruTagTypes) {
    next.booruTagTypes = { ...DEFAULT_BOORU_TAG_TYPES };
  }

  next.providerConnections = rememberProviderConnection(next.providerConnections, next.providerPreset, {
    protocol: next.protocol,
    endpoint: next.endpoint,
    model: next.model,
    apiKey: next.apiKey,
  });
  next.fallbackProviderConnections = rememberProviderConnection(next.fallbackProviderConnections, next.fallbackProviderPreset, {
    protocol: next.fallbackProtocol,
    endpoint: next.fallbackEndpoint,
    model: next.fallbackModel,
    apiKey: next.fallbackApiKey,
  });

  return next;
}

function generateBlockId() {
  return 'blk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function normalizePresetBlock(block) {
  if (!block || typeof block !== 'object') {
    return { id: generateBlockId(), role: 'user', content: '', enabled: true };
  }
  const role = block.role === 'system' || block.role === 'assistant' ? block.role : 'user';
  return {
    id: typeof block.id === 'string' && block.id ? block.id : generateBlockId(),
    role,
    content: typeof block.content === 'string' ? block.content : '',
    enabled: block.enabled !== false,
  };
}

function normalizePreset(preset) {
  if (!preset || typeof preset !== 'object' || typeof preset.id !== 'string' || !preset.id) {
    return null;
  }

  const builtin = BUILTIN_PRESETS.find((p) => p.id === preset.id);
  const rawBlocks = Array.isArray(preset.blocks) && preset.blocks.length
    ? preset.blocks
    : (builtin?.blocks || [
        { id: generateBlockId(), role: 'system', content: DEFAULT_SETTINGS.systemPrompt, enabled: true },
        {
          id: generateBlockId(),
          role: 'user',
          content: `${DEFAULT_SETTINGS.reversePrompt}\n\n{{booru_tags}}`,
          enabled: true,
        },
      ]);

  return {
    id: preset.id,
    name: typeof preset.name === 'string' && preset.name.trim() ? preset.name.trim() : (builtin?.name || '自定义预设'),
    builtIn: builtin ? preset.builtIn !== false : Boolean(preset.builtIn),
    blocks: rawBlocks.map(normalizePresetBlock),
  };
}

function normalizeCustomPresets(presets) {
  if (!Array.isArray(presets)) return [];
  return presets.map(normalizePreset).filter(Boolean);
}

function getAllPresets() {
  const overrides = new Map(normalizeCustomPresets(state.customPresets).map((p) => [p.id, p]));
  const merged = BUILTIN_PRESETS.map((bp) => {
    const override = overrides.get(bp.id);
    if (!override) return normalizePreset(bp);
    return normalizePreset({ ...bp, ...override, builtIn: true });
  }).filter(Boolean);
  const custom = normalizeCustomPresets(state.customPresets)
    .filter((p) => !BUILTIN_PRESETS.some((bp) => bp.id === p.id));
  return [...merged, ...custom];
}

function getActivePresetIdFromUI() {
  if (state.isNovelAIImagePage && state.workbenchPage === 'presets' && ui.wb?.presetId?.value) {
    return ui.wb.presetId.value;
  }
  if (ui.settings?.activePresetId?.value) {
    return ui.settings.activePresetId.value;
  }
  if (ui.wb?.presetId?.value) {
    return ui.wb.presetId.value;
  }
  return state.settings.activePresetId || 'nai-v4';
}

function syncActivePresetIdFromUI() {
  state.settings.activePresetId = getActivePresetIdFromUI();
}

function getActivePreset() {
  const id = state.settings.activePresetId || 'nai-v4';
  return getAllPresets().find((p) => p.id === id) || normalizePreset(BUILTIN_PRESETS[0]);
}

async function loadCustomPresets() {
  const data = await storageGet([PRESETS_KEY]);
  state.customPresets = normalizeCustomPresets(data[PRESETS_KEY]);
}

async function saveCustomPresets() {
  return storageSet({ [PRESETS_KEY]: state.customPresets });
}

function persistActivePreset(blocksFromEditor, presetId) {
  if (!presetId) syncActivePresetIdFromUI();
  const id = presetId || state.settings.activePresetId || 'nai-v4';
  const current = getAllPresets().find((p) => p.id === id) || normalizePreset(BUILTIN_PRESETS[0]);
  const blocks = Array.isArray(blocksFromEditor) && blocksFromEditor.length
    ? blocksFromEditor.map(normalizePresetBlock)
    : current.blocks;
  const stored = normalizePreset({ ...current, id, blocks });
  if (!stored) return;

  const idx = state.customPresets.findIndex((p) => p.id === id);
  if (idx >= 0) {
    state.customPresets[idx] = stored;
  } else {
    state.customPresets.push(stored);
  }
}

function readPresetBlocksFromEditor(editor) {
  if (editor === 'workbench') return readWorkbenchBlocksFromEditor();
  return readBlocksFromEditor();
}

function renderPresetEditor(editor) {
  if (editor === 'workbench') {
    renderWorkbenchPresetBlocks();
    bindWorkbenchBlockDragListeners();
    updateWorkbenchRoleSectionVisibility();
    return;
  }
  renderPresetBlocks();
  bindBlockDragListeners();
  updateRoleSectionVisibility();
}

function appendActivePresetBlock(editor) {
  syncActivePresetIdFromUI();
  let blocks = readPresetBlocksFromEditor(editor);
  if (!blocks.length) {
    blocks = getActivePreset().blocks.map((block) => ({ ...block }));
  }
  blocks.push({ id: generateBlockId(), role: 'user', content: '', enabled: true });
  persistActivePreset(blocks);
  renderPresetEditor(editor);
}

function resetPresetToDefault(presetId) {
  const builtin = BUILTIN_PRESETS.find((p) => p.id === presetId);
  if (!builtin) return false;
  state.customPresets = state.customPresets.filter((p) => p.id !== presetId);
  return true;
}

function createPreset(name) {
  const preset = {
    id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: name || '自定义预设',
    builtIn: false,
    blocks: [
      { id: generateBlockId(), role: 'system', content: '', enabled: true },
      { id: generateBlockId(), role: 'user', content: '{{booru_tags}}', enabled: true },
    ],
  };
  state.customPresets.push(preset);
  return preset;
}

function duplicatePreset(sourceId) {
  const source = getAllPresets().find((p) => p.id === sourceId);
  if (!source) return null;
  const preset = {
    id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: source.name + ' (副本)',
    builtIn: false,
    blocks: source.blocks.map((b) => ({ ...b, id: generateBlockId() })),
  };
  state.customPresets.push(preset);
  return preset;
}

function deletePreset(presetId) {
  if (BUILTIN_PRESETS.some((p) => p.id === presetId)) return;
  state.customPresets = state.customPresets.filter((p) => p.id !== presetId);
  if (state.settings.activePresetId === presetId) {
    state.settings.activePresetId = 'nai-v4';
  }
}

function detectBooruTagsFiltered() {
  const host = window.location.hostname;
  const types = state.settings.booruTagTypes || DEFAULT_BOORU_TAG_TYPES;
  const tags = [];

  if (host.includes('donmai.us') || host === 'aibooru.online') {
    const typeMap = { artist: 'artist', character: 'character', copyright: 'copyright', general: 'general', meta: 'meta' };
    Object.entries(typeMap).forEach(([tagType, settingKey]) => {
      if (types[settingKey] === false) return;
      document.querySelectorAll(`.${tagType}-tag-list > li[data-tag-name]`).forEach((li) => {
        const name = li.dataset.tagName;
        if (name) tags.push(name.replace(/_/g, ' '));
      });
    });
  } else if (host === 'gelbooru.com') {
    const typeMap = { general: 'general', character: 'character', copyright: 'copyright', artist: 'artist', metadata: 'meta' };
    Object.entries(typeMap).forEach(([cssClass, settingKey]) => {
      if (types[settingKey] === false) return;
      document.querySelectorAll(`.tag-type-${cssClass} a[href*="page=post"]`).forEach((a) => {
        const text = a.textContent.trim();
        if (text && !text.match(/^\d+$/)) tags.push(text.replace(/_/g, ' '));
      });
    });
  }

  return tags.length ? tags.join(', ') : '';
}

function resolveVariables(content) {
  let result = content;

  if (result.includes('{{booru_tags}}')) {
    const tags = state.settings.enableBooruTagContext ? detectBooruTagsFiltered() : '';
    result = result.replace(/\{\{booru_tags\}\}/g, tags);
  }

  if (result.includes('{{role_prompt}}')) {
    const rp = state.settings.rolePrompt?.trim() || '';
    result = result.replace(/\{\{role_prompt\}\}/g, rp);
  }

  return result;
}

function mergeAdjacentSameRole(blocks) {
  if (blocks.length <= 1) return blocks;
  const merged = [{ ...blocks[0] }];
  for (let i = 1; i < blocks.length; i++) {
    const prev = merged[merged.length - 1];
    if (blocks[i].role === prev.role) {
      prev.content = prev.content + '\n\n' + blocks[i].content;
    } else {
      merged.push({ ...blocks[i] });
    }
  }
  return merged;
}

function mergeBlocksForProtocol(blocks, protocol) {
  let merged = [...blocks];
  let didMerge = false;
  const original = blocks.length;

  merged = mergeAdjacentSameRole(merged);
  if (merged.length !== original) didMerge = true;

  if (protocol === 'anthropic-messages' || protocol === 'responses') {
    const systemBlocks = merged.filter((b) => b.role === 'system');
    const nonSystem = merged.filter((b) => b.role !== 'system');
    if (systemBlocks.length > 1) didMerge = true;
    const singleSystem = systemBlocks.length
      ? [{ role: 'system', content: systemBlocks.map((b) => b.content).join('\n\n') }]
      : [];
    merged = [...singleSystem, ...mergeAdjacentSameRole(nonSystem)];
  }

  return { merged, didMerge };
}

