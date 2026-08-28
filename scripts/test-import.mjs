// 导入链路的测试：酒馆（SillyTavern）预设 JSON → 消息块，skill markdown → skill 对象。
//
//   node scripts/test-import.mjs
//
// 形状都是对着 SillyTavern 官方的 default/content/presets/openai/Default.json 写的，
// 尤其是那两个「布尔值是字符串」的坑 —— 它们不报错，只是静默少几块。

import assert from 'node:assert/strict';
import { group, test, deepEqual, captureError, run } from './lib/tiny-test.mjs';
import { createAssistantSandbox } from './lib/assistant-sandbox.mjs';

const box = createAssistantSandbox();
const analyzeStPreset = box.get('analyzeStPreset');
const describeStPresetImport = box.get('describeStPresetImport');
const buildSkillFromTexts = box.get('buildSkillFromTexts');
const splitSkillFileTexts = box.get('splitSkillFileTexts');
const joinSkillFileTexts = box.get('joinSkillFileTexts');
const describeAgentSkillImport = box.get('describeAgentSkillImport');

// 没有 user 块时会自动补一块 {{booru_tags}}（另有专门的用例覆盖）。
// 顺序和取舍这几项只看原本那些块，免得被它搅进来。
const realBlocks = (analysis) => analysis.blocks.filter((block) => block.content !== '{{booru_tags}}');
const contents = (analysis) => realBlocks(analysis).map((block) => block.content.replace(/\n\n\{\{booru_tags\}\}$/, ''));

// ═══════════════════════ 1. 酒馆预设：那两个字符串布尔值 ═══════════════════════

group('酒馆预设 · 字符串写的布尔值');

test('marker: "False" 的条目要保留 —— 字符串 "False" 本身是真值', () => {
  const analysis = analyzeStPreset({
    name: 'x',
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', content: '主提示词' },
      // Default.json 里 enhanceDefinitions 就长这样：有正文，而且显式标了自己不是占位符
      { identifier: 'enhanceDefinitions', name: 'Enhance Definitions', role: 'system', content: '补充设定', system_prompt: 'True', marker: 'False' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'enhanceDefinitions', enabled: true }] }],
  });

  deepEqual(contents(analysis), ['主提示词', '补充设定'], 'enhanceDefinitions 被当成占位符丢了');
  deepEqual(analysis.skipped, [], '不该跳过任何东西');
});

test('marker: "True" 且没有正文的占位符跳过，并如实报出名字', () => {
  const analysis = analyzeStPreset({
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', content: '主提示词' },
      { identifier: 'chatHistory', name: 'Chat History', system_prompt: 'True', marker: 'True' },
      { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: 'True', marker: 'True' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'main' }, { identifier: 'chatHistory' }, { identifier: 'worldInfoBefore' }] }],
  });

  deepEqual(contents(analysis), ['主提示词'], '只该留下有正文的那条');
  deepEqual(analysis.skipped, ['Chat History', 'World Info (before)'], '跳过的名字要报出来');
});

test('system_prompt: "True" 不影响 role，写了 role 就听 role 的', () => {
  const analysis = analyzeStPreset({
    prompts: [
      { identifier: 'a', role: 'user', content: '甲', system_prompt: 'True' },
      { identifier: 'b', content: '乙', system_prompt: 'False' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'a' }, { identifier: 'b' }] }],
  });

  deepEqual(realBlocks(analysis).map((block) => block.role), ['user', 'system'], 'role 判定不对');
});

// ═══════════════════════ 2. prompt_order ═══════════════════════

group('酒馆预设 · prompt_order');

test('取 character_id 100000 那条全局顺序，不是数组第一条', () => {
  const analysis = analyzeStPreset({
    prompts: [
      { identifier: 'a', content: '甲' },
      { identifier: 'b', content: '乙' },
      { identifier: 'c', content: '丙' },
    ],
    prompt_order: [
      // 某个角色自己的顺序排在前面，取第一条就取错了
      { character_id: 42, order: [{ identifier: 'c' }, { identifier: 'b' }, { identifier: 'a' }] },
      { character_id: 100000, order: [{ identifier: 'a' }, { identifier: 'b' }, { identifier: 'c' }] },
    ],
  });

  deepEqual(contents(analysis), ['甲', '乙', '丙'], '取错了 prompt_order 那条');
});

