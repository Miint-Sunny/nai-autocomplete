// LLM 服务的回归测试。跑的是 js/background/ 里真正上线的那份代码（见 lib/background-sandbox.mjs）。
//
//   node scripts/test-llm.mjs

import assert from 'node:assert/strict';
import { group, test, captureError, deepEqual, run } from './lib/tiny-test.mjs';
import {
  createBackgroundSandbox,
  jsonResponse,
  textResponse,
  sseResponse,
  networkFailure,
  hangingResponse,
} from './lib/background-sandbox.mjs';

// ───────────────────────────────── 夹具 ─────────────────────────────────

const API_KEY = 'sk-test-key-1234567890';
const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

const MESSAGES = [
  { role: 'system', content: 'system rule' },
  { role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: IMAGE_DATA_URL } }] },
];

function openaiConfig(overrides = {}) {
  return {
    providerId: 'openai',
    label: 'OpenAI',
    protocol: 'openai-chat',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: API_KEY,
    model: 'gpt-4.1-mini',
    temperature: 0.4,
    maxTokens: 700,
    reasoningEffort: 'off',
    messages: MESSAGES,
    ...overrides,
  };
}

function anthropicConfig(overrides = {}) {
  return openaiConfig({
    providerId: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic-messages',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-5',
    ...overrides,
  });
}

function responsesConfig(overrides = {}) {
  return openaiConfig({
    providerId: 'xai-responses',
    label: 'xAI',
    protocol: 'responses',
    endpoint: 'https://api.x.ai/v1/responses',
    model: 'grok-4-fast-reasoning',
    ...overrides,
  });
}

const FAST_RETRY = { retry: { maxAttempts: 1 }, sleep: async () => {} };

function openaiReply(text, extra = {}) {
  return jsonResponse({ choices: [{ message: { content: text }, finish_reason: 'stop' }], ...extra });
}

function newSandbox() {
  return createBackgroundSandbox();
}

// ═══════════════════════════ 1. 请求体构造 ═══════════════════════════

group('请求体构造');

test('openai-chat：字段、鉴权头、默认不带任何思考字段', () => {
  const box = newSandbox();
  const request = box.get('getProtocolAdapter')('openai-chat').buildRequest(openaiConfig());
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.temperature, 0.4);
  assert.equal(body.max_tokens, 700);
  assert.equal(body.stream, false);
  assert.equal(body.messages[1].content[1].image_url.url, IMAGE_DATA_URL);
  // 给不支持的服务商发未知字段会直接 400，关闭档位时必须一个都不带。
  assert.equal('reasoning_effort' in body, false);
  assert.equal('thinking' in body, false);
});

test('DeepSeek：关闭档位要显式发 disabled（它默认开着高档思考）', () => {
  const box = newSandbox();
  const build = (effort) => JSON.parse(
    box.get('getProtocolAdapter')('openai-chat')
      .buildRequest(openaiConfig({ providerId: 'deepseek', reasoningEffort: effort })).options.body,
  );

  deepEqual(build('off').thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in build('off'), false);

  assert.equal(build('high').reasoning_effort, 'high');
  deepEqual(build('high').thinking, { type: 'enabled' });
});

test('responses：中档归到 high，内容转成 input_text / input_image', () => {
  const box = newSandbox();
  const body = JSON.parse(
    box.get('getProtocolAdapter')('responses').buildRequest(responsesConfig({ reasoningEffort: 'medium' })).options.body,
  );

  deepEqual(body.reasoning, { effort: 'high' });
  assert.equal(body.max_output_tokens, 700);
  assert.equal(body.input[0].content[0].type, 'input_text');
  assert.equal(body.input[1].content[1].type, 'input_image');
  assert.equal(body.input[1].content[1].image_url, IMAGE_DATA_URL);
});

