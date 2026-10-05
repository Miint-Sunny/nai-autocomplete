// 画师库页的测试：半星评分、星级筛选、对比记录重新编辑（issue #4）。
//
//   node scripts/test-artist.mjs
//
// 点星星、按方向键都是往假 document 上派发事件，走的是 09 里真的那份分发；
// 手机版是把 buildMobileViewerHtml 导出的那张 HTML 里的脚本单独拎出来跑 ——
// 它在用户手机上离线运行、引不到画师库页的任何函数，测试也得这样跑才算数。

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { group, test, deepEqual, run } from './lib/tiny-test.mjs';
import { createArtistSandbox, createFakeDom, fakeElement } from './lib/artist-sandbox.mjs';

const IMG_A = 'data:image/jpeg;base64,QUFB';
const IMG_B = 'data:image/jpeg;base64,QkJC';
const IMG_C = 'data:image/jpeg;base64,Q0ND';

function seedLibrary() {
  return {
    labels: [],
    artistStrings: [],
    artists: [{
      id: 'a1', name: '冰室', tag: 'himuro_yukichiko', categories: [], rating: 4, notes: '', createdAt: 1,
      entries: [
        // 手动传的一张参考图，当时打了 5 星
        { id: 'e-manual', originalImg: IMG_A, naiImg: null, prompt: 'masterpiece, 1girl', score: 5, comment: '第一次上传', createdAt: 100 },
        // 自动抓的原图，后来用「🤖NAI图」补了生成图 —— 一直卡在「未评分」
        { id: 'e-grab', originalImg: IMG_B, naiImg: IMG_C, sourcePostId: 5247323, sourcePostUrl: 'https://danbooru.donmai.us/posts/5247323', sourceImageUrl: 'https://cdn.donmai.us/x.jpg', prompt: '', score: 0, comment: 'D站作品 #5247323（赞 84）', createdAt: 200 },
        // 自动抓取时原图没下下来，只留了作品信息
        { id: 'e-meta', originalImg: null, naiImg: null, sourcePostId: 42, prompt: '', score: 0, comment: 'D站作品 #42 · 图片暂时无法访问', createdAt: 300 },
      ],
    }],
  };
}

function freshBox() {
  const box = createArtistSandbox();
  box.setData(seedLibrary(), 'a1');
  return box;
}

const entryOf = (box, id) => box.get('data').artists[0].entries.find((entry) => entry.id === id);
const savedEntry = (box, id) => box.saved().artists[0].entries.find((entry) => entry.id === id);

// 一排假的可点星级：和 starRatingHtml 渲染出来的结构一样（.rating-field > .star-rating > .star × 5 + 文字）。
// 每颗星 20px 宽、星距 4px：第 n 颗星占 x ∈ [100 + 24(n-1), 120 + 24(n-1)]，左右留白各 6px。
function makeStarWidget(box, { action, id = '', kind = 'artist', value = 0 }) {
  const label = fakeElement();
  const field = fakeElement({ querySelector: (selector) => (selector === '[data-rating-text]' ? label : null) });
  const stars = [];
  const widget = fakeElement({
    dataset: { action, id, kind, value: String(value) },
    querySelectorAll: (selector) => (selector === '.star' ? stars : []),
    closest: (selector) => {
      if (selector === '.rating-field') return field;
      if (selector === '.star-rating' || selector === '[data-action]') return widget;
      return null;
    },
    contains: (node) => node === widget || stars.includes(node),
  });
  for (let n = 1; n <= 5; n += 1) {
    const left = 100 + (n - 1) * 24;
    const star = fakeElement({
      dataset: { star: String(n) },
      getBoundingClientRect: () => ({ left, right: left + 20, width: 20, top: 0, bottom: 20, height: 20 }),
    });
    star.closest = (selector) => (selector === '.star' ? star : widget.closest(selector));
    stars.push(star);
  }
  box.get('paintStarRating')(widget, value);
  return { widget, stars, label };
}

const pointer = (stars, n, half, extra = {}) => ({
  target: stars[n - 1],
  clientX: 100 + (n - 1) * 24 + (half === 'left' ? 4 : 16),
  detail: 1,
  ...extra,
});
const clickStar = (box, stars, n, half, extra) => box.dispatch('click', pointer(stars, n, half, extra));
const pressKey = (box, widget, key) => box.dispatch('keydown', { key, target: widget, preventDefault() {} });
const starShape = (stars) => stars.map((star) => (star.classList.contains('is-full') ? 'full' : star.classList.contains('is-half') ? 'half' : 'empty'));

