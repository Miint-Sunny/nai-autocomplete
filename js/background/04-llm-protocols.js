// 协议适配层。每家服务商的差异全部收敛在这张表里，
// 上层（transport / runner）只认 buildRequest / parseResult / parseStreamEvent 这几个口子。
//
// 消息用一套中立结构在内部流转，各适配器自己翻译：
//   { role:'system'|'user'|'assistant', content: string | [{type:'text'|'image_url', ...}] }
//   { role:'assistant', toolCalls:[{ id, name, arguments }] }
//   { role:'tool', toolCallId, name, content }

const ANTHROPIC_THINKING_BUDGET = { low: 1024, medium: 4096, high: 8192 };
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 700;

function dataUrlToImageSource(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function parseJsonSafely(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractTextParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
      if (typeof item.text === 'string') return item.text;
      if (typeof item.output_text === 'string') return item.output_text;
      return '';
    })
    .filter(Boolean);
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickTemperature(config) {
  return numberOr(config.temperature, DEFAULT_TEMPERATURE);
}

function pickMaxTokens(config) {
  return numberOr(config.maxTokens, DEFAULT_MAX_TOKENS);
}

// 三家的字段名互不相同，统一成 input/output/total 再往上报。
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = numberOr(usage.prompt_tokens, numberOr(usage.input_tokens, null));
  const output = numberOr(usage.completion_tokens, numberOr(usage.output_tokens, null));
  const total = numberOr(usage.total_tokens, input != null && output != null ? input + output : null);
  if (input == null && output == null && total == null) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function withExtras(body, config) {
  return config.extraBody && typeof config.extraBody === 'object'
    ? { ...body, ...config.extraBody }
    : body;
}

function withExtraHeaders(headers, config) {
  return config.extraHeaders && typeof config.extraHeaders === 'object'
    ? { ...headers, ...config.extraHeaders }
    : headers;
}

function jsonRequest(url, headers, body, config) {
  return {
    url,
    options: {
      method: 'POST',
      headers: withExtraHeaders({ 'Content-Type': 'application/json', ...headers }, config),
      body: JSON.stringify(withExtras(body, config)),
    },
  };
}

// ─────────────────────────── OpenAI Chat Completions ───────────────────────────

// DeepSeek V4 默认就开着 thinking 且是高档，不显式关会白白拖慢反推。
// 其余家默认不带思考字段 —— 给不支持的服务商发未知字段会直接 400。
function applyReasoningToOpenAIBody(body, config) {
  const effort = config.reasoningEffort || 'off';
  const isDeepSeek = config.providerId === 'deepseek';

  if (effort === 'off') {
    if (isDeepSeek) body.thinking = { type: 'disabled' };
    return body;
  }

  body.reasoning_effort = effort;
  if (isDeepSeek) body.thinking = { type: 'enabled' };
  return body;
}

function buildOpenAIChatMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      };
    }

    if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      };
    }

    if (!Array.isArray(message.content)) return message;

    return {
      role: message.role,
      content: message.content.map((item) => {
        if (item.type === 'text') return { type: 'text', text: item.text };
        if (item.type === 'image_url') {
          return { type: 'image_url', image_url: { url: item.image_url?.url || '' } };
        }
        return item;
      }),
    };
  });
}

function parseOpenAIToolCalls(message) {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls
    .map((call) => ({
      id: call.id || '',
      name: call.function?.name || call.name || '',
      arguments: parseJsonSafely(call.function?.arguments) ?? {},
    }))
    .filter((call) => call.name);
}

const OPENAI_CHAT_ADAPTER = {
  id: 'openai-chat',
  label: 'OpenAI Chat Completions',
  supportsTools: true,
  supportsNativeJson: true,

  buildRequest(config) {
    const body = {
      model: config.model,
      messages: buildOpenAIChatMessages(config.messages),
      temperature: pickTemperature(config),
      max_tokens: pickMaxTokens(config),
      stream: Boolean(config.stream),
    };

    applyReasoningToOpenAIBody(body, config);

    if (config.responseFormat === 'json') {
      body.response_format = config.jsonSchema
        ? { type: 'json_schema', json_schema: { name: config.jsonSchema.name || 'result', schema: config.jsonSchema.schema, strict: true } }
        : { type: 'json_object' };
    }

    if (Array.isArray(config.tools) && config.tools.length) {
      body.tools = config.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {} } },
      }));
      if (config.toolChoice) body.tool_choice = config.toolChoice;
    }

    return jsonRequest(config.endpoint, { Authorization: `Bearer ${config.apiKey}` }, body, config);
  },

  parseResult(data) {
    const message = data?.choices?.[0]?.message;
    const content = message?.content;
    let text = '';
    if (typeof content === 'string') text = content.trim();
    else if (Array.isArray(content)) text = extractTextParts(content).join('\n').trim();

    return {
      text,
      toolCalls: parseOpenAIToolCalls(message),
      usage: normalizeUsage(data?.usage),
      finishReason: data?.choices?.[0]?.finish_reason || '',
    };
  },

  parseStreamEvent(payload) {
    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) return { text: delta };
    if (Array.isArray(delta)) return { text: extractTextParts(delta).join('') };
    return null;
  },

  buildModelsRequest(config) {
    return {
      url: deriveModelsEndpoint(config),
      options: { method: 'GET', headers: withExtraHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, config) },
    };
  },
};

