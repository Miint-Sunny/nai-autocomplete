/* ================= 给已有记录传图 / 改prompt ================= */
let pendingEntryImg = null; // { eid, which }

function askEntryImage(eid, which) {
  pendingEntryImg = { eid, which };
  document.getElementById('entryImgFile').click();
}

function editPrompt(eid) {
  const a = getArtist(currentArtistId);
  const en = a.entries.find(x => x.id === eid);
  if (!en) return;
  const v = prompt('修改这条记录的 prompt / 参数：', en.prompt || '');
  if (v === null) return;
  en.prompt = v.trim();
  save(); renderArtist();
}

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
    case 'setRating': {
      const a = getArtist(currentArtistId);
      a.rating = parseInt(el.dataset.n);
      save(); renderLabelFilters(); renderList(); renderArtist();
      break;
    }
    case 'copyTag': copyText(getArtist(currentArtistId).tag); break;
    case 'copyPrompt': {
      const a = getArtist(currentArtistId);
      const en = a.entries.find(x => x.id === id);
      if (en) copyText(en.prompt);
      break;
    }
    case 'openEntryModal': openEntryModal(); break;
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
    case 'editPrompt': editPrompt(id); break;
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
