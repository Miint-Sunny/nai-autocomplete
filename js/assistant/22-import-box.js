// 共用的导入盒子。预设（酒馆 preset JSON）和 skill（带 frontmatter 的 markdown）
// 用的是同一套结构、同一套样式、同一条路径：
//
//   选文件 ──┐
//            ├─→ 可编辑的文本域 ─→ 实时说清楚会得到什么 ─→ 按「导入」才落库
//   直接粘 ──┘
//
// 以前两处各长各的：预设那边一颗按钮直接弹系统文件框、选完立刻落库；skill 那边
// 是另一颗按钮加另一套多选逻辑。都没有「导入前看一眼」，也没法直接粘一段进来。

// ── 本地文件选择 ────────────────────────────────────────────────
//
// 优先走 File System Access：它认 `id`，同一个 id 的选择框**下次会开在上次那个目录**，
// 这是 <input type="file"> 给不了的（那个只有浏览器全局的「上次位置」，所有文件框共用）。
// 非安全上下文、被页面权限策略禁用、或者用户的 Chrome 不支持时回退到 input。

function pickFilesViaInput({ accept, multiple }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = Boolean(multiple);
    input.style.display = 'none';

    const finish = (files) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish(Array.from(input.files || [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function pickLocalFiles({ pickerId, accept, types, multiple, startIn }) {
  if (window.isSecureContext && typeof window.showOpenFilePicker === 'function') {
    try {
      const options = { id: pickerId, multiple: Boolean(multiple) };
      if (types?.length) options.types = types;
      if (startIn) options.startIn = startIn;
      const handles = await window.showOpenFilePicker(options);
      return await Promise.all(handles.map((handle) => handle.getFile()));
    } catch (error) {
      // 用户自己取消的就是取消，不要再弹一次别的框
      if (error?.name === 'AbortError') return [];
      // 其余（SecurityError / NotAllowedError / 这个环境压根没有）落回 input
    }
  }

  return pickFilesViaInput({ accept, multiple });
}

// ── 两种导入各自的口径 ──────────────────────────────────────────

const IMPORT_BOX_KINDS = {
  preset: {
    pickLabel: '选择 JSON 文件',
    accept: 'application/json,.json',
    types: [{ description: '酒馆预设', accept: { 'application/json': ['.json'] } }],
    multiple: false,
    pickerId: 'nai-import-preset',
    hint: '酒馆（SillyTavern）导出的 preset JSON。按 prompt_order 里的全局顺序还原成消息块，'
      + '聊天记录、世界书这类没有正文的占位符会跳过。',
    placeholder: '把 preset JSON 粘到这里，或者点上面的按钮选文件。\n导进来之前可以直接在这儿改。',
    describe: (text) => describeStPresetImport(text),
    commit: (text) => commitStPresetImport(text),
  },
  skill: {
    pickLabel: '选择 .md 文件',
    accept: '.md,.markdown,.txt,text/markdown,text/plain',
    types: [{ description: 'skill', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] } }],
    multiple: true,
    pickerId: 'nai-import-skill',
    hint: '带 YAML frontmatter 的 markdown。可以多选：带 name 的那份当正文，其余当参考资料；'
      + '多份会拼在下面，用 <!-- nai-file: 名字 --> 分隔。',
    placeholder: '把 skill 正文粘到这里，或者点上面的按钮选文件。\n导进来之前可以直接在这儿改。',
    describe: (text) => describeAgentSkillImport(text),
    commit: (text) => commitAgentSkillImport(text),
  },
};

function importBoxMarkup(kind) {
  const config = IMPORT_BOX_KINDS[kind];
  if (!config) return '';

  return `
    <div class="nai-import-box nai-hidden" data-import-box="${kind}">
      <div class="nai-import-box-hint">${escapeHtml(config.hint)}</div>
      <div class="nai-import-box-actions">
        <button type="button" class="nai-md3-inline-action" data-import-action="pick">${escapeHtml(config.pickLabel)}</button>
        <span class="nai-import-box-source" data-import-field="source"></span>
      </div>
      <textarea class="nai-md3-input nai-import-box-text" data-import-field="text" rows="6" spellcheck="false" placeholder="${escapeHtml(config.placeholder)}"></textarea>
      <div class="nai-import-box-status" data-import-field="status"></div>
      <div class="nai-md3-actions nai-import-box-actions">
        <button type="button" class="nai-md3-primary" data-import-action="commit">导入</button>
        <button type="button" data-import-action="clear">清空</button>
        <button type="button" data-import-action="close">收起</button>
      </div>
    </div>`;
}

function importBoxParts(box) {
  return {
    kind: box?.dataset?.importBox || '',
    config: IMPORT_BOX_KINDS[box?.dataset?.importBox || ''],
    text: box?.querySelector('[data-import-field="text"]'),
    status: box?.querySelector('[data-import-field="status"]'),
    source: box?.querySelector('[data-import-field="source"]'),
  };
}

// 每敲一个字就重算一遍「会得到什么」。解析不动数据，重算随便跑。
function refreshImportBoxPreview(box) {
  const { config, text, status } = importBoxParts(box);
  if (!config || !text || !status) return;

  const value = text.value;
  if (!value.trim()) {
    status.textContent = '还没有内容。';
    status.classList.remove('is-error', 'is-ok');
    return;
  }

  const result = config.describe(value);
  status.textContent = result.summary || '';
  status.classList.toggle('is-error', !result.ok);
  status.classList.toggle('is-ok', Boolean(result.ok));
}

function setImportBoxOpen(box, open) {
  if (!box) return;
  box.classList.toggle('nai-hidden', !open);
  if (!open) return;

  refreshImportBoxPreview(box);
  const { text } = importBoxParts(box);
  text?.focus();
}

// 同一种导入在面板和工作台各有一份 DOM。点哪份就开哪份，别去动另一份。
function toggleImportBox(trigger, kind) {
  const scope = trigger?.closest('.nai-md3-panel, .nai-library-drawer, .nai-md3-root') || ui.root;
  const box = scope?.querySelector(`[data-import-box="${kind}"]`);
  if (!box) return;
  setImportBoxOpen(box, box.classList.contains('nai-hidden'));
}

async function handleImportBoxPick(box) {
  const { config, text, source } = importBoxParts(box);
  if (!config || !text) return;

  const files = await pickLocalFiles({
    pickerId: config.pickerId,
    accept: config.accept,
    types: config.types,
    multiple: config.multiple,
  });
  if (!files.length) return;

  try {
    const items = [];
    for (const file of files) {
      items.push({ name: file.name, text: await readFileText(file) });
    }

    // 文件内容落进文本域而不是直接落库 —— 这一步就是「导入之后允许展开编辑」
    text.value = config.multiple ? joinSkillFileTexts(items) : String(items[0]?.text || '');
    if (source) source.textContent = `已读入 ${files.map((file) => file.name).join('、')}`;
    refreshImportBoxPreview(box);
  } catch (error) {
    setStatus(`读取文件失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function handleImportBoxCommit(box) {
  const { config, text } = importBoxParts(box);
  if (!config || !text) return;

  const value = text.value.trim();
  if (!value) {
    setStatus('先选个文件或者粘一段内容进来。', true);
    return;
  }

  try {
    const message = await config.commit(value);
    setStatus(message || '导入完成。', false);
    text.value = '';
    const { source } = importBoxParts(box);
    if (source) source.textContent = '';
    setImportBoxOpen(box, false);
  } catch (error) {
    setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function bindImportBoxes(root) {
  if (!root) return;

  root.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-import-open]');
    if (trigger) {
      event.preventDefault();
      toggleImportBox(trigger, trigger.dataset.importOpen);
      return;
    }

    const actionTarget = event.target?.closest?.('[data-import-action]');
    const box = actionTarget?.closest?.('[data-import-box]');
    if (!actionTarget || !box) return;

    event.preventDefault();
    const action = actionTarget.dataset.importAction;

    if (action === 'pick') handleImportBoxPick(box);
    else if (action === 'commit') handleImportBoxCommit(box);
    else if (action === 'close') setImportBoxOpen(box, false);
    else if (action === 'clear') {
      const { text, source } = importBoxParts(box);
      if (text) text.value = '';
      if (source) source.textContent = '';
      refreshImportBoxPreview(box);
      text?.focus();
    }
  });

  root.addEventListener('input', (event) => {
    const text = event.target?.closest?.('[data-import-field="text"]');
    const box = text?.closest?.('[data-import-box]');
    if (box) refreshImportBoxPreview(box);
  });
}
