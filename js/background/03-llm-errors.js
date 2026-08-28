// LLM 错误分类。整个链路的两个决策都由它给出：
//   retryable   —— 同一家值不值得再试一次
//   failoverable —— 值不值得切到备用模型
// 不分类会出两种坏事：用户按了取消却触发备用模型跑完一轮；
// 或者 400 参数错在主备两家各撞一次，白等一倍时间。

const LLM_ERROR = {
  CONFIG: 'config',
  ABORTED: 'aborted',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  BAD_REQUEST: 'bad_request',
  NOT_FOUND: 'not_found',
  SERVER: 'server',
  EMPTY: 'empty',
  PARSE: 'parse',
  UNKNOWN: 'unknown',
};

const LLM_ERROR_POLICY = {
  // 用户取消：重试和切备用都毫无意义，而且切备用会让「取消」变成「又跑一轮」。
  [LLM_ERROR.ABORTED]: { retryable: false, failoverable: false },
  // 配置错重试无用，但主模型没填 Key 恰恰是最该走备用的场景。
  [LLM_ERROR.CONFIG]: { retryable: false, failoverable: true },
  // 网络层抖动：本家重试最划算，仍不行再换家。
  [LLM_ERROR.TIMEOUT]: { retryable: true, failoverable: true },
  [LLM_ERROR.NETWORK]: { retryable: true, failoverable: true },
  [LLM_ERROR.RATE_LIMIT]: { retryable: true, failoverable: true },
  [LLM_ERROR.SERVER]: { retryable: true, failoverable: true },
  // Key 不对重试多少次都一样，但备用模型是另一把 Key，值得试。
  [LLM_ERROR.AUTH]: { retryable: false, failoverable: true },
  // 参数/模型 ID 问题重试无用；备用往往是另一套协议，有机会过。
  [LLM_ERROR.BAD_REQUEST]: { retryable: false, failoverable: true },
  [LLM_ERROR.NOT_FOUND]: { retryable: false, failoverable: true },
  [LLM_ERROR.EMPTY]: { retryable: false, failoverable: true },
  [LLM_ERROR.PARSE]: { retryable: false, failoverable: true },
  [LLM_ERROR.UNKNOWN]: { retryable: false, failoverable: true },
};

const LLM_ERROR_HINTS = {
  [LLM_ERROR.AUTH]: 'API Key 无效、过期或没有该模型的权限。Vertex 用的是 access token，约 1 小时就会过期，需要重新取。',
  [LLM_ERROR.RATE_LIMIT]: '触发了服务商限流。稍等片刻再试，或降低并发；免费额度用尽也会返回这个。',
  [LLM_ERROR.BAD_REQUEST]: '请求被服务端判为不合法。常见原因：该模型不支持图片输入、图片过大、或者不接受思考档位参数（把「思考模式」调成关闭再试）。',
  [LLM_ERROR.NOT_FOUND]: 'Endpoint 路径或模型 ID 不存在。检查 Endpoint 结尾是否漏了 /chat/completions，以及模型名有没有拼错。',
  [LLM_ERROR.SERVER]: '服务端错误，通常是临时的，已自动重试过。',
  [LLM_ERROR.EMPTY]: '服务端返回 200 但没有正文。常见原因：思考档位把 max_tokens 吃光了，或内容被安全策略拦掉。',
  [LLM_ERROR.PARSE]: '响应不是可解析的 JSON / SSE。多半是中转站或代理返回了 HTML 错误页。',
  [LLM_ERROR.TIMEOUT]: '超过设定时限仍未返回。可能是模型思考过久，或代理卡住了。',
  [LLM_ERROR.CONFIG]: '服务商配置不完整。',
};

