// TAG 流编辑器的模型测试。最重要的一条：没编辑过的规范文本必须原样回来。
//
//   node scripts/test-flow.mjs

import assert from 'node:assert/strict';
import { group, test, deepEqual, run } from './lib/tiny-test.mjs';
import { createFlowSandbox } from './lib/flow-sandbox.mjs';

const box = createFlowSandbox();
const parse = box.get('flowParse');
const serialize = box.get('flowSerialize');

function roundTrip(text) {
  return serialize(parse(text));
}

// ═══════════════════════════ 1. 往返保真 ═══════════════════════════

group('往返保真');

const CANONICAL = [
  ['单行 tag', '1girl, solo, cat_ears'],
  ['数值权重', '1girl, 1.2::cat_ears::, solo'],
  ['负权重', '1girl, -1::hat::, solo'],
  ['权重组', '8::best quality, absurdres::, 1girl'],
  ['多段 + 收尾竖线', '1girl, outdoors | blonde hair, blue eyes | red hair, green eyes |'],
  ['多段无收尾竖线', 'base tags | char one | char two'],
  ['换行分层', '1girl, solo, full body\nThe character is running through shallow water.\nsoft lighting, light blue theme'],
  ['空行分隔', '1girl, solo\n\nCharacter 1: standing near the window.'],
  ['行尾句号', '1girl, solo, from below.\nThe scene is a flooded street at dusk.'],
  ['整句在段中间', '2girls, full body.\nThe scene is a darkroom lit by a red safelight.\nCharacter A stands at the left side of the room.\nmotion lines'],
];

for (const [name, text] of CANONICAL) {
  test(name, () => assert.equal(roundTrip(text), text));
}

test('空文本', () => {
  assert.equal(roundTrip(''), '');
  assert.equal(parse('').segments.length, 1);
});

// ═══════════════════════════ 2. 旧语法归一 ═══════════════════════════

group('旧语法归一');

test('NAI 花括号 / 方括号折算成数值', () => {
  assert.equal(roundTrip('{cat_ears}'), '1.05::cat_ears::');
  assert.equal(roundTrip('{{cat_ears}}'), '1.1::cat_ears::');
  assert.equal(roundTrip('[hat]'), '0.95::hat::');
});

test('SD 的 (tag:1.3) 也认', () => {
  assert.equal(roundTrip('(cat_ears:1.3)'), '1.3::cat_ears::');
});

test('多余空格和空条目被清掉', () => {
  assert.equal(roundTrip('1girl ,  solo ,, cat_ears'), '1girl, solo, cat_ears');
});

test('单成员权重组塌成普通带权 tag', () => {
  assert.equal(roundTrip('1.2::rain::'), '1.2::rain::');
  const flow = parse('1.2::rain::');
  assert.equal(flow.segments[0].items[0].kind, 'tag');
  assert.equal(flow.segments[0].items[0].weight, 1.2);
});

test('嵌套权重相乘', () => {
  assert.equal(roundTrip('1.2::{rain}::'), '1.26::rain::');
});

// ═══════════════════════════ 3. 整句判定 ═══════════════════════════

group('整句判定');

test('自然语言段落认成整句', () => {
  const kinds = (text) => parse(text).segments[0].items.map((item) => item.kind);
  deepEqual(kinds('The character stands just outside the entrance.'), ['sentence']);
  deepEqual(kinds('Her body is caught halfway through a natural running motion.'), ['sentence']);
});

test('句子里的逗号不会把一句话切碎', () => {
  const text = '1girl, solo.\nThe character stands just outside the entrance, holding the umbrella slightly tilted back.';
  const items = parse(text).segments[0].items;
  const sentences = items.filter((item) => item.kind === 'sentence');
  assert.equal(sentences.length, 1, '整句应该合成一条');
  assert.match(sentences[0].raw, /entrance, holding/);
  assert.equal(serialize(parse(text)), text, '合并用的还是 ", "，往返仍要一字不差');
});

