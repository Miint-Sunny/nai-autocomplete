/* 独立手机版：整个函数会被序列化到导出的 HTML 中，不依赖扩展 API。 */
function mobileViewerApp() {
  const library = JSON.parse(document.getElementById('nai-mobile-data').textContent);
  const selected = new Set();
  const search = document.getElementById('mobileSearch');
  const rating = document.getElementById('mobileRating');
  const matchMode = document.getElementById('mobileMatch');
  const list = document.getElementById('mobileList');
  const labels = document.getElementById('mobileLabels');
  const summary = document.getElementById('mobileSummary');
  const detail = document.getElementById('mobileDetail');
  const lightbox = document.getElementById('mobileLightbox');
  let strings = Array.isArray(library.artistStrings) ? library.artistStrings : [];
  const originalPage = { artists: library.artists, labels: library.labels, artistStrings: strings };
  const pages = Array.isArray(library.pages) && library.pages.length ? library.pages : [{ id: 'default', name: '我的画师库' }];
  const initialPageId = pages.some(page => page.id === library.activePageId) ? library.activePageId : pages[0].id;
  const pageSelector = document.getElementById('mobilePageSelect');
  const stringSearch = document.getElementById('mobileStringSearch');
  const stringList = document.getElementById('mobileStringList');
  const stringLabels = document.getElementById('mobileStringLabels');
  const stringMatch = document.getElementById('mobileStringMatch');
  const selectedStringLabels = new Set();

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normalize(value) { return String(value || '').trim().toLocaleLowerCase(); }
  function updateSubtitle(pageName) {
    const date = library.exportedAt ? new Date(library.exportedAt).toLocaleDateString('zh-CN') : '';
    document.getElementById('mobileSubtitle').textContent = `${pageName ? `${pageName} · ` : ''}${library.artists.length} 位画师 · ${strings.length} 条画师串 · ${Array.isArray(library.labels) ? library.labels.length : 0} 个分类${date ? ` · ${date} 导出` : ''}`;
  }
  function switchPage(id) {
    const page = pages.find(item => item.id === id);
    if (!page) return;
    const content = id === initialPageId ? originalPage : page;
    library.artists = Array.isArray(content.artists) ? content.artists : [];
    library.labels = Array.isArray(content.labels) ? content.labels : [];
    strings = Array.isArray(content.artistStrings) ? content.artistStrings : [];
    selected.clear();
    selectedStringLabels.clear();
    search.value = '';
    rating.value = '';
    matchMode.value = 'any';
    stringSearch.value = '';
    stringMatch.value = 'any';
    pageSelector.value = id;
    updateSubtitle(page.name);
    renderLabels();
    renderList();
    renderStringLabels();
    renderArtistStrings();
  }
  function categories(artist) { return Array.isArray(artist.categories) ? artist.categories : []; }
  function thumbnail(artist) {
    const entries = Array.isArray(artist.entries) ? artist.entries : [];
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].originalImg) return entries[i].originalImg;
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].naiImg) return entries[i].naiImg;
    return '';
  }
  function stars(artist) {
    const count = Math.max(0, Math.min(5, Number(artist.rating) || 0));
    return '★'.repeat(count) + '☆'.repeat(5 - count);
  }
  function filteredArtists() {
    const query = normalize(search.value);
    const wanted = rating.value;
    return library.artists.filter(artist => {
      const own = categories(artist);
      if (query && ![artist.name, artist.tag, artist.notes, ...own].some(value => normalize(value).includes(query))) return false;
      if (wanted) {
        const value = Number(artist.rating) || 0;
        if (wanted.endsWith('+') ? value < Number(wanted.slice(0, -1)) : value !== Number(wanted)) return false;
      }
      if (!selected.size) return true;
      const matches = [...selected].map(label => label === '__uncategorized__' ? !own.length : own.some(item => normalize(item) === normalize(label)));
      return matchMode.value === 'all' ? matches.every(Boolean) : matches.some(Boolean);
    }).sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
  }
  function renderLabels() {
    const all = [...(Array.isArray(library.labels) ? library.labels : [])];
    if (library.artists.some(artist => !categories(artist).length)) all.push('__uncategorized__');
    labels.innerHTML = all.length ? all.map(label => {
      const count = library.artists.filter(artist => label === '__uncategorized__' ? !categories(artist).length : categories(artist).some(item => normalize(item) === normalize(label))).length;
      return `<button class="filter-chip${selected.has(label) ? ' active' : ''}" data-action="filter-label" data-label="${escapeHtml(label)}">${escapeHtml(label === '__uncategorized__' ? '未分类' : label)} <span>${count}</span></button>`;
    }).join('') : '<span class="muted">还没有分类标签</span>';
  }
  function renderList() {
    const artists = filteredArtists();
    summary.textContent = `显示 ${artists.length} / ${library.artists.length} 位画师`;
    list.innerHTML = artists.length ? artists.map(artist => {
      const picture = thumbnail(artist);
      const image = picture ? `<img src="${escapeHtml(picture)}" loading="lazy" alt="">` : `<span class="thumb-placeholder">${escapeHtml(Array.from(String(artist.name || artist.tag || '?'))[0])}</span>`;
      const chips = categories(artist).map(label => `<span class="artist-chip">${escapeHtml(label)}</span>`).join('');
      return `<button class="artist-card" data-action="open-artist" data-id="${escapeHtml(artist.id)}"><span class="artist-thumb">${image}</span><span class="artist-info"><strong>${escapeHtml(artist.name || artist.tag || '未命名画师')}</strong><span class="artist-tag">${escapeHtml(artist.tag || '')}</span><span class="artist-stars">${stars(artist)}</span><span class="artist-chips">${chips}</span><span class="entry-count">${Array.isArray(artist.entries) ? artist.entries.length : 0} 条作品记录</span></span></button>`;
    }).join('') : '<div class="empty">没有符合条件的画师，试试更换搜索词或筛选条件。</div>';
  }
  function renderArtistStrings() {
    const query = normalize(stringSearch.value);
    const records = strings.filter(record => {
      const categories = Array.isArray(record.categories) ? record.categories : [];
      if (query && ![record.title, record.artistString, record.notes, record.metadata?.prompt, ...categories].some(value => normalize(value).includes(query))) return false;
      if (!selectedStringLabels.size) return true;
      const matches = [...selectedStringLabels].map(label => label === '__uncategorized__' ? !categories.length : categories.some(category => normalize(category) === normalize(label)));
      return stringMatch.value === 'all' ? matches.every(Boolean) : matches.some(Boolean);
    }).sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    document.getElementById('mobileStringSummary').textContent = `显示 ${records.length} / ${strings.length} 条画师串`;
    stringList.innerHTML = records.length ? records.map(record => {
      const image = record.originalImage ? `<img src="${escapeHtml(record.originalImage)}" alt="${escapeHtml(record.title || '')}" loading="lazy" data-action="zoom-image">` : '<div class="mix-no-image">暂无原图</div>';
      const metadata = record.metadata?.hasMetadata ? [record.metadata.model, record.metadata.seed != null ? `Seed ${record.metadata.seed}` : '', record.metadata.width && record.metadata.height ? `${record.metadata.width} × ${record.metadata.height}` : ''].filter(Boolean).join(' · ') || '保留 NAI 原始生成信息' : record.originalImage ? '原图已按原始字节保存' : '';
      const chips = (Array.isArray(record.categories) ? record.categories : []).map(label => `<span class="artist-chip">${escapeHtml(label)}</span>`).join('');
      return `<article class="mix-card"><div class="mix-image">${image}</div><div class="mix-content"><h3>${escapeHtml(record.title || '未命名画师串')}</h3><div class="mix-labels">${chips || '<span class="muted">未分类</span>'}</div><pre>${escapeHtml(record.artistString || '')}</pre>${record.notes ? `<p class="mix-notes">${escapeHtml(record.notes)}</p>` : ''}${metadata ? `<p class="mix-meta">${escapeHtml(metadata)}</p>` : ''}<div class="mix-actions"><button data-action="copy-text" data-copy="${escapeHtml(record.artistString || '')}">📋 复制画师串</button>${record.originalImage ? `<button data-action="download-string-image" data-id="${escapeHtml(record.id)}">⬇ 下载原图</button>` : ''}</div></div></article>`;
    }).join('') : '<div class="empty">没有找到符合条件的画师串。</div>';
  }
  function renderStringLabels() {
    const all = [...(Array.isArray(library.labels) ? library.labels : [])];
    if (strings.some(record => !(Array.isArray(record.categories) ? record.categories : []).length)) all.push('__uncategorized__');
    stringLabels.innerHTML = all.length ? all.map(label => {
      const count = strings.filter(record => label === '__uncategorized__' ? !(record.categories || []).length : (record.categories || []).some(category => normalize(category) === normalize(label))).length;
      return `<button class="filter-chip${selectedStringLabels.has(label) ? ' active' : ''}" data-action="filter-string-label" data-label="${escapeHtml(label)}">${escapeHtml(label === '__uncategorized__' ? '未分类' : label)} <span>${count}</span></button>`;
    }).join('') : '<span class="muted">还没有画师串分类</span>';
  }
  function switchMode(mode) {
    const showingStrings = mode === 'strings';
    document.getElementById('mobileFilters').style.display = showingStrings ? 'none' : '';
    list.style.display = showingStrings ? 'none' : '';
    document.getElementById('mobileStringsPanel').style.display = showingStrings ? '' : 'none';
    document.getElementById('mobileArtistTab').classList[showingStrings ? 'remove' : 'add']('active');
    document.getElementById('mobileStringTab').classList[showingStrings ? 'add' : 'remove']('active');
    if (showingStrings) renderArtistStrings(); else renderList();
  }
  function imageBlock(src, title) {
    return `<div class="image-column"><span>${escapeHtml(title)}</span>${src ? `<img data-action="zoom-image" src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy">` : '<div class="image-empty">暂无图片</div>'}</div>`;
  }
  function renderDetail(artist) {
    if (!artist) return;
    const chips = categories(artist).map(label => `<span class="artist-chip">${escapeHtml(label)}</span>`).join('');
    const entries = (Array.isArray(artist.entries) ? artist.entries : []).slice().reverse().map((entry, index) => {
      const prompt = entry.prompt ? `<div class="record-text"><span>提示词</span><p>${escapeHtml(entry.prompt)}</p><button data-action="copy-text" data-copy="${escapeHtml(entry.prompt)}">复制提示词</button></div>` : '';
      const comment = entry.comment ? `<div class="record-text"><span>备注 / 原帖标签</span><p>${escapeHtml(entry.comment)}</p></div>` : '';
      const postId = Number(entry.sourcePostId);
      const source = Number.isSafeInteger(postId) && postId > 0 ? `<a class="source-link" href="https://danbooru.donmai.us/posts/${postId}" target="_blank" rel="noreferrer">打开 D 站原帖 ↗</a>` : '';
      return `<section class="record"><div class="record-heading"><strong>作品 ${index + 1}</strong><span>${Number(entry.score) > 0 ? `相似度 ${escapeHtml(entry.score)} / 5` : '未评分'}</span></div><div class="image-grid">${imageBlock(entry.originalImg, '画师原图')}${imageBlock(entry.naiImg, 'NAI 生成图')}</div>${prompt}${comment}${source}</section>`;
    }).join('');
    detail.innerHTML = `<div class="detail-sheet"><header class="detail-top"><button data-action="close-detail" aria-label="返回">‹ 返回</button><span>画师详情</span></header><section class="profile"><h2>${escapeHtml(artist.name || artist.tag || '未命名画师')}</h2><div class="profile-stars">${stars(artist)}</div><div class="artist-chips">${chips || '<span class="muted">未分类</span>'}</div><div class="tag-box"><code>${escapeHtml(artist.tag || '未填写 NAI tag')}</code>${artist.tag ? `<button data-action="copy-text" data-copy="${escapeHtml(artist.tag)}">复制 tag</button>` : ''}</div>${artist.notes ? `<div class="artist-notes">${escapeHtml(artist.notes)}</div>` : ''}</section><div class="records-title">作品记录 · ${Array.isArray(artist.entries) ? artist.entries.length : 0}</div>${entries || '<div class="empty">这位画师还没有作品记录。</div>'}</div>`;
    detail.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function notify(message) {
    const toast = document.getElementById('mobileToast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  }
  function copy(value) {
    if (!value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(() => notify('已复制 ✓')).catch(() => fallbackCopy(value));
    } else fallbackCopy(value);
  }
  function fallbackCopy(value) {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try { notify(document.execCommand('copy') ? '已复制 ✓' : '复制失败，请长按选择文字'); }
    catch (_) { notify('复制失败，请长按选择文字'); }
    field.remove();
  }

  search.addEventListener('input', renderList);
  pageSelector.innerHTML = pages.map(page => `<option value="${escapeHtml(page.id)}"${page.id === initialPageId ? ' selected' : ''}>${escapeHtml(page.name || '未命名画师库')}</option>`).join('');
  pageSelector.value = initialPageId;
  pageSelector.addEventListener('change', () => switchPage(pageSelector.value));
  stringSearch.addEventListener('input', renderArtistStrings);
  stringMatch.addEventListener('change', renderArtistStrings);
  rating.addEventListener('change', renderList);
  matchMode.addEventListener('change', renderList);
  document.addEventListener('click', event => {
    const item = event.target.closest('[data-action]');
    if (!item) return;
    switch (item.dataset.action) {
      case 'switch-mode': switchMode(item.dataset.mode); break;
      case 'filter-string-label': selectedStringLabels.has(item.dataset.label) ? selectedStringLabels.delete(item.dataset.label) : selectedStringLabels.add(item.dataset.label); renderStringLabels(); renderArtistStrings(); break;
      case 'clear-string-filters': selectedStringLabels.clear(); stringSearch.value = ''; stringMatch.value = 'any'; renderStringLabels(); renderArtistStrings(); break;
      case 'filter-label': selected.has(item.dataset.label) ? selected.delete(item.dataset.label) : selected.add(item.dataset.label); renderLabels(); renderList(); break;
      case 'clear-filters': selected.clear(); search.value = ''; rating.value = ''; matchMode.value = 'any'; renderLabels(); renderList(); break;
      case 'open-artist': renderDetail(library.artists.find(artist => String(artist.id) === item.dataset.id)); break;
      case 'close-detail': detail.classList.remove('show'); document.body.style.overflow = ''; break;
      case 'copy-text': copy(item.dataset.copy); break;
      case 'download-string-image': {
        const record = strings.find(entry => String(entry.id) === item.dataset.id);
        if (!record?.originalImage) break;
        const anchor = document.createElement('a');
        anchor.href = record.originalImage;
        anchor.download = record.originalImageName || 'nai-original.png';
        anchor.click();
        notify('原始图片已下载 ✓');
        break;
      }
      case 'zoom-image': document.getElementById('mobileZoomImage').src = item.src; lightbox.classList.add('show'); break;
      case 'close-lightbox': lightbox.classList.remove('show'); break;
    }
  });

  updateSubtitle(pages.find(page => page.id === initialPageId)?.name);
  renderLabels();
  renderList();
  renderStringLabels();
  renderArtistStrings();
  if (!library.artists.length && strings.length) switchMode('strings');
}

function buildMobileViewerHtml(snapshot) {
  const encoded = JSON.stringify(snapshot)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>NAI 画师记录本 · 手机版</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html{background:#151722;color:#e1e4f5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}body{max-width:760px;margin:0 auto;padding:0 14px calc(24px + env(safe-area-inset-bottom))}button,select,input{font:inherit}button{cursor:pointer}.masthead{padding:24px 2px 14px}.masthead h1{margin:0;color:#d1b0ff;font-size:24px}.masthead p{margin:7px 0 0;color:#9ca6c6;font-size:13px}.filters{position:sticky;top:0;z-index:2;padding:10px 0 12px;background:#151722}.search{width:100%;height:46px;padding:0 14px;border:1px solid #414761;border-radius:12px;background:#202333;color:#e1e4f5;font-size:15px}.filter-labels{display:flex;flex-wrap:wrap;gap:7px;max-height:112px;overflow:auto;padding:11px 0 9px}.filter-chip,.artist-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid #414761;border-radius:999px;background:#202333;color:#c3cae3;font-size:12px}.filter-chip.active{border-color:#c3a2ff;background:#413553;color:#f0e3ff}.filter-chip span{font-size:11px;opacity:.72}.select-row{display:flex;gap:8px}.select-row select{height:39px;min-width:0;flex:1;padding:0 8px;border:1px solid #414761;border-radius:9px;background:#202333;color:#dbe0f4;font-size:12px}.summary-row{display:flex;align-items:center;justify-content:space-between;margin-top:9px;color:#9ca6c6;font-size:12px}.clear-button{padding:5px 9px;border:0;border-radius:7px;background:#292d40;color:#cfd5ed}.artist-list{display:flex;flex-direction:column;gap:10px}.artist-card{display:flex;width:100%;min-height:128px;gap:13px;padding:10px;border:1px solid #353a51;border-radius:14px;background:#202333;color:#e1e4f5;text-align:left}.artist-thumb{display:block;width:88px;height:106px;flex:0 0 88px;overflow:hidden;border:1px solid #414761;border-radius:10px;background:#171925}.artist-thumb img,.thumb-placeholder{display:block;width:100%;height:100%;object-fit:cover;object-position:center 35%}.thumb-placeholder{display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#3c3153,#23283b);color:#d6bfff;font-size:32px;font-weight:700}.artist-info{display:flex;min-width:0;flex:1;flex-direction:column;justify-content:center}.artist-info strong{overflow:hidden;font-size:17px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.artist-tag{overflow:hidden;margin-top:4px;color:#b2bdd9;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.artist-stars,.profile-stars{margin-top:5px;color:#edbe74;font-size:15px;letter-spacing:1px}.artist-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.artist-chip{padding:3px 8px;border-color:#4a405b;background:#342e44;color:#dfccff;font-size:11px}.entry-count{margin-top:7px;color:#9ca6c6;font-size:11px}.muted{color:#9ca6c6;font-size:12px}.empty{padding:35px 12px;color:#9ca6c6;text-align:center;font-size:14px;line-height:1.8}.detail-overlay{position:fixed;inset:0;z-index:4;display:none;overflow-y:auto;background:#151722}.detail-overlay.show{display:block}.detail-sheet{max-width:760px;min-height:100%;margin:0 auto;padding:0 14px 30px}.detail-top{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:14px;height:58px;background:#151722;color:#cfd5ed}.detail-top button{padding:6px 9px;border:0;border-radius:8px;background:#282b3c;color:#e4dcff;font-size:14px}.profile{padding:17px;border:1px solid #353a51;border-radius:14px;background:#202333}.profile h2{margin:0;color:#dbbdff;font-size:24px}.profile-stars{font-size:19px}.tag-box{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding:10px;border-radius:9px;background:#171925}.tag-box code{overflow:hidden;color:#a8d485;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.tag-box button,.record-text button{padding:6px 9px;border:0;border-radius:7px;background:#3b3550;color:#eadcff;font-size:12px;white-space:nowrap}.artist-notes{margin-top:13px;color:#c2cae1;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word}.records-title{padding:22px 3px 10px;color:#c0c8e3;font-size:15px}.record{margin-bottom:12px;padding:12px;border:1px solid #353a51;border-radius:13px;background:#202333}.record-heading{display:flex;justify-content:space-between;margin-bottom:12px;color:#e1e4f5;font-size:13px}.record-heading>span{color:#edbe74;font-size:12px}.image-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.image-column>span{display:block;margin-bottom:6px;color:#aeb8d5;text-align:center;font-size:11px}.image-column img,.image-empty{display:block;width:100%;min-height:96px;max-height:340px;object-fit:contain;border-radius:8px;background:#151722}.image-empty{display:flex;align-items:center;justify-content:center;color:#79839f;font-size:12px}.record-text{margin-top:12px;color:#aeb8d5;font-size:12px}.record-text>span{display:block;margin-bottom:5px}.record-text p{margin:0;padding:9px;border-radius:7px;background:#171925;color:#d5daeb;line-height:1.65;white-space:pre-wrap;word-break:break-word}.record-text button{margin-top:7px}.source-link{display:inline-block;margin-top:12px;color:#94b8ff;font-size:12px}.lightbox{position:fixed;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.92)}.lightbox.show{display:flex}.lightbox img{max-width:96vw;max-height:94vh;object-fit:contain}.toast{position:fixed;bottom:32px;left:50%;z-index:8;padding:10px 17px;border-radius:9px;background:#a4d47c;color:#172019;font-size:13px;opacity:0;transform:translateX(-50%);pointer-events:none}.toast.show{opacity:1}@media(max-width:370px){body,.detail-sheet{padding-right:10px;padding-left:10px}.artist-thumb{width:76px;height:98px;flex-basis:76px}.artist-info strong{font-size:16px}.masthead h1{font-size:21px}}
</style>
<style>
.mode-tabs{display:flex;gap:8px;margin-bottom:4px}.mode-tabs button{flex:1;padding:10px 8px;border:1px solid #414761;border-radius:10px;background:#202333;color:#c3cae3;font-size:13px}.mode-tabs button.active{border-color:#c3a2ff;background:#413553;color:#f0e3ff}.mix-panel{padding-top:12px}.mix-summary{padding:10px 2px;color:#9ca6c6;font-size:12px}.mix-filter-row{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:6px}.mix-filter-row select{min-width:0;padding:7px 8px;border:1px solid #414761;border-radius:8px;background:#202333;color:#dbe0f4;font-size:12px}.mix-list{display:flex;flex-direction:column;gap:12px}.mix-card{display:grid;grid-template-columns:108px minmax(0,1fr);gap:11px;padding:10px;border:1px solid #353a51;border-radius:13px;background:#202333}.mix-image{display:flex;min-height:130px;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;background:#151722}.mix-image img{width:100%;max-height:220px;object-fit:contain}.mix-no-image{color:#8791ae;text-align:center;font-size:11px}.mix-content{min-width:0}.mix-content h3{margin:0 0 7px;color:#dbbdff;font-size:15px}.mix-labels{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}.mix-content pre{max-height:155px;overflow:auto;margin:0;padding:8px;border-radius:7px;background:#171925;color:#a8d485;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}.mix-notes,.mix-meta{margin:8px 0 0;color:#b9c2dc;font-size:11px;line-height:1.55;word-break:break-word}.mix-meta{color:#edbe74}.mix-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.mix-actions button{padding:7px 8px;border:0;border-radius:7px;background:#403651;color:#f0e3ff;font-size:11px}.mix-actions button+button{background:#30425a;color:#dbeaff}@media(max-width:365px){.mix-card{grid-template-columns:91px minmax(0,1fr)}.mix-image{min-height:112px}}
</style>
</head>
<body>
<header class="masthead"><h1>🎨 NAI 画师记录本</h1><p id="mobileSubtitle">离线手机版</p><select id="mobilePageSelect" style="width:100%;height:40px;margin-top:12px;padding:0 10px;border:1px solid #414761;border-radius:10px;background:#202333;color:#dbe0f4;font-size:13px" aria-label="切换画师库页面"></select></header>
<nav class="mode-tabs"><button id="mobileArtistTab" class="active" data-action="switch-mode" data-mode="artists">🎨 画师列表</button><button id="mobileStringTab" data-action="switch-mode" data-mode="strings">🧬 画师串收藏</button></nav>
<section class="filters" id="mobileFilters">
  <input class="search" id="mobileSearch" type="search" placeholder="🔍 搜索画师、NAI tag、分类或笔记">
  <div class="filter-labels" id="mobileLabels"></div>
  <div class="select-row">
    <select id="mobileMatch"><option value="any">任一分类标签</option><option value="all">全部分类标签</option></select>
    <select id="mobileRating"><option value="">全部星级</option><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option><option value="4+">四星及以上</option><option value="3+">三星及以上</option><option value="0">未评分</option></select>
  </div>
  <div class="summary-row"><span id="mobileSummary"></span><button class="clear-button" data-action="clear-filters">清除筛选</button></div>
</section>
<main class="artist-list" id="mobileList"></main>
<section class="mix-panel" id="mobileStringsPanel" style="display:none"><input class="search" id="mobileStringSearch" type="search" placeholder="🔍 搜索画师串、分类、标题或备注"><div class="filter-labels" id="mobileStringLabels"></div><div class="mix-filter-row"><select id="mobileStringMatch"><option value="any">任一分类标签</option><option value="all">全部分类标签</option></select><button class="clear-button" data-action="clear-string-filters">清除筛选</button></div><div class="mix-summary" id="mobileStringSummary"></div><div class="mix-list" id="mobileStringList"></div></section>
<div class="detail-overlay" id="mobileDetail"></div>
<div class="lightbox" id="mobileLightbox" data-action="close-lightbox"><img id="mobileZoomImage" alt="作品大图"></div>
<div class="toast" id="mobileToast"></div>
<script id="nai-mobile-data" type="application/json">${encoded}</script>
<script>(${mobileViewerApp.toString()})();</script>
</body>
</html>`;
}
