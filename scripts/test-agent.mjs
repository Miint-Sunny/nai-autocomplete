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

function reply(text, { finishReason = 'stop' } = {}) {
  return jsonResponse({ choices: [{ message: { content: text }, finish_reason: finishReason }] });
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
  assert.match(user, /展开写/, '档位说明整段发出去，不是只发一个档位名');
  assert.match(user, /竖图/);
  assert.match(user, /blonde hair/);
  assert.match(user, /school_uniform \(900000\) — 校服/, '预检 tag 要带 post 量和中文');
});

test('Agent 的输出额度要够写完一版提示词', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ primary: llmConfig({ maxTokens: 700 }) }), FAST);

  assert.ok(calls[0].body.max_tokens >= 4000, `实际 ${calls[0].body.max_tokens}`);
});

// 回归：OpenAI 兼容那条路上 reasoning_tokens 和正文吃同一个额度，
// 实测五角色请求单步思考就 4046 —— 4000 会在正文开始前就用光，
// 然后返回 finish_reason: length 加一个空字符串，一声不吭。
test('开了思考的模型要留出更多额度', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    primary: llmConfig({ maxTokens: 700, reasoningEffort: 'high' }),
  }), FAST);

  assert.ok(calls[0].body.max_tokens >= 8000, `实际 ${calls[0].body.max_tokens}`);
});

test('思考显式关掉时不必多给', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    primary: llmConfig({ maxTokens: 700, reasoningEffort: 'off' }),
  }), FAST);

  assert.equal(calls[0].body.max_tokens, 4000);
});

test('用户自己调大过 max_tokens 就不覆盖', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ primary: llmConfig({ maxTokens: 12000 }) }), FAST);

  assert.equal(calls[0].body.max_tokens, 12000);
});

// 正文为空时 runLlmRequest 已经会抛错；写到一半被砍断时正文非空，
// 以前一路静默返回，用户拿到半条提示词还以为模型就写成这样。
test('被 max_tokens 砍断时要把截断透上去', async () => {
  const box = newSandbox();
  box.mockFetch(() => reply('1girl, school uniform, standing at the', { finishReason: 'length' }));
  const result = await box.get('runPromptAgent')(agentPayload(), FAST);

  assert.equal(result.ok, true, '有正文就照常返回，不是报错');
  assert.equal(result.truncated, true);
});

test('正常写完不会误报截断', async () => {
  const box = newSandbox();
  box.mockFetch(() => reply('done'));
  const result = await box.get('runPromptAgent')(agentPayload(), FAST);

  assert.equal(result.truncated, false);
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

// ═══════════════════════════ 4. 知识源 ═══════════════════════════

group('知识源');

test('没勾选就一个字都不发', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload(), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.equal(/【/.test(user), false, '不该出现任何知识源区块');
});

test('当前提示词进去后，本轮变成迭代而不是重写', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { currentPrompt: '1girl, solo, night, rain' },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.match(user, /当前提示词框里的内容/);
  assert.match(user, /1girl, solo, night, rain/);
  assert.match(user, /只改 2~3 处/, 'skill 的迭代规则必须点明，否则模型会整体重写');
});

test('上一轮结果支持多轮追加', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { previous: '1girl, solo, golden hour' },
  }), FAST);

  assert.match(calls[0].body.messages[1].content[0].text, /上一轮给出的版本[\s\S]*golden hour/);
});

test('词库角色直接给串，不让模型另编外貌', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { characters: [{ name: 'satsuki', prompt: 'blonde hair, red eyes, hair ribbon' }] },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.match(user, /satsuki：blonde hair, red eyes/);
  assert.match(user, /不要自己另编外貌/);
});

test('画师库只作参考 —— skill 明说画师串不进输出', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { artists: [{ tag: 'artist:wlop', name: 'WLOP', rating: 5 }] },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.match(user, /artist:wlop（WLOP） ★5/);
  assert.match(user, /默认不要写进输出/);
});

test('超长上下文会截断，不把请求撑爆', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { currentPrompt: 'x'.repeat(9000) },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.match(user, /已截断/);
  assert.ok(user.length < 9000, `实际 ${user.length}`);
});

test('画师和角色都有条数上限', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: {
      artists: Array.from({ length: 200 }, (_, i) => ({ tag: `artist_${i}` })),
      characters: Array.from({ length: 40 }, (_, i) => ({ name: `char_${i}`, prompt: 'x' })),
    },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.equal((user.match(/- artist_/g) || []).length, 120);
  assert.equal((user.match(/- char_/g) || []).length, 16);
});