test('整句后面跟 tag 时不误并', () => {
  const items = parse('The scene is a dark room, motion lines, blush').segments[0].items;
  deepEqual(items.map((item) => item.kind), ['sentence', 'tag', 'tag']);
});

test('长 tag 不能被误判成整句', () => {
  const kinds = (text) => parse(text).segments[0].items.map((item) => item.kind);
  deepEqual(kinds('hand on own chest'), ['tag']);
  deepEqual(kinds('looking at viewer'), ['tag']);
  deepEqual(kinds('long flowing blonde hair'), ['tag']);
});

test('行尾句号归行不归 tag —— 重排后不会跑到行中间', () => {
  const flow = parse('1girl, solo, from below.');
  const items = flow.segments[0].items;
  assert.equal(items[2].kind, 'tag');
  assert.equal(items[2].name, 'from below');
  assert.equal(items[2].trailing, '.');

  // 把带句号的那个挪到开头，句号应该留在行尾
  box.get('flowMoveItem')(flow, items[2].id, flow.segments[0].id, 0);
  assert.equal(serialize(flow), 'from below, 1girl, solo.');
});

// ═══════════════════════════ 4. 分段 ═══════════════════════════

group('分段');

test('段的角色命名', () => {
  const flow = parse('base | char a | char b |');
  deepEqual(flow.segments.map((segment) => [segment.kind, segment.name]), [
    ['base', '基础'], ['character', '角色 1'], ['character', '角色 2'],
  ]);
});

test('单段不叫基础', () => {
  const flow = parse('1girl, solo');
  assert.equal(flow.segments[0].kind, 'single');
});

test('权重组里的竖线不会被当成分段', () => {
  const flow = parse('1.2::a, b::, c');
  assert.equal(flow.segments.length, 1);
});

test('无角色导出只取基础段', () => {
  const flow = parse('1girl, outdoors | blonde hair | red hair |');
  assert.equal(box.get('flowSerializeBaseOnly')(flow), '1girl, outdoors');
});

test('增删段会重排命名并补上收尾竖线', () => {
  const flow = parse('1girl, solo');
  box.get('flowAddSegment')(flow);
  assert.equal(flow.segments[1].name, '角色 1');
  assert.equal(flow.trailingPipe, true);
  assert.equal(serialize(flow), '1girl, solo |  |');

  box.get('flowRemoveSegment')(flow, flow.segments[1].id);
  assert.equal(flow.segments[0].kind, 'single');
});

// ═══════════════════════════ 5. 结构操作 ═══════════════════════════

group('结构操作');

test('删除 tag', () => {
  const flow = parse('1girl, solo, cat_ears');
  const target = flow.segments[0].items[1];
  box.get('flowRemoveItem')(flow, target.id);
  assert.equal(serialize(flow), '1girl, cat_ears');
});

test('跨段移动 —— 把 tag 挪到另一个角色', () => {
  const flow = parse('1girl | blonde hair | red hair |');
  const moved = flow.segments[1].items[0];
  box.get('flowMoveItem')(flow, moved.id, flow.segments[2].id, 0);
  assert.equal(serialize(flow), '1girl |  | blonde hair, red hair |');
});

test('移动到行首时不会留下孤立换行', () => {
  const flow = parse('a, b\nc, d');
  const target = flow.segments[0].items[2];
  box.get('flowMoveItem')(flow, target.id, flow.segments[0].id, 0);
  assert.equal(serialize(flow), 'c, a, b\nd');
});

test('多选加权成组', () => {
  const flow = parse('1girl, rain, night, solo');
  const items = flow.segments[0].items;
  box.get('flowGroupItems')(flow, [items[1].id, items[2].id], 1.5);
  assert.equal(serialize(flow), '1girl, 1.5::rain, night::, solo');
});

test('组权重调回 1 就自动拆开', () => {
  const flow = parse('1.5::rain, night::, solo');
  const groupItem = flow.segments[0].items[0];
  box.get('flowSetItemWeight')(flow, groupItem.id, 1);
  assert.equal(serialize(flow), 'rain, night, solo');
});

