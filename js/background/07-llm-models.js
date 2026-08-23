// 模型列表。走同一套 transport，所以超时/重试/错误分类和聊天请求一致。

function deriveModelsEndpoint(config) {
  const endpointUrl = new URL(config.endpoint);

  if (config.providerId === 'gemini-openai') {
    endpointUrl.pathname = '/v1beta/models';
    endpointUrl.search = '';
    endpointUrl.searchParams.set('key', config.apiKey);
    return endpointUrl.toString();
  }

  let path = endpointUrl.pathname;
  path = path.replace(/\/(chat\/completions|responses|messages)\/?$/, '/models');
  if (!/\/models\/?$/.test(path)) {
    path = `${path.replace(/\/+$/, '')}/models`;
  }
  endpointUrl.pathname = path;
  endpointUrl.search = '';
  return endpointUrl.toString();
}

function buildModelsRequestConfig(config) {
  // Gemini 把 Key 放在 query 上，不带 Authorization 头。
  if (config.providerId === 'gemini-openai') {
    return {
      url: deriveModelsEndpoint(config),
      options: { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    };
  }

  return getProtocolAdapter(config.protocol).buildModelsRequest(config);
}

function extractModelIds(data) {
  if (Array.isArray(data?.data)) {
    return data.data.map((item) => (item && typeof item.id === 'string' ? item.id : '')).filter(Boolean);
  }

  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (typeof item.id === 'string') return item.id;
        if (typeof item.name === 'string') return item.name.replace(/^models\//, '');
        return '';
      })
      .filter(Boolean);
  }

  return [];
}

async function listModels(config, options = {}) {
  if (!config?.endpoint) {
    throw new LlmError(LLM_ERROR.CONFIG, '请先填写 Endpoint。');
  }
  if (!config?.apiKey && !endpointAllowsEmptyKey(config.endpoint)) {
    throw new LlmError(LLM_ERROR.CONFIG, '请先填写 API Key。');
  }

  const request = buildModelsRequestConfig(config);
  const result = await llmHttp(request, {
    timeoutMs: numberOr(options.timeoutMs, 20000),
    signal: options.signal,
    secrets: [config.apiKey].filter(Boolean),
    retry: { maxAttempts: 2, ...(options.retry || {}) },
    sleep: options.sleep,
    random: options.random,
    now: options.now,
  });

  const data = parseJsonSafely(result.rawText);
  if (!data) {
    throw new LlmError(LLM_ERROR.PARSE, '模型列表接口没有返回 JSON。');
  }

  const models = Array.from(new Set(extractModelIds(data))).sort((a, b) => a.localeCompare(b));
  return { models, raw: data };
}
