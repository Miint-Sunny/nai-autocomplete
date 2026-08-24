/* ================= 数据存取（chrome.storage，容量大） ================= */
const KEY = 'naiArtistTracker_v1';
// 词库是自动补全那边存的，这里只读不写 —— 手机版导出要带上它
const PROMPT_LIBRARY_KEY = 'nai-shared-prompt-library';
let data = { artists: [], labels: [], artistStrings: [] };
let promptLibrary = [];
let currentArtistId = null;
let editingArtistId = null;
let editingCategories = [];
let selectedLabelFilters = [];
let tempImgs = { original: null, nai: null };
let pendingLibraryImport = null;

function cleanLabelName(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function labelKey(value) { return cleanLabelName(value).toLocaleLowerCase(); }
function uniqueLabels(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map(item => cleanLabelName(typeof item === 'object' ? item?.name : item)).filter(name => {
    const key = labelKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function attachOriginalToEntry(entry, original) {
  if (!entry || !original) return false;
  entry.originalImg = original.originalImg || null;
  if (original.sourcePostId) entry.sourcePostId = original.sourcePostId;
  if (original.sourcePostUrl) entry.sourcePostUrl = original.sourcePostUrl;
  if (original.sourceImageUrl) entry.sourceImageUrl = original.sourceImageUrl;
  if (!entry.prompt && original.prompt) entry.prompt = original.prompt;
  if (!Number(entry.score) && Number(original.score)) entry.score = original.score;
  const existingComment = String(entry.comment || '').trim();
  const originalComment = String(original.comment || '').trim();
  if (originalComment && !existingComment.includes(originalComment)) {
    entry.comment = [existingComment, originalComment].filter(Boolean).join('\n');
  }
  return true;
}
function alignArtistComparisonEntries(artist) {
  if (!artist || !Array.isArray(artist.entries)) return 0;
  const generatedOnly = artist.entries.slice().reverse().filter(entry => entry?.naiImg && !entry.originalImg);
  const originalsOnly = artist.entries.slice().reverse().filter(entry => !entry?.naiImg && (entry?.originalImg || entry?.sourcePostId));
  const consumed = new Set();
  for (const entry of generatedOnly) {
    const original = originalsOnly.shift();
    if (!original) break;
    attachOriginalToEntry(entry, original);
    consumed.add(original);
  }
  if (consumed.size) artist.entries = artist.entries.filter(entry => !consumed.has(entry));
  return consumed.size;
}
function ensureDataShape() {
  if (!data || typeof data !== 'object') data = { artists: [], labels: [], artistStrings: [] };
  if (!Array.isArray(data.artists)) data.artists = [];
  if (!Array.isArray(data.artistStrings)) data.artistStrings = [];
  if (!Array.isArray(data.pages) || !data.pages.length) {
    const id = `page_${uid()}`;
    data.pages = [{ id, name: '我的画师库' }];
    data.activePageId = id;
  }
  const seenPageIds = new Set();
  data.pages = data.pages.filter(page => page && typeof page === 'object').map((page, index) => {
    let id = String(page.id || '').trim();
    if (!id || seenPageIds.has(id)) id = `page_${uid()}`;
    seenPageIds.add(id);
    return { ...page, id, name: cleanLabelName(page.name) || `画师库 ${index + 1}` };
  });
  if (!data.pages.length) {
    const id = `page_${uid()}`;
    data.pages.push({ id, name: '我的画师库' });
  }
  if (!data.pages.some(page => page.id === data.activePageId)) data.activePageId = data.pages[0].id;
  for (const page of data.pages) {
    if (page.id === data.activePageId) {
      delete page.artists;
      delete page.labels;
      delete page.artistStrings;
      continue;
    }
    if (!Array.isArray(page.artists)) page.artists = [];
    if (!Array.isArray(page.artistStrings)) page.artistStrings = [];
    page.labels = uniqueLabels(Array.isArray(page.labels) ? page.labels : []);
  }
  data.labels = uniqueLabels([...(Array.isArray(data.labels) ? data.labels : []), ...(Array.isArray(data.categories) ? data.categories : [])]);
  for (const artist of data.artists) {
    artist.categories = uniqueLabels([...(Array.isArray(artist.categories) ? artist.categories : []), ...(Array.isArray(artist.labels) ? artist.labels : [])]);
    if (!Array.isArray(artist.entries)) artist.entries = [];
    alignArtistComparisonEntries(artist);
    for (const name of artist.categories) if (!data.labels.some(label => labelKey(label) === labelKey(name))) data.labels.push(name);
  }
  for (const record of data.artistStrings) {
    record.categories = uniqueLabels([...(Array.isArray(record.categories) ? record.categories : []), ...(Array.isArray(record.labels) ? record.labels : [])]);
    for (const name of record.categories) if (!data.labels.some(label => labelKey(label) === labelKey(name))) data.labels.push(name);
  }
  data.labels.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function currentLibraryPage() {
  ensureDataShape();
  return data.pages.find(page => page.id === data.activePageId) || data.pages[0];
}

function uniqueLibraryPageName(name, ignoredId = '') {
  const base = cleanLabelName(name).slice(0, 40) || '新画师库';
  let result = base;
  let number = 2;
  while (data.pages.some(page => page.id !== ignoredId && labelKey(page.name) === labelKey(result))) {
    const suffix = ` (${number++})`;
    result = base.slice(0, 40 - suffix.length) + suffix;
  }
  return result;
}

function renderLibraryPages() {
  const selector = document.getElementById('libraryPageSelect');
  if (!selector) return;
  selector.innerHTML = data.pages.map(page => {
    const count = page.id === data.activePageId ? data.artists.length : (page.artists || []).length;
    return `<option value="${esc(page.id)}"${page.id === data.activePageId ? ' selected' : ''}>${esc(page.name)} · ${count} 人</option>`;
  }).join('');
  selector.value = data.activePageId;
  const deleteButton = document.getElementById('deleteLibraryPageBtn');
  if (deleteButton) {
    deleteButton.disabled = data.pages.length <= 1;
    deleteButton.title = data.pages.length <= 1 ? '至少保留一个画师库页面' : '删除当前页面及其中全部画师、分类和画师串';
  }
}

function refreshCurrentLibraryPage() {
  currentArtistId = null;
  selectedLabelFilters = [];
  selectedArtistStringLabels = [];
  editingCategories = [];
  editingArtistStringCategories = [];
  document.getElementById('searchBox').value = '';
  document.getElementById('ratingFilter').value = '';
  document.getElementById('labelMatchMode').value = 'any';
  document.getElementById('artistStringSearch').value = '';
  document.getElementById('stringLabelMatchMode').value = 'any';
  renderLibraryPages();
  renderLabelFilters();
  renderLabelManager();
  renderArtistStringLabelFilters();
  renderArtistStringCategoryPicker();
  renderList();
  renderArtist();
  renderArtistStrings();
}

function switchLibraryPage(id, { persist = true, refresh = true } = {}) {
  ensureDataShape();
  const next = data.pages.find(page => page.id === id);
  if (!next) return false;
  if (next.id !== data.activePageId) {
    const current = data.pages.find(page => page.id === data.activePageId);
    current.artists = data.artists;
    current.labels = data.labels;
    current.artistStrings = data.artistStrings;
    data.artists = Array.isArray(next.artists) ? next.artists : [];
    data.labels = Array.isArray(next.labels) ? next.labels : [];
    data.artistStrings = Array.isArray(next.artistStrings) ? next.artistStrings : [];
    delete next.artists;
    delete next.labels;
    delete next.artistStrings;
    data.activePageId = next.id;
  }
  if (refresh) refreshCurrentLibraryPage();
  if (persist) save();
  return true;
}

function createLibraryPage(name, { activate = true, persist = true, refresh = true } = {}) {
  ensureDataShape();
  const page = { id: `page_${uid()}`, name: uniqueLibraryPageName(name), artists: [], labels: [], artistStrings: [] };
  data.pages.push(page);
  if (activate) switchLibraryPage(page.id, { persist, refresh });
  else {
    if (refresh) renderLibraryPages();
    if (persist) save();
  }
  return data.pages.find(item => item.id === page.id);
}

function renameLibraryPage(id, name) {
  ensureDataShape();
  const page = data.pages.find(item => item.id === id);
  const next = cleanLabelName(name);
  if (!page || !next) return false;
  if (next.length > 40) { toast('页面名字最多 40 个字'); return false; }
  if (data.pages.some(item => item.id !== id && labelKey(item.name) === labelKey(next))) { toast('已经有同名页面'); return false; }
  page.name = next;
  save();
  renderLibraryPages();
  toast(`页面已改名为：${next}`);
  return true;
}

function deleteLibraryPage(id) {
  ensureDataShape();
  const index = data.pages.findIndex(page => page.id === id);
  if (index < 0) return false;
  if (data.pages.length <= 1) { toast('至少保留一个画师库页面，不能删除最后一页'); return false; }
  const page = data.pages[index];
  const artists = page.id === data.activePageId ? data.artists : page.artists || [];
  const strings = page.id === data.activePageId ? data.artistStrings : page.artistStrings || [];
  if (!confirm(`确定删除页面「${page.name}」吗？\n\n其中 ${artists.length} 位画师和 ${strings.length} 条画师串都会被删除。\n此操作无法撤销，建议先进行完整备份。`)) return false;
  if (page.id === data.activePageId) {
    const next = data.pages[index > 0 ? index - 1 : index + 1];
    switchLibraryPage(next.id, { persist: false, refresh: false });
  }
  data.pages = data.pages.filter(item => item.id !== id);
  refreshCurrentLibraryPage();
  save();
  toast(`已删除页面：${page.name}`);
  return true;
}

function load(cb) {
  chrome.storage.local.get([KEY, PROMPT_LIBRARY_KEY], res => {
    try {
      if (res[KEY]) data = JSON.parse(res[KEY]);
      ensureDataShape();
    } catch (e) { console.error(e); }
    promptLibrary = Array.isArray(res[PROMPT_LIBRARY_KEY]) ? res[PROMPT_LIBRARY_KEY] : [];
    cb();
  });
}
function save() {
  const str = JSON.stringify(data);
  chrome.storage.local.set({ [KEY]: str }, () => {
    if (chrome.runtime.lastError) {
      alert('⚠️ 保存失败：' + chrome.runtime.lastError.message + '\n建议先「完整备份」，再删掉一些旧记录。');
    }
    updateStorageText();
  });
}
function updateStorageText() {
  chrome.storage.local.getBytesInUse(null, bytes => {
    const allStrings = [...data.artistStrings, ...data.pages.filter(page => page.id !== data.activePageId).flatMap(page => page.artistStrings || [])];
    const originals = allStrings.filter(record => record.originalImage);
    const originalBytes = originals.reduce((total, record) => {
      if (Number(record.originalImageBytes) > 0) return total + Number(record.originalImageBytes);
      const payload = String(record.originalImage || '').split(',')[1] || '';
      return total + Math.max(0, Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0));
    }, 0);
    const used = (bytes / 1024 / 1024).toFixed(1);
    const raw = (originalBytes / 1024 / 1024).toFixed(1);
    const text = `已用 ${used} MB · 无损原图 ${originals.length} 张 / ${raw} MB\n无固定 10 MB 上限，受磁盘剩余空间影响`;
    document.getElementById('storageText').textContent = text;
    const stringUsage = document.getElementById('artistStringStorageText');
    if (stringUsage) stringUsage.textContent = `总占用 ${used} MB · 已保存 ${originals.length} 张无损原图（原始大小 ${raw} MB）· 无固定 10 MB 上限`;
  });
}