test('拆组时把组权重乘回每个成员', () => {
  const flow = parse('1.2::rain, night::');
  box.get('flowDissolveGroup')(flow, flow.segments[0].items[0].id);
  assert.equal(serialize(flow), '1.2::rain::, 1.2::night::');
});

test('组里删到只剩一个就自动拆开', () => {
  const flow = parse('1.5::rain, night::, solo');
  const groupItem = flow.segments[0].items[0];
  box.get('flowRemoveItem')(flow, groupItem.items[1].id);
  assert.equal(serialize(flow), '1.5::rain::, solo');
});

test('去重保留最大权重，跨段不去重', () => {
  const flow = parse('1girl, cat ears, 1.3::cat_ears::, solo | cat_ears |');
  const removed = box.get('flowDedupe')(flow);
  assert.equal(removed, 1);
  assert.equal(serialize(flow), '1girl, 1.3::cat ears::, solo | cat_ears |');
});

test('统计 tag 数（组内成员单独计）', () => {
  assert.equal(box.get('flowCountTags')(parse('1girl, 1.5::rain, night::, solo\nThe scene is dark.')), 4);
});

// ═══════════════════════════ 6. 整句是一等公民 ═══════════════════════════

group('整句是一等公民');

test('整句可以带权重，往返不变', () => {
  const text = '1girl, solo.\n1.3::The character is running through shallow water.::';
  const items = parse(text).segments[0].items;
  const sentence = items.find((item) => item.kind === 'sentence');
  assert.equal(sentence.weight, 1.3);
  assert.equal(serialize(parse(text)), text);
});

test('权重不同的两句不合并 —— 合了会丢权重', () => {
  const text = 'The scene is a dark room., 1.2::The camera is placed low.::';
  const items = parse(text).segments[0].items;
  assert.equal(items.filter((item) => item.kind === 'sentence').length, 2);
  assert.equal(serialize(parse(text)), text);
});

test('tag ⇄ 整句 手动互转', () => {
  const toggle = box.get('flowToggleItemKind');

  const flow = parse('1girl, from below.');
  const target = flow.segments[0].items[1];
  toggle(flow, target.id);
  assert.equal(flow.segments[0].items[1].kind, 'sentence');
  assert.equal(serialize(flow), '1girl, from below.');

  toggle(flow, target.id);
  assert.equal(flow.segments[0].items[1].kind, 'tag');
  assert.equal(serialize(flow), '1girl, from below.', '来回转一圈文本不变');
});

test('互转保留权重', () => {
  const toggle = box.get('flowToggleItemKind');
  const flow = parse('1.4::dynamic pose::');
  toggle(flow, flow.segments[0].items[0].id);
  assert.equal(flow.segments[0].items[0].kind, 'sentence');
  assert.equal(serialize(flow), '1.4::dynamic pose::');
});

test('加权的整段不会被内部逗号炸成组', () => {
  const text = '1.2::The character is caught halfway through pushing the pole, her hair reacts to the movement.::';
  const items = parse(text).segments[0].items;
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'sentence', '应该还是一整句，不是两成员的组');
  assert.equal(items[0].weight, 1.2);
  assert.equal(serialize(parse(text)), text);
});

test('氛围光归光影不归场景 —— 对应 skill 第 3 节那张词表', () => {
  const semanticOf = box.get('flowSemanticOf');
  assert.equal(semanticOf('golden hour'), 'light');
  assert.equal(semanticOf('moonlight'), 'light');
  assert.equal(semanticOf('night'), 'scene', '时间仍归场景');
  assert.equal(semanticOf('dusk'), 'scene');
});

test('整句职能识别 —— skill 要求一段一个职能', () => {
  const role = box.get('flowSentenceRole');
  assert.equal(role('The camera is placed extremely low, almost touching the bottom step.').id, 'camera');
  assert.equal(role('The scene is a flooded street at dusk.').id, 'scene');
  assert.equal(role('The character is caught halfway through a running motion.').id, 'action');
  assert.equal(role('Character A stands at the left side of the room.').id, 'action');
  assert.equal(role('Strong late-afternoon sunlight creates complicated cast shadows.').id, 'light');
  assert.equal(role('Everything smells faintly of vinegar.').id, 'prose');
});

