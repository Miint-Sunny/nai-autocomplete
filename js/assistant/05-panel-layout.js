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
    keepFabInsideViewport();
  });
}

/* ---- 设置抽屉(.nai-library-drawer)左边缘拖拽调宽 + 宽度记忆 ---- */
/* 抽屉右贴边(inset:0 0 0 auto)，故左边缘左移=变宽：delta = startX - clientX */

function getDrawerMaxWidth() {
  return Math.max(DRAWER_MIN_WIDTH, window.innerWidth - PANEL_MARGIN);
}

function normalizeStoredDrawerLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;
  const width = Number(layout.width);
  if (!Number.isFinite(width) || width < DRAWER_MIN_WIDTH) return null;
  return { width: Math.round(width) };
}

function applyDrawerWidth(layout) {
  if (!ui.library?.drawer) return;
  const normalized = normalizeStoredDrawerLayout(layout);
  if (!normalized) {
    ui.library.drawer.style.removeProperty('--nai-drawer-width');
    return;
  }
  const width = clamp(normalized.width, DRAWER_MIN_WIDTH, getDrawerMaxWidth());
  ui.library.drawer.style.setProperty('--nai-drawer-width', `${Math.round(width)}px`);
}

function persistDrawerWidth() {
  if (!ui.library?.drawer) return;
  const width = Math.round(clamp(ui.library.drawer.getBoundingClientRect().width, DRAWER_MIN_WIDTH, getDrawerMaxWidth()));
  state.drawerLayout = { width };
  void storageSet({ [DRAWER_LAYOUT_KEY]: state.drawerLayout });
}

function flushDrawerPointerUpdate() {
  state.drawerResize.rafId = 0;
  if (!state.drawerResize.active || !ui.library?.drawer) return;
  const delta = state.drawerResize.startX - state.drawerResize.clientX;
  const width = clamp(state.drawerResize.startWidth + delta, DRAWER_MIN_WIDTH, getDrawerMaxWidth());
  ui.library.drawer.style.setProperty('--nai-drawer-width', `${Math.round(width)}px`);
}

function onDrawerPointerMove(event) {
  state.drawerResize.clientX = event.clientX;
  state.drawerResize.moved = true;
  if (!state.drawerResize.rafId) {
    state.drawerResize.rafId = requestAnimationFrame(flushDrawerPointerUpdate);
  }
}

function onDrawerPointerUp() {
  const wasActive = state.drawerResize.active;
  if (state.drawerResize.rafId) {
    cancelAnimationFrame(state.drawerResize.rafId);
    state.drawerResize.rafId = 0;
    flushDrawerPointerUpdate();
  }
  state.drawerResize.active = false;
  ui.library?.drawer?.classList.remove('nai-drawer-resizing');
  document.removeEventListener('pointermove', onDrawerPointerMove, true);
  document.removeEventListener('pointerup', onDrawerPointerUp, true);
  document.removeEventListener('pointercancel', onDrawerPointerUp, true);
  if (wasActive && state.drawerResize.moved) persistDrawerWidth();
}

function startDrawerResize(event) {
  if (!ui.library?.drawer) return;
  state.drawerResize.active = true;
  state.drawerResize.moved = false;
  state.drawerResize.startX = event.clientX;
  state.drawerResize.clientX = event.clientX;
  state.drawerResize.startWidth = ui.library.drawer.getBoundingClientRect().width;
  ui.library.drawer.classList.add('nai-drawer-resizing');
  document.addEventListener('pointermove', onDrawerPointerMove, true);
  document.addEventListener('pointerup', onDrawerPointerUp, true);
  document.addEventListener('pointercancel', onDrawerPointerUp, true);
}

function bindDrawerResize() {
  if (!ui.library?.resizeHandle) return;

  ui.library.resizeHandle.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    startDrawerResize(event);
  });

  ui.library.resizeHandle.addEventListener('dblclick', () => {
    state.drawerLayout = null;
    ui.library.drawer?.style.removeProperty('--nai-drawer-width');
    void storageSet({ [DRAWER_LAYOUT_KEY]: null });
  });

  window.addEventListener('resize', () => {
    if (!state.drawerLayout) return;
    if (!ui.library?.drawer || ui.library.drawer.classList.contains('nai-hidden')) return;
    applyDrawerWidth(state.drawerLayout);
  });
}

