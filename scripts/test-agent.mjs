// 提示词 Agent 的回归测试。和 LLM 服务共用同一个沙箱（跑的是真正上线的那份代码）。
//
//   node scripts/test-agent.mjs

import assert from 'node:assert/strict';
import { group, test, captureError, deepEqual, run } from './lib/tiny-test.mjs';
import { createBackgroundSandbox, jsonResponse, hangingResponse } from './lib/background-sandbox.mjs';

const API_KEY = 'sk-agent-key-1234567890';

// 贴着自动补全缓存的真实形状：tag / category / postCount / translation / aliases
const TAG_INDEX = [
  { tag: 'school_uniform', category: '0', postCount: 900000, translation: '校服', aliases: ['schooluniform'] },
  { tag: 'transparent_umbrella', category: '0', postCount: 12000, translation: '透明伞', aliases: [] },
  { tag: 'rain', category: '0', postCount: 300000, translation: '雨', aliases: [] },
  { tag: 'night', category: '0', postCount: 500000, translation: '夜晚', aliases: [] },
  { tag: 'convenience_store', category: '0', postCount: 8000, translation: '便利店', aliases: [] },
  { tag: 'cowboy_shot', category: '0', postCount: 700000, translation: '七分身', aliases: [] },
  { tag: 'hand', category: '0', postCount: 200000, translation: '手', aliases: [] },
  { tag: 'artist_name', category: '0', postCount: 400000, translation: '画师名', aliases: [] },
  { tag: 'obscure_thing', category: '0', postCount: 12, translation: '冷门物件', aliases: [] },
  { tag: 'komorebi', category: '0', postCount: 30000, translation: '木漏日', aliases: ['dappled_sunlight'] },
];

const SKILL = {
  name: 'nai5-prompting',
  body: '# NovelAI V5 内容提示词指南\n锚点 tag 在前，自然语言在中，氛围串在后。',
  references: [{ name: 'examples.md', content: '范例：1girl, solo, full body.' }],
};

function llmConfig(overrides = {}) {
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
    ...overrides,
  };
}

const REQUEST = '雨夜里，一个穿校服的女孩撑着透明伞站在便利店门口';

function agentPayload(overrides = {}) {
  return { skill: SKILL, request: REQUEST, primary: llmConfig(), ...overrides };
}

const FAST = { retry: { maxAttempts: 1 }, sleep: async () => {} };

function newSandbox({ tags = TAG_INDEX } = {}) {
  const box = createBackgroundSandbox();
  box.setStorage({ 'nai-ac-tags': tags });
  return box;
}

function reply(text) {
  return jsonResponse({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}

function toolReply(queries, id = 'call_1') {
  return jsonResponse({
    choices: [{
      message: {
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: 'search_tags', arguments: JSON.stringify({ queries }) } }],
      },
      finish_reason: 'tool_calls',
    }],
  });
}

// ═══════════════════════════ 1. 中文反查预检 ═══════════════════════════

group('中文反查预检');

test('从中文描述里捞出确定存在的 tag', () => {
  const box = newSandbox();
  const hits = box.get('prefilterAgentTags')(TAG_INDEX, REQUEST).map((entry) => entry.tag);

  assert.ok(hits.includes('school_uniform'), '校服');
  assert.ok(hits.includes('transparent_umbrella'), '透明伞');
  assert.ok(hits.includes('convenience_store'), '便利店');
});

test('单字释义不参与匹配（"手""雨"命中率太高）', () => {
  const box = newSandbox();
  const hits = box.get('prefilterAgentTags')(TAG_INDEX, '下雨的夜晚，她抬起手').map((entry) => entry.tag);

  assert.equal(hits.includes('rain'), false, '"雨"是单字释义');
  assert.equal(hits.includes('hand'), false, '"手"是单字释义');
  assert.ok(hits.includes('night'), '"夜晚"是两字，应命中');
});

test('post 量太低的不进预检（模型也画不准）', () => {
  const box = newSandbox();
  const hits = box.get('prefilterAgentTags')(TAG_INDEX, '一个冷门物件').map((entry) => entry.tag);
  deepEqual(hits, []);
});

