function getVisibleCaptureRect(element) {
  if (!(element instanceof Element)) return null;
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) return null;

  return {
    left,
    top,
    width,
    height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

async function waitForNextPaint() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function loadImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode captured tile'));
    image.src = dataUrl;
  });
}

async function stitchCaptureTilesInPage(width, height, tiles, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to stitch captured image');
  }

  for (const tile of tiles) {
    const image = await loadImageDataUrl(tile.dataUrl);
    context.drawImage(
      image,
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
      Math.floor((tile.destX || 0) * dpr),
      Math.floor((tile.destY || 0) * dpr),
      Math.floor((tile.width || 0) * dpr),
      Math.floor((tile.height || 0) * dpr),
    );
  }

  return canvas.toDataURL('image/png');
}

async function withAssistantUiHidden(callback) {
  const nodes = [ui.root, ui.fab, ui.panel, ui.library?.drawer].filter(Boolean);
  const previous = nodes.map((node) => ({
    node,
    visibility: node.style.visibility,
    pointerEvents: node.style.pointerEvents,
  }));

  nodes.forEach((node) => {
    node.style.visibility = 'hidden';
    node.style.pointerEvents = 'none';
  });

  try {
    await waitForNextPaint();
    return await callback();
  } finally {
    previous.forEach(({ node, visibility, pointerEvents }) => {
      node.style.visibility = visibility;
      node.style.pointerEvents = pointerEvents;
    });
  }
}

function getFullElementCapturePlan(element) {
  const rect = element.getBoundingClientRect();
  return {
    docTop: rect.top + window.scrollY,
    docLeft: rect.left + window.scrollX,
    totalWidth: rect.width,
    totalHeight: rect.height,
    viewW: window.innerWidth,
    viewH: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    needsStitch:
      rect.height > window.innerHeight * 0.92 ||
      rect.top < -1 ||
      rect.bottom > window.innerHeight + 1 ||
      rect.width > window.innerWidth * 0.92 ||
      rect.left < -1 ||
      rect.right > window.innerWidth + 1,
  };
}

async function captureVisibleElement(element) {
  return withAssistantUiHidden(async () => {
    const savedScroll = { x: window.scrollX, y: window.scrollY };
    const plan = getFullElementCapturePlan(element);

    try {
      if (!plan.needsStitch) {
        const rect = getVisibleCaptureRect(element);
        if (!rect) return '';
        const response = await sendRuntimeMessage({
          type: 'nai-capture-visible-area',
          rect,
        });
        return response?.ok ? response.dataUrl || '' : '';
      }

      const tiles = [];
      let scrollOffset = 0;
      let destY = 0;
      const maxTiles = 40;

      while (scrollOffset < plan.totalHeight - 0.5 && tiles.length < maxTiles) {
        window.scrollTo(savedScroll.x, Math.max(0, plan.docTop + scrollOffset));
        await waitForNextPaint();
        await new Promise((resolve) => setTimeout(resolve, 80));

        const rect = element.getBoundingClientRect();
        const cropLeft = Math.max(0, rect.left);
        const cropTop = Math.max(0, rect.top);
        const cropRight = Math.min(plan.viewW, rect.right);
        const cropBottom = Math.min(plan.viewH, rect.bottom);
        const cropWidth = cropRight - cropLeft;
        const cropHeight = cropBottom - cropTop;

        if (cropWidth < 2 || cropHeight < 2) break;

        const response = await sendRuntimeMessage({
          type: 'nai-capture-visible-area',
          raw: true,
          rect: {
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
            devicePixelRatio: plan.dpr,
          },
        });

        if (!response?.ok || !response.dataUrl) break;

        tiles.push({
          dataUrl: response.dataUrl,
          destX: Math.max(0, Math.round(cropLeft - rect.left)),
          destY,
          width: cropWidth,
          height: cropHeight,
        });

        destY += cropHeight;
        scrollOffset += cropHeight;
      }

      if (!tiles.length) return '';
      if (tiles.length === 1) return tiles[0].dataUrl;

      try {
        return await stitchCaptureTilesInPage(plan.totalWidth, plan.totalHeight, tiles, plan.dpr);
      } catch (error) {
        return tiles[0].dataUrl;
      }
    } finally {
      window.scrollTo(savedScroll.x, savedScroll.y);
      await waitForNextPaint();
    }
  });
}

