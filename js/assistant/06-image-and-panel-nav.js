function updateFabVisibility() {
  if (!ui.fab) return;
  let visible;
  if (state.isNovelAIImagePage) {
    visible = state.settings.showWorkbenchFloatingBall;
  } else if (state.isNovelAISite) {
    visible = state.settings.showReverseFloatingBall;
  } else {
    // Non-NovelAI sites stay clean by default: the browser action opens the panel.
    visible = state.settings.showExternalFloatingBall;
  }
  ui.fab.classList.toggle('nai-hidden', !visible);
}

function updatePreview() {
  if (!ui.preview || !ui.previewHint) return;
  if (!state.selectedImage) {
    ui.preview.classList.add('nai-hidden');
    ui.preview.src = '';
    ui.previewHint.textContent = T.previewEmpty;
    return;
  }

  ui.preview.classList.remove('nai-hidden');
  ui.preview.src = state.selectedImage.dataUrl;
  ui.previewHint.textContent = state.selectedImage.budget
    ? `${state.selectedImage.sourceUrl} · ${state.selectedImage.budget}`
    : state.selectedImage.sourceUrl;
}

function getBackgroundImageUrl(element) {
  if (!(element instanceof HTMLElement)) return '';

  const backgroundImage = window.getComputedStyle(element).backgroundImage || '';
  const match = backgroundImage.match(/url\((['"]?)(.*?)\1\)/i);
  if (!match?.[2]) return '';

  try {
    return new URL(match[2], window.location.href).href;
  } catch (error) {
    return match[2];
  }
}

function isImageCandidate(element) {
  return (
    element instanceof HTMLImageElement ||
    element instanceof HTMLCanvasElement ||
    (element instanceof HTMLElement && Boolean(getBackgroundImageUrl(element)))
  );
}

function findImageCandidate(event) {
  const candidates = [];

  const pushCandidate = (element) => {
    if (!(element instanceof Element)) return;
    if (ui.root?.contains(element)) return;
    if (!candidates.includes(element)) candidates.push(element);
  };

  if (state.hoveredImage) {
    pushCandidate(state.hoveredImage);
  }

  if (event.target instanceof Element) {
    pushCandidate(event.target);
    pushCandidate(event.target.closest('img, canvas'));
  }

  if (typeof event.composedPath === 'function') {
    event.composedPath().forEach((node) => {
      if (!(node instanceof Element)) return;
      pushCandidate(node);
      pushCandidate(node.closest('img, canvas'));
    });
  }

  if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    document.elementsFromPoint(event.clientX, event.clientY).forEach((element) => {
      pushCandidate(element);
      pushCandidate(element.closest('img, canvas'));
    });
  }

  return candidates.find(isImageCandidate) || null;
}

function tryElementToDataUrl(element) {
  try {
    if (element instanceof HTMLCanvasElement) {
      return element.toDataURL('image/png');
    }

    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0 && element.naturalHeight > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(element, 0, 0);
      return canvas.toDataURL('image/png');
    }
  } catch (error) {
    return '';
  }

  return '';
}

function isGelbooruPage() {
  return /(^|\.)gelbooru\.com$/i.test(window.location.hostname);
}

function normalizeGelbooruCdnUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/\.gelbooru\.com$/i.test(parsed.hostname)) return url;
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return parsed.href;
  } catch (error) {
    return url.replace(/(gelbooru\.com)\/+/g, '$1/');
  }
}

function getGelbooruOgImageUrl() {
  const meta = document.querySelector('meta[property="og:image"]');
  const content = meta?.getAttribute('content')?.trim() || '';
  return /^https?:/i.test(content) ? normalizeGelbooruCdnUrl(content) : '';
}

function getGelbooruOriginalImageUrl() {
  const links = document.querySelectorAll('a[href*="/images/"]');
  for (const link of links) {
    if (!/original image/i.test(link.textContent || '')) continue;
    try {
      return normalizeGelbooruCdnUrl(new URL(link.href, window.location.href).href);
    } catch (error) {
      continue;
    }
  }
  return '';
}

function parseGelbooruHotlinkUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    if (!/(^|\.)gelbooru\.com$/i.test(parsed.hostname) || !/\/hotlink\.php$/i.test(parsed.pathname)) {
      return null;
    }

    const hash = parsed.searchParams.get('hash')?.trim() || '';
    const imagePathMatch = hash.match(/\/?images\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{32})(\.\w+)?/i);
    if (!imagePathMatch) return null;

    const [, a, b, md5, ext] = imagePathMatch;
    return {
      a,
      b,
      md5,
      extension: (ext || '.png').replace(/^\./, ''),
    };
  } catch (error) {
    return null;
  }
}

function buildGelbooruCdnUrlsFromPath(a, b, md5, extension) {
  const extensions = extension ? [extension.replace(/^\./, '')] : ['png', 'jpg', 'webp', 'gif'];
  const urls = [];
  for (const imgServer of [4, 3, 2, 1]) {
    for (const ext of extensions) {
      urls.push(`https://img${imgServer}.gelbooru.com/images/${a}/${b}/${md5}.${ext}`);
    }
  }
  return urls;
}

function getGelbooruImageFromContainer(element) {
  const container = element?.closest?.('.image-container, .note-container');
  if (!container) return '';

  const md5 = container.dataset?.md5 || '';
  if (!/^[0-9a-f]{32}$/i.test(md5)) return '';

  const extension = (container.dataset?.fileExt || '.png').replace(/^\./, '') || 'png';
  return `https://img4.gelbooru.com/images/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${extension}`;
}

function buildGelbooruFullImageCandidates(url, element) {
  const normalized = normalizeGelbooruCdnUrl(url);
  if (!normalized || !/gelbooru\.com/i.test(normalized)) {
    return normalized ? [normalized] : [];
  }

  const candidates = [];
  const push = (candidate) => {
    const next = normalizeGelbooruCdnUrl(candidate);
    if (!next || /\/hotlink\.php/i.test(next) || candidates.includes(next)) return;
    candidates.push(next);
  };

  const containerUrl = getGelbooruImageFromContainer(element);
  if (containerUrl) push(containerUrl);

  const ogImage = getGelbooruOgImageUrl();
  if (ogImage) push(ogImage);

  const originalLink = getGelbooruOriginalImageUrl();
  if (originalLink) push(originalLink);

  const hotlink = parseGelbooruHotlinkUrl(url) || parseGelbooruHotlinkUrl(normalized);
  if (hotlink) {
    buildGelbooruCdnUrlsFromPath(hotlink.a, hotlink.b, hotlink.md5, hotlink.extension).forEach(push);
  } else if (!/\/hotlink\.php/i.test(normalized)) {
    push(normalized);
  }

  const thumbnailMatch = normalized.match(
    /^(https?:\/\/img\d+\.gelbooru\.com)\/thumbnails\/([0-9a-f]{2})\/([0-9a-f]{2})\/thumbnail_([0-9a-f]{32})\.\w+/i,
  );
  if (thumbnailMatch) {
    const [, base, a, b, md5] = thumbnailMatch;
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      push(`${base}/images/${a}/${b}/${md5}.${ext}`);
    }
  }

  const sampleMatch = normalized.match(
    /^(https?:\/\/img\d+\.gelbooru\.com)\/samples\/([0-9a-f]{2})\/([0-9a-f]{2})\/sample_([0-9a-f]{32})\.\w+/i,
  );
  if (sampleMatch) {
    const [, base, a, b, md5] = sampleMatch;
    if (ogImage && ogImage.includes(md5)) {
      push(ogImage);
    } else {
      for (const ext of ['jpg', 'png', 'webp', 'gif']) {
        push(`${base}/images/${a}/${b}/${md5}.${ext}`);
      }
    }
  }

  return candidates;
}

function resolveGelbooruImageUrl(url, element) {
  const candidates = buildGelbooruFullImageCandidates(url, element);
  return candidates[0] || normalizeGelbooruCdnUrl(url);
}

