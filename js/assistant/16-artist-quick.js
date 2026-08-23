// 画师库快速入口：复用完整画师库（pages/artist-library.html）的数据，
// 只提供检索和「追加到提示词」，不再单独常驻悬浮窗。
const ARTIST_LIBRARY_KEY = 'naiArtistTracker_v1';
const ARTIST_QUICK_PAGE_SIZE = 60;
const ARTIST_QUICK_EMPTY_LIBRARY = { artists: [], labels: [], artistStrings: [], pages: [], activePageId: '' };

function normalizeArtistQuickText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function artistQuickPageList() {
  const pages = state.artistQuick.library.pages;
  if (Array.isArray(pages) && pages.length) return pages;
  return [{ id: state.artistQuick.library.activePageId || 'default', name: '我的画师库' }];
}

// 当前页的数据存在 library 顶层，其余页各自带着自己的 artists/labels/artistStrings。
function artistQuickPageContent() {
  const library = state.artistQuick.library;
  const pages = artistQuickPageList();
  const selected = pages.find((page) => page.id === state.artistQuick.pageId)
    || pages.find((page) => page.id === library.activePageId)
    || pages[0];
  state.artistQuick.pageId = selected.id;

  const isActivePage = selected.id === library.activePageId || !Array.isArray(library.pages) || !library.pages.length;
  const source = isActivePage ? library : selected;
  return {
    page: selected,
    artists: Array.isArray(source.artists) ? source.artists : [],
    labels: Array.isArray(source.labels) ? source.labels : [],
    artistStrings: Array.isArray(source.artistStrings) ? source.artistStrings : [],
  };
}

function artistQuickThumbnail(artist) {
  const entries = Array.isArray(artist?.entries) ? artist.entries : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.originalImg) return entries[index].originalImg;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.naiImg) return entries[index].naiImg;
  }
  return '';
}

function filteredArtistQuickRecords(content) {
  const query = normalizeArtistQuickText(state.artistQuick.search);
  const rating = Number(state.artistQuick.rating) || 0;
  const isArtists = state.artistQuick.mode === 'artists';
  const records = isArtists ? content.artists : content.artistStrings;

  return records.filter((record) => {
    const categories = Array.isArray(record.categories) ? record.categories : [];
    if (state.artistQuick.category
      && !categories.some((label) => normalizeArtistQuickText(label) === normalizeArtistQuickText(state.artistQuick.category))) {
      return false;
    }
    if (isArtists && rating && (Number(record.rating) || 0) < rating) return false;
    if (!query) return true;
    const fields = isArtists
      ? [record.name, record.tag, record.notes, ...categories]
      : [record.title, record.artistString, record.notes, ...categories];
    return fields.some((field) => normalizeArtistQuickText(field).includes(query));
  }).sort((a, b) => (isArtists
    ? (Number(b.rating) || 0) - (Number(a.rating) || 0)
      || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    : (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0)));
}

function artistQuickRecordMarkup(record) {
  const id = escapeHtml(String(record.id ?? ''));
  const categories = Array.isArray(record.categories) ? record.categories : [];
  const labels = categories.length
    ? `<div class="nai-artist-quick-labels">${categories.map(escapeHtml).join(' · ')}</div>`
    : '';
  const actions = `<div class="nai-artist-quick-actions">`
    + `<button type="button" class="nai-md3-inline-action nai-artist-quick-add" data-artist-action="insert" data-id="${id}" title="追加到当前提示词">＋</button>`
    + `<button type="button" class="nai-md3-inline-action nai-artist-quick-copy" data-artist-action="copy" data-id="${id}" title="复制到剪切板">\u{1f4cb}</button>`
    + `</div>`;

  if (state.artistQuick.mode === 'strings') {
    return `<article class="nai-artist-quick-card is-string" data-artist-action="insert" data-id="${id}">`
      + `<div class="nai-artist-quick-info">`
      + `<div class="nai-artist-quick-name">${escapeHtml(record.title || '未命名画师串')}</div>`
      + `<div class="nai-artist-quick-snippet">${escapeHtml(record.artistString || '')}</div>${labels}</div>${actions}</article>`;
  }

  const image = artistQuickThumbnail(record);
  const initial = escapeHtml(Array.from(String(record.name || record.tag || '?'))[0] || '?');
  const picture = image
    ? `<img class="nai-artist-quick-thumb" loading="lazy" decoding="async" src="${escapeHtml(image)}" alt="" />`
    : `<span class="nai-artist-quick-thumb is-placeholder">${initial}</span>`;
  const stars = Math.max(0, Math.min(5, Number(record.rating) || 0));

  return `<article class="nai-artist-quick-card" data-artist-action="insert" data-id="${id}">${picture}`
    + `<div class="nai-artist-quick-info">`
    + `<div class="nai-artist-quick-name">${escapeHtml(record.name || record.tag || '未命名画师')}</div>`
    + `<div class="nai-artist-quick-tag">${escapeHtml(record.tag || '未填写 tag')}</div>`
    + `<div class="nai-artist-quick-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>${labels}</div>${actions}</article>`;
}