test('没有 100000 那条就退回第一条可用的顺序', () => {
  const analysis = analyzeStPreset({
    prompts: [{ identifier: 'a', content: '甲' }, { identifier: 'b', content: '乙' }],
    prompt_order: [{ character_id: 7, order: [{ identifier: 'b' }, { identifier: 'a' }] }],
  });

  deepEqual(contents(analysis), ['乙', '甲'], '没有全局顺序时该退回第一条');
});

test('不在顺序表里的补在后面，一条都不丢', () => {
  const analysis = analyzeStPreset({
    prompts: [{ identifier: 'a', content: '甲' }, { identifier: 'b', content: '乙' }, { identifier: 'z', content: '漏网的' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'b' }, { identifier: 'a' }] }],
  });

  deepEqual(contents(analysis), ['乙', '甲', '漏网的'], '不在顺序表里的被丢了');
});

test('关掉的条目保留下来并标成停用，不是直接丢掉', () => {
  const analysis = analyzeStPreset({
    prompts: [{ identifier: 'a', content: '甲' }, { identifier: 'b', content: '乙' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }] }],
  });

  deepEqual(contents(analysis), ['甲', '乙'], '关掉的被丢了');
  deepEqual(realBlocks(analysis).map((block) => block.enabled), [true, false], '停用状态没带过来');
});

// ═══════════════════════ 3. {{booru_tags}} ═══════════════════════

group('酒馆预设 · booru 变量');

test('缺 {{booru_tags}} 时补在最后一条启用的 user 块后面', () => {
  const analysis = analyzeStPreset({
    prompts: [
      { identifier: 'a', role: 'system', content: '系统' },
      { identifier: 'b', role: 'user', content: '用户' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'a' }, { identifier: 'b' }] }],
  });

  assert.equal(analysis.addedBooruVar, true);
  assert.equal(analysis.blocks[1].content, '用户\n\n{{booru_tags}}');
});

test('没有 user 块就单开一块', () => {
  const analysis = analyzeStPreset({
    prompts: [{ identifier: 'a', role: 'system', content: '系统' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'a' }] }],
  });

  assert.equal(analysis.blocks.length, 2);
  deepEqual(analysis.blocks[1], { id: analysis.blocks[1].id, role: 'user', content: '{{booru_tags}}', enabled: true }, '补出来的块形状不对');
});

test('本来就有的不重复补', () => {
  const analysis = analyzeStPreset({
    prompts: [{ identifier: 'a', role: 'user', content: '看图：{{booru_tags}}' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'a' }] }],
  });

  assert.equal(analysis.addedBooruVar, false);
  assert.equal(analysis.blocks.length, 1);
});

// ═══════════════════════ 4. 说不通的输入 ═══════════════════════

group('酒馆预设 · 说不通的输入');

test('没有 prompts 就抛错', async () => {
  const error = await captureError(() => analyzeStPreset({ name: '空的' }));
  assert.match(error.message, /prompts/);
});

test('全是没正文的占位符也抛错', async () => {
  const error = await captureError(() => analyzeStPreset({
    prompts: [{ identifier: 'chatHistory', name: 'Chat History', marker: 'True' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'chatHistory' }] }],
  }));
  assert.match(error.message, /prompts/);
});

test('坏 JSON 给的是能看懂的一句话，不是抛出去', () => {
  const result = describeStPresetImport('{ 这不是 json');
  assert.equal(result.ok, false);
  assert.match(result.summary, /不是合法的 JSON/);
});

