// 传输层：超时、取消、重试退避、SSE 增量读取。
// 它只关心「怎么把一个请求送出去并安全地拿回字节」，不认识任何服务商。

const LLM_TIMEOUT_DEFAULT_MS = 90000;

const LLM_RETRY_DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 600,
  maxDelayMs: 6000,
  // 服务端说要等 60 秒时不能真等 —— 用户盯着面板，切备用模型比干等快。
  maxRetryAfterMs: 15000,
};

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 外部取消信号和自己的超时合成一个 signal，并且能区分是哪一种触发的：
// 「用户取消」不该重试也不该切备用，「超时」两者都该做。
function createDeadline(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;

  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (timer != null) clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', onExternalAbort);
    },
  };
}

// SSE 必须按块喂：一次性 await text() 就拿不到增量，
// 面板上的「正在生成」也就永远只能转圈。
function createSseParser(onPayload) {
  let buffer = '';

  const emitBlock = (block) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) return;
    const payloadText = dataLines.join('\n').trim();
    if (!payloadText || payloadText === '[DONE]') return;

    const payload = parseJsonSafely(payloadText);
    if (payload) onPayload(payload);
  };

  return {
    push(chunk) {
      buffer += chunk;
      for (;;) {
        const match = buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index;
        emitBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + match[0].length);
      }
    },
    flush() {
      if (buffer.trim()) emitBlock(buffer);
      buffer = '';
    },
  };
}

async function readResponseText(response, onChunk) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (text) onChunk?.(text);
    return text;
  }

  const decoder = new TextDecoder();
  let full = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
    if (!chunk) continue;
    full += chunk;
    onChunk?.(chunk);
  }

  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onChunk?.(tail);
  }

  return full;
}

// 有的中转站把 SSE 标成 text/plain，光看 content-type 会当成 JSON 解析失败。
function looksLikeEventStream(contentType, rawText) {
  if (contentType.includes('text/event-stream')) return true;
  return /^\s*(data|event):/m.test(String(rawText || '').slice(0, 512));
}

async function performLlmRequest(request, ctx) {
  const deadline = createDeadline(ctx.signal, ctx.timeoutMs);
  const events = [];
  let response;
  let rawText = '';

  const toTransportError = (error) => {
    if (deadline.timedOut) {
      return new LlmError(LLM_ERROR.TIMEOUT, `请求超过 ${Math.round(ctx.timeoutMs / 1000)} 秒未返回，已中止。`);
    }
    if (isAbortError(error)) return new LlmError(LLM_ERROR.ABORTED, '请求已取消。');
    return new LlmError(
      LLM_ERROR.NETWORK,
      redactSecrets(buildFetchFailureMessage(request.url, error), ctx.secrets),
    );
  };

  try {
    try {
      response = await fetch(request.url, { ...request.options, signal: deadline.signal });
    } catch (error) {
      throw toTransportError(error);
    }

    const contentType = response.headers?.get?.('content-type') || '';
    const streaming = contentType.includes('text/event-stream');
    const parser = streaming ? createSseParser((payload) => {
      events.push(payload);
      ctx.onEvent?.(payload);
    }) : null;

    try {
      rawText = await readResponseText(response, parser ? (chunk) => parser.push(chunk) : null);
      parser?.flush();
    } catch (error) {
      throw toTransportError(error);
    }

    // content-type 撒谎时补一次整体解析。事件照样往上抛（只是一次性到齐而不是增量），
    // 否则上层会因为 streamedText 为空而误报「模型返回了空」。
    if (!streaming && looksLikeEventStream(contentType, rawText)) {
      const late = createSseParser((payload) => {
        events.push(payload);
        ctx.onEvent?.(payload);
      });
      late.push(rawText);
      late.flush();
    }

    if (!response.ok) {
      const data = parseJsonSafely(rawText);
      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'), ctx.now());
      const message = extractErrorMessage(data, `请求失败：HTTP ${response.status}`);
      throw new LlmError(classifyHttpStatus(response.status), redactSecrets(message, ctx.secrets), {
        status: response.status,
        retryAfterMs,
      });
    }

    return { response, rawText, events, isEventStream: events.length > 0 };
  } finally {
    deadline.dispose();
  }
}

// 重试只在传输层做。上层拿到的要么是成功，要么是一个已经放弃重试的 LlmError。
async function llmHttp(request, options = {}) {
  const retry = { ...LLM_RETRY_DEFAULTS, ...(options.retry || {}) };
  const timeoutMs = numberOr(options.timeoutMs, LLM_TIMEOUT_DEFAULT_MS);
  const sleep = options.sleep || defaultSleep;
  const random = options.random || Math.random;
  const now = options.now || (() => Date.now());
  const secrets = options.secrets || [];

  let lastError = null;

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const result = await performLlmRequest(request, {
        timeoutMs,
        signal: options.signal,
        onEvent: options.onEvent,
        secrets,
        now,
      });
      return { ...result, attempt };
    } catch (error) {
      const llmError = asLlmError(error);
      llmError.attempt = attempt;
      lastError = llmError;

      if (!llmError.retryable || attempt >= retry.maxAttempts) throw llmError;

      const delayMs = computeRetryDelay(attempt, retry, llmError.retryAfterMs, random);
      // null = 服务端要求的等待超过上限，别在这儿耗着，交给上层切备用模型。
      if (delayMs == null) throw llmError;

      options.onRetry?.({ attempt, delayMs, error: llmError });
      await sleep(delayMs);
    }
  }

  throw lastError || new LlmError(LLM_ERROR.UNKNOWN, '请求失败');
}
