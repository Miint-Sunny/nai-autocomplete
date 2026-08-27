// 调度层：校验配置、跑单次请求、按错误类型决定要不要切备用模型，
// 另外提供 JSON 结构化输出和工具循环两个原语（Agent 用）。

const LLM_DEBUG_LOG_LIMIT = 20;
const llmDebugLog = [];
const activeLlmRuns = new Map();

function describeProvider(config) {
  return config?.label || config?.providerId || config?.protocol || 'custom';
}

// 本机 / 内网 endpoint（ollama、llama.cpp、LM Studio）通常不校验 Key，
// 逼用户填一个假 Key 纯属折腾。
function endpointAllowsEmptyKey(endpoint) {
  try {
    const { hostname } = new URL(endpoint);
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(hostname)
      || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)
      || hostname.endsWith('.local');
  } catch (error) {
    return false;
  }
}

function validateLlmConfig(config) {
  const missing = [];
  if (!config?.endpoint) missing.push('Endpoint');
  if (!config?.model) missing.push('模型');
  if (!config?.apiKey && !endpointAllowsEmptyKey(config?.endpoint)) missing.push('API Key');
  if (!Array.isArray(config?.messages) || !config.messages.length) missing.push('消息内容');

  if (missing.length) {
    throw new LlmError(LLM_ERROR.CONFIG, `${describeProvider(config)} 配置不完整，缺少：${missing.join('、')}。`, {
      providerLabel: describeProvider(config),
      model: config?.model || '',
    });
  }
}

// 流式响应里「最终帧」的形状各家不同；同时顺手把任意一帧上的 usage 捞出来，
// OpenAI 的用量只在最后一个 chunk 里。
function resolveStreamFinal(events) {
  let final = null;
  let usage = null;

  for (const payload of events) {
    if (payload?.type === 'response.completed' && payload.response) final = payload.response;
    else if (payload?.type === 'message_stop' && payload.message) final = payload.message;
    else final = payload;

    const candidate = normalizeUsage(payload?.usage || payload?.response?.usage || payload?.message?.usage);
    if (candidate) usage = candidate;
  }

  return { final, usage };
}

function buildEmptyResultError(finishReason, config) {
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    return new LlmError(LLM_ERROR.EMPTY, '模型在写完之前就撞到了 max_tokens 上限，没有留下正文。', {
      hint: '把「思考模式」调低或关闭，或调大 max_tokens —— 思考过程也算在这个额度里。',
    });
  }
  if (finishReason === 'content_filter' || finishReason === 'safety') {
    return new LlmError(LLM_ERROR.EMPTY, '内容被服务商的安全策略拦下了，没有返回正文。', {
      hint: '换一张图或换一家服务商再试。',
    });
  }
  return new LlmError(LLM_ERROR.EMPTY, `${describeProvider(config)} 返回了 200，但正文是空的。`);
}

