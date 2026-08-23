function ensureOfficialChunkBridgeScript() {
  if (document.documentElement.dataset.naiOfficialChunkBridgeInjected === 'true') return;
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

// CSV 解析，正确处理引号中的逗号
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

const TAG_CACHE_KEY = 'nai-ac-tags';
const TAG_CACHE_TIME_KEY = 'nai-ac-tags-time';
const TAG_CACHE_MAX_AGE_MS = 86400000;
const TAG_CACHE_LIMIT = 30000;
const TAG_CACHE_LOCAL_LIMIT = 6000;

function slimTagForCache(tag) {
  return {
    tag: tag.tag,
    category: tag.category,
    postCount: tag.postCount,
    translation: tag.translation || '',
    aliases: Array.isArray(tag.aliases) ? tag.aliases.slice(0, 4) : [],
  };
}

function parseStoredTagCache(raw) {
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) && parsed.length ? parsed : null;
}

function storageGetLocalValues(keys) {
  return new Promise(resolve => {
    try {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, result => resolve(result || {}));
    } catch (error) {
      resolve({});
    }
  });
}

function storageSetLocalValues(data) {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome?.storage?.local) {
        reject(new Error('chrome.storage.local unavailable'));
        return;
      }
      chrome.storage.local.set(data, () => {
        const message = chrome?.runtime?.lastError?.message;
        if (message) reject(new Error(message));
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function readTagCache() {
  try {
    const stored = await storageGetLocalValues([TAG_CACHE_KEY, TAG_CACHE_TIME_KEY]);
    const cacheTime = parseInt(stored[TAG_CACHE_TIME_KEY], 10);
    if (cacheTime && Date.now() - cacheTime < TAG_CACHE_MAX_AGE_MS) {
      const parsed = parseStoredTagCache(stored[TAG_CACHE_KEY]);
      if (parsed) return parsed;
    }
  } catch (error) {}

  try {
    const cached = localStorage.getItem(TAG_CACHE_KEY);
    const cacheTime = localStorage.getItem(TAG_CACHE_TIME_KEY);
    if (cached && cacheTime && Date.now() - parseInt(cacheTime, 10) < TAG_CACHE_MAX_AGE_MS) {
      const parsed = parseStoredTagCache(cached);
      if (parsed) {
        storageSetLocalValues({
          [TAG_CACHE_KEY]: parsed.map(slimTagForCache),
          [TAG_CACHE_TIME_KEY]: parseInt(cacheTime, 10),
        }).catch(() => {});
        return parsed;
      }
    }
  } catch (error) {}

  return null;
}

async function writeTagCache(tags) {
  const slimmed = tags.slice(0, TAG_CACHE_LIMIT).map(slimTagForCache);
  const cacheTime = Date.now();

  try {
    await storageSetLocalValues({
      [TAG_CACHE_KEY]: slimmed,
      [TAG_CACHE_TIME_KEY]: cacheTime,
    });
    return 'chrome.storage';
  } catch (error) {}

  try {
    localStorage.setItem(TAG_CACHE_KEY, JSON.stringify(slimmed.slice(0, TAG_CACHE_LOCAL_LIMIT)));
    localStorage.setItem(TAG_CACHE_TIME_KEY, String(cacheTime));
    return 'localStorage';
  } catch (error) {
    console.warn('[NAI-AC] 标签缓存写入失败，将仅使用内存数据:', error);
    return null;
  }
}

function notifyTagsReady() {
  // 覆盖层的分类着色用的是同一份词典，直接把内存里这份交给流，不再从 storage 读第二份
  flowSetDictionary(allTags);
  if (activeEditor?.isConnected) {
    refreshAutocomplete(activeEditor);
  }
  if (activeEditor?.isConnected) renderPromptBlockPanelSoon(activeEditor);
}

// 加载标签
async function loadTags() {
  try {
    const cached = await readTagCache();
    if (cached) {
      allTags = cached;
      isLoading = false;
      console.log(`[NAI-AC] 已从缓存加载 ${allTags.length} 个标签`);
      notifyTagsReady();
      return;
    }

    const response = await fetch(CONFIG.CSV_URL);
    const text = await response.text();
    const lines = text.split('\n');
    allTags = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = parseCSVLine(line);
      if (parts[0]) {
        allTags.push({
          tag: parts[0].trim(),
          category: parts[1]?.trim() || '0',
          postCount: parseInt(parts[2]) || 0,
          aliases: parts[3]?.split(',').map(a => a.trim()).filter(Boolean) || [],
          translation: parts[4]?.split('|')[0]?.trim() || '',
        });
      }
    }

    allTags.sort((a, b) => b.postCount - a.postCount);
    isLoading = false;

    const cacheTarget = await writeTagCache(allTags);
    console.log(
      `[NAI-AC] 已加载 ${allTags.length} 个标签${cacheTarget ? `，缓存至 ${cacheTarget}` : '（未缓存）'}`,
    );
    notifyTagsReady();
  } catch (e) {
    console.error('[NAI-AC] 标签加载失败:', e);
    isLoading = false;
    notifyTagsReady();
  }
}

// 搜索标签
function searchTags(query) {
  if (!query || query.length < CONFIG.MIN_QUERY_LENGTH) return [];
  if (String(query || '').startsWith('@')) return [];
  const q = query.toLowerCase().replace(/_/g, ' ');
  const results = [];

  promptLibrary.forEach(entry => {
    const keys = getPromptLibrarySearchKeys(entry);
    let score = 0;
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().replace(/_/g, ' ');
      if (normalizedKey === q) {
        score = Math.max(score, 3000);
      } else if (normalizedKey.startsWith(q)) {
        score = Math.max(score, 2400);
      } else if (normalizedKey.includes(q)) {
        score = Math.max(score, 1800);
      }
    }

    if (score > 0) {
      results.push({
        ...entry,
        resultType: 'prompt-library',
        category: 'library',
        translation: getPromptLibrarySummary(entry),
        postCount: entry.tags.length,
        score: score + entry.tags.length / 100,
      });
    }
  });

  for (const tag of allTags) {
    if (results.length >= CONFIG.MAX_RESULTS * 3) break;
    const t = tag.tag.toLowerCase().replace(/_/g, ' ');
    const tr = tag.translation?.toLowerCase() || '';
    const aliases = tag.aliases || [];

    if (t.startsWith(q)) {
      results.push({ ...tag, score: 1000 + tag.postCount / 1e6 });
    } else if (t.includes(q)) {
      results.push({ ...tag, score: 500 + tag.postCount / 1e6 });
    } else if (tr.includes(q)) {
      results.push({ ...tag, score: 300 + tag.postCount / 1e6 });
    } else if (aliases.some(a => a.toLowerCase().replace(/_/g, ' ').includes(q))) {
      results.push({ ...tag, score: 200 + tag.postCount / 1e6, matchedAlias: aliases.find(a => a.toLowerCase().includes(q)) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, CONFIG.MAX_RESULTS);
}

// 创建补全容器
