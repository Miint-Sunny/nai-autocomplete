// 流编辑器组件。面板页、抽屉页、以及 novelai.net 上的输入框覆盖层都用这一个实例工厂，
// 三处行为完全一致 —— 这也是把它放进共享 chunk 的全部理由。
//
// 交互取自 HainTag 的思路，实现是重写的：左键拖排序、右键上下拖调权重、
// 点一下改词、多选批量。区别在于这里的模型是 NAI 的三层结构（段 / 行 / 条目）。

const FLOW_DRAG_THRESHOLD = 4;
const FLOW_WEIGHT_STEP = 0.05;
const FLOW_WEIGHT_PIXELS = 10;
const FLOW_WEIGHT_MIN = -3;
const FLOW_WEIGHT_MAX = 3;
const FLOW_HISTORY_LIMIT = 60;

// 按 skill 第 2 节的锚点顺序：人数 / solo → 取景 / 视角 → 关键物体，氛围串收尾。
// 「关键物体」在词典里多半归不进任何语义类，落在 other —— 它属于锚点，不能被扫到最后。
const FLOW_SORT_ORDER = ['subject', 'camera', 'other', 'appearance', 'outfit', 'expression', 'pose', 'scene', 'light', 'quality'];

// 合成事件没有真实指针，setPointerCapture 会抛 NotFoundError。
// 真实使用时捕获是必要的（拖到画布外仍要收到 move/up），所以不能省，只能兜住。
function flowCapturePointer(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch (error) {
    // 没捕获到也能用，只是拖出画布会断
  }
}

function flowClampWeight(weight) {
  return flowRoundWeight(Math.max(FLOW_WEIGHT_MIN, Math.min(FLOW_WEIGHT_MAX, weight)));
}

function flowEditorMarkup(options) {
  const actions = (options.actions || [])
    .map((action) => `<button type="button" class="${action.primary ? 'nai-md3-primary' : 'nai-md3-inline-action'}"`
      + ` data-flow-action="${action.id}">${flowEscapeHtml(action.label)}</button>`)
    .join('');

  return `
    <div class="nai-flow">
      <div class="nai-flow-head">
        <div class="nai-flow-segments" data-flow-field="segments"></div>
        <button type="button" class="nai-md3-inline-action nai-flow-seg-add" data-flow-action="add-segment" title="新增一个角色段">＋段</button>
      </div>
      <div class="nai-flow-tools">
        <button type="button" class="nai-md3-inline-action" data-flow-action="undo" title="撤销">撤销</button>
        <button type="button" class="nai-md3-inline-action" data-flow-action="redo" title="重做">重做</button>
        <button type="button" class="nai-md3-inline-action" data-flow-action="dedupe" title="同段内同名 tag 只留一个，权重取最大">去重</button>
        <button type="button" class="nai-md3-inline-action" data-flow-action="sort" title="每一行内按类别归并，不跨行搬动">归类</button>
        <button type="button" class="nai-md3-inline-action" data-flow-action="clear" title="清空当前段">清空</button>
      </div>
      <div class="nai-flow-canvas" data-flow-field="canvas"></div>
      <div class="nai-flow-bulk nai-hidden" data-flow-field="bulk"></div>
      <div class="nai-flow-add">
        <textarea class="nai-md3-input nai-flow-input" rows="1" data-flow-field="add" placeholder="加 tag，回车确认；点上面的 chip 或整句都能改"></textarea>
        <div class="nai-flow-suggests" data-flow-field="suggests"></div>
      </div>
      <div class="nai-flow-foot" data-flow-field="summary"></div>
      ${actions ? `<div class="nai-md3-actions nai-flow-actions">${actions}</div>` : ''}
    </div>`;
}