// ═══════════════════════ 1. 半星分值 ═══════════════════════

group('半星分值');

const box = createArtistSandbox();

test('分值只认 0–5 的半星，其余就近归位', () => {
  const normalizeRating = box.get('normalizeRating');
  const cases = [
    [0, 0], [null, 0], [undefined, 0], ['abc', 0], [-2, 0], [0.2, 0],
    [0.3, 0.5], [1, 1], ['3', 3], [4.5, 4.5], [4.4, 4.5], [4.2, 4], [3.75, 4], [7, 5],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeRating(input), expected, `normalizeRating(${input})`);
});

test('相似度文字按 10 分制写（半颗星 1 分），半星的词写成相邻两档之间', () => {
  const scoreLabel = box.get('scoreLabel');
  assert.equal(scoreLabel(0), '未评分');
  assert.equal(scoreLabel(0.5), '1/10 · 完全不像');
  assert.equal(scoreLabel(1), '2/10 · 不像');
  assert.equal(scoreLabel(3), '6/10 · 一般');
  assert.equal(scoreLabel('2.5'), '5/10 · 不太像～一般');
  assert.equal(scoreLabel(4.5), '9/10 · 挺像～非常像');
  assert.equal(scoreLabel(5), '10/10 · 非常像');
  assert.equal(box.get('artistRatingLabel')(4.5), '9/10');
  assert.equal(box.get('artistRatingLabel')(0), '未评分');
});

test('相似度配色档：4 星起绿、3 星起黄、再低红', () => {
  const scoreTone = box.get('scoreTone');
  deepEqual([0, 0.5, 2.5, 3, 3.5, 4, 4.5, 5].map(scoreTone), ['none', 'low', 'low', 'mid', 'mid', 'high', 'high', 'high']);
});

test('3.5 星画成三颗整星加半颗', () => {
  const html = box.get('starIconsHtml')(3.5);
  const shape = [...html.matchAll(/class="star( is-(full|half))?"/g)].map((match) => match[2] || 'empty');
  deepEqual(shape, ['full', 'full', 'full', 'half', 'empty']);
});

// ═══════════════════════ 2. 星级筛选 ═══════════════════════

group('星级筛选：每一档都把半星收进来');

test('「4」档 = 4～4.5 星，「1」档 = 0.5～1.5 星，「0」只要未评分', () => {
  const matches = box.get('ratingMatchesFilter');
  const pick = (filter) => [0, 0.5, 1, 1.5, 2, 3.5, 4, 4.5, 5].filter((value) => matches(value, filter));
  deepEqual(pick('5'), [5]);
  deepEqual(pick('4'), [4, 4.5]);
  deepEqual(pick('3'), [3.5]);
  deepEqual(pick('1'), [0.5, 1, 1.5]);
  deepEqual(pick('0'), [0]);
  deepEqual(pick('4+'), [4, 4.5, 5]);
  deepEqual(pick(''), [0, 0.5, 1, 1.5, 2, 3.5, 4, 4.5, 5]);
});

test('侧栏筛选走同一套口径，结果仍按星级从高到低排', () => {
  const local = createArtistSandbox();
  local.setData({
    labels: [],
    artistStrings: [],
    artists: [5, 4.5, 4, 3.5, 0].map((rating, index) => ({ id: `r${index}`, name: `画师${rating}`, tag: `tag_${index}`, rating, entries: [] })),
  });
  local.document.getElementById('ratingFilter').value = '4';
  deepEqual(local.get('filteredArtists')().map((artist) => artist.rating), [4.5, 4]);
});

// ═══════════════════════ 3. 对比记录重新编辑（issue #4） ═══════════════════════

group('对比记录：存完还能重新打开编辑');

