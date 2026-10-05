/* ================= 给已有记录快速换图（改别的走「✏️编辑」弹窗） ================= */
let pendingEntryImg = null; // { eid, which }

function askEntryImage(eid, which) {
  pendingEntryImg = { eid, which };
  document.getElementById('entryImgFile').click();
}

/* ================= 星级交互：画师总评 / 卡片上的相似度 / 弹窗里的相似度 ================= */
// 整排都能点、没有死区：星与星之间的缝从中线分给两边，外圈留白归最近的那颗；
// 落在哪颗星的范围里，就以那颗星自己的中线分左右 —— 左半 n - 0.5，右半 n。
// 以前只认指针正落在星上，缝和留白点了没反应，占了整排的 13–17%。
function ratingAtPointer(widget, event) {
  const stars = [...widget.querySelectorAll('.star')];
  for (let index = 0; index < stars.length; index += 1) {
    const rect = stars[index].getBoundingClientRect();
    const next = stars[index + 1]?.getBoundingClientRect();
    if (next && event.clientX >= (rect.right + next.left) / 2) continue;
    const n = Number(stars[index].dataset.star);
    return event.clientX < rect.left + rect.width / 2 ? n - 0.5 : n;
  }
  return null;
}

// preview = 悬停预览：只改星星和旁边那行字，data-value 和 aria 还是已保存的分数
function paintStarRating(widget, value, preview = false) {
  const rating = normalizeRating(value);
  widget.querySelectorAll('.star').forEach(star => {
    const n = Number(star.dataset.star);
    star.classList.toggle('is-full', rating >= n);
    star.classList.toggle('is-half', rating < n && rating >= n - 0.5);
  });
  const isEntry = widget.dataset.kind === 'entry';
  const text = isEntry ? scoreLabel(rating) : artistRatingLabel(rating);
  const label = widget.closest('.rating-field')?.querySelector('[data-rating-text]');
  if (label) {
    label.textContent = text;
    if (isEntry) label.className = `score-badge score-${scoreTone(rating)}`;
  }
  if (preview) return;
  widget.dataset.value = String(rating);
  widget.setAttribute('aria-valuenow', String(ratingPoints(rating)));
  widget.setAttribute('aria-valuetext', text);
}

function commitStarRating(widget, value) {
  const rating = normalizeRating(value);
  const artist = getArtist(currentArtistId);
  switch (widget.dataset.action) {
    case 'rateEntryDraft':
      entryDraftScore = rating; // 弹窗里只改草稿，点「保存」才落盘
      break;
    case 'setRating':
      if (!artist) return;
      artist.rating = rating;
      save(); renderList();
      break;
    case 'rateEntry': {
      const entry = artist?.entries.find(x => x.id === widget.dataset.id);
      if (!entry) return;
      entry.score = rating;
      save();
      break;
    }
    default: return;
  }
  // 不重绘整页：卡片里的大图不用重新解码，键盘焦点也还留在这排星上
  paintStarRating(widget, rating);
}

function onStarRatingClick(widget, event) {
  if (event.detail > 1) return; // 双击的第二下不算，不然刚打的分会被当成「再点一次」清掉
  const value = ratingAtPointer(widget, event);
  if (value === null) return;
  const cleared = value === normalizeRating(widget.dataset.value);
  commitStarRating(widget, cleared ? 0 : value);
  // 清掉之后指针还停在原处，别让悬停预览马上又把星点亮
  if (cleared) widget.dataset.suppressPreview = String(value);
}

document.addEventListener('pointermove', e => {
  const widget = e.target.closest?.('.star-rating');
  if (!widget) return;
  const value = ratingAtPointer(widget, e);
  if (value === null || widget.dataset.suppressPreview === String(value)) return;
  delete widget.dataset.suppressPreview;
  paintStarRating(widget, value, true);
});
document.addEventListener('pointerout', e => {
  const widget = e.target.closest?.('.star-rating');
  if (!widget || widget.contains(e.relatedTarget)) return;
  delete widget.dataset.suppressPreview;
  paintStarRating(widget, widget.dataset.value, true);
});
document.addEventListener('keydown', e => {
  const widget = e.target.closest?.('.star-rating');
  if (!widget) return;
  const current = normalizeRating(widget.dataset.value);
  const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
  let next = null;
  if (step) next = Math.min(5, Math.max(0, current + step));
  else if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') next = 0;
  else if (e.key === 'End') next = 5;
  else if (/^[0-5]$/.test(e.key)) next = Number(e.key);
  if (next === null) return;
  e.preventDefault();
  if (next !== current) commitStarRating(widget, next);
});