test('anthropic：思考模式下去掉 temperature，max_tokens 要加上预算', () => {
  const box = newSandbox();
  const build = (effort) => JSON.parse(
    box.get('getProtocolAdapter')('anthropic-messages').buildRequest(anthropicConfig({ reasoningEffort: effort })).options.body,
  );

  const thinking = build('medium');
  deepEqual(thinking.thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.equal(thinking.max_tokens, 700 + 4096, 'max_tokens 必须大于 budget_tokens');
  assert.equal('temperature' in thinking, false, '开了 extended thinking 时 Anthropic 拒绝 temperature');

  const plain = build('off');
  assert.equal(plain.temperature, 0.4);
  assert.equal(plain.max_tokens, 700);
  assert.equal('thinking' in plain, false);
});

test('anthropic：system 抽到顶层，图片转 base64 source', () => {
  const box = newSandbox();
  const request = box.get('getProtocolAdapter')('anthropic-messages').buildRequest(anthropicConfig());
  const body = JSON.parse(request.options.body);

  assert.equal(body.system, 'system rule');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  deepEqual(body.messages[0].content[1].source, {
    type: 'base64',
    media_type: 'image/png',
    data: 'iVBORw0KGgo=',
  });
  assert.equal(request.options.headers['x-api-key'], API_KEY);
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
});

// 回归：协议和 Endpoint 配错对。只改了协议下拉、没换地址时，
// 我们按 A 协议拼 body 发给 B 协议的解析器，服务端报的是某个字段的 schema 错误，
// 看不出真正的病因在配置上。
//
// 实测原样复现过用户报的那条：Anthropic 协议 + DeepSeek 的 /chat/completions →
//   Failed to deserialize the JSON body into the target type: tools[0]: missing field `type`
// 而且**只有写词会报** —— 不带 tools 时 system 被忽略、content 数组 OpenAI 也认，
// 反推照常能过，于是看着像「写词坏了」。
group('协议与 Endpoint 配错对');

test('认出错配，并说清楚两边怎么改', () => {
  const box = newSandbox();
  const detect = box.get('detectProtocolEndpointMismatch');

  const message = detect('anthropic-messages', 'https://api.deepseek.com/chat/completions');
  assert.match(message, /Anthropic Messages API/);
  assert.match(message, /OpenAI Chat Completions/);
  assert.match(message, /\/messages/);
});

test('配套的组合一个字都不说', () => {
  const box = newSandbox();
  const detect = box.get('detectProtocolEndpointMismatch');

  assert.equal(detect('openai-chat', 'https://api.deepseek.com/chat/completions'), '');
  assert.equal(detect('anthropic-messages', 'https://api.anthropic.com/v1/messages'), '');
  assert.equal(detect('responses', 'https://api.x.ai/v1/responses'), '');
});

// 自建网关和中转站的路径千奇百怪，认不出来就闭嘴 —— 宁可不提示，也不能对着正常配置乱报
test('认不出来的路径不乱报', () => {
  const box = newSandbox();
  const detect = box.get('detectProtocolEndpointMismatch');

  assert.equal(detect('anthropic-messages', 'https://my-gateway.example.com/v1/proxy'), '');
  assert.equal(detect('openai-chat', 'https://relay.example.com/api'), '');
  assert.equal(detect('openai-chat', '不是个网址'), '');
  assert.equal(detect('openai-chat', ''), '');
});

test('schema 类的 400 优先报错配这条，而不是笼统的那句', () => {
  const box = newSandbox();
  const LlmError = box.get('LlmError');
  const mismatched = new LlmError('bad_request', 'tools[0]: missing field `type`', {
    config: { protocol: 'anthropic-messages', endpoint: 'https://api.deepseek.com/chat/completions' },
  });
  assert.match(mismatched.hint, /两者必须配套/);

  // 配套但仍然 schema 报错时，退回原来那句笼统的
  const plain = new LlmError('bad_request', 'tools[0]: unknown variant `custom`', {
    config: { protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1/messages' },
  });
  assert.match(plain.hint, /形状要求和我们发的不一致/);
});

// OpenAI 两条协议的工具定义带 type，这是它们各自 spec 的形状
test('OpenAI 系两条协议的工具定义带 type', () => {
  const box = newSandbox();
  const tool = { name: 'search_tags', description: '查证 tag', parameters: { type: 'object', properties: {} } };

  for (const [protocol, config] of [
    ['openai-chat', openaiConfig({ tools: [tool] })],
    ['responses', responsesConfig({ tools: [tool] })],
  ]) {
    const body = JSON.parse(box.get('getProtocolAdapter')(protocol).buildRequest(config).options.body);
    assert.equal(body.tools?.[0]?.type, 'function', `${protocol}`);
  }
});

// 回归：Anthropic 的**自定义**工具不带 type，这是官方 spec 的形状。
// v1.6.3 曾按一条 `tools[0]: missing field \`type\`` 的报告给它加过 type: 'custom'，
// 拿 DeepSeek 的 Anthropic 兼容接口实测直接被拒：
//   unknown variant `custom`, expected `web_search_20250305` …
// —— 在它眼里 type 是**内置工具**的判别字段。各家兼容层的 schema 并不一致，
// 没有哪种写法能同时满足，所以贴着官方 spec 走，别为某一家把标准形状改掉。
test('anthropic 的自定义工具不带 type，用 input_schema', () => {
  const box = newSandbox();
  const body = JSON.parse(box.get('getProtocolAdapter')('anthropic-messages').buildRequest(anthropicConfig({
    tools: [{ name: 'search_tags', description: '查证 tag', parameters: { type: 'object', properties: {} } }],
  })).options.body);

  assert.equal('type' in body.tools[0], false, 'type 是内置工具的判别字段，自定义工具带上会被拒');
  assert.equal(body.tools[0].name, 'search_tags');
  assert.ok(body.tools[0].input_schema, 'Anthropic 用 input_schema，不是 parameters');
});

// 400 的兜底 hint 说的是图片和思考档位。请求体 schema 校验失败时那条纯属误导 ——
// 会把人往「调思考档位」上带，而真正的问题在请求怎么拼的。
test('schema 类的 400 不给「图片 / 思考档位」那条误导 hint', () => {
  const box = newSandbox();
  const LlmError = box.get('LlmError');
  const schemaError = new LlmError('bad_request', '未能将 JSON 主体反序列化为目标类型： tools[0]： 缺少字段 \'type\'');
  const plainError = new LlmError('bad_request', '请求失败：HTTP 400');

  assert.equal(/调成关闭再试/.test(schemaError.hint), false, '别把人往「调思考档位」上带');
  assert.match(schemaError.hint, /schema/);
  assert.match(schemaError.hint, /无关/, '要明说和图片、思考档位都没关系');
  assert.match(plainError.hint, /调成关闭再试/, '普通 400 保留原来的常见原因');
});

test('anthropic：连续同角色的消息要合并（API 不接受相邻同角色）', () => {
  const box = newSandbox();
  const body = JSON.parse(box.get('getProtocolAdapter')('anthropic-messages').buildRequest(anthropicConfig({
    messages: [
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ],
  })).options.body);

  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].content.length, 2);
});