test('「✏️编辑」把这条记录原样填回弹窗', () => {
  const local = freshBox();
  const doc = local.document;
  local.dispatch('click', { target: fakeElement({ closest: () => fakeElement({ dataset: { action: 'editEntry', id: 'e-manual' } }) }) });

  assert.equal(doc.getElementById('entryModal').classList.contains('show'), true, '弹窗没打开');
  assert.equal(doc.getElementById('entryModalTitle').textContent, '编辑对比记录');
  assert.equal(doc.getElementById('entrySaveButton').textContent, '保存修改');
  assert.equal(doc.getElementById('fPrompt').value, 'masterpiece, 1girl');
  assert.equal(doc.getElementById('fComment').value, '第一次上传');
  assert.ok(doc.getElementById('prevOriginal').innerHTML.includes(IMG_A), '原图预览没填回来');
  assert.equal(doc.getElementById('prevNai').innerHTML, '');
  assert.equal(local.get('entryDraftScore'), 5);
  assert.ok(doc.getElementById('fScoreField').innerHTML.includes('data-value="5"'), '弹窗里的星级不是原来的 5 星');
});

test('改完保存：还是那一条，评分 / prompt / 备注 / 图都换成新的', () => {
  const local = freshBox();
  local.get('openEntryModal')('e-manual');
  const { widget, stars } = makeStarWidget(local, { action: 'rateEntryDraft', kind: 'entry', value: 5 });
  clickStar(local, stars, 5, 'left');
  assert.equal(local.get('entryDraftScore'), 4.5);
  assert.equal(entryOf(local, 'e-manual').score, 5, '弹窗里点星只改草稿，没保存前不该动记录');

  local.document.getElementById('fPrompt').value = '  masterpiece, 1girl, watercolor  ';
  local.document.getElementById('fComment').value = '线条差一点';
  local.exec(`tempImgs.nai = ${JSON.stringify(IMG_C)}`);
  local.get('saveEntry')();

  const entries = local.get('data').artists[0].entries;
  assert.equal(entries.length, 3, '编辑不该新增记录');
  const saved = savedEntry(local, 'e-manual');
  assert.equal(saved.score, 4.5);
  assert.equal(saved.prompt, 'masterpiece, 1girl, watercolor');
  assert.equal(saved.comment, '线条差一点');
  assert.equal(saved.originalImg, IMG_A);
  assert.equal(saved.naiImg, IMG_C);
  assert.equal(saved.createdAt, 100, '创建时间被改掉了');
  assert.ok(saved.updatedAt >= saved.createdAt);
  assert.equal(local.document.getElementById('entryModal').classList.contains('show'), false, '保存后弹窗没关');
  assert.equal(widget.dataset.value, '4.5');
});

test('自动抓的记录编辑后，D 站原帖信息原样保留', () => {
  const local = freshBox();
  local.get('openEntryModal')('e-grab');
  local.exec('entryDraftScore = 4');
  local.get('saveEntry')();
  const saved = savedEntry(local, 'e-grab');
  assert.equal(saved.score, 4);
  assert.equal(saved.sourcePostId, 5247323);
  assert.equal(saved.sourcePostUrl, 'https://danbooru.donmai.us/posts/5247323');
  assert.equal(saved.sourceImageUrl, 'https://cdn.donmai.us/x.jpg');
  assert.equal(saved.comment, 'D站作品 #5247323（赞 84）');
});

test('原图没下下来、只有作品信息的记录，也能不传图就改评分', () => {
  const local = freshBox();
  local.get('openEntryModal')('e-meta');
  local.exec('entryDraftScore = 2.5');
  local.get('saveEntry')();
  deepEqual(local.alerts, []);
  assert.equal(savedEntry(local, 'e-meta').score, 2.5);
});

test('新建仍然至少要一张图', () => {
  const local = freshBox();
  local.get('openEntryModal')();
  local.get('saveEntry')();
  deepEqual(local.alerts, ['至少上传一张图片吧']);
  assert.equal(local.get('data').artists[0].entries.length, 3);
});

test('编辑过一条再点「＋ 手动添加」，弹窗是空的、默认 3 星', () => {
  const local = freshBox();
  local.get('openEntryModal')('e-manual');
  local.get('openEntryModal')();
  const doc = local.document;
  assert.equal(doc.getElementById('entryModalTitle').textContent, '添加对比记录');
  assert.equal(doc.getElementById('entrySaveButton').textContent, '保存记录');
  assert.equal(doc.getElementById('fPrompt').value, '');
  assert.equal(doc.getElementById('fComment').value, '');
  assert.equal(doc.getElementById('prevOriginal').innerHTML, '');
  assert.equal(local.get('entryDraftScore'), 3);

  local.exec(`tempImgs.original = ${JSON.stringify(IMG_B)}`);
  local.get('saveEntry')();
  const entries = local.get('data').artists[0].entries;
  assert.equal(entries.length, 4);
  assert.equal(entries[3].score, 3);
  assert.equal(entries[3].originalImg, IMG_B);
  assert.equal(entryOf(local, 'e-manual').score, 5, '新建把上一次编辑的那条也改了');
});

