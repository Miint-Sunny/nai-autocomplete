/* ================= 画师列表 ================= */
function artistThumbnail(artist) {
  const entries = Array.isArray(artist?.entries) ? artist.entries : [];
  for (let index = entries.length - 1; index >= 0; index--) {
    if (typeof entries[index]?.originalImg === 'string' && entries[index].originalImg) return entries[index].originalImg;
  }
  for (let index = entries.length - 1; index >= 0; index--) {
    if (typeof entries[index]?.naiImg === 'string' && entries[index].naiImg) return entries[index].naiImg;
  }
  return '';
}
function renderList() {
  const box = document.getElementById('artistList');
  const list = filteredArtists();
  const summary = document.getElementById('artistFilterSummary');
  if (summary) summary.textContent = `显示 ${list.length} / ${data.artists.length} 位画师`;
  if (list.length === 0) {
    box.innerHTML = '<p style="text-align:center;color:var(--fg2);padding:20px;font-size:13px">' +
      (data.artists.length ? '没有匹配的画师' : '还没有记录任何画师') + '</p>';
    return;
  }
  box.innerHTML = list.map(a => {
    const thumbnail = artistThumbnail(a);
    const initial = Array.from(String(a.name || a.tag || '?').trim())[0] || '?';
    return `
    <div class="artist-item ${a.id === currentArtistId ? 'active' : ''}" data-action="selectArtist" data-id="${a.id}">
      <span class="artist-thumb">${thumbnail ? `<img src="${esc(thumbnail)}" alt="${esc(a.name)}的作品缩略图" loading="lazy" decoding="async">` : `<span class="artist-thumb-placeholder" aria-label="暂无作品图片">${esc(initial)}</span>`}</span>
      <span class="artist-info"><span class="name" title="${esc(a.name)}">${esc(a.name)}</span><span class="mini-stars">${'★'.repeat(a.rating || 0)}${'☆'.repeat(5 - (a.rating || 0))}</span>${(a.categories || []).length ? `<span class="artist-labels">${a.categories.slice(0, 3).map(label => `<span class="artist-label-mini">${esc(label)}</span>`).join('')}${a.categories.length > 3 ? `<span class="artist-label-mini">+${a.categories.length - 3}</span>` : ''}</span>` : ''}</span>
    </div>`;
  }).join('');
}

function selectArtist(id) {
  currentArtistId = id;
  renderList();
  renderArtist();
}

/* ================= 画师详情 ================= */
const SCORE_TEXT = ['未评分', '⭐ 不像', '⭐⭐ 不太像', '⭐⭐⭐ 一般', '⭐⭐⭐⭐ 挺像', '⭐⭐⭐⭐⭐ 非常像'];

function renderArtist() {
  const a = getArtist(currentArtistId);
  const empty = document.getElementById('emptyState');
  const view = document.getElementById('artistView');
  if (!a) { empty.style.display = 'block'; view.style.display = 'none'; return; }
  empty.style.display = 'none'; view.style.display = 'block';

  const entriesHtml = a.entries.length === 0
    ? '<p style="color:var(--fg2);font-size:14px;padding:12px 0">还没有对比记录，点右上角「＋ 添加对比」上传原图和 NAI 生成图吧</p>'
    : a.entries.slice().reverse().map(en => `
      <div class="entry">
        <div class="entry-imgs">
          <div class="img-box"><div class="label">📷 画师原图</div>
            ${en.originalImg ? `<img src="${en.originalImg}" data-action="zoom">` : `<div class="no-img">${en.sourcePostId ? '图片访问受限，已保留作品信息<br><button class="btn-blue btn-sm" style="margin-top:10px" data-action="openPost" data-post-id="' + esc(String(en.sourcePostId)) + '">↗ 打开 D 站原帖</button>' : '未上传'}</div>`}
          </div>
          <div class="img-box"><div class="label">🤖 NAI 生成图</div>
            ${en.naiImg ? `<img src="${en.naiImg}" data-action="zoom">` : '<div class="no-img">未上传</div>'}
          </div>
        </div>
        <div class="entry-meta">
          ${en.prompt ? `<div class="prompt">${esc(en.prompt)}</div>` : ''}
          <div class="entry-foot">
            <span class="score-badge score-${en.score}">${SCORE_TEXT[en.score] || SCORE_TEXT[0]}</span>
            <span>
              <button class="btn-ghost btn-sm" data-action="uploadOriginal" data-id="${en.id}" title="上传/替换原图">📷原图</button>
              <button class="btn-ghost btn-sm" data-action="uploadNai" data-id="${en.id}" title="上传/替换NAI生成图">🤖NAI图</button>
              <button class="btn-ghost btn-sm" data-action="editPrompt" data-id="${en.id}" title="修改prompt">✏️prompt</button>
              ${en.prompt ? `<button class="btn-ghost btn-sm" data-action="copyPrompt" data-id="${en.id}">复制</button>` : ''}
              <button class="btn-red btn-sm" data-action="deleteEntry" data-id="${en.id}">删除</button>
            </span>
          </div>
          ${en.comment ? `<div class="comment">💬 ${esc(en.comment)}</div>` : ''}
        </div>
      </div>`).join('');

  view.innerHTML = `
    <div class="card">
      <div class="artist-head">
        <div>
          <h2>${esc(a.name)}</h2>
          <div class="tag-row">
            <span class="tag-pill">${esc(a.tag || '（还没填tag）')}</span>
            ${a.tag ? `<button class="btn-blue btn-sm" data-action="copyTag">📋 复制tag</button>` : ''}
          </div>
          <div class="detail-labels">${(a.categories || []).map(label => `<button class="label-chip" data-action="toggleLabelFilter" data-label="${esc(label)}">🏷️ ${esc(label)}</button>`).join('')}<button class="btn-ghost btn-sm" data-action="openArtistModal" data-id="${a.id}">${(a.categories || []).length ? '修改分类' : '＋ 添加分类'}</button></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;color:var(--fg2);margin-bottom:4px">NAI 出图效果总评（点击星星评分）</div>
          <div class="stars">${[1, 2, 3, 4, 5].map(i =>
            `<span class="${i <= (a.rating || 0) ? 'on' : 'off'}" data-action="setRating" data-n="${i}">★</span>`).join('')}</div>
          <div style="margin-top:10px">
            <button class="btn-ghost btn-sm" data-action="openArtistModal" data-id="${a.id}">✏️ 编辑</button>
            <button class="btn-red btn-sm" data-action="deleteArtist">🗑 删除画师</button>
          </div>
        </div>
      </div>
      <textarea class="notes-area" data-field="notes" placeholder="笔记：这个画师的风格特点、适合搭配什么tag、注意事项...">${esc(a.notes)}</textarea>
    </div>
    <div class="section-title">
      <span>📊 原图 vs NAI 对比记录（${a.entries.length} 条）</span>
      <span>
        <button class="btn-blue btn-sm" data-action="openGrabModal">🤖 自动抓原图</button>
        <button class="btn-green btn-sm" data-action="openEntryModal">＋ 手动添加</button>
      </span>
    </div>
    ${entriesHtml}`;
}

