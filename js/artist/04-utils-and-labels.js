/* ================= 工具 ================= */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function getArtist(id) { return data.artists.find(a => a.id === id); }

/* ================= 分类标签管理 ================= */
function labelArtistCount(name) {
  if (name === '__uncategorized__') return data.artists.filter(artist => !artist.categories?.length).length;
  return data.artists.filter(artist => (artist.categories || []).some(category => labelKey(category) === labelKey(name))).length;
}
function createLabel(name, { selectForEditing = false, selectForStringEditing = false } = {}) {
  const clean = cleanLabelName(name);
  if (!clean) { toast('请先输入分类标签名称'); return null; }
  if (clean.length > 30) { toast('分类标签最多 30 个字'); return null; }
  const existing = data.labels.find(label => labelKey(label) === labelKey(clean));
  const actual = existing || clean;
  if (!existing) {
    data.labels.push(clean);
    data.labels.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  if (selectForEditing && !editingCategories.some(category => labelKey(category) === labelKey(actual))) editingCategories.push(actual);
  if (selectForStringEditing && !editingArtistStringCategories.some(category => labelKey(category) === labelKey(actual))) editingArtistStringCategories.push(actual);
  save();
  renderLabelFilters();
  renderLabelManager();
  renderCategoryPicker();
  renderArtistStringCategoryPicker();
  renderArtistStringLabelFilters();
  renderArtistStrings();
  if (!existing) toast(`已创建分类：${actual}`);
  else if (!selectForEditing && !selectForStringEditing) toast('这个分类标签已经存在');
  return actual;
}
function renameLabel(oldName, newName) {
  const next = cleanLabelName(newName);
  if (!next) return false;
  const previous = data.labels.find(label => labelKey(label) === labelKey(oldName));
  if (!previous) return false;
  if (data.labels.some(label => labelKey(label) === labelKey(next) && labelKey(label) !== labelKey(previous))) { toast('已存在同名分类标签'); return false; }
  data.labels = data.labels.map(label => labelKey(label) === labelKey(previous) ? next : label).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const artist of data.artists) artist.categories = uniqueLabels((artist.categories || []).map(label => labelKey(label) === labelKey(previous) ? next : label));
  for (const record of data.artistStrings) record.categories = uniqueLabels((record.categories || []).map(label => labelKey(label) === labelKey(previous) ? next : label));
  editingCategories = uniqueLabels(editingCategories.map(label => labelKey(label) === labelKey(previous) ? next : label));
  editingArtistStringCategories = uniqueLabels(editingArtistStringCategories.map(label => labelKey(label) === labelKey(previous) ? next : label));
  selectedLabelFilters = uniqueLabels(selectedLabelFilters.map(label => labelKey(label) === labelKey(previous) ? next : label));
  selectedArtistStringLabels = uniqueLabels(selectedArtistStringLabels.map(label => labelKey(label) === labelKey(previous) ? next : label));
  save(); renderLabelFilters(); renderLabelManager(); renderCategoryPicker(); renderArtistStringCategoryPicker(); renderArtistStringLabelFilters(); renderArtistStrings(); renderList(); renderArtist();
  toast(`分类已改为：${next}`);
  return true;
}
function deleteLabel(name) {
  const existing = data.labels.find(label => labelKey(label) === labelKey(name));
  if (!existing) return false;
  const count = labelArtistCount(existing);
  const stringCount = labelArtistStringCount(existing);
  if (!confirm(`确定删除分类「${existing}」吗？${count || stringCount ? `\n${count} 位画师、${stringCount} 条画师串会移除此标签，但内容不会被删除。` : ''}`)) return false;
  data.labels = data.labels.filter(label => labelKey(label) !== labelKey(existing));
  for (const artist of data.artists) artist.categories = (artist.categories || []).filter(label => labelKey(label) !== labelKey(existing));
  for (const record of data.artistStrings) record.categories = (record.categories || []).filter(label => labelKey(label) !== labelKey(existing));
  editingCategories = editingCategories.filter(label => labelKey(label) !== labelKey(existing));
  editingArtistStringCategories = editingArtistStringCategories.filter(label => labelKey(label) !== labelKey(existing));
  selectedLabelFilters = selectedLabelFilters.filter(label => labelKey(label) !== labelKey(existing));
  selectedArtistStringLabels = selectedArtistStringLabels.filter(label => labelKey(label) !== labelKey(existing));
  save(); renderLabelFilters(); renderLabelManager(); renderCategoryPicker(); renderArtistStringCategoryPicker(); renderArtistStringLabelFilters(); renderArtistStrings(); renderList(); renderArtist();
  toast(`已删除分类：${existing}`);
  return true;
}
function renderLabelFilters() {
  const box = document.getElementById('labelFilterList');
  if (!box) return;
  const labels = [...data.labels];
  if (data.artists.some(artist => !(artist.categories || []).length)) labels.push('__uncategorized__');
  box.innerHTML = labels.length ? labels.map(label => {
    const active = selectedLabelFilters.some(item => labelKey(item) === labelKey(label));
    return `<button class="label-chip ${active ? 'selected' : ''}" data-action="toggleLabelFilter" data-label="${esc(label)}">${esc(label === '__uncategorized__' ? '未分类' : label)} <span class="count">${labelArtistCount(label)}</span></button>`;
  }).join('') : '<span style="font-size:11px;color:var(--fg2)">还没有分类，点击右侧「管理 / 新建」</span>';
}
function renderLabelManager() {
  const box = document.getElementById('labelManagerList');
  if (!box) return;
  box.innerHTML = data.labels.length ? data.labels.map(label => `<div class="label-manager-row"><span class="label-name">🏷️ ${esc(label)}</span><span style="font-size:11px;color:var(--fg2);white-space:nowrap">${labelArtistCount(label)} 人 · ${labelArtistStringCount(label)} 串</span><button class="btn-ghost btn-sm" data-action="renameLabel" data-label="${esc(label)}">改名</button><button class="btn-red btn-sm" data-action="deleteLabel" data-label="${esc(label)}">删除</button></div>`).join('') : '<p style="font-size:13px;color:var(--fg2);padding:10px 0">还没有分类标签，先在上面新建一个吧。</p>';
}
function renderCategoryPicker() {
  const box = document.getElementById('artistCategoryPicker');
  if (!box) return;
  box.innerHTML = data.labels.length ? data.labels.map(label => `<button type="button" class="label-chip ${editingCategories.some(item => labelKey(item) === labelKey(label)) ? 'selected' : ''}" data-action="toggleArtistCategory" data-label="${esc(label)}">${esc(label)}</button>`).join('') : '<span style="font-size:12px;color:var(--fg2)">暂无分类，可直接在下面新建。</span>';
}
function filteredArtists() {
  const q = document.getElementById('searchBox').value.trim().toLocaleLowerCase();
  const rating = document.getElementById('ratingFilter')?.value || '';
  const matchMode = document.getElementById('labelMatchMode')?.value || 'any';
  return data.artists.filter(artist => {
    const categories = artist.categories || [];
    if (q && ![artist.name, artist.tag, ...categories].some(value => String(value || '').toLocaleLowerCase().includes(q))) return false;
    if (rating) {
      const stars = Number(artist.rating || 0);
      if (rating.endsWith('+') ? stars < Number(rating.slice(0, -1)) : stars !== Number(rating)) return false;
    }
    if (!selectedLabelFilters.length) return true;
    const matches = selectedLabelFilters.map(label => label === '__uncategorized__' ? !categories.length : categories.some(category => labelKey(category) === labelKey(label)));
    return matchMode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
  }).sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
}

/* 图片压缩：缩到最长边900px，转JPEG，省空间 */
function compressImage(file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > max) {
        const r = max / Math.max(w, h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.78));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