// 画师库按家族分页，一页上百个是常态。截断的一页比不发更糟 ——
// 模型会以为那一页就只有这几个画师，于是「用我库里的画师」就成了在残页里挑。
test('整整一页画师要能全进来，不能砍掉尾巴', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    context: { artists: Array.from({ length: 114 }, (_, i) => ({ tag: `artist_${i}` })) },
  }), FAST);

  const user = calls[0].body.messages[1].content[0].text;
  assert.equal((user.match(/- artist_/g) || []).length, 114, '一个都不能少');
  assert.match(user, /artist_113/, '最后一个也要在');
});

// ═══════════════════════════ 5. 生成方式与角色栏 ═══════════════════════════

group('生成方式分档');

async function userTextFor(payload) {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload(payload), FAST);
  return calls[0].body.messages[1].content[0].text;
}

async function systemTextFor(payload) {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload(payload), FAST);
  return calls[0].body.messages[0].content;
}

test('四档各自把任务说明整段发出去', async () => {
  assert.match(await userTextFor({ mode: 'default' }), /锚定的 danbooru tag/);
  assert.match(await userTextFor({ mode: 'expanded' }), /不要漏进角色栏/);
  assert.match(await userTextFor({ mode: 'refine' }), /原样保留/);
  assert.match(await userTextFor({ mode: 'tags' }), /能用 tag 表达的就不要写成句子/);
});

test('默认档也会发说明 —— 不是「非默认才说」', async () => {
  assert.match(await userTextFor({}), /本轮的生成方式/);
});

test('认不出来的档位退回默认，不是发一句空话', async () => {
  const text = await userTextFor({ mode: 'nonsense' });
  assert.match(text, /锚定的 danbooru tag/);
});

test('改写档要求保留用户已有的权重', async () => {
  const text = await userTextFor({ mode: 'refine' });
  assert.match(text, /数字权重/);
  assert.match(text, /不要擅自加画师串/);
});

group('角色栏数量');

test('指定数量时说死「正好 N 个」并点名栏位', async () => {
  const text = await userTextFor({ characterCount: 3 });
  assert.match(text, /正好 3 个/);
  assert.match(text, /Character 1 到 Character 3/);
  assert.match(text, /不是 NovelAI 的模型上限/, '1~6 是我们的快捷栏位，得跟模型说清楚');
});

test('自动（0）就不提角色栏数量', async () => {
  const text = await userTextFor({ characterCount: 0 });
  assert.equal(/角色栏数量/.test(text), false);
});

test('超范围会夹回 0~6', async () => {
  assert.match(await userTextFor({ characterCount: 99 }), /正好 6 个/);
  assert.equal(/角色栏数量/.test(await userTextFor({ characterCount: -3 })), false);
  assert.equal(/角色栏数量/.test(await userTextFor({ characterCount: 'abc' })), false);
});

group('规则核对（V5 / V4.5 二选一）');

test('默认附在 system 末尾，排在运行环境补充后面', async () => {
  const system = await systemTextFor({});
  assert.match(system, /NovelAI Diffusion V5 规则核对/);
  assert.ok(
    system.indexOf('运行环境补充') < system.indexOf('V5 规则核对'),
    '运行环境补充要先于 V5 规则',
  );
});

test('几条容易写错的规则都在', async () => {
  const system = await systemTextFor({});
  assert.match(system, /1\.2::tag::/, '分段加权语法');
  assert.match(system, /transparent background/);
  assert.match(system, /alpha transparency/);
  assert.match(system, /depthness/);
  assert.match(system, /ultra complexity/);
  assert.match(system, /最多六人/, '要明确否掉 V4 的旧限制，不是绕开不提');
  assert.match(system, /双引号/, '画面文字');
});

test('关掉开关就一个字都不附（新旧两个字段名都认）', async () => {
  const viaNew = await systemTextFor({ attachRules: false });
  assert.equal(/规则核对/.test(viaNew), false);
  assert.match(viaNew, /运行环境补充/, '关的只是规则那段，别把运行环境也带走');

  const viaLegacy = await systemTextFor({ nai5Rules: false });
  assert.equal(/规则核对/.test(viaLegacy), false, 'v1.5.x 的面板发的是 nai5Rules，得继续认');
});

test('V4.5 档附的是 V4.5 那份，V5 那份不跟着来', async () => {
  const system = await systemTextFor({ dialect: 'v45' });
  assert.match(system, /NovelAI Diffusion V4\.5 规则核对/);
  assert.equal(/V5 规则核对/.test(system), false);
  assert.match(system, /上限是 6 个/, 'V4.5 的六人上限是真的，要说回来');
  assert.equal(/depthness、attractive male/.test(system), false, 'V5 新 tag 的介绍不该出现');
});

test('换成自己的 skill 也照样附上 —— 用户的 skill 多半是按 V4 写的', async () => {
  const system = await systemTextFor({ skill: { name: '我的', body: '随便写点什么' } });
  assert.match(system, /随便写点什么/);
  assert.match(system, /V5 规则核对/);
});