async function runLlmRequest(config, options = {}) {
  validateLlmConfig(config);

  const adapter = getProtocolAdapter(config.protocol);
  const request = adapter.buildRequest(config);
  const secrets = [config.apiKey, ...(options.secrets || [])].filter(Boolean);
  const clock = options.now || (() => Date.now());
  const startedAt = clock();

  let streamedText = '';
  const retries = [];

  const httpResult = await llmHttp(request, {
    ...options,
    secrets,
    config,
    onRetry: (info) => {
      retries.push({ attempt: info.attempt, delayMs: info.delayMs, kind: info.error.kind, status: info.error.status });
      options.onRetry?.(info);
    },
    onEvent: (payload) => {
      const parsed = adapter.parseStreamEvent(payload);
      const text = parsed?.text ?? extractStreamTextLoosely(payload);
      if (!text) return;
      streamedText += text;
      options.onDelta?.(text);
    },
  });

  let data = null;
  let parsed = null;
  let text = '';
  let usage = null;

  if (httpResult.isEventStream) {
    const { final, usage: streamUsage } = resolveStreamFinal(httpResult.events);
    data = final || { stream: true };
    parsed = final ? adapter.parseResult(final, request) : null;
    text = streamedText.trim() || parsed?.text || '';
    usage = streamUsage || parsed?.usage || null;
  } else {
    data = parseJsonSafely(httpResult.rawText);

    if (!data) {
      const raw = String(httpResult.rawText || '').trim();
      if (/^</.test(raw)) {
        throw new LlmError(LLM_ERROR.PARSE, `${describeProvider(config)} 返回的是 HTML 而不是 JSON，多半是中转站或代理的错误页。`);
      }
      // 少数中转站直接吐纯文本，这种照旧当成正文收下。
      text = raw;
      data = httpResult.rawText;
    } else {
      parsed = adapter.parseResult(data, request);
      text = parsed.text || extractAssistantTextLoosely(data);
      usage = parsed.usage;
    }
  }

  const toolCalls = parsed?.toolCalls || [];
  const finishReason = parsed?.finishReason || '';

  if (!text && !toolCalls.length) {
    const error = buildEmptyResultError(finishReason, config);
    error.providerLabel = describeProvider(config);
    error.model = config.model;
    throw error;
  }

  return {
    text,
    toolCalls,
    usage,
    finishReason,
    raw: data,
    streamed: httpResult.isEventStream,
    attempt: httpResult.attempt,
    retries,
    durationMs: clock() - startedAt,
    providerLabel: describeProvider(config),
    model: config.model,
    endpoint: config.endpoint,
  };
}

function pushLlmDebugLog(entry) {
  llmDebugLog.unshift(entry);
  if (llmDebugLog.length > LLM_DEBUG_LOG_LIMIT) llmDebugLog.length = LLM_DEBUG_LOG_LIMIT;
}

function summarizeMessagesForLog(messages) {
  if (!Array.isArray(messages)) return { turns: 0, images: 0, chars: 0 };
  let images = 0;
  let chars = 0;

  for (const message of messages) {
    const items = Array.isArray(message?.content) ? message.content : [{ type: 'text', text: String(message?.content || '') }];
    for (const item of items) {
      if (item?.type === 'image_url') images += 1;
      else if (typeof item?.text === 'string') chars += item.text.length;
    }
  }

  return { turns: messages.length, images, chars };
}

// 主备切换只实现一次。runLlmWithFallback 和 Agent 的工具循环都套这一层，
// 免得「什么错该换家」的判断在两个地方各写一遍、然后慢慢走岔。
async function runConfigChain(configs, attempt, options = {}) {
  const attempts = [];
  let lastError = null;

  for (let index = 0; index < configs.length; index += 1) {
    const config = configs[index];

    try {
      const value = await attempt(config, index);
      pushLlmDebugLog({
        at: Date.now(),
        ok: true,
        providerLabel: describeProvider(config),
        model: config.model,
        protocol: config.protocol,
        durationMs: value?.durationMs,
        httpAttempts: value?.attempt,
        usage: value?.usage,
        usedFallback: index > 0,
        kind: options.kind || 'chat',
        input: summarizeMessagesForLog(config.messages),
        outputChars: typeof value?.text === 'string' ? value.text.length : 0,
      });
      return { ok: true, value, config, index, attempts };
    } catch (error) {
      const llmError = asLlmError(error);
      llmError.providerLabel = llmError.providerLabel || describeProvider(config);
      llmError.model = llmError.model || config.model || '';
      lastError = llmError;

      attempts.push({
        label: llmError.providerLabel,
        model: llmError.model,
        error: llmError.toDisplayString(),
        kind: llmError.kind,
        status: llmError.status,
        httpAttempts: llmError.attempt,
      });

      pushLlmDebugLog({
        at: Date.now(),
        ok: false,
        providerLabel: llmError.providerLabel,
        model: llmError.model,
        protocol: config.protocol,
        kind: llmError.kind,
        status: llmError.status,
        message: llmError.message,
        usedFallback: index > 0,
        input: summarizeMessagesForLog(config.messages),
      });

      // 用户取消：再换一家也是白跑，直接把错误交出去。
      if (!llmError.failoverable) break;
    }
  }

  return { ok: false, error: lastError, attempts };
}

