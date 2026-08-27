function buildTestMessages() {
  return [
    { role: 'system', content: 'You are a connection test assistant. Reply with OK only.' },
    { role: 'user', content: [{ type: 'text', text: 'Reply with OK only.' }] },
  ];
}

async function runConnectionCheck(config) {
  const response = await sendRuntimeMessage({
    type: 'nai-llm-chat',
    // 连接测试不该等满默认的 90 秒 —— 通不通 25 秒内一定有答案。
    timeoutMs: 25000,
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
    openSettingsSurface();
    return;
  }

  const fallbackConfig = buildFallbackConfig(testMessages);
  if (state.settings.enableFallbackModel && !hasCompleteModelConfig(fallbackConfig)) {
    setStatus(T.statusNeedFallbackConfig, true);
    openSettingsSurface();
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

// 抓回来的模型只进 <datalist> 是不够的：datalist 展开时**会按输入框当前的值过滤**。
// 而选服务商预设时模型框已经被填成了预设的 defaultModel，于是：
//   · 那个 id 不在返回列表里 → 下拉一条不剩，看起来像「没抓到」
//   · 那个 id 恰好**在**列表里 → 下拉只剩它自己
// DeepSeek 撞的是后一种：它返回 deepseek-v4-flash / -pro / -flash-vision-exp 三个，
// 而输入框里预填的正是第三个，另外两个都不含这个子串，于是被过滤光 ——
// 用户看到的就是「获取不到模型，只能抓到 DeepSeek-V4-Flash-Vision-Exp」。
//
// 所以抓完之后把模型**直接摆成可点的胶囊**，不再指望那个看不见又会过滤的下拉。
const MODEL_CHIP_LIMIT = 24;

function renderModelChips(container, models, currentModel) {
  if (!container) return;
  if (!models.length) {
    container.innerHTML = '';
    return;
  }

  const current = String(currentModel || '').trim();
  const shown = models.slice(0, MODEL_CHIP_LIMIT);
  const rest = models.length - shown.length;

  container.innerHTML = shown
    .map((model) => `<button type="button" class="nai-md3-inline-action nai-model-chip${model === current ? ' is-active' : ''}" data-action="pick-model" data-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`)
    .join('') + (rest > 0 ? `<span class="nai-model-chips-rest">还有 ${rest} 个，可在输入框里直接打</span>` : '');
}

// 胶囊点了就填进对应的那个模型框（面板 / 抽屉、主 / 备用四种组合）
function applyModelChip(target) {
  const model = target?.dataset?.model;
  const container = target?.closest?.('.nai-model-chips');
  if (!model || !container) return;

  const inDrawer = Boolean(container.closest('.nai-library-drawer'));
  const isFallback = container.dataset.kind === 'fallback';
  const group = inDrawer ? ui.library : ui.settings;
  const input = isFallback ? group.fallbackModel : group.model;
  if (!input) return;

  input.value = model;
  container.querySelectorAll('.nai-model-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.model === model);
  });
  setStatus(`已选择模型 ${model}${isFallback ? '（备用）' : ''}，别忘了保存设置。`, false);
}

function describeModelFetch(models, currentModel, kind) {
  const suffix = kind === 'fallback' ? '（备用）' : '';
  if (!models.length) return { text: `该服务未返回可用模型${suffix}。`, isError: true };

  const current = String(currentModel || '').trim();
  if (current && !models.includes(current)) {
    return {
      text: `已加载 ${models.length} 个模型候选${suffix}，但当前填的「${current}」不在其中 —— 从下面的列表里挑一个。`,
      isError: true,
    };
  }

  return { text: `已加载 ${models.length} 个模型候选${suffix}，在下面直接点选。`, isError: false };
}

async function fetchModelsFor(kind) {
  const config = getModelListConfig(kind);
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
    const input = kind === 'fallback' ? ui.settings.fallbackModel : ui.settings.model;
    populateModelSuggestions(kind, models);
    renderModelChips(kind === 'fallback' ? ui.settings.fallbackModelChips : ui.settings.modelChips, models, input?.value);
    const report = describeModelFetch(models, input?.value, kind);
    setStatus(report.text, report.isError);
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
    const input = kind === 'fallback' ? ui.library.fallbackModel : ui.library.model;
    populateLibraryModelSuggestions(kind, models);
    renderModelChips(kind === 'fallback' ? ui.library.fallbackModelChips : ui.library.modelChips, models, input?.value);
    const report = describeModelFetch(models, input?.value, kind);
    setStatus(report.text, report.isError);
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