function isPixivPage() {
  return /(^|\.)pixiv\.net$/i.test(window.location.hostname);
}

function upgradePixivToOriginal(url) {
  if (!url || !/pximg\.net/i.test(url)) return '';

  try {
    let next = url;
    if (/\/c\/[^/]+\//.test(next)) {
      next = next.replace(/\/c\/[^/]+\//, '/img-original/');
    }
    if (/\/img-master\//.test(next)) {
      next = next.replace('/img-master/', '/img-original/');
    }
    next = next.replace(/_master\d+(\.\w+)$/i, '$1');
    return next;
  } catch (error) {
    return '';
  }
}

function buildPixivFullImageCandidates(url, element) {
  const candidates = [];
  const push = (candidate) => {
    const next = upgradePixivToOriginal(candidate) || candidate;
    if (next && !candidates.includes(next)) candidates.push(next);
  };

  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
  if (ogImage) push(ogImage);

  if (element instanceof HTMLImageElement) {
    push(element.currentSrc || element.src || '');
    const srcset = element.srcset || '';
    srcset.split(',').forEach((entry) => {
      const candidate = entry.trim().split(/\s+/)[0];
      if (candidate) push(candidate);
    });
  } else if (url) {
    push(url);
  }

  const linkedOriginal = element?.closest?.('a[href*="pximg.net"]')?.href;
  if (linkedOriginal) push(linkedOriginal);

  return candidates;
}

function resolvePixivImageUrl(url, element) {
  const candidates = buildPixivFullImageCandidates(url, element);
  return candidates[0] || upgradePixivToOriginal(url) || url;
}

function usesExternalImageResolver() {
  return isGelbooruPage() || isPixivPage();
}

function buildExternalImageCandidates(url, element) {
  if (isGelbooruPage()) return buildGelbooruFullImageCandidates(url, element);
  if (isPixivPage()) return buildPixivFullImageCandidates(url, element);
  return url ? [url] : [];
}

function resolveExternalImageUrl(url, element) {
  if (isGelbooruPage()) return resolveGelbooruImageUrl(url, element);
  if (isPixivPage()) return resolvePixivImageUrl(url, element);
  return url;
}

function resolveImageSource(element) {
  if (element instanceof HTMLImageElement) {
    const rawUrl = element.currentSrc || element.src || '';
    const sourceUrl = usesExternalImageResolver() ? resolveExternalImageUrl(rawUrl, element) : rawUrl;
    const candidateUrls = usesExternalImageResolver()
      ? buildExternalImageCandidates(rawUrl, element)
      : sourceUrl
        ? [sourceUrl]
        : [];
    const dataUrl = sourceUrl.startsWith('data:') ? sourceUrl : tryElementToDataUrl(element);
    return { sourceUrl, candidateUrls, dataUrl };
  }

  if (element instanceof HTMLCanvasElement) {
    return {
      sourceUrl: window.location.href,
      candidateUrls: [window.location.href],
      dataUrl: tryElementToDataUrl(element),
    };
  }

  if (element instanceof HTMLElement) {
    const sourceUrl = getBackgroundImageUrl(element);
    const candidateUrls = usesExternalImageResolver()
      ? buildExternalImageCandidates(sourceUrl, element)
      : sourceUrl
        ? [sourceUrl]
        : [];
    return {
      sourceUrl: usesExternalImageResolver() ? resolveExternalImageUrl(sourceUrl, element) : sourceUrl,
      candidateUrls,
      dataUrl: '',
    };
  }

  return { sourceUrl: '', candidateUrls: [], dataUrl: '' };
}

function setPage(page) {
  const targetPage = state.isNovelAIImagePage ? 'library' : (page === 'library' ? 'reverse' : page);
  state.activePage = targetPage;
  if (ui.root) {
    ui.root.dataset.page = targetPage;
  }
  ui.navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === targetPage);
  });
  Object.entries(ui.pages).forEach(([name, el]) => {
    el.classList.toggle('nai-hidden', name !== targetPage);
  });
  if (targetPage === 'library') renderLibraryManager();
  if (targetPage === 'artists') openArtistQuickPanel();
  if (targetPage === 'agent') renderAgentPanel();
  if (targetPage === 'flow') openFlowSurface('panel');
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function openLibraryDrawer() {
  state.isOpen = true;
  ui.library.drawer?.classList.remove('nai-hidden');
  syncWorkbenchLayoutState();
  renderLibraryManager();
  setStatus(T.statusLibraryReady, false);
}

