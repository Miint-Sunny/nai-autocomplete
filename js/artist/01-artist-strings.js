/* 画师串收藏的原图必须按原始字节保存，不能经过 canvas 压缩或转成 JPEG。 */
let editingArtistStringId = null;
let pendingArtistStringImage = null;
let editingArtistStringCategories = [];
let selectedArtistStringLabels = [];

function parseArtistStringPngChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) throw new Error('不是有效的 PNG 原图');
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const chunks = [];
  let offset = signature.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;
    if (type === 'tEXt') {
      const content = bytes.slice(start, end);
      const separator = content.indexOf(0);
      if (separator >= 0) chunks.push({ key: decoder.decode(content.slice(0, separator)), value: decoder.decode(content.slice(separator + 1)) });
    } else if (type === 'iTXt') {
      const content = bytes.slice(start, end);
      let cursor = 0;
      while (cursor < content.length && content[cursor] !== 0) cursor++;
      const key = decoder.decode(content.slice(0, cursor));
      cursor++;
      const compressed = content[cursor++] || 0;
      cursor++;
      while (cursor < content.length && content[cursor] !== 0) cursor++;
      cursor++;
      while (cursor < content.length && content[cursor] !== 0) cursor++;
      cursor++;
      if (!compressed) chunks.push({ key, value: decoder.decode(content.slice(cursor)) });
    }
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function extractArtistStringImageMetadata(buffer) {
  const chunks = parseArtistStringPngChunks(buffer);
  const values = Object.fromEntries(chunks.map(chunk => [chunk.key, chunk.value]));
  let parsed = null;
  for (const chunk of chunks) {
    try {
      const candidate = JSON.parse(String(chunk.value || '').trim());
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) { parsed = candidate; break; }
    } catch (_) {}
  }
  const meta = parsed || {};
  const root = meta.parameters && typeof meta.parameters === 'object' ? meta.parameters : meta.request?.parameters && typeof meta.request.parameters === 'object' ? meta.request.parameters : meta;
  const prompt = meta.prompt || meta.input || meta.description || values.Description || root.prompt || root.v5_prompt?.caption?.base_caption || root.v4_prompt?.caption?.base_caption || '';
  const negativePrompt = meta.uc || meta.negative_prompt || root.negative_prompt || root.v5_negative_prompt?.caption?.base_caption || root.v4_negative_prompt?.caption?.base_caption || '';
  const characters = root.character_prompts || root.v5_prompt?.caption?.char_captions || root.v4_prompt?.caption?.char_captions || [];
  return {
    hasMetadata: Boolean(parsed || values.Description || values.Comment),
    prompt: String(prompt || ''),
    negativePrompt: String(negativePrompt || ''),
    seed: meta.seed ?? root.seed ?? null,
    width: meta.width ?? root.width ?? null,
    height: meta.height ?? root.height ?? null,
    steps: meta.steps ?? root.steps ?? null,
    scale: meta.scale ?? root.scale ?? null,
    sampler: String(meta.sampler || root.sampler || ''),
    noiseSchedule: String(meta.noise_schedule || root.noise_schedule || ''),
    model: String(meta.model || meta.model_name || meta.request?.model || root.model || values.Software || ''),
    characters: Array.isArray(characters) ? characters.length : 0
  };
}

function readArtistStringImage(file) {
  if (!file) return Promise.reject(new Error('没有选择图片'));
  const imagePromise = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target.result || ''));
    reader.onerror = () => reject(new Error('读取原图失败'));
    reader.readAsDataURL(file);
  });
  return Promise.all([file.arrayBuffer(), imagePromise]).then(([buffer, image]) => {
    const isPng = /\.png$/i.test(file.name || '') || file.type === 'image/png';
    let metadata = { hasMetadata: false, prompt: '' };
    if (isPng) {
      try { metadata = extractArtistStringImageMetadata(buffer); }
      catch (error) { metadata = { hasMetadata: false, prompt: '', error: error.message }; }
    }
    return { image, imageName: String(file.name || 'nai-original.png'), imageType: String(file.type || (isPng ? 'image/png' : 'application/octet-stream')), imageBytes: buffer.byteLength, metadata };
  });
}

function artistStringMetadataSummary(metadata) {
  if (!metadata?.hasMetadata) return '未检测到 NAI 参数；原图仍按原始字节保存';
  return [metadata.model, metadata.seed != null ? `Seed ${metadata.seed}` : '', metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : '', metadata.steps ? `${metadata.steps} Steps` : '', metadata.scale ? `CFG ${metadata.scale}` : '', metadata.characters ? `${metadata.characters} 位角色` : ''].filter(Boolean).join(' · ') || '已读取 NAI 原图信息';
}

