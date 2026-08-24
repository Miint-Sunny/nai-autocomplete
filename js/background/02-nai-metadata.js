// NAI 原图里的提示词。读到了就不用调模型 —— 零成本、零上传、逐字准确。
//
// 两条通道，缺一不可：
//   1. PNG 文本块（tEXt / zTXt / iTXt）—— 老图和「保存原图」下载的图走这条
//   2. alpha 通道最低位隐写 —— NAI 现在默认走这条，文本块反而是空的
//
// 时机很关键：这两样都会被重编码抹掉。applyImageBudget 会把图缩到 1536 并转成 JPEG，
// 所以元数据必须在**预算之前**、拿到原始字节的那一刻读。

const NAI_PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// 四种隐写签名，都是 15 个字符。png/rgb 指藏在哪个通道，info/comp 指有没有 gzip。
const NAI_STEALTH_SIGNATURES = {
  stealth_pnginfo: { mode: 'alpha', compressed: false },
  stealth_pngcomp: { mode: 'alpha', compressed: true },
  stealth_rgbinfo: { mode: 'rgb', compressed: false },
  stealth_rgbcomp: { mode: 'rgb', compressed: true },
};
const NAI_STEALTH_SIGNATURE_BITS = 15 * 8;
const NAI_STEALTH_LENGTH_BITS = 32;
// payload 再大也不该有这个数，防止位长被改坏之后申请一块天文数字的内存
const NAI_STEALTH_MAX_BYTES = 8 * 1024 * 1024;

function naiReadUint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function naiLooksLikePng(bytes) {
  return NAI_PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function naiInflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function naiDecodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// PNG 文本块。三种格式的头不一样：
//   tEXt  keyword \0 text
//   zTXt  keyword \0 method(1) deflate(text)
//   iTXt  keyword \0 flag(1) method(1) lang \0 translated \0 text
async function parseNaiPngTextChunks(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const values = {};
  if (bytes.length < 8 || !naiLooksLikePng(bytes)) return values;

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = naiReadUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;
    if (type === 'IEND') break;

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = naiDecodeUtf8(data.subarray(0, nul));
        try {
          if (type === 'tEXt') {
            values[keyword] = naiDecodeUtf8(data.subarray(nul + 1));
          } else if (type === 'zTXt') {
            values[keyword] = naiDecodeUtf8(await naiInflate(data.subarray(nul + 2), 'deflate'));
          } else {
            const compressed = data[nul + 1] === 1;
            // lang 和 translated keyword 两段，各以 \0 结束
            let cursor = nul + 3;
            for (let skipped = 0; skipped < 2 && cursor < data.length; skipped += 1) {
              const next = data.indexOf(0, cursor);
              if (next === -1) { cursor = data.length; break; }
              cursor = next + 1;
            }
            const body = data.subarray(cursor);
            values[keyword] = naiDecodeUtf8(compressed ? await naiInflate(body, 'deflate') : body);
          }
        } catch (error) {
          // 单个块解不开不该毁掉整张图的读取
        }
      }
    }

    offset = dataEnd + 4;
  }

  return values;
}

// 隐写位是**列优先**排的：x 走完一整列的 y，再换下一列。
// ImageData 是行优先，所以这里要自己换算，别直接顺着数组读。
function createNaiLsbReader(data, width, height, mode) {
  const perPixel = mode === 'rgb' ? 3 : 1;
  const total = width * height * perPixel;
  let cursor = 0;

  return {
    read(count) {
      if (count <= 0 || cursor + count > total) return null;
      const bits = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        const bitIndex = cursor + i;
        const pixel = (bitIndex - (bitIndex % perPixel)) / perPixel;
        const channel = mode === 'rgb' ? bitIndex % perPixel : 3;
        const x = (pixel - (pixel % height)) / height;
        const y = pixel % height;
        bits[i] = data[(y * width + x) * 4 + channel] & 1;
      }
      cursor += count;
      return bits;
    },
  };
}

function naiBitsToBytes(bits) {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < out.length; i += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[i * 8 + bit];
    out[i] = value;
  }
  return out;
}

function naiBitsToUint32(bits) {
  // 不能用 <<：第 32 位一移就变成负数
  let value = 0;
  for (let i = 0; i < 32; i += 1) value = value * 2 + bits[i];
  return value;
}

// 两种通道各独立试一遍。参考实现是两个缓冲一起攒、谁先到长度谁先判，
// 那样 RGB 会在第 40 个像素抢先判定失败，把 alpha 的图整个否掉。分开试没这个坑。
//
// 顺带记一条实测：canvas 是预乘 alpha 的，alpha < 255 时 RGB 回读会被改掉 —— 实测写
// 200,100,50 / alpha=128，读回来是 199,100,50，正好差在最低位。所以 rgb 模式的隐写
// 在半透明像素上本来就不可靠；alpha 模式不受影响（alpha 分量本身是精确存储的），
// 而 NAI 用的就是 alpha 模式。
async function readNaiStealthPayload(data, width, height) {
  if (!data || !width || !height) return null;

  for (const mode of ['alpha', 'rgb']) {
    const reader = createNaiLsbReader(data, width, height, mode);
    const signatureBits = reader.read(NAI_STEALTH_SIGNATURE_BITS);
    if (!signatureBits) continue;

    const signature = naiDecodeUtf8(naiBitsToBytes(signatureBits));
    const spec = NAI_STEALTH_SIGNATURES[signature];
    if (!spec || spec.mode !== mode) continue;

    const lengthBits = reader.read(NAI_STEALTH_LENGTH_BITS);
    if (!lengthBits) continue;
    const payloadBits = naiBitsToUint32(lengthBits);
    if (!payloadBits || payloadBits % 8 !== 0 || payloadBits / 8 > NAI_STEALTH_MAX_BYTES) continue;

    const bodyBits = reader.read(payloadBits);
    if (!bodyBits) continue;

    let bytes = naiBitsToBytes(bodyBits);
    if (spec.compressed) {
      try {
        bytes = await naiInflate(bytes, 'gzip');
      } catch (error) {
        continue;
      }
    }
    return { signature, mode, compressed: spec.compressed, text: naiDecodeUtf8(bytes) };
  }

  return null;
}

