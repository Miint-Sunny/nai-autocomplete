function buildMessages(resolvedBlocks) {
  if (!resolvedBlocks || !resolvedBlocks.length) return [];

  const protocol = state.settings.protocol;
  const { merged, didMerge } = mergeBlocksForProtocol(resolvedBlocks, protocol);

  if (didMerge) {
    setStatus('消息块已按协议要求自动合并。', false);
  }

  const messages = merged.map((block) => ({
    role: block.role,
    content: block.content,
  }));

  const lastUserIndex = messages.reduce((idx, m, i) => (m.role === 'user' ? i : idx), -1);
  if (lastUserIndex >= 0) {
    const textContent = messages[lastUserIndex].content;
    const imagePayload = state.settings.sendImageAsDataUrl
      ? state.selectedImage?.dataUrl || state.selectedImage?.sourceUrl
      : state.selectedImage?.sourceUrl || state.selectedImage?.dataUrl;
    const parts = [{ type: 'text', text: textContent }];
    if (imagePayload) {
      parts.push({ type: 'image_url', image_url: { url: imagePayload } });
    }
    messages[lastUserIndex].content = parts;
  }

  return messages;
}

function getProviderPresetById(id) {
  return PROVIDER_PRESETS.find((item) => item.id === id) || PROVIDER_PRESETS[0];
}

function fillSelectOptions(select, options) {
  if (!select) return;
  select.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    .join('');
}

function normalizeProviderConnections(connections) {
  if (!connections || typeof connections !== 'object' || Array.isArray(connections)) return {};

  return Object.fromEntries(
    Object.entries(connections)
      .filter(([providerId, value]) => providerId && value && typeof value === 'object')
      .map(([providerId, value]) => [providerId, {
        protocol: String(value.protocol || ''),
        endpoint: String(value.endpoint || ''),
        model: String(value.model || ''),
        apiKey: String(value.apiKey || ''),
      }])
  );
}

function rememberProviderConnection(connections, providerId, connection) {
  if (!providerId) return normalizeProviderConnections(connections);
  return {
    ...normalizeProviderConnections(connections),
    [providerId]: {
      protocol: String(connection?.protocol || ''),
      endpoint: String(connection?.endpoint || ''),
      model: String(connection?.model || ''),
      apiKey: String(connection?.apiKey || ''),
    },
  };
}

function getProviderConnection(connections, providerId) {
  const preset = getProviderPresetById(providerId);
  const normalized = normalizeProviderConnections(connections);
  const stored = normalized[providerId] || {};
  const hasStored = Object.prototype.hasOwnProperty.call(normalized, providerId);

  return {
    protocol: hasStored ? stored.protocol : (preset.protocol || DEFAULT_SETTINGS.protocol),
    endpoint: hasStored ? stored.endpoint : (preset.endpoint || ''),
    model: hasStored ? stored.model : (preset.defaultModel || ''),
    apiKey: hasStored ? stored.apiKey : '',
  };
}

function renderPromptLibraryOptions() {
  const selects = [ui.settings.roleLibrarySelect, ui.library.roleLibrarySelect].filter(Boolean);
  if (!selects.length) return;
  const roleLibraryEntries = state.promptLibrary.filter((entry) => entry.category === ROLE_LIBRARY_CATEGORY);

  const libraryOptions = [
    { value: '', label: T.roleLibraryPlaceholder },
    ...roleLibraryEntries
      .map((entry) => ({
        value: entry.id,
        label: entry.alias,
      })),
  ];

  const html = libraryOptions
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join('');

  selects.forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = html;
    select.value = roleLibraryEntries.some((entry) => entry.id === currentValue) ? currentValue : '';
  });
}

async function refreshPromptLibraryOptions() {
  const data = await storageGet([PROMPT_LIBRARY_KEY]);
  state.promptLibrary = Array.isArray(data[PROMPT_LIBRARY_KEY])
    ? data[PROMPT_LIBRARY_KEY].map(normalizePromptLibraryEntry).filter(Boolean)
    : [];
  renderPromptLibraryOptions();
  renderLibraryManager();
}