// ─────────────────────────────── Responses API ───────────────────────────────

function buildResponsesInput(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      };
    }

    if (!Array.isArray(message.content)) {
      return { role: message.role, content: [{ type: 'input_text', text: String(message.content || '') }] };
    }

    return {
      role: message.role,
      content: message.content.map((item) => {
        if (item.type === 'text') return { type: 'input_text', text: item.text };
        if (item.type === 'image_url') return { type: 'input_image', image_url: item.image_url?.url || '' };
        return item;
      }),
    };
  });
}

const RESPONSES_ADAPTER = {
  id: 'responses',
  label: 'Responses API',
  supportsTools: true,
  supportsNativeJson: true,

  buildRequest(config) {
    const body = {
      model: config.model,
      input: buildResponsesInput(config.messages),
      temperature: pickTemperature(config),
      max_output_tokens: pickMaxTokens(config),
      stream: Boolean(config.stream),
    };

    // Responses 只认 low/high 两档，中档往上取。
    const effort = config.reasoningEffort || 'off';
    if (effort !== 'off') body.reasoning = { effort: effort === 'medium' ? 'high' : effort };

    if (config.responseFormat === 'json') {
      body.text = {
        format: config.jsonSchema
          ? { type: 'json_schema', name: config.jsonSchema.name || 'result', schema: config.jsonSchema.schema, strict: true }
          : { type: 'json_object' },
      };
    }

    if (Array.isArray(config.tools) && config.tools.length) {
      body.tools = config.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} },
      }));
    }

    return jsonRequest(config.endpoint, { Authorization: `Bearer ${config.apiKey}` }, body, config);
  },

  parseResult(data) {
    let text = typeof data?.output_text === 'string' ? data.output_text.trim() : '';
    const toolCalls = [];

    if (Array.isArray(data?.output)) {
      const collected = [];
      for (const item of data.output) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'function_call') {
          toolCalls.push({
            id: item.call_id || item.id || '',
            name: item.name || '',
            arguments: parseJsonSafely(item.arguments) ?? {},
          });
          continue;
        }
        collected.push(...(Array.isArray(item.content) ? extractTextParts(item.content) : extractTextParts([item])));
      }
      if (!text) text = collected.join('\n').trim();
    }

    return {
      text,
      toolCalls: toolCalls.filter((call) => call.name),
      usage: normalizeUsage(data?.usage),
      finishReason: data?.status || '',
    };
  },

  parseStreamEvent(payload) {
    if (payload?.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      return { text: payload.delta };
    }
    if (payload?.type === 'response.completed' && payload.response) {
      return { text: '', final: payload.response };
    }
    return null;
  },

  buildModelsRequest: OPENAI_CHAT_ADAPTER.buildModelsRequest,
};

// ───────────────────────────── Anthropic Messages ─────────────────────────────

function buildAnthropicMessages(config) {
  const systemParts = [];
  const conversation = [];

  const pushTurn = (role, content) => {
    const last = conversation[conversation.length - 1];
    // Anthropic 不接受连续同角色的两条消息，合并进上一条。
    if (last && last.role === role) last.content.push(...content);
    else conversation.push({ role, content });
  };

  for (const message of config.messages || []) {
    if (message.role === 'tool') {
      pushTurn('user', [{
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      }]);
      continue;
    }

    if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
      pushTurn('assistant', message.toolCalls.map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.arguments ?? {},
      })));
      continue;
    }

    const items = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: String(message.content || '') }];

    const parts = [];
    for (const item of items) {
      if (item.type === 'text') {
        if (message.role === 'system') systemParts.push(item.text);
        else parts.push({ type: 'text', text: item.text });
        continue;
      }
      if (item.type === 'image_url' && message.role !== 'system') {
        const source = dataUrlToImageSource(item.image_url?.url || '');
        if (source) {
          parts.push({ type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.data } });
        }
      }
    }

    if (parts.length) pushTurn(message.role === 'assistant' ? 'assistant' : 'user', parts);
  }

  if (!conversation.length) conversation.push({ role: 'user', content: [{ type: 'text', text: '' }] });
  return { systemText: systemParts.join('\n\n').trim(), conversation };
}

