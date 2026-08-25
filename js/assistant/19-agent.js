// 提示词 Agent 的界面：一条对话流。面板页和工作台抽屉共用同一份 markup，
// 状态放在 state.agent 里，渲染时推给所有 host（和画师库快捷面板同一套路）。
//
// 这里只负责「写提示词」：结果不自动填入，全部由每块卡片上的按钮写进输入框。
// 不做任何触发生成的动作。

// 四档生成方式。前端只管标签和提示，发出去的任务说明在后台的 AGENT_MODES 里 ——
// 一句话两处写会立刻不一致。hint 按「提示词格式」分 V5 / V4.5 两套。
const AGENT_MODE_OPTIONS = [
  { id: 'default', label: T.agentModeDefault, hint: T.agentModeHintDefault, hintV45: T.agentModeHintDefaultV45 },
  { id: 'expanded', label: T.agentModeExpanded, hint: T.agentModeHintExpanded, hintV45: T.agentModeHintExpandedV45 },
  { id: 'refine', label: T.agentModeRefine, hint: T.agentModeHintRefine, hintV45: T.agentModeHintRefineV45 },
  { id: 'tags', label: T.agentModeTags, hint: T.agentModeHintTags, hintV45: T.agentModeHintTagsV45 },
];

// 0 = 自动（不限定）。1~6 是快捷填入栏位的数量，不是 NovelAI 的模型上限。
const AGENT_CHARACTER_COUNTS = [0, 1, 2, 3, 4, 5, 6];

// 词库角色整份发给后台再筛，不是发给模型 —— 这个上限只是别把消息撑爆。
const AGENT_CHARACTER_SOURCE_LIMIT = 120;

// 对话保留的条数（一问一答算两条）。发给模型的裁剪在后台另有一套更紧的口径。
const AGENT_CONVERSATION_LIMIT = 24;

function agentMarkup() {
  return `
    <div class="nai-agent">
      <div class="nai-agent-bar">
        <select class="nai-md3-input nai-agent-skill" data-agent-field="skill" aria-label="${T.agentSkillLabel}"></select>
        <button type="button" class="nai-md3-inline-action nai-agent-manage" data-agent-action="manage">${T.agentManage}</button>
      </div>

      <div class="nai-agent-manager nai-hidden" data-agent-field="manager">
        <div class="nai-agent-skill-meta" data-agent-field="skillMeta"></div>
        <div class="nai-agent-manager-actions">
          <button type="button" class="nai-md3-inline-action" data-agent-action="import">${T.agentImport}</button>
          <button type="button" class="nai-md3-inline-action" data-agent-action="edit">${T.agentEdit}</button>
          <button type="button" class="nai-md3-inline-action" data-agent-action="export">${T.agentExport}</button>
          <button type="button" class="nai-md3-inline-action" data-agent-action="delete">${T.agentDelete}</button>
        </div>
        <div class="nai-agent-editor nai-hidden" data-agent-field="editor">
          <textarea class="nai-md3-input nai-agent-editor-text" data-agent-field="editorText" rows="10" spellcheck="false"></textarea>
          <div class="nai-agent-manager-actions">
            <button type="button" class="nai-md3-inline-action" data-agent-action="save-skill">${T.agentSave}</button>
            <button type="button" class="nai-md3-inline-action" data-agent-action="cancel-edit">${T.agentCancelEdit}</button>
          </div>
          <div class="nai-agent-note">${T.agentBuiltinNote}</div>
        </div>
      </div>

      <div class="nai-agent-row">
        <span class="nai-agent-row-label">${T.agentModeLabel}</span>
        <nav class="nai-md3-tabs nai-agent-track nai-agent-modes" aria-label="${T.agentModeLabel}">
          ${AGENT_MODE_OPTIONS.map((option) => `<button type="button" data-agent-action="mode" data-mode="${option.id}">${option.label}</button>`).join('')}
        </nav>
      </div>
      <div class="nai-agent-note nai-agent-mode-hint" data-agent-field="modeHint"></div>

      <div class="nai-agent-row">
        <span class="nai-agent-row-label">${T.agentCountLabel}</span>
        <div class="nai-md3-tabs nai-agent-track nai-agent-counts-track" role="group" aria-label="${T.agentCountLabel}">
          ${AGENT_CHARACTER_COUNTS.map((count) => `<button type="button" data-agent-action="count" data-count="${count}">${count === 0 ? T.agentCountAuto : count}</button>`).join('')}
        </div>
      </div>

      <div class="nai-agent-row nai-agent-sources">
        <span class="nai-agent-row-label">${T.agentSourcesLabel}</span>
        <div class="nai-agent-row-controls">
          <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="currentPrompt">${T.agentSourceCurrentPrompt}</button>
          <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="characters">${T.agentSourceCharacters}</button>
          <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="artists">${T.agentSourceArtists}</button>
        </div>
      </div>
      <div class="nai-agent-note nai-agent-sources-hint">${T.agentSourcesHint}</div>

      <div class="nai-agent-thread" data-agent-field="thread"></div>

      <div class="nai-agent-composer">
        <textarea class="nai-md3-input nai-agent-input" data-agent-field="request" rows="2" placeholder="${T.agentRequestPlaceholder}"></textarea>
        <div class="nai-md3-actions nai-agent-composer-actions">
          <button type="button" class="nai-md3-primary nai-agent-send" data-agent-action="run">${T.agentRun}</button>
          <button type="button" class="nai-agent-clear" data-agent-action="clear">${T.agentClear}</button>
        </div>
      </div>
    </div>`;
}