// ═══════════════════════ 4. 点星星 / 方向键（走 09 里真的分发） ═══════════════════════

group('星级交互：点左半颗是半星');

test('卡片上直接给「未评分」的自动抓取记录打 3.5 星，马上存下', () => {
  const local = freshBox();
  const { widget, stars, label } = makeStarWidget(local, { action: 'rateEntry', id: 'e-grab', kind: 'entry', value: 0 });
  clickStar(local, stars, 4, 'left');

  assert.equal(savedEntry(local, 'e-grab').score, 3.5);
  assert.equal(widget.dataset.value, '3.5');
  assert.equal(widget.getAttribute('aria-valuenow'), '7', '读屏的数值也按 10 分制报');
  deepEqual(starShape(stars), ['full', 'full', 'full', 'half', 'empty']);
  assert.equal(label.textContent, '7/10 · 一般～挺像');
  assert.equal(label.className, 'score-badge score-mid');
});

test('点右半颗是整星；再点一次当前分数就清除', () => {
  const local = freshBox();
  const { widget, stars, label } = makeStarWidget(local, { action: 'rateEntry', id: 'e-grab', kind: 'entry', value: 0 });
  clickStar(local, stars, 5, 'right');
  assert.equal(savedEntry(local, 'e-grab').score, 5);
  clickStar(local, stars, 5, 'right');
  assert.equal(savedEntry(local, 'e-grab').score, 0);
  assert.equal(widget.dataset.value, '0');
  assert.equal(label.textContent, '未评分');
  assert.equal(label.className, 'score-badge score-none');
});

test('整排没有死区：星间的缝从中线分给两边，外圈留白归最近的星', () => {
  const local = freshBox();
  const { widget } = makeStarWidget(local, { action: 'rateEntryDraft', kind: 'entry', value: 0 });
  // 指针落在缝或留白上时，事件目标是整排控件本身，不是哪颗星
  const at = (clientX) => {
    widget.dataset.value = '0';
    local.dispatch('click', { target: widget, clientX, detail: 1 });
    return local.get('entryDraftScore');
  };
  // 第 2 颗星 [124, 144]、第 3 颗星 [148, 168]，缝是 144–148，中线 146
  assert.equal(at(145), 2, '缝的左边一半归第 2 颗星的右半');
  assert.equal(at(147), 2.5, '缝的右边一半归第 3 颗星的左半');
  assert.equal(at(95), 0.5, '最左边的留白 = 半颗星');
  assert.equal(at(222), 5, '最右边的留白 = 5 星');
  for (let x = 94; x <= 226; x += 1) assert.notEqual(at(x), 0, `x=${x} 点了没反应`);
});

test('双击的第二下不算，刚打的分不会被当成「再点一次」清掉', () => {
  const local = freshBox();
  const { stars } = makeStarWidget(local, { action: 'rateEntry', id: 'e-grab', kind: 'entry', value: 0 });
  clickStar(local, stars, 4, 'right');
  clickStar(local, stars, 4, 'right', { detail: 2 });
  assert.equal(savedEntry(local, 'e-grab').score, 4);
});

test('画师总评支持半星，侧栏列表跟着刷新', () => {
  const local = freshBox();
  const { stars, label } = makeStarWidget(local, { action: 'setRating', value: 4 });
  clickStar(local, stars, 5, 'left');
  assert.equal(local.saved().artists[0].rating, 4.5);
  assert.equal(label.textContent, '9/10');
  assert.ok(local.document.getElementById('artistList').innerHTML.includes('aria-label="9/10"'), '侧栏没刷新成 9/10');
});