test('英文按整词匹配，多词 tag 也认', () => {
  const box = newSandbox();
  const prefilter = box.get('prefilterAgentTags');

  assert.ok(prefilter(TAG_INDEX, 'please use a cowboy shot here').some((e) => e.tag === 'cowboy_shot'));
  assert.ok(prefilter(TAG_INDEX, 'tags: school_uniform, night').some((e) => e.tag === 'school_uniform'));
});

test('英文不做子串匹配（art 不能撞上 artist_name）', () => {
  const box = newSandbox();
  const hits = box.get('prefilterAgentTags')(TAG_INDEX, 'some art of a girl').map((e) => e.tag);
  assert.equal(hits.includes('artist_name'), false);
});

test('按 post 量排序并截断', () => {
  const box = newSandbox();
  const hits = box.get('prefilterAgentTags')(TAG_INDEX, '校服 透明伞 便利店 夜晚', 2);
  assert.equal(hits.length, 2);
  deepEqual(hits[0], { tag: 'school_uniform', posts: 900000, zh: '校服' }, 'post 量最高的排前面');
  assert.equal(hits[1].tag, 'night');
});

// ═══════════════════════════ 2. 词典查证 ═══════════════════════════

group('词典查证');

test('精确 > 前缀 > 子串', () => {
  const box = newSandbox();
  const search = box.get('searchAgentTags');

  assert.equal(search(TAG_INDEX, 'rain')[0].tag, 'rain');
  assert.equal(search(TAG_INDEX, 'school')[0].tag, 'school_uniform');
  assert.equal(search(TAG_INDEX, 'umbrella')[0].tag, 'transparent_umbrella');
});

test('下划线和空格等价', () => {
  const box = newSandbox();
  const search = box.get('searchAgentTags');
  assert.equal(search(TAG_INDEX, 'cowboy shot')[0].tag, 'cowboy_shot');
  assert.equal(search(TAG_INDEX, 'cowboy_shot')[0].tag, 'cowboy_shot');
});

test('中文能查，别名也能查', () => {
  const box = newSandbox();
  const search = box.get('searchAgentTags');
  assert.equal(search(TAG_INDEX, '便利店')[0].tag, 'convenience_store');
  assert.equal(search(TAG_INDEX, 'dappled sunlight')[0].tag, 'komorebi', '别名要反查到标准写法');
});

test('查不到就是查不到，不硬凑', () => {
  const box = newSandbox();
  deepEqual(box.get('searchAgentTags')(TAG_INDEX, 'zzzznotathing'), []);
});

// ═══════════════════════════ 3. 消息装配 ═══════════════════════════

group('消息装配');

test('system = skill 正文 + 参考资料 + 运行环境补充', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload(), FAST);

  const system = calls[0].body.messages[0].content;
  assert.match(system, /锚点 tag 在前/, 'skill 正文');
  assert.match(system, /参考资料：examples\.md/, '参考资料');
  assert.match(system, /search_tags/, '要把 grep CSV 改成调工具');
  assert.match(system, /没有 shell/);
});

test('user 带上需求和预检结果', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ mode: 'expanded', notes: '竖图', characterPrompt: 'blonde hair, blue eyes' }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.match(user, /透明伞/, '原始需求');
  assert.match(user, /展开模式/);
  assert.match(user, /竖图/);
  assert.match(user, /blonde hair/);
  assert.match(user, /school_uniform \(900000\) — 校服/, '预检 tag 要带 post 量和中文');
});

test('Agent 的输出额度要够写完一版提示词', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ primary: llmConfig({ maxTokens: 700 }) }), FAST);

  assert.ok(calls[0].body.max_tokens >= 2000, `实际 ${calls[0].body.max_tokens}`);
});

test('用户自己调大过 max_tokens 就不覆盖', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ primary: llmConfig({ maxTokens: 8000 }) }), FAST);

  assert.equal(calls[0].body.max_tokens, 8000);
});

test('缺 skill 或缺需求时不发请求', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));

  const noRequest = await box.get('runPromptAgent')(agentPayload({ request: '  ' }), FAST);
  const noSkill = await box.get('runPromptAgent')(agentPayload({ skill: { body: '' } }), FAST);

  assert.equal(noRequest.ok, false);
  assert.equal(noRequest.errorKind, 'config');
  assert.equal(noSkill.ok, false);
  assert.match(noSkill.error, /skill/);
  assert.equal(calls.length, 0);
});

