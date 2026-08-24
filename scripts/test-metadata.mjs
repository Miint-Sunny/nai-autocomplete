// NAI 原图元数据测试：PNG 文本块 + alpha 隐写。
//
// 读到元数据就不用调模型，所以这条链路错了不会报错，只会静默地退回去烧 token。
// 两个最容易写错的地方在这里各有一组：
//   · 隐写位是列优先排的（x 走完整列的 y 再换列），ImageData 是行优先
//   · 32 位长度不能用 << 拼，第 32 位一移就变成负数
//
//   node scripts/test-metadata.mjs

import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { group, test, deepEqual, run } from './lib/tiny-test.mjs';
import { createBackgroundSandbox } from './lib/background-sandbox.mjs';

const box = createBackgroundSandbox();
const parseNaiPngTextChunks = box.get('parseNaiPngTextChunks');
const readNaiStealthPayload = box.get('readNaiStealthPayload');
const normalizeNaiMetadata = box.get('normalizeNaiMetadata');
const createNaiLsbReader = box.get('createNaiLsbReader');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ═══════════════════════ 造测试数据的小工具 ═══════════════════════

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const payload = Uint8Array.from([...typeBytes, ...body]);
  const out = [];
  out.push((body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255);
  out.push(...payload);
  const sum = crc32(payload);
  out.push((sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255);
  return out;
}

function textChunk(keyword, text) {
  return chunk('tEXt', [...[...keyword].map((c) => c.charCodeAt(0)), 0, ...Buffer.from(text, 'utf8')]);
}

function zTextChunk(keyword, text) {
  const deflated = zlib.deflateSync(Buffer.from(text, 'utf8'));
  return chunk('zTXt', [...[...keyword].map((c) => c.charCodeAt(0)), 0, 0, ...deflated]);
}

function iTextChunk(keyword, text, { compressed = false } = {}) {
  const body = compressed ? zlib.deflateSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8');
  return chunk('iTXt', [
    ...[...keyword].map((c) => c.charCodeAt(0)), 0,
    compressed ? 1 : 0, 0,
    0, // 空 language tag
    0, // 空 translated keyword
    ...body,
  ]);
}

function buildPng(chunks) {
  return Uint8Array.from([...PNG_SIGNATURE, ...chunks.flat(), ...chunk('IEND', [])]);
}

// 把签名 + 32 位长度 + payload 写进 alpha（或 RGB）最低位，列优先
function embedStealth({ width, height, signature, text, mode = 'alpha', gzip = false }) {
  const payload = gzip ? zlib.gzipSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8');
  const bits = [];
  const pushBytes = (bytes) => {
    for (const byte of bytes) for (let b = 7; b >= 0; b -= 1) bits.push((byte >> b) & 1);
  };
  pushBytes([...signature].map((c) => c.charCodeAt(0)));
  const lengthBits = payload.length * 8;
  for (let b = 31; b >= 0; b -= 1) bits.push((lengthBits >>> b) & 1);
  pushBytes(payload);

  const perPixel = mode === 'rgb' ? 3 : 1;
  const data = new Uint8Array(width * height * 4).fill(255);
  assert.ok(bits.length <= width * height * perPixel, '测试图放不下这段 payload');

  bits.forEach((bit, index) => {
    const pixel = Math.floor(index / perPixel);
    const channel = mode === 'rgb' ? index % perPixel : 3;
    const x = Math.floor(pixel / height);
    const y = pixel % height;
    const offset = (y * width + x) * 4 + channel;
    data[offset] = (data[offset] & 0xfe) | bit;
  });

  return { data, width, height };
}

const NAI_COMMENT = JSON.stringify({
  prompt: 'ignored',
  steps: 28,
  scale: 5,
  seed: 1234567890,
  sampler: 'k_euler_ancestral',
  noise_schedule: 'karras',
  width: 832,
  height: 1216,
  v5_prompt: {
    caption: {
      base_caption: '1girl, solo, cat ears, 1.2::soft lighting::',
      char_captions: [
        { char_caption: 'blue eyes, long hair, white dress', name: 'Character 1' },
        { char_caption: 'red eyes, twintails', name: 'Character 2' },
      ],
    },
  },
  v5_negative_prompt: { caption: { base_caption: 'lowres, bad anatomy' } },
});

// ═══════════════════════ 1. PNG 文本块 ═══════════════════════

group('PNG 文本块');

test('tEXt 里的 Description 和 Comment 都能读出来', async () => {
  const png = buildPng([
    textChunk('Title', 'AI generated image'),
    textChunk('Description', '1girl, solo'),
    textChunk('Software', 'NovelAI'),
    textChunk('Comment', NAI_COMMENT),
  ]);
  const values = await parseNaiPngTextChunks(png);
  assert.equal(values.Description, '1girl, solo');
  assert.equal(values.Software, 'NovelAI');
  assert.ok(values.Comment.includes('v5_prompt'));
});

test('zTXt（deflate）也能解', async () => {
  const values = await parseNaiPngTextChunks(buildPng([zTextChunk('Comment', NAI_COMMENT)]));
  assert.ok(values.Comment.includes('base_caption'));
});

test('iTXt 压缩和不压缩两种都能解', async () => {
  const plain = await parseNaiPngTextChunks(buildPng([iTextChunk('Description', '猫耳少女')]));
  assert.equal(plain.Description, '猫耳少女');
  const packed = await parseNaiPngTextChunks(buildPng([iTextChunk('Comment', NAI_COMMENT, { compressed: true })]));
  assert.ok(packed.Comment.includes('char_captions'));
});

test('不是 PNG 就返回空，不炸', async () => {
  deepEqual(await parseNaiPngTextChunks(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])), {});
  deepEqual(await parseNaiPngTextChunks(new Uint8Array(0)), {});
});

