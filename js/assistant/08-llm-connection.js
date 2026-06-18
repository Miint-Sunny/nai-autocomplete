function buildTestMessages() {
  return [
    { role: 'system', content: 'You are a connection test assistant. Reply with OK only.' },
    { role: 'user', content: [{ type: 'text', text: 'Reply with OK only.' }] },
  ];
}

async function runConnectionCheck(config) {
  const response = await sendRuntimeMessage({
    type: 'nai-llm-chat',
    payload: { primary: config },
  });

  if (!response?.ok) {
    throw new Error(response?.error || '\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25');
  }

  return response;
}

async function testConnection() {
  if (state.pending) return;

  const testMessages = buildTestMessages();
  const primaryConfig = buildPrimaryConfig(testMessages);
  if (!hasCompleteModelConfig(primaryConfig)) {
    setStatus('\u8bf7\u5148\u5b8c\u6574\u914d\u7f6e\u4e3b\u6a21\u578b\u7684\u670d\u52a1\u5546\u3001Endpoint\u3001Model \u548c API Key\u3002', true);
    openPanel('settings');
    return;
  }

  const fallbackConfig = buildFallbackConfig(testMessages);
  if (state.settings.enableFallbackModel && !hasCompleteModelConfig(fallbackConfig)) {
    setStatus(T.statusNeedFallbackConfig, true);
    openPanel('settings');
    return;
  }

  const checks = [{ name: '\u4e3b\u6a21\u578b', config: primaryConfig }];
  if (state.settings.enableFallbackModel && fallbackConfig) {
    checks.push({ name: '\u5907\u7528\u6a21\u578b', config: fallbackConfig });
  }

  setPending(true, '\u6d4b\u8bd5\u4e2d...');
  setStatus(T.statusTestingConnection, false);

  const passed = [];
  const failed = [];

  try {
    for (const check of checks) {
      try {
        await runConnectionCheck(check.config);
        passed.push(`${check.name}\uFF08${check.config.model}\uFF09`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${check.name}\uFF08${check.config.model}\uFF09\uFF1A${message}`);
      }
    }

    if (failed.length) {
      throw new Error(failed.join('\uFF1B'));

    }

    setStatus(`\u8fde\u63a5\u6d4b\u8bd5\u901a\u8fc7\uff1a${passed.join('\u3001')}\u3002`, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setPending(false);
  }
}

function getModelListConfig(kind) {
  const isFallback = kind === 'fallback';
  return {
    providerId: isFallback ? ui.settings.fallbackProviderPreset.value : ui.settings.providerPreset.value,
    protocol: isFallback ? ui.settings.fallbackProtocol.value : ui.settings.protocol.value,
    endpoint: (isFallback ? ui.settings.fallbackEndpoint.value : ui.settings.endpoint.value).trim(),
    apiKey: (isFallback ? ui.settings.fallbackApiKey.value : ui.settings.apiKey.value).trim(),
  };
}

function getLibraryModelListConfig(kind) {
  const isFallback = kind === 'fallback';
  return {
    providerId: isFallback ? ui.library.fallbackProviderPreset?.value : ui.library.providerPreset?.value,
    protocol: isFallback ? ui.library.fallbackProtocol?.value : ui.library.protocol?.value,
    endpoint: String(isFallback ? ui.library.fallbackEndpoint?.value || '' : ui.library.endpoint?.value || '').trim(),
    apiKey: String(isFallback ? ui.library.fallbackApiKey?.value || '' : ui.library.apiKey?.value || '').trim(),
  };
}

function populateModelSuggestions(kind, models) {
  const isFallback = kind === 'fallback';
  const list = isFallback ? ui.settings.fallbackModelList : ui.settings.modelList;
  const input = isFallback ? ui.settings.fallbackModel : ui.settings.model;
  if (!list || !input) return;
  list.innerHTML = models
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join('');
  if (!input.value.trim() && models[0]) {
    input.value = models[0];
  }
}

function populateLibraryModelSuggestions(kind, models) {
  const isFallback = kind === 'fallback';
  const list = isFallback ? ui.library.fallbackModelList : ui.library.modelList;
  const input = isFallback ? ui.library.fallbackModel : ui.library.model;
  if (!list || !input) return;
  list.innerHTML = models
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join('');
  if (!input.value.trim() && models[0]) {
    input.value = models[0];
  }
}

async function fetchModelsFor(kind) {
  const config = getModelListConfig(kind);
  if (!config.endpoint || !config.apiKey) {
    setStatus('\\u8bf7\\u5148\\u586b\\u5199\\u5bf9\\u5e94\\u7684 Endpoint \\u548c API Key\\uff0c\\u518d\\u83b7\\u53d6\\u6a21\\u578b\\u5217\\u8868\\u3002', true);
    return;
  }

  setStatus('\\u6b63\\u5728\\u83b7\\u53d6\\u6a21\\u578b\\u5217\\u8868...', false);
  try {
    const response = await sendRuntimeMessage({
      type: 'nai-list-models',
      payload: config,
    });

    if (!response?.ok) {
      throw new Error(response?.error || '\\u83b7\\u53d6\\u6a21\\u578b\\u5217\\u8868\\u5931\\u8d25');
    }

    const models = Array.isArray(response.models) ? response.models : [];
    populateModelSuggestions(kind, models);
    setStatus(
      models.length
        ? `\u5df2\u52a0\u8f7d ${models.length} \u4e2a\u6a21\u578b\u5019\u9009${kind === 'fallback' ? '\uff08\u5907\u7528\uff09' : ''}\u3002`
        : `\u8be5\u670d\u52a1\u672a\u8fd4\u56de\u53ef\u7528\u6a21\u578b${kind === 'fallback' ? '\uff08\u5907\u7528\uff09' : ''}\u3002`,
      !models.length
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function fetchLibraryModelsFor(kind) {
  const config = getLibraryModelListConfig(kind);
  if (!config.endpoint || !config.apiKey) {
    setStatus('请先填写对应的 Endpoint 和 API Key，再获取模型列表。', true);
    return;
  }

  setStatus('正在获取模型列表...', false);
  try {
    const response = await sendRuntimeMessage({
      type: 'nai-list-models',
      payload: config,
    });

    if (!response?.ok) {
      throw new Error(response?.error || '获取模型列表失败');
    }

    const models = Array.isArray(response.models) ? response.models : [];
    populateLibraryModelSuggestions(kind, models);
    setStatus(
      models.length
        ? `已加载 ${models.length} 个模型候选${kind === 'fallback' ? '（备用）' : ''}。`
        : `该服务未返回可用模型${kind === 'fallback' ? '（备用）' : ''}。`,
      !models.length
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function testLibraryConnection() {
  const previousSettings = state.settings;
  state.settings = { ...DEFAULT_SETTINGS, ...readLibrarySettingsFromInputs() };
  applySettingsToInputs();
  try {
    await testConnection();
  } finally {
    state.settings = previousSettings;
    applySettingsToInputs();
    applyLibrarySettingsToInputs();
  }
}

function getPromptConfig() {
  const preset = getActivePreset();
  const enabledBlocks = preset.blocks.filter((b) => b.enabled);
  const resolvedBlocks = enabledBlocks
    .map((b) => ({ role: b.role, content: resolveVariables(b.content) }))
    .filter((b) => b.content.trim());
  return resolvedBlocks;
}

function isCodeFenceWrapped(text) {
  const trimmed = String(text || '').trim();
  return /^```[\s\S]*```$/.test(trimmed);
}

function wrapWithCodeFence(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (isCodeFenceWrapped(trimmed)) return trimmed;
  return '```\n' + trimmed + '\n```';
}

function formatResultBySettings(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return state.settings.defaultCodeFence ? wrapWithCodeFence(trimmed) : trimmed;
}