function renderArtistStringImagePreview() {
  const preview = document.getElementById('stringImagePreview');
  const summary = document.getElementById('stringImageMetadata');
  const promptBox = document.getElementById('stringImagePrompt');
  if (!pendingArtistStringImage?.image) {
    preview.innerHTML = '<span class="string-image-placeholder">＋ 选择带生成信息的 NAI 原始 PNG</span>';
    summary.textContent = '原图会无损保存，下载后可以继续在 NovelAI 中读取参数。';
    promptBox.innerHTML = '';
    return;
  }
  preview.innerHTML = `<img src="${esc(pendingArtistStringImage.image)}" alt="原图预览"><span class="string-file-name">${esc(pendingArtistStringImage.imageName)}</span>`;
  summary.textContent = artistStringMetadataSummary(pendingArtistStringImage.metadata);
  promptBox.innerHTML = pendingArtistStringImage.metadata?.prompt ? `<details><summary>查看从原图读取的完整 Prompt</summary><pre>${esc(pendingArtistStringImage.metadata.prompt)}</pre><button type="button" class="btn-ghost btn-sm" data-action="useImagePrompt">填入画师串输入框</button></details>` : '';
}

function openArtistStrings() {
  document.getElementById('artistStringSearch').value = '';
  selectedArtistStringLabels = [];
  document.getElementById('stringLabelMatchMode').value = 'any';
  renderArtistStringLabelFilters();
  renderArtistStrings();
  updateStorageText();
  document.getElementById('artistStringsModal').classList.add('show');
}

function labelArtistStringCount(label) {
  if (label === '__uncategorized__') return data.artistStrings.filter(record => !(record.categories || []).length).length;
  return data.artistStrings.filter(record => (record.categories || []).some(category => labelKey(category) === labelKey(label))).length;
}

function renderArtistStringLabelFilters() {
  const box = document.getElementById('artistStringLabelFilters');
  if (!box) return;
  const labels = [...data.labels];
  if (data.artistStrings.some(record => !(record.categories || []).length)) labels.push('__uncategorized__');
  box.innerHTML = labels.length ? labels.map(label => {
    const active = selectedArtistStringLabels.some(item => labelKey(item) === labelKey(label));
    return `<button type="button" class="label-chip ${active ? 'selected' : ''}" data-action="toggleArtistStringFilter" data-label="${esc(label)}">${esc(label === '__uncategorized__' ? '未分类' : label)} <span class="count">${labelArtistStringCount(label)}</span></button>`;
  }).join('') : '<span style="font-size:12px;color:var(--fg2)">还没有分类，可以在新建画师串时直接添加。</span>';
}

function renderArtistStringCategoryPicker() {
  const box = document.getElementById('artistStringCategoryPicker');
  if (!box) return;
  box.innerHTML = data.labels.length ? data.labels.map(label => `<button type="button" class="label-chip ${editingArtistStringCategories.some(item => labelKey(item) === labelKey(label)) ? 'selected' : ''}" data-action="toggleArtistStringCategory" data-label="${esc(label)}">${esc(label)}</button>`).join('') : '<span style="font-size:12px;color:var(--fg2)">暂无分类，可直接在下面新建。</span>';
}

