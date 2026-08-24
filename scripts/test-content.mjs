// 输入框覆盖层的偏移测试。要守的就一条：
//
//   给定编辑器 DOM，getEditorText() 切出来的每个 tag，
//   createRangeFromEditorTextOffsets 圈出来的必须是同一段文字。
//
// 这层以前歪得很离谱，两个原因叠在一起（都是累加误差，行数越多越离谱）：
//   1. 位置靠 tag.length + delimiter.length 推算，被 trim 掉的空格和被丢掉的空 token 都不算数
//   2. getEditorText 会给 <br>/块级元素补 \n，而取 Range 的那个函数只走文本节点，两套坐标
//
//   node scripts/test-content.mjs

import assert from 'node:assert/strict';
import { group, test, deepEqual, run } from './lib/tiny-test.mjs';
import { createContentSandbox, readRangeText } from './lib/content-sandbox.mjs';

const box = createContentSandbox();
const { el, text } = box;

const parsePromptTokens = box.get('parsePromptTokens');
const getEditorText = box.get('getEditorText');
const getTextOffsetForTokenIndex = box.get('getTextOffsetForTokenIndex');
const getTextEndOffsetForTokenIndex = box.get('getTextEndOffsetForTokenIndex');
const buildEditorTextMap = box.get('buildEditorTextMap');
const createRangeFromEditorTextOffsets = box.get('createRangeFromEditorTextOffsets');

// ProseMirror 一行一个 <p>，空行就是空的 <p>
function proseMirror(lines) {
  return el(
    'DIV',
    lines.map((line) => el('P', line === '' ? [] : [text(line)])),
    { classes: ['ProseMirror'] },
  );
}

function tagsOf(source) {
  return parsePromptTokens(source).map((token) => token.tag);
}

// 每个 token 都过一遍：原文切出来对不对、DOM 里圈出来对不对
function assertTokenRanges(editor, label) {
  const source = getEditorText(editor);
  const tokens = parsePromptTokens(source);
  assert.ok(tokens.length, `${label}：一个 token 都没解析出来`);

  tokens.forEach((token, index) => {
    assert.equal(
      source.slice(token.start, token.end),
      token.tag,
      `${label}：第 ${index} 个 token 在原文里的位置不对`,
    );

    const range = createRangeFromEditorTextOffsets(
      editor,
      getTextOffsetForTokenIndex(tokens, index),
      getTextEndOffsetForTokenIndex(tokens, index),
    );
    assert.equal(
      readRangeText(editor, range),
      token.tag,
      `${label}：第 ${index} 个 token 圈到 DOM 上就歪了`,
    );
  });

  return tokens;
}

// ═══════════════════════════ 1. token 在原文里的位置 ═══════════════════════════

group('token 位置');

test('普通一行', () => {
  const tokens = parsePromptTokens('1girl, solo');
  deepEqual(
    tokens.map((token) => [token.tag, token.start, token.end]),
    [['1girl', 0, 5], ['solo', 7, 11]],
  );
});

test('tag 尾部的空格被 trim 掉也不影响位置', () => {
  const source = '1girl , solo';
  const tokens = parsePromptTokens(source);
  deepEqual(tokens.map((token) => token.tag), ['1girl', 'solo']);
  tokens.forEach((token) => {
    assert.equal(source.slice(token.start, token.end), token.tag);
  });
});

test('空 token 被丢掉，后面的位置照样对', () => {
  const source = 'a,,b';
  const tokens = parsePromptTokens(source);
  deepEqual(tokens.map((token) => token.tag), ['a', 'b']);
  assert.equal(source.slice(tokens[1].start, tokens[1].end), 'b');
});

test('空行（连续换行）不吃掉后面的偏移', () => {
  const source = '1girl,\n\n<artist>\nteshima nari,';
  const tokens = parsePromptTokens(source);
  deepEqual(tokens.map((token) => token.tag), ['1girl', '<artist>', 'teshima nari']);
  tokens.forEach((token) => {
    assert.equal(source.slice(token.start, token.end), token.tag);
  });
});

