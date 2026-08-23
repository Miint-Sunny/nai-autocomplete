// 图片工具：Gelbooru CDN 直链推导、二进制转 base64、截图拼接与裁剪。
// 与 LLM 服务无关，单独一档避免和请求链路混在一起。

function normalizeGelbooruCdnUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/\.gelbooru\.com$/i.test(parsed.hostname)) return url;
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return parsed.href;
  } catch (error) {
    return url.replace(/(img\d+\.gelbooru\.com)\/+/g, '$1/');
  }
}

function expandGelbooruHotlinkCandidates(urls) {
  const expanded = [];
  const push = (url) => {
    const normalized = normalizeGelbooruCdnUrl(url);
    if (normalized && !expanded.includes(normalized)) expanded.push(normalized);
  };

  for (const url of urls) {
    if (typeof url !== 'string' || !url) continue;

    try {
      const parsed = new URL(url);
      const hotlinkMatch = /(^|\.)gelbooru\.com$/i.test(parsed.hostname) && /\/hotlink\.php$/i.test(parsed.pathname);
      if (hotlinkMatch) {
        const hash = parsed.searchParams.get('hash') || '';
        const imagePathMatch = hash.match(/\/?images\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{32})(\.\w+)?/i);
        if (imagePathMatch) {
          const [, a, b, md5, ext] = imagePathMatch;
          const extension = (ext || '.png').replace(/^\./, '');
          for (const imgServer of [4, 3, 2, 1]) {
            push(`https://img${imgServer}.gelbooru.com/images/${a}/${b}/${md5}.${extension}`);
          }
          continue;
        }
      }
    } catch (error) {
      // Fall through to pushing the original URL.
    }

    push(url);
  }

  return expanded;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

// ─────────────────────────── 图片预算 ───────────────────────────
//
// 反推是把整张图 base64 塞进请求里。一张 12MB 的 PNG 编码后约 16MB，
// 慢、贵、而且不少服务商直接 400。视觉模型看 1536px 长边已经绰绰有余。
//
// 决策部分抽成纯函数，因为 OffscreenCanvas 在测试环境里没有，
// 但「该缩到多大、该换什么格式」的判断必须能测。

const IMAGE_BUDGET = {
  maxEdge: 1536,
  maxBytes: 1_400_000,
  jpegQuality: 0.85,
  // 已经很小的图别动 —— 重编码只会掉画质
  skipBelowBytes: 220_000,
};

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function planImageBudget({ width, height, bytes, mimeType }, budget = IMAGE_BUDGET) {
  const longestEdge = Math.max(width || 0, height || 0);
  if (!longestEdge) return { needsWork: false, reason: 'unknown-size' };

  // GIF 可能是动图，重编码只会拿到第一帧还丢了信息，直接放过
  if (/gif/i.test(mimeType || '')) return { needsWork: false, reason: 'animated' };

  const withinEdge = longestEdge <= budget.maxEdge;
  const withinBytes = bytes <= budget.maxBytes;
  if (withinEdge && withinBytes) return { needsWork: false, reason: 'within-budget' };
  if (withinEdge && bytes <= budget.skipBelowBytes) return { needsWork: false, reason: 'too-small-to-bother' };

  const scale = withinEdge ? 1 : budget.maxEdge / longestEdge;
  const targetWidth = Math.max(1, Math.round((width || 0) * scale));
  const targetHeight = Math.max(1, Math.round((height || 0) * scale));

  // 缩过之后大概还有多少字节：像素数按比例缩，PNG 大致线性
  const projected = bytes * scale * scale;
  // 仍然超预算就换 JPEG。JPEG 会丢 alpha，所以底下垫白 —— 画作场景里这是合理默认
  const outputType = projected > budget.maxBytes ? 'image/jpeg' : 'image/png';

  return {
    needsWork: true,
    reason: withinEdge ? 'oversize-bytes' : 'oversize-edge',
    scale,
    targetWidth,
    targetHeight,
    outputType,
    quality: outputType === 'image/jpeg' ? budget.jpegQuality : undefined,
  };
}

async function applyImageBudget(dataUrl, budget = IMAGE_BUDGET) {
  const bytes = estimateDataUrlBytes(dataUrl);
  const mimeType = String(dataUrl || '').match(/^data:([^;]+)/)?.[1] || '';

  let bitmap;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    // 解不开就原样送出去，别因为压缩失败把整轮反推毁掉
    return { dataUrl, changed: false, bytes, reason: 'decode-failed' };
  }

  const plan = planImageBudget({ width: bitmap.width, height: bitmap.height, bytes, mimeType }, budget);
  if (!plan.needsWork) {
    bitmap.close?.();
    return { dataUrl, changed: false, bytes, width: bitmap.width, height: bitmap.height, reason: plan.reason };
  }

  try {
    const canvas = new OffscreenCanvas(plan.targetWidth, plan.targetHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');

    if (plan.outputType === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, plan.targetWidth, plan.targetHeight);
    }
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, plan.targetWidth, plan.targetHeight);

    const blob = await canvas.convertToBlob({ type: plan.outputType, quality: plan.quality });
    const buffer = await blob.arrayBuffer();
    const nextDataUrl = `data:${plan.outputType};base64,${arrayBufferToBase64(buffer)}`;

    return {
      dataUrl: nextDataUrl,
      changed: true,
      bytes: buffer.byteLength,
      originalBytes: bytes,
      width: plan.targetWidth,
      height: plan.targetHeight,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      outputType: plan.outputType,
      reason: plan.reason,
    };
  } catch (error) {
    return { dataUrl, changed: false, bytes, reason: 'encode-failed' };
  } finally {
    bitmap.close?.();
  }
}

async function stitchCaptureTiles(width, height, tiles, dpr) {
  const canvasW = Math.max(1, Math.floor(width * dpr));
  const canvasH = Math.max(1, Math.floor(height * dpr));
  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to stitch captured image');
  }

  for (const tile of tiles) {
    const response = await fetch(tile.dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const destX = Math.floor((tile.destX || 0) * dpr);
    const destY = Math.floor((tile.destY || 0) * dpr);
    const destW = Math.floor((tile.width || 0) * dpr);
    const destH = Math.floor((tile.height || 0) * dpr);
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, destX, destY, destW, destH);
  }

  const stitchedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await stitchedBlob.arrayBuffer();
  return 'data:image/png;base64,' + arrayBufferToBase64(buffer);
}

async function cropCapturedArea(dataUrl, rect) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const dpr = Number(rect.devicePixelRatio) || 1;
  const sx = Math.max(0, Math.floor(rect.left * dpr));
  const sy = Math.max(0, Math.floor(rect.top * dpr));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.floor(rect.width * dpr)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.floor(rect.height * dpr)));

  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to crop captured image');
  }

  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await croppedBlob.arrayBuffer();
  return 'data:image/png;base64,' + arrayBufferToBase64(buffer);
}
