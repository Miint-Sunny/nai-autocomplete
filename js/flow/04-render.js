// 流的渲染。只产出 HTML 字符串，事件全部走委托 —— 和面板里其他部分一个路子。
// 拖拽期间不重渲染（重渲染会把正在拖的节点整个换掉），落点确定后才重来一次。

function flowEscapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function flowFormatPosts(posts) {
  if (posts >= 1000000) return `${(posts / 1000000).toFixed(1)}M`;
  if (posts >= 10000) return `${Math.round(posts / 1000)}k`;
  if (posts >= 1000) return `${(posts / 1000).toFixed(1)}k`;
  return String(posts);
}

// 换行是行的属性，渲染时先按它把条目切成行
function flowGroupIntoLines(items) {
  const lines = [];
  let current = null;

  items.forEach((item, index) => {
    if (index === 0 || item.newlineBefore) {
      current = { blankBefore: index === 0 ? 0 : (item.blankBefore || 0), items: [] };
      lines.push(current);
    }
    current.items.push(item);
  });

  return lines;
}

function flowChipTitle(item, info) {
  if (!info.known) {
    return `${item.name} · 词典里查不到，模型多半也不认识`;
  }
  const parts = [item.name, `${flowFormatPosts(info.posts)} post`];
  if (info.zh) parts.push(info.zh);
  parts.push(`${info.sourceLabel} / ${info.semanticLabel}`);
  return parts.join(' · ');
}

function flowChipMarkup(item, context) {
  const info = flowClassify(item.name, flowLookupTag(item.name));
  const selected = context.selection.has(item.id);
  const weight = item.weight === 1 ? '' : `<span class="nai-flow-chip-weight">${flowFormatWeight(item.weight)}</span>`;

  return `<span class="nai-flow-chip" data-flow-item="${item.id}" data-source="${info.source}"`
    + ` data-semantic="${info.semantic}" data-known="${info.known}"`
    + `${selected ? ' data-selected="true"' : ''}`
    + ` title="${flowEscapeHtml(flowChipTitle(item, info))}">`
    + `<span class="nai-flow-chip-text">${flowEscapeHtml(item.name)}</span>${weight}`
    + `${info.known ? '' : '<span class="nai-flow-chip-unknown">?</span>'}`
    + '<span class="nai-flow-chip-remove" title="移除">×</span>'
    + '</span>';
}

function flowSentenceMarkup(item, context) {
  const selected = context.selection.has(item.id);
  const role = flowSentenceRole(item.raw);
  const weight = (item.weight ?? 1) === 1
    ? ''
    : `<span class="nai-flow-chip-weight">${flowFormatWeight(item.weight)}</span>`;

  return `<span class="nai-flow-sentence" data-flow-item="${item.id}" data-role="${role.id}"`
    + `${selected ? ' data-selected="true"' : ''}`
    + ` title="自然语言段 · ${role.label} · 点一下改，右键上下拖调权重">`
    + `<span class="nai-flow-sentence-head"><span class="nai-flow-sentence-role">${role.label}</span>${weight}`
    + '<span class="nai-flow-chip-remove" title="移除">×</span></span>'
    + `<span class="nai-flow-sentence-text">${flowEscapeHtml(item.raw)}</span></span>`;
}

function flowGroupMarkup(item, context) {
  const selected = context.selection.has(item.id);
  // 组里可能混着整句，不能一律按 chip 渲染
  const children = item.items.map((child) => flowItemMarkup(child, context)).join('');
  return `<span class="nai-flow-group" data-flow-item="${item.id}"${selected ? ' data-selected="true"' : ''}`
    + ` title="权重组 · ${flowFormatWeight(item.weight)}">`
    + `<span class="nai-flow-group-weight">${flowFormatWeight(item.weight)}</span>${children}</span>`;
}

function flowItemMarkup(item, context) {
  if (item.kind === 'sentence') return flowSentenceMarkup(item, context);
  if (item.kind === 'group') return flowGroupMarkup(item, context);
  return flowChipMarkup(item, context);
}

function flowCanvasMarkup(segment, context) {
  if (!segment.items.length) {
    return `<div class="nai-flow-empty">${context.emptyHint || '这一段还是空的，下面输入框加第一个 tag'}</div>`;
  }

  return flowGroupIntoLines(segment.items)
    .map((line) => `<div class="nai-flow-line"${line.blankBefore ? ` data-blank="${line.blankBefore}"` : ''}>`
      + line.items.map((item) => flowItemMarkup(item, context)).join('')
      + '</div>')
    .join('');
}

function flowSegmentTabsMarkup(flow, activeId) {
  if (flow.segments.length <= 1) return '';

  const tabs = flow.segments
    .map((segment) => `<button type="button" class="nai-md3-inline-action nai-flow-seg${segment.id === activeId ? ' is-active' : ''}"`
      + ` data-flow-action="segment" data-id="${segment.id}">${flowEscapeHtml(segment.name)}`
      + `<span class="nai-flow-seg-count">${segment.items.length}</span></button>`)
    .join('');

  return tabs;
}

function flowSummaryMarkup(flow, segment) {
  const total = flowCountTags(flow);
  let unknown = 0;

  for (const item of segment.items) {
    const list = item.kind === 'group' ? item.items : [item];
    for (const child of list) {
      if (child.kind === 'tag' && !flowLookupTag(child.name)) unknown += 1;
    }
  }

  const parts = [`${total} 个 tag`];
  if (flow.segments.length > 1) parts.push(`${flow.segments.length} 段`);
  if (unknown) parts.push(`本段 ${unknown} 个词典查不到`);
  if (!flowDictionaryReady()) parts.push('词典未加载');
  return flowEscapeHtml(parts.join(' · '));
}

function flowSuggestionsMarkup(entries) {
  if (!entries.length) return '';
  return entries
    .map((entry) => {
      const posts = flowFormatPosts(Number(entry.postCount) || 0);
      const zh = entry.translation ? `<span class="nai-flow-suggest-zh">${flowEscapeHtml(entry.translation)}</span>` : '';
      const info = flowClassify(entry.tag, entry);
      return `<button type="button" class="nai-flow-suggest" data-flow-action="pick" data-tag="${flowEscapeHtml(entry.tag)}"`
        + ` data-semantic="${info.semantic}">`
        + `<span class="nai-flow-suggest-tag">${flowEscapeHtml(entry.tag)}</span>${zh}`
        + `<span class="nai-flow-suggest-posts">${posts}</span></button>`;
    })
    .join('');
}