function closeLibraryDrawer() {
  state.isOpen = false;
  ui.library.drawer?.classList.add('nai-hidden');
}

function syncWorkbenchLayoutState() {
  if (!ui.library.drawer) return;
  ui.library.drawer.dataset.editorOpen = state.libraryEditorOpen ? 'true' : 'false';
  ui.library.drawer.dataset.workbenchPage = state.workbenchPage || 'library';
  ui.library.drawer.dataset.sidebarCollapsed = state.workbenchSidebarCollapsed ? 'true' : 'false';
  ui.library.drawer.querySelectorAll('.nai-workbench-nav-item[data-workbench-page]').forEach((button) => {
    const isActive = button.dataset.workbenchPage === state.workbenchPage;
    button.classList.toggle('is-active', isActive);
    button.toggleAttribute('aria-current', isActive);
  });
  if (ui.library.sidebarToggle) {
    ui.library.sidebarToggle.setAttribute('aria-expanded', state.workbenchSidebarCollapsed ? 'false' : 'true');
    ui.library.sidebarToggle.querySelector('.nai-workbench-nav-text').textContent = state.workbenchSidebarCollapsed ? '展开' : '收起';
  }
}

function openLibraryEditor() {
  state.workbenchPage = 'library';
  state.libraryEditorOpen = true;
  syncWorkbenchLayoutState();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function closeLibraryEditor() {
  state.libraryEditorOpen = false;
  state.libraryEditingId = '';
  syncWorkbenchLayoutState();
}

function openLibrarySettingsPanel() {
  state.workbenchPage = 'settings';
  state.libraryEditorOpen = false;
  syncWorkbenchLayoutState();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function openPresetsPanel() {
  state.workbenchPage = 'presets';
  state.libraryEditorOpen = false;
  syncWorkbenchLayoutState();
  renderWorkbenchPresetSelector();
  renderWorkbenchPresetBlocks();
  bindWorkbenchBlockDragListeners();
  updateWorkbenchRoleSectionVisibility();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function openLibraryIndexPanel() {
  state.workbenchPage = 'library';
  closeLibraryEditor();
}

function openFlowWorkbenchPanel() {
  state.workbenchPage = 'flow';
  closeLibraryEditor();
  openFlowSurface('drawer');
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function openAgentWorkbenchPanel() {
  state.workbenchPage = 'agent';
  closeLibraryEditor();
  renderAgentPanel();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

function openArtistWorkbenchPanel() {
  state.workbenchPage = 'artists';
  closeLibraryEditor();
  openArtistQuickPanel();
}

function toggleWorkbenchSidebar() {
  state.workbenchSidebarCollapsed = !state.workbenchSidebarCollapsed;
  syncWorkbenchLayoutState();
}

function openPanel(page) {
  if (state.isNovelAIImagePage) {
    openLibraryDrawer();
    return;
  }
  state.isOpen = true;
  if (state.panelLayout) {
    applyPanelLayout(state.panelLayout);
  }
  ui.panel.classList.remove('nai-hidden');
  setPage(page || state.activePage || (state.isNovelAIImagePage ? 'library' : 'reverse'));
  keepPanelInsideViewport();
}

function closePanel() {
  if (state.isNovelAIImagePage) {
    closeLibraryDrawer();
    return;
  }
  persistPanelLayout();
  state.isOpen = false;
  ui.panel.classList.add('nai-hidden');
  onPointerUp();
  stopPickMode();
}

