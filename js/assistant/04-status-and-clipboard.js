function getPromptLibraryMacroLabel(entry) {
  return entry?.shortAlias || entry?.name || entry?.alias || 'chunk';
}

function syncPromptLibraryEntryToOfficialChunk(entry, timeout = 5000) {
  if (!entry || !state.isNovelAIImagePage) return Promise.resolve({ ok: false, skipped: true });
  ensureOfficialChunkBridgeScript();

  return new Promise((resolve) => {
    const requestId = createId('official-chunk-sync');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('nai-official-chunk-sync-response', handleResponse);
      resolve(result);
    };
    const handleResponse = (event) => {
      if (event?.detail?.requestId !== requestId) return;
      finish(event.detail.error
        ? { ok: false, error: event.detail.error }
        : event.detail.result);
    };

    window.addEventListener('nai-official-chunk-sync-response', handleResponse);
    window.dispatchEvent(new CustomEvent('nai-official-chunk-sync-request', {
      detail: {
        requestId,
        entry: {
          id: entry.officialChunkId || entry.id,
          officialChunkId: entry.officialChunkId,
          officialContainerId: entry.officialContainerId,
          officialRemoteId: entry.officialRemoteId,
          alias: entry.alias,
          name: entry.name,
          shortAlias: entry.shortAlias,
          label: getPromptLibraryMacroLabel(entry),
          promptText: entry.promptText || serializePromptTags(entry.tags, entry.delimiters),
        },
      },
    }));
    setTimeout(() => finish({ ok: false, error: '官方 Prompt Chunk 同步超时' }), timeout);
  });
}

async function savePromptLibraryEntries(entries) {
  state.promptLibrary = entries.map(normalizePromptLibraryEntry).filter(Boolean);
  await storageSet({ [PROMPT_LIBRARY_KEY]: state.promptLibrary });
  renderPromptLibraryOptions();
  renderLibraryManager();

  try {
    chrome.runtime?.sendMessage?.({ type: 'nai-prompt-library-updated' });
  } catch (error) {}
}

async function patchPromptLibraryOfficialSyncResult(entryId, result) {
  if (!entryId || !result?.ok) return;
  const index = state.promptLibrary.findIndex((entry) => entry.id === entryId);
  if (index < 0) return;

  const nextEntry = normalizePromptLibraryEntry({
    ...state.promptLibrary[index],
    officialChunkId: result.id,
    officialContainerId: result.containerId,
    officialRemoteId: result.remoteId,
    officialSyncedAt: Date.now(),
  });
  if (!nextEntry) return;

  const nextLibrary = [...state.promptLibrary];
  nextLibrary[index] = nextEntry;
  state.promptLibrary = nextLibrary;
  await storageSet({ [PROMPT_LIBRARY_KEY]: nextLibrary });
  renderPromptLibraryOptions();
  renderLibraryManager();
}