function filteredArtistStrings() {
  const query = String(document.getElementById('artistStringSearch')?.value || '').trim().toLocaleLowerCase();
  const mode = document.getElementById('stringLabelMatchMode')?.value || 'any';
  return data.artistStrings.filter(record => {
    const categories = record.categories || [];
    if (query && ![record.title, record.artistString, record.notes, record.metadata?.prompt, ...categories].some(value => String(value || '').toLocaleLowerCase().includes(query))) return false;
    if (!selectedArtistStringLabels.length) return true;
    const matches = selectedArtistStringLabels.map(label => label === '__uncategorized__' ? !categories.length : categories.some(category => labelKey(category) === labelKey(label)));
    return mode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
  }).sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

function renderArtistStrings() {
  const box = document.getElementById('artistStringList');
  if (!box) return;
  const records = filteredArtistStrings();
  document.getElementById('artistStringCount').textContent = `${records.length} / ${data.artistStrings.length} 条收藏`;
  box.innerHTML = records.length ? records.map(record => {
    const image = record.originalImage ? `<img src="${esc(record.originalImage)}" alt="${esc(record.title)}" loading="lazy" data-action="zoom">` : '<div class="string-image-empty">暂无关联原图</div>';
    const metadata = record.originalImage ? `<p class="string-metadata">${esc(artistStringMetadataSummary(record.metadata))}</p>` : '';
    const notes = record.notes ? `<p class="string-notes">${esc(record.notes)}</p>` : '';
    const chips = (record.categories || []).length ? `<div class="string-card-labels">${record.categories.map(label => `<span class="artist-label-mini">${esc(label)}</span>`).join('')}</div>` : '<div class="string-card-labels"><span class="string-uncategorized">未分类</span></div>';
    return `<article class="string-card"><div class="string-card-image">${image}</div><div class="string-card-info"><h4>${esc(record.title || '未命名画师串')}</h4>${chips}<pre class="string-prompt">${esc(record.artistString)}</pre>${notes}${metadata}<div class="string-actions"><button class="btn-primary btn-sm" data-action="copyArtistString" data-id="${esc(record.id)}">📋 复制画师串</button>${record.originalImage ? `<button class="btn-blue btn-sm" data-action="downloadArtistStringImage" data-id="${esc(record.id)}">⬇ 下载原始图片</button>` : ''}<button class="btn-ghost btn-sm" data-action="editArtistString" data-id="${esc(record.id)}">🏷️ 移动 / 编辑</button><button class="btn-red btn-sm" data-action="deleteArtistString" data-id="${esc(record.id)}">删除</button></div></div></article>`;
  }).join('') : `<div class="string-empty">${data.artistStrings.length ? '没有找到符合条件的画师串。' : '还没有保存画师串，点击右上角「＋ 新建画师串」。'}</div>`;
}

function openArtistStringEditor(id) {
  const current = id ? data.artistStrings.find(record => record.id === id) : null;
  editingArtistStringId = current?.id || null;
  editingArtistStringCategories = uniqueLabels(current?.categories || selectedArtistStringLabels.filter(label => label !== '__uncategorized__'));
  pendingArtistStringImage = current?.originalImage ? { image: current.originalImage, imageName: current.originalImageName || 'nai-original.png', imageType: current.originalImageType || 'image/png', imageBytes: current.originalImageBytes || 0, metadata: current.metadata || { hasMetadata: false, prompt: '' } } : null;
  document.getElementById('stringEditorTitle').textContent = current ? '编辑画师串' : '新建画师串收藏';
  document.getElementById('stringTitle').value = current?.title || '';
  document.getElementById('stringPrompt').value = current?.artistString || '';
  document.getElementById('stringNotes').value = current?.notes || '';
  document.getElementById('stringQuickLabelName').value = '';
  renderArtistStringCategoryPicker();
  renderArtistStringImagePreview();
  document.getElementById('artistStringEditorModal').classList.add('show');
}

function saveArtistString() {
  const artistString = String(document.getElementById('stringPrompt').value || '').trim();
  if (!artistString) { toast('请先填写要保存的画师串'); return false; }
  const title = String(document.getElementById('stringTitle').value || '').trim() || `画师串 ${data.artistStrings.length + 1}`;
  const notes = String(document.getElementById('stringNotes').value || '').trim();
  const existing = editingArtistStringId ? data.artistStrings.find(record => record.id === editingArtistStringId) : null;
  const record = {
    ...(existing || {}),
    id: existing?.id || uid(), title, artistString, notes, categories: uniqueLabels(editingArtistStringCategories),
    originalImage: pendingArtistStringImage?.image || '',
    originalImageName: pendingArtistStringImage?.imageName || '',
    originalImageType: pendingArtistStringImage?.imageType || '',
    originalImageBytes: pendingArtistStringImage?.imageBytes || 0,
    metadata: pendingArtistStringImage?.metadata || { hasMetadata: false, prompt: '' },
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, record); else data.artistStrings.push(record);
  save();
  renderLabelManager();
  renderArtistStringLabelFilters();
  renderArtistStrings();
  closeModal('artistStringEditorModal');
  toast(existing ? '画师串已更新 ✓' : '画师串和无损原图已保存 ✓');
  return true;
}

function deleteArtistString(id) {
  const record = data.artistStrings.find(item => item.id === id);
  if (!record || !confirm(`确定删除画师串「${record.title}」及其关联原图吗？`)) return false;
  data.artistStrings = data.artistStrings.filter(item => item.id !== id);
  save();
  renderLabelManager();
  renderArtistStringLabelFilters();
  renderArtistStrings();
  toast('画师串已删除');
  return true;
}

function downloadArtistStringImage(id) {
  const record = data.artistStrings.find(item => item.id === id);
  if (!record?.originalImage) { toast('这条画师串还没有关联原图'); return false; }
  const anchor = document.createElement('a');
  anchor.href = record.originalImage;
  anchor.download = record.originalImageName || `${String(record.title || 'nai-original').replace(/[\\/:*?"<>|]/g, '_')}.png`;
  anchor.click();
  toast('原始图片已下载，可直接拖入 NAI 读取 ✓');
  return true;
}

function createArtistStringsBackupPayload() {
  ensureDataShape();
  const records = data.artistStrings.map(record => ({
    ...record,
    categories: uniqueLabels([...(record.categories || []), ...(Array.isArray(record.labels) ? record.labels : [])])
  }));
  return {
    format: 'nai-artist-strings-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    pageName: currentLibraryPage().name,
    labels: uniqueLabels(records.flatMap(record => record.categories || [])),
    artistStrings: records
  };
}

function exportArtistStrings() {
  if (!data.artistStrings.length) { toast('当前页面还没有画师串可以导出'); return false; }
  const payload = createArtistStringsBackupPayload();
  downloadBackupFile(JSON.stringify(payload), 'application/json', 'NAI画师串单独备份', 'json');
  toast(`已导出 ${payload.artistStrings.length} 条画师串，包含分类和无损原图 ✓`);
  return true;
}

function parseImportedArtistStrings(content) {
  const parsed = JSON.parse(String(content || '').trim());
  if (Array.isArray(parsed)) return { labels: [], artistStrings: parsed };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.artistStrings)) {
    throw new Error('文件中没有画师串数据，请选择画师串备份或完整备份 JSON');
  }
  return parsed;
}