function applyPromptLibraryToRolePrompt() {
  const select = ui.settings.roleLibrarySelect;
  const rolePrompt = ui.settings.rolePrompt;
  if (!select || !rolePrompt) return;

  const entry = state.promptLibrary.find((item) => item.id === select.value && item.category === ROLE_LIBRARY_CATEGORY);
  if (!entry) {
    setStatus(T.statusRoleLibraryMissing, true);
    return;
  }

  rolePrompt.value = entry.tags
    .map((tag, index) => `${tag}${entry.delimiters?.[index] || ''}`)
    .join('');
  autoResizeTextarea(rolePrompt);
  setStatus(T.statusRoleLibraryApplied, false);
}

function applyPromptLibraryToLibraryRolePrompt() {
  const select = ui.library.roleLibrarySelect;
  const rolePrompt = ui.library.rolePrompt;
  if (!select || !rolePrompt) return;

  const entry = state.promptLibrary.find((item) => item.id === select.value && item.category === ROLE_LIBRARY_CATEGORY);
  if (!entry) {
    setStatus(T.statusRoleLibraryMissing, true);
    return;
  }

  rolePrompt.value = entry.tags
    .map((tag, index) => `${tag}${entry.delimiters?.[index] || ''}`)
    .join('');
  autoResizeTextarea(rolePrompt);
  setStatus(T.statusRoleLibraryApplied, false);
}

// 别名只对角色有意义 —— 写词时「描述里提到名字 = 点名这个角色」只查 char: 条目。
// 挂在 artist: 或 style: 上是一行永远用不到的空输入。
function updateLibraryAliasVisibility() {
  if (!ui.library.aliasesField) return;
  const isRole = (ui.library.category?.value || 'char') === ROLE_LIBRARY_CATEGORY;
  ui.library.aliasesField.classList.toggle('nai-hidden', !isRole);
}

function resetLibraryEditor() {
  state.libraryEditingId = '';
  if (ui.library.category) ui.library.category.value = 'char';
  if (ui.library.name) ui.library.name.value = '';
  if (ui.library.aliases) ui.library.aliases.value = '';
  updateLibraryAliasVisibility();
  if (ui.library.prompt) {
    ui.library.prompt.value = '';
    autoResizeTextarea(ui.library.prompt);
  }
}

function renderLibraryManager() {
  // 编辑区的别名栏跟着分类显示/隐藏，初次渲染也得算一次 ——
  // 只在 change 事件里算的话，刚打开时它是按 markup 里的初始状态（隐藏）待着的
  updateLibraryAliasVisibility();
  if (!ui.libraryList) return;
  const entries = [...state.promptLibrary].sort((a, b) => {
    const categoryCompare = a.category.localeCompare(b.category);
    if (categoryCompare) return categoryCompare;
    return a.alias.localeCompare(b.alias);
  });

  if (!entries.length) {
    ui.libraryList.innerHTML = '<div class="nai-library-empty">暂无词库条目</div>';
    return;
  }

  ui.libraryList.innerHTML = entries.map((entry) => {
    const promptText = entry.promptText || serializePromptTags(entry.tags, entry.delimiters);
    const preview = promptText.length > 160 ? `${promptText.slice(0, 160)}...` : promptText;
    const syncText = entry.officialRemoteId || entry.officialChunkId
      ? `已同步${entry.officialSyncedAt ? ` · ${formatTime(entry.officialSyncedAt)}` : ''}`
      : '未同步';

    return `
      <article class="nai-library-row" data-id="${escapeHtml(entry.id)}">
        <div class="nai-library-row-head">
          <div>
            <div class="nai-library-row-alias">${escapeHtml(entry.alias)}</div>
            <div class="nai-library-row-sync">${escapeHtml(syncText)}</div>
          </div>
          <div class="nai-library-row-count">${entry.tags.length} tags</div>
        </div>
        <div class="nai-library-row-preview">${escapeHtml(preview)}</div>
        <div class="nai-library-row-actions">
          <button type="button" data-action="library-edit" data-id="${escapeHtml(entry.id)}">编辑</button>
          <button type="button" data-action="library-copy" data-id="${escapeHtml(entry.id)}">复制</button>
          <button type="button" data-action="library-sync" data-id="${escapeHtml(entry.id)}">同步</button>
          <button type="button" data-action="library-delete" data-id="${escapeHtml(entry.id)}">删除</button>
        </div>
      </article>
    `;
  }).join('');
}