/* ================= 事件绑定（扩展不允许内联事件，统一在这里处理） ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'newLibraryPage': {
      const name = prompt('给新页面起个名字：', `画师库 ${data.pages.length + 1}`);
      if (name !== null && name.trim()) { const page = createLibraryPage(name); toast(`已创建页面：${page.name}`); }
      break;
    }
    case 'renameLibraryPage': {
      const page = currentLibraryPage();
      const name = prompt('修改当前页面的名字：', page.name);
      if (name !== null) renameLibraryPage(page.id, name);
      break;
    }
    case 'deleteLibraryPage': deleteLibraryPage(data.activePageId); break;
    case 'mergeLibraryImport': finishLibraryImport('merge'); break;
    case 'newPageLibraryImport': finishLibraryImport('new'); break;
    case 'cancelLibraryImport': pendingLibraryImport = null; closeModal('importModeModal'); break;
    case 'openArtistStrings': openArtistStrings(); break;
    case 'exportArtistStrings': exportArtistStrings(); break;
    case 'importArtistStringsClick': document.getElementById('artistStringImportFile').click(); break;
    case 'newArtistString': openArtistStringEditor(null); break;
    case 'editArtistString': openArtistStringEditor(id); break;
    case 'saveArtistString': saveArtistString(); break;
    case 'toggleArtistStringCategory': {
      const label = el.dataset.label;
      editingArtistStringCategories = editingArtistStringCategories.some(item => labelKey(item) === labelKey(label)) ? editingArtistStringCategories.filter(item => labelKey(item) !== labelKey(label)) : [...editingArtistStringCategories, label];
      renderArtistStringCategoryPicker();
      break;
    }
    case 'toggleArtistStringFilter': {
      const label = el.dataset.label;
      selectedArtistStringLabels = selectedArtistStringLabels.some(item => labelKey(item) === labelKey(label)) ? selectedArtistStringLabels.filter(item => labelKey(item) !== labelKey(label)) : [...selectedArtistStringLabels, label];
      renderArtistStringLabelFilters(); renderArtistStrings();
      break;
    }
    case 'clearArtistStringFilters': selectedArtistStringLabels = []; document.getElementById('artistStringSearch').value = ''; document.getElementById('stringLabelMatchMode').value = 'any'; renderArtistStringLabelFilters(); renderArtistStrings(); break;
    case 'createStringQuickLabel': {
      const input = document.getElementById('stringQuickLabelName');
      if (createLabel(input.value, { selectForStringEditing: true })) input.value = '';
      break;
    }
    case 'deleteArtistString': deleteArtistString(id); break;
    case 'copyArtistString': {
      const record = data.artistStrings.find(item => item.id === id);
      if (record) copyText(record.artistString);
      break;
    }
    case 'downloadArtistStringImage': downloadArtistStringImage(id); break;
    case 'pickArtistStringImage': document.getElementById('stringImageFile').click(); break;
    case 'removeArtistStringImage': pendingArtistStringImage = null; renderArtistStringImagePreview(); break;
    case 'useImagePrompt': {
      if (pendingArtistStringImage?.metadata?.prompt) document.getElementById('stringPrompt').value = pendingArtistStringImage.metadata.prompt;
      break;
    }
    case 'selectArtist': selectArtist(id); break;
    case 'openLabelManager': renderLabelManager(); document.getElementById('newLabelName').value = ''; document.getElementById('labelManagerModal').classList.add('show'); break;
    case 'createManagedLabel': {
      const input = document.getElementById('newLabelName');
      if (createLabel(input.value)) input.value = '';
      break;
    }
    case 'createQuickLabel': {
      const input = document.getElementById('quickLabelName');
      if (createLabel(input.value, { selectForEditing: true })) input.value = '';
      break;
    }
    case 'renameLabel': {
      const next = prompt('请输入新的分类标签名称：', el.dataset.label);
      if (next !== null) renameLabel(el.dataset.label, next);
      break;
    }
    case 'deleteLabel': deleteLabel(el.dataset.label); break;
    case 'toggleArtistCategory': {
      const label = el.dataset.label;
      editingCategories = editingCategories.some(item => labelKey(item) === labelKey(label)) ? editingCategories.filter(item => labelKey(item) !== labelKey(label)) : [...editingCategories, label];
      renderCategoryPicker();
      break;
    }
    case 'toggleLabelFilter': {
      const label = el.dataset.label;
      selectedLabelFilters = selectedLabelFilters.some(item => labelKey(item) === labelKey(label)) ? selectedLabelFilters.filter(item => labelKey(item) !== labelKey(label)) : [...selectedLabelFilters, label];
      renderLabelFilters(); renderList();
      break;
    }
    case 'clearArtistFilters': selectedLabelFilters = []; document.getElementById('searchBox').value = ''; document.getElementById('ratingFilter').value = ''; document.getElementById('labelMatchMode').value = 'any'; renderLabelFilters(); renderList(); break;
    case 'openArtistModal': openArtistModal(id || null); break;
    case 'saveArtist': saveArtist(); break;
    case 'deleteArtist': deleteArtist(); break;
    case 'closeModal': closeModal(el.dataset.target); break;
    case 'setRating':
    case 'rateEntry':
    case 'rateEntryDraft': onStarRatingClick(el, e); break;
    case 'copyTag': copyText(getArtist(currentArtistId).tag); break;
    case 'copyPrompt': {
      const a = getArtist(currentArtistId);
      const en = a.entries.find(x => x.id === id);
      if (en) copyText(en.prompt);
      break;
    }
    case 'openEntryModal': openEntryModal(); break;
    case 'editEntry': openEntryModal(id); break;
    case 'saveEntry': saveEntry(); break;
    case 'deleteEntry': deleteEntry(id); break;
    case 'openGrabModal': document.getElementById('grabModal').classList.add('show'); break;
    case 'openBatchModal': document.getElementById('batchModal').classList.add('show'); break;
    case 'startGrab': startGrab(); break;
    case 'startBatch': startBatch(); break;
    case 'stopGrab': grabStopFlag = true; break;
    case 'openDanbooru': chrome.tabs.create({ url: 'https://danbooru.donmai.us/' }); break;
    case 'openPost': chrome.tabs.create({ url: 'https://danbooru.donmai.us/posts/' + encodeURIComponent(el.dataset.postId) }); break;
    case 'openLogModal': openLogModal(); break;
    case 'runDiagnosis': runDiagnosis(); break;
    case 'clearLogs': grabLogs = []; renderLogs(); break;
    case 'copyLogs':
      navigator.clipboard.writeText(grabLogs.join('\n')).then(() => toast('日志已复制，直接粘贴发送即可 ✓'));
      break;
    case 'uploadOriginal': askEntryImage(id, 'original'); break;
    case 'uploadNai': askEntryImage(id, 'nai'); break;
    case 'pickOriginal': document.getElementById('fOriginal').click(); break;
    case 'pickNai': document.getElementById('fNai').click(); break;
    case 'zoom': zoom(el.src); break;
    case 'closeLightbox': document.getElementById('lightbox').classList.remove('show'); break;
    case 'exportData': exportData(); break;
    case 'exportMobile': exportMobile(); break;
    case 'importClick': document.getElementById('importFile').click(); break;
  }
});

// 笔记自动保存（失焦时）
document.addEventListener('change', e => {
  if (e.target.dataset.field === 'notes') {
    const a = getArtist(currentArtistId);
    if (a) { a.notes = e.target.value; save(); }
  }
});

// 文件选择
document.getElementById('fOriginal').addEventListener('change', function () { pickImage(this, 'original'); });
document.getElementById('fNai').addEventListener('change', function () { pickImage(this, 'nai'); });
document.getElementById('importFile').addEventListener('change', function () { importData(this); });
document.getElementById('artistStringImportFile').addEventListener('change', function () { importArtistStrings(this); });
document.getElementById('stringImageFile').addEventListener('change', async function () {
  const file = this.files[0];
  this.value = '';
  if (!file) return;
  try {
    pendingArtistStringImage = await readArtistStringImage(file);
    renderArtistStringImagePreview();
    toast(pendingArtistStringImage.metadata?.hasMetadata ? '已无损读取原图及 NAI 生成信息 ✓' : '原图已无损载入，但没有检测到 NAI 信息');
  } catch (error) { alert('读取原图失败：' + error.message); }
});
document.getElementById('entryImgFile').addEventListener('change', function () {
  const file = this.files[0];
  this.value = '';
  if (!file || !pendingEntryImg) return;
  const a = getArtist(currentArtistId);
  if (!a) return;
  const en = a.entries.find(x => x.id === pendingEntryImg.eid);
  if (!en) return;
  const which = pendingEntryImg.which;
  compressImage(file, url => {
    if (which === 'original') en.originalImg = url; else en.naiImg = url;
    save(); renderList(); renderArtist(); toast('图片已更新 ✓');
  });
});

// 搜索
document.getElementById('libraryPageSelect').addEventListener('change', function () { switchLibraryPage(this.value); });
document.getElementById('searchBox').addEventListener('input', renderList);
document.getElementById('ratingFilter').addEventListener('change', renderList);
document.getElementById('labelMatchMode').addEventListener('change', renderList);
document.getElementById('artistStringSearch').addEventListener('input', renderArtistStrings);
document.getElementById('stringLabelMatchMode').addEventListener('change', renderArtistStrings);
document.getElementById('newLabelName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const input = e.target; if (createLabel(input.value)) input.value = ''; } });
document.getElementById('quickLabelName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const input = e.target; if (createLabel(input.value, { selectForEditing: true })) input.value = ''; } });

/* ================= 初始化 ================= */
load(() => { renderLibraryPages(); renderLabelFilters(); renderLabelManager(); renderList(); renderArtist(); updateStorageText(); });
