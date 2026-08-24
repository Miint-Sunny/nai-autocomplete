/* ================= 复制 / 放大 ================= */
function copyText(t) {
  if (!t) return;
  navigator.clipboard.writeText(t).then(() => toast('已复制到剪贴板 ✓')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('已复制 ✓');
  });
}
function zoom(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('show');
}

/* ================= 导出 / 导入 ================= */
function createBackupPayload() {
  ensureDataShape();
  return {
    ...data,
    format: 'nai-artist-notebook-backup',
    version: 5,
    exportedAt: new Date().toISOString(),
    labels: [...data.labels],
    artists: data.artists.map(artist => ({
      ...artist,
      categories: uniqueLabels([...(artist.categories || []), ...(Array.isArray(artist.labels) ? artist.labels : [])]),
      rating: Number(artist.rating) || 0,
      entries: Array.isArray(artist.entries) ? artist.entries : []
    })),
    artistStrings: data.artistStrings.map(record => ({ ...record, categories: uniqueLabels([...(record.categories || []), ...(Array.isArray(record.labels) ? record.labels : [])]) }))
  };
}
function downloadBackupFile(content, type, prefix, extension) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `${prefix}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.${extension}`;
  a.click();
  URL.revokeObjectURL(url);
}
function exportData() {
  downloadBackupFile(JSON.stringify(createBackupPayload()), 'application/json', 'NAI画师完整备份', 'json');
  toast(`完整备份已下载，包含 ${data.pages.length} 个页面、画师串和无损原图 ✓`);
}
function exportMobile() {
  const hasContent = data.artists.length || data.artistStrings.length || data.pages.some(page =>
    page.id !== data.activePageId && ((Array.isArray(page.artists) && page.artists.length) || (Array.isArray(page.artistStrings) && page.artistStrings.length))
  );
  if (!hasContent) { toast('还没有画师或画师串可以导出'); return; }
  // 只塞进手机版，不进 createBackupPayload —— 备份格式不该因为这个变
  const html = buildMobileViewerHtml({
    ...createBackupPayload(),
    promptLibrary: promptLibrary.map((entry) => ({
      alias: String(entry?.alias || ''),
      category: String(entry?.category || ''),
      name: String(entry?.name || ''),
      tags: Array.isArray(entry?.tags) ? entry.tags : [],
      promptText: String(entry?.promptText || ''),
    })).filter((entry) => entry.alias && entry.tags.length),
  });
  downloadBackupFile(html, 'text/html;charset=utf-8', 'NAI画师库手机版', 'html');
  toast('手机版已下载，发送到手机即可离线查看 ✓');
}
function parseImportedBackup(content) {
  const text = String(content || '').trim();
  let imported;
  if (text.startsWith('{')) {
    imported = JSON.parse(text);
  } else {
    const embedded = text.match(/<script\b[^>]*\bid=["']nai-mobile-data["'][^>]*>([\s\S]*?)<\/script\s*>/i);
    if (!embedded) throw new Error('请选择完整 JSON 备份或本程序导出的手机版 HTML');
    imported = JSON.parse(embedded[1]);
  }
  if (!imported || !Array.isArray(imported.artists)) throw new Error('备份中没有画师数据');
  return imported;
}
function normalizeArtistKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
}
function mergeImportedArtists(importedArtists) {
  ensureDataShape();
  const existingTags = new Set(data.artists.map(a => normalizeArtistKey(a.tag)).filter(Boolean));
  const existingNames = new Set(data.artists.map(a => normalizeArtistKey(a.name)).filter(Boolean));
  const existingIds = new Set(data.artists.map(a => a.id));
  let added = 0, skipped = 0;
  for (const raw of importedArtists) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const name = String(raw.name || raw.tag || '').trim();
    const tag = String(raw.tag || '').trim();
    const normalizedName = normalizeArtistKey(name);
    const normalizedTag = normalizeArtistKey(tag);
    if (!name || (normalizedTag && existingTags.has(normalizedTag)) || (normalizedName && existingNames.has(normalizedName))) {
      skipped++;
      continue;
    }
    const id = raw.id && !existingIds.has(raw.id) ? raw.id : uid();
    const categories = uniqueLabels([...(Array.isArray(raw.categories) ? raw.categories : []), ...(Array.isArray(raw.labels) ? raw.labels : [])]);
    data.artists.push({ ...raw, id, name, tag, categories, rating: Number(raw.rating) || 0, notes: String(raw.notes || ''), entries: Array.isArray(raw.entries) ? raw.entries : [], createdAt: raw.createdAt || Date.now() });
    for (const category of categories) if (!data.labels.some(label => labelKey(label) === labelKey(category))) data.labels.push(category);
    existingIds.add(id);
    if (normalizedTag) existingTags.add(normalizedTag);
    if (normalizedName) existingNames.add(normalizedName);
    added++;
  }
  data.labels.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return { added, skipped };
}