// 协议和 Endpoint 必须配套。只改了协议下拉、没换地址（或反过来）时，
// 我们会按 A 协议拼好 body 发给 B 协议的解析器 —— 服务端报的是某个字段的
// schema 错误，看不出真正的病因在配置上。
//
// 实测最典型的一种：Anthropic 协议 + DeepSeek 的 /chat/completions，
// 得到 `tools[0]: missing field \`type\``。而且**只有写词会报**：
// 不带 tools 时 system 被忽略、content 数组 OpenAI 也认，反推照常能过，
// 于是看起来像是「写词坏了」，其实是地址和协议对不上。
// suffix 是「只给了 base URL 时该往后补什么」，取各家官方 SDK 的口径：
// OpenAI 系的 base 自带 /v1（api.openai.com/v1）所以只补末段；Anthropic 的 base
// 不带版本号（api.anthropic.com），由客户端补 /v1/messages。
const PROTOCOL_ENDPOINT_SHAPES = {
  'openai-chat': { tail: /\/chat\/completions\/?$/, label: 'OpenAI Chat Completions', want: '/chat/completions', suffix: '/chat/completions' },
  responses: { tail: /\/responses\/?$/, label: 'Responses API', want: '/responses', suffix: '/responses' },
  'anthropic-messages': { tail: /\/messages\/?$/, label: 'Anthropic Messages API', want: '/messages', suffix: '/v1/messages' },
};

function detectProtocolEndpointMismatch(protocol, endpoint) {
  const expected = PROTOCOL_ENDPOINT_SHAPES[protocol];
  if (!expected || !endpoint) return '';

  let pathname = '';
  try {
    pathname = new URL(endpoint).pathname;
  } catch (error) {
    return '';
  }

  if (expected.tail.test(pathname)) return '';

  // 只填了域名。常见于「把 base URL 当接口地址粘进来」，或者换协议时删掉了旧路径
  // 却忘了补新的。这条不会误伤自建网关 —— 光秃秃一个域名对三种协议都不是合法地址。
  if (!pathname || pathname === '/') {
    return `Endpoint 只填了域名，没有路径 —— 这里要的是完整的接口地址，不是 base URL。`
      + `「${expected.label}」的地址以 ${expected.want} 结尾。`;
  }

  // 只在地址明显长着**另一种**协议的样子时才说话。自建网关的路径千奇百怪，
  // 认不出来就闭嘴，别对着正常配置乱报。
  const looksLike = Object.entries(PROTOCOL_ENDPOINT_SHAPES)
    .find(([id, shape]) => id !== protocol && shape.tail.test(pathname));
  if (!looksLike) return '';

  return `接口协议选的是「${expected.label}」，但 Endpoint 是 ${pathname}，那是「${looksLike[1].label}」的地址。`
    + `两者必须配套：要么把协议改成「${looksLike[1].label}」，要么把 Endpoint 换成以 ${expected.want} 结尾的那条。`;
}

// 400 的兜底 hint 说的是「图片 / 思考档位」，那是最常见的两种。
// 但服务端回的是请求体 schema 错误时（缺字段、类型不对、tools 形状不符），
// 那条 hint 纯属误导 —— 它会把人往「调思考档位」上带，而真正的问题在请求怎么拼的。
function pickErrorHint(kind, message, config) {
  if (kind !== LLM_ERROR.BAD_REQUEST) return LLM_ERROR_HINTS[kind] ?? '';

  const schemaError = /deserialize|missing field|unknown variant|invalid.*schema|反序列化|缺少字段/i.test(String(message || ''));
  if (!schemaError) return LLM_ERROR_HINTS[kind] ?? '';

  // 配错对是这类 schema 错误里最常见、也最难自己看出来的一种，能认出来就直接说
  const mismatch = detectProtocolEndpointMismatch(config?.protocol, config?.endpoint);
  if (mismatch) return mismatch;

  return '服务端按 schema 校验请求体时失败了，和图片或思考档位无关。多半是这家对某个字段的形状要求和我们发的不一致 —— 把这条原文报到 issue 里最有用。';
}

class LlmError extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = LLM_ERROR_POLICY[kind] ? kind : LLM_ERROR.UNKNOWN;
    const policy = LLM_ERROR_POLICY[this.kind];
    this.retryable = detail.retryable ?? policy.retryable;
    this.failoverable = detail.failoverable ?? policy.failoverable;
    this.status = detail.status ?? null;
    this.hint = detail.hint ?? pickErrorHint(this.kind, message, detail.config);
    this.retryAfterMs = detail.retryAfterMs ?? null;
    this.providerLabel = detail.providerLabel ?? '';
    this.model = detail.model ?? '';
    this.attempt = detail.attempt ?? 0;
  }

  // 面板只有一行状态条，把 hint 拼进去比让用户去翻 console 实在。
  toDisplayString() {
    return this.hint && !this.message.includes(this.hint)
      ? `${this.message}（${this.hint}）`
      : this.message;
  }

  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      hint: this.hint,
      status: this.status,
      retryable: this.retryable,
      failoverable: this.failoverable,
      providerLabel: this.providerLabel,
      model: this.model,
      attempt: this.attempt,
    };
  }
}

