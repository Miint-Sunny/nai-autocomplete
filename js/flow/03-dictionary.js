// 词典。用的是自动补全已经缓存的那份 danbooru 数据（chrome.storage.local['nai-ac-tags']），
// 含 category / postCount / 中文释义。只在流编辑器第一次打开时才加载 —— 三万条数据
// 不该躺在每个网页的内存里。

const FLOW_DICT_KEY = 'nai-ac-tags';

let flowDictList = null;
let flowDictIndex = null;
let flowDictPromise = null;

function flowStorageGet(key) {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.storage?.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get([key], (result) => resolve(result?.[key] ?? null));
    } catch (error) {
      resolve(null);
    }
  });
}

function flowBuildDictIndex(list) {
  const index = new Map();
  for (const entry of list) {
    if (!entry?.tag) continue;
    const key = flowNormalizeTagName(entry.tag);
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

function flowLoadDictionary() {
  if (flowDictPromise) return flowDictPromise;

  flowDictPromise = flowStorageGet(FLOW_DICT_KEY).then((raw) => {
    let list = raw;
    if (typeof raw === 'string') {
      try {
        list = JSON.parse(raw);
      } catch (error) {
        list = null;
      }
    }
    flowDictList = Array.isArray(list) ? list : [];
    flowDictIndex = flowBuildDictIndex(flowDictList);
    return flowDictList;
  });

  return flowDictPromise;
}

try {
  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === 'local' && changes[FLOW_DICT_KEY]) {
      flowDictList = null;
      flowDictIndex = null;
      flowDictPromise = null;
    }
  });
} catch (error) {
  // 没有 storage 事件也不影响，只是缓存不会主动失效
}

// content 脚本自己就把整份词典读进 allTags 了，没必要再从 storage 加载一份到内存。
function flowSetDictionary(list) {
  if (!Array.isArray(list) || !list.length) return;
  flowDictList = list;
  flowDictIndex = flowBuildDictIndex(list);
  flowDictPromise = Promise.resolve(list);
}

function flowDictionaryReady() {
  return Array.isArray(flowDictList);
}

function flowDictionarySize() {
  return flowDictList?.length || 0;
}

// 查不到返回 null，调用方据此把 chip 标成「词典无」
function flowLookupTag(name) {
  if (!flowDictIndex) return null;
  return flowDictIndex.get(flowNormalizeTagName(name)) || null;
}

// 就地改词时的候选。三万条线性扫一遍约 2~3ms，配合防抖足够快，
// 不值得为它再建一套前缀树。
function flowSearchDictionary(query, limit = 8) {
  const raw = String(query || '').trim();
  const q = flowNormalizeTagName(raw);
  if (!q || !flowDictList) return [];

  const results = [];
  for (const entry of flowDictList) {
    if (!entry?.tag) continue;
    const tag = flowNormalizeTagName(entry.tag);
    let score = 0;

    if (tag === q) score = 1000;
    else if (tag.startsWith(q)) score = 600;
    else if (tag.includes(q)) score = 400;
    else if (entry.translation && String(entry.translation).includes(raw)) score = 350;
    else if ((entry.aliases || []).some((alias) => flowNormalizeTagName(alias).startsWith(q))) score = 300;

    if (!score) continue;
    results.push({ entry, score: score + Math.min(99, Math.log10((Number(entry.postCount) || 0) + 1) * 12) });
    if (results.length > 400) break;
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.entry);
}