test('单个块解不开不影响其它块', async () => {
  const broken = chunk('zTXt', [...[...'Bad'].map((c) => c.charCodeAt(0)), 0, 0, 9, 9, 9, 9]);
  const values = await parseNaiPngTextChunks(buildPng([broken, textChunk('Description', '还在')]));
  assert.equal(values.Description, '还在');
});

test('长度字段越界时停下来，不越读', async () => {
  const png = buildPng([textChunk('Description', 'ok')]);
  const truncated = png.subarray(0, png.length - 8);
  const values = await parseNaiPngTextChunks(truncated);
  assert.equal(values.Description, 'ok');
});

// ═══════════════════════ 2. alpha / RGB 隐写 ═══════════════════════

group('隐写读取');

test('stealth_pnginfo（alpha，未压缩）', async () => {
  const image = embedStealth({ width: 64, height: 64, signature: 'stealth_pnginfo', text: NAI_COMMENT });
  const payload = await readNaiStealthPayload(image.data, image.width, image.height);
  assert.equal(payload.signature, 'stealth_pnginfo');
  assert.equal(payload.mode, 'alpha');
  assert.equal(payload.compressed, false);
  assert.equal(payload.text, NAI_COMMENT);
});

test('stealth_pngcomp（alpha，gzip）—— NAI 现在用的就是这种', async () => {
  const image = embedStealth({ width: 96, height: 96, signature: 'stealth_pngcomp', text: NAI_COMMENT, gzip: true });
  const payload = await readNaiStealthPayload(image.data, image.width, image.height);
  assert.equal(payload.signature, 'stealth_pngcomp');
  assert.equal(payload.compressed, true);
  assert.equal(payload.text, NAI_COMMENT);
});

test('stealth_rgbinfo（RGB 三通道）', async () => {
  const image = embedStealth({ width: 64, height: 64, signature: 'stealth_rgbinfo', text: NAI_COMMENT, mode: 'rgb' });
  const payload = await readNaiStealthPayload(image.data, image.width, image.height);
  assert.equal(payload.signature, 'stealth_rgbinfo');
  assert.equal(payload.mode, 'rgb');
  assert.equal(payload.text, NAI_COMMENT);
});

test('stealth_rgbcomp（RGB + gzip）', async () => {
  const image = embedStealth({ width: 64, height: 64, signature: 'stealth_rgbcomp', text: NAI_COMMENT, mode: 'rgb', gzip: true });
  const payload = await readNaiStealthPayload(image.data, image.width, image.height);
  assert.equal(payload.signature, 'stealth_rgbcomp');
  assert.equal(payload.text, NAI_COMMENT);
});

// 参考实现把 alpha 和 RGB 两个缓冲一起攒、谁先到 120 位谁先判：
// RGB 每像素 3 位，第 40 个像素就到 120 位，会抢在 alpha（要 120 个像素）前面判定失败，
// 把整张 alpha 隐写图直接否掉。所以两种通道必须各试各的。
test('alpha 隐写不会被 RGB 的签名检查抢先否掉', async () => {
  const image = embedStealth({ width: 64, height: 64, signature: 'stealth_pnginfo', text: NAI_COMMENT });
  // RGB 低位全是 1（255 & 1），凑不出任何合法签名 —— 正是会误伤 alpha 的那种情况
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] |= 1; image.data[i + 1] |= 1; image.data[i + 2] |= 1;
  }
  const payload = await readNaiStealthPayload(image.data, image.width, image.height);
  assert.equal(payload?.mode, 'alpha', 'alpha 通道的隐写被 RGB 检查误杀了');
});

