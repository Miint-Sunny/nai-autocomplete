// 流编辑器在面板与工作台抽屉里的落地。组件本身在 js/flow/（content 脚本也用同一份）。
//
// 反推、写词、画师库产出的提示词都能送进来改，改完一次性写回网站输入框。

const FLOW_PAGE_ACTIONS = [
  { id: 'write', label: '写入输入框', primary: true },
  { id: 'append', label: '追加到输入框' },
  { id: 'read', label: '读取输入框' },
  { id: 'copy', label: '复制' },
  { id: 'copy-base', label: '复制无角色' },
];

function flowHostMarkup() {
  return '<div class="nai-flow-host" data-flow-host="1"></div>';
}

function readPromptFieldText() {
  const field = findArtistQuickPromptField();
  if (!field) return null;
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') return String(field.value || '');
  return String(field.innerText || field.textContent || '');
}

async function handleFlowAction(action, payload) {
  const text = String(payload?.text || '').trim();

  if (action === 'write' || action === 'append') {
    if (!text) {
      setStatus(T.statusFlowEmpty, true);
      return;
    }
    await writePromptFieldValue(text, action === 'write' ? 'replace' : 'append');
    return;
  }

  if (action === 'read') {
    const current = readPromptFieldText();
    if (current === null) {
      setStatus(T.statusFlowNoField, true);
      return;
    }
    if (!current.trim()) {
      setStatus(T.statusFlowSourceEmpty, true);
      return;
    }
    loadFlowText(current, { focus: false });
    setStatus(T.statusFlowLoaded, false);
    return;
  }

  if (action === 'copy' || action === 'copy-base') {
    const value = action === 'copy-base' ? String(payload?.baseText || '').trim() : text;
    if (!value) {
      setStatus(T.statusFlowEmpty, true);
      return;
    }
    const copied = await copyText(value);
    setStatus(copied ? T.statusCopied : T.statusCopyFailed, !copied);
  }
}

function createFlowEditorFor(host) {
  return flowCreateEditor({
    host,
    actions: FLOW_PAGE_ACTIONS,
    emptyHint: T.flowEmptyHint,
    onAction: handleFlowAction,
    onChange: (text) => {
      state.flow.text = text;
    },
  });
}

function initFlowPage(root) {
  state.flow.editors = Array.from(root.querySelectorAll('[data-flow-host]')).map(createFlowEditorFor);
}

// 面板和抽屉各有一个实例，但同一时刻只会看见一个（图片页用抽屉、其余用面板）。
// 所以不做实时双向同步，只在打开某一侧时把最新文本推过去 —— 免得来回 setText 把撤销栈冲掉。
function openFlowSurface(where) {
  const editor = (state.flow.editors || []).find((item) => {
    const inDrawer = Boolean(item.host.closest('.nai-library-drawer'));
    return where === 'drawer' ? inDrawer : !inDrawer;
  });
  if (!editor) return;
  if (editor.getText() !== state.flow.text) editor.setText(state.flow.text);
  editor.ensureDictionary();
}

function loadFlowText(text, { focus = true } = {}) {
  state.flow.text = String(text || '');
  state.flow.editors?.forEach((editor) => editor.setText(state.flow.text));
  if (!focus) return;
  if (state.isNovelAIImagePage) openFlowWorkbenchPanel();
  else setPage('flow');
}

// 反推结果 / Agent 结果 / 画师库都走这个口子进来
function sendToFlowEditor(text) {
  const value = String(text || '').trim();
  if (!value) {
    setStatus(T.statusFlowEmpty, true);
    return;
  }
  loadFlowText(value);
  setStatus(T.statusFlowReceived, false);
}
