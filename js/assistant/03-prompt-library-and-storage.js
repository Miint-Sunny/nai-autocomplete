function normalizePromptLibraryEntry(entry) {
  const alias = String(entry?.alias || '').trim().toLowerCase();
  const tags = Array.isArray(entry?.tags) ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
  if (!alias || !tags.length) return null;
  const [rawCategory, ...rest] = alias.split(':');
  const category = String(entry?.category || rawCategory || '').trim().toLowerCase();
  const name = String(entry?.name || rest.join(':') || '').trim().toLowerCase();
  const delimiters = Array.isArray(entry?.delimiters)
    ? entry.delimiters.map((delimiter) => String(delimiter || ''))
    : tags.map((_, index) => index === tags.length - 1 ? '' : ', ');

  while (delimiters.length < tags.length) {
    delimiters.push(tags.length === delimiters.length + 1 ? '' : ', ');
  }

  return {
    id: String(entry.id || alias),
    alias,
    shortAlias: name || (alias.includes(':') ? alias.split(':').slice(1).join(':') : alias),
    category: category || 'char',
    name: name || (alias.includes(':') ? alias.split(':').slice(1).join(':') : alias),
    tags,
    delimiters: delimiters.slice(0, tags.length),
    promptText: serializePromptTags(tags, delimiters.slice(0, tags.length)),
    officialChunkId: entry?.officialChunkId ? String(entry.officialChunkId) : '',
    officialContainerId: entry?.officialContainerId ? String(entry.officialContainerId) : '',
    officialRemoteId: entry?.officialRemoteId ? String(entry.officialRemoteId) : '',
    officialSyncedAt: Number(entry?.officialSyncedAt) || 0,
    createdAt: Number(entry?.createdAt) || Date.now(),
    updatedAt: Number(entry?.updatedAt) || Date.now(),
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePromptLibraryCategory(category) {
  return String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[:\s]+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

function normalizePromptLibraryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/:+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

function normalizePromptLibraryAlias(category, name) {
  const normalizedCategory = normalizePromptLibraryCategory(category) || 'char';
  const normalizedName = normalizePromptLibraryName(name);
  return normalizedName ? `${normalizedCategory}:${normalizedName}` : '';
}

function parsePromptTags(text) {
  const source = String(text || '');
  const tags = [];
  const delimiters = [];
  let current = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === ',' || char === '，' || char === '\n' || char === '|') {
      const tag = current.trim();
      let delimiter = char;
      index += 1;

      while (index < source.length && /[\s,，|]/.test(source[index])) {
        delimiter += source[index];
        index += 1;
      }

      if (tag) {
        tags.push(tag);
        delimiters.push(delimiter);
      }
      current = '';
      continue;
    }

    current += char;
    index += 1;
  }

  const lastTag = current.trim();
  if (lastTag) {
    tags.push(lastTag);
    delimiters.push('');
  }

  return { tags, delimiters };
}

function serializePromptTags(tags, delimiters) {
  return (tags || []).map((tag, index) => `${tag}${delimiters?.[index] || ''}`).join('');
}
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isContextInvalidatedError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Extension context invalidated');
}

function markContextInvalidated(error) {
  if (!isContextInvalidatedError(error)) return false;
  state.extensionContextInvalidated = true;
  stopPickMode();
  setPending(false);
  setStatus(T.statusContextInvalidated, true);
  return true;
}

function ensureExtensionContext() {
  if (state.extensionContextInvalidated) {
    setStatus(T.statusContextInvalidated, true);
    return false;
  }
  return true;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    if (!ensureExtensionContext()) {
      resolve({});
      return;
    }

    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError && markContextInvalidated(chrome.runtime.lastError)) {
          resolve({});
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      if (markContextInvalidated(error)) {
        resolve({});
        return;
      }
      throw error;
    }
  });
}

function storageSet(data) {
  return new Promise((resolve, reject) => {
    if (!ensureExtensionContext()) {
      resolve(false);
      return;
    }

    try {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          if (markContextInvalidated(chrome.runtime.lastError)) {
            resolve(false);
            return;
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(true);
      });
    } catch (error) {
      if (markContextInvalidated(error)) {
        resolve(false);
        return;
      }
      reject(error);
    }
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!ensureExtensionContext()) {
      reject(new Error(T.statusContextInvalidated));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          if (markContextInvalidated(chrome.runtime.lastError)) {
            reject(new Error(T.statusContextInvalidated));
            return;
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      if (markContextInvalidated(error)) {
        reject(new Error(T.statusContextInvalidated));
        return;
      }
      reject(error);
    }
  });
}

function ensureOfficialChunkBridgeScript() {
  if (!state.isNovelAIImagePage) return;
  if (document.documentElement.dataset.naiOfficialChunkBridgeInjected === 'true') return;
  if (document.documentElement.dataset.naiOfficialChunkBridgeMain === 'true') return;
  document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'true';

  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('official-chunk-bridge.js');
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => {
      document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
  }
}