function applyImportedPage(imported) {
  for (const label of uniqueLabels([...(Array.isArray(imported.labels) ? imported.labels : []), ...(Array.isArray(imported.categories) ? imported.categories : [])])) {
    if (!data.labels.some(existing => labelKey(existing) === labelKey(label))) data.labels.push(label);
  }
  const artists = mergeImportedArtists(Array.isArray(imported.artists) ? imported.artists : []);
  const artistStrings = mergeImportedArtistStrings(imported.artistStrings);
  return { artists, artistStrings };
}

function applyImportedBackup(imported, mode = 'merge', pageName = '') {
  ensureDataShape();
  const chosenName = pageName || imported.pages?.find(page => page.id === imported.activePageId)?.name || '导入的画师库';
  if (mode === 'new') createLibraryPage(chosenName, { persist: false, refresh: false });
  const selectedPageId = data.activePageId;
  const result = applyImportedPage(imported);
  const restoredPages = [];
  if (Array.isArray(imported.pages)) {
    for (const importedPage of imported.pages) {
      if (!importedPage || importedPage.id === imported.activePageId || !Array.isArray(importedPage.artists)) continue;
      const page = createLibraryPage(importedPage.name || '导入的画师库', { persist: false, refresh: false });
      const pageResult = applyImportedPage(importedPage);
      restoredPages.push({ id: page.id, name: page.name, ...pageResult });
    }
    if (data.activePageId !== selectedPageId) switchLibraryPage(selectedPageId, { persist: false, refresh: false });
  }
  refreshCurrentLibraryPage();
  save();
  return { mode, pageId: selectedPageId, pageName: currentLibraryPage().name, ...result, restoredPages };
}

function suggestImportedPageName(fileName, imported) {
  const existing = imported?.pages?.find(page => page.id === imported.activePageId)?.name;
  if (existing) return uniqueLibraryPageName(existing);
  const base = String(fileName || '').replace(/\.(json|html?)$/i, '').replace(/^NAI画师(?:完整备份|库)[_-]?/i, '').trim();
  return uniqueLibraryPageName(base || '导入的画师库');
}

function showImportChoice(imported, fileName) {
  pendingLibraryImport = { imported, fileName: String(fileName || '') };
  document.getElementById('importSummary').textContent = `文件包含 ${imported.artists.length} 位画师、${Array.isArray(imported.artistStrings) ? imported.artistStrings.length : 0} 条画师串${Array.isArray(imported.pages) && imported.pages.length > 1 ? `、${imported.pages.length} 个页面` : ''}。`;
  document.getElementById('importPageName').value = suggestImportedPageName(fileName, imported);
  document.getElementById('importModeModal').classList.add('show');
}

function finishLibraryImport(mode) {
  if (!pendingLibraryImport) return null;
  const pageName = String(document.getElementById('importPageName').value || '').trim();
  if (mode === 'new' && !pageName) { toast('请先填写新页面名称'); return null; }
  const result = applyImportedBackup(pendingLibraryImport.imported, mode, pageName);
  pendingLibraryImport = null;
  closeModal('importModeModal');
  const extra = result.restoredPages.length ? `；另外恢复 ${result.restoredPages.length} 个页面` : '';
  toast(`${mode === 'new' ? `已导入新页面「${result.pageName}」` : '已合并到当前页'}：${result.artists.added} 位画师、${result.artistStrings.added} 条画师串，跳过 ${result.artists.skipped + result.artistStrings.skipped} 条重复${extra} ✓`);
  return result;
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = parseImportedBackup(e.target.result);
      showImportChoice(imported, file.name);
    } catch (err) { alert('文件格式不对，导入失败：' + err.message); }
  };
  reader.readAsText(file);
  input.value = '';
}