// 同一份结构复用两次：反推面板的「画师库」页 和 NAI 工作台抽屉的「画师库」窗口。
function artistQuickMarkup() {
  return `
    <div class="nai-artist-quick">
      <div class="nai-artist-quick-bar">
        <select class="nai-md3-input nai-artist-quick-page" data-artist-field="page" aria-label="\u753b\u5e08\u5e93\u9875\u9762"></select>
        <button type="button" class="nai-md3-inline-action nai-artist-quick-manage" data-artist-action="manage">${T.artistQuickManage}</button>
      </div>
      <nav class="nai-md3-tabs nai-artist-quick-modes">
        <button type="button" class="active" data-artist-action="mode" data-mode="artists">${T.artistQuickModeArtists}</button>
        <button type="button" data-artist-action="mode" data-mode="strings">${T.artistQuickModeStrings}</button>
      </nav>
      <div class="nai-artist-quick-filters">
        <input class="nai-md3-input nai-artist-quick-search" type="search" data-artist-field="search" />
        <select class="nai-md3-input nai-artist-quick-rating" data-artist-field="rating" aria-label="\u661f\u7ea7\u7b5b\u9009">
          <option value="">${T.artistQuickAllRatings}</option>
          <option value="5">\u2605\u2605\u2605\u2605\u2605</option>
          <option value="4">\u2605\u2605\u2605\u2605+</option>
          <option value="3">\u2605\u2605\u2605+</option>
          <option value="2">\u2605\u2605+</option>
          <option value="1">\u2605+</option>
        </select>
      </div>
      <div class="nai-artist-quick-categories" data-artist-field="categories"></div>
      <div class="nai-artist-quick-summary" data-artist-field="summary"></div>
      <div class="nai-artist-quick-list" data-artist-field="list"></div>
      <div class="nai-artist-quick-foot">${T.artistQuickHint}</div>
    </div>`;
}

function artistQuickHosts() {
  return (ui.artist?.hosts || []).filter((host) => host?.isConnected);
}

