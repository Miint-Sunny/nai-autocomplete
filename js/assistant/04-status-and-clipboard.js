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

function setPending(isPending, label) {
  state.pending = isPending;
  if (!ui.sendButton) return;
  ui.sendButton.disabled = isPending;
  ui.sendButton.textContent = isPending ? (label || '\u53cd\u63a8\u4e2d...') : T.reverseCopy;
}

function setResult(text) {
  state.lastResult = text || '';
  if (ui.resultOutput) {
    ui.resultOutput.value = state.lastResult;
    autoResizeTextarea(ui.resultOutput);
  }
}


