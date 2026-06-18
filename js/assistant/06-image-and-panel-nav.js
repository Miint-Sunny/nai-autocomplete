function updateFabVisibility() {
  if (!ui.fab) return;
  const visible = state.isNovelAIImagePage
    ? state.settings.showWorkbenchFloatingBall
    : state.settings.showReverseFloatingBall;
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
  ui.previewHint.textContent = state.selectedImage.sourceUrl;
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

function resolveImageSource(element) {
  if (element instanceof HTMLImageElement) {
    const sourceUrl = element.currentSrc || element.src || '';
    const dataUrl = sourceUrl.startsWith('data:') ? sourceUrl : tryElementToDataUrl(element);
    return { sourceUrl, dataUrl };
  }

  if (element instanceof HTMLCanvasElement) {
    return {
      sourceUrl: window.location.href,
      dataUrl: tryElementToDataUrl(element),
    };
  }

  if (element instanceof HTMLElement) {
    return {
      sourceUrl: getBackgroundImageUrl(element),
      dataUrl: '',
    };
  }

  return { sourceUrl: '', dataUrl: '' };
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