test('extraHeaders / extraBody 能透传（OpenRouter 之类要求额外头）', () => {
  const box = newSandbox();
  const request = box.get('getProtocolAdapter')('openai-chat').buildRequest(openaiConfig({
    extraHeaders: { 'HTTP-Referer': 'https://example.com' },
    extraBody: { top_p: 0.8 },
  }));

  assert.equal(request.options.headers['HTTP-Referer'], 'https://example.com');
  assert.equal(JSON.parse(request.options.body).top_p, 0.8);
});

// ═══════════════════════════ 2. 错误分类与重试 ═══════════════════════════

group('错误分类与重试');

test('401 归为鉴权错，不重试', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => jsonResponse({ error: { message: 'Invalid API key' } }, { status: 401 }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), { sleep: async () => {} }));

  assert.equal(error.kind, 'auth');
  assert.equal(error.retryable, false);
  assert.equal(error.failoverable, true);
  assert.equal(calls.length, 1, '鉴权错重试多少次都一样');
});

test('500 会重试，第二次成功就当成功', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((_call, index) => (
    index === 1 ? jsonResponse({ error: { message: 'boom' } }, { status: 500 }) : openaiReply('recovered')
  ));

  const result = await box.get('runLlmRequest')(openaiConfig(), {
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    sleep: async () => {},
  });

  assert.equal(result.text, 'recovered');
  assert.equal(result.attempt, 2);
  assert.equal(calls.length, 2);
  assert.equal(result.retries[0].kind, 'server');
});

test('500 重试到上限后放弃', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => jsonResponse({ error: { message: 'boom' } }, { status: 500 }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), {
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    sleep: async () => {},
  }));

  assert.equal(error.kind, 'server');
  assert.equal(calls.length, 3);
});

test('429 + Retry-After: 2 会照着等', async () => {
  const box = newSandbox();
  const slept = [];
  box.mockFetch((_call, index) => (
    index === 1
      ? jsonResponse({ error: { message: 'rate limited' } }, { status: 429, headers: { 'retry-after': '2' } })
      : openaiReply('ok')
  ));

  await box.get('runLlmRequest')(openaiConfig(), {
    retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 100 },
    sleep: async (ms) => { slept.push(ms); },
  });

  assert.equal(slept.length, 1);
  assert.ok(slept[0] >= 2000, `应至少等 2000ms，实际 ${slept[0]}`);
});

test('429 + Retry-After: 60 直接放弃重试，交给备用模型', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => jsonResponse({ error: { message: 'slow down' } }, { status: 429, headers: { 'retry-after': '60' } }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), {
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    sleep: async () => { throw new Error('不该真的等 60 秒'); },
  }));

  assert.equal(error.kind, 'rate_limit');
  assert.equal(calls.length, 1);
});

test('400 不重试，但允许切备用', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => jsonResponse({ error: { message: 'model does not support images' } }, { status: 400 }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), FAST_RETRY));

  assert.equal(error.kind, 'bad_request');
  assert.equal(error.failoverable, true);
  assert.equal(calls.length, 1);
  assert.match(error.toDisplayString(), /图片/);
});

