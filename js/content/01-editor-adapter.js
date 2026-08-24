const PROMPT_EDITOR_SELECTOR = '.ProseMirror, textarea.comfy-multiline-input';

function findPromptEditor(element) {
  return element?.closest?.(PROMPT_EDITOR_SELECTOR) || null;
}

function isPlainTextPromptEditor(editor) {
  return editor?.tagName === 'TEXTAREA';
}

function isRichTextPromptEditor(editor) {
  return editor?.classList?.contains('ProseMirror');
}

function getMaxDomOffset(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (node.nodeType === Node.ELEMENT_NODE) return node.childNodes.length;
  return 0;
}

function clampDomOffset(node, offset) {
  return Math.max(0, Math.min(Number(offset) || 0, getMaxDomOffset(node)));
}

function safeSetRangeBoundary(range, boundary, node, offset) {
  if (!range || !node) return false;
  try {
    const safeOffset = clampDomOffset(node, offset);
    if (boundary === 'start') range.setStart(node, safeOffset);
    else range.setEnd(node, safeOffset);
    return true;
  } catch (error) {
    return false;
  }
}

function listPromptEditors() {
  return Array.from(document.querySelectorAll(PROMPT_EDITOR_SELECTOR));
}

function getTextareaCaretCoordinates(textarea, position) {
  const style = window.getComputedStyle(textarea);
  const properties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize',
    'whiteSpace', 'wordWrap', 'overflowWrap',
  ];

  const mirror = document.createElement('div');
  properties.forEach(prop => {
    mirror.style[prop] = style[prop];
  });
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = style.whiteSpace === 'normal' ? 'pre-wrap' : style.whiteSpace;
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';

  const textareaRect = textarea.getBoundingClientRect();
  mirror.style.width = `${textarea.clientWidth}px`;

  const value = textarea.value || '';
  const normalizedPosition = Math.max(0, Math.min(position, value.length));
  mirror.textContent = value.slice(0, normalizedPosition);

  const marker = document.createElement('span');
  marker.textContent = value.slice(normalizedPosition, normalizedPosition + 1) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = markerRect.height || parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 16;
  return {
    left: textareaRect.left + markerRect.left - mirrorRect.left - textarea.scrollLeft,
    top: textareaRect.top + markerRect.top - mirrorRect.top - textarea.scrollTop,
    height: lineHeight,
    width: Math.max(markerRect.width, 1),
  };
}

function createTextareaPseudoRange(textarea, startOffset, endOffset) {
  const value = textarea.value || '';
  const start = Math.max(0, Math.min(startOffset, value.length));
  const end = Math.max(start, Math.min(endOffset, value.length));

  return {
    isTextareaRange: true,
    textarea,
    start,
    end,
    toString() {
      return value.slice(start, end);
    },
    getBoundingClientRect() {
      const startPoint = getTextareaCaretCoordinates(textarea, start);
      const endPoint = getTextareaCaretCoordinates(textarea, end);
      const top = Math.min(startPoint.top, endPoint.top);
      const left = Math.min(startPoint.left, endPoint.left);
      const height = Math.max(startPoint.height, endPoint.height, 16);
      const width = Math.max(endPoint.left - startPoint.left, 1);
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
    getClientRects() {
      return [this.getBoundingClientRect()];
    },
  };
}

// getEditorText() 的偏移和 DOM 文本节点里的偏移不是一套坐标：
// getEditorNodeText 会给 <br> 和块级元素补一个 \n、把宏节点整个换成 data-macro-expansion，
// getEditorText 再去掉 \u200b 并 trim 掉首尾空白 —— 这些字符在文本节点里根本不存在。
// 而 createRangeFromTextOffsets 只走文本节点，拿 getEditorText 的偏移直接喂它，
// 每经过一个换行就整体错开一格，行数越多偏得越离谱。
//
// 所以这里按 getEditorNodeText 的规则重走一遍 DOM，边走边记下每段真实文本对应的
// (节点, 节点内偏移)，合成出来的字符（换行、宏展开）只记到元素边界。改 getEditorNodeText
// 的时候这里必须跟着改，两边是同一套规则的两个视角。
function buildEditorTextMap(editor) {
  if (!editor) return null;

  const runs = [];
  let text = '';

  const pushText = (raw, node) => {
    let index = 0;
    while (index < raw.length) {
      if (raw[index] === '\u200b') {
        index += 1;
        continue;
      }
      let end = index;
      while (end < raw.length && raw[end] !== '\u200b') end += 1;
      runs.push({ start: text.length, length: end - index, node, nodeOffset: index });
      text += raw.slice(index, end);
      index = end;
    }
  };

  const pushSynthetic = (raw, element) => {
    if (!raw.length) return;
    runs.push({ start: text.length, length: raw.length, element });
    text += raw;
  };

  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent || '', node);
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const macroExpansion = getMacroExpansion(node);
    if (macroExpansion) {
      // 宏节点屏幕上显示的文本和展开文本长度不同，只能整块贴到元素两侧
      pushSynthetic(macroExpansion.replace(/\u200b/g, ''), node);
      return;
    }

    if (node.tagName === 'BR') {
      pushSynthetic('\n', node);
      return;
    }

    const isBlock = /^(P|DIV|LI)$/.test(node.tagName) && !node.classList.contains('macro-node');
    Array.from(node.childNodes).forEach(visit);
    if (isBlock) pushSynthetic('\n', node);
  };

  Array.from(editor.childNodes).forEach(visit);

  // getEditorText 最后 trim 了一次，逻辑偏移是从 trim 之后算起的。
  // text 原样带出来，测试拿它和 getEditorText(editor) 对一遍 —— 两边必须一模一样。
  return { runs, text, length: text.trim().length, leading: text.length - text.trimStart().length };
}