function editLibraryEntry(entryId) {
  const entry = state.promptLibrary.find((item) => item.id === entryId);
  if (!entry) return;

  openLibraryEditor();
  state.libraryEditingId = entry.id;
  if (ui.library.category) ui.library.category.value = PROMPT_LIBRARY_CATEGORIES.some((item) => item.id === entry.category)
    ? entry.category
    : 'char';
  if (ui.library.name) ui.library.name.value = entry.name || entry.shortAlias || '';
  if (ui.library.aliases) ui.library.aliases.value = (entry.aliases || []).join('、');
  updateLibraryAliasVisibility();
  if (ui.library.prompt) {
    ui.library.prompt.value = entry.promptText || serializePromptTags(entry.tags, entry.delimiters);
    autoResizeTextarea(ui.library.prompt);
    ui.library.prompt.focus();
  }
}

async function saveLibraryEditorAndSync() {
  const rawCategory = ui.library.category?.value || 'char';
  const rawName = ui.library.name?.value || '';
  const rawPrompt = ui.library.prompt?.value || '';
  const category = normalizePromptLibraryCategory(rawCategory);
  const name = normalizePromptLibraryName(rawName);
  const alias = normalizePromptLibraryAlias(category, name);
  const parsed = parsePromptTags(rawPrompt);

  if (!category || !name || !alias || !parsed.tags.length) {
    setStatus(T.statusLibraryInvalid, true);
    return;
  }

  const existingById = state.promptLibrary.find((entry) => entry.id === state.libraryEditingId);
  const existingByAlias = state.promptLibrary.find((entry) => entry.alias === alias);
  const baseEntry = existingById || existingByAlias || {};
  const nextEntry = normalizePromptLibraryEntry({
    ...baseEntry,
    id: baseEntry.id || createId('library'),
    alias,
    category,
    name,
    aliases: category === ROLE_LIBRARY_CATEGORY ? (ui.library.aliases?.value || '') : [],
    tags: parsed.tags,
    delimiters: parsed.delimiters,
    createdAt: baseEntry.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  if (!nextEntry) return;

  const nextLibrary = state.promptLibrary.filter((entry) => entry.id !== nextEntry.id && entry.alias !== nextEntry.alias);
  nextLibrary.unshift(nextEntry);

  try {
    await savePromptLibraryEntries(nextLibrary);
    state.libraryEditingId = nextEntry.id;
    setStatus(T.statusLibrarySaved, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return;
  }

  await syncLibraryEntry(nextEntry);
}

async function syncLibraryEntry(entry) {
  if (!entry) return;
  const result = await syncPromptLibraryEntryToOfficialChunk(entry);
  if (result?.ok) {
    await patchPromptLibraryOfficialSyncResult(entry.id, result);
    setStatus(T.statusLibrarySynced, false);
    return;
  }

  if (result?.skipped) {
    setStatus('当前页面不可同步官方 Prompt Chunk。', true);
    return;
  }

  setStatus(`${T.statusLibrarySyncFailed}${result?.error || '未知错误'}`, true);
}

async function syncLibraryEntryById(entryId) {
  const entry = state.promptLibrary.find((item) => item.id === entryId);
  if (!entry) return;
  setStatus('正在同步到官方 Prompt Chunk...', false);
  await syncLibraryEntry(entry);
}

async function copyLibraryEntry(entryId) {
  const entry = state.promptLibrary.find((item) => item.id === entryId);
  if (!entry) return;
  const copied = await copyText(entry.promptText || serializePromptTags(entry.tags, entry.delimiters));
  setStatus(copied ? T.statusCopied : T.statusCopyFailed, !copied);
}

async function deleteLibraryEntry(entryId) {
  const entry = state.promptLibrary.find((item) => item.id === entryId);
  if (!entry) return;
  const confirmed = window.confirm(`删除词库条目 ${entry.alias}？`);
  if (!confirmed) return;

  const nextLibrary = state.promptLibrary.filter((item) => item.id !== entryId);
  await savePromptLibraryEntries(nextLibrary);
  if (state.libraryEditingId === entryId) resetLibraryEditor();
  setStatus(T.statusLibraryDeleted, false);
}

// 各家取密钥的位置差别很大，Vertex 尤其特殊：它要的是会过期的 OAuth
// access token，不是长期 API key。
const API_KEY_HELP = {
  'vertex-openai': 'Vertex AI 用的是 OAuth access token，不是长期 API Key。\n本机装好 gcloud 后执行：gcloud auth print-access-token\n把输出整段粘进来。token 约 1 小时过期，过期后重新执行再粘一次。\n同时把 Endpoint 里的 PROJECT_ID 换成你的项目 ID，两处 us-central1 换成模型所在区域。',
  'gemini-openai': '在 Google AI Studio（aistudio.google.com/apikey）创建 API Key。',
  openai: '在 platform.openai.com/api-keys 创建。',
  openrouter: '在 openrouter.ai/keys 创建。',
  deepseek: '在 platform.deepseek.com/api_keys 创建。',
  anthropic: '在 console.anthropic.com/settings/keys 创建。',
  'xai-chat': '在 console.x.ai 创建。',
  'xai-responses': '在 console.x.ai 创建。',
};

function toggleApiKeyHelp() {
  const note = ui.settings.keyHelp;
  if (!note) return;
  const providerId = ui.settings.providerPreset?.value || state.settings.providerPreset;
  note.textContent = API_KEY_HELP[providerId] || '在所选服务商的控制台创建 API Key。';
  note.classList.toggle('nai-hidden');
}

function updateFallbackSettingsVisibility() {
  if (!ui.settings.fallbackSection) return;
  ui.settings.fallbackSection.classList.toggle('nai-hidden', !ui.settings.enableFallbackModel.checked);
}

function resolveGlassAmount() {
  if (state.settings.glassEffect === false) return 0;
  const strength = Number(state.settings.glassStrength);
  const clamped = Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : DEFAULT_SETTINGS.glassStrength;
  return clamped / 100;
}

function applyThemePreset() {
  if (!ui.root) return;
  ui.root.dataset.theme = state.settings.themePreset || DEFAULT_SETTINGS.themePreset;

  // amount 走 inline 变量，CSS 里的表达式据此在「实心 <-> 全玻璃」之间连续插值。
  const amount = resolveGlassAmount();
  ui.root.dataset.glass = amount > 0 ? 'on' : 'off';
  ui.root.style.setProperty('--nai-md3-glass-amount', String(amount));

  const percent = `${Math.round(amount * 100)}%`;
  ui.settings.glassStrength?.style.setProperty('--nai-md3-slider-pct', percent);
  ui.library.glassStrength?.style.setProperty('--nai-md3-slider-pct', percent);
  if (ui.settings.glassStrengthValue) ui.settings.glassStrengthValue.textContent = percent;
}

function isNovelAISiteLocation() {
  return /(^|\.)novelai\.net$/i.test(window.location.hostname);
}

function isNovelAIImageLocation() {
  return window.location.origin === 'https://novelai.net' && window.location.pathname === '/image';
}

function applyPageMode() {
  state.isNovelAIImagePage = isNovelAIImageLocation();
  state.isNovelAISite = isNovelAISiteLocation();
  if (!ui.root) return;

  ui.root.dataset.novelaiImagePage = state.isNovelAIImagePage ? 'true' : 'false';
  // 悬浮球在哪儿都开同一个悬浮窗，所以标题不再跟着页面换。
  // 出图页曾经把它叫「词库」—— 那是工作台的名字，现在工作台走扩展图标。
  if (ui.fab) {
    ui.fab.textContent = T.fab;
    ui.fab.title = T.title;
  }
  const title = ui.root.querySelector('.nai-md3-title');
  if (title) title.textContent = T.title;

  updateFabVisibility();

  if (state.isNovelAIImagePage) {
    ensureOfficialChunkBridgeScript();
    renderLibraryManager();
  } else {
    // 工作台是出图页专有的（词库要往官方 Prompt Chunk 同步），离开就收起来
    closeLibraryDrawer();
  }
}

function bindLocationModeWatcher() {
  let lastHref = window.location.href;
  const checkLocation = () => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    applyPageMode();
  };

  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(checkLocation);
      return result;
    };
  });

  window.addEventListener('popstate', () => queueMicrotask(checkLocation));
  window.setInterval(checkLocation, 1000);
}