function formatChainFailure(chain, startedAt, now) {
  return {
    ok: false,
    error: chain.error ? chain.error.toDisplayString() : 'LLM 请求失败',
    errorKind: chain.error?.kind || LLM_ERROR.UNKNOWN,
    errorHint: chain.error?.hint || '',
    durationMs: now() - startedAt,
    attempts: chain.attempts,
  };
}

// payload: { primary, fallback }
// 返回结构对前端保持向后兼容，只做加法（usage / errorKind / usedFallback 等）。
async function runLlmWithFallback(payload, options = {}) {
  const configs = [payload?.primary, payload?.fallback].filter(Boolean);
  const now = options.now || (() => Date.now());
  const startedAt = now();

  if (!configs.length) {
    return { ok: false, error: '未提供模型配置。', errorKind: LLM_ERROR.CONFIG, attempts: [] };
  }

  const chain = await runConfigChain(configs, (config) => runLlmRequest(config, options), options);
  if (!chain.ok) return formatChainFailure(chain, startedAt, now);

  const result = chain.value;
  return {
    ok: true,
    text: result.text,
    raw: result.raw,
    providerLabel: result.providerLabel,
    usedModel: result.model,
    usedEndpoint: result.endpoint,
    usedFallback: chain.index > 0,
    usage: result.usage,
    finishReason: result.finishReason,
    durationMs: result.durationMs,
    httpAttempts: result.attempt,
    retries: result.retries,
    attempts: chain.attempts,
  };
}

// ───────────────────────────── 取消：运行登记表 ─────────────────────────────

function registerLlmRun(runId) {
  if (!runId) return null;
  cancelLlmRun(runId);
  const controller = new AbortController();
  activeLlmRuns.set(runId, controller);
  return controller;
}

function releaseLlmRun(runId) {
  if (runId) activeLlmRuns.delete(runId);
}

function cancelLlmRun(runId) {
  const controller = activeLlmRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  activeLlmRuns.delete(runId);
  return true;
}

// ───────────────────────────── 结构化 JSON 输出 ─────────────────────────────

// 模型很爱把 JSON 包在 ``` 里，或者前后带一句「好的，这是结果：」。
// 扫一遍括号配对（并跳过字符串内的括号）比正则可靠。
function extractJsonBlock(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const direct = parseJsonSafely(unfenced);
  if (direct && typeof direct === 'object') return direct;

  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = unfenced.indexOf(open);
    if (start < 0) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < unfenced.length; i += 1) {
      const char = unfenced[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === open) depth += 1;
      else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          const candidate = parseJsonSafely(unfenced.slice(start, i + 1));
          if (candidate && typeof candidate === 'object') return candidate;
          break;
        }
      }
    }
  }

  return null;
}

// 一次修复往返：把原文和解析失败的事实回喂给模型。
// 再多轮就不划算了 —— 两次还给不出 JSON 的模型，第三次通常也给不出。
async function runLlmJson(config, options = {}) {
  const jsonConfig = { ...config, responseFormat: 'json' };
  const first = await runLlmRequest(jsonConfig, options);
  const value = extractJsonBlock(first.text);
  if (value) return { value, text: first.text, result: first, repaired: false };

  if (options.repair === false) {
    throw new LlmError(LLM_ERROR.PARSE, `${describeProvider(config)} 没有返回可解析的 JSON。`, {
      hint: '换一个支持 JSON 模式的模型，或降低思考档位。',
    });
  }

  const repairConfig = {
    ...jsonConfig,
    messages: [
      ...config.messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content: [{
          type: 'text',
          text: '上一条回复不是合法 JSON。请只输出 JSON 本体，不要代码框、不要解释、不要前后缀。',
        }],
      },
    ],
  };

  const second = await runLlmRequest(repairConfig, options);
  const repairedValue = extractJsonBlock(second.text);

  if (!repairedValue) {
    throw new LlmError(LLM_ERROR.PARSE, `${describeProvider(config)} 连续两次都没有返回可解析的 JSON。`, {
      hint: '换一个支持 JSON 模式的模型，或降低思考档位。',
    });
  }

  return { value: repairedValue, text: second.text, result: second, repaired: true };
}