function applyImportedArtistStrings(imported) {
  ensureDataShape();
  const labels = uniqueLabels([
    ...(Array.isArray(imported.labels) ? imported.labels : []),
    ...imported.artistStrings.flatMap(record => Array.isArray(record?.categories) ? record.categories : [])
  ]);
  for (const label of labels) if (!data.labels.some(existing => labelKey(existing) === labelKey(label))) data.labels.push(label);
  const result = mergeImportedArtistStrings(imported.artistStrings);
  save();
  renderLibraryPages();
  renderLabelFilters();
  renderLabelManager();
  renderArtistStringLabelFilters();
  renderArtistStringCategoryPicker();
  renderArtistStrings();
  return result;
}

function importArtistStrings(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const result = applyImportedArtistStrings(parseImportedArtistStrings(event.target.result));
      toast(`已导入 ${result.added} 条画师串，跳过 ${result.skipped} 条重复 ✓`);
    } catch (error) { alert('画师串导入失败：' + error.message); }
  };
  reader.readAsText(file);
  input.value = '';
}

function mergeImportedArtistStrings(imported) {
  if (!Array.isArray(imported)) return { added: 0, skipped: 0 };
  ensureDataShape();
  const ids = new Set(data.artistStrings.map(item => String(item.id || '')));
  const fingerprints = new Set(data.artistStrings.map(item => `${normalizeArtistKey(item.title)}::${normalizeArtistKey(item.artistString)}`));
  let added = 0;
  let skipped = 0;
  for (const raw of imported) {
    if (!raw || typeof raw !== 'object' || !String(raw.artistString || '').trim()) { skipped++; continue; }
    const title = String(raw.title || '未命名画师串').trim();
    const fingerprint = `${normalizeArtistKey(title)}::${normalizeArtistKey(raw.artistString)}`;
    if ((raw.id && ids.has(String(raw.id))) || fingerprints.has(fingerprint)) { skipped++; continue; }
    const id = raw.id || uid();
    const categories = uniqueLabels([...(Array.isArray(raw.categories) ? raw.categories : []), ...(Array.isArray(raw.labels) ? raw.labels : [])]);
    data.artistStrings.push({ ...raw, id, title, artistString: String(raw.artistString).trim(), notes: String(raw.notes || ''), categories, originalImage: String(raw.originalImage || ''), originalImageName: String(raw.originalImageName || ''), originalImageType: String(raw.originalImageType || ''), metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : { hasMetadata: false, prompt: '' }, createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || raw.createdAt || Date.now() });
    for (const category of categories) if (!data.labels.some(label => labelKey(label) === labelKey(category))) data.labels.push(category);
    ids.add(String(id));
    fingerprints.add(fingerprint);
    added++;
  }
  data.labels.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return { added, skipped };
}
