// 提示词 Agent 的界面。面板页和工作台抽屉共用同一份 markup，
// 状态放在 state.agent 里，渲染时推给所有 host（和画师库快捷面板同一套路）。
//
// 这里只负责「写提示词」：复制、写入输入框。不做任何触发生成的动作。

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

      <nav class="nai-md3-tabs nai-agent-modes">
        <button type="button" class="active" data-agent-action="mode" data-mode="default">${T.agentModeDefault}</button>
        <button type="button" data-agent-action="mode" data-mode="expanded">${T.agentModeExpanded}</button>
      </nav>

      <div class="nai-agent-sources">
        <span class="nai-agent-sources-label">${T.agentSourcesLabel}</span>
        <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="currentPrompt">${T.agentSourceCurrentPrompt}</button>
        <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="previous">${T.agentSourcePrevious}</button>
        <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="characters">${T.agentSourceCharacters}</button>
        <button type="button" class="nai-md3-inline-action nai-agent-source" data-agent-action="source" data-source="artists">${T.agentSourceArtists}</button>
      </div>
      <div class="nai-agent-note nai-agent-sources-hint">${T.agentSourcesHint}</div>

      <label class="nai-md3-label">${T.agentRequestLabel}</label>
      <textarea class="nai-md3-input nai-agent-request" data-agent-field="request" rows="4" placeholder="${T.agentRequestPlaceholder}"></textarea>

      <label class="nai-md3-label">${T.agentCharacterLabel}</label>
      <textarea class="nai-md3-input nai-agent-character" data-agent-field="characterPrompt" rows="2" placeholder="${T.agentCharacterPlaceholder}"></textarea>

      <div class="nai-md3-actions nai-agent-actions">
        <button type="button" class="nai-md3-primary" data-agent-action="run">${T.agentRun}</button>
        <button type="button" data-agent-action="clear">${T.agentClear}</button>
      </div>

      <div class="nai-agent-meta" data-agent-field="meta"></div>
      <div class="nai-agent-blocks" data-agent-field="blocks"></div>

      <label class="nai-md3-label">${T.agentResultLabel}</label>
      <textarea class="nai-md3-result nai-agent-result" data-agent-field="result" rows="8" readonly placeholder="${T.agentResultPlaceholder}"></textarea>
      <div class="nai-agent-foot">${T.agentHint}</div>
    </div>`;
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

function agentBlockLabel(index) {
  if (index === 0) return T.agentBlockMain;
  if (index === 1) return T.agentBlockCharacter;
  return `${T.agentBlockOther} ${index + 1}`;
}

function agentBlocksMarkup() {
  if (!state.agent.blocks.length) return '';

  return state.agent.blocks
    .map((block, index) => `
      <article class="nai-agent-block" data-index="${index}">
        <div class="nai-agent-block-head">
          <span class="nai-agent-block-title">${agentBlockLabel(index)}</span>
          <div class="nai-agent-block-actions">
            <button type="button" class="nai-md3-inline-action" data-agent-action="copy-block" data-index="${index}">${T.agentCopy}</button>
            <button type="button" class="nai-md3-inline-action" data-agent-action="write-block" data-index="${index}">${T.agentWrite}</button>
            <button type="button" class="nai-md3-inline-action" data-agent-action="append-block" data-index="${index}">${T.agentAppend}</button>
            <button type="button" class="nai-md3-inline-action" data-agent-action="flow-block" data-index="${index}">${T.tabFlow}</button>
          </div>
        </div>
        <pre class="nai-agent-block-body">${escapeHtml(block)}</pre>
      </article>`)
    .join('');
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
  const blocksHtml = agentBlocksMarkup();
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

    const request = host.querySelector('[data-agent-field="request"]');
    if (request && request.value !== state.agent.request) request.value = state.agent.request;
    const character = host.querySelector('[data-agent-field="characterPrompt"]');
    if (character && character.value !== state.agent.characterPrompt) character.value = state.agent.characterPrompt;

    const meta = host.querySelector('[data-agent-field="meta"]');
    if (meta) {
      meta.textContent = state.agent.meta || '';
      meta.classList.toggle('nai-hidden', !state.agent.meta);
    }

    const blocks = host.querySelector('[data-agent-field="blocks"]');
    if (blocks) blocks.innerHTML = blocksHtml;

    const result = host.querySelector('[data-agent-field="result"]');
    if (result && result.value !== state.agent.result) result.value = state.agent.result;

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
  state.agent.characterPrompt = host.querySelector('[data-agent-field="characterPrompt"]')?.value ?? state.agent.characterPrompt;
}

function setAgentResult(text) {
  state.agent.result = String(text || '');
  state.agent.blocks = extractAgentBlocks(state.agent.result);
}

function describeAgentRun(response) {
  const parts = [`skill：${getActiveAgentSkill().name}`];
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

// 只收集勾上的那几项 —— 没勾的一个字都不发出去
async function collectAgentContext() {
  const sources = state.agent.sources;
  const context = {};

  if (sources.currentPrompt) {
    const current = readPromptFieldText();
    if (current?.trim()) context.currentPrompt = current.trim();
  }

  if (sources.previous && String(state.agent.result || '').trim()) {
    context.previous = state.agent.result.trim();
  }

  if (sources.characters) {
    context.characters = state.promptLibrary
      .filter((entry) => entry.category === ROLE_LIBRARY_CATEGORY)
      .map((entry) => ({ name: entry.name || entry.alias, prompt: entry.promptText }))
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
    openPanel('settings');
    return;
  }

  let fallbackConfig = null;
  if (state.settings.enableFallbackModel) {
    const candidate = buildFallbackConfig([]);
    if (hasCompleteModelConfig(candidate)) fallbackConfig = candidate;
  }

  const skill = getActiveAgentSkill();
  const context = await collectAgentContext();
  const runId = createId('agent-run');
  setPending(true, T.agentRun, { runId, scope: 'agent' });
  setStatus(T.statusAgentRunning, false);
  state.agent.meta = '';

  try {
    const response = await sendRuntimeMessage({
      type: 'nai-agent-run',
      runId,
      payload: {
        skill: { name: skill.name, body: skill.body, references: skill.references },
        request,
        characterPrompt: String(state.agent.characterPrompt || '').trim(),
        mode: state.agent.mode,
        context,
        primary: primaryConfig,
        fallback: fallbackConfig,
      },
    });

    if (response?.errorKind === 'aborted') {
      setStatus(T.statusAgentCancelled, false);
      return;
    }

    if (!response?.ok) throw new Error(response?.error || '写提示词失败');

    setAgentResult(response.text);
    state.agent.meta = describeAgentRun(response);
    setStatus(T.statusAgentDone, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setPending(false);
    renderAgentPanel();
  }
}

function clearAgentDraft() {
  state.agent.request = '';
  state.agent.characterPrompt = '';
  state.agent.result = '';
  state.agent.blocks = [];
  state.agent.meta = '';
  renderAgentPanel();
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
    state.agent.mode = target.dataset.mode === 'expanded' ? 'expanded' : 'default';
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
    clearAgentDraft();
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

  const index = Number(target.dataset.index);
  const block = state.agent.blocks[index];
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
      else if (field === 'characterPrompt') state.agent.characterPrompt = event.target.value;
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
    await loadAgentSkills();
  } catch (error) {
    state.agent.activeSkillId = BUILTIN_AGENT_SKILL.id;
    state.agent.loaded = true;
  }
  renderAgentPanel();
}