// ═══════════════════════════ 7. 两层分类 ═══════════════════════════

group('两层分类');

const semantic = box.get('flowSemanticOf');
const classify = box.get('flowClassify');

const SEMANTIC_CASES = {
  subject: ['1girl', '2girls', '6+girls', 'solo', 'no humans', 'multiple girls'],
  quality: ['masterpiece', 'best quality', 'ultra complexity', 'absurdres', 'very aesthetic'],
  camera: ['from below', 'full body', 'cowboy shot', 'close-up', 'depth of field', 'dutch angle'],
  light: ['soft lighting', 'light blue theme', 'backlighting', 'god rays', 'intense shadows', 'rim light'],
  expression: ['smile', 'blush', 'closed eyes', 'looking at viewer', 'open mouth'],
  outfit: ['school uniform', 'thighhighs', 'sailor collar', 'pleated skirt', 'hair ornament'],
  appearance: ['blue eyes', 'long hair', 'cat ears', 'large breasts', 'blunt bangs'],
  pose: ['standing', 'holding umbrella', 'dynamic pose', 'hand on hip', 'crossed arms'],
  scene: ['outdoors', 'night', 'rain', 'convenience store', 'white background', 'cityscape'],
  other: ['transparent umbrella', 'wooden canoe', 'enlarger'],
};

for (const [expected, tags] of Object.entries(SEMANTIC_CASES)) {
  test(`语义分类 · ${expected}`, () => {
    for (const tag of tags) {
      assert.equal(semantic(tag), expected, `${tag} 应归为 ${expected}，实际 ${semantic(tag)}`);
    }
  });
}

test('规则顺序：具体压过笼统', () => {
  assert.equal(semantic('closed eyes'), 'expression', 'closed eyes 是表情不是外貌');
  assert.equal(semantic('blue eyes'), 'appearance');
  assert.equal(semantic('light blue theme'), 'light', 'theme 是色彩不是场景');
  assert.equal(semantic('white background'), 'scene');
  assert.equal(semantic('solo focus'), 'subject', 'solo focus 是主体不是构图');
  assert.equal(semantic('face focus'), 'camera');
});

test('下划线和空格等价', () => {
  assert.equal(semantic('school_uniform'), semantic('school uniform'));
  assert.equal(semantic('from_below'), 'camera');
});

test('第一层用词典的 category', () => {
  const artist = classify('wlop', { tag: 'wlop', category: '1', postCount: 5000, translation: '' });
  assert.equal(artist.source, 'artist');
  assert.equal(artist.semantic, 'artist', '画师不再套语义规则');
  assert.equal(artist.sourceLabel, '画师');

  const character = classify('hatsune miku', { tag: 'hatsune_miku', category: '4', postCount: 200000 });
  assert.equal(character.source, 'character');

  const general = classify('cat ears', { tag: 'cat_ears', category: '0', postCount: 300000, translation: '猫耳' });
  assert.equal(general.source, 'general');
  assert.equal(general.semantic, 'appearance');
  assert.equal(general.zh, '猫耳');
  assert.equal(general.posts, 300000);
});

test('词典查不到要标出来 —— 模型多半也不认识', () => {
  const unknown = classify('zzz not a tag', null);
  assert.equal(unknown.known, false);
  assert.equal(unknown.source, 'unknown');
  assert.equal(unknown.sourceLabel, '词典无');
  assert.equal(unknown.semantic, 'other', '查不到也照样给语义猜测');
});

test('post 量格式化', () => {
  const format = box.get('flowFormatPosts');
  assert.equal(format(4000000), '4.0M');
  assert.equal(format(500000), '500k');
  assert.equal(format(12000), '12k');
  assert.equal(format(1200), '1.2k');
  assert.equal(format(300), '300');
});

await run('TAG 流模型测试');