function flowCreateEditor(options = {}) {
  const host = options.host;
  if (!host) throw new Error('flowCreateEditor 需要 host');

  host.innerHTML = flowEditorMarkup(options);

  const dom = {
    root: host.querySelector('.nai-flow'),
    segments: host.querySelector('[data-flow-field="segments"]'),
    canvas: host.querySelector('[data-flow-field="canvas"]'),
    bulk: host.querySelector('[data-flow-field="bulk"]'),
    add: host.querySelector('[data-flow-field="add"]'),
    suggests: host.querySelector('[data-flow-field="suggests"]'),
    summary: host.querySelector('[data-flow-field="summary"]'),
  };

  const state = {
    flow: flowParse(''),
    activeSegmentId: '',
    selection: new Set(),
    history: [],
    future: [],
    editingId: '',
    drag: null,
    weight: null,
    suggestTimer: null,
  };

  const listeners = [];
  const bind = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts);
    listeners.push(() => target.removeEventListener(type, handler, opts));
  };

  function activeSegment() {
    return state.flow.segments.find((segment) => segment.id === state.activeSegmentId) || state.flow.segments[0];
  }

  function snapshot() {
    return { text: flowSerialize(state.flow), index: state.flow.segments.indexOf(activeSegment()) };
  }

  // 撤销点存的是序列化文本 —— 重新解析后条目 id 会变，所以顺带把选择清掉
  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > FLOW_HISTORY_LIMIT) state.history.shift();
    state.future.length = 0;
  }

  function restore(entry) {
    state.flow = flowParse(entry.text);
    const segment = state.flow.segments[Math.min(entry.index, state.flow.segments.length - 1)];
    state.activeSegmentId = segment?.id || '';
    state.selection.clear();
    state.editingId = '';
  }

  function notifyChange() {
    options.onChange?.(flowSerialize(state.flow));
  }

  function render() {
    const segment = activeSegment();
    if (!segment) return;
    state.activeSegmentId = segment.id;

    dom.segments.innerHTML = flowSegmentTabsMarkup(state.flow, segment.id);
    dom.canvas.innerHTML = flowCanvasMarkup(segment, { selection: state.selection, emptyHint: options.emptyHint });
    dom.summary.innerHTML = flowSummaryMarkup(state.flow, segment);

    const count = state.selection.size;
    dom.bulk.classList.toggle('nai-hidden', !count);
    if (count) {
      dom.bulk.innerHTML = `<span class="nai-flow-bulk-count">已选 ${count} 个</span>`
        + '<button type="button" class="nai-md3-inline-action" data-flow-action="bulk-toggle-kind" title="tag 被忽略时改用自然语言整句，反之亦然">tag ⇄ 整句</button>'
        + '<button type="button" class="nai-md3-inline-action" data-flow-action="bulk-group">加权成组</button>'
        + '<button type="button" class="nai-md3-inline-action" data-flow-action="bulk-delete">删除</button>'
        + state.flow.segments
          .filter((item) => item.id !== segment.id)
          .map((item) => `<button type="button" class="nai-md3-inline-action" data-flow-action="bulk-move" data-id="${item.id}">移到${flowEscapeHtml(item.name)}</button>`)
          .join('')
        + '<button type="button" class="nai-md3-inline-action" data-flow-action="bulk-clear">取消选择</button>';
    }

    dom.root.classList.toggle('is-editing', Boolean(state.editingId));
  }

  function commitChange() {
    render();
    notifyChange();
  }

  // ───────────────────────── 加 / 改词 ─────────────────────────

  function renderSuggestions() {
    const query = dom.add.value.trim();
    if (!query) {
      dom.suggests.innerHTML = '';
      return;
    }
    dom.suggests.innerHTML = flowSuggestionsMarkup(flowSearchDictionary(query, 8));
  }

  function scheduleSuggestions() {
    clearTimeout(state.suggestTimer);
    state.suggestTimer = setTimeout(renderSuggestions, 120);
  }

  function beginEdit(itemId) {
    const found = flowFindItem(state.flow, itemId);
    if (!found) return;

    const isSentence = found.item.kind === 'sentence';
    state.editingId = itemId;
    dom.add.value = isSentence ? found.item.raw : found.item.name;
    dom.add.rows = isSentence ? 4 : 1;
    dom.add.classList.toggle('is-prose', isSentence);
    dom.add.placeholder = isSentence ? '改这一段，回车确认，Esc 取消' : '改词，回车确认，Esc 取消';
    dom.add.focus();
    dom.add.select();
    renderSuggestions();
    render();
  }

  function cancelEdit() {
    state.editingId = '';
    dom.add.value = '';
    dom.add.rows = 1;
    dom.add.classList.remove('is-prose');
    dom.add.placeholder = '加 tag，回车确认；点上面的 chip 或整句都能改';
    dom.suggests.innerHTML = '';
    render();
  }

  function submitInput(rawValue) {
    const value = String(rawValue ?? dom.add.value).trim();
    if (!value) {
      cancelEdit();
      return;
    }

    pushHistory();

    if (state.editingId) {
      const found = flowFindItem(state.flow, state.editingId);
      if (found) {
        const list = found.group ? found.group.items : found.segment.items;
        if (found.item.kind === 'sentence') {
          // 整句改完还是整句 —— 用户把长段落删短时不该被启发式重新判成 tag
          list[found.index] = { ...found.item, raw: value };
        } else {
          const parsed = flowParseItem(value);
          if (parsed) {
            list[found.index] = {
              ...parsed,
              id: found.item.id,
              newlineBefore: found.item.newlineBefore,
              blankBefore: found.item.blankBefore,
              trailing: found.item.trailing ?? '',
            };
          }
        }
      }
      cancelEdit();
      commitChange();
      return;
    }

    // 一次可以粘一整串，逗号会被拆开
    const segment = activeSegment();
    const added = flowParse(value).segments[0]?.items || [];
    if (added.length) added[0].newlineBefore = false;
    segment.items.push(...added);
    flowNormalizeLineFlags(segment);

    dom.add.value = '';
    dom.suggests.innerHTML = '';
    commitChange();
  }

  // ───────────────────────── 选择 ─────────────────────────

  function toggleSelection(itemId) {
    if (state.selection.has(itemId)) state.selection.delete(itemId);
    else state.selection.add(itemId);
    render();
  }

  // ───────────────────────── 拖拽排序 ─────────────────────────

  function topLevelNodes() {
    return Array.from(dom.canvas.querySelectorAll('.nai-flow-line > [data-flow-item]'));
  }

  function ensureDropMarker() {
    let marker = dom.canvas.querySelector('.nai-flow-drop');
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'nai-flow-drop';
      dom.canvas.appendChild(marker);
    }
    return marker;
  }

  function clearDropMarker() {
    dom.canvas.querySelector('.nai-flow-drop')?.remove();
  }

  // 落点靠 elementFromPoint 找。被拖的那个 chip 会被设成 pointer-events:none，
  // 所以不会挡住自己下面的落点。
  function updateDropMarker(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    const node = element?.closest?.('.nai-flow-line > [data-flow-item]');
    const marker = ensureDropMarker();

    if (!node) {
      const line = element?.closest?.('.nai-flow-line');
      if (line) line.appendChild(marker);
      return;
    }

    const rect = node.getBoundingClientRect();
    const after = clientX > rect.left + rect.width / 2;
    node.parentElement.insertBefore(marker, after ? node.nextSibling : node);
  }

  // drag 是显式传进来的：pointerup 里已经把 state.drag 清空了，
  // 这里再去读就是 null（第一版就是这么写的，拖拽一直静默失败）。
  function applyDrop(drag) {
    const marker = dom.canvas.querySelector('.nai-flow-drop');
    if (!marker || !drag) return false;

    const nodes = topLevelNodes().filter((node) => node.dataset.flowItem !== drag.id);
    let index = nodes.length;
    for (let i = 0; i < nodes.length; i += 1) {
      if (marker.compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING) {
        index = i;
        break;
      }
    }

    pushHistory();
    return flowMoveItem(state.flow, drag.id, state.activeSegmentId, index);
  }

  // ───────────────────────── 权重拖拽 ─────────────────────────

  function liveWeightBadge(node, weight) {
    let badge = node.querySelector('.nai-flow-chip-weight, .nai-flow-group-weight');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = node.classList.contains('nai-flow-group') ? 'nai-flow-group-weight' : 'nai-flow-chip-weight';
      // 整句的徽章要挂在头部那一行，不能追加到正文后面
      (node.querySelector('.nai-flow-sentence-head') || node).appendChild(badge);
    }
    badge.textContent = flowFormatWeight(weight);
  }

  function onPointerDown(event) {
    const node = event.target.closest?.('[data-flow-item]');
    if (!node || !dom.canvas.contains(node)) return;

    const itemId = node.dataset.flowItem;

    if (event.button === 2) {
      const found = flowFindItem(state.flow, itemId);
      if (!found) return;
      event.preventDefault();
      const startWeight = found.item.weight ?? 1;
      state.weight = { id: itemId, node, startY: event.clientY, startWeight, current: startWeight };
      flowCapturePointer(dom.canvas, event.pointerId);
      node.classList.add('is-weighting');
      return;
    }

    if (event.button !== 0) return;

    const topNode = node.closest('.nai-flow-line > [data-flow-item]') || node;
    state.drag = {
      id: topNode.dataset.flowItem,
      innerId: itemId,
      node: topNode,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      modifier: event.ctrlKey || event.metaKey,
    };
    flowCapturePointer(dom.canvas, event.pointerId);
  }

  function onPointerMove(event) {
    if (state.weight) {
      const steps = Math.round((state.weight.startY - event.clientY) / FLOW_WEIGHT_PIXELS);
      const next = flowClampWeight(state.weight.startWeight + steps * FLOW_WEIGHT_STEP);
      if (next !== state.weight.current) {
        state.weight.current = next;
        liveWeightBadge(state.weight.node, next);
      }
      return;
    }

    if (!state.drag) return;
    const distance = Math.hypot(event.clientX - state.drag.startX, event.clientY - state.drag.startY);
    if (!state.drag.moved && distance < FLOW_DRAG_THRESHOLD) return;

    if (!state.drag.moved) {
      state.drag.moved = true;
      state.drag.node.classList.add('is-dragging');
      dom.root.classList.add('is-dragging');
    }
    updateDropMarker(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    if (state.weight) {
      const { id, node, current, startWeight } = state.weight;
      node.classList.remove('is-weighting');
      state.weight = null;
      if (current !== startWeight) {
        pushHistory();
        flowSetItemWeight(state.flow, id, current);
        commitChange();
      }
      return;
    }

    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    drag.node.classList.remove('is-dragging');
    dom.root.classList.remove('is-dragging');

    if (drag.moved) {
      const moved = applyDrop(drag);
      clearDropMarker();
      if (moved) commitChange();
      else render();
      return;
    }

    clearDropMarker();

    // 没拖动 = 点击
    if (event.target.closest?.('.nai-flow-chip-remove')) {
      pushHistory();
      flowRemoveItem(state.flow, drag.innerId);
      commitChange();
      return;
    }
    if (drag.modifier) {
      toggleSelection(drag.id);
      return;
    }
    beginEdit(drag.innerId);
  }

  function onWheel(event) {
    const node = event.target.closest?.('[data-flow-item]');
    if (!node || !dom.canvas.contains(node)) return;
    const found = flowFindItem(state.flow, node.dataset.flowItem);
    if (!found) return;

    event.preventDefault();
    pushHistory();
    const delta = event.deltaY < 0 ? FLOW_WEIGHT_STEP : -FLOW_WEIGHT_STEP;
    flowSetItemWeight(state.flow, found.item.id, flowClampWeight((found.item.weight ?? 1) + delta));
    commitChange();
  }

  // ───────────────────────── 工具动作 ─────────────────────────

  function sortActiveSegment() {
    const segment = activeSegment();
    // 只在行内归并 —— 跨行搬动会把 V5 的「tag 骨架 / 动作段 / 场景段」这套分层拆散
    const lines = flowGroupIntoLines(segment.items);
    const next = [];

    for (const line of lines) {
      const positions = [];
      const movable = [];
      line.items.forEach((item, index) => {
        if (item.kind === 'sentence') return;
        positions.push(index);
        movable.push(item);
      });

      movable.sort((a, b) => {
        const rank = (item) => {
          const name = item.kind === 'group' ? item.items[0]?.name : item.name;
          return FLOW_SORT_ORDER.indexOf(flowClassify(name, flowLookupTag(name)).semantic);
        };
        return (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b));
      });

      const rebuilt = line.items.slice();
      positions.forEach((position, order) => { rebuilt[position] = movable[order]; });

      rebuilt.forEach((item, index) => {
        item.newlineBefore = index === 0 && next.length > 0;
        item.blankBefore = index === 0 && next.length > 0 ? line.blankBefore : 0;
      });
      next.push(...rebuilt);
    }

    segment.items = next;
    flowNormalizeLineFlags(segment);
  }

  function handleAction(action, target) {
    if (action === 'segment') {
      state.activeSegmentId = target.dataset.id;
      state.selection.clear();
      render();
      return true;
    }
    if (action === 'add-segment') {
      pushHistory();
      const segment = flowAddSegment(state.flow);
      state.activeSegmentId = segment.id;
      commitChange();
      return true;
    }
    if (action === 'undo') {
      if (!state.history.length) return true;
      state.future.push(snapshot());
      restore(state.history.pop());
      commitChange();
      return true;
    }
    if (action === 'redo') {
      if (!state.future.length) return true;
      state.history.push(snapshot());
      restore(state.future.pop());
      commitChange();
      return true;
    }
    if (action === 'dedupe') {
      pushHistory();
      flowDedupe(state.flow);
      commitChange();
      return true;
    }
    if (action === 'sort') {
      pushHistory();
      sortActiveSegment();
      commitChange();
      return true;
    }
    if (action === 'clear') {
      pushHistory();
      activeSegment().items = [];
      state.selection.clear();
      commitChange();
      return true;
    }
    if (action === 'pick') {
      submitInput(target.dataset.tag);
      return true;
    }
    if (action === 'bulk-group') {
      pushHistory();
      flowGroupItems(state.flow, Array.from(state.selection), 1.1);
      state.selection.clear();
      commitChange();
      return true;
    }
    if (action === 'bulk-toggle-kind') {
      pushHistory();
      for (const id of state.selection) flowToggleItemKind(state.flow, id);
      state.selection.clear();
      commitChange();
      return true;
    }
    if (action === 'bulk-delete') {
      pushHistory();
      for (const id of state.selection) flowRemoveItem(state.flow, id);
      state.selection.clear();
      commitChange();
      return true;
    }
    if (action === 'bulk-move') {
      pushHistory();
      for (const id of state.selection) flowMoveItem(state.flow, id, target.dataset.id, Number.MAX_SAFE_INTEGER);
      state.selection.clear();
      commitChange();
      return true;
    }
    if (action === 'bulk-clear') {
      state.selection.clear();
      render();
      return true;
    }
    return false;
  }

  bind(host, 'click', (event) => {
    const target = event.target.closest?.('[data-flow-action]');
    if (!target || !host.contains(target)) return;
    event.preventDefault();
    const action = target.dataset.flowAction;
    if (handleAction(action, target)) return;
    options.onAction?.(action, { text: flowSerialize(state.flow), baseText: flowSerializeBaseOnly(state.flow) });
  });

  bind(dom.canvas, 'pointerdown', onPointerDown);
  bind(dom.canvas, 'pointermove', onPointerMove);
  bind(dom.canvas, 'pointerup', onPointerUp);
  bind(dom.canvas, 'pointercancel', () => {
    state.drag = null;
    state.weight = null;
    clearDropMarker();
    render();
  });
  bind(dom.canvas, 'contextmenu', (event) => {
    if (event.target.closest?.('[data-flow-item]')) event.preventDefault();
  });
  bind(dom.canvas, 'wheel', onWheel, { passive: false });

  bind(dom.add, 'input', scheduleSuggestions);
  bind(dom.add, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitInput();
    } else if (event.key === 'Escape' && state.editingId) {
      event.preventDefault();
      cancelEdit();
    }
  });

  bind(host, 'keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      handleAction(event.shiftKey ? 'redo' : 'undo');
    } else if (key === 'y') {
      event.preventDefault();
      handleAction('redo');
    }
  });

  const api = {
    host,
    setText(text, { reset = true } = {}) {
      if (!reset) pushHistory();
      state.flow = flowParse(text);
      state.activeSegmentId = state.flow.segments[0]?.id || '';
      state.selection.clear();
      state.editingId = '';
      if (reset) {
        state.history.length = 0;
        state.future.length = 0;
      }
      cancelEdit();
      render();
    },
    appendText(text) {
      pushHistory();
      const segment = activeSegment();
      const parsed = flowParse(text).segments[0]?.items || [];
      parsed.forEach((item, index) => { if (index === 0) item.newlineBefore = false; });
      segment.items.push(...parsed);
      flowNormalizeLineFlags(segment);
      commitChange();
    },
    getText() {
      return flowSerialize(state.flow);
    },
    getBaseText() {
      return flowSerializeBaseOnly(state.flow);
    },
    isEmpty() {
      return !flowSerialize(state.flow).trim();
    },
    refresh: render,
    async ensureDictionary() {
      await flowLoadDictionary();
      render();
    },
    destroy() {
      listeners.forEach((off) => off());
      listeners.length = 0;
      clearTimeout(state.suggestTimer);
      host.innerHTML = '';
    },
  };

  render();
  return api;
}