// NAI 把结构化数据塞在 Comment 里（一段 JSON 字符串），Description 是纯正向提示词。
// 隐写 payload 解出来是同样一套键，所以两条通道汇到这里合流。
function naiPickCaption(source) {
  if (!source || typeof source !== 'object') return '';
  return String(source.caption?.base_caption || '').trim();
}

function normalizeNaiMetadata(values) {
  const raw = values && typeof values === 'object' ? values : {};
  let comment = {};
  if (typeof raw.Comment === 'string' && raw.Comment.trim()) {
    try { comment = JSON.parse(raw.Comment); } catch (error) { comment = {}; }
  } else if (raw.Comment && typeof raw.Comment === 'object') {
    comment = raw.Comment;
  }

  // 根可能在三个位置，取到哪个算哪个
  const root = comment.parameters && typeof comment.parameters === 'object'
    ? comment.parameters
    : comment.request?.parameters && typeof comment.request.parameters === 'object'
      ? comment.request.parameters
      : comment;

  const prompt = String(
    naiPickCaption(root.v5_prompt)
    || naiPickCaption(root.v4_prompt)
    || root.prompt
    || comment.prompt
    || raw.Description
    || '',
  ).trim();

  const negativePrompt = String(
    naiPickCaption(root.v5_negative_prompt)
    || naiPickCaption(root.v4_negative_prompt)
    || root.uc
    || root.negative_prompt
    || comment.uc
    || '',
  ).trim();

  const rawCharacters = root.v5_prompt?.caption?.char_captions
    || root.v4_prompt?.caption?.char_captions
    || root.character_prompts
    || [];

  const characterPrompts = (Array.isArray(rawCharacters) ? rawCharacters : [])
    .map((entry, index) => ({
      label: String((entry && (entry.name || entry.character_name)) || `Character ${index + 1}`),
      prompt: String(
        typeof entry === 'string' ? entry : (entry?.char_caption || entry?.caption || entry?.prompt || ''),
      ).trim(),
    }))
    .filter((entry) => entry.prompt);

  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

  return {
    prompt,
    negativePrompt,
    characterPrompts,
    seed: number(root.seed ?? comment.seed),
    steps: number(root.steps ?? comment.steps),
    scale: number(root.scale ?? comment.scale),
    width: number(root.width ?? comment.width),
    height: number(root.height ?? comment.height),
    sampler: String(root.sampler || comment.sampler || ''),
    noiseSchedule: String(root.noise_schedule || comment.noise_schedule || ''),
    model: String(raw.Source || raw.Software || comment.model || ''),
  };
}

function describeNaiMetadata(metadata, origin) {
  const bits = [
    origin === 'stealth' ? 'alpha 隐写' : 'PNG 文本块',
    metadata.model,
    metadata.seed != null ? `Seed ${metadata.seed}` : '',
    metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : '',
    metadata.steps ? `${metadata.steps} steps` : '',
    metadata.characterPrompts.length ? `${metadata.characterPrompts.length} 个角色栏` : '',
  ];
  return bits.filter(Boolean).join(' · ');
}

async function decodeImageDataForStealth(bytes, mimeType) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType || 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    // willReadFrequently 反而更慢：我们只读一次，而且要的是精确像素
    const context = canvas.getContext('2d', { alpha: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (error) {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

// 入口：给原始字节，返回归一化的元数据。读不到就 null，调用方照常走模型。
async function extractNaiMetadata(bytes, mimeType) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const values = await parseNaiPngTextChunks(data);
  if (values.Description || values.Comment) {
    const metadata = normalizeNaiMetadata(values);
    if (metadata.prompt) {
      return { ...metadata, origin: 'chunk', summary: describeNaiMetadata(metadata, 'chunk') };
    }
  }

  // 只有 PNG 才值得往下解像素：隐写位是最低位，任何有损重编码（JPEG/WebP 有损）
  // 都会把它抹掉，解一张全尺寸图纯属浪费。按字节签名判，不信 mimeType ——
  // 图床把 PNG 标成 image/jpeg 的情况很常见。
  if (!naiLooksLikePng(data)) return null;

  const imageData = await decodeImageDataForStealth(data, mimeType);
  if (!imageData) return null;

  const payload = await readNaiStealthPayload(imageData.data, imageData.width, imageData.height);
  if (!payload?.text) return null;

  let parsed = null;
  try { parsed = JSON.parse(payload.text); } catch (error) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return null;

  const metadata = normalizeNaiMetadata(parsed);
  if (!metadata.prompt) return null;
  return { ...metadata, origin: 'stealth', summary: describeNaiMetadata(metadata, 'stealth') };
}
