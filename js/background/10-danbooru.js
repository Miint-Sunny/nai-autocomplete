// danbooru 作为查表的第二条渠道。
//
// 本地那份 CSV 是主力：三万条、离线、快。但它是快照 —— 冷门 tag、新 tag、
// 以及已经被合并掉的旧写法都查不到，而这几类正是模型最容易编错的。
// 所以只在**本地查不到**时才问 danbooru，查到什么算什么。
//
// 两条通道，不用第三方中转（那等于把查询内容送给别人）：
//   1. 后台直连 —— host_permissions 是 <all_urls>，不受 CORS 限制
//   2. 借用户自己打开着的 danbooru 标签页 —— 带着他的登录态，
//      限流额度更高，也能看到他账号可见的内容
//
// danbooru 的礼节：别超过 10 请求/秒。这里靠「只在本地未命中时查」+ 结果缓存来自律。

const DANBOORU_BASE = 'https://danbooru.donmai.us';
const DANBOORU_TIMEOUT_MS = 8000;
const DANBOORU_CACHE_TTL_MS = 10 * 60 * 1000;
const DANBOORU_CACHE_LIMIT = 200;
const DANBOORU_RESULT_LIMIT = 8;

const danbooruCache = new Map();

function readDanbooruCache(key) {
  const hit = danbooruCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    danbooruCache.delete(key);
    return null;
  }
  // 命中就挪到末尾，下面淘汰时先扔最久没用的
  danbooruCache.delete(key);
  danbooruCache.set(key, hit);
  return hit.value;
}

function writeDanbooruCache(key, value) {
  danbooruCache.set(key, { value, expires: Date.now() + DANBOORU_CACHE_TTL_MS });
  while (danbooruCache.size > DANBOORU_CACHE_LIMIT) {
    danbooruCache.delete(danbooruCache.keys().next().value);
  }
  return value;
}

function buildDanbooruUrl(path, params) {
  const url = new URL(path, DANBOORU_BASE);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// danbooru 的 tag 用下划线；用户和模型经常写空格
function normalizeDanbooruName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function parseDanbooruJson(text) {
  const body = String(text || '').trim();
  if (!body.startsWith('[') && !body.startsWith('{')) {
    throw new Error(`danbooru 返回的不是 JSON：${body.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
  return JSON.parse(body);
}

async function danbooruDirectFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DANBOORU_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`danbooru 直连返回 HTTP ${response.status}`);
    // 走 text + parse，不用 response.json()：限流或被中间设备拦截时
    // danbooru 会回一段 HTML，json() 抛出来的错看不出发生了什么
    return parseDanbooruJson(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

function queryDanbooruTabs() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: `${DANBOORU_BASE}/*` }, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch (error) {
      resolve([]);
    }
  });
}

// 在用户自己的 danbooru 标签页里发请求：同源，浏览器会自动带上他的 cookie。
async function danbooruTabFetch(url) {
  const tabs = await queryDanbooruTabs();
  const tab = tabs.find((entry) => entry?.id != null);
  if (!tab) throw new Error('没有打开着的 danbooru 标签页');
  if (!chrome.scripting?.executeScript) throw new Error('当前环境不支持 scripting');

  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [url],
    func: async (target) => {
      try {
        const response = await fetch(target, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true, text: await response.text() };
      } catch (error) {
        return { ok: false, message: String(error?.message || error) };
      }
    },
  });

  const result = injected?.[0]?.result;
  if (!result?.ok) {
    throw new Error(result?.status ? `标签页通道返回 HTTP ${result.status}` : (result?.message || '标签页通道失败'));
  }
  return parseDanbooruJson(result.text);
}

async function danbooruFetchJson(path, params) {
  const url = buildDanbooruUrl(path, params);
  const cached = readDanbooruCache(url);
  if (cached) return cached;

  const failures = [];
  for (const channel of [danbooruDirectFetch, danbooruTabFetch]) {
    try {
      return writeDanbooruCache(url, await channel(url));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`danbooru 查询失败：${failures.join('；')}`);
}

function toDanbooruEntry(row) {
  return {
    tag: String(row?.name || ''),
    category: String(row?.category ?? '0'),
    posts: Number(row?.post_count) || 0,
    zh: '',
    source: 'danbooru',
  };
}

// 先精确查，没有再前缀查 —— 模型多半是想确认「这个写法存在吗」，
// 精确命中就该直接回答，别拿一串前缀近似把它带偏。
async function searchDanbooruTags(query, limit = DANBOORU_RESULT_LIMIT) {
  const name = normalizeDanbooruName(query);
  if (!name || !/^[a-z0-9_().\-'!:]+$/.test(name)) return [];

  const exact = await danbooruFetchJson('/tags.json', {
    'search[name]': name,
    limit: 1,
  });
  if (Array.isArray(exact) && exact.length) return exact.map(toDanbooruEntry);

  const prefix = await danbooruFetchJson('/tags.json', {
    'search[name_matches]': `${name}*`,
    'search[order]': 'count',
    'search[hide_empty]': 'yes',
    limit,
  });
  return (Array.isArray(prefix) ? prefix : []).map(toDanbooruEntry).filter((entry) => entry.tag);
}

// 旧写法被合并掉时，danbooru 会留一条 alias。模型写出废弃 tag 的时候
// 直接告诉它标准写法，比只回一句 not_found 有用得多。
async function resolveDanbooruAlias(query) {
  const name = normalizeDanbooruName(query);
  if (!name) return null;

  const rows = await danbooruFetchJson('/tag_aliases.json', {
    'search[antecedent_name]': name,
    'search[status]': 'active',
    limit: 1,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  const target = String(row?.consequent_name || '');
  return target ? { from: name, to: target } : null;
}

// 给 Agent 工具用的入口：本地没查到的词才走到这里。
// 任何一步失败都返回 null —— 查证是加分项，不该让整轮生成挂掉。
async function lookupTagOnDanbooru(query) {
  try {
    const alias = await resolveDanbooruAlias(query);
    if (alias) {
      const canonical = await searchDanbooruTags(alias.to, 1);
      return {
        status: 'alias',
        note: `danbooru 上 ${alias.from} 已合并到 ${alias.to}，请用后者`,
        matches: canonical.length ? canonical : [{ tag: alias.to, category: '0', posts: 0, zh: '', source: 'danbooru' }],
      };
    }

    const matches = await searchDanbooruTags(query);
    if (matches.length) return { status: 'found', matches };
    return null;
  } catch (error) {
    return null;
  }
}