test('悬停只是预览：离开后恢复成已保存的分数', () => {
  const local = freshBox();
  const { widget, stars, label } = makeStarWidget(local, { action: 'rateEntry', id: 'e-manual', kind: 'entry', value: 5 });
  local.dispatch('pointermove', pointer(stars, 2, 'left'));
  deepEqual(starShape(stars), ['full', 'half', 'empty', 'empty', 'empty']);
  assert.equal(label.textContent, '3/10 · 不像～不太像');
  assert.equal(widget.dataset.value, '5', '预览改掉了已保存的分数');

  local.dispatch('pointerout', { target: stars[1], relatedTarget: fakeElement() });
  deepEqual(starShape(stars), ['full', 'full', 'full', 'full', 'full']);
  assert.equal(label.textContent, '10/10 · 非常像');
  assert.equal(entryOf(local, 'e-manual').score, 5);
  assert.equal(local.saved(), null, '悬停不该落盘');
});

test('方向键每次半星，Delete 清除，数字键直接打分', () => {
  const local = freshBox();
  const { widget } = makeStarWidget(local, { action: 'setRating', value: 4 });
  const rating = () => local.get('data').artists[0].rating;
  pressKey(local, widget, 'ArrowRight');
  assert.equal(rating(), 4.5);
  pressKey(local, widget, 'ArrowRight');
  pressKey(local, widget, 'ArrowRight');
  assert.equal(rating(), 5, '不能超过 5 星');
  pressKey(local, widget, '2');
  assert.equal(rating(), 2);
  pressKey(local, widget, 'ArrowLeft');
  assert.equal(rating(), 1.5);
  pressKey(local, widget, 'Delete');
  assert.equal(rating(), 0);
  pressKey(local, widget, 'ArrowLeft');
  assert.equal(rating(), 0, '不能低于 0');
});

// ═══════════════════════ 5. 别处的星级显示 ═══════════════════════

group('列表和手机版也认半星');

test('详情页渲染出可点的星级，卡片上有「✏️编辑」', () => {
  const local = freshBox();
  local.get('renderArtist')();
  const html = local.document.getElementById('artistView').innerHTML;
  assert.match(html, /data-action="setRating"[^>]*data-value="4"/);
  assert.match(html, /data-action="rateEntry"[^>]*data-id="e-grab"[^>]*data-value="0"/);
  assert.equal((html.match(/data-action="editEntry"/g) || []).length, 3);
  assert.ok(!html.includes('editPrompt'), '旧的单行 prompt 编辑入口还在');
});

function runMobileExport(library) {
  const sandbox = createArtistSandbox();
  const html = sandbox.get('buildMobileViewerHtml')(library);
  const json = html.match(/<script id="nai-mobile-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const start = html.indexOf('<script>(');
  const app = html.slice(start + '<script>'.length, html.indexOf('</script>', start));

  // 全新的 context，只给一个假 document —— 和用户手机上一样，画师库页的函数一个都没有
  const dom = createFakeDom();
  dom.document.getElementById('nai-mobile-data').textContent = json;
  vm.runInContext(app, vm.createContext({ document: dom.document, navigator: {}, setTimeout: () => 0, console, JSON, Math, Number, String, Array, Object, Set, Date }));
  return dom;
}

test('手机版：半星画成半颗，筛选每一档含半星，相似度写成 x/10', () => {
  const dom = runMobileExport({
    labels: [],
    artistStrings: [],
    artists: [5, 4.5, 4, 3.5].map((rating, index) => ({
      id: `m${index}`, name: `画师${index}`, tag: `tag_${index}`, rating, categories: [],
      entries: index === 1 ? [{ id: 'mx', originalImg: null, naiImg: null, score: 3.5 }] : [],
    })),
  });
  const doc = dom.document;
  dom.dispatch('click', { target: fakeElement({ closest: () => fakeElement({ dataset: { action: 'open-artist', id: 'm1' } }) }) });
  assert.ok(doc.getElementById('mobileDetail').innerHTML.includes('相似度 7/10'), '手机版详情里的相似度没按 10 分制写');

  const list = doc.getElementById('mobileList');
  const card = list.innerHTML.split('data-action="open-artist"').find((chunk) => chunk.includes('data-id="m1"'));
  const shape = [...card.matchAll(/class="star( is-(full|half))?"/g)].map((match) => match[2] || 'empty');
  deepEqual(shape, ['full', 'full', 'full', 'full', 'half']);

  const rating = doc.getElementById('mobileRating');
  rating.value = '4';
  rating.fire('change');
  const shown = [...list.innerHTML.matchAll(/data-id="(m\d)"/g)].map((match) => match[1]);
  deepEqual(shown, ['m1', 'm2']);
});

await run('画师库测试');