test('权重组里的 :: 不被当成分隔符切开', () => {
  const source = '0.7::teshima nari::, umehara sei';
  const tokens = parsePromptTokens(source);
  deepEqual(tokens.map((token) => token.tag), ['0.7::teshima nari::', 'umehara sei']);
  tokens.forEach((token) => {
    assert.equal(source.slice(token.start, token.end), token.tag);
  });
});

test('tokenEnd 连分隔符一起算，末尾插入点才落得对', () => {
  const tokens = parsePromptTokens('1girl, solo, ');
  assert.equal(getTextOffsetForTokenIndex(tokens, tokens.length), 13);
});

test('空文本不炸', () => {
  deepEqual(parsePromptTokens(''), []);
  assert.equal(getTextOffsetForTokenIndex([], 0), 0);
  assert.equal(getTextOffsetForTokenIndex([], 3), 0);
  assert.equal(getTextEndOffsetForTokenIndex([], 0), 0);
});

// ═══════════════════════════ 2. 逻辑文本与 DOM 的映射 ═══════════════════════════

group('DOM 映射');

test('映射出来的文本和 getEditorText 一模一样', () => {
  const editor = proseMirror(['1girl, solo,', '', '<artist>', 'teshima nari,']);
  assert.equal(buildEditorTextMap(editor).text.trim(), getEditorText(editor));
});

test('<br> 换行也算一个字符', () => {
  const editor = el('DIV', [text('1girl,'), el('BR'), text('solo')], { classes: ['ProseMirror'] });
  assert.equal(getEditorText(editor), '1girl,\nsolo');
  assertTokenRanges(editor, '<br> 换行');
});

test('宏节点按展开文本占位，端点贴到元素两侧', () => {
  const macro = el('SPAN', [text('#风格')], {
    classes: ['macro-node'],
    dataset: { macroExpansion: 'film grain, soft light' },
  });
  const editor = el('DIV', [text('1girl, '), macro, text(', solo')], { classes: ['ProseMirror'] });
  assert.equal(getEditorText(editor), '1girl, film grain, soft light, solo');
  // 宏展开的两段不在 DOM 里，圈不出真实文本，但它前后的 tag 必须还是对的
  const tokens = parsePromptTokens(getEditorText(editor));
  deepEqual(tokens.map((token) => token.tag), ['1girl', 'film grain', 'soft light', 'solo']);
  const last = tokens[tokens.length - 1];
  const range = createRangeFromEditorTextOffsets(editor, last.start, last.end);
  assert.equal(readRangeText(editor, range), 'solo');
});

test('零宽空格不算进逻辑偏移', () => {
  const editor = el('DIV', [text('1girl,​ solo')], { classes: ['ProseMirror'] });
  assert.equal(getEditorText(editor), '1girl, solo');
  assertTokenRanges(editor, '零宽空格');
});

test('首尾空白被 trim 掉后偏移整体对齐', () => {
  const editor = el('DIV', [text('  1girl, solo  ')], { classes: ['ProseMirror'] });
  assert.equal(getEditorText(editor), '1girl, solo');
  assertTokenRanges(editor, '首尾空白');
});

// 下面两条专门盯 getTextOffsetForTokenIndex：它以前是拿 tag.length + delimiter.length
// 一路累加的，被 trim 掉的空格和开头那个空 token 都不进账，从此整行往左错
test('逗号前面有空格，后面的 tag 不会整体左移', () => {
  const editor = el('DIV', [text('1girl , solo , cat ears')], { classes: ['ProseMirror'] });
  assertTokenRanges(editor, '逗号前空格');
});

test('开头就是逗号，第一个 tag 也不会被算到 0', () => {
  const editor = el('DIV', [text(', 1girl, solo')], { classes: ['ProseMirror'] });
  assertTokenRanges(editor, '开头逗号');
});

test('tag 跨多个文本节点时端点分别落在两个节点上', () => {
  const editor = el('DIV', [text('1girl, tesh'), text('ima nari, solo')], { classes: ['ProseMirror'] });
  assertTokenRanges(editor, '跨文本节点');
});

// ═══════════════════════════ 3. 截图里那份提示词 ═══════════════════════════

group('回归：多行提示词');

// 用户截图里那份，覆盖层原来从第二行起就一路歪下去
const SCREENSHOT_LINES = [
  '1girl,  solo,',
  '',
  '<artist>',
  '0.7::teshima nari::, umehara sei,',
  '0.25::na_tarapisu153, ::,',
  '</artist>',
  '',
  '2::::,',
  '1::::, film grain, soft light, pastel colors,',
];