/* ================= 画师增删改 ================= */
function openArtistModal(id) {
  editingArtistId = id || null;
  const a = id ? getArtist(id) : null;
  document.getElementById('artistModalTitle').textContent = a ? '编辑画师' : '添加画师';
  document.getElementById('fName').value = a ? a.name : '';
  document.getElementById('fTag').value = a ? (a.tag || '') : '';
  document.getElementById('quickLabelName').value = '';
  editingCategories = a ? uniqueLabels(a.categories || []) : selectedLabelFilters.filter(label => label !== '__uncategorized__');
  renderCategoryPicker();
  document.getElementById('artistModal').classList.add('show');
}
function saveArtist() {
  const name = document.getElementById('fName').value.trim();
  const tag = document.getElementById('fTag').value.trim();
  if (!name) { alert('请填写画师名字'); return; }
  const duplicate = data.artists.find(a => a.id !== editingArtistId && ((tag && normalizeArtistKey(a.tag) === normalizeArtistKey(tag)) || normalizeArtistKey(a.name) === normalizeArtistKey(name)));
  if (duplicate) { toast(`画师已存在：${duplicate.name}，已跳过重复添加`); return; }
  if (editingArtistId) {
    const a = getArtist(editingArtistId);
    a.name = name; a.tag = tag; a.categories = uniqueLabels(editingCategories);
  } else {
    const id = uid();
    data.artists.push({ id, name, tag, categories: uniqueLabels(editingCategories), rating: 0, notes: '', entries: [], createdAt: Date.now() });
    currentArtistId = id;
  }
  save(); closeModal('artistModal'); renderLabelFilters(); renderLabelManager(); renderList(); renderArtist();
  toast('已保存 ✓');
}
function deleteArtist() {
  const a = getArtist(currentArtistId);
  if (!confirm(`确定删除画师「${a.name}」和所有对比记录吗？此操作无法撤销！`)) return;
  data.artists = data.artists.filter(x => x.id !== currentArtistId);
  currentArtistId = null;
  save(); renderLabelFilters(); renderLabelManager(); renderList(); renderArtist();
}

/* ================= 对比记录 ================= */
function openEntryModal() {
  tempImgs = { original: null, nai: null };
  document.getElementById('prevOriginal').innerHTML = '';
  document.getElementById('prevNai').innerHTML = '';
  document.getElementById('fOriginal').value = '';
  document.getElementById('fNai').value = '';
  document.getElementById('fPrompt').value = '';
  document.getElementById('fComment').value = '';
  document.getElementById('fScore').value = '3';
  document.getElementById('entryModal').classList.add('show');
}
function pickImage(input, which) {
  const file = input.files[0];
  if (!file) return;
  compressImage(file, url => {
    tempImgs[which] = url;
    document.getElementById(which === 'original' ? 'prevOriginal' : 'prevNai').innerHTML = `<img src="${url}">`;
  });
}
function saveEntry() {
  if (!tempImgs.original && !tempImgs.nai) { alert('至少上传一张图片吧'); return; }
  const a = getArtist(currentArtistId);
  a.entries.push({
    id: uid(),
    originalImg: tempImgs.original,
    naiImg: tempImgs.nai,
    prompt: document.getElementById('fPrompt').value.trim(),
    score: parseInt(document.getElementById('fScore').value),
    comment: document.getElementById('fComment').value.trim(),
    createdAt: Date.now()
  });
  save(); closeModal('entryModal'); renderList(); renderArtist();
  toast('记录已添加 ✓');
}
function deleteEntry(eid) {
  if (!confirm('删除这条对比记录？')) return;
  const a = getArtist(currentArtistId);
  a.entries = a.entries.filter(e => e.id !== eid);
  save(); renderList(); renderArtist();
}

