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
      <span class="artist-info"><span class="name" title="${esc(a.name)}">${esc(a.name)}</span><span class="mini-stars">${starMeterHtml(a.rating)}</span>${(a.categories || []).length ? `<span class="artist-labels">${a.categories.slice(0, 3).map(label => `<span class="artist-label-mini">${esc(label)}</span>`).join('')}${a.categories.length > 3 ? `<span class="artist-label-mini">+${a.categories.length - 3}</span>` : ''}</span>` : ''}</span>
    </div>`;
  }).join('');
}

function selectArtist(id) {
  currentArtistId = id;
  renderList();
  renderArtist();
}

/* ================= 画师详情 ================= */
function renderArtist() {
  const a = getArtist(currentArtistId);
  const empty = document.getElementById('emptyState');
  const view = document.getElementById('artistView');
  if (!a) { empty.style.display = 'block'; view.style.display = 'none'; return; }
  empty.style.display = 'none'; view.style.display = 'block';

  const entriesHtml = a.entries.length === 0
    ? '<p style="color:var(--fg2);font-size:14px;padding:12px 0">还没有对比记录，点右上角「＋ 手动添加」上传原图和 NAI 生成图吧</p>'
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
            ${ratingFieldHtml(en.score, { action: 'rateEntry', id: en.id, label: '相似度评分', kind: 'entry' })}
            <span class="entry-actions">
              <button class="btn-ghost btn-sm" data-action="uploadOriginal" data-id="${en.id}" title="上传/替换原图">📷原图</button>
              <button class="btn-ghost btn-sm" data-action="uploadNai" data-id="${en.id}" title="上传/替换NAI生成图">🤖NAI图</button>
              <button class="btn-ghost btn-sm" data-action="editEntry" data-id="${en.id}" title="重新打开这条记录：换图、改 prompt / 评分 / 备注">✏️编辑</button>
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
          <div style="font-size:12px;color:var(--fg2);margin-bottom:4px">NAI 出图效果总评（满分 10 分，半颗星 1 分）</div>
          <div class="artist-rating">${ratingFieldHtml(a.rating, { action: 'setRating', label: 'NAI 出图效果总评' })}</div>
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
// 添加和编辑共用一个弹窗：editingEntryId 为空是新建，否则改的就是那一条（id、创建时间、
// D 站原帖信息都留着）。以前存完就只能单独换图、用单行框改 prompt，评分和备注再也改不了（issue #4）。
let editingEntryId = null;
let entryDraftScore = 3;

function openEntryModal(eid) {
  const en = eid ? getArtist(currentArtistId)?.entries.find(x => x.id === eid) : null;
  if (eid && !en) return;
  editingEntryId = en ? en.id : null;
  tempImgs = { original: en?.originalImg || null, nai: en?.naiImg || null };
  entryDraftScore = en ? normalizeRating(en.score) : 3;
  document.getElementById('entryModalTitle').textContent = en ? '编辑对比记录' : '添加对比记录';
  document.getElementById('entryImagesLabel').textContent = en ? '图片（点方框更换，会自动压缩）' : '上传图片（点击方框选择，会自动压缩）';
  document.getElementById('entrySaveButton').textContent = en ? '保存修改' : '保存记录';
  renderEntryPreview('original');
  renderEntryPreview('nai');
  document.getElementById('fOriginal').value = '';
  document.getElementById('fNai').value = '';
  document.getElementById('fPrompt').value = en?.prompt || '';
  document.getElementById('fComment').value = en?.comment || '';
  document.getElementById('fScoreField').innerHTML = ratingFieldHtml(entryDraftScore, { action: 'rateEntryDraft', label: '相似度评分', kind: 'entry' });
  document.getElementById('entryModal').classList.add('show');
}
function renderEntryPreview(which) {
  const url = tempImgs[which];
  document.getElementById(which === 'original' ? 'prevOriginal' : 'prevNai').innerHTML = url ? `<img src="${esc(url)}">` : '';
}
function pickImage(input, which) {
  const file = input.files[0];
  if (!file) return;
  compressImage(file, url => {
    tempImgs[which] = url;
    renderEntryPreview(which);
  });
}
function saveEntry() {
  const a = getArtist(currentArtistId);
  if (!a) return;
  const editing = editingEntryId ? a.entries.find(x => x.id === editingEntryId) : null;
  if (editingEntryId && !editing) { closeModal('entryModal'); toast('这条记录已经不在了'); return; }
  // 自动抓取时原图没下下来、只留了 D 站作品信息的记录，没有图也允许改评分和备注
  if (!tempImgs.original && !tempImgs.nai && !editing?.sourcePostId) { alert('至少上传一张图片吧'); return; }
  const fields = {
    originalImg: tempImgs.original,
    naiImg: tempImgs.nai,
    prompt: document.getElementById('fPrompt').value.trim(),
    score: normalizeRating(entryDraftScore),
    comment: document.getElementById('fComment').value.trim()
  };
  if (editing) Object.assign(editing, fields, { updatedAt: Date.now() });
  else a.entries.push({ id: uid(), ...fields, createdAt: Date.now() });
  editingEntryId = null;
  save(); closeModal('entryModal'); renderList(); renderArtist();
  toast(editing ? '记录已更新 ✓' : '记录已添加 ✓');
}
function deleteEntry(eid) {
  if (!confirm('删除这条对比记录？')) return;
  const a = getArtist(currentArtistId);
  a.entries = a.entries.filter(e => e.id !== eid);
  save(); renderList(); renderArtist();
}