function elementBoundaryPoint(element, after) {
  const parent = element?.parentNode;
  if (!parent) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, element);
  if (index === -1) return null;
  return { node: parent, offset: after ? index + 1 : index };
}

// side='before' 取第 offset 个字符之前的位置，side='after' 取第 offset-1 个字符之后的位置
function locateEditorTextPoint(map, offset, side) {
  const target = side === 'after' ? offset - 1 : offset;
  if (target < 0) {
    const first = map.runs.find(run => run.node);
    return first ? { node: first.node, offset: first.nodeOffset } : null;
  }

  for (const run of map.runs) {
    if (target >= run.start + run.length) continue;
    if (run.node) {
      const inside = run.nodeOffset + (target - run.start);
      return { node: run.node, offset: side === 'after' ? inside + 1 : inside };
    }
    return elementBoundaryPoint(run.element, side === 'after');
  }

  for (let i = map.runs.length - 1; i >= 0; i -= 1) {
    const run = map.runs[i];
    if (run.node) return { node: run.node, offset: run.nodeOffset + run.length };
  }
  return null;
}

// 唯一接受 getEditorText() 坐标的取范围入口。别拿这套偏移去喂 createRangeFromTextOffsets，
// 那个吃的是 Range.toString() 坐标（自动补全那条链路用的是它，两边不能混）。
function createRangeFromEditorTextOffsets(editor, startOffset, endOffset) {
  if (!editor) return null;

  const start = Math.max(0, startOffset);
  const end = Math.max(start, endOffset);

  if (isPlainTextPromptEditor(editor)) {
    const value = String(editor.value || '');
    const visible = [];
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] !== '\u200b') visible.push(i);
    }
    let head = 0;
    let tail = visible.length;
    while (head < tail && /\s/.test(value[visible[head]])) head += 1;
    while (tail > head && /\s/.test(value[visible[tail - 1]])) tail -= 1;
    const indices = visible.slice(head, tail);
    if (!indices.length) return createTextareaPseudoRange(editor, 0, 0);

    const clampedStart = Math.min(start, indices.length);
    const clampedEnd = Math.min(end, indices.length);
    const valueStart = clampedStart < indices.length
      ? indices[clampedStart]
      : indices[indices.length - 1] + 1;
    const valueEnd = clampedEnd > 0
      ? indices[clampedEnd - 1] + 1
      : valueStart;
    return createTextareaPseudoRange(editor, valueStart, Math.max(valueStart, valueEnd));
  }

  const map = buildEditorTextMap(editor);
  if (!map?.runs.length) return null;

  const startPoint = locateEditorTextPoint(map, Math.min(start, map.length) + map.leading, 'before');
  const endPoint = locateEditorTextPoint(map, Math.min(end, map.length) + map.leading, 'after');
  if (!startPoint || !endPoint) return null;

  try {
    const range = document.createRange();
    range.setStart(startPoint.node, clampDomOffset(startPoint.node, startPoint.offset));
    range.setEnd(endPoint.node, clampDomOffset(endPoint.node, endPoint.offset));
    if (range.collapsed && start !== end) return null;
    return range;
  } catch (error) {
    return null;
  }
}

