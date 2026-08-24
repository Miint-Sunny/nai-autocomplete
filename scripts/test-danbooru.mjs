// danbooru 查询通道测试。
//
// 这条链路只在本地词典未命中时才走，所以它坏了不会报错，只会让模型继续编 tag。
// 三件事必须守住：
//   · 直连失败要退到「借用户标签页」，不是直接放弃
//   · 两条都失败必须返回 null —— 查证是加分项，不该让整轮生成挂掉
//   · 同一个查询不能反复发请求（danbooru 的礼节是别超 10 请求/秒）
//
//   node scripts/test-danbooru.mjs

import assert from 'node:assert/strict';
import { group, test, deepEqual, run } from './lib/tiny-test.mjs';
import { createBackgroundSandbox, jsonResponse } from './lib/background-sandbox.mjs';

function makeBox() {
  const box = createBackgroundSandbox();
  return box;
}

const TAG_ROW = { name: 'cowboy_shot', post_count: 412000, category: 0 };

// ═══════════════════════ 1. 通道 ═══════════════════════

group('通道');

test('直连成功就不碰标签页', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  const matches = await box.get('searchDanbooruTags')('cowboy shot');

  deepEqual(matches, [{ tag: 'cowboy_shot', category: '0', posts: 412000, zh: '', source: 'danbooru' }]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('search%5Bname%5D=cowboy_shot'), calls[0].url);
  assert.equal(box.chrome.calls.filter((c) => c.method === 'scripting.executeScript').length, 0);
});

test('空格会被换成下划线', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  await box.get('searchDanbooruTags')('Cowboy  Shot');
  assert.ok(calls[0].url.includes('cowboy_shot'), calls[0].url);
});

test('直连挂了就借用户打开着的 danbooru 标签页', async () => {
  const box = makeBox();
  box.mockFetch(() => { throw new Error('network down'); });
  box.chrome.tabsResult = [{ id: 42, url: 'https://danbooru.donmai.us/posts' }];
  box.chrome.scriptingResult = [{ result: { ok: true, text: JSON.stringify([TAG_ROW]) } }];

  const matches = await box.get('searchDanbooruTags')('cowboy_shot');
  assert.equal(matches[0].tag, 'cowboy_shot');

  const injected = box.chrome.calls.find((c) => c.method === 'scripting.executeScript');
  assert.ok(injected, '没有走标签页通道');
  assert.equal(injected.args[0].target.tabId, 42);
  assert.ok(String(injected.args[0].args[0]).startsWith('https://danbooru.donmai.us/'), '注入的是 danbooru 地址');
});

test('没有 danbooru 标签页时两条都失败', async () => {
  const box = makeBox();
  box.mockFetch(() => { throw new Error('network down'); });
  box.chrome.tabsResult = [];
  const error = await box.get('searchDanbooruTags')('cowboy_shot').then(() => null, (e) => e);
  assert.ok(error, '应该抛错');
  assert.ok(/network down/.test(error.message) && /标签页/.test(error.message), error.message);
});

test('HTTP 4xx 也算失败，会往下一条通道走', async () => {
  const box = makeBox();
  box.mockFetch(() => jsonResponse({ error: 'nope' }, { status: 503 }));
  box.chrome.tabsResult = [{ id: 7 }];
  box.chrome.scriptingResult = [{ result: { ok: true, text: JSON.stringify([TAG_ROW]) } }];
  const matches = await box.get('searchDanbooruTags')('cowboy_shot');
  assert.equal(matches[0].tag, 'cowboy_shot');
});

// ═══════════════════════ 2. 缓存 ═══════════════════════

group('缓存');

test('同一个查询只发一次请求', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  await box.get('searchDanbooruTags')('cowboy_shot');
  await box.get('searchDanbooruTags')('cowboy_shot');
  await box.get('searchDanbooruTags')('COWBOY SHOT');
  assert.equal(calls.length, 1, `发了 ${calls.length} 次`);
});

test('不同查询各发各的', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  await box.get('searchDanbooruTags')('cowboy_shot');
  await box.get('searchDanbooruTags')('from_below');
  assert.equal(calls.length, 2);
});

// ═══════════════════════ 3. 精确 / 前缀 / 别名 ═══════════════════════

group('查询语义');

test('精确命中就不再前缀查', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  await box.get('searchDanbooruTags')('cowboy_shot');
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes('name_matches'), '不该发前缀查询');
});

