// TAG 流的数据模型：文本 ⇄ 结构。content 脚本和 assistant 脚本共用这一份。
//
// NAI 的提示词有三层结构，缺一层都会解析错：
//   ① `|` 分段  —— base | 角色1 | 角色2，多角色时还习惯以 `|` 结尾
//   ② 换行分层  —— V5 写法是「锚点 tag 一行 + 自然语言段落几行 + 氛围串一行」
//   ③ 逗号条目  —— 其中可能夹着 `1.2::a, b::` 这种带权重的组
//
// 硬性要求：没编辑过的规范文本必须原样回来（serialize(parse(t)) === t）。
// 非规范输入（多余空格、中文逗号）会被规范化，这是有意的。

const FLOW_ITEM_SEPARATOR = ', ';
const FLOW_SEGMENT_SEPARATOR = ' | ';
const FLOW_BRACKET_STEP = 1.05;
const FLOW_PAREN_STEP = 1.1;

let flowIdCounter = 0;

function flowCreateId(prefix) {
  flowIdCounter += 1;
  return `${prefix}-${flowIdCounter.toString(36)}`;
}

function flowRoundWeight(weight) {
  const value = Math.round(Number(weight) * 100) / 100;
  return Number.isFinite(value) ? value : 1;
}

function flowFormatWeight(weight) {
  return String(flowRoundWeight(weight)).replace(/\.0+$/, '');
}

function flowIsBalanced(text, open, close) {
  let depth = 0;
  for (const char of text) {
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// 三种权重写法都得认：NAI 数值 `1.2::x::`、NAI 旧括号 `{x}` / `[x]`、SD 的 `(x:1.2)`。
// 出去的时候统一成数值语法。
function flowParseAtomWeight(raw) {
  let text = String(raw || '').trim();
  let weight = 1;

  const sdMatch = text.match(/^\((.+):\s*(-?[\d.]+)\s*\)$/);
  if (sdMatch && flowIsBalanced(sdMatch[1], '(', ')')) {
    return { text: sdMatch[1].trim(), weight: flowRoundWeight(sdMatch[2]) };
  }

  for (let guard = 0; guard < 12; guard += 1) {
    const inner = text.slice(1, -1);
    if (text.length > 2 && text.startsWith('{') && text.endsWith('}') && flowIsBalanced(inner, '{', '}')) {
      weight *= FLOW_BRACKET_STEP;
    } else if (text.length > 2 && text.startsWith('[') && text.endsWith(']') && flowIsBalanced(inner, '[', ']')) {
      weight /= FLOW_BRACKET_STEP;
    } else if (text.length > 2 && text.startsWith('(') && text.endsWith(')') && flowIsBalanced(inner, '(', ')')) {
      weight *= FLOW_PAREN_STEP;
    } else {
      break;
    }
    text = inner.trim();
  }

  return { text, weight: flowRoundWeight(weight) };
}

// 整句不是 tag：不查词典、不给权重、不按逗号切碎。V5 的提示词一半是自然语言，
// 认错了整个流就散架，所以判定要保守 —— 拿不准的当 tag，用户可以手动改判。
function flowLooksLikeSentence(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 70) return true;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 6) return true;
  if (words.length >= 4 && /[.!?。！？]$/.test(value)) return true;
  if (words.length >= 4 && /\s(the|is|are|was|were|his|her|their|while|toward|towards|against|behind)\s/i.test(` ${value} `)) {
    return true;
  }
  return false;
}

// 在括号外按分隔符切。`::` 组内部的逗号不能切，所以先把权重组整段抠出来。
function flowSplitTopLevel(text, separator) {
  const parts = [];
  let current = '';
  let depth = 0;
  let index = 0;

  while (index < text.length) {
    const rest = text.slice(index);

    // 数值权重组：`1.2::` 开头，一直到下一个 `::`（或行尾）为止，整段原样收下
    const open = rest.match(/^(-?\d+(?:\.\d+)?)::/);
    if (open && depth === 0) {
      const closeIndex = text.indexOf('::', index + open[0].length);
      const end = closeIndex < 0 ? text.length : closeIndex + 2;
      current += text.slice(index, end);
      index = end;
      continue;
    }

    const char = text[index];
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1);

    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
    index += 1;
  }

  parts.push(current);
  return parts;
}