test('网络层失败的提示要和「模型返回空」区分开', async () => {
  const box = newSandbox();
  box.mockFetch(networkFailure());

  const error = await captureError(() => box.get('runLlmRequest')(
    openaiConfig({ endpoint: 'http://127.0.0.1:11434/v1/chat/completions', apiKey: '' }),
    FAST_RETRY,
  ));

  assert.equal(error.kind, 'network');
  assert.match(error.message, /127\.0\.0\.1/);
  assert.match(error.message, /本机服务/);
  assert.match(error.message, /不是模型返回空文本/);
});

test('超时是超时，不会被误判成取消', async () => {
  const box = newSandbox();
  box.mockFetch(hangingResponse());

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), {
    timeoutMs: 30,
    retry: { maxAttempts: 1 },
    sleep: async () => {},
  }));

  assert.equal(error.kind, 'timeout');
  assert.equal(error.failoverable, true);
});

test('parseRetryAfter 认秒数也认 HTTP 日期', () => {
  const box = newSandbox();
  const parse = box.get('parseRetryAfter');
  const now = Date.parse('2026-01-01T00:00:00Z');

  assert.equal(parse('2', now), 2000);
  assert.equal(parse('  3.5 ', now), 3500);
  assert.equal(parse(new Date(now + 5000).toUTCString(), now), 5000);
  assert.equal(parse('nonsense', now), null);
  assert.equal(parse('', now), null);
});

test('computeRetryDelay：指数退避、封顶、以及超长等待返回 null', () => {
  const box = newSandbox();
  const compute = box.get('computeRetryDelay');
  const policy = { baseDelayMs: 600, maxDelayMs: 6000, maxRetryAfterMs: 15000 };
  const noJitter = () => 0.5;

  assert.equal(compute(1, policy, null, noJitter), 600);
  assert.equal(compute(3, policy, null, noJitter), 2400);
  assert.equal(compute(10, policy, null, noJitter), 6000, '必须封顶');
  assert.equal(compute(1, policy, 3000, noJitter), 3000, '服务端说等更久就听它的');
  assert.equal(compute(1, policy, 20000, noJitter), null, '超过上限就别等了');
});

// ═══════════════════════════ 3. 主备切换策略 ═══════════════════════════

group('主备切换策略');

test('主模型鉴权失败 → 自动切备用', async () => {
  const box = newSandbox();
  box.mockFetch((call) => (
    call.url.includes('api.openai.com')
      ? jsonResponse({ error: { message: 'Invalid API key' } }, { status: 401 })
      : openaiReply('from fallback')
  ));

  const result = await box.get('runLlmWithFallback')(
    { primary: openaiConfig(), fallback: openaiConfig({ label: '备用', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash-vision-exp' }) },
    FAST_RETRY,
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, 'from fallback');
  assert.equal(result.usedFallback, true);
  assert.equal(result.usedModel, 'deepseek-v4-flash-vision-exp');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].kind, 'auth');
});

test('用户取消不会触发备用模型', async () => {
  const box = newSandbox();
  const controller = new AbortController();
  const calls = box.mockFetch(hangingResponse());

  const promise = box.get('runLlmWithFallback')(
    { primary: openaiConfig(), fallback: openaiConfig({ label: '备用' }) },
    { signal: controller.signal, ...FAST_RETRY },
  );
  controller.abort();
  const result = await promise;

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'aborted');
  assert.equal(result.attempts.length, 1, '取消后不该再跑第二家');
  assert.equal(calls.length, 1);
});

test('主模型没填 Key → 直接用备用，且不发请求', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => openaiReply('from fallback'));

  const result = await box.get('runLlmWithFallback')(
    { primary: openaiConfig({ apiKey: '' }), fallback: openaiConfig({ label: '备用' }) },
    FAST_RETRY,
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, '配置不全的主模型不该发出请求');
  assert.equal(result.attempts[0].kind, 'config');
});

test('两家都挂 → 报最后一个错，attempts 记录全过程', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ error: { message: 'server exploded' } }, { status: 500 }));

  const result = await box.get('runLlmWithFallback')(
    { primary: openaiConfig(), fallback: openaiConfig({ label: '备用' }) },
    FAST_RETRY,
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'server');
  assert.equal(result.attempts.length, 2);
});

test('本机 endpoint 允许空 Key', async () => {
  const box = newSandbox();
  box.mockFetch(() => openaiReply('local ok'));

  const result = await box.get('runLlmRequest')(
    openaiConfig({ endpoint: 'http://localhost:1234/v1/chat/completions', apiKey: '' }),
    FAST_RETRY,
  );

  assert.equal(result.text, 'local ok');
});