test('精确查不到才前缀查', async () => {
  const box = makeBox();
  const calls = box.mockFetch((call) => (call.url.includes('search%5Bname%5D=')
    ? jsonResponse([])
    : jsonResponse([TAG_ROW, { name: 'cowboy_western', post_count: 900, category: 0 }])));
  const matches = await box.get('searchDanbooruTags')('cowboy');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('name_matches'), calls[1].url);
  assert.equal(matches.length, 2);
});

test('别名会被解析成标准写法', async () => {
  const box = makeBox();
  box.mockFetch((call) => {
    if (call.url.includes('tag_aliases.json')) {
      return jsonResponse([{ antecedent_name: 'catgirl', consequent_name: 'cat_girl', status: 'active' }]);
    }
    return jsonResponse([{ name: 'cat_girl', post_count: 120000, category: 0 }]);
  });
  const result = await box.get('lookupTagOnDanbooru')('catgirl');
  assert.equal(result.status, 'alias');
  assert.ok(result.note.includes('cat_girl'), result.note);
  assert.equal(result.matches[0].tag, 'cat_girl');
});

test('奇怪字符不发请求（别把用户的中文描述整段送出去）', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  deepEqual(await box.get('searchDanbooruTags')('雨夜霓虹'), []);
  deepEqual(await box.get('searchDanbooruTags')('a girl; DROP TABLE'), []);
  assert.equal(calls.length, 0, '不该发出任何请求');
});

test('查证失败返回 null，不抛 —— 不能让整轮生成挂掉', async () => {
  const box = makeBox();
  box.mockFetch(() => { throw new Error('boom'); });
  box.chrome.tabsResult = [];
  assert.equal(await box.get('lookupTagOnDanbooru')('cowboy_shot'), null);
});

// ═══════════════════════ 4. 接进 Agent 工具 ═══════════════════════

group('Agent 工具');

const LOCAL_INDEX = [
  { tag: '1girl', category: '0', postCount: 5800000, aliases: [], translation: '1女孩' },
];

test('本地命中就不查 danbooru', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  const out = await box.get('executeAgentTool')({ name: 'search_tags', arguments: { queries: ['1girl'] } }, LOCAL_INDEX, { allowDanbooruLookup: true });
  assert.equal(out['1girl'][0].tag, '1girl');
  assert.equal(calls.length, 0);
});

test('本地没有才查 danbooru，并标出来源', async () => {
  const box = makeBox();
  box.mockFetch((call) => (call.url.includes('tag_aliases.json') ? jsonResponse([]) : jsonResponse([TAG_ROW])));
  const out = await box.get('executeAgentTool')(
    { name: 'search_tags', arguments: { queries: ['cowboy_shot'] } }, LOCAL_INDEX, { allowDanbooruLookup: true },
  );
  assert.equal(out.cowboy_shot[0].source, 'danbooru');
});

test('调用方没传标志时不发远程请求（第三方请求必须显式 opt-in）', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  const out = await box.get('executeAgentTool')(
    { name: 'search_tags', arguments: { queries: ['cowboy_shot'] } }, LOCAL_INDEX, {},
  );
  assert.equal(out.cowboy_shot, 'not_found');
  assert.equal(calls.length, 0);
});

test('关掉开关就只查本地', async () => {
  const box = makeBox();
  const calls = box.mockFetch(() => jsonResponse([TAG_ROW]));
  const out = await box.get('executeAgentTool')(
    { name: 'search_tags', arguments: { queries: ['cowboy_shot'] } },
    LOCAL_INDEX,
    { allowDanbooruLookup: false },
  );
  assert.equal(out.cowboy_shot, 'not_found');
  assert.equal(calls.length, 0);
});

test('本地词典空着但允许远程时，仍然能查', async () => {
  const box = makeBox();
  box.mockFetch((call) => (call.url.includes('tag_aliases.json') ? jsonResponse([]) : jsonResponse([TAG_ROW])));
  const out = await box.get('executeAgentTool')({ name: 'search_tags', arguments: { queries: ['cowboy_shot'] } }, [], { allowDanbooruLookup: true });
  assert.equal(out.cowboy_shot[0].tag, 'cowboy_shot');
});

test('本地空且不允许远程时给出可操作的提示', async () => {
  const box = makeBox();
  const out = await box.get('executeAgentTool')(
    { name: 'search_tags', arguments: { queries: ['x'] } }, [], { allowDanbooruLookup: false },
  );
  assert.ok(out.error.includes('novelai.net'), out.error);
});

await run('danbooru 查询通道测试');