function formatImageBytes(bytes) {
  if (!bytes) return '';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

// 压过才提示，没压就别多嘴
function describeImageBudget(response) {
  if (!response?.imageResized) return null;
  const from = formatImageBytes(response.imageOriginalBytes);
  const to = formatImageBytes(response.imageBytes);
  if (!from || !to) return null;
  const size = response.imageWidth && response.imageHeight
    ? ` · ${response.imageWidth}×${response.imageHeight}`
    : '';
  return `已压缩 ${from} → ${to}${size}`;
}

async function budgetInlineImage(dataUrl) {
  try {
    const response = await sendRuntimeMessage({ type: 'nai-budget-image', dataUrl });
    return response?.dataUrl ? response : { dataUrl };
  } catch (error) {
    return { dataUrl };
  }
}

const IMAGE_PICKER_TYPES = [{
  description: '图片',
  accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'] },
}];

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

// 从文件夹打开本地图片。选择框走 pickLocalFiles，它认 pickerId ——
// **下次点开就还在上次那个文件夹**，不用每次从头点一遍目录。
//
// 本地 NAI 原图走的还是那条零成本路径：读进来先过一次预算，
// 顺手把 PNG 里的提示词元数据带出来，有的话根本不用调模型。
async function openLocalImageFile() {
  if (!ensureExtensionContext()) {
    setStatus(T.statusContextInvalidated, true);
    return;
  }

  const [file] = await pickLocalFiles({
    pickerId: 'nai-reverse-image',
    accept: 'image/*',
    types: IMAGE_PICKER_TYPES,
    multiple: false,
    startIn: 'pictures',
  });
  if (!file) return;

  setStatus('正在读取图片...', false);

  try {
    const dataUrl = await readFileDataUrl(file);
    if (!dataUrl.startsWith('data:image/')) throw new Error('这不是图片文件');

    const budgeted = await budgetInlineImage(dataUrl);
    state.selectedImage = {
      sourceUrl: file.name,
      dataUrl: budgeted.dataUrl,
      budget: describeImageBudget(budgeted),
      naiMetadata: budgeted.naiMetadata || null,
    };
    updatePreview();
    openPanel('reverse');
    setStatus(T.statusImageLocked, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function useImageElement(image, autoReverse) {
  const resolved = resolveImageSource(image);
  const sourceUrl = resolved.sourceUrl;
  if (!sourceUrl) {
    setStatus('\u76ee\u6807\u5143\u7d20\u6ca1\u6709\u53ef\u7528\u56fe\u7247\u5730\u5740\u3002', true);
    return;
  }

  setStatus('\u6b63\u5728\u8bfb\u53d6\u56fe\u7247...', false);

  try {
    if (resolved.dataUrl) {
      // 页面里内嵌的 data URL 没走抓取，得补一次预算，否则原图整个塞给模型
      const budgeted = await budgetInlineImage(resolved.dataUrl);
      state.selectedImage = {
        sourceUrl,
        dataUrl: budgeted.dataUrl,
        budget: describeImageBudget(budgeted),
        naiMetadata: budgeted.naiMetadata || null,
      };
      updatePreview();
      openPanel('reverse');
      setStatus(T.statusImageLocked, false);

      if (autoReverse) {
        await reverseAndCopy();
      }
      return;
    }

    const response = await sendRuntimeMessage({
      type: 'nai-fetch-image-dataurl',
      url: sourceUrl,
      urls: resolved.candidateUrls,
      referrer: window.location.href,
    });

    if (!response?.ok) {
      setStatus('\u76f4\u63a5\u8bfb\u53d6\u5931\u8d25\uff0c\u6539\u7528\u6eda\u52a8\u62fc\u63a5\u622a\u56fe...', false);
      const capturedDataUrl = await captureVisibleElement(image);
      if (!capturedDataUrl) {
        throw new Error(response?.error || '\u56fe\u7247\u8bfb\u53d6\u5931\u8d25');
      }

      // 滚动拼接出来的是画布重绘，不可能带元数据
      state.selectedImage = { sourceUrl, dataUrl: capturedDataUrl, budget: null, naiMetadata: null };
      updatePreview();
      openPanel('reverse');
      setStatus(T.statusImageLocked, false);

      if (autoReverse) {
        await reverseAndCopy();
      }
      return;
    }

    state.selectedImage = {
      sourceUrl,
      dataUrl: response.dataUrl,
      budget: describeImageBudget(response),
      naiMetadata: response.naiMetadata || null,
    };
    updatePreview();
    openPanel('reverse');
    setStatus(T.statusImageLocked, false);

    if (autoReverse) {
      await reverseAndCopy();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function stopPickMode() {
  state.isPickingImage = false;
  document.documentElement.classList.remove('nai-image-pick-mode');
  document.removeEventListener('mouseover', onPickHover, true);
  document.removeEventListener('mouseout', onPickOut, true);
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKey, true);

  if (state.hoveredImage) {
    state.hoveredImage.classList.remove('nai-image-pick-hover');
    state.hoveredImage = null;
  }
}

function startPickMode() {
  if (!ensureExtensionContext() || state.isPickingImage) return;
  state.isPickingImage = true;

  document.documentElement.classList.add('nai-image-pick-mode');
  document.addEventListener('mouseover', onPickHover, true);
  document.addEventListener('mouseout', onPickOut, true);
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKey, true);

  setStatus(T.statusSelectMode, false);
}
function onPickHover(event) {
  if (!state.isPickingImage) return;
  const image = findImageCandidate(event);
  if (!image) return;

  if (state.hoveredImage && state.hoveredImage !== image) {
    state.hoveredImage.classList.remove('nai-image-pick-hover');
  }

  state.hoveredImage = image;
  state.hoveredImage.classList.add('nai-image-pick-hover');
}

function onPickOut(event) {
  if (!state.isPickingImage || !state.hoveredImage) return;
  const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (relatedTarget && state.hoveredImage.contains(relatedTarget)) return;
  state.hoveredImage.classList.remove('nai-image-pick-hover');
  state.hoveredImage = null;
}

function onPickKey(event) {
  if (!state.isPickingImage || event.key !== 'Escape') return;
  event.preventDefault();
  stopPickMode();
  setStatus(T.statusSelectCanceled, false);
}

function onPickClick(event) {
  if (!state.isPickingImage) return;
  const image = findImageCandidate(event);
  event.preventDefault();
  event.stopPropagation();

  if (!image) {
    setStatus('\u8bf7\u70b9\u51fb\u56fe\u7247\u5143\u7d20\u3002', true);
    return;
  }

  stopPickMode();
  useImageElement(image, false);
}

async function onShortcutClick(event) {
  if (!ensureExtensionContext() || state.isNovelAIImagePage || state.pending || state.isPickingImage) return;
  if (event.button !== 0 || !event.altKey || !event.shiftKey) return;

  const image = findImageCandidate(event);
  if (!image) return;

  event.preventDefault();
  event.stopPropagation();
  await useImageElement(image, true);
}