group('格式档位');

test('V4.5 档的默认措辞是纯 tag 路线', async () => {
  const text = await userTextFor({ dialect: 'v45' });
  assert.match(text, /V4\.5 的习惯/);
  assert.match(text, /以 danbooru tag 为主体/);
});

test('V4.5 展开档把六个角色栏的上限说清楚', async () => {
  assert.match(await userTextFor({ dialect: 'v45', mode: 'expanded' }), /V4\.5 最多 6 个/);
});

test('两档的展开写开头一致，前端的档位名对得上', async () => {
  assert.match(await userTextFor({ mode: 'expanded' }), /展开写。/);
  assert.match(await userTextFor({ dialect: 'v45', mode: 'expanded' }), /展开写。/);
});

group('对话历史');

const HISTORY = [
  { role: 'user', text: '雨夜便利店门口的女孩' },
  { role: 'assistant', text: '1girl, convenience store, rainy night' },
];

test('历史原样进 messages：system 之后、本轮 user 之前', async () => {
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({ history: HISTORY }), FAST);

  const messages = calls[0].body.messages;
  assert.equal(messages.length, 4);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(String(messages[1].content), /雨夜便利店门口的女孩/);
  assert.equal(messages[2].role, 'assistant');
  assert.match(String(messages[2].content), /rainy night/);
  assert.equal(messages[3].role, 'user');
  assert.match(messages[3].content[0].text, /本轮的生成方式/, '本轮的 user 仍然带完整任务说明');
});

test('带历史时点明这是迭代；不带就不说', async () => {
  const withHistory = await (async () => {
    const box = newSandbox();
    const calls = box.mockFetch(() => reply('done'));
    await box.get('runPromptAgent')(agentPayload({ history: HISTORY }), FAST);
    return calls[0].body.messages.at(-1).content[0].text;
  })();
  assert.match(withHistory, /对话的延续/);
  assert.match(withHistory, /不要整体重写/);

  assert.equal(/对话的延续/.test(await userTextFor({})), false);
});

test('历史只留最近 6 条，坏条目直接丢', async () => {
  const long = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: `第 ${i + 1} 条`,
  }));
  const box = newSandbox();
  const calls = box.mockFetch(() => reply('done'));
  await box.get('runPromptAgent')(agentPayload({
    history: [...long, { role: 'tool', text: '不该进来' }, { role: 'user', text: '   ' }],
  }), FAST);

  const messages = calls[0].body.messages;
  assert.equal(messages.length, 8, 'system + 6 条历史 + 本轮 user');
  assert.match(String(messages[1].content), /第 5 条/, '裁掉的是最早的');
  assert.equal(messages.some((m) => /不该进来/.test(String(m.content))), false);
});

group('OC 点名');

const OC_LIBRARY = [
  { name: '小夏', aliases: ['Natsuki', '夏夏'], prompt: 'blonde hair, red eyes, hair ribbon' },
  { name: '小秋', aliases: [], prompt: 'black hair, green eyes, glasses' },
  { name: 'ray', aliases: [], prompt: 'white hair, grey eyes' },
];

test('描述里写到名字就只发那几个，并直接指派栏位', async () => {
  const text = await userTextFor({ request: '小夏和小秋在天台上看烟花', context: { characters: OC_LIBRARY } });
  assert.match(text, /Character 1 = 小夏/);
  assert.match(text, /Character 2 = 小秋/);
  assert.equal(/ray/.test(text), false, '没点到的角色一个字都不该发');
  assert.match(text, /不要替换角色设计/);
});

test('slot 按名字在描述里出现的先后排', async () => {
  const text = await userTextFor({ request: '小秋先出场，然后是小夏', context: { characters: OC_LIBRARY } });
  assert.match(text, /Character 1 = 小秋/);
  assert.match(text, /Character 2 = 小夏/);
});

test('别名也算点名，并把别名一起告诉模型', async () => {
  const text = await userTextFor({ request: 'Natsuki 站在雨里', context: { characters: OC_LIBRARY } });
  assert.match(text, /Character 1 = 小夏（又叫 Natsuki、夏夏）/);
  assert.match(text, /blonde hair, red eyes/);
});

test('英文名卡词边界 —— ray 不能被 array、x-ray 带出来', async () => {
  const missed = await userTextFor({ request: 'an array of x-ray photos', context: { characters: OC_LIBRARY } });
  assert.equal(/Character 1 = ray/.test(missed), false);

  const hit = await userTextFor({ request: 'Ray stands in the rain', context: { characters: OC_LIBRARY } });
  assert.match(hit, /Character 1 = ray/);
});

test('一个都没点到就退回原来的列表', async () => {
  const text = await userTextFor({ request: '一个女孩站在雨里', context: { characters: OC_LIBRARY } });
  assert.match(text, /用户词库里的角色/);
  assert.match(text, /- 小夏（又叫 Natsuki、夏夏）：blonde hair/);
  assert.equal(/Character 1 =/.test(text), false);
});

