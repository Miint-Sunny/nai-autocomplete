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

async function captureVisibleElement(element) {
  const rect = getVisibleCaptureRect(element);
  if (!rect) return '';

  try {
    const response = await sendRuntimeMessage({
      type: 'nai-capture-visible-area',
      rect,
    });
    return response?.ok ? response.dataUrl || '' : '';
  } catch (error) {
    return '';
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
      state.selectedImage = { sourceUrl, dataUrl: resolved.dataUrl };
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
      referrer: window.location.href,
    });

    if (!response?.ok) {
      const capturedDataUrl = await captureVisibleElement(image);
      if (!capturedDataUrl) {
        throw new Error(response?.error || '\u56fe\u7247\u8bfb\u53d6\u5931\u8d25');
      }

      state.selectedImage = { sourceUrl, dataUrl: capturedDataUrl };
      updatePreview();
      openPanel('reverse');
      setStatus(T.statusImageLocked, false);

      if (autoReverse) {
        await reverseAndCopy();
      }
      return;
    }

    state.selectedImage = { sourceUrl, dataUrl: response.dataUrl };
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