// ═══════════════════════════ 4. 流式响应 ═══════════════════════════

group('流式响应');

test('openai SSE：增量拼接 + [DONE] 忽略', async () => {
  const box = newSandbox();
  box.mockFetch(() => sseResponse([
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: [DONE]\n\n',
  ]));

  const deltas = [];
  const result = await box.get('runLlmRequest')(openaiConfig({ stream: true }), {
    ...FAST_RETRY,
    onDelta: (text) => deltas.push(text),
  });

  assert.equal(result.text, 'Hello');
  assert.equal(result.streamed, true);
  deepEqual(deltas, ['Hel', 'lo']);
});

test('SSE 事件被切在网络块中间也要拼得回来', async () => {
  const box = newSandbox();
  box.mockFetch(() => sseResponse([
    'data: {"choices":[{"del',
    'ta":{"content":"split"}}]}\n\n',
  ]));

  const result = await box.get('runLlmRequest')(openaiConfig({ stream: true }), FAST_RETRY);
  assert.equal(result.text, 'split');
});

test('anthropic SSE：content_block_delta', async () => {
  const box = newSandbox();
  box.mockFetch(() => sseResponse([
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]));

  const result = await box.get('runLlmRequest')(anthropicConfig({ stream: true }), FAST_RETRY);
  assert.equal(result.text, 'Hi there');
});

test('content-type 撒谎成 text/plain 时也认得出 SSE', async () => {
  const box = newSandbox();
  box.mockFetch(() => sseResponse(
    ['data: {"choices":[{"delta":{"content":"proxied"}}]}\n\n'],
    { contentType: 'text/plain' },
  ));

  const result = await box.get('runLlmRequest')(openaiConfig({ stream: true }), FAST_RETRY);
  assert.equal(result.text, 'proxied');
});

test('流式响应里的 usage 会被捞出来', async () => {
  const box = newSandbox();
  box.mockFetch(() => sseResponse([
    'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
    'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":22}}\n\n',
  ]));

  const result = await box.get('runLlmRequest')(openaiConfig({ stream: true }), FAST_RETRY);
  deepEqual(result.usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33 });
});

// ═══════════════════════════ 5. 响应解析边界 ═══════════════════════════

group('响应解析边界');

test('200 + 空正文 + finish_reason=length：要指向 max_tokens 而不是含糊的「空结果」', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), FAST_RETRY));

  assert.equal(error.kind, 'empty');
  assert.match(error.message, /max_tokens/);
  assert.match(error.hint, /思考/);
});

test('返回 HTML 错误页 → 明确说是代理页，而不是模型问题', async () => {
  const box = newSandbox();
  box.mockFetch(() => textResponse('<html><body>502 Bad Gateway</body></html>', { contentType: 'text/html' }));

  const error = await captureError(() => box.get('runLlmRequest')(openaiConfig(), FAST_RETRY));

  assert.equal(error.kind, 'parse');
  assert.match(error.message, /HTML/);
});

test('中转站直接吐纯文本时照样收下', async () => {
  const box = newSandbox();
  box.mockFetch(() => textResponse('1girl, solo, cat_ears'));

  const result = await box.get('runLlmRequest')(openaiConfig(), FAST_RETRY);
  assert.equal(result.text, '1girl, solo, cat_ears');
});

test('响应形状没见过时走通用兜底', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ content: [{ type: 'text', text: 'anthropic shape from an openai endpoint' }] }));

  const result = await box.get('runLlmRequest')(openaiConfig(), FAST_RETRY);
  assert.equal(result.text, 'anthropic shape from an openai endpoint');
});

test('usage 三家字段名统一', () => {
  const box = newSandbox();
  const normalize = box.get('normalizeUsage');

  deepEqual(normalize({ prompt_tokens: 3, completion_tokens: 4 }), { inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  deepEqual(normalize({ input_tokens: 5, output_tokens: 6, total_tokens: 11 }), { inputTokens: 5, outputTokens: 6, totalTokens: 11 });
  assert.equal(normalize(null), null);
  assert.equal(normalize({}), null);
});

// ═══════════════════════════ 6. 密钥脱敏 ═══════════════════════════

group('密钥脱敏');

test('服务端把 Key 回显在错误里时不能原样冒出来', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse(
    { error: { message: `Incorrect API key provided: ${API_KEY}` } },
    { status: 401 },
  ));

  const result = await box.get('runLlmWithFallback')({ primary: openaiConfig() }, FAST_RETRY);

  assert.equal(result.ok, false);
  assert.equal(result.error.includes(API_KEY), false, '错误信息会被用户截图发出来');
  assert.match(result.error, /\*\*\*/);
});