// 工作台侧栏的图标。原来是 # ~ ≈ & ≡ * < 七个 ASCII 字符顶着 ——
// 侧栏收起后只剩图标，那一列就成了一串看不懂的符号。
// 画法跟 getPromptBlockIcon 那套一致：24×24、实心、fill="currentColor"。
function getWorkbenchIcon(type) {
  const icons = {
    // 词库 —— 书签，「存起来的一组词」
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.25 3h9.5A2.25 2.25 0 0 1 19 5.25v14.62a1.25 1.25 0 0 1-1.93 1.05L12 17.6l-5.07 3.32A1.25 1.25 0 0 1 5 19.87V5.25A2.25 2.25 0 0 1 7.25 3" fill="currentColor"/></svg>',
    // 写词 —— 魔杖加星点，「生成」
    agent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.94 6.94a1.5 1.5 0 0 1 2.12 0l1 1a1.5 1.5 0 0 1 0 2.12l-8 8a1.5 1.5 0 0 1-2.12 0l-1-1a1.5 1.5 0 0 1 0-2.12zM17.5 2l.62 1.88L20 4.5l-1.88.62L17.5 7l-.62-1.88L15 4.5l1.88-.62zM6 3l.47 1.53L8 5l-1.53.47L6 7l-.47-1.53L4 5l1.53-.47zM19.5 14l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" fill="currentColor"/></svg>',
    // 改词 —— 推子，「逐条调」
    flow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.25A.75.75 0 0 1 4.75 5.5h4.6a2.751 2.751 0 0 1 5.3 0h4.6a.75.75 0 0 1 0 1.5h-4.6a2.751 2.751 0 0 1-5.3 0h-4.6A.75.75 0 0 1 4 6.25m0 11.5a.75.75 0 0 1 .75-.75h9.6a2.751 2.751 0 0 1 5.3 0h.6a.75.75 0 0 1 0 1.5h-.6a2.751 2.751 0 0 1-5.3 0h-9.6a.75.75 0 0 1-.75-.75" fill="currentColor"/></svg>',
    // 画师库 —— 调色板
    artists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c5.25 0 9.5 3.92 9.5 8.75 0 2.9-2.35 5.25-5.25 5.25h-1.6a1.15 1.15 0 0 0-.82 1.96c.35.36.54.84.54 1.34 0 1.1-.9 1.95-2 1.95-5.52 0-10-4.48-10-10s4.18-9.25 9.63-9.25M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m3.5-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m2.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" fill="currentColor"/></svg>',
    // 预设 —— 叠起来的卡片，「一整套配置」
    presets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.34 2.42a1.5 1.5 0 0 1 1.32 0l7.5 3.68a1 1 0 0 1 0 1.8l-7.5 3.68a1.5 1.5 0 0 1-1.32 0l-7.5-3.68a1 1 0 0 1 0-1.8zM3.4 11.3a.75.75 0 0 1 1-.34l7.6 3.73 7.6-3.73a.75.75 0 1 1 .66 1.35l-7.94 3.9a.75.75 0 0 1-.66 0l-7.94-3.9a.75.75 0 0 1-.34-1zm0 4.5a.75.75 0 0 1 1-.34l7.6 3.73 7.6-3.73a.75.75 0 1 1 .66 1.35l-7.94 3.9a.75.75 0 0 1-.66 0l-7.94-3.9a.75.75 0 0 1-.34-1z" fill="currentColor"/></svg>',
    // 设置 —— 齿轮
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.32 2h3.36a1 1 0 0 1 .98.8l.32 1.6q.62.25 1.16.6l1.54-.53a1 1 0 0 1 1.19.45l1.68 2.9a1 1 0 0 1-.21 1.25l-1.22 1.06a7 7 0 0 1 0 1.34l1.22 1.06a1 1 0 0 1 .21 1.25l-1.68 2.9a1 1 0 0 1-1.19.45l-1.54-.53q-.54.35-1.16.6l-.32 1.6a1 1 0 0 1-.98.8h-3.36a1 1 0 0 1-.98-.8l-.32-1.6a7 7 0 0 1-1.16-.6l-1.54.53a1 1 0 0 1-1.19-.45l-1.68-2.9a1 1 0 0 1 .21-1.25l1.22-1.06a7 7 0 0 1 0-1.34L3.66 10.07a1 1 0 0 1-.21-1.25l1.68-2.9a1 1 0 0 1 1.19-.45l1.54.53q.54-.35 1.16-.6l.32-1.6a1 1 0 0 1 .98-.8M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5" fill="currentColor"/></svg>',
    // 收起 —— 折叠箭头
    collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.53 6.47a.75.75 0 0 1 0 1.06L10.06 12l4.47 4.47a.75.75 0 1 1-1.06 1.06l-5-5a.75.75 0 0 1 0-1.06l5-5a.75.75 0 0 1 1.06 0" fill="currentColor"/></svg>',
  };
  return icons[type] || '';
}

function setStatus(text, isError) {
  if (state.isNovelAIImagePage && ui.library.status) {
    ui.library.status.textContent = text || '';
    ui.library.status.classList.toggle('is-error', Boolean(isError));
  }
  if (!ui.status) return;
  ui.status.textContent = text || '';
  ui.status.classList.toggle('is-error', Boolean(isError));
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      return fallbackCopyText(text);
    } catch (fallbackError) {
      return false;
    }
  }
}

// 带 runId 的请求可以中途掐掉，这时按钮不该禁用 —— 它变成「取消」。
// 没有 runId 的（比如连接测试）保持原来的禁用行为。
//
// scope 决定「取消」长在哪个按钮上。面板里同一时间只跑一个任务，
// 不是自己发起的那个按钮只置灰、不改文案，否则两个按钮会互相抢文案。
function setPending(isPending, label, options = {}) {
  state.pending = isPending;
  state.cancellableRunId = isPending ? (options.runId || null) : null;
  state.pendingScope = isPending ? (options.scope || 'reverse') : '';

  if (ui.sendButton) {
    const owns = state.pendingScope === 'reverse';
    const cancellable = Boolean(isPending && owns && state.cancellableRunId);
    ui.sendButton.disabled = isPending && !cancellable;
    if (!isPending) ui.sendButton.textContent = T.reverseCopy;
    else if (cancellable) ui.sendButton.textContent = T.cancelRun;
    else if (owns) ui.sendButton.textContent = label || '\u53cd\u63a8\u4e2d...';
  }

  renderAgentRunState();
}

function setResult(text) {
  state.lastResult = text || '';
  if (ui.resultOutput) {
    ui.resultOutput.value = state.lastResult;
    autoResizeTextarea(ui.resultOutput);
  }
}