function flowParseItem(raw) {
  const source = String(raw || '').trim();
  if (!source) return null;

  // 数值权重组：`1.2::a, b::`
  const groupMatch = source.match(/^(-?\d+(?:\.\d+)?)::([\s\S]*?)(?:::)?$/);
  if (groupMatch && source.includes('::')) {
    const weight = flowRoundWeight(groupMatch[1]);
    const body = groupMatch[2].trim();
    // 组里同样要合并整句：`1.2::The character is caught…, her hair reacts…::`
    // 按逗号切完是两段，不合回去就会被当成一个「两成员的组」，渲染和编辑都不对。
    const children = flowCoalesceSentences(
      flowSplitTopLevel(body, ',').map((part) => flowParseItem(part)).filter(Boolean),
    );

    if (!children.length) return null;
    // 单成员的组没有存在意义。整句同样可以带权重 ——
    // skill 第 11 节的排查手段之一就是「这一段没画出来 → 提权重」。
    if (children.length === 1 && children[0].kind !== 'group') {
      return { ...children[0], weight: flowRoundWeight((children[0].weight || 1) * weight) };
    }
    return { kind: 'group', id: flowCreateId('grp'), weight, items: children, newlineBefore: false, blankBefore: 0 };
  }

  // 行尾的句号属于这一行，不属于最后那个 tag —— 拆出来存着，
  // 否则一旦重排，句号就跟着那个 tag 跑到行中间去了。
  let text = source;
  let trailing = '';
  const trailingMatch = text.match(/[.。]$/);
  if (trailingMatch && !flowLooksLikeSentence(text)) {
    trailing = trailingMatch[0];
    text = text.slice(0, -1).trim();
  }

  if (flowLooksLikeSentence(text)) {
    return { kind: 'sentence', id: flowCreateId('sen'), raw: source, weight: 1, newlineBefore: false, blankBefore: 0 };
  }

  const { text: name, weight } = flowParseAtomWeight(text);
  if (!name) return null;

  return { kind: 'tag', id: flowCreateId('tag'), name, weight, trailing, newlineBefore: false, blankBefore: 0 };
}

// 自然语言句子里本来就有逗号，按逗号切完会把一句话拆成好几块。
// 同一行里连续的整句合回去 —— 拼接用的还是 ", "，所以往返文本一字不差。
function flowCoalesceSentences(items) {
  const merged = [];

  for (const item of items) {
    const previous = merged[merged.length - 1];
    // 权重不同的两句不能合 —— 合了就丢掉一个权重
    if (item.kind === 'sentence' && previous?.kind === 'sentence'
      && (previous.weight ?? 1) === 1 && (item.weight ?? 1) === 1) {
      previous.raw = `${previous.raw}${FLOW_ITEM_SEPARATOR}${item.raw}`;
      continue;
    }
    merged.push(item);
  }

  return merged;
}

function flowParseSegment(text, index, total) {
  const items = [];
  const lines = String(text || '').split('\n');
  let pendingBlank = 0;
  let started = false;

  for (const line of lines) {
    if (!line.trim()) {
      if (started) pendingBlank += 1;
      continue;
    }

    const parsed = flowCoalesceSentences(
      flowSplitTopLevel(line, ',').map((part) => flowParseItem(part)).filter(Boolean),
    );
    if (!parsed.length) continue;

    parsed[0].newlineBefore = started;
    parsed[0].blankBefore = started ? pendingBlank : 0;
    pendingBlank = 0;
    started = true;
    items.push(...parsed);
  }

  const isBase = index === 0 && total > 1;
  return {
    id: flowCreateId('seg'),
    kind: total === 1 ? 'single' : (isBase ? 'base' : 'character'),
    name: total === 1 ? '提示词' : (isBase ? '基础' : `角色 ${index}`),
    items,
  };
}

function flowParse(text) {
  const source = String(text || '');
  const rawSegments = flowSplitTopLevel(source, '|');

  // 多角色提示词习惯以 `|` 收尾，切出来最后会多一个空段
  let trailingPipe = false;
  while (rawSegments.length > 1 && !rawSegments[rawSegments.length - 1].trim()) {
    rawSegments.pop();
    trailingPipe = true;
  }

  const total = rawSegments.length;
  const segments = rawSegments.map((part, index) => flowParseSegment(part, index, total));

  return { segments, trailingPipe, normalized: false };
}

function flowSerializeItem(item) {
  if (item.kind === 'sentence') {
    return (item.weight ?? 1) === 1 ? item.raw : `${flowFormatWeight(item.weight)}::${item.raw}::`;
  }

  if (item.kind === 'group') {
    const body = item.items.map((child) => flowSerializeItem(child)).join(FLOW_ITEM_SEPARATOR);
    return `${flowFormatWeight(item.weight)}::${body}::`;
  }

  const name = item.name;
  return item.weight === 1 ? name : `${flowFormatWeight(item.weight)}::${name}::`;
}