test('调试日志里不含任何 Key', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ error: { message: `bad key ${API_KEY}` } }, { status: 401 }));
  await box.get('runLlmWithFallback')({ primary: openaiConfig() }, FAST_RETRY);

  const { entries } = await box.sendMessage({ type: 'nai-llm-debug-log' });

  assert.ok(entries.length > 0);
  assert.equal(JSON.stringify(entries).includes(API_KEY), false);
  assert.equal(entries[0].ok, false);
  assert.equal(entries[0].kind, 'auth');
});

test('redactSecrets 也认 URL 上的 key 参数和 Bearer 头', () => {
  const box = newSandbox();
  const redact = box.get('redactSecrets');

  assert.equal(redact('GET /v1beta/models?key=AIzaSyABCDEFGH123456', []).includes('AIzaSyABCDEFGH123456'), false);
  assert.equal(redact('Authorization: Bearer abcdef1234567890', []).includes('abcdef1234567890'), false);
});

test('调试日志记的是统计量，不是图片内容', async () => {
  const box = newSandbox();
  box.mockFetch(() => openaiReply('ok'));
  await box.get('runLlmWithFallback')({ primary: openaiConfig() }, FAST_RETRY);

  const { entries } = await box.sendMessage({ type: 'nai-llm-debug-log' });

  deepEqual(entries[0].input, { turns: 2, images: 1, chars: 'system rule'.length + 'describe'.length });
  assert.equal(JSON.stringify(entries[0]).includes('iVBORw0KGgo'), false, 'base64 图片不该进日志');
});

// ═══════════════════════════ 7. 取消 ═══════════════════════════

group('取消');

test('nai-llm-cancel 能掐掉在途请求', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(hangingResponse());

  const pending = box.sendMessage({ type: 'nai-llm-chat', runId: 'run-1', payload: { primary: openaiConfig() } });
  const cancelResult = await box.sendMessage({ type: 'nai-llm-cancel', runId: 'run-1' });
  const result = await pending;

  assert.equal(cancelResult.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'aborted');
  assert.equal(calls.length, 1);
});

test('取消一个不存在的 runId 不报错', async () => {
  const box = newSandbox();
  const result = await box.sendMessage({ type: 'nai-llm-cancel', runId: 'nope' });
  deepEqual(result, { ok: true, cancelled: false });
});

// ═══════════════════════════ 8. 结构化 JSON ═══════════════════════════

group('结构化 JSON');

test('extractJsonBlock 能从各种包装里挖出 JSON', () => {
  const box = newSandbox();
  const extract = box.get('extractJsonBlock');

  deepEqual(extract('```json\n{"a":1}\n```'), { a: 1 });
  deepEqual(extract('好的，结果是：{"a":{"b":2}} 以上。'), { a: { b: 2 } });
  deepEqual(extract('{"a":"}"}'), { a: '}' });
  deepEqual(extract('{"a":"say \\"hi\\" }"}'), { a: 'say "hi" }' });
  deepEqual(extract('前言 [1,2,3] 后记'), [1, 2, 3]);
  assert.equal(extract('完全没有 JSON'), null);
  assert.equal(extract(''), null);
});

test('runLlmJson：第一次不是 JSON 就带着原文回喂修一次', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((_call, index) => (
    index === 1 ? openaiReply('当然可以！这是结果。') : openaiReply('{"tags":["cat_ears"]}')
  ));

  const result = await box.get('runLlmJson')(openaiConfig(), FAST_RETRY);

  assert.equal(result.repaired, true);
  deepEqual(result.value, { tags: ['cat_ears'] });
  deepEqual(calls[0].body.response_format, { type: 'json_object' });

  const repairMessages = calls[1].body.messages;
  assert.equal(repairMessages[repairMessages.length - 2].content, '当然可以！这是结果。');
  assert.match(repairMessages[repairMessages.length - 1].content[0].text, /不是合法 JSON/);
});

test('runLlmJson：两次都不是 JSON 就报 parse 错', async () => {
  const box = newSandbox();
  box.mockFetch(() => openaiReply('还是不给你 JSON'));

  const error = await captureError(() => box.get('runLlmJson')(openaiConfig(), FAST_RETRY));

  assert.equal(error.kind, 'parse');
  assert.match(error.message, /连续两次/);
});