function autoResizeTextarea(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  // 导入盒子的文本域是个中转站，不该把下面的「导入」按钮顶出屏幕 —— 单独给它一档矮的。
  // 这里必须和 CSS 分开管：CSS 的 max-height 会把高度夹住，但这个函数算 overflow-y
  // 用的还是原来的上限，夹住之后就变成 hidden + 内容够不着。
  const maxHeight = textarea.classList.contains('nai-md3-result') ? 420
    : textarea.classList.contains('nai-import-box-text') ? 200
    : 440;
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(nextHeight, 72)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function autoResizeAllTextareas() {
  if (!ui.root) return;
  ui.root.querySelectorAll('textarea').forEach((textarea) => autoResizeTextarea(textarea));
}

// 用委托而不是逐个绑：消息块、导入盒子、对话流都是渲染出来的，
// 逐个绑只能照顾到 init 那一刻就在的那批，后来长出来的永远不会跟着内容长高。
function bindTextareaAutosize() {
  if (!ui.root) return;
  ui.root.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement) autoResizeTextarea(event.target);
  });
  autoResizeAllTextareas();
}

function getConnectionFields(uiGroup, kind) {
  const isFallback = kind === 'fallback';
  return {
    presetField: isFallback ? uiGroup.fallbackProviderPreset : uiGroup.providerPreset,
    protocolField: isFallback ? uiGroup.fallbackProtocol : uiGroup.protocol,
    endpointField: isFallback ? uiGroup.fallbackEndpoint : uiGroup.endpoint,
    modelField: isFallback ? uiGroup.fallbackModel : uiGroup.model,
    apiKeyField: isFallback ? uiGroup.fallbackApiKey : uiGroup.apiKey,
  };
}