test('每个 tag 圈到 DOM 上都不偏', () => {
  const editor = proseMirror(SCREENSHOT_LINES);
  assertTokenRanges(editor, '截图提示词');
});

test('切出来的 tag 就是肉眼数的那些', () => {
  const editor = proseMirror(SCREENSHOT_LINES);
  deepEqual(tagsOf(getEditorText(editor)), [
    '1girl',
    'solo',
    '<artist>',
    '0.7::teshima nari::',
    'umehara sei',
    '0.25::na_tarapisu153',
    '::',
    '</artist>',
    '2::::',
    '1::::',
    'film grain',
    'soft light',
    'pastel colors',
  ]);
});

test('最后一行的 tag 没有被前面的换行推歪', () => {
  const editor = proseMirror(SCREENSHOT_LINES);
  const source = getEditorText(editor);
  const tokens = parsePromptTokens(source);
  const pastel = tokens[tokens.length - 1];
  assert.equal(pastel.tag, 'pastel colors');
  const range = createRangeFromEditorTextOffsets(editor, pastel.start, pastel.end);
  assert.equal(readRangeText(editor, range), 'pastel colors');
});

// ═══════════════════════════ 4. textarea（ComfyUI） ═══════════════════════════

group('textarea');

test('textarea 走 value 坐标，同样要对齐 trim', () => {
  const editor = { tagName: 'TEXTAREA', value: '  1girl,\n\nsolo, film grain  ' };
  const source = getEditorText(editor);
  assert.equal(source, '1girl,\n\nsolo, film grain');

  const tokens = parsePromptTokens(source);
  deepEqual(tokens.map((token) => token.tag), ['1girl', 'solo', 'film grain']);

  tokens.forEach((token, index) => {
    const range = createRangeFromEditorTextOffsets(
      editor,
      getTextOffsetForTokenIndex(tokens, index),
      getTextEndOffsetForTokenIndex(tokens, index),
    );
    assert.equal(editor.value.slice(range.start, range.end), token.tag, `第 ${index} 个 token 偏了`);
  });
});

// ═══════════════════════════ 5. 词库别名 ═══════════════════════════
//
// 写词时「描述里提到名字 = 点名这个角色」靠的就是这串别名。
// content 和 assistant 各有一份 normalize，content 这份一旦不认别名，
// 用户在覆盖层里存一次词条，别名就静悄悄没了。

group('词库别名');

const normalizePromptLibraryEntry = box.get('normalizePromptLibraryEntry');

function entry(overrides) {
  return normalizePromptLibraryEntry({ alias: 'char:natsuki', tags: ['blonde hair', 'red eyes'], ...overrides });
}

test('数组原样收下', () => {
  deepEqual(entry({ aliases: ['小夏', 'Natsuki'] }).aliases, ['小夏', 'Natsuki']);
});

test('一行字也认，逗号顿号分号换行都能分', () => {
  deepEqual(entry({ aliases: '小夏, Natsuki；夏夏、なつき\nNatsu' }).aliases,
    ['小夏', 'Natsuki', '夏夏', 'なつき', 'Natsu']);
});

test('去空、去重（不分大小写）、掐掉两端空白', () => {
  deepEqual(entry({ aliases: '  小夏 , ,natsuki, NATSUKI ,小夏' }).aliases, ['小夏', 'natsuki']);
});

test('最多 8 条，一条最长 40 字', () => {
  const many = entry({ aliases: Array.from({ length: 20 }, (_, i) => `n${i}`) });
  assert.equal(many.aliases.length, 8);
  assert.equal(entry({ aliases: ['x'.repeat(80)] }).aliases[0].length, 40);
});

test('没写就是空数组，不是 undefined', () => {
  deepEqual(entry({}).aliases, []);
});

test('回归：再归一化一遍不会把别名弄丢', () => {
  const once = entry({ aliases: ['小夏', 'Natsuki'] });
  const twice = normalizePromptLibraryEntry(once);
  deepEqual(twice.aliases, ['小夏', 'Natsuki']);
});

await run('输入框覆盖层偏移测试');