test('anthropic 没有 JSON 模式：预填 "{" 并在解析时补回来', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => jsonResponse({ content: [{ type: 'text', text: '"tags":["cat"]}' }] }));

  const result = await box.get('runLlmJson')(anthropicConfig(), FAST_RETRY);

  const sent = calls[0].body.messages;
  assert.equal(sent[sent.length - 1].role, 'assistant');
  assert.equal(sent[sent.length - 1].content[0].text, '{');
  deepEqual(result.value, { tags: ['cat'] });
});

test('anthropic 开了思考就不预填（思考模式禁止预填）', () => {
  const box = newSandbox();
  const request = box.get('getProtocolAdapter')('anthropic-messages').buildRequest(
    anthropicConfig({ responseFormat: 'json', reasoningEffort: 'high' }),
  );
  const body = JSON.parse(request.options.body);

  assert.equal(request.jsonPrefill, false);
  assert.equal(body.messages[body.messages.length - 1].role, 'user');
});

// ═══════════════════════════ 9. 工具循环 ═══════════════════════════

group('工具循环');

const SEARCH_TOOL = {
  name: 'search_tags',
  description: '查 danbooru tag 是否存在',
  parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
};

test('模型要工具 → 执行 → 结果回喂 → 拿到正文', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((_call, index) => (
    index === 1
      ? jsonResponse({
        choices: [{
          message: { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_tags', arguments: '{"q":"cat ears"}' } }] },
          finish_reason: 'tool_calls',
        }],
      })
      : openaiReply('1girl, cat_ears')
  ));

  const executed = [];
  const result = await box.get('runLlmToolLoop')({
    config: openaiConfig(),
    tools: [SEARCH_TOOL],
    executeTool: async (call) => {
      executed.push(call);
      return { matches: ['cat_ears'] };
    },
  }, FAST_RETRY);

  assert.equal(result.text, '1girl, cat_ears');
  assert.equal(result.stoppedBy, 'final');
  assert.equal(executed.length, 1);
  deepEqual(executed[0].arguments, { q: 'cat ears' });

  assert.equal(calls[0].body.tools[0].function.name, 'search_tags');
  const second = calls[1].body.messages;
  deepEqual(second[second.length - 2].tool_calls[0].function.name, 'search_tags');
  assert.equal(second[second.length - 1].role, 'tool');
  assert.equal(second[second.length - 1].tool_call_id, 'call_1');
  assert.equal(second[second.length - 1].content, '{"matches":["cat_ears"]}');
});

test('工具本身抛错要回喂给模型，而不是炸掉整轮', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((_call, index) => (
    index === 1
      ? jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_tags', arguments: '{}' } }] } }] })
      : openaiReply('换个思路写完了')
  ));

  const result = await box.get('runLlmToolLoop')({
    config: openaiConfig(),
    tools: [SEARCH_TOOL],
    executeTool: async () => { throw new Error('CSV 没加载'); },
  }, FAST_RETRY);

  assert.equal(result.text, '换个思路写完了');
  assert.match(calls[1].body.messages.at(-1).content, /CSV 没加载/);
});

// 回归：步数用完不能整轮判失败。前面每一步查到的东西都还在 messages 里，
// 模型只是没在限定步数内收口 —— 查证型任务尤其容易，实测拿 DeepSeek 跑一次写词，
// 4 步里发了 30+ 次查询，以前到这儿全部丢掉，用户只拿到一句「没收敛」。
// 现在收口再问一次：去掉工具、并明说到此为止。
test('步数用完时收口再问一次，而不是把整轮丢掉', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((call) => (call.body.tools
    ? jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_tags', arguments: '{}' } }] } }] })
    : jsonResponse({ choices: [{ message: { content: '手上的材料够了，这是结果' }, finish_reason: 'stop' }] })));

  const result = await box.get('runLlmToolLoop')({
    config: openaiConfig(),
    tools: [SEARCH_TOOL],
    maxSteps: 3,
    executeTool: async () => ({ matches: [] }),
  }, FAST_RETRY);

  assert.equal(result.text, '手上的材料够了，这是结果');
  assert.equal(result.stoppedBy, 'max-steps');
  assert.equal(calls.length, 4, '3 步工具 + 1 次收口');
  assert.equal(calls.at(-1).body.tools, undefined, '收口那次不能再挂工具');
});

// 光把 tools 拿掉不够：实测 DeepSeek 会把工具调用的原始标记当正文吐出来
// （`<｜｜DSML｜｜tool_calls>…`），因为它「还想调」却没得调。
test('收口那次要明说别再调工具', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((call) => (call.body.tools
    ? jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_tags', arguments: '{}' } }] } }] })
    : jsonResponse({ choices: [{ message: { content: '结果' }, finish_reason: 'stop' }] })));

  await box.get('runLlmToolLoop')({
    config: openaiConfig(),
    tools: [SEARCH_TOOL],
    maxSteps: 2,
    executeTool: async () => ({ matches: [] }),
  }, FAST_RETRY);

  const lastMessage = calls.at(-1).body.messages.at(-1);
  assert.equal(lastMessage.role, 'user');
  assert.match(lastMessage.content, /不要再调用任何工具/);
});