function flowSerializeItems(items) {
  let out = '';

  items.forEach((item, index) => {
    if (index > 0) {
      out += item.newlineBefore ? '\n'.repeat(1 + (item.blankBefore || 0)) : FLOW_ITEM_SEPARATOR;
    }
    out += flowSerializeItem(item);

    const endsLine = index === items.length - 1 || items[index + 1]?.newlineBefore;
    if (endsLine && item.trailing) out += item.trailing;
  });

  return out;
}

function flowSerialize(flow) {
  const body = (flow?.segments || []).map((segment) => flowSerializeItems(segment.items)).join(FLOW_SEGMENT_SEPARATOR);
  return flow?.trailingPipe ? `${body} |` : body;
}

// ───────────────────────────── 结构操作 ─────────────────────────────

function flowFindItem(flow, itemId) {
  for (const segment of flow.segments) {
    for (let index = 0; index < segment.items.length; index += 1) {
      const item = segment.items[index];
      if (item.id === itemId) return { segment, item, index };
      if (item.kind === 'group') {
        const childIndex = item.items.findIndex((child) => child.id === itemId);
        if (childIndex >= 0) return { segment, item: item.items[childIndex], index: childIndex, group: item };
      }
    }
  }
  return null;
}

// newlineBefore 和行尾句号是**行**的属性，只是寄存在条目身上。
// 条目一旦被移走，这两个职责得交给邻居，否则重排会把换行和句号一起带跑：
//   a, b\nc, d  把 c 挪到最前 → 换行必须留给 d，不能跟着 c 走
//   1girl, from below.  把 from below 挪到最前 → 句号留给新的行尾
function flowDetachItem(list, index) {
  const item = list[index];
  if (!item) return null;

  const next = list[index + 1];
  const previous = list[index - 1];

  if (item.newlineBefore && next && !next.newlineBefore) {
    next.newlineBefore = true;
    next.blankBefore = item.blankBefore || 0;
  }
  // 前一条同行才接得住句号；自己就是行首的话这一行整个没了
  if (item.trailing && previous && !item.newlineBefore) {
    previous.trailing = item.trailing;
  }

  item.newlineBefore = false;
  item.blankBefore = 0;
  item.trailing = '';

  list.splice(index, 1);
  return item;
}

function flowRemoveItem(flow, itemId) {
  const found = flowFindItem(flow, itemId);
  if (!found) return null;

  const list = found.group ? found.group.items : found.segment.items;
  const removed = flowDetachItem(list, found.index);

  // 组里只剩一个成员就没有存在意义了，拆回普通 tag
  if (found.group && found.group.items.length === 1) {
    flowDissolveGroup(flow, found.group.id);
  } else if (found.group && !found.group.items.length) {
    const groupIndex = found.segment.items.indexOf(found.group);
    if (groupIndex >= 0) found.segment.items.splice(groupIndex, 1);
  }

  flowNormalizeLineFlags(found.segment);
  return removed;
}

function flowDissolveGroup(flow, groupId) {
  for (const segment of flow.segments) {
    const index = segment.items.findIndex((item) => item.id === groupId && item.kind === 'group');
    if (index < 0) continue;

    const group = segment.items[index];
    const children = group.items.map((child, childIndex) => ({
      ...child,
      weight: child.kind === 'tag' ? flowRoundWeight(child.weight * group.weight) : child.weight,
      newlineBefore: childIndex === 0 ? group.newlineBefore : false,
      blankBefore: childIndex === 0 ? group.blankBefore : 0,
    }));

    segment.items.splice(index, 1, ...children);
    return children;
  }
  return null;
}

// 权重回到 1 的组就没有意义了（`1::a, b::` 只是噪音），直接拆开。
function flowSetItemWeight(flow, itemId, weight) {
  const found = flowFindItem(flow, itemId);
  if (!found) return null;

  const next = flowRoundWeight(weight);
  found.item.weight = next;
  if (found.item.kind === 'group' && next === 1) flowDissolveGroup(flow, found.item.id);
  return found.item;
}

function flowGroupItems(flow, itemIds, weight = FLOW_PAREN_STEP) {
  const ids = new Set(itemIds);
  for (const segment of flow.segments) {
    const picked = segment.items.filter((item) => ids.has(item.id) && item.kind !== 'group');
    if (picked.length < 2) continue;

    const anchor = segment.items.indexOf(picked[0]);
    const group = {
      kind: 'group',
      id: flowCreateId('grp'),
      weight: flowRoundWeight(weight),
      items: picked.map((item) => ({ ...item, newlineBefore: false, blankBefore: 0, trailing: '' })),
      newlineBefore: picked[0].newlineBefore,
      blankBefore: picked[0].blankBefore,
    };

    segment.items = segment.items.filter((item) => !ids.has(item.id));
    segment.items.splice(Math.min(anchor, segment.items.length), 0, group);
    flowNormalizeLineFlags(segment);
    return group;
  }
  return null;
}