function buildTextareaSegmentContext(editor) {
  const value = editor.value || '';
  const caretOffset = Number.isFinite(editor.selectionStart) ? editor.selectionStart : value.length;
  const beforeText = value.slice(0, caretOffset);
  const afterText = value.slice(caretOffset);

  const segmentBreak = findLastPromptSegmentBreak(beforeText);
  const rawSegment = beforeText.slice(segmentBreak + 1);
  const leadingSpaceLength = rawSegment.match(/^\s*/)?.[0].length || 0;
  const segmentText = rawSegment.slice(leadingSpaceLength);
  const segmentStartOffset = caretOffset - segmentText.length;
  const segmentTailMatch = afterText.match(/^[^,，\n|]*/);
  const segmentTailText = segmentTailMatch ? segmentTailMatch[0] : '';
  const afterSegmentText = afterText.slice(segmentTailText.length);
  const nextMeaningfulChar = afterSegmentText.replace(/^\s+/, '').charAt(0);

  return {
    editor,
    caretNode: null,
    caretNodeOffset: caretOffset,
    nodeSegmentStartOffset: segmentStartOffset,
    nodeSegmentTailText: segmentTailText,
    scope: editor,
    scopeSegmentStartOffset: segmentStartOffset,
    scopeSegmentText: segmentText,
    scopeCaretOffset: caretOffset,
    scopeSegmentTailText: segmentTailText,
    segmentText,
    segmentTailText,
    segmentStartOffset,
    caretOffset,
    nextMeaningfulChar,
    segmentRange: createTextareaPseudoRange(editor, segmentStartOffset, caretOffset),
  };
}

function getTextareaSelectionContext(editor) {
  if (!editor || !isPlainTextPromptEditor(editor)) return null;
  const value = editor.value || '';
  const start = editor.selectionStart ?? 0;
  const end = editor.selectionEnd ?? start;
  if (start === end) return null;

  const selectedText = value.slice(start, end);
  const selectedTags = splitPromptTags(selectedText);
  if (!selectedTags.length) return null;

  const beforeText = value.slice(0, start);
  const startTokenIndex = splitPromptTags(beforeText).length;
  const startPoint = getTextareaCaretCoordinates(editor, start);
  const endPoint = getTextareaCaretCoordinates(editor, end);

  return {
    startTokenIndex,
    endTokenIndex: startTokenIndex + selectedTags.length - 1,
    selectedTags,
    selectedText,
    range: createTextareaPseudoRange(editor, start, end),
    rect: {
      left: Math.min(startPoint.left, endPoint.left),
      top: Math.min(startPoint.top, endPoint.top),
      width: Math.max(endPoint.left - startPoint.left, 1),
      height: Math.max(startPoint.height, endPoint.height, 16),
      right: Math.max(startPoint.left, endPoint.left),
      bottom: Math.max(startPoint.top + startPoint.height, endPoint.top + endPoint.height),
    },
  };
}

function computeReplacementOffsets(context, start, includeTail, options = {}) {
  const {
    segmentStartOffset,
    caretOffset,
    segmentTailText,
    scopeSegmentStartOffset,
    scopeCaretOffset,
    scopeSegmentTailText,
  } = context;

  const hasExplicitEnd = Number.isFinite(options.end);
  const useScope = Boolean(options.preferScope);
  const baseStart = useScope ? scopeSegmentStartOffset : segmentStartOffset;
  const baseCaret = useScope ? scopeCaretOffset : caretOffset;
  const tailText = useScope ? scopeSegmentTailText : segmentTailText;

  const replacementStart = baseStart + start;
  const replacementEnd = hasExplicitEnd
    ? baseStart + options.end
    : (includeTail ? baseCaret + tailText.length : baseCaret);

  return {
    start: Math.max(0, replacementStart),
    end: Math.max(replacementStart, replacementEnd),
  };
}

function getEditorTextBeforeOffset(editor, endOffset) {
  if (!editor) return '';

  const normalizedEnd = Math.max(0, endOffset);
  if (isPlainTextPromptEditor(editor)) {
    return (editor.value || '').slice(0, normalizedEnd);
  }

  const range = createRangeFromTextOffsets(editor, 0, normalizedEnd);
  return range ? range.toString() : '';
}