function readProviderConnectionFromFields(fields) {
  return {
    protocol: fields.protocolField?.value || '',
    endpoint: fields.endpointField?.value.trim() || '',
    model: fields.modelField?.value.trim() || '',
    apiKey: fields.apiKeyField?.value.trim() || '',
  };
}

function applyProviderConnectionToFields(fields, connection) {
  if (fields.protocolField) fields.protocolField.value = connection.protocol || DEFAULT_SETTINGS.protocol;
  if (fields.endpointField) fields.endpointField.value = connection.endpoint || '';
  if (fields.modelField) fields.modelField.value = connection.model || '';
  if (fields.apiKeyField) fields.apiKeyField.value = connection.apiKey || '';
}

function syncProviderFieldsForGroup(uiGroup, kind, connectionKey) {
  const fields = getConnectionFields(uiGroup, kind);
  if (!fields.presetField || !fields.protocolField || !fields.endpointField || !fields.modelField || !fields.apiKeyField) return;

  const previousProvider = fields.presetField.dataset.currentProvider || fields.presetField.value;
  const nextProvider = fields.presetField.value;
  const previousConnections = normalizeProviderConnections(state.settings[connectionKey]);
  const nextConnections = rememberProviderConnection(previousConnections, previousProvider, readProviderConnectionFromFields(fields));
  const nextConnection = getProviderConnection(nextConnections, nextProvider);

  state.settings[connectionKey] = nextConnections;
  applyProviderConnectionToFields(fields, nextConnection);
  fields.presetField.dataset.currentProvider = nextProvider;

  if (connectionKey === 'fallbackProviderConnections') {
    state.settings.fallbackProviderPreset = nextProvider;
    state.settings.fallbackProtocol = nextConnection.protocol;
    state.settings.fallbackEndpoint = nextConnection.endpoint;
    state.settings.fallbackModel = nextConnection.model;
    state.settings.fallbackApiKey = nextConnection.apiKey;
    return;
  }

  state.settings.providerPreset = nextProvider;
  state.settings.protocol = nextConnection.protocol;
  state.settings.endpoint = nextConnection.endpoint;
  state.settings.model = nextConnection.model;
  state.settings.apiKey = nextConnection.apiKey;
  updateEndpointWarnings();
}

function syncProviderFields(kind) {
  syncProviderFieldsForGroup(ui.settings, kind, kind === 'fallback' ? 'fallbackProviderConnections' : 'providerConnections');
}

function syncLibraryProviderFields(kind) {
  syncProviderFieldsForGroup(ui.library, kind, kind === 'fallback' ? 'fallbackProviderConnections' : 'providerConnections');
}

// ⚠ 这两段和 js/background/03-llm-errors.js 里的**逐字一致**，
// 由 scripts/test-build.mjs 守着。两个 bundle 互相够不到，只能各存一份：
// 后台用它把错误提示说清楚，这里用它在**配置的时候**就拦下来 ——
// 等发出去才报错，用户已经浪费了一次请求，而且看到的是服务端那句看不懂的 schema 错。
const PROTOCOL_ENDPOINT_SHAPES = {
  'openai-chat': { tail: /\/chat\/completions\/?$/, label: 'OpenAI Chat Completions', want: '/chat/completions' },
  responses: { tail: /\/responses\/?$/, label: 'Responses API', want: '/responses' },
  'anthropic-messages': { tail: /\/messages\/?$/, label: 'Anthropic Messages API', want: '/messages' },
};

