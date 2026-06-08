(() => {
  if (window.__naiOfficialChunkBridgeInstalled) return;

  const BRIDGE_VERSION = '1.5.1-official-chunk-bridge.1';
  const OFFICIAL_MODULES = {
    accountAtoms: 44200,
    accountClient: 1431,
    promptMacro: 89313,
    jotaiHooks: 2834,
    jotaiVanilla: 56314,
  };
  const ROOT_CATEGORY_ID = 'default';
  const DEFAULT_CHUNK_COLOR = '#6B7280';

  window.__naiOfficialChunkBridgeInstalled = true;
  document.documentElement.dataset.naiOfficialChunkBridgeMain = 'true';

  const updateBridgeStatus = (status, extra = {}) => {
    try {
      document.documentElement.dataset.naiOfficialChunkBridgeStatus = status;
      document.documentElement.dataset.naiOfficialChunkBridge = JSON.stringify({
        status,
        version: BRIDGE_VERSION,
        at: new Date().toISOString(),
        ...extra,
      }).slice(0, 4000);
    } catch (error) {}
  };

  const getWebpackRequire = () => {
    if (window.__naiAutocompleteWebpackRequire) return window.__naiAutocompleteWebpackRequire;
    const chunk = window.webpackChunk_N_E;
    if (!Array.isArray(chunk) || typeof chunk.push !== 'function') {
      throw new Error('NovelAI webpack runtime is not ready');
    }

    let webpackRequire = null;
    chunk.push([[`nai-autocomplete-${Date.now()}`], {}, (require) => {
      webpackRequire = require;
    }]);
    if (!webpackRequire) throw new Error('Unable to access NovelAI webpack runtime');
    window.__naiAutocompleteWebpackRequire = webpackRequire;
    return webpackRequire;
  };

  const requireModule = (webpackRequire, moduleId, name) => {
    const moduleValue = webpackRequire(moduleId);
    if (!moduleValue) throw new Error(`NovelAI module ${name} is not available`);
    return moduleValue;
  };

  const findDefaultStore = (vanillaStoreModule, atomsModule) => {
    if (typeof vanillaStoreModule?.zp !== 'function') {
      throw new Error('NovelAI default state store is not available');
    }
    const store = vanillaStoreModule.zp();
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
      throw new Error('NovelAI default state store is invalid');
    }

    const account = atomsModule.Nn ? store.get(atomsModule.Nn) : null;
    const macros = atomsModule.lA ? store.get(atomsModule.lA) : null;
    return {
      store,
      key: 'jotai-vanilla-default',
      account,
      macros: Array.isArray(macros) ? macros : [],
    };
  };

  const createFallbackId = (prefix) => {
    try {
      if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    } catch (error) {}
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const createPromptMacro = (MacroClass, fields) => {
    let macro;
    try {
      macro = typeof MacroClass === 'function' ? new MacroClass() : {};
    } catch (error) {
      macro = {};
    }
    Object.assign(macro, fields);
    return macro;
  };

  const getRootCategory = (macros, MacroClass) => {
    const root = macros.find((macro) => macro?.id === ROOT_CATEGORY_ID);
    if (root) {
      root.childOrder = Array.isArray(root.childOrder) ? [...root.childOrder] : [];
      root.categoryOrder = Array.isArray(root.categoryOrder) ? [...root.categoryOrder] : [];
      return root;
    }

    return createPromptMacro(MacroClass, {
      id: ROOT_CATEGORY_ID,
      containerId: ROOT_CATEGORY_ID,
      remoteId: '',
      label: 'Root Category',
      expansion: '',
      color: '#808080',
      isCategory: true,
      childOrder: [],
      categoryOrder: [],
    });
  };

  const normalizeSyncEntry = (rawEntry) => {
    const entry = rawEntry || {};
    const label = String(entry.label || entry.shortAlias || entry.name || entry.alias || '').trim();
    const expansion = String(entry.expansion || entry.promptText || '').trim();
    if (!label) throw new Error('Missing chunk label');
    if (!expansion) throw new Error('Missing chunk content');

    const baseId = String(entry.officialChunkId || entry.id || entry.alias || createFallbackId('nai-ac-chunk'))
      .replace(/[^\p{L}\p{N}_:-]/gu, '-')
      .slice(0, 96);
    const id = baseId.startsWith('nai-ac-') ? baseId : `nai-ac-${baseId}`;
    return {
      id,
      containerId: String(entry.officialContainerId || id),
      remoteId: String(entry.officialRemoteId || ''),
      label,
      expansion,
      color: String(entry.color || DEFAULT_CHUNK_COLOR),
      isCategory: false,
    };
  };

  const syncOfficialPromptChunk = async (rawEntry) => {
    const webpackRequire = getWebpackRequire();
    const atomsModule = requireModule(webpackRequire, OFFICIAL_MODULES.accountAtoms, 'atoms');
    const clientModule = requireModule(webpackRequire, OFFICIAL_MODULES.accountClient, 'account client');
    const promptMacroModule = requireModule(webpackRequire, OFFICIAL_MODULES.promptMacro, 'prompt macro');
    const vanillaStoreModule = requireModule(webpackRequire, OFFICIAL_MODULES.jotaiVanilla, 'state store');

    const { store, key: storeKey, account, macros } = findDefaultStore(vanillaStoreModule, atomsModule);
    if (!account?.authenticated) throw new Error('NovelAI account is not authenticated');
    if (!atomsModule.lA || !atomsModule.Nn) throw new Error('NovelAI prompt chunk atoms are not available');
    if (typeof clientModule.c7 !== 'function') throw new Error('NovelAI account client is not available');

    const MacroClass = promptMacroModule.F;
    const entry = normalizeSyncEntry(rawEntry);
    const client = clientModule.c7(account);
    if (!client || typeof client.saveImagePromptMacro !== 'function') {
      throw new Error('NovelAI prompt chunk save API is not available');
    }

    const currentMacros = Array.isArray(macros) ? macros : [];
    const existing = currentMacros.find((macro) => !macro?.isCategory && (
      macro.id === entry.id
      || macro.containerId === entry.containerId
      || (macro.label === entry.label && macro.expansion === entry.expansion)
    ));

    const chunkId = existing?.id || entry.id;
    const containerId = existing?.containerId || entry.containerId || chunkId;
    const chunk = createPromptMacro(MacroClass, {
      ...existing,
      ...entry,
      id: chunkId,
      containerId,
      remoteId: entry.remoteId || existing?.remoteId || '',
    });
    const isNewChunk = !chunk.remoteId;
    const remoteId = await client.saveImagePromptMacro(chunk);
    chunk.remoteId = remoteId || chunk.remoteId;

    const root = getRootCategory(currentMacros, MacroClass);
    root.childOrder = root.childOrder.filter((id, index, array) => id !== chunk.id && array.indexOf(id) === index);
    if (!root.childOrder.includes(chunk.id)) {
      root.childOrder.push(chunk.id);
    }
    const rootRemoteId = await client.saveImagePromptMacro(root);
    root.remoteId = rootRemoteId || root.remoteId;

    const nextMacros = currentMacros
      .filter((macro) => macro?.id !== chunk.id && macro?.id !== ROOT_CATEGORY_ID);
    const insertIndex = existing
      ? Math.max(0, currentMacros.findIndex((macro) => macro?.id === existing.id))
      : nextMacros.length;
    nextMacros.splice(Math.min(insertIndex, nextMacros.length), 0, chunk);
    nextMacros.push(root);
    store.set(atomsModule.lA, nextMacros);

    return {
      ok: true,
      isNewChunk,
      storeKey,
      id: chunk.id,
      containerId: chunk.containerId,
      remoteId: chunk.remoteId,
      rootRemoteId: root.remoteId,
    };
  };

  window.addEventListener('nai-official-chunk-sync-request', (event) => {
    const requestId = event?.detail?.requestId || '';
    Promise.resolve()
      .then(() => syncOfficialPromptChunk(event?.detail?.entry))
      .then((result) => {
        updateBridgeStatus('synced', { requestId, id: result.id, remoteId: result.remoteId });
        window.dispatchEvent(new CustomEvent('nai-official-chunk-sync-response', {
          detail: { requestId, result },
        }));
      })
      .catch((error) => {
        const message = String(error?.message || error || 'Unknown official chunk sync error');
        updateBridgeStatus('error', { requestId, error: message });
        window.dispatchEvent(new CustomEvent('nai-official-chunk-sync-response', {
          detail: { requestId, error: message },
        }));
      });
  });

  updateBridgeStatus('ready');
})();
