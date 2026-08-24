async function initState() {
  const data = await storageGet([SETTINGS_KEY, HISTORY_KEY, PANEL_LAYOUT_KEY, DRAWER_LAYOUT_KEY, PROMPT_LIBRARY_KEY, PRESETS_KEY, FAB_POSITION_KEY]);
  const rawSettings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  const upgradedSettings = upgradePromptSettings(rawSettings);
  state.settings = upgradedSettings;
  state.customPresets = normalizeCustomPresets(data[PRESETS_KEY]);
  state.history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  state.promptLibrary = Array.isArray(data[PROMPT_LIBRARY_KEY]) ? data[PROMPT_LIBRARY_KEY].map(normalizePromptLibraryEntry).filter(Boolean) : [];
  state.panelLayout = normalizeStoredPanelLayout(data[PANEL_LAYOUT_KEY]);
  state.fabPosition = normalizeStoredFabPosition(data[FAB_POSITION_KEY]);
  state.drawerLayout = normalizeStoredDrawerLayout(data[DRAWER_LAYOUT_KEY]);

  if (upgradedSettings._migrationPreset) {
    state.customPresets.push(upgradedSettings._migrationPreset);
    delete upgradedSettings._migrationPreset;
    await storageSet({ [PRESETS_KEY]: state.customPresets });
  }

  if (JSON.stringify(rawSettings) !== JSON.stringify(upgradedSettings)) {
    await storageSet({ [SETTINGS_KEY]: upgradedSettings });
  }
}

function bindMessageListener() {
  if (!ensureExtensionContext()) return;

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (message.type === 'nai-open-panel') {
        openPanel(message.page === 'settings' ? 'settings' : 'reverse');
        sendResponse({ ok: true });
        return true;
      }

      // 扩展图标在出图页发的就是这条。工作台只在出图页存在，别处 background
      // 压根不会发过来。
      if (message.type === 'nai-open-workbench') {
        if (state.isNovelAIImagePage) openLibraryDrawer();
        else openPanel('reverse');
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === 'nai-prompt-library-updated') {
        refreshPromptLibraryOptions()
          .then(() => sendResponse({ ok: true }))
          .catch((error) => {
            markContextInvalidated(error);
            sendResponse({ ok: false });
          });
        return true;
      }

      return false;
    });
  } catch (error) {
    markContextInvalidated(error);
  }
}

async function init() {
  await initState();
  createUI();

  applySettingsToInputs();
  bindBlockDragListeners();
  applyThemePreset();
  bindLocationModeWatcher();
  applyPageMode();
  updateFabVisibility();
  applyFabPosition(state.fabPosition);
  updatePreview();
  renderHistory();
  renderLibraryManager();
  setResult('');
  setPage('reverse');
  setStatus(T.statusReady, false);

  initFlowPage(ui.root);
  initAgentPanel(ui.root).catch(() => {});

  bindStorageListener();
  bindMessageListener();
  document.addEventListener('click', onShortcutClick, true);
}
