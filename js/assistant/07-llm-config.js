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

function resetLibraryEditor() {
  state.libraryEditingId = '';
  if (ui.library.category) ui.library.category.value = 'char';
  if (ui.library.name) ui.library.name.value = '';
  if (ui.library.prompt) {
    ui.library.prompt.value = '';
    autoResizeTextarea(ui.library.prompt);
  }
}

function renderLibraryManager() {
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

function updateFallbackSettingsVisibility() {
  if (!ui.settings.fallbackSection) return;
  ui.settings.fallbackSection.classList.toggle('nai-hidden', !ui.settings.enableFallbackModel.checked);
}

function applyThemePreset() {
  if (!ui.root) return;
  ui.root.dataset.theme = state.settings.themePreset || DEFAULT_SETTINGS.themePreset;
}

function isNovelAIImageLocation() {
  return window.location.origin === 'https://novelai.net' && window.location.pathname === '/image';
}

function applyPageMode() {
  state.isNovelAIImagePage = isNovelAIImageLocation();
  if (!ui.root) return;

  ui.root.dataset.novelaiImagePage = state.isNovelAIImagePage ? 'true' : 'false';
  if (ui.fab) {
    ui.fab.textContent = state.isNovelAIImagePage ? T.imagePageFab : T.fab;
    ui.fab.title = state.isNovelAIImagePage ? T.imagePageTitle : T.title;
  }
  const title = ui.root.querySelector('.nai-md3-title');
  if (title) title.textContent = state.isNovelAIImagePage ? T.imagePageTitle : T.title;

  updateFabVisibility();

  if (state.isNovelAIImagePage) {
    ensureOfficialChunkBridgeScript();
    if (ui.panel) ui.panel.classList.add('nai-hidden');
    state.activePage = 'library';
    renderLibraryManager();
    setStatus(T.statusLibraryReady, false);
  } else if (state.activePage === 'library') {
    closeLibraryDrawer();
    setPage('reverse');
    setStatus(T.statusReady, false);
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
  const maxHeight = textarea.classList.contains('nai-md3-result') ? 420 : 440;
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(nextHeight, 72)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function autoResizeAllTextareas() {
  if (!ui.root) return;
  ui.root.querySelectorAll('textarea').forEach((textarea) => autoResizeTextarea(textarea));
}

function bindTextareaAutosize() {
  if (!ui.root) return;
  ui.root.querySelectorAll('textarea').forEach((textarea) => {
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));
    autoResizeTextarea(textarea);
  });
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
}

function syncProviderFields(kind) {
  syncProviderFieldsForGroup(ui.settings, kind, kind === 'fallback' ? 'fallbackProviderConnections' : 'providerConnections');
}

function syncLibraryProviderFields(kind) {
  syncProviderFieldsForGroup(ui.library, kind, kind === 'fallback' ? 'fallbackProviderConnections' : 'providerConnections');
}

function buildRequestConfig(target, messages) {
  const preset = getProviderPresetById(target.providerPreset);
  return {
    providerId: target.providerPreset,
    label: preset?.label || '\u81ea\u5b9a\u4e49',
    protocol: target.protocol,
    endpoint: target.endpoint.trim(),
    apiKey: target.apiKey.trim(),
    model: target.model.trim(),
    temperature: Number(state.settings.temperature) || DEFAULT_SETTINGS.temperature,
    maxTokens: Number(state.settings.maxTokens) || DEFAULT_SETTINGS.maxTokens,
    messages,
  };
}

function hasCompleteModelConfig(config) {
  return Boolean(config?.endpoint && config?.model && config?.apiKey);
}

function buildPrimaryConfig(messages) {
  return buildRequestConfig({
    providerPreset: state.settings.providerPreset,
    protocol: state.settings.protocol,
    endpoint: state.settings.endpoint,
    apiKey: state.settings.apiKey,
    model: state.settings.model,
  }, messages);
}

function buildFallbackConfig(messages) {
  if (!state.settings.enableFallbackModel) return null;
  return buildRequestConfig({
    providerPreset: state.settings.fallbackProviderPreset,
    protocol: state.settings.fallbackProtocol,
    endpoint: state.settings.fallbackEndpoint,
    apiKey: state.settings.fallbackApiKey,
    model: state.settings.fallbackModel,
  }, messages);
}