// ═══════════════════════════ 4. 工具查证回路 ═══════════════════════════

group('工具查证回路');

test('模型查证 → 本地词典回答 → 继续写', async () => {
  const box = newSandbox();
  const calls = box.mockFetch((_call, index) => (
    index === 1 ? toolReply(['komorebi', 'zzzznotathing']) : reply('1girl, solo, komorebi.')
  ));

  const result = await box.get('runPromptAgent')(agentPayload(), FAST);

  assert.equal(result.ok, true);
  assert.equal(result.text, '1girl, solo, komorebi.');
  deepEqual(result.toolSteps, [{ name: 'search_tags', queries: ['komorebi', 'zzzznotathing'] }]);

  const toolMessage = calls[1].body.messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  const payload = JSON.parse(toolMessage.content);
  assert.equal(payload.komorebi[0].tag, 'komorebi');
  assert.equal(payload.komorebi[0].posts, 30000);
  assert.equal(payload.zzzznotathing, 'not_found', '查不到要明说，不能返回空数组让模型瞎猜');
});

test('工具声明用的是 danbooru 词典，一次能查多个', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload(), FAST);

  const tool = calls[0].body.tools[0].function;
  assert.equal(tool.name, 'search_tags');
  assert.equal(tool.parameters.properties.queries.type, 'array');
  assert.match(tool.description, /danbooru/);
});

test('词典没缓存时给出可执行的说明，而不是干瞪眼', async () => {
  const box = newSandbox({ tags: [] });
  const calls = box.mockFetch((_call, index) => (index === 1 ? toolReply(['rain']) : reply('写完了')));

  const result = await box.get('runPromptAgent')(agentPayload(), FAST);

  assert.equal(result.ok, true);
  const toolMessage = JSON.parse(calls[1].body.messages.at(-1).content);
  assert.match(toolMessage.error, /novelai\.net/, '要告诉用户怎么把词典拉起来');
  assert.match(toolMessage.error, /底部标注/, '并给出这轮的兜底做法');
});

test('工具用量按整轮累加，不是只报最后一次', async () => {
  const box = newSandbox();
  box.mockFetch((_call, index) => (
    index === 1
      ? jsonResponse({
        choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_tags', arguments: '{"queries":["rain"]}' } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      })
      : jsonResponse({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 150, completion_tokens: 40 } })
  ));

  const result = await box.get('runPromptAgent')(agentPayload(), FAST);
  deepEqual(result.usage, { inputTokens: 250, outputTokens: 50, totalTokens: 300 });
});

// ═══════════════════════════ 5. 与 LLM 服务的衔接 ═══════════════════════════

group('与 LLM 服务的衔接');

test('主模型挂了照样切备用', async () => {
  const box = newSandbox();
  box.mockFetch((call) => (
    call.url.includes('api.openai.com')
      ? jsonResponse({ error: { message: 'boom' } }, { status: 500 })
      : reply('备用写的')
  ));

  const result = await box.get('runPromptAgent')(
    agentPayload({ fallback: llmConfig({ label: '备用', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash-vision-exp' }) }),
    FAST,
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, '备用写的');
  assert.equal(result.usedFallback, true);
  assert.equal(result.attempts[0].kind, 'server');
});

test('nai-agent-run 走真正的消息路由', async () => {
  const box = newSandbox();
  box.mockFetch(() => reply('1girl, solo.'));

  const result = await box.sendMessage({ type: 'nai-agent-run', runId: 'agent-1', payload: agentPayload() });

  assert.equal(result.ok, true);
  assert.equal(result.text, '1girl, solo.');
  assert.equal(result.runId, 'agent-1');
  assert.ok(result.prefiltered.length > 0);
});

test('Agent 也能中途取消', async () => {
  const box = newSandbox();
  box.mockFetch(hangingResponse());

  const pending = box.sendMessage({ type: 'nai-agent-run', runId: 'agent-2', payload: agentPayload() });
  await box.sendMessage({ type: 'nai-llm-cancel', runId: 'agent-2' });
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'aborted');
});

await run('Agent 测试');