test('点到再多也只取前 6 个 —— 快捷栏位就这么多', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `角色${i}`, prompt: `prompt ${i}` }));
  const text = await userTextFor({
    request: many.map((item) => item.name).join('、'),
    context: { characters: many },
  });
  assert.equal((text.match(/Character \d = /g) || []).length, 6);
});

test('只出现在知识源里的名字不算点名 —— 换了人得能甩掉', async () => {
  const text = await userTextFor({
    request: '一个女孩站在雨里',
    context: { characters: OC_LIBRARY, previous: '小夏 blonde hair' },
  });
  assert.equal(/Character 1 = 小夏/.test(text), false);
});

test('中文句子里夹一个英文名也认得出来', async () => {
  const text = await userTextFor({
    request: '小夏和 aki 在雨夜的天台上',
    characterCount: 2,
    context: { characters: [
      { name: 'natsuki', aliases: ['小夏', 'Natsuki'], prompt: 'blonde hair, red eyes' },
      { name: 'aki', aliases: ['小秋'], prompt: 'black hair, green eyes' },
    ] },
  });
  assert.match(text, /Character 1 = natsuki/);
  assert.match(text, /Character 2 = aki/);
  assert.match(text, /正好 2 个/);
});

test('没有外观串的条目不占栏位', async () => {
  const text = await userTextFor({
    request: '小夏和小秋',
    context: { characters: [{ name: '小夏', prompt: '   ' }, { name: '小秋', prompt: 'black hair' }] },
  });
  assert.match(text, /Character 1 = 小秋/);
  assert.equal(/小夏/.test(text.split('【用户点名的角色')[1] || ''), false);
});

// ═══════════════════════════ 6. 工具查证回路 ═══════════════════════════

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

// ═══════════════════════════ 7. 与 LLM 服务的衔接 ═══════════════════════════

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

// ═══════════════════════════ 8. 图片预算 ═══════════════════════════

group('图片预算');

const KB = 1024;

test('小图不动 —— 重编码只会掉画质', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget')({ width: 800, height: 1200, bytes: 180 * KB, mimeType: 'image/png' });
  assert.equal(plan.needsWork, false);
  assert.equal(plan.reason, 'within-budget');
});

test('超长边缩到 1536，短边等比', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget')({ width: 4096, height: 2048, bytes: 8_000_000, mimeType: 'image/png' });
  assert.equal(plan.needsWork, true);
  assert.equal(plan.reason, 'oversize-edge');
  assert.equal(plan.targetWidth, 1536);
  assert.equal(plan.targetHeight, 768);
});

test('缩完仍然超字节预算才换 JPEG', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget');

  // 8000×8000 缩到 1536 后面积只剩 3.7%，PNG 够用
  const stillPng = plan({ width: 8000, height: 8000, bytes: 20_000_000, mimeType: 'image/png' });
  assert.equal(stillPng.outputType, 'image/png');

  // 2000×2000 只缩到 1536（面积 59%），20MB 缩完还有 11MB，必须换 JPEG
  const toJpeg = plan({ width: 2000, height: 2000, bytes: 20_000_000, mimeType: 'image/png' });
  assert.equal(toJpeg.outputType, 'image/jpeg');
  assert.equal(toJpeg.quality, 0.85);
});

test('尺寸没超但字节超了，也要重编码', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget')({ width: 1200, height: 1200, bytes: 6_000_000, mimeType: 'image/png' });
  assert.equal(plan.needsWork, true);
  assert.equal(plan.reason, 'oversize-bytes');
  assert.equal(plan.scale, 1, '尺寸没超就不缩，只换格式');
  assert.equal(plan.outputType, 'image/jpeg');
});

test('GIF 放过 —— 重编码只会拿到第一帧', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget')({ width: 4000, height: 4000, bytes: 9_000_000, mimeType: 'image/gif' });
  assert.equal(plan.needsWork, false);
  assert.equal(plan.reason, 'animated');
});

test('拿不到尺寸就不动它', () => {
  const box = newSandbox();
  const plan = box.get('planImageBudget')({ width: 0, height: 0, bytes: 9_000_000, mimeType: 'image/png' });
  assert.equal(plan.needsWork, false);
});

test('base64 字节估算认得 padding', () => {
  const box = newSandbox();
  const estimate = box.get('estimateDataUrlBytes');
  assert.equal(estimate('data:image/png;base64,AAAA'), 3);
  assert.equal(estimate('data:image/png;base64,AAA='), 2);
  assert.equal(estimate('data:image/png;base64,AA=='), 1);
  assert.equal(estimate(''), 0);
});

await run('Agent 测试');
