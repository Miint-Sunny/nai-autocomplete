function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeStoredPanelLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;

  const left = Number(layout.left);
  const top = Number(layout.top);
  const width = Number(layout.width);
  const height = Number(layout.height);

  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width < PANEL_MIN_WIDTH || height < PANEL_MIN_HEIGHT) return null;

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizePanelRect() {
  if (!ui.panel) return null;
  const rect = ui.panel.getBoundingClientRect();
  ui.panel.style.left = `${Math.round(rect.left)}px`;
  ui.panel.style.top = `${Math.round(rect.top)}px`;
  ui.panel.style.right = 'auto';
  ui.panel.style.bottom = 'auto';
  ui.panel.style.width = `${Math.round(rect.width)}px`;
  ui.panel.style.height = `${Math.round(rect.height)}px`;
  return rect;
}

function getPanelLayout() {
  if (!ui.panel || ui.panel.classList.contains('nai-hidden')) return state.panelLayout;
  const rect = normalizePanelRect();
  if (!rect) return null;

  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function applyPanelLayout(layout) {
  const normalized = normalizeStoredPanelLayout(layout);
  if (!ui.panel || !normalized) return;

  ui.panel.style.left = `${normalized.left}px`;
  ui.panel.style.top = `${normalized.top}px`;
  ui.panel.style.right = 'auto';
  ui.panel.style.bottom = 'auto';
  ui.panel.style.width = `${normalized.width}px`;
  ui.panel.style.height = `${normalized.height}px`;
}

function persistPanelLayout() {
  const layout = getPanelLayout();
  if (!layout) return;
  state.panelLayout = layout;
  void storageSet({ [PANEL_LAYOUT_KEY]: layout });
}

function clampPanelPosition(left, top, width, height) {
  const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
  const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN);
  return {
    left: clamp(left, PANEL_MARGIN, maxLeft),
    top: clamp(top, PANEL_MARGIN, maxTop),
  };
}

function setPanelInteractionState(isActive) {
  if (!ui.panel) return;
  ui.panel.classList.toggle('nai-is-interacting', Boolean(isActive));
  ui.root?.classList.toggle('nai-panel-interacting', Boolean(isActive));
  document.documentElement.classList.toggle('nai-panel-interacting', Boolean(isActive));
}

function applyPanelPointerUpdate(clientX, clientY) {
  if (!ui.panel) return;

  if (state.panelDrag.active) {
    const left = state.panelDrag.startLeft + (clientX - state.panelDrag.startX);
    const top = state.panelDrag.startTop + (clientY - state.panelDrag.startY);
    const pos = clampPanelPosition(left, top, state.panelDrag.width, state.panelDrag.height);
    ui.panel.style.left = `${Math.round(pos.left)}px`;
    ui.panel.style.top = `${Math.round(pos.top)}px`;
    return;
  }

  if (state.panelResize.active) {
    const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - state.panelResize.startLeft - PANEL_MARGIN);
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - state.panelResize.startTop - PANEL_MARGIN);
    const width = clamp(state.panelResize.startWidth + (clientX - state.panelResize.startX), PANEL_MIN_WIDTH, maxWidth);
    const height = clamp(state.panelResize.startHeight + (clientY - state.panelResize.startY), PANEL_MIN_HEIGHT, maxHeight);
    ui.panel.style.width = `${Math.round(width)}px`;
    ui.panel.style.height = `${Math.round(height)}px`;
  }
}

function flushPanelPointerUpdate() {
  state.panelInteraction.rafId = 0;
  applyPanelPointerUpdate(state.panelInteraction.clientX, state.panelInteraction.clientY);
}

function keepPanelInsideViewport() {
  if (!ui.panel || ui.panel.classList.contains('nai-hidden')) return;
  const rect = normalizePanelRect();
  if (!rect) return;

  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
  const width = clamp(rect.width, PANEL_MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, PANEL_MIN_HEIGHT, maxHeight);
  const pos = clampPanelPosition(rect.left, rect.top, width, height);

  ui.panel.style.left = `${Math.round(pos.left)}px`;
  ui.panel.style.top = `${Math.round(pos.top)}px`;
  ui.panel.style.width = `${Math.round(width)}px`;
  ui.panel.style.height = `${Math.round(height)}px`;
  state.panelLayout = {
    left: Math.round(pos.left),
    top: Math.round(pos.top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function onPointerMove(event) {
  if (!ui.panel) return;
  state.panelInteraction.clientX = event.clientX;
  state.panelInteraction.clientY = event.clientY;
  if (!state.panelInteraction.rafId) {
    state.panelInteraction.rafId = requestAnimationFrame(flushPanelPointerUpdate);
  }
}

function onPointerUp() {
  const hadLayoutInteraction = state.panelDrag.active || state.panelResize.active;
  if (state.panelInteraction.rafId) {
    cancelAnimationFrame(state.panelInteraction.rafId);
    state.panelInteraction.rafId = 0;
    applyPanelPointerUpdate(state.panelInteraction.clientX, state.panelInteraction.clientY);
  }
  state.panelDrag.active = false;
  state.panelResize.active = false;
  setPanelInteractionState(false);
  document.removeEventListener('pointermove', onPointerMove, true);
  document.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('pointercancel', onPointerUp, true);
  if (hadLayoutInteraction) {
    persistPanelLayout();
  }
}

function startDrag(event) {
  if (!ui.panel) return;
  const rect = ui.panel.getBoundingClientRect();
  if (!rect) return;

  ui.panel.style.left = `${Math.round(rect.left)}px`;
  ui.panel.style.top = `${Math.round(rect.top)}px`;
  ui.panel.style.right = 'auto';
  ui.panel.style.bottom = 'auto';

  state.panelDrag.active = true;
  state.panelDrag.startX = event.clientX;
  state.panelDrag.startY = event.clientY;
  state.panelDrag.startLeft = rect.left;
  state.panelDrag.startTop = rect.top;
  state.panelDrag.width = rect.width;
  state.panelDrag.height = rect.height;

  state.panelResize.active = false;
  state.panelInteraction.clientX = event.clientX;
  state.panelInteraction.clientY = event.clientY;
  setPanelInteractionState(true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
}

function startResize(event) {
  if (!ui.panel) return;
  const rect = normalizePanelRect();
  if (!rect) return;

  state.panelResize.active = true;
  state.panelResize.startX = event.clientX;
  state.panelResize.startY = event.clientY;
  state.panelResize.startLeft = rect.left;
  state.panelResize.startTop = rect.top;
  state.panelResize.startWidth = rect.width;
  state.panelResize.startHeight = rect.height;

  state.panelDrag.active = false;
  state.panelInteraction.clientX = event.clientX;
  state.panelInteraction.clientY = event.clientY;
  setPanelInteractionState(true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
}

function bindPanelInteractions() {
  if (!ui.header || !ui.resizeHandle) return;

  ui.header.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('[data-action="close"]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    startDrag(event);
  });

  ui.resizeHandle.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    startResize(event);
  });

  window.addEventListener('resize', () => {
    keepPanelInsideViewport();
    persistPanelLayout();
  });
}