function flowMoveItem(flow, itemId, targetSegmentId, targetIndex) {
  const found = flowFindItem(flow, itemId);
  if (!found) return false;

  const target = flow.segments.find((segment) => segment.id === targetSegmentId);
  if (!target) return false;

  const sourceList = found.group ? found.group.items : found.segment.items;
  const moved = flowDetachItem(sourceList, found.index);
  if (!moved) return false;
  if (found.group && found.group.items.length === 1) flowDissolveGroup(flow, found.group.id);

  const bounded = Math.max(0, Math.min(targetIndex, target.items.length));
  target.items.splice(bounded, 0, moved);

  flowNormalizeLineFlags(found.segment);
  if (target !== found.segment) flowNormalizeLineFlags(target);
  return true;
}

// 第一条永远不能带换行标记，否则序列化出来会以空行开头
function flowNormalizeLineFlags(segment) {
  segment.items.forEach((item, index) => {
    if (index === 0) {
      item.newlineBefore = false;
      item.blankBefore = 0;
    }
  });
}

// skill 第 11 节的排查手段：tag 被忽略就改用自然语言整句。
// 启发式判定一定有认错的时候，得留手动改判的口子。
function flowToggleItemKind(flow, itemId) {
  const found = flowFindItem(flow, itemId);
  if (!found || found.item.kind === 'group') return null;

  const list = found.group ? found.group.items : found.segment.items;
  const item = found.item;

  // 句号得原样交接：转成 tag 时挪进 trailing（行属性），转回整句时并回正文。
  // 少了这一步，来回转一圈文本就变了。
  const punctuation = item.kind === 'sentence' ? (item.raw.match(/[.。]$/)?.[0] || '') : '';

  const next = item.kind === 'sentence'
    ? {
      kind: 'tag',
      id: item.id,
      name: item.raw.slice(0, item.raw.length - punctuation.length).trim(),
      weight: item.weight ?? 1,
      trailing: punctuation,
    }
    : { kind: 'sentence', id: item.id, raw: `${item.name}${item.trailing || ''}`, weight: item.weight ?? 1 };

  list[found.index] = { ...next, newlineBefore: item.newlineBefore, blankBefore: item.blankBefore };
  return list[found.index];
}

function flowAddSegment(flow) {
  const segment = flowParseSegment('', flow.segments.length, flow.segments.length + 1);
  flow.segments.push(segment);
  flowRenameSegments(flow);
  return segment;
}

function flowRemoveSegment(flow, segmentId) {
  if (flow.segments.length <= 1) return false;
  flow.segments = flow.segments.filter((segment) => segment.id !== segmentId);
  flowRenameSegments(flow);
  return true;
}

function flowRenameSegments(flow) {
  const total = flow.segments.length;
  flow.segments.forEach((segment, index) => {
    if (total === 1) {
      segment.kind = 'single';
      segment.name = '提示词';
    } else if (index === 0) {
      segment.kind = 'base';
      segment.name = '基础';
    } else {
      segment.kind = 'character';
      segment.name = `角色 ${index}`;
    }
  });
  if (total > 1) flow.trailingPipe = true;
}

// 「无角色」导出：只要基础段。多角色场景想换一批人物时用。
function flowSerializeBaseOnly(flow) {
  if (!flow.segments.length) return '';
  return flowSerializeItems(flow.segments[0].items);
}

function flowCountTags(flow) {
  let count = 0;
  for (const segment of flow.segments) {
    for (const item of segment.items) {
      if (item.kind === 'group') count += item.items.length;
      else if (item.kind === 'tag') count += 1;
    }
  }
  return count;
}

// 同名 tag 只留第一个（权重取最大的那个），跨段不去重 —— 不同角色本来就会重复
function flowDedupe(flow) {
  let removed = 0;
  for (const segment of flow.segments) {
    const seen = new Map();
    segment.items = segment.items.filter((item) => {
      if (item.kind !== 'tag') return true;
      const key = item.name.toLowerCase().replace(/_/g, ' ');
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, item);
        return true;
      }
      previous.weight = flowRoundWeight(Math.max(previous.weight, item.weight));
      removed += 1;
      return false;
    });
    flowNormalizeLineFlags(segment);
  }
  return removed;
}