test('anthropic 的工具往返转成 tool_use / tool_result', () => {
  const box = newSandbox();
  const body = JSON.parse(box.get('getProtocolAdapter')('anthropic-messages').buildRequest(anthropicConfig({
    tools: [SEARCH_TOOL],
    messages: [
      { role: 'user', content: 'find tags' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'search_tags', arguments: { q: 'cat' } }] },
      { role: 'tool', toolCallId: 'tu_1', name: 'search_tags', content: '{"matches":["cat_ears"]}' },
    ],
  })).options.body);

  assert.equal(body.tools[0].name, 'search_tags');
  assert.ok(body.tools[0].input_schema, 'anthropic 用的是 input_schema 而不是 parameters');
  assert.equal(body.messages[1].content[0].type, 'tool_use');
  assert.equal(body.messages[1].content[0].id, 'tu_1');
  assert.equal(body.messages[2].role, 'user');
  assert.equal(body.messages[2].content[0].type, 'tool_result');
  assert.equal(body.messages[2].content[0].tool_use_id, 'tu_1');
});

// ═══════════════════════════ 10. 模型列表 ═══════════════════════════

group('模型列表');

test('各协议的 /models 地址推导', () => {
  const box = newSandbox();
  const derive = box.get('deriveModelsEndpoint');

  assert.equal(derive({ endpoint: 'https://api.openai.com/v1/chat/completions' }), 'https://api.openai.com/v1/models');
  assert.equal(derive({ endpoint: 'https://api.anthropic.com/v1/messages' }), 'https://api.anthropic.com/v1/models');
  assert.equal(derive({ endpoint: 'https://api.x.ai/v1/responses' }), 'https://api.x.ai/v1/models');
  assert.equal(derive({ endpoint: 'https://proxy.example.com/v1' }), 'https://proxy.example.com/v1/models');
  assert.equal(
    derive({ providerId: 'gemini-openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: 'k' }),
    'https://generativelanguage.googleapis.com/v1beta/models?key=k',
  );
});

test('listModels 去重排序，并认 Gemini 的 models/ 前缀', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'gpt-a' }] }));
  const openai = await box.get('listModels')(openaiConfig(), FAST_RETRY);
  deepEqual(openai.models, ['gpt-a', 'gpt-b']);

  box.mockFetch(() => jsonResponse({ models: [{ name: 'models/gemini-3.5-flash' }] }));
  const gemini = await box.get('listModels')(
    { providerId: 'gemini-openai', protocol: 'openai-chat', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: 'k' },
    FAST_RETRY,
  );
  deepEqual(gemini.models, ['gemini-3.5-flash']);
});

test('模型列表报错也走同一套分类', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ error: { message: 'nope' } }, { status: 401 }));

  const error = await captureError(() => box.get('listModels')(openaiConfig(), FAST_RETRY));
  assert.equal(error.kind, 'auth');
});

// ═══════════════════════════ 11. 消息接口兼容性 ═══════════════════════════

group('消息接口兼容性');

test('nai-llm-chat 的返回字段对前端保持兼容', async () => {
  const box = newSandbox();
  box.mockFetch(() => openaiReply('1girl, solo'));

  const result = await box.sendMessage({ type: 'nai-llm-chat', payload: { primary: openaiConfig() } });

  assert.equal(result.ok, true);
  assert.equal(result.text, '1girl, solo');
  assert.equal(result.providerLabel, 'OpenAI');
  assert.equal(result.usedModel, 'gpt-4.1-mini');
  assert.equal(result.usedEndpoint, 'https://api.openai.com/v1/chat/completions');
  deepEqual(result.attempts, []);
  assert.equal(result.usedFallback, false);
});

test('nai-list-models 的返回字段对前端保持兼容', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ data: [{ id: 'm1' }] }));

  const result = await box.sendMessage({ type: 'nai-list-models', payload: openaiConfig() });

  assert.equal(result.ok, true);
  deepEqual(result.models, ['m1']);
});

test('失败时把 kind 和 hint 一起带给前端', async () => {
  const box = newSandbox();
  box.mockFetch(() => jsonResponse({ error: { message: 'nope' } }, { status: 401 }));

  const result = await box.sendMessage({ type: 'nai-llm-chat', payload: { primary: openaiConfig() } });

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'auth');
  assert.match(result.errorHint, /API Key/);
});

await run('LLM 服务测试');