test('没有隐写的图返回 null', async () => {
  const data = new Uint8Array(32 * 32 * 4).fill(255);
  assert.equal(await readNaiStealthPayload(data, 32, 32), null);
});

test('位长被改坏时不会去申请天文数字的内存', async () => {
  const image = embedStealth({ width: 48, height: 48, signature: 'stealth_pnginfo', text: 'hi' });
  // 把 32 位长度整个写成 1，等于声明「payload 有 4G 位」
  for (let i = 0; i < 32; i += 1) {
    const pixel = 15 * 8 + i;
    const offset = ((pixel % 48) * 48 + Math.floor(pixel / 48)) * 4 + 3;
    image.data[offset] |= 1;
  }
  assert.equal(await readNaiStealthPayload(image.data, image.width, image.height), null);
});

test('位读取器是列优先的', () => {
  // 2×3 的图，alpha 依次设成 1,0,1 | 0,1,1（列优先即 x=0 那一列先走完）
  const width = 2;
  const height = 3;
  const data = new Uint8Array(width * height * 4).fill(255);
  const set = (x, y, bit) => {
    const offset = (y * width + x) * 4 + 3;
    data[offset] = (data[offset] & 0xfe) | bit;
  };
  set(0, 0, 1); set(0, 1, 0); set(0, 2, 1);
  set(1, 0, 0); set(1, 1, 1); set(1, 2, 1);
  const reader = createNaiLsbReader(data, width, height, 'alpha');
  deepEqual([...reader.read(6)], [1, 0, 1, 0, 1, 1]);
});

// ═══════════════════════ 3. 归一化 ═══════════════════════

group('归一化');

test('v5 的 base_caption 和 char_captions 都取到', () => {
  const meta = normalizeNaiMetadata({ Description: '被 v5 覆盖', Comment: NAI_COMMENT, Source: 'NovelAI Diffusion V5' });
  assert.equal(meta.prompt, '1girl, solo, cat ears, 1.2::soft lighting::');
  assert.equal(meta.negativePrompt, 'lowres, bad anatomy');
  deepEqual(meta.characterPrompts.map((c) => c.label), ['Character 1', 'Character 2']);
  assert.equal(meta.characterPrompts[0].prompt, 'blue eyes, long hair, white dress');
  assert.equal(meta.seed, 1234567890);
  assert.equal(meta.steps, 28);
  assert.equal(meta.width, 832);
  assert.equal(meta.model, 'NovelAI Diffusion V5');
});

test('v4 的路径也认', () => {
  const meta = normalizeNaiMetadata({
    Comment: JSON.stringify({
      v4_prompt: { caption: { base_caption: '1girl, v4', char_captions: [{ char_caption: 'blue eyes' }] } },
      v4_negative_prompt: { caption: { base_caption: 'bad hands' } },
    }),
  });
  assert.equal(meta.prompt, '1girl, v4');
  assert.equal(meta.negativePrompt, 'bad hands');
  assert.equal(meta.characterPrompts[0].label, 'Character 1');
});

test('根在 parameters 里也认', () => {
  const meta = normalizeNaiMetadata({
    Comment: JSON.stringify({ parameters: { prompt: '1girl, in parameters', seed: 42 } }),
  });
  assert.equal(meta.prompt, '1girl, in parameters');
  assert.equal(meta.seed, 42);
});

test('根在 request.parameters 里也认', () => {
  const meta = normalizeNaiMetadata({
    Comment: JSON.stringify({ request: { parameters: { prompt: '1girl, nested', steps: 23 } } }),
  });
  assert.equal(meta.prompt, '1girl, nested');
  assert.equal(meta.steps, 23);
});

test('只有 Description 的老图也能用', () => {
  const meta = normalizeNaiMetadata({ Description: '1girl, solo, old png' });
  assert.equal(meta.prompt, '1girl, solo, old png');
  deepEqual(meta.characterPrompts, []);
});

test('Comment 不是合法 JSON 时退回 Description，不抛', () => {
  const meta = normalizeNaiMetadata({ Description: '兜底', Comment: '{ 这不是 json' });
  assert.equal(meta.prompt, '兜底');
});

test('空输入返回空提示词而不是抛错', () => {
  assert.equal(normalizeNaiMetadata(null).prompt, '');
  assert.equal(normalizeNaiMetadata({}).prompt, '');
});

test('空的角色栏被过滤掉', () => {
  const meta = normalizeNaiMetadata({
    Comment: JSON.stringify({
      v5_prompt: { caption: { base_caption: '1girl', char_captions: [{ char_caption: '  ' }, { char_caption: 'blue eyes' }] } },
    }),
  });
  assert.equal(meta.characterPrompts.length, 1);
  assert.equal(meta.characterPrompts[0].prompt, 'blue eyes');
});

await run('NAI 原图元数据测试');
