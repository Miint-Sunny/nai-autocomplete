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
  if (!clean) { toast('请输入分类名称'); return null; }
  if (clean.length > 30) { toast('分类名称不能超过 30 个字'); return null; }
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
  if (!existing) toast(`已创建分类「${actual}」`);
  else if (!selectForEditing && !selectForStringEditing) toast('已存在同名分类');
  return actual;
}
function renameLabel(oldName, newName) {
  const next = cleanLabelName(newName);
  if (!next) return false;
  const previous = data.labels.find(label => labelKey(label) === labelKey(oldName));
  if (!previous) return false;
  if (data.labels.some(label => labelKey(label) === labelKey(next) && labelKey(label) !== labelKey(previous))) { toast('已存在同名分类'); return false; }
  data.labels = data.labels.map(label => labelKey(label) === labelKey(previous) ? next : label).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const artist of data.artists) artist.categories = uniqueLabels((artist.categories || []).map(label => labelKey(label) === labelKey(previous) ? next : label));
  for (const record of data.artistStrings) record.categories = uniqueLabels((record.categories || []).map(label => labelKey(label) === labelKey(previous) ? next : label));
  editingCategories = uniqueLabels(editingCategories.map(label => labelKey(label) === labelKey(previous) ? next : label));
  editingArtistStringCategories = uniqueLabels(editingArtistStringCategories.map(label => labelKey(label) === labelKey(previous) ? next : label));
  selectedLabelFilters = uniqueLabels(selectedLabelFilters.map(label => labelKey(label) === labelKey(previous) ? next : label));
  selectedArtistStringLabels = uniqueLabels(selectedArtistStringLabels.map(label => labelKey(label) === labelKey(previous) ? next : label));
  save(); renderLabelFilters(); renderLabelManager(); renderCategoryPicker(); renderArtistStringCategoryPicker(); renderArtistStringLabelFilters(); renderArtistStrings(); renderList(); renderArtist();
  toast(`已将分类重命名为「${next}」`);
  return true;
}
function deleteLabel(name) {
  const existing = data.labels.find(label => labelKey(label) === labelKey(name));
  if (!existing) return false;
  const count = labelArtistCount(existing);
  const stringCount = labelArtistStringCount(existing);
  if (!confirm(`删除分类「${existing}」？${count || stringCount ? `\n${count} 位画师和 ${stringCount} 条画师串会移出这个分类，画师和画师串本身不会被删除。` : ''}`)) return false;
  data.labels = data.labels.filter(label => labelKey(label) !== labelKey(existing));
  for (const artist of data.artists) artist.categories = (artist.categories || []).filter(label => labelKey(label) !== labelKey(existing));
  for (const record of data.artistStrings) record.categories = (record.categories || []).filter(label => labelKey(label) !== labelKey(existing));
  editingCategories = editingCategories.filter(label => labelKey(label) !== labelKey(existing));
  editingArtistStringCategories = editingArtistStringCategories.filter(label => labelKey(label) !== labelKey(existing));
  selectedLabelFilters = selectedLabelFilters.filter(label => labelKey(label) !== labelKey(existing));
  selectedArtistStringLabels = selectedArtistStringLabels.filter(label => labelKey(label) !== labelKey(existing));
  save(); renderLabelFilters(); renderLabelManager(); renderCategoryPicker(); renderArtistStringCategoryPicker(); renderArtistStringLabelFilters(); renderArtistStrings(); renderList(); renderArtist();
  toast(`已删除分类「${existing}」`);
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
  }).join('') : '<span style="font-size:11px;color:var(--fg2)">暂无分类。点击右侧的「管理分类」新建。</span>';
}
function renderLabelManager() {
  const box = document.getElementById('labelManagerList');
  if (!box) return;
  box.innerHTML = data.labels.length ? data.labels.map(label => `<div class="label-manager-row"><span class="label-name">🏷️ ${esc(label)}</span><span style="font-size:11px;color:var(--fg2);white-space:nowrap">${labelArtistCount(label)} 位画师 · ${labelArtistStringCount(label)} 条画师串</span><button class="btn-ghost btn-sm" data-action="renameLabel" data-label="${esc(label)}">重命名</button><button class="btn-red btn-sm" data-action="deleteLabel" data-label="${esc(label)}">删除</button></div>`).join('') : '<p style="font-size:13px;color:var(--fg2);padding:10px 0">暂无分类。请在上方新建。</p>';
}
function renderCategoryPicker() {
  const box = document.getElementById('artistCategoryPicker');
  if (!box) return;
  box.innerHTML = data.labels.length ? data.labels.map(label => `<button type="button" class="label-chip ${editingCategories.some(item => labelKey(item) === labelKey(label)) ? 'selected' : ''}" data-action="toggleArtistCategory" data-label="${esc(label)}">${esc(label)}</button>`).join('') : '<span style="font-size:12px;color:var(--fg2)">暂无分类。可以在下方新建。</span>';
}
/* ================= 星级（支持半星） ================= */
// 画师总评 artist.rating 和对比记录的相似度 entry.score 是同一种分值：0–5、步长半星，0 = 未评分。
// 旧数据全是整数，原样兼容；备份里手改出来的 3.7 这种值就近归到半星上。
function normalizeRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(5, Math.round(number * 2) / 2);
}