function activeAgentMode() {
  return AGENT_MODE_OPTIONS.find((option) => option.id === state.agent.mode) || AGENT_MODE_OPTIONS[0];
}

function agentModeHint(option) {
  return state.settings.naiDialect === 'v45' ? (option.hintV45 || option.hint) : option.hint;
}

function agentConversationHasAssistant() {
  return state.agent.conversation.some((entry) => entry.role === 'assistant');
}

// 改写档改的是「已经存在的那份提示词」。对话里已有上一轮版本时不用管；
// 对话是空的且「当前提示词」也没勾，就顺手勾上并说一声 —— 自动勾是看得见的，
// 那颗 chip 会亮起来。
function setAgentMode(mode) {
  state.agent.mode = AGENT_MODE_OPTIONS.some((option) => option.id === mode) ? mode : 'default';

  if (state.agent.mode === 'refine' && !state.agent.sources.currentPrompt && !agentConversationHasAssistant()) {
    state.agent.sources.currentPrompt = true;
    setStatus(T.statusAgentRefineNeedsPrompt, false);
  }

  renderAgentPanel();
}

function agentHosts() {
  return (ui.agent?.hosts || []).filter((host) => host?.isConnected);
}

// 模型按 skill 的输出规范给的是 markdown：主提示词一个代码框，角色栏一个。
// 把代码框抽出来单独给按钮，用户就不用手动去框里选文字了。
function extractAgentBlocks(text) {
  const blocks = [];
  const pattern = /```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g;
  let match = pattern.exec(String(text || ''));

  while (match) {
    const content = match[1].trim();
    if (content) blocks.push(content);
    match = pattern.exec(String(text || ''));
  }

  return blocks;
}

// 回复整理成对话条目：代码框抽成卡片、其余散文单独放。
// 模型没按格式给代码框时，整段回复就当唯一一块 —— 填入/复制永远有的按。
function agentAssistantEntry(text, meta) {
  const raw = String(text || '');
  const fenced = extractAgentBlocks(raw);
  const blocks = fenced.length ? fenced : [raw.trim()].filter(Boolean);
  const prose = fenced.length
    ? raw.replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()
    : '';
  return { role: 'assistant', text: raw, prose, blocks, meta: String(meta || '') };
}

function trimAgentConversation() {
  if (state.agent.conversation.length > AGENT_CONVERSATION_LIMIT) {
    state.agent.conversation = state.agent.conversation.slice(-AGENT_CONVERSATION_LIMIT);
  }
}

function normalizeAgentConversation(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && String(entry.text || '').trim())
    .slice(-AGENT_CONVERSATION_LIMIT)
    .map((entry) => (entry.role === 'assistant'
      ? agentAssistantEntry(entry.text, typeof entry.meta === 'string' ? entry.meta : '')
      : { role: 'user', text: String(entry.text) }));
}

async function loadAgentConversation() {
  const data = await storageGet([AGENT_CONVERSATION_KEY]);
  state.agent.conversation = normalizeAgentConversation(data[AGENT_CONVERSATION_KEY]);
}

// 只存 role/text/meta，blocks 和散文加载时重新算 —— 存派生值只会两处不一致
function saveAgentConversation() {
  const compact = state.agent.conversation.map((entry) => (entry.role === 'assistant'
    ? { role: 'assistant', text: entry.text, meta: entry.meta || '' }
    : { role: 'user', text: entry.text }));
  // 存不进去就算了（扩展上下文失效等），别让一次写作因为持久化炸掉
  storageSet({ [AGENT_CONVERSATION_KEY]: compact }).catch(() => {});
}

function agentBlockLabel(index) {
  if (index === 0) return T.agentBlockMain;
  if (index === 1) return T.agentBlockCharacter;
  return `${T.agentBlockOther} ${index + 1}`;
}

function agentBlockMarkup(turnIndex, block, blockIndex) {
  const ref = `data-turn="${turnIndex}" data-index="${blockIndex}"`;
  // 填入在前、复制在后；只填输入框，不碰「生成」—— 触发出图那条红线在这儿也算数
  const actions = blockIndex === 0
    ? `
      <button type="button" class="nai-md3-inline-action" data-agent-action="write-block" ${ref}>${T.agentWrite}</button>
      <button type="button" class="nai-md3-inline-action" data-agent-action="append-block" ${ref}>${T.agentAppend}</button>
      <button type="button" class="nai-md3-inline-action" data-agent-action="flow-block" ${ref}>${T.tabFlow}</button>
      <button type="button" class="nai-md3-inline-action" data-agent-action="copy-block" ${ref}>${T.agentCopy}</button>`
    : `
      <button type="button" class="nai-md3-inline-action" data-agent-action="fill-character" ${ref}>${T.agentFillCharacter} ${blockIndex}</button>
      <button type="button" class="nai-md3-inline-action" data-agent-action="copy-block" ${ref}>${T.agentCopy}</button>`;

  return `
    <article class="nai-agent-block">
      <div class="nai-agent-block-head">
        <span class="nai-agent-block-title">${agentBlockLabel(blockIndex)}</span>
        <div class="nai-agent-block-actions">${actions}</div>
      </div>
      <pre class="nai-agent-block-body">${escapeHtml(block)}</pre>
    </article>`;
}

function agentTurnMarkup(entry, turnIndex) {
  if (entry.role === 'user') {
    return `
      <div class="nai-agent-msg is-user">
        <div class="nai-agent-msg-text">${escapeHtml(entry.text)}</div>
      </div>`;
  }

  const blocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  const fillAll = blocks.length > 1
    ? `<div class="nai-agent-msg-actions"><button type="button" class="nai-md3-inline-action" data-agent-action="fill-all" data-turn="${turnIndex}">${T.agentFillAll}</button></div>`
    : '';

  return `
    <div class="nai-agent-msg is-assistant">
      ${entry.prose ? `<div class="nai-agent-msg-text">${escapeHtml(entry.prose)}</div>` : ''}
      ${blocks.map((block, blockIndex) => agentBlockMarkup(turnIndex, block, blockIndex)).join('')}
      ${fillAll}
      ${entry.meta ? `<div class="nai-agent-msg-meta">${escapeHtml(entry.meta)}</div>` : ''}
    </div>`;
}

function agentThreadMarkup() {
  const running = state.pending && state.pendingScope === 'agent';
  const turns = state.agent.conversation.map((entry, turnIndex) => agentTurnMarkup(entry, turnIndex)).join('');
  const pending = running ? `<div class="nai-agent-msg is-assistant"><div class="nai-agent-msg-text nai-agent-msg-pending">${T.statusAgentRunning}</div></div>` : '';

  if (!turns && !pending) {
    return `<div class="nai-agent-thread-empty">${T.agentThreadEmpty}</div>`;
  }
  return turns + pending;
}

function agentScrollThreadToEnd() {
  agentHosts().forEach((host) => {
    const thread = host.querySelector('[data-agent-field="thread"]');
    thread?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  });
}

function agentSkillMetaMarkup() {
  const skill = getActiveAgentSkill();
  const references = skill.references?.length
    ? `${T.agentSkillRefs}${skill.references.map((reference) => escapeHtml(reference.name)).join('、')}`
    : T.agentNoSkillRefs;

  return `
    <div class="nai-agent-skill-name">${escapeHtml(skill.name)}${skill.builtin ? ` · ${T.agentBuiltinBadge}` : ''}</div>
    ${skill.description ? `<div class="nai-agent-skill-desc">${escapeHtml(skill.description)}</div>` : ''}
    <div class="nai-agent-skill-refs">${references} · ${skill.body.length} 字</div>`;
}

function renderAgentPanel() {
  const hosts = agentHosts();
  if (!hosts.length) return;

  const active = getActiveAgentSkill();
  const options = agentSkillList()
    .map((skill) => `<option value="${escapeHtml(skill.id)}"${skill.id === active.id ? ' selected' : ''}>${escapeHtml(skill.name)}</option>`)
    .join('');
  const threadHtml = agentThreadMarkup();
  const skillMetaHtml = agentSkillMetaMarkup();
  const editing = typeof state.agent.editing === 'string';

  hosts.forEach((host) => {
    const skillSelect = host.querySelector('[data-agent-field="skill"]');
    if (skillSelect) {
      skillSelect.innerHTML = options;
      skillSelect.value = active.id;
    }

    host.querySelector('[data-agent-field="manager"]')?.classList.toggle('nai-hidden', !state.agent.managerOpen);
    const skillMeta = host.querySelector('[data-agent-field="skillMeta"]');
    if (skillMeta) skillMeta.innerHTML = skillMetaHtml;

    host.querySelector('[data-agent-field="editor"]')?.classList.toggle('nai-hidden', !editing);
    const editorText = host.querySelector('[data-agent-field="editorText"]');
    if (editorText && editing && editorText.value !== state.agent.editing) editorText.value = state.agent.editing;

    host.querySelectorAll('[data-agent-action="source"]').forEach((button) => {
      button.classList.toggle('is-active', Boolean(state.agent.sources[button.dataset.source]));
    });

    host.querySelectorAll('[data-agent-action="mode"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === state.agent.mode);
    });

    host.querySelectorAll('[data-agent-action="count"]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.count) === state.agent.characterCount);
    });

    const modeHint = host.querySelector('[data-agent-field="modeHint"]');
    if (modeHint) modeHint.textContent = agentModeHint(activeAgentMode());

    const request = host.querySelector('[data-agent-field="request"]');
    if (request && request.value !== state.agent.request) request.value = state.agent.request;

    const thread = host.querySelector('[data-agent-field="thread"]');
    if (thread) thread.innerHTML = threadHtml;

    const deleteButton = host.querySelector('[data-agent-action="delete"]');
    if (deleteButton) deleteButton.disabled = active.builtin;
  });

  renderAgentRunState();
}

// 面板里同一时间只跑一个任务。Agent 在跑时反推按钮只置灰、不改文案，
// 反过来也一样 —— 否则两个按钮会互相抢文案。
function renderAgentRunState() {
  const running = state.pending && state.pendingScope === 'agent';

  agentHosts().forEach((host) => {
    const runButton = host.querySelector('[data-agent-action="run"]');
    if (!runButton) return;
    runButton.disabled = state.pending && !running;
    runButton.textContent = running ? T.cancelRun : T.agentRun;
  });
}

function readAgentInputs(host) {
  state.agent.request = host.querySelector('[data-agent-field="request"]')?.value ?? state.agent.request;
}

function describeAgentRun(response) {
  const parts = [`skill：${getActiveAgentSkill().name}`, activeAgentMode().label];
  // 截断放在最前面 —— meta 行很长，挂在末尾会被读漏
  if (response.truncated) parts.unshift(T.agentMetaTruncated);
  if (state.agent.characterCount) parts.push(`${state.agent.characterCount} 个角色栏`);
  if (response.prefiltered?.length) parts.push(`预检 ${response.prefiltered.length} 个 tag`);
  const queries = (response.toolSteps || []).reduce((total, step) => total + (step.queries?.length || 0), 0);
  if (queries) parts.push(`查证 ${queries} 个词`);
  const used = Object.entries(state.agent.sources).filter(([, on]) => on).length;
  if (used) parts.push(`${used} 个知识源`);
  if (response.usedModel) parts.push(response.usedModel + (response.usedFallback ? '（备用）' : ''));
  if (response.usage?.totalTokens) parts.push(`${response.usage.totalTokens} tokens`);
  if (response.durationMs) parts.push(`${(response.durationMs / 1000).toFixed(1)}s`);
  return parts.join(' · ');
}

// 只收集勾上的那几项 —— 没勾的一个字都不发出去。
// 上一轮结果不在这里：对话历史整体发给后台，模型直接看见。
async function collectAgentContext() {
  const sources = state.agent.sources;
  const context = {};

  if (sources.currentPrompt) {
    const current = readPromptFieldText();
    if (current?.trim()) context.currentPrompt = current.trim();
  }

  if (sources.characters) {
    // 这里不按条数截断：点名匹配在后台做，先截断会把用户正好点到的那个截掉。
    // 后台匹配不到名字时才退回列表，那一步自己有上限。
    context.characters = state.promptLibrary
      .filter((entry) => entry.category === ROLE_LIBRARY_CATEGORY)
      .slice(0, AGENT_CHARACTER_SOURCE_LIMIT)
      .map((entry) => ({
        name: entry.name || entry.alias,
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
        prompt: entry.promptText,
      }))
      .filter((entry) => entry.name && entry.prompt);
  }

  if (sources.artists) {
    try {
      await ensureArtistQuickLibrary();
      const content = artistQuickPageContent();
      context.artists = (content.artists || [])
        .slice()
        .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
        .map((artist) => ({ tag: artist.tag, name: artist.name, rating: Number(artist.rating) || 0 }))
        .filter((artist) => artist.tag);
    } catch (error) {
      // 画师库读不出来就当没勾，别把整轮写作卡住
    }
  }

  return context;
}

async function runAgentWrite() {
  if (state.pending) return;

  const request = String(state.agent.request || '').trim();
  if (!request) {
    setStatus(T.statusAgentNeedRequest, true);
    return;
  }

  const primaryConfig = buildPrimaryConfig([]);
  if (!hasCompleteModelConfig(primaryConfig)) {
    setStatus('请先完整配置主模型的服务商、Endpoint、Model 和 API Key。', true);
    openSettingsSurface();
    return;
  }

  let fallbackConfig = null;
  if (state.settings.enableFallbackModel) {
    const candidate = buildFallbackConfig([]);
    if (hasCompleteModelConfig(candidate)) fallbackConfig = candidate;
  }

  const skill = getActiveAgentSkill();
  const context = await collectAgentContext();
  // 历史先取快照再 push 本轮，发出去的正好是「这句话之前」的对话
  const history = state.agent.conversation.map((entry) => ({ role: entry.role, text: entry.text }));
  const runId = createId('agent-run');

  setPending(true, T.agentRun, { runId, scope: 'agent' });
  setStatus(T.statusAgentRunning, false);
  state.agent.conversation.push({ role: 'user', text: request });
  trimAgentConversation();
  renderAgentPanel();
  agentScrollThreadToEnd();

  // 失败或取消时把刚 push 的这句撤回来 —— 草稿还留在输入框里，改改再发
  const revertUserTurn = () => {
    const last = state.agent.conversation[state.agent.conversation.length - 1];
    if (last?.role === 'user' && last.text === request) state.agent.conversation.pop();
  };

  try {
    const response = await sendRuntimeMessage({
      type: 'nai-agent-run',
      runId,
      payload: {
        skill: { name: skill.name, body: skill.body, references: skill.references },
        request,
        mode: state.agent.mode,
        characterCount: state.agent.characterCount,
        context,
        history,
        dialect: state.settings.naiDialect === 'v45' ? 'v45' : 'v5',
        attachRules: state.settings.agentNai5Rules !== false,
        primary: primaryConfig,
        fallback: fallbackConfig,
        allowDanbooruLookup: state.settings.allowDanbooruLookup !== false,
      },
    });

    if (response?.errorKind === 'aborted') {
      revertUserTurn();
      setStatus(T.statusAgentCancelled, false);
      return;
    }

    if (!response?.ok) throw new Error(response?.error || '写提示词失败');

    state.agent.request = '';
    state.agent.conversation.push(agentAssistantEntry(response.text, describeAgentRun(response)));
    trimAgentConversation();
    saveAgentConversation();
    setStatus(response.truncated ? T.statusAgentTruncated : T.statusAgentDone, Boolean(response.truncated));
  } catch (error) {
    revertUserTurn();
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setPending(false);
    renderAgentPanel();
    agentScrollThreadToEnd();
    requestAnimationFrame(() => autoResizeAllTextareas());
  }
}

function clearAgentConversation() {
  state.agent.conversation = [];
  state.agent.request = '';
  saveAgentConversation();
  renderAgentPanel();
  requestAnimationFrame(() => autoResizeAllTextareas());
}

async function handleAgentAction(action, target, host) {
  if (action === 'manage') {
    state.agent.managerOpen = !state.agent.managerOpen;
    if (!state.agent.managerOpen) state.agent.editing = null;
    renderAgentPanel();
    return;
  }

  if (action === 'source') {
    const key = target.dataset.source;
    state.agent.sources[key] = !state.agent.sources[key];
    renderAgentPanel();
    return;
  }

  if (action === 'mode') {
    setAgentMode(target.dataset.mode);
    return;
  }

  if (action === 'count') {
    const count = Number(target.dataset.count) || 0;
    state.agent.characterCount = AGENT_CHARACTER_COUNTS.includes(count) ? count : 0;
    renderAgentPanel();
    return;
  }

  if (action === 'run') {
    readAgentInputs(host);
    if (state.pending && state.pendingScope === 'agent') await cancelCurrentRun();
    else await runAgentWrite();
    return;
  }

  if (action === 'clear') {
    clearAgentConversation();
    return;
  }

  if (action === 'import') {
    ui.agent?.fileInput?.click();
    return;
  }

  if (action === 'export') {
    exportActiveAgentSkill();
    return;
  }

  if (action === 'edit') {
    state.agent.editing = getActiveAgentSkill().body;
    state.agent.managerOpen = true;
    renderAgentPanel();
    return;
  }

  if (action === 'save-skill') {
    const text = host.querySelector('[data-agent-field="editorText"]')?.value || '';
    await saveActiveAgentSkillBody(text);
    return;
  }

  if (action === 'cancel-edit') {
    state.agent.editing = null;
    renderAgentPanel();
    return;
  }

  if (action === 'delete') {
    await deleteActiveAgentSkill();
    return;
  }

  // 往下都是对话里某条回复上的动作，先定位到那一轮
  const turn = state.agent.conversation[Number(target.dataset.turn)];
  const blocks = Array.isArray(turn?.blocks) ? turn.blocks : [];

  if (action === 'fill-all') {
    if (!blocks.length) return;
    await writePromptFieldValue(blocks[0], 'replace');
    if (blocks.length > 1) {
      await runAgentCharacterFill(blocks.slice(1).map((prompt, offset) => ({ slot: offset + 1, prompt })));
    }
    return;
  }

  const index = Number(target.dataset.index);
  const block = blocks[index];
  if (!block) return;

  if (action === 'copy-block') {
    const copied = await copyText(block);
    setStatus(copied ? T.statusCopied : T.statusCopyFailed, !copied);
    return;
  }

  if (action === 'flow-block') {
    sendToFlowEditor(block);
    return;
  }

  if (action === 'write-block') await writePromptFieldValue(block, 'replace');
  else if (action === 'append-block') await writePromptFieldValue(block, 'append');
  else if (action === 'fill-character') await runAgentCharacterFill([{ slot: index, prompt: block }]);
}

// 第 0 块是主提示词，1 起是角色栏 —— slot 就是块的序号
async function runAgentCharacterFill(characters) {
  const result = await fillNaiCharacterFields(characters);
  setStatus(result.message, !result.ok);
}

function bindAgentPanel(root) {
  ui.agent = {
    hosts: Array.from(root.querySelectorAll('.nai-agent')),
    fileInput: root.querySelector('[data-field="agentSkillInput"]'),
  };

  ui.agent.fileInput?.addEventListener('change', async (event) => {
    await importAgentSkillFiles(event.target.files);
    event.target.value = '';
  });

  ui.agent.hosts.forEach((host) => {
    host.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-agent-action]');
      if (!target || !host.contains(target)) return;
      event.preventDefault();
      await handleAgentAction(target.dataset.agentAction, target, host);
    });

    host.addEventListener('input', (event) => {
      const field = event.target.dataset?.agentField;
      if (field === 'request') state.agent.request = event.target.value;
      else if (field === 'editorText') state.agent.editing = event.target.value;
    });

    host.addEventListener('change', async (event) => {
      if (event.target.dataset?.agentField !== 'skill') return;
      await setActiveAgentSkill(event.target.value);
    });
  });
}

async function initAgentPanel(root) {
  bindAgentPanel(root);
  try {
    await loadAgentConversation();
  } catch (error) {
    state.agent.conversation = [];
  }
  try {
    await loadAgentSkills();
  } catch (error) {
    state.agent.activeSkillId = BUILTIN_AGENT_SKILL.id;
    state.agent.loaded = true;
  }
  renderAgentPanel();
}