// ─────────────────────────────── 工具循环 ───────────────────────────────

// Agent 的最小执行体：模型要工具就执行，拿到结果继续，直到它给出正文。
// maxSteps 是硬闸 —— 模型陷进「反复调同一个工具」时得有人喊停。
async function runLlmToolLoop(spec, options = {}) {
  const { config, tools = [], executeTool, maxSteps = 4 } = spec;
  const messages = [...(config.messages || [])];
  const steps = [];
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let sawUsage = false;
  let totalDuration = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    const result = await runLlmRequest({ ...config, messages, tools }, options);
    totalDuration += result.durationMs || 0;
    if (result.usage) {
      sawUsage = true;
      for (const key of Object.keys(totalUsage)) totalUsage[key] += result.usage[key] || 0;
    }

    if (!result.toolCalls.length) {
      // 用量按整轮累加 —— 工具循环里一次「请求」其实是好几次调用，只报最后一次会骗人。
      return {
        text: result.text,
        messages,
        steps,
        result,
        stoppedBy: 'final',
        usage: sawUsage ? totalUsage : null,
        durationMs: totalDuration,
        attempt: result.attempt,
        providerLabel: result.providerLabel,
        model: result.model,
        endpoint: result.endpoint,
      };
    }

    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      let output;
      try {
        output = await executeTool(call);
      } catch (error) {
        // 工具报错要喂回给模型，而不是炸掉整轮 —— 它往往能换个参数重试。
        output = { error: error instanceof Error ? error.message : String(error) };
      }

      const content = typeof output === 'string' ? output : JSON.stringify(output ?? null);
      steps.push({ step, name: call.name, arguments: call.arguments, output: content });
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
    }

    spec.onStep?.({ step, toolCalls: result.toolCalls, steps });
  }

  // 步数用完不等于这一轮没结果：前面每一步查到的东西都还在 messages 里，
  // 模型只是没在限定步数内收口（查证型任务尤其容易 —— 它会一个词一个词地核）。
  //
  // 以前这里直接抛错，等于把已经花掉的 token 和几十次查询全丢掉，
  // 用户只拿到一句「没收敛」。现在收口再问一次。
  //
  // 光把 tools 拿掉不够 —— 实测 DeepSeek 会把工具调用的原始标记当正文吐出来
  // （`<｜｜DSML｜｜tool_calls>…`），因为它「还想调」却没得调。
  // 必须同时用一句 user 消息明说到此为止，它才会真的收口给结果。
  messages.push({
    role: 'user',
    content: '查证到此为止，不要再调用任何工具，也不要输出任何工具调用格式的内容。'
      + '现在直接给出最终结果，就用你手上已经查到的材料；仍然拿不准的词在结果里标注一下即可。',
  });

  const finalResult = await runLlmRequest({ ...config, messages, tools: [] }, options);
  totalDuration += finalResult.durationMs || 0;
  if (finalResult.usage) {
    sawUsage = true;
    for (const key of Object.keys(totalUsage)) totalUsage[key] += finalResult.usage[key] || 0;
  }

  return {
    text: finalResult.text,
    messages,
    steps,
    result: finalResult,
    stoppedBy: 'max-steps',
    usage: sawUsage ? totalUsage : null,
    durationMs: totalDuration,
    attempt: finalResult.attempt,
    providerLabel: finalResult.providerLabel,
    model: finalResult.model,
    endpoint: finalResult.endpoint,
  };
}
