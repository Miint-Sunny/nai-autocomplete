function applyBooruTagTypesToCheckboxes() {
  const types = state.settings.booruTagTypes || DEFAULT_BOORU_TAG_TYPES;
  if (!ui.settings.booruTagTypesSection) return;
  ui.settings.booruTagTypesSection.querySelectorAll('[data-booru-type]').forEach((cb) => {
    cb.checked = types[cb.dataset.booruType] !== false;
  });
}

function readBooruTagTypesFromCheckboxes() {
  const types = { ...DEFAULT_BOORU_TAG_TYPES };
  if (!ui.settings.booruTagTypesSection) return types;
  ui.settings.booruTagTypesSection.querySelectorAll('[data-booru-type]').forEach((cb) => {
    types[cb.dataset.booruType] = cb.checked;
  });
  return types;
}

function applySettingsToInputs() {
  ui.settings.providerPreset.value = state.settings.providerPreset;
  ui.settings.providerPreset.dataset.currentProvider = state.settings.providerPreset;
  ui.settings.protocol.value = state.settings.protocol;
  ui.settings.endpoint.value = state.settings.endpoint;
  ui.settings.model.value = state.settings.model;
  ui.settings.apiKey.value = state.settings.apiKey;
  renderPresetSelector();
  renderPresetBlocks();
  ui.settings.rolePrompt.value = state.settings.rolePrompt || '';
  updateRoleSectionVisibility();
  ui.settings.temperature.value = String(state.settings.temperature);
  ui.settings.maxTokens.value = String(state.settings.maxTokens);
  if (ui.settings.reasoningEffort) ui.settings.reasoningEffort.value = state.settings.reasoningEffort || 'off';
  if (ui.settings.fallbackReasoningEffort) ui.settings.fallbackReasoningEffort.value = state.settings.fallbackReasoningEffort || 'off';
  ui.settings.enableFallbackModel.checked = Boolean(state.settings.enableFallbackModel);
  ui.settings.fallbackProviderPreset.value = state.settings.fallbackProviderPreset;
  ui.settings.fallbackProviderPreset.dataset.currentProvider = state.settings.fallbackProviderPreset;
  ui.settings.fallbackProtocol.value = state.settings.fallbackProtocol;
  ui.settings.fallbackEndpoint.value = state.settings.fallbackEndpoint;
  ui.settings.fallbackModel.value = state.settings.fallbackModel;
  ui.settings.fallbackApiKey.value = state.settings.fallbackApiKey;
  ui.settings.themePreset.value = state.settings.themePreset || DEFAULT_SETTINGS.themePreset;
  ui.settings.preferNaiMetadata.checked = state.settings.preferNaiMetadata !== false;
  ui.settings.allowDanbooruLookup.checked = state.settings.allowDanbooruLookup !== false;
  if (ui.settings.autoCompleteEndpoint) ui.settings.autoCompleteEndpoint.checked = state.settings.autoCompleteEndpoint !== false;
  if (ui.settings.agentNai5Rules) ui.settings.agentNai5Rules.checked = state.settings.agentNai5Rules !== false;
  if (ui.settings.naiDialect) ui.settings.naiDialect.value = state.settings.naiDialect === 'v45' ? 'v45' : 'v5';
  ui.settings.sendImageAsDataUrl.checked = Boolean(state.settings.sendImageAsDataUrl);
  ui.settings.enableBooruTagContext.checked = Boolean(state.settings.enableBooruTagContext);
  updateBooruTagTypesVisibility();
  applyBooruTagTypesToCheckboxes();
  ui.settings.defaultCodeFence.checked = Boolean(state.settings.defaultCodeFence);
  ui.settings.showReverseFloatingBall.checked = Boolean(state.settings.showReverseFloatingBall);
  ui.settings.showWorkbenchFloatingBall.checked = Boolean(state.settings.showWorkbenchFloatingBall);
  if (ui.settings.showExternalFloatingBall) ui.settings.showExternalFloatingBall.checked = Boolean(state.settings.showExternalFloatingBall);
  if (ui.settings.glassEffect) ui.settings.glassEffect.checked = state.settings.glassEffect !== false;
  if (ui.settings.glassStrength) ui.settings.glassStrength.value = String(state.settings.glassStrength ?? DEFAULT_SETTINGS.glassStrength);
  applyLibrarySettingsToInputs();
  updateFallbackSettingsVisibility();
  updateEndpointWarnings();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function applyLibrarySettingsToInputs() {
  const map = {
    providerPreset: 'providerPreset',
    protocol: 'protocol',
    endpoint: 'endpoint',
    model: 'model',
    apiKey: 'apiKey',
    rolePrompt: 'rolePrompt',
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    fallbackProviderPreset: 'fallbackProviderPreset',
    fallbackProtocol: 'fallbackProtocol',
    fallbackEndpoint: 'fallbackEndpoint',
    fallbackModel: 'fallbackModel',
    fallbackApiKey: 'fallbackApiKey',
    themePreset: 'themePreset',
  };

  Object.entries(map).forEach(([key, settingKey]) => {
    if (!ui.library[key]) return;
    ui.library[key].value = String(state.settings[settingKey] ?? DEFAULT_SETTINGS[settingKey] ?? '');
  });
  if (ui.library.providerPreset) {
    ui.library.providerPreset.dataset.currentProvider = state.settings.providerPreset;
  }
  if (ui.library.fallbackProviderPreset) {
    ui.library.fallbackProviderPreset.dataset.currentProvider = state.settings.fallbackProviderPreset;
  }

  if (ui.library.activePresetId) {
    const all = getAllPresets();
    ui.library.activePresetId.innerHTML = all.map((p) =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.builtIn ? '' : ' ✦'}</option>`
    ).join('');
    ui.library.activePresetId.value = state.settings.activePresetId || 'nai-v4';
  }

  const checks = {
    enableFallbackModel: 'enableFallbackModel',
    preferNaiMetadata: 'preferNaiMetadata',
    allowDanbooruLookup: 'allowDanbooruLookup',
    autoCompleteEndpoint: 'autoCompleteEndpoint',
    agentNai5Rules: 'agentNai5Rules',
    sendImageAsDataUrl: 'sendImageAsDataUrl',
    enableBooruTagContext: 'enableBooruTagContext',
    defaultCodeFence: 'defaultCodeFence',
    showReverseFloatingBall: 'showReverseFloatingBall',
    showWorkbenchFloatingBall: 'showWorkbenchFloatingBall',
    showExternalFloatingBall: 'showExternalFloatingBall',
    glassEffect: 'glassEffect',
  };
  if (ui.library.glassStrength) {
    ui.library.glassStrength.value = String(state.settings.glassStrength ?? DEFAULT_SETTINGS.glassStrength);
  }
  Object.entries(checks).forEach(([key, settingKey]) => {
    if (!ui.library[key]) return;
    ui.library[key].checked = Boolean(state.settings[settingKey]);
  });
  if (ui.library.naiDialect) ui.library.naiDialect.value = state.settings.naiDialect === 'v45' ? 'v45' : 'v5';

  renderPromptLibraryOptions();
}

function readLibrarySettingsFromInputs() {
  const providerPreset = ui.library.providerPreset?.value || DEFAULT_SETTINGS.providerPreset;
  const fallbackProviderPreset = ui.library.fallbackProviderPreset?.value || DEFAULT_SETTINGS.fallbackProviderPreset;
  const primaryConnection = readProviderConnectionFromFields(getConnectionFields(ui.library, 'primary'));
  const fallbackConnection = readProviderConnectionFromFields(getConnectionFields(ui.library, 'fallback'));

  return {
    providerPreset,
    protocol: primaryConnection.protocol || DEFAULT_SETTINGS.protocol,
    endpoint: primaryConnection.endpoint,
    model: primaryConnection.model,
    apiKey: primaryConnection.apiKey,
    providerConnections: rememberProviderConnection(state.settings.providerConnections, providerPreset, primaryConnection),
    activePresetId: ui.library.activePresetId?.value || state.settings.activePresetId || DEFAULT_SETTINGS.activePresetId,
    rolePrompt: ui.library.rolePrompt?.value.trim() || '',
    booruTagTypes: state.settings.booruTagTypes || DEFAULT_BOORU_TAG_TYPES,
    defaultCodeFence: Boolean(ui.library.defaultCodeFence?.checked),
    temperature: Number(ui.library.temperature?.value) || DEFAULT_SETTINGS.temperature,
    maxTokens: Number(ui.library.maxTokens?.value) || DEFAULT_SETTINGS.maxTokens,
    enableFallbackModel: Boolean(ui.library.enableFallbackModel?.checked),
    fallbackProviderPreset,
    fallbackProtocol: fallbackConnection.protocol || DEFAULT_SETTINGS.fallbackProtocol,
    fallbackEndpoint: fallbackConnection.endpoint,
    fallbackModel: fallbackConnection.model,
    fallbackApiKey: fallbackConnection.apiKey,
    fallbackProviderConnections: rememberProviderConnection(state.settings.fallbackProviderConnections, fallbackProviderPreset, fallbackConnection),
    themePreset: ui.library.themePreset?.value || DEFAULT_SETTINGS.themePreset,
    preferNaiMetadata: Boolean(ui.library.preferNaiMetadata?.checked),
    allowDanbooruLookup: Boolean(ui.library.allowDanbooruLookup?.checked),
    autoCompleteEndpoint: Boolean(ui.library.autoCompleteEndpoint?.checked),
    agentNai5Rules: Boolean(ui.library.agentNai5Rules?.checked),
    naiDialect: ui.library.naiDialect?.value === 'v45' ? 'v45' : 'v5',
    sendImageAsDataUrl: Boolean(ui.library.sendImageAsDataUrl?.checked),
    enableBooruTagContext: Boolean(ui.library.enableBooruTagContext?.checked),
    showReverseFloatingBall: Boolean(ui.library.showReverseFloatingBall?.checked),
    showWorkbenchFloatingBall: Boolean(ui.library.showWorkbenchFloatingBall?.checked),
    showExternalFloatingBall: Boolean(ui.library.showExternalFloatingBall?.checked),
    glassEffect: Boolean(ui.library.glassEffect?.checked),
    glassStrength: Number(ui.library.glassStrength?.value ?? state.settings.glassStrength ?? DEFAULT_SETTINGS.glassStrength),
  };
}

function readSettingsFromInputs() {
  const providerPreset = ui.settings.providerPreset.value || DEFAULT_SETTINGS.providerPreset;
  const fallbackProviderPreset = ui.settings.fallbackProviderPreset.value || DEFAULT_SETTINGS.fallbackProviderPreset;
  const primaryConnection = readProviderConnectionFromFields(getConnectionFields(ui.settings, 'primary'));
  const fallbackConnection = readProviderConnectionFromFields(getConnectionFields(ui.settings, 'fallback'));

  return {
    providerPreset,
    protocol: primaryConnection.protocol || DEFAULT_SETTINGS.protocol,
    endpoint: primaryConnection.endpoint,
    model: primaryConnection.model,
    apiKey: primaryConnection.apiKey,
    providerConnections: rememberProviderConnection(state.settings.providerConnections, providerPreset, primaryConnection),
    activePresetId: ui.settings.activePresetId.value || DEFAULT_SETTINGS.activePresetId,
    rolePrompt: ui.settings.rolePrompt.value.trim(),
    booruTagTypes: readBooruTagTypesFromCheckboxes(),
    defaultCodeFence: Boolean(ui.settings.defaultCodeFence.checked),
    temperature: Number(ui.settings.temperature.value) || DEFAULT_SETTINGS.temperature,
    maxTokens: Number(ui.settings.maxTokens.value) || DEFAULT_SETTINGS.maxTokens,
    reasoningEffort: ui.settings.reasoningEffort?.value || DEFAULT_SETTINGS.reasoningEffort,
    fallbackReasoningEffort: ui.settings.fallbackReasoningEffort?.value || DEFAULT_SETTINGS.fallbackReasoningEffort,
    enableFallbackModel: Boolean(ui.settings.enableFallbackModel.checked),
    fallbackProviderPreset,
    fallbackProtocol: fallbackConnection.protocol || DEFAULT_SETTINGS.fallbackProtocol,
    fallbackEndpoint: fallbackConnection.endpoint,
    fallbackModel: fallbackConnection.model,
    fallbackApiKey: fallbackConnection.apiKey,
    fallbackProviderConnections: rememberProviderConnection(state.settings.fallbackProviderConnections, fallbackProviderPreset, fallbackConnection),
    themePreset: ui.settings.themePreset.value || DEFAULT_SETTINGS.themePreset,
    preferNaiMetadata: Boolean(ui.settings.preferNaiMetadata.checked),
    allowDanbooruLookup: Boolean(ui.settings.allowDanbooruLookup.checked),
    autoCompleteEndpoint: Boolean(ui.settings.autoCompleteEndpoint?.checked ?? DEFAULT_SETTINGS.autoCompleteEndpoint),
    agentNai5Rules: Boolean(ui.settings.agentNai5Rules?.checked ?? DEFAULT_SETTINGS.agentNai5Rules),
    naiDialect: ui.settings.naiDialect?.value === 'v45' ? 'v45' : 'v5',
    sendImageAsDataUrl: Boolean(ui.settings.sendImageAsDataUrl.checked),
    enableBooruTagContext: Boolean(ui.settings.enableBooruTagContext.checked),
    showReverseFloatingBall: Boolean(ui.settings.showReverseFloatingBall.checked),
    showWorkbenchFloatingBall: Boolean(ui.settings.showWorkbenchFloatingBall.checked),
    showExternalFloatingBall: Boolean(ui.settings.showExternalFloatingBall?.checked),
    glassEffect: Boolean(ui.settings.glassEffect?.checked),
    glassStrength: Number(ui.settings.glassStrength?.value ?? state.settings.glassStrength ?? DEFAULT_SETTINGS.glassStrength),
  };
}

// 内置反推预设跟着「提示词格式」走：nai-v5 ↔ nai-v4。
// 只在档位真的变了、且当前选的是这两个内置项之一时切换 —— 用户自选的预设不碰。
function applyDialectPresetFollow(previousDialect) {
  const next = state.settings.naiDialect === 'v45' ? 'v45' : 'v5';
  if (next === previousDialect) return false;
  const pair = { v5: 'nai-v5', v45: 'nai-v4' };
  if (state.settings.activePresetId !== pair[previousDialect]) return false;
  state.settings.activePresetId = pair[next];
  return true;
}

async function saveSettings() {
  if (!ensureExtensionContext()) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }
  syncActivePresetIdFromUI();
  syncBlocksToPreset();
  applyActivePresetName('settings');
  const previousDialect = state.settings.naiDialect === 'v45' ? 'v45' : 'v5';
  state.settings = { ...DEFAULT_SETTINGS, ...readSettingsFromInputs() };
  if (applyDialectPresetFollow(previousDialect)) {
    renderPresetSelector();
    renderPresetEditor('settings');
  }
  const saved = await storageSet({ [SETTINGS_KEY]: state.settings });
  if (!saved) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }
  const presetsSaved = await saveCustomPresets();
  if (!presetsSaved) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }
  applyThemePreset();
  updateFabVisibility();
  applyLibrarySettingsToInputs();
  renderPresetEditor('workbench');
  renderAgentPanel();
  setStatus(T.statusSaved, false);
}

async function saveLibrarySettings() {
  if (!ensureExtensionContext()) return;
  const previousDialect = state.settings.naiDialect === 'v45' ? 'v45' : 'v5';
  state.settings = { ...DEFAULT_SETTINGS, ...readLibrarySettingsFromInputs() };
  applyDialectPresetFollow(previousDialect);
  const saved = await storageSet({ [SETTINGS_KEY]: state.settings });
  if (!saved) return;
  applyThemePreset();
  updateFabVisibility();
  applySettingsToInputs();
  renderPresetSelector();
  renderPresetEditor('settings');
  renderAgentPanel();
  setStatus(T.statusSaved, false);
}

async function clearHistory() {
  if (!ensureExtensionContext()) return;
  state.history = [];
  renderHistory();
  await saveHistory();
  setStatus(T.statusHistoryCleared, false);
}

function bindStorageListener() {
  if (!ensureExtensionContext()) return;

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes[SETTINGS_KEY]?.newValue) {
        state.settings = upgradePromptSettings({ ...DEFAULT_SETTINGS, ...changes[SETTINGS_KEY].newValue });
        applySettingsToInputs();
        applyThemePreset();
        updateFabVisibility();
        applyLibrarySettingsToInputs();
      }

      if (changes[ARTIST_LIBRARY_KEY] && state.artistQuick.loaded) {
        applyArtistQuickLibrary(changes[ARTIST_LIBRARY_KEY].newValue);
        renderArtistQuickPanel();
      }

      if (changes[HISTORY_KEY]?.newValue) {
        state.history = Array.isArray(changes[HISTORY_KEY].newValue) ? changes[HISTORY_KEY].newValue : [];
        renderHistory();
      }

      if (changes[PROMPT_LIBRARY_KEY]) {
        state.promptLibrary = Array.isArray(changes[PROMPT_LIBRARY_KEY].newValue)
          ? changes[PROMPT_LIBRARY_KEY].newValue.map(normalizePromptLibraryEntry).filter(Boolean)
          : [];
        renderPromptLibraryOptions();
        renderLibraryManager();
      }

      if (changes[PRESETS_KEY]?.newValue) {
        state.customPresets = normalizeCustomPresets(changes[PRESETS_KEY].newValue);
        renderWorkbenchPresetSelector();
        renderPresetEditor('workbench');
        renderPresetSelector();
        renderPresetEditor('settings');
      }
    });
  } catch (error) {
    markContextInvalidated(error);
  }
}
