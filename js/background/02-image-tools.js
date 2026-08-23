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