const SCORE_WORDS = ['未评分', '不像', '不太像', '一般', '挺像', '非常像'];

// 界面上的文字按 10 分制写，半颗星 = 1 分（4.5 星写「9/10」）；星星和存的数都不变。
// 半星没有单独的词，写成相邻两档之间：9/10 =「挺像～非常像」
function ratingPoints(value) {
  return Math.round(normalizeRating(value) * 2);
}

function scoreLabel(value) {
  const score = normalizeRating(value);
  if (!score) return SCORE_WORDS[0];
  const word = score < 1 ? '完全不像'
    : Number.isInteger(score) ? SCORE_WORDS[score]
      : `${SCORE_WORDS[Math.floor(score)]}～${SCORE_WORDS[Math.ceil(score)]}`;
  return `${ratingPoints(score)}/10 · ${word}`;
}

function artistRatingLabel(value) {
  const points = ratingPoints(value);
  return points ? `${points}/10` : '未评分';
}

// 相似度标签的配色档：4 星起绿、3 星起黄、再往下红
function scoreTone(value) {
  const score = normalizeRating(value);
  if (!score) return 'none';
  if (score >= 4) return 'high';
  return score >= 3 ? 'mid' : 'low';
}

// 星级筛选每一档都把半星收进来：「4」= 4～4.5 星（8～9 分），「1」= 0.5～1.5 星（1～3 分）；
// 「4+」= 4 星及以上；「0」只要未评分。手机版 mobileViewerApp 里有一份同口径的。
function ratingMatchesFilter(value, filter) {
  if (!filter) return true;
  const rating = normalizeRating(value);
  if (filter.endsWith('+')) return rating >= Number(filter.slice(0, -1));
  const wanted = Number(filter);
  if (!wanted) return rating === 0;
  return rating >= (wanted === 1 ? 0.5 : wanted) && rating < wanted + 1;
}

// 一颗星 = 灰的 ★ + ::after 叠一层亮的，按 is-full / is-half 裁切（样式见 artist-library.css 星级段）
function starIconsHtml(value) {
  const rating = normalizeRating(value);
  return [1, 2, 3, 4, 5].map(n => `<span class="star${rating >= n ? ' is-full' : rating >= n - 0.5 ? ' is-half' : ''}" data-star="${n}">★</span>`).join('');
}

// 只读星级：画师列表里那一行
function starMeterHtml(value) {
  return `<span class="star-meter" role="img" aria-label="${artistRatingLabel(value)}">${starIconsHtml(value)}</span>`;
}

// 可点星级：悬停预览、点左半颗是半星、再点一次当前分数清除、方向键每次半星（1 分）。
// 点击走 09 里的 data-action，悬停和键盘也在 09 统一绑定；kind 决定旁边那行字怎么写。
// data-value 是存的星数（0–5），读屏用的 aria-value* 和界面文字一样按 10 分制报。
function starRatingHtml(value, { action, id = '', label, kind = 'artist' }) {
  const rating = normalizeRating(value);
  const text = kind === 'entry' ? scoreLabel(rating) : artistRatingLabel(rating);
  return `<span class="star-rating" role="slider" tabindex="0" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${ratingPoints(rating)}" aria-valuetext="${esc(text)}" title="半颗星为 1 分。点击星星评分，再次点击当前分数可清除；也可以用方向键调整。" data-action="${action}" data-id="${esc(String(id))}" data-kind="${kind}" data-value="${rating}">${starIconsHtml(rating)}</span>`;
}

// 星级加旁边那行字（画师总评 =「9/10」，相似度 = 带配色的「9/10 · 挺像～非常像」）
function ratingFieldHtml(value, options) {
  const text = options.kind === 'entry'
    ? `<span class="score-badge score-${scoreTone(value)}" data-rating-text>${scoreLabel(value)}</span>`
    : `<span class="rating-text" data-rating-text>${artistRatingLabel(value)}</span>`;
  return `<span class="rating-field">${starRatingHtml(value, options)}${text}</span>`;
}

function filteredArtists() {
  const q = document.getElementById('searchBox').value.trim().toLocaleLowerCase();
  const rating = document.getElementById('ratingFilter')?.value || '';
  const matchMode = document.getElementById('labelMatchMode')?.value || 'any';
  return data.artists.filter(artist => {
    const categories = artist.categories || [];
    if (q && ![artist.name, artist.tag, ...categories].some(value => String(value || '').toLocaleLowerCase().includes(q))) return false;
    if (!ratingMatchesFilter(artist.rating, rating)) return false;
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

