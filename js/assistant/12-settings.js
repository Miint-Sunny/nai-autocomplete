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
  ui.settings.enableFallbackModel.checked = Boolean(state.settings.enableFallbackModel);
  ui.settings.fallbackProviderPreset.value = state.settings.fallbackProviderPreset;
  ui.settings.fallbackProviderPreset.dataset.currentProvider = state.settings.fallbackProviderPreset;
  ui.settings.fallbackProtocol.value = state.settings.fallbackProtocol;
  ui.settings.fallbackEndpoint.value = state.settings.fallbackEndpoint;
  ui.settings.fallbackModel.value = state.settings.fallbackModel;
  ui.settings.fallbackApiKey.value = state.settings.fallbackApiKey;
  ui.settings.themePreset.value = state.settings.themePreset || DEFAULT_SETTINGS.themePreset;
  ui.settings.sendImageAsDataUrl.checked = Boolean(state.settings.sendImageAsDataUrl);
  ui.settings.enableBooruTagContext.checked = Boolean(state.settings.enableBooruTagContext);
  updateBooruTagTypesVisibility();
  applyBooruTagTypesToCheckboxes();
  ui.settings.defaultCodeFence.checked = Boolean(state.settings.defaultCodeFence);
  ui.settings.showReverseFloatingBall.checked = Boolean(state.settings.showReverseFloatingBall);
  ui.settings.showWorkbenchFloatingBall.checked = Boolean(state.settings.showWorkbenchFloatingBall);
  applyLibrarySettingsToInputs();
  updateFallbackSettingsVisibility();
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
    sendImageAsDataUrl: 'sendImageAsDataUrl',
    enableBooruTagContext: 'enableBooruTagContext',
    defaultCodeFence: 'defaultCodeFence',
    showReverseFloatingBall: 'showReverseFloatingBall',
    showWorkbenchFloatingBall: 'showWorkbenchFloatingBall',
  };
  Object.entries(checks).forEach(([key, settingKey]) => {
    if (!ui.library[key]) return;
    ui.library[key].checked = Boolean(state.settings[settingKey]);
  });

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
    sendImageAsDataUrl: Boolean(ui.library.sendImageAsDataUrl?.checked),
    enableBooruTagContext: Boolean(ui.library.enableBooruTagContext?.checked),
    showReverseFloatingBall: Boolean(ui.library.showReverseFloatingBall?.checked),
    showWorkbenchFloatingBall: Boolean(ui.library.showWorkbenchFloatingBall?.checked),
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
    enableFallbackModel: Boolean(ui.settings.enableFallbackModel.checked),
    fallbackProviderPreset,
    fallbackProtocol: fallbackConnection.protocol || DEFAULT_SETTINGS.fallbackProtocol,
    fallbackEndpoint: fallbackConnection.endpoint,
    fallbackModel: fallbackConnection.model,
    fallbackApiKey: fallbackConnection.apiKey,
    fallbackProviderConnections: rememberProviderConnection(state.settings.fallbackProviderConnections, fallbackProviderPreset, fallbackConnection),
    themePreset: ui.settings.themePreset.value || DEFAULT_SETTINGS.themePreset,
    sendImageAsDataUrl: Boolean(ui.settings.sendImageAsDataUrl.checked),
    enableBooruTagContext: Boolean(ui.settings.enableBooruTagContext.checked),
    showReverseFloatingBall: Boolean(ui.settings.showReverseFloatingBall.checked),
    showWorkbenchFloatingBall: Boolean(ui.settings.showWorkbenchFloatingBall.checked),
  };
}

async function saveSettings() {
  if (!ensureExtensionContext()) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }
  syncActivePresetIdFromUI();
  syncBlocksToPreset();
  state.settings = { ...DEFAULT_SETTINGS, ...readSettingsFromInputs() };
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
  setStatus(T.statusSaved, false);
}

async function saveLibrarySettings() {
  if (!ensureExtensionContext()) return;
  state.settings = { ...DEFAULT_SETTINGS, ...readLibrarySettingsFromInputs() };
  const saved = await storageSet({ [SETTINGS_KEY]: state.settings });
  if (!saved) return;
  applyThemePreset();
  updateFabVisibility();
  applySettingsToInputs();
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