test('好 JSON 的摘要要说清楚得到几块、跳了什么', () => {
  const result = describeStPresetImport(JSON.stringify({
    name: '我的预设',
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', content: '主提示词' },
      { identifier: 'chatHistory', name: 'Chat History', marker: 'True' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'main' }, { identifier: 'chatHistory' }] }],
  }));

  assert.equal(result.ok, true);
  assert.match(result.summary, /我的预设/);
  assert.match(result.summary, /2 个消息块/);
  assert.match(result.summary, /Chat History/);
  assert.match(result.summary, /\{\{booru_tags\}\}/);
});

test('空文本不报错也不给摘要', () => {
  deepEqual(describeStPresetImport('   '), { ok: false, summary: '' }, '空文本不该有摘要');
});

// ═══════════════════════ 5. skill 导入 ═══════════════════════

group('skill 导入');

const SKILL_MAIN = `---
name: 我的写词 skill
description: 用来测试的
---

正文第一段。

正文第二段。`;

test('frontmatter 里的 name / description 生效，正文不带 frontmatter', () => {
  const skill = buildSkillFromTexts([{ name: 'whatever.md', text: SKILL_MAIN }]);
  assert.equal(skill.name, '我的写词 skill');
  assert.equal(skill.description, '用来测试的');
  assert.equal(skill.body.startsWith('正文第一段'), true);
  assert.equal(skill.body.includes('---'), false);
});

test('没有 frontmatter 就用文件名，扩展名去掉', () => {
  const skill = buildSkillFromTexts([{ name: 'nai5-prompting.md', text: '光秃秃的正文' }]);
  assert.equal(skill.name, 'nai5-prompting');
  assert.equal(skill.body, '光秃秃的正文');
});

test('多份文本里带 name 的那份当正文，哪怕它不是第一份', () => {
  const skill = buildSkillFromTexts([
    { name: 'references/风格表.md', text: '# 风格表\n一堆参考' },
    { name: 'skill.md', text: SKILL_MAIN },
  ]);

  assert.equal(skill.name, '我的写词 skill');
  assert.equal(skill.references.length, 1);
  assert.equal(skill.references[0].name, 'references/风格表.md');
});

test('拼起来再拆开，还是原来那几份', () => {
  const items = [
    { name: 'skill.md', text: SKILL_MAIN },
    { name: 'references/a.md', text: '参考 A' },
    { name: 'references/b.md', text: '参考 B' },
  ];

  const sections = splitSkillFileTexts(joinSkillFileTexts(items));
  deepEqual(sections.map((section) => section.name), ['', 'references/a.md', 'references/b.md'], '拆出来的份数或名字不对');
  deepEqual(sections.map((section) => section.text), [SKILL_MAIN, '参考 A', '参考 B'], '拆出来的正文变了');
});

test('直接粘一整段（没有分隔标记）就是一份正文', () => {
  const sections = splitSkillFileTexts(SKILL_MAIN);
  assert.equal(sections.length, 1);
  assert.equal(buildSkillFromTexts(sections).name, '我的写词 skill');
});

test('把分隔标记删掉就是把两份并成一份', () => {
  const joined = joinSkillFileTexts([
    { name: 'skill.md', text: SKILL_MAIN },
    { name: 'a.md', text: '参考 A' },
  ]);
  const merged = joined.split('\n').filter((line) => !line.startsWith('<!-- nai-file:')).join('\n');

  assert.equal(splitSkillFileTexts(merged).length, 1);
  assert.equal(buildSkillFromTexts(splitSkillFileTexts(merged)).references.length, 0);
});

test('空内容抛错，不会造出一个空 skill', async () => {
  const error = await captureError(() => buildSkillFromTexts(splitSkillFileTexts('   \n  ')));
  assert.match(error.message, /没有读到内容/);
});

test('摘要要说清楚正文多少字、几份参考资料', () => {
  const result = describeAgentSkillImport(joinSkillFileTexts([
    { name: 'skill.md', text: SKILL_MAIN },
    { name: 'a.md', text: '参考 A' },
  ]));

  assert.equal(result.ok, true);
  assert.match(result.summary, /我的写词 skill/);
  assert.match(result.summary, /1 份参考资料/);
});

await run('导入链路');