function renderArtistQuickPanel() {
  const hosts = artistQuickHosts();
  if (!hosts.length) return;

  const content = artistQuickPageContent();
  const isArtists = state.artistQuick.mode === 'artists';
  const records = filteredArtistQuickRecords(content);
  const total = isArtists ? content.artists.length : content.artistStrings.length;
  const visible = records.slice(0, state.artistQuick.visibleCount);

  const presentCategories = new Set(
    (isArtists ? content.artists : content.artistStrings)
      .flatMap((record) => (Array.isArray(record.categories) ? record.categories.map(normalizeArtistQuickText) : [])),
  );
  const categories = (content.labels || []).filter((label) => presentCategories.has(normalizeArtistQuickText(label)));
  if (state.artistQuick.category
    && !categories.some((label) => normalizeArtistQuickText(label) === normalizeArtistQuickText(state.artistQuick.category))) {
    state.artistQuick.category = '';
  }

  const pageOptions = artistQuickPageList()
    .map((page) => `<option value="${escapeHtml(page.id)}"${page.id === content.page.id ? ' selected' : ''}>${escapeHtml(page.name || '画师库')}</option>`)
    .join('');
  const categoriesHtml = categories
    .map((label) => `<button type="button" class="nai-md3-inline-action nai-artist-quick-chip${normalizeArtistQuickText(label) === normalizeArtistQuickText(state.artistQuick.category) ? ' is-active' : ''}" data-artist-action="category" data-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
    .join('');
  const summary = `${records.length} / ${total} ${isArtists ? '位画师' : '条画师串'} · ${content.page.name}`;
  const listHtml = visible.length
    ? visible.map(artistQuickRecordMarkup).join('')
      + (records.length > visible.length
        ? `<button type="button" class="nai-md3-inline-action nai-artist-quick-more" data-artist-action="more">显示更多，还有 ${records.length - visible.length} 条</button>`
        : '')
    : `<div class="nai-artist-quick-empty">${state.artistQuick.loaded
      ? (total ? '没有符合条件的记录' : (isArtists ? '这一页还没有画师' : '这一页还没有画师串'))
      : '正在读取画师库…'}</div>`;

  hosts.forEach((host) => {
    const pageSelect = host.querySelector('[data-artist-field="page"]');
    if (pageSelect) {
      pageSelect.innerHTML = pageOptions;
      pageSelect.value = content.page.id;
    }
    const searchInput = host.querySelector('[data-artist-field="search"]');
    if (searchInput) {
      if (searchInput.value !== state.artistQuick.search) searchInput.value = state.artistQuick.search;
      searchInput.placeholder = isArtists ? '搜索名字、tag、分类' : '搜索画师串、标题、分类';
    }
    const ratingSelect = host.querySelector('[data-artist-field="rating"]');
    if (ratingSelect) {
      ratingSelect.value = state.artistQuick.rating ? String(state.artistQuick.rating) : '';
      ratingSelect.classList.toggle('nai-hidden', !isArtists);
    }
    host.querySelectorAll('[data-artist-action="mode"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === state.artistQuick.mode);
    });
    const categoriesBox = host.querySelector('[data-artist-field="categories"]');
    if (categoriesBox) categoriesBox.innerHTML = categoriesHtml;
    const summaryBox = host.querySelector('[data-artist-field="summary"]');
    if (summaryBox) summaryBox.textContent = summary;
    const listBox = host.querySelector('[data-artist-field="list"]');
    if (listBox) listBox.innerHTML = listHtml;
  });
}

function applyArtistQuickLibrary(rawValue) {
  try {
    const parsed = rawValue ? JSON.parse(rawValue) : null;
    state.artistQuick.library = parsed && typeof parsed === 'object'
      ? { ...ARTIST_QUICK_EMPTY_LIBRARY, ...parsed }
      : { ...ARTIST_QUICK_EMPTY_LIBRARY };
  } catch (error) {
    state.artistQuick.library = { ...ARTIST_QUICK_EMPTY_LIBRARY };
  }
}

// 画师库可能很大（含无损原图），只在用户真正打开这一页时才读取。
async function ensureArtistQuickLibrary(force = false) {
  if (state.artistQuick.loaded && !force) return;
  if (!ensureExtensionContext()) return;
  const data = await storageGet([ARTIST_LIBRARY_KEY]);
  applyArtistQuickLibrary(data?.[ARTIST_LIBRARY_KEY]);
  state.artistQuick.loaded = true;
}

function openArtistQuickPanel() {
  ensureArtistQuickLibrary()
    .then(() => renderArtistQuickPanel())
    .catch((error) => {
      markContextInvalidated(error);
      setStatus(T.statusContextInvalidated, true);
    });
  renderArtistQuickPanel();
}

function isArtistQuickEditable(element) {
  if (!element || element === ui.root || element.disabled || element.readOnly) return false;
  if (ui.root?.contains(element)) return false;
  if (element.tagName === 'TEXTAREA') return true;
  if (element.tagName === 'INPUT') {
    return !['hidden', 'checkbox', 'radio', 'submit', 'button'].includes(String(element.type || '').toLowerCase());
  }
  return element.isContentEditable
    || element.getAttribute?.('contenteditable') === 'true'
    || element.getAttribute?.('role') === 'textbox';
}

function isArtistQuickNegativeField(element) {
  const details = [
    element.id, element.name, element.className,
    element.getAttribute?.('placeholder'), element.getAttribute?.('aria-label'), element.getAttribute?.('data-testid'),
  ].join(' ').toLowerCase();
  return /negative|undesired|\buc\b|反向|负面/.test(details);
}

function findArtistQuickPromptField() {
  const remembered = state.artistQuick.lastPromptField;
  if (remembered?.isConnected && isArtistQuickEditable(remembered) && !isArtistQuickNegativeField(remembered)) {
    return remembered;
  }
  const known = document.getElementById('prompt');
  if (isArtistQuickEditable(known) && !isArtistQuickNegativeField(known)) return known;

  const fields = Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'))
    .filter((field) => isArtistQuickEditable(field) && !isArtistQuickNegativeField(field));
  const named = fields.find((field) => /prompt|caption|提示词|描述|image generation/i.test([
    field.id, field.name, field.className,
    field.getAttribute?.('placeholder'), field.getAttribute?.('aria-label'), field.getAttribute?.('data-testid'),
  ].join(' ')));
  return named || fields.find((field) => field.tagName === 'TEXTAREA' || field.isContentEditable) || null;
}

function joinArtistQuickPrompt(current, value) {
  const existing = String(current || '').trimEnd();
  if (!existing) return value;
  return `${existing}${existing.endsWith(',') || existing.endsWith('，') ? ' ' : ', '}${value}`;
}

// 追加和整段替换共用一套写入逻辑：画师是往后追加，Agent 写出来的整版提示词是替换。
// 网站的输入框可能是 textarea / input / contenteditable，三种都得走原生 setter + input 事件，
// 否则 React 那边的状态不会跟着更新。
async function writePromptFieldValue(value, mode = 'append') {
  if (!value) {
    setStatus(T.artistQuickNoTag, true);
    return false;
  }

  const field = findArtistQuickPromptField();
  if (!field) {
    const copied = await copyText(value);
    setStatus(copied ? T.artistQuickCopiedNoField : T.artistQuickCopyFailed, !copied);
    return false;
  }

  const replace = mode === 'replace';

  field.focus?.();
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
    const next = replace ? value : joinArtistQuickPrompt(field.value, value);
    const prototype = field.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(field, next);
    else field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.setSelectionRange?.(next.length, next.length);
  } else {
    const existing = replace ? '' : String(field.innerText || field.textContent || '').trimEnd();
    const addition = existing
      ? `${existing.endsWith(',') || existing.endsWith('，') ? ' ' : ', '}${value}`
      : value;
    const selection = window.getSelection?.();
    if (selection && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(field);
      if (!replace) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    try {
      inserted = Boolean(document.execCommand?.('insertText', false, addition));
    } catch (error) {
      inserted = false;
    }
    if (!inserted) {
      field.textContent = existing + addition;
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  state.artistQuick.lastPromptField = field;
  setStatus(replace ? T.agentPromptWritten : T.artistQuickInserted, false);
  return true;
}

function insertArtistQuickPrompt(value) {
  return writePromptFieldValue(value, 'append');
}

function findArtistQuickRecord(id) {
  const content = artistQuickPageContent();
  const records = state.artistQuick.mode === 'artists' ? content.artists : content.artistStrings;
  return records.find((record) => String(record.id) === String(id));
}

function artistQuickRecordValue(record) {
  return String(state.artistQuick.mode === 'artists' ? record.tag || '' : record.artistString || '').trim();
}

function openFullArtistLibrary() {
  if (!ensureExtensionContext()) return;
  try {
    chrome.runtime.sendMessage({ type: 'nai-open-artist-library' }, () => {
      if (chrome.runtime.lastError) setStatus(T.artistQuickOpenFailed, true);
    });
  } catch (error) {
    markContextInvalidated(error);
    setStatus(T.statusContextInvalidated, true);
  }
}

function handleArtistQuickAction(target) {
  const action = target.dataset.artistAction;

  if (action === 'manage') {
    openFullArtistLibrary();
    return;
  }
  if (action === 'mode') {
    state.artistQuick.mode = target.dataset.mode === 'strings' ? 'strings' : 'artists';
    state.artistQuick.category = '';
    state.artistQuick.visibleCount = ARTIST_QUICK_PAGE_SIZE;
    renderArtistQuickPanel();
    return;
  }
  if (action === 'category') {
    const label = target.dataset.label || '';
    state.artistQuick.category = normalizeArtistQuickText(state.artistQuick.category) === normalizeArtistQuickText(label)
      ? ''
      : label;
    state.artistQuick.visibleCount = ARTIST_QUICK_PAGE_SIZE;
    renderArtistQuickPanel();
    return;
  }
  if (action === 'more') {
    state.artistQuick.visibleCount += ARTIST_QUICK_PAGE_SIZE;
    renderArtistQuickPanel();
    return;
  }
  if (action !== 'insert' && action !== 'copy') return;

  const record = findArtistQuickRecord(target.dataset.id);
  if (!record) return;
  const value = artistQuickRecordValue(record);

  if (action === 'copy') {
    copyText(value).then((ok) => setStatus(ok ? T.artistQuickCopied : T.artistQuickCopyFailed, !ok));
    return;
  }
  insertArtistQuickPrompt(value);
}

function bindArtistQuickEvents(root) {
  ui.artist = ui.artist || {};
  ui.artist.hosts = Array.from(root.querySelectorAll('.nai-artist-quick'));

  root.addEventListener('click', (event) => {
    const target = event.target.closest?.('.nai-artist-quick [data-artist-action]');
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    handleArtistQuickAction(target);
  });

  root.addEventListener('input', (event) => {
    if (event.target.dataset?.artistField !== 'search') return;
    state.artistQuick.search = event.target.value;
    state.artistQuick.visibleCount = ARTIST_QUICK_PAGE_SIZE;
    renderArtistQuickPanel();
  });

  root.addEventListener('change', (event) => {
    const field = event.target.dataset?.artistField;
    if (field === 'rating') {
      state.artistQuick.rating = Number(event.target.value) || 0;
      state.artistQuick.visibleCount = ARTIST_QUICK_PAGE_SIZE;
      renderArtistQuickPanel();
      return;
    }
    if (field !== 'page') return;
    state.artistQuick.pageId = event.target.value;
    state.artistQuick.category = '';
    state.artistQuick.visibleCount = ARTIST_QUICK_PAGE_SIZE;
    renderArtistQuickPanel();
  });

  // 记住用户最后聚焦的提示词框，多输入框页面才能填对位置。
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (isArtistQuickEditable(target) && !isArtistQuickNegativeField(target)) {
      state.artistQuick.lastPromptField = target;
    }
  }, true);
}