function asLlmError(error, fallbackKind = LLM_ERROR.UNKNOWN) {
  if (error instanceof LlmError) return error;
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (isAbortError(error)) return new LlmError(LLM_ERROR.ABORTED, message);
  return new LlmError(fallbackKind, message);
}

function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 20);
}

// 401/403 之外还有一类：中转站把鉴权失败写成 200 + body 里带 "invalid api key"，
// 那种只能靠 EMPTY/PARSE 兜住，这里只管标准状态码。
function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return LLM_ERROR.AUTH;
  if (status === 404) return LLM_ERROR.NOT_FOUND;
  if (status === 408 || status === 504) return LLM_ERROR.TIMEOUT;
  if (status === 429) return LLM_ERROR.RATE_LIMIT;
  if (status >= 500) return LLM_ERROR.SERVER;
  if (status >= 400) return LLM_ERROR.BAD_REQUEST;
  return LLM_ERROR.UNKNOWN;
}

// Retry-After 有两种写法：秒数，或 HTTP 日期。两种都得认。
function parseRetryAfter(value, nowMs) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, at - nowMs);
  return null;
}

// 返回 null 表示「这次别重试了」。
// 服务端说等 60 秒时不能真等 60 秒 —— 用户盯着面板，切备用模型比干等快得多。
function computeRetryDelay(attempt, policy, retryAfterMs, random = Math.random) {
  const base = Number(policy?.baseDelayMs) || 0;
  const cap = Number(policy?.maxDelayMs) || 0;
  const maxRetryAfter = Number(policy?.maxRetryAfterMs) || 0;

  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * 0.25 * (random() * 2 - 1);
  const backoff = Math.max(0, Math.round(exponential + jitter));

  if (retryAfterMs == null) return backoff;
  if (retryAfterMs > maxRetryAfter) return null;
  return Math.max(retryAfterMs, backoff);
}

// 出错信息会进日志、进状态条、可能被用户截图发出来，Key 一律先抹掉。
function redactSecrets(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 6) continue;
    output = output.split(secret).join(`${secret.slice(0, 3)}***${secret.slice(-2)}`);
  }
  return output
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1***')
    .replace(/\b(sk|xai|gsk|AIza)[-_A-Za-z0-9]{12,}\b/g, '$1***')
    .replace(/([?&](?:key|api_?key|access_token)=)[^&\s]+/gi, '$1***');
}

function extractErrorMessage(data, fallbackMessage) {
  if (!data) return fallbackMessage;
  if (typeof data === 'string') return data.trim() || fallbackMessage;
  const candidate = data?.error?.message || data?.message || data?.error?.status || data?.error;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return fallbackMessage;
}

// failed to fetch 最容易被误读成「模型返回了空」，这条信息要把两者区分清楚。
function buildFetchFailureMessage(url, error) {
  let hostText = url;
  const extraHints = [];

  try {
    const parsed = new URL(url);
    hostText = `${parsed.protocol}//${parsed.host}`;
    if (parsed.protocol === 'http:') extraHints.push('Endpoint 使用了 HTTP');
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname)) extraHints.push('Endpoint 是本机服务');
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(parsed.hostname)) extraHints.push('Endpoint 是内网地址');
  } catch (parseError) {
    // 保留原始 url
  }

  const detail = String(error instanceof Error ? error.message : error || '').trim() || 'Failed to fetch';
  const hintText = extraHints.length ? ` 可能点：${extraHints.join('，')}。` : '';

  return `未拿到 HTTP 响应（${hostText}），属于网络层 failed to fetch。这通常不是模型返回空文本，而是 Endpoint 根本没有成功返回 HTTP 响应。请检查 Endpoint 、端口、协议、证书或代理配置。${hintText} 原始错误：${detail}`;
}