function detectProtocolEndpointMismatch(protocol, endpoint) {
  const expected = PROTOCOL_ENDPOINT_SHAPES[protocol];
  if (!expected || !endpoint) return '';

  let pathname = '';
  try {
    pathname = new URL(endpoint).pathname;
  } catch (error) {
    return '';
  }

  if (expected.tail.test(pathname)) return '';

  // 只填了域名。常见于「把 base URL 当接口地址粘进来」，或者换协议时删掉了旧路径
  // 却忘了补新的。这条不会误伤自建网关 —— 光秃秃一个域名对三种协议都不是合法地址。
  if (!pathname || pathname === '/') {
    return `Endpoint 只填了域名，没有路径 —— 这里要的是完整的接口地址，不是 base URL。`
      + `「${expected.label}」的地址以 ${expected.want} 结尾。`;
  }

  // 只在地址明显长着**另一种**协议的样子时才说话。自建网关的路径千奇百怪，
  // 认不出来就闭嘴，别对着正常配置乱报。
  const looksLike = Object.entries(PROTOCOL_ENDPOINT_SHAPES)
    .find(([id, shape]) => id !== protocol && shape.tail.test(pathname));
  if (!looksLike) return '';

  return `接口协议选的是「${expected.label}」，但 Endpoint 是 ${pathname}，那是「${looksLike[1].label}」的地址。`
    + `两者必须配套：要么把协议改成「${looksLike[1].label}」，要么把 Endpoint 换成以 ${expected.want} 结尾的那条。`;
}

// 四处「协议 + Endpoint」：面板和抽屉 × 主模型和备用
function endpointWarningTargets() {
  return [
    { protocol: ui.settings.protocol, endpoint: ui.settings.endpoint, warn: ui.settings.endpointWarn },
    { protocol: ui.settings.fallbackProtocol, endpoint: ui.settings.fallbackEndpoint, warn: ui.settings.fallbackEndpointWarn },
    { protocol: ui.library.protocol, endpoint: ui.library.endpoint, warn: ui.library.endpointWarn },
    { protocol: ui.library.fallbackProtocol, endpoint: ui.library.fallbackEndpoint, warn: ui.library.fallbackEndpointWarn },
  ];
}

function updateEndpointWarnings() {
  endpointWarningTargets().forEach(({ protocol, endpoint, warn }) => {
    if (!warn) return;
    const message = protocol && endpoint
      ? detectProtocolEndpointMismatch(protocol.value, endpoint.value.trim())
      : '';
    warn.textContent = message;
    warn.classList.toggle('nai-hidden', !message);
  });
}

// settings 默认就是已保存的那份；「测试连接」会把表单里的草稿传进来 ——
// 它测的必须是用户眼前看到的配置，否则就是拿另一份配置给出一句「通过」。
function buildRequestConfig(target, messages, settings = state.settings) {
  const preset = getProviderPresetById(target.providerPreset);
  return {
    providerId: target.providerPreset,
    label: preset?.label || '\u81ea\u5b9a\u4e49',
    protocol: target.protocol,
    endpoint: String(target.endpoint || '').trim(),
    apiKey: String(target.apiKey || '').trim(),
    model: String(target.model || '').trim(),
    temperature: Number(settings.temperature) || DEFAULT_SETTINGS.temperature,
    maxTokens: Number(settings.maxTokens) || DEFAULT_SETTINGS.maxTokens,
    reasoningEffort: target.reasoningEffort || 'off',
    messages,
  };
}

function hasCompleteModelConfig(config) {
  return Boolean(config?.endpoint && config?.model && config?.apiKey);
}

function buildPrimaryConfig(messages, settings = state.settings) {
  return buildRequestConfig({
    providerPreset: settings.providerPreset,
    protocol: settings.protocol,
    endpoint: settings.endpoint,
    apiKey: settings.apiKey,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
  }, messages, settings);
}

function buildFallbackConfig(messages, settings = state.settings) {
  if (!settings.enableFallbackModel) return null;
  return buildRequestConfig({
    providerPreset: settings.fallbackProviderPreset,
    protocol: settings.fallbackProtocol,
    endpoint: settings.fallbackEndpoint,
    apiKey: settings.fallbackApiKey,
    model: settings.fallbackModel,
    reasoningEffort: settings.fallbackReasoningEffort,
  }, messages, settings);
}