function replacePromptEditorText(editor, start, end, text) {
  if (!editor) return;

  if (isPlainTextPromptEditor(editor)) {
    const value = editor.value || '';
    const normalizedStart = Math.max(0, Math.min(start, value.length));
    const normalizedEnd = Math.max(normalizedStart, Math.min(end, value.length));
    editor.value = value.slice(0, normalizedStart) + text + value.slice(normalizedEnd);
    const caret = normalizedStart + text.length;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const range = createRangeFromTextOffsets(editor, start, end);
  if (!range || range.isTextareaRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, text);
}

function replacePromptEditorSegment(context, start, includeTail, text, options = {}) {
  if (!context?.editor) return false;

  if (isPlainTextPromptEditor(context.editor)) {
    const offsets = computeReplacementOffsets(context, start, includeTail, options);
    replacePromptEditorText(context.editor, offsets.start, offsets.end, text);
    return true;
  }

  const range = Number.isFinite(options.end) && !includeTail && start === 0
    ? createWeightPrefixRange(context, options.end)
    : createRangeForCurrentTextSegment(context, start, includeTail, options);
  if (!range || range.isTextareaRange) return false;

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, text);
  return true;
}

function getPromptEditorCaretRect(editor) {
  if (!editor) return null;

  if (isPlainTextPromptEditor(editor)) {
    const position = Number.isFinite(editor.selectionStart) ? editor.selectionStart : editor.value.length;
    const point = getTextareaCaretCoordinates(editor, position);
    return {
      left: point.left,
      top: point.top,
      width: point.width,
      height: point.height,
      right: point.left + point.width,
      bottom: point.top + point.height,
    };
  }

  const sel = window.getSelection();
  if (!sel?.rangeCount) return editor.getBoundingClientRect();

  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);

  let rect = range.getBoundingClientRect();
  if (rect && (rect.width || rect.height)) return rect;

  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  marker.setAttribute('data-nai-caret-marker', 'true');

  try {
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
  } finally {
    marker.remove();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return rect && (rect.width || rect.height) ? rect : editor.getBoundingClientRect();
}

function isComfyUiPage() {
  return /^(?:127\.0\.0\.1|localhost):8188$/i.test(location.host);
}

function getPromptEditorUiScale(editor) {
  if (!editor) return 1;

  if (isComfyUiPage() || isPlainTextPromptEditor(editor)) {
    const graphScale = Number(
      window.app?.canvas?.ds?.scale ??
      window.app?.graph?.state?.zoom ??
      window.app?.graph?._zoom,
    );
    if (Number.isFinite(graphScale) && graphScale > 0) {
      return Math.max(0.35, Math.min(2.5, graphScale));
    }

    const rect = editor.getBoundingClientRect();
    const layoutWidth = editor.offsetWidth || rect.width;
    const layoutHeight = editor.offsetHeight || rect.height;
    if (layoutWidth || layoutHeight) {
      const scaleX = layoutWidth ? rect.width / layoutWidth : 1;
      const scaleY = layoutHeight ? rect.height / layoutHeight : scaleX;
      return Math.max(0.35, Math.min(2.5, (scaleX + scaleY) / 2));
    }
  }

  return 1;
}

function applyOverlayUiScale(element, scale) {
  if (!element) return 1;

  const normalized = (!scale || Math.abs(scale - 1) < 0.04)
    ? 1
    : Math.max(0.35, Math.min(2.5, scale));

  if (normalized === 1) {
    element.style.zoom = '';
    element.dataset.naiUiScale = '1';
  } else {
    element.style.zoom = String(normalized);
    element.dataset.naiUiScale = String(normalized);
  }

  return normalized;
}

function clearOverlayUiScale(element) {
  if (!element) return;
  element.style.zoom = '';
  element.dataset.naiUiScale = '1';
}

function getTextOffsetBeforeTextareaPoint(editor, clientX, clientY) {
  const value = editor.value || '';
  if (!value.length) return 0;

  const rect = editor.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return value.length;
  }

  let low = 0;
  let high = value.length;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = getTextareaCaretCoordinates(editor, mid);
    const distance = Math.hypot(point.left - clientX, point.top - clientY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mid;
    }
    if (point.top > clientY + 2 || (Math.abs(point.top - clientY) < 2 && point.left > clientX)) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return best;
}