// ─────────────────────────── 悬浮球 ───────────────────────────
// 它挂在 .nai-md3-root 上（root 是 fixed + right/bottom，球是唯一常驻的子元素）。
// 面板和抽屉都是各自 fixed 的，所以挪 root 只会挪这颗球。

const FAB_MARGIN = 8;
// 拖过 4px 才算拖 —— 不然手一抖点击就被吞了，球点不开
const FAB_DRAG_THRESHOLD = 4;

function normalizeStoredFabPosition(position) {
  if (!position || typeof position !== 'object') return null;
  const left = Number(position.left);
  const top = Number(position.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left: Math.round(left), top: Math.round(top) };
}

function clampFabPosition(left, top, width, height) {
  return {
    left: clamp(left, FAB_MARGIN, Math.max(FAB_MARGIN, window.innerWidth - width - FAB_MARGIN)),
    top: clamp(top, FAB_MARGIN, Math.max(FAB_MARGIN, window.innerHeight - height - FAB_MARGIN)),
  };
}

function applyFabPosition(position) {
  const normalized = normalizeStoredFabPosition(position);
  if (!ui.root || !ui.fab || !normalized) return;

  const rect = ui.fab.getBoundingClientRect();
  const pos = clampFabPosition(normalized.left, normalized.top, rect.width || 44, rect.height || 44);
  ui.root.style.left = `${pos.left}px`;
  ui.root.style.top = `${pos.top}px`;
  ui.root.style.right = 'auto';
  ui.root.style.bottom = 'auto';
}

function persistFabPosition() {
  if (!ui.fab) return;
  const rect = ui.fab.getBoundingClientRect();
  const position = { left: Math.round(rect.left), top: Math.round(rect.top) };
  state.fabPosition = position;
  void storageSet({ [FAB_POSITION_KEY]: position });
}

// 窗口变小之后球可能被挤到视口外，那就再也点不着了
function keepFabInsideViewport() {
  if (!ui.root || !ui.fab || !state.fabPosition) return;
  applyFabPosition(state.fabPosition);
  persistFabPosition();
}

function bindFabDrag(onClick) {
  if (!ui.fab) return;
  const drag = { pointerId: null, startX: 0, startY: 0, originLeft: 0, originTop: 0, moved: false, width: 0, height: 0 };

  ui.fab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = ui.fab.getBoundingClientRect();
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.originLeft = rect.left;
    drag.originTop = rect.top;
    drag.width = rect.width;
    drag.height = rect.height;
    drag.moved = false;
    ui.fab.setPointerCapture?.(event.pointerId);
  });

  ui.fab.addEventListener('pointermove', (event) => {
    if (drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < FAB_DRAG_THRESHOLD && Math.abs(dy) < FAB_DRAG_THRESHOLD) return;

    drag.moved = true;
    ui.fab.classList.add('is-dragging');
    const pos = clampFabPosition(drag.originLeft + dx, drag.originTop + dy, drag.width, drag.height);
    ui.root.style.left = `${pos.left}px`;
    ui.root.style.top = `${pos.top}px`;
    ui.root.style.right = 'auto';
    ui.root.style.bottom = 'auto';
  });

  const finish = (event) => {
    if (drag.pointerId !== event.pointerId) return;
    ui.fab.releasePointerCapture?.(event.pointerId);
    drag.pointerId = null;
    ui.fab.classList.remove('is-dragging');
    if (drag.moved) persistFabPosition();
    else onClick();
  };

  ui.fab.addEventListener('pointerup', finish);
  ui.fab.addEventListener('pointercancel', (event) => {
    if (drag.pointerId !== event.pointerId) return;
    ui.fab.releasePointerCapture?.(event.pointerId);
    drag.pointerId = null;
    ui.fab.classList.remove('is-dragging');
    if (drag.moved) persistFabPosition();
  });

  // 拖完手指抬起来那一下浏览器还会补一个 click，不拦住就会又开一次面板
  ui.fab.addEventListener('click', (event) => {
    if (!drag.moved) return;
    event.preventDefault();
    event.stopPropagation();
    drag.moved = false;
  }, true);
}