const ANTHROPIC_ADAPTER = {
  id: 'anthropic-messages',
  label: 'Anthropic Messages API',
  supportsTools: true,
  supportsNativeJson: false,

  buildRequest(config) {
    const { systemText, conversation } = buildAnthropicMessages(config);
    const maxTokens = pickMaxTokens(config);
    const budget = ANTHROPIC_THINKING_BUDGET[config.reasoningEffort];

    const body = {
      model: config.model,
      system: systemText || undefined,
      messages: conversation,
      max_tokens: budget ? maxTokens + budget : maxTokens,
      stream: Boolean(config.stream),
    };

    // 开了 extended thinking 时 Anthropic 不接受 temperature，
    // 且 max_tokens 必须大于 budget_tokens。
    if (budget) body.thinking = { type: 'enabled', budget_tokens: budget };
    else body.temperature = pickTemperature(config);

    if (Array.isArray(config.tools) && config.tools.length) {
      body.tools = config.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.parameters || { type: 'object', properties: {} },
      }));
    }

    // Anthropic 没有 JSON 模式。预填一个 "{" 逼它直接进对象，
    // 但开了思考不能预填，那时只能靠提示词 + 宽松解析兜。
    const jsonPrefill = config.responseFormat === 'json' && !budget && !body.tools;
    if (jsonPrefill) {
      body.messages = [...conversation, { role: 'assistant', content: [{ type: 'text', text: '{' }] }];
    }

    const request = jsonRequest(
      config.endpoint,
      { 'x-api-key': config.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body,
      config,
    );
    request.jsonPrefill = jsonPrefill;
    return request;
  },

  parseResult(data, request) {
    const content = Array.isArray(data?.content) ? data.content : [];
    let text = extractTextParts(content).join('\n').trim();
    if (request?.jsonPrefill && text && !text.startsWith('{')) text = `{${text}`;

    const toolCalls = content
      .filter((item) => item?.type === 'tool_use')
      .map((item) => ({ id: item.id || '', name: item.name || '', arguments: item.input ?? {} }))
      .filter((call) => call.name);

    return { text, toolCalls, usage: normalizeUsage(data?.usage), finishReason: data?.stop_reason || '' };
  },

  parseStreamEvent(payload) {
    if (payload?.type === 'content_block_delta') {
      const delta = payload.delta;
      if (typeof delta?.text === 'string') return { text: delta.text };
      return { text: '' };
    }
    if (payload?.type === 'message_stop' && payload.message) return { text: '', final: payload.message };
    return null;
  },

  buildModelsRequest(config) {
    return {
      url: deriveModelsEndpoint(config),
      options: {
        method: 'GET',
        headers: withExtraHeaders(
          { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
          config,
        ),
      },
    };
  },
};

const LLM_PROTOCOLS = {
  'openai-chat': OPENAI_CHAT_ADAPTER,
  responses: RESPONSES_ADAPTER,
  'anthropic-messages': ANTHROPIC_ADAPTER,
};

function getProtocolAdapter(protocol) {
  return LLM_PROTOCOLS[protocol] || OPENAI_CHAT_ADAPTER;
}

// 中转站什么都可能返回，适配器认不出时再走一遍通用兜底，
// 免得一个没见过的响应形状就让整轮反推报「空结果」。
function extractAssistantTextLoosely(data) {
  if (!data || typeof data !== 'object') return '';
  for (const adapter of [OPENAI_CHAT_ADAPTER, ANTHROPIC_ADAPTER, RESPONSES_ADAPTER]) {
    const text = adapter.parseResult(data)?.text;
    if (text) return text;
  }
  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  return '';
}

function extractStreamTextLoosely(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload?.choices?.[0]?.delta?.content,
    typeof payload.delta === 'string' ? payload.delta : payload?.delta?.text,
    payload.output_text,
    payload.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (Array.isArray(candidate)) {
      const text = extractTextParts(candidate).join('');
      if (text) return text;
    }
  }
  return '';
}
