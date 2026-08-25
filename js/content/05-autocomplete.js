function createContainer() {
  if (autocompleteContainer) return autocompleteContainer;
  const c = document.createElement('div');
  c.className = 'nai-autocomplete-container';
  c.innerHTML = `
    <div class="nai-autocomplete-header">
      <span class="nai-autocomplete-title">标签补全</span>
      <div class="nai-autocomplete-toggles">
        <button type="button" class="nai-ac-chip" id="nai-slash-switch" title="下划线与空格互转" aria-pressed="false">_ ⇄ 空格</button>
        <button type="button" class="nai-ac-chip" id="nai-highlight-switch" title="在输入框里给每个 TAG 画分类下划线" aria-pressed="false">TAG 下划线</button>
      </div>
    </div>
    <div class="nai-autocomplete-list"></div>
    <div class="nai-autocomplete-footer"><span class="nai-autocomplete-count-info"></span><span>↑↓ 选择 · Tab 确认</span></div>
  `;
  document.body.appendChild(c);
  autocompleteContainer = c;

  const holdAutocompleteInteraction = event => {
    autocompletePointerDownAt = Date.now();
  };
  const handleAutocompleteContainerPick = event => {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('.nai-autocomplete-item');
    if (!item || !c.contains(item)) return;
    handleAutocompleteItemEvent(item, event);
  };
  c.addEventListener('pointerdown', holdAutocompleteInteraction, true);
  c.addEventListener('mousedown', holdAutocompleteInteraction, true);
  c.addEventListener('pointerdown', handleAutocompleteContainerPick, true);
  c.addEventListener('mousedown', handleAutocompleteContainerPick, true);
  c.addEventListener('click', handleAutocompleteContainerPick, true);

  // 下划线互转开关
  bindAutocompleteToggleChip(
    c.querySelector('#nai-slash-switch'),
    settings.convertSlashToSpace,
    (on) => {
      settings.convertSlashToSpace = on;
      persistAutocompleteSettings();
    },
  );

  // TAG 下划线开关。只管那层装饰，区块的按钮和拖拽照常。
  bindAutocompleteToggleChip(
    c.querySelector('#nai-highlight-switch'),
    settings.highlightTags !== false,
    (on) => {
      settings.highlightTags = on;
      persistAutocompleteSettings();
      if (activeEditor) renderPromptBlockPanel(activeEditor);
    },
  );

  document.addEventListener('click', e => {
    if (!c.contains(e.target) && e.target !== activeEditor) hideAutocomplete();
  });
  return c;
}

// 弹窗里只有三种控件，结构上就得分得开，不然一行里全是长得一样的胶囊、
// 分不清哪个能点：
//   .nai-ac-chip[aria-pressed]  可切换 —— 按下就整颗填充（和面板页签的 active 一个路子）
//   .nai-ac-stepper             一个分段控件 —— 减/值/加是一颗胶囊的三段，不是三个独立块
//   .nai-autocomplete-count     纯信息 —— 不给填充不给描边，别长得像按钮
//
// 原生 checkbox 一律不用：面板全局把 input[type=checkbox] 重置成 appearance:none 再自绘，
// 弹窗这边留着系统勾选框，两处并排就是两套控件语言。
function bindAutocompleteToggleChip(chip, initial, onChange) {
  if (!chip) return;
  chip.setAttribute('aria-pressed', initial ? 'true' : 'false');

  // mousedown 必须吃掉：默认行为会让输入框失焦，弹窗跟着关掉
  chip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', next ? 'true' : 'false');
    onChange(next);
  });
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

function persistAutocompleteSettings() {
  try {
    localStorage.setItem('nai-ac-settings', JSON.stringify(settings));
  } catch (error) {}
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function highlight(text, query) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + '<span class="highlight">' + escapeHtml(text.slice(i, i + query.length)) + '</span>' + escapeHtml(text.slice(i + query.length));
}

function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function slicePromptBlock(block, startIndex, endIndexExclusive) {
  const tags = block.tags.slice(startIndex, endIndexExclusive);
  const delimiters = (block.delimiters || []).slice(startIndex, endIndexExclusive);
  if (!tags.length) return null;
  const isGroup = block.isGroup && tags.length > 1;
  const isWholeBlock = startIndex === 0 && endIndexExclusive === block.tags.length;
  return {
    ...(isWholeBlock ? block : {}),
    id: tags.length === block.tags.length ? block.id : createId(isGroup ? 'block' : 'tag'),
    tags,
    delimiters,
    locked: isGroup && block.locked,
    isGroup,
    libraryId: isGroup && isWholeBlock ? block.libraryId : undefined,
    libraryAlias: isGroup && isWholeBlock ? block.libraryAlias : undefined,
    libraryCategory: isGroup && isWholeBlock ? block.libraryCategory : undefined,
  };
}

function replacePromptBlocksByTokenRange(startTokenIndex, endTokenIndex, insertedBlocks) {
  let cursor = 0;
  const before = [];
  const after = [];

  promptBlocks.forEach(block => {
    const blockStart = cursor;
    const blockEnd = cursor + block.tags.length - 1;

    if (blockEnd < startTokenIndex) {
      before.push(block);
    } else if (blockStart > endTokenIndex) {
      after.push(block);
    } else {
      const startOffset = Math.max(0, startTokenIndex - blockStart);
      const endOffset = Math.min(block.tags.length, endTokenIndex - blockStart + 1);
      const leading = slicePromptBlock(block, 0, startOffset);
      const trailing = slicePromptBlock(block, endOffset, block.tags.length);
      if (leading) before.push(leading);
      if (trailing) after.push(trailing);
    }

    cursor += block.tags.length;
  });

  return [...before, ...insertedBlocks, ...after];
}

function getEditorFromRange(range) {
  const node = range.startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return findPromptEditor(element);
}

function getPromptSegmentScope(editor, node) {
  let element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!(element instanceof HTMLElement)) return editor;

  while (element.parentElement && element.parentElement !== editor) {
    element = element.parentElement;
  }

  return editor.contains(element) ? element : editor;
}

function createRangeFromTextOffsets(root, startOffset, endOffset) {
  if (isPlainTextPromptEditor(root)) {
    return createTextareaPseudoRange(root, startOffset, endOffset);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node = null;
  let currentOffset = 0;
  let startNode = null;
  let startNodeOffset = 0;
  let endNode = null;
  let endNodeOffset = 0;
  let lastNode = null;
  let lastNodeLength = 0;
  const normalizedStart = Math.max(0, startOffset);
  const normalizedEnd = Math.max(normalizedStart, endOffset);

  while ((node = walker.nextNode())) {
    const textLength = node.textContent?.length || 0;
    const nextOffset = currentOffset + textLength;
    lastNode = node;
    lastNodeLength = textLength;

    if (!startNode && normalizedStart <= nextOffset) {
      startNode = node;
      startNodeOffset = Math.max(0, Math.min(textLength, normalizedStart - currentOffset));
    }

    if (!endNode && normalizedEnd <= nextOffset) {
      endNode = node;
      endNodeOffset = Math.max(0, Math.min(textLength, normalizedEnd - currentOffset));
      break;
    }

    currentOffset = nextOffset;
  }

  if (!startNode && lastNode) {
    startNode = lastNode;
    startNodeOffset = lastNodeLength;
  }
  if (!endNode && lastNode) {
    endNode = lastNode;
    endNodeOffset = lastNodeLength;
  }
  if (!startNode || !endNode) return null;

  try {
    range.setStart(startNode, clampDomOffset(startNode, startNodeOffset));
    range.setEnd(endNode, clampDomOffset(endNode, endNodeOffset));
  } catch (error) {
    return null;
  }
  return range;
}

function getSegmentContext() {
  if (activeEditor && isPlainTextPromptEditor(activeEditor)) {
    return buildTextareaSegmentContext(activeEditor);
  }

  const sel = window.getSelection();
  if (!sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const editor = activeEditor || getEditorFromRange(range);
  if (!editor) return null;
  const caretNode = range.startContainer;
  const caretNodeOffset = range.startOffset;
  const scope = getPromptSegmentScope(editor, caretNode);

  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(editor);
  if (!safeSetRangeBoundary(beforeRange, 'end', range.startContainer, range.startOffset)) return null;

  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(editor);
  if (!safeSetRangeBoundary(afterRange, 'start', range.startContainer, range.startOffset)) return null;

  const beforeText = beforeRange.toString();
  const afterText = afterRange.toString();
  const segmentBreak = findLastPromptSegmentBreak(beforeText);
  const rawSegment = beforeText.slice(segmentBreak + 1);
  const leadingSpaceLength = rawSegment.match(/^\s*/)?.[0].length || 0;
  const segmentText = rawSegment.slice(leadingSpaceLength);
  const caretOffset = beforeText.length;
  const segmentStartOffset = caretOffset - segmentText.length;
  const segmentTailMatch = afterText.match(/^[^,，\n|]*/);
  const segmentTailText = segmentTailMatch ? segmentTailMatch[0] : '';
  const afterSegmentText = afterText.slice(segmentTailText.length);
  const nextMeaningfulChar = afterSegmentText.replace(/^\s+/, '').charAt(0);
  const segmentRange = createRangeFromTextOffsets(editor, segmentStartOffset, caretOffset);

  const scopeBeforeRange = range.cloneRange();
  scopeBeforeRange.selectNodeContents(scope);
  if (!safeSetRangeBoundary(scopeBeforeRange, 'end', range.startContainer, range.startOffset)) return null;

  const scopeAfterRange = range.cloneRange();
  scopeAfterRange.selectNodeContents(scope);
  if (!safeSetRangeBoundary(scopeAfterRange, 'start', range.startContainer, range.startOffset)) return null;

  const scopeBeforeText = scopeBeforeRange.toString();
  const scopeAfterText = scopeAfterRange.toString();
  const scopeSegmentBreak = findLastPromptSegmentBreak(scopeBeforeText);
  const scopeRawSegment = scopeBeforeText.slice(scopeSegmentBreak + 1);
  const scopeLeadingSpaceLength = scopeRawSegment.match(/^\s*/)?.[0].length || 0;
  const scopeSegmentText = scopeRawSegment.slice(scopeLeadingSpaceLength);
  const scopeCaretOffset = scopeBeforeText.length;
  const scopeSegmentStartOffset = scopeCaretOffset - scopeSegmentText.length;
  const scopeSegmentTailMatch = scopeAfterText.match(/^[^,，\n|]*/);
  const scopeSegmentTailText = scopeSegmentTailMatch ? scopeSegmentTailMatch[0] : '';

  const nodeText = caretNode.nodeType === Node.TEXT_NODE ? caretNode.textContent || '' : '';
  const nodeBeforeCaret = caretNode.nodeType === Node.TEXT_NODE ? nodeText.slice(0, caretNodeOffset) : '';
  const nodeAfterCaret = caretNode.nodeType === Node.TEXT_NODE ? nodeText.slice(caretNodeOffset) : '';
  const nodeSegmentBreak = findLastPromptSegmentBreak(nodeBeforeCaret);
  const nodeRawSegment = nodeBeforeCaret.slice(nodeSegmentBreak + 1);
  const nodeLeadingSpaceLength = nodeRawSegment.match(/^\s*/)?.[0].length || 0;
  const nodeSegmentStartOffset = nodeSegmentBreak + 1 + nodeLeadingSpaceLength;
  const nodeSegmentTailMatch = nodeAfterCaret.match(/^[^,，\n|]*/);
  const nodeSegmentTailText = nodeSegmentTailMatch ? nodeSegmentTailMatch[0] : '';

  if (!segmentRange) return null;

  return {
    editor,
    caretNode,
    caretNodeOffset,
    nodeSegmentStartOffset,
    nodeSegmentTailText,
    scope,
    scopeSegmentStartOffset,
    scopeCaretOffset,
    scopeSegmentTailText,
    segmentText,
    segmentTailText,
    segmentStartOffset,
    caretOffset,
    nextMeaningfulChar,
    segmentRange,
  };
}

// 解析当前上下文（权重）。原来还回一个 hasArtist 用来决定 artist: 要不要预勾，
// 现在画师一律预勾，正文里已经手打了前缀的情况在 applyAutocompleteResult 里单独判。
function parseCurrentContext() {
  const context = getSegmentContext();
  if (!context) return { weight: 1.0 };

  const weightMatch = context.segmentText.match(/^(-?\d+\.?\d*)(?::|：){2}/);
  return { weight: weightMatch ? parseFloat(weightMatch[1]) : 1.0 };
}

function showAutocomplete(editor, results, query) {
  const c = createContainer();
  const list = c.querySelector('.nai-autocomplete-list');

  if (query === lastRenderedQuery && currentResults.length > 0) {
    lastAutocompleteContext = getSegmentContext();
    positionAutocomplete(editor);
    c.classList.add('visible');
    return;
  }

  lastRenderedQuery = query;
  currentResults = results;
  currentQuery = query;
  selectedIndex = 0;

  const context = parseCurrentContext();
  lastAutocompleteContext = getSegmentContext();

  if (isLoading) {
    list.innerHTML = '<div class="nai-autocomplete-loading"><span class="nai-autocomplete-spinner"></span>加载中...</div>';
  } else if (!results.length) {
    list.innerHTML = '<div class="nai-autocomplete-empty"><div class="nai-autocomplete-empty-icon">-</div>无匹配结果</div>';
  } else {
    list.innerHTML = results.map((tag, i) => {
      const isLibrary = tag.resultType === 'prompt-library';
      const isArtist = tag.category === '1';
      // 画师标签默认就勾上 artist:。NAI 里画师几乎总要这个前缀，每次手动勾没有意义。
      // 已经手打了 artist: 的情况由 applyAutocompleteResult 里的 hasExplicitArtistPrefix 兜住，不会加两遍。
      const showArtistChecked = isArtist;
      const weightControl = isLibrary ? '' : `
        <div class="nai-ac-stepper nai-autocomplete-weight">
          <button type="button" class="nai-weight-btn nai-weight-down" data-index="${i}" aria-label="降低权重">−</button>
          <span class="nai-weight-value" data-index="${i}">${context.weight.toFixed(1)}</span>
          <button type="button" class="nai-weight-btn nai-weight-up" data-index="${i}" aria-label="提高权重">+</button>
        </div>
      `;
      const countLabel = isLibrary ? `${tag.tags.length} tags` : formatCount(tag.postCount);
      const libraryBadge = isLibrary ? '<span class="nai-autocomplete-badge">词库</span>' : '';
      const tagTitle = isLibrary
        ? `<div class="nai-autocomplete-tag"><span class="nai-autocomplete-tag-text">${highlight(tag.alias, query)}</span></div>`
        : `<div class="nai-autocomplete-tag"><span class="nai-autocomplete-tag-text">${highlight(tag.tag, query)}</span></div>`;
      const subTitle = isLibrary
        ? `<div class="nai-autocomplete-translation">${escapeHtml(tag.translation || '')}</div>`
        : (tag.matchedAlias ? `<div class="nai-autocomplete-translation">别名 · ${tag.matchedAlias}</div>` :
            tag.translation ? `<div class="nai-autocomplete-translation">${tag.translation}</div>` : '');
      return `
      <div class="nai-autocomplete-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <div class="nai-autocomplete-category" data-category="${isLibrary ? 'library' : tag.category}"></div>
        <div class="nai-autocomplete-content">
          ${tagTitle}
          ${subTitle}
        </div>
        <div class="nai-autocomplete-meta">
          ${libraryBadge}
          ${isArtist && !isLibrary ? `<button
            type="button"
            class="nai-ac-chip nai-artist-toggle"
            data-index="${i}"
            title="使用 artist: 前缀"
            aria-pressed="${showArtistChecked ? 'true' : 'false'}"
          >artist:</button>` : ''}
          ${weightControl}
          <span class="nai-autocomplete-count">${countLabel}</span>
        </div>
      </div>
    `;
    }).join('');

    results.forEach(tag => {
      if (tag.resultType === 'prompt-library') return;
      tag.weight = context.weight;
      if (tag.category === '1') {
        tag.useArtistPrefix = true;
      }
    });

    list.querySelectorAll('.nai-artist-toggle').forEach(chip => {
      bindAutocompleteToggleChip(
        chip,
        chip.getAttribute('aria-pressed') === 'true',
        (on) => {
          currentResults[+chip.dataset.index].useArtistPrefix = on;
        },
      );
    });

    list.querySelectorAll('.nai-weight-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const idx = +btn.dataset.index;
        const valueEl = list.querySelector(`.nai-weight-value[data-index="${idx}"]`);
        const currentValue = parseFloat(valueEl.textContent);
        let val = Number.isFinite(currentValue) ? currentValue : 1.0;
        val = btn.classList.contains('nai-weight-up') ? val + 0.1 : val - 0.1;
        val = Math.max(-2.0, Math.min(2.0, val));
        valueEl.textContent = val.toFixed(1);
        currentResults[idx].weight = val;
      });
    });

    list.querySelectorAll('.nai-autocomplete-item').forEach(item => {
      const handleAutocompleteItemPointer = e => handleAutocompleteItemEvent(item, e);
      item.addEventListener('pointerdown', handleAutocompleteItemPointer);
      item.addEventListener('mousedown', handleAutocompleteItemPointer);
      item.addEventListener('click', handleAutocompleteItemPointer);
      item.onmouseenter = () => {
        selectedIndex = +item.dataset.index;
        updateSelection();
      };
    });
  }

  c.querySelector('.nai-autocomplete-count-info').textContent = `${results.length} 条结果`;
  positionAutocomplete(editor);
  c.classList.add('visible');
}

function hideAutocomplete() {
  autocompleteContainer?.classList.remove('visible');
  autocompleteContainer?.querySelector('.nai-autocomplete-list')?.replaceChildren();
  clearOverlayUiScale(autocompleteContainer);
  currentResults = [];
  selectedIndex = 0;
  lastRenderedQuery = '';
  lastAutocompleteContext = null;
}

function getCaretRect(editor) {
  return getPromptEditorCaretRect(editor) || editor.getBoundingClientRect();
}

function positionAutocomplete(editor) {
  if (!autocompleteContainer || !editor) return;

  const uiScale = applyOverlayUiScale(autocompleteContainer, getPromptEditorUiScale(editor));
  const editorRect = editor.getBoundingClientRect();
  const caretRect = getCaretRect(editor);
  const viewportPadding = 8;
  const gap = Math.max(4, 10 * uiScale);
  const panelWidth = Math.min(
    Math.max(autocompleteContainer.offsetWidth || 360, 280),
    400,
  );
  const panelHeight = Math.min(
    Math.max(autocompleteContainer.offsetHeight || 320, 180),
    320,
  );

  const spaceBelow = window.innerHeight - caretRect.bottom - viewportPadding;
  const spaceAbove = caretRect.top - viewportPadding;

  let top;
  if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
    top = caretRect.bottom + gap;
  } else {
    top = caretRect.top - panelHeight - gap;
  }

  top = Math.min(
    Math.max(viewportPadding, top),
    Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding)
  );

  let left = caretRect.left;
  if (left + panelWidth > window.innerWidth - viewportPadding) {
    left = window.innerWidth - panelWidth - viewportPadding;
  }
  left = Math.max(viewportPadding, left);

  if (left < editorRect.left - panelWidth * 0.5) {
    left = Math.max(viewportPadding, editorRect.left);
  }

  autocompleteContainer.style.top = `${top}px`;
  autocompleteContainer.style.left = `${left}px`;
}

function repositionVisibleAutocomplete() {
  autocompleteRepositionFrame = 0;
  if (!autocompleteContainer?.classList.contains('visible') || !activeEditor?.isConnected) return;
  positionAutocomplete(activeEditor);
}

function scheduleAutocompleteReposition() {
  if (autocompleteRepositionFrame) return;
  autocompleteRepositionFrame = requestAnimationFrame(repositionVisibleAutocomplete);
}

function updateSelection() {
  let selectedItem = null;
  autocompleteContainer?.querySelectorAll('.nai-autocomplete-item').forEach((item, i) => {
    const isSelected = i === selectedIndex;
    item.classList.toggle('selected', isSelected);
    if (isSelected) selectedItem = item;
  });
  selectedItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function stopAutocompleteEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function handleAutocompleteItemEvent(item, event) {
  if (
    event.target.closest('.nai-ac-stepper') ||
    event.target.closest('.nai-ac-chip')
  ) {
    return;
  }

  stopAutocompleteEvent(event);

  if (event.type !== 'click') {
    return;
  }

  const now = Date.now();
  if (now - autocompleteItemHandledAt < 80) return;
  autocompleteItemHandledAt = now;

  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  applyAutocompleteResult(currentResults[index]);
}

function getCurrentWord() {
  const context = getSegmentContext();
  if (!context) return '';

  const word = context.segmentText.trim();
  if (!word) return '';

  let match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)([^:：]+)(?::|：){2}$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}([^:：]+)(?::|：){2}$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)([^:：]+)(?::|：)$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}([^:：]+)(?::|：)$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)[^:：]+(?::|：){2}(.+)$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}[^:：]+(?::|：){2}(.+)$/);
  if (match) return match[2];

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}.*[,，|]([^,，|]*)$/);
  if (match) return match[2].trim();

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}artist(?::|：)(.*)$/);
  if (match) return match[2].replace(/(?::|：)+$/, '');

  match = word.match(/^(-?\d+\.?\d*)(?::|：){2}(.*)$/);
  if (match) return match[2].replace(/(?::|：)+$/, '');

  match = word.match(/^artist(?::|：)(.*)$/);
  if (match) return match[1];

  const plainQueryMatch = getPlainQueryMatch(word);
  if (plainQueryMatch) return plainQueryMatch[2];

  return word;
}

function isOfficialPromptChunkQuery() {
  const context = getSegmentContext();
  if (!context) return false;
  return /(^|[\s,，|])@[\p{L}\p{N}_ '"\-./()]*$/u.test(context.segmentText.trim());
}

function applyAutocompleteResult(item) {
  if (!item) return;
  if (item.resultType === 'prompt-library') {
    selectPromptLibrary(item);
    return;
  }
  selectTag(item);
}

// 弹窗渲染那一刻缓存进 lastAutocompleteContext 的是**活的 DOM 引用**（editor / caretNode / scope）。
// 从「弹窗出现」到「点条目」之间编辑器只要重绘过一次，这些引用就指向游离节点 ——
// ProseMirror 和 React 每次事务都会重建文本节点，所以在 novelai.net 上是常态。
//
// 拿游离节点建出来的 Range 加不进 selection，execCommand 一声不吭地写进空气：
// 用户看到的就是「点了没反应」，控制台一个字都不报。所以用之前先验一遍活性，
// 死了就整份换成当场取的那份。
//
// 用 `=== false` 判定：textarea 那条路的上下文没有 caretNode / scope，不能当成死的。
function isDetachedNode(node) {
  return Boolean(node) && node.isConnected === false;
}

function isPromptContextAlive(context) {
  if (!context) return false;
  return !isDetachedNode(context.editor)
    && !isDetachedNode(context.caretNode)
    && !isDetachedNode(context.scope);
}

function livingAutocompleteContext() {
  return isPromptContextAlive(lastAutocompleteContext) ? lastAutocompleteContext : null;
}

function selectPromptLibrary(entry) {
  if (!activeEditor || !entry) return;
  const context = livingAutocompleteContext() || getSegmentContext();
  if (!context) return;

  const chunkQueryMatch = context.segmentText.match(/(^|[\s,，|])(@[\p{L}\p{N}_ '"\-./()]*$)/u);
  const replaceStart = chunkQueryMatch
    ? chunkQueryMatch.index + chunkQueryMatch[1].length
    : Math.max(0, context.segmentText.lastIndexOf('@'));

  hideAutocomplete();
  replacePromptEditorSegment(
    context,
    replaceStart,
    false,
    entry.promptText || entry.tags.join(', '),
  );
  ensurePromptBlockModel(activeEditor);
}

function selectTag(tag) {
  if (!activeEditor || !tag) return;

  // 缓存那份还活着才用它；节点已经被编辑器换掉了就直接用当场取的（见上面的说明）
  const cached = livingAutocompleteContext();
  const context = cached || getSegmentContext();
  if (!context) return;

  // 只有走缓存那份时才需要补刷 —— 当场取的本来就是最新的
  const freshContext = cached ? getSegmentContext() : null;
  if (freshContext) {
    context.segmentTailText = freshContext.segmentTailText;
    context.nodeSegmentTailText = freshContext.nodeSegmentTailText;
    context.scopeSegmentTailText = freshContext.scopeSegmentTailText;
    context.nextMeaningfulChar = freshContext.nextMeaningfulChar;
    context.caretOffset = freshContext.caretOffset;
    context.caretNodeOffset = freshContext.caretNodeOffset;
  }

  const {
    segmentText: currentSegment,
    segmentTailText,
    nextMeaningfulChar,
  } = context;

  let start = 0;
  let isAfterComplete = false;
  let isMultiTagFormat = false;
  let replaceTail = false;
  const weight = Number.isFinite(tag.weight) ? tag.weight : 1.0;
  const currentWeightMatch = currentSegment.match(/^(-?\d+\.?\d*)(?::|：){2}/);
  const preservedSuffixMatch = segmentTailText.match(/[\)\]\}]+$/);
  const preservedSuffix = preservedSuffixMatch ? preservedSuffixMatch[0] : '';
  const normalizedTail = segmentTailText.slice(0, segmentTailText.length - preservedSuffix.length);
  const fullSegment = `${currentSegment}${normalizedTail}`;
  const hasTrailingText = Boolean(normalizedTail.trim());
  const shouldAppendComma = hasTrailingText || !isPromptBoundaryChar(nextMeaningfulChar);

  const exactCompleteMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}(artist(?::|：))?[^:：]+(?::|：){1,2})$/);
  const afterCompleteMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}(artist(?::|：))?[^:：]+(?::|：){2})(.+)$/);
  if (exactCompleteMatch) {
    isAfterComplete = false;
    replaceTail = true;
  } else if (afterCompleteMatch) {
    start = afterCompleteMatch[1].length;
    isAfterComplete = true;
    replaceTail = true;
  } else {
    const multiTagMatch = fullSegment.match(/^(-?\d+\.?\d*(?::|：){2}.*[,，|])/);
    if (multiTagMatch) {
      start = multiTagMatch[1].length;
      isMultiTagFormat = true;
      replaceTail = true;
    } else {
      const plainQueryMatch = getPlainQueryMatch(currentSegment);
      if (plainQueryMatch) {
        start = plainQueryMatch[1].length;
      }
    }
  }

  const currentWeight = currentWeightMatch ? parseFloat(currentWeightMatch[1]) : NaN;
  const shouldRewriteWeightedSegment =
    currentWeightMatch &&
    Number.isFinite(currentWeight) &&
    Math.abs(weight - currentWeight) > 0.0001 &&
    !isAfterComplete &&
    !isMultiTagFormat;
  if (shouldRewriteWeightedSegment) {
    const replaced = replacePromptEditorSegment(
      context,
      0,
      false,
      weight.toFixed(1),
      { end: currentWeightMatch[1].length },
    );
    if (!replaced) return;
    hideAutocomplete();
    return;
  }

  let tagName = tag.tag;
  if (settings.convertSlashToSpace) {
    tagName = tagName.replace(/_/g, ' ');
  } else {
    tagName = tagName.replace(/ /g, '_');
  }

  const useArtist = tag.category === '1' && tag.useArtistPrefix;
  const commaSuffix = shouldAppendComma ? ', ' : '';
  const existingPrefix = currentSegment.slice(0, start);
  const hasExplicitArtistPrefix = /artist(?::|：)$/i.test(existingPrefix);
  const hasExplicitWeightedPrefix = /-?\d+\.?\d*(?::|：){2}(artist(?::|：))?$/i.test(existingPrefix);

  let outputSuffix = '';
  if (replaceTail && preservedSuffix) {
    const depthCheckEnd = context.caretOffset + normalizedTail.length;
    const textBeforeSuffix = getEditorTextBeforeOffset(context.editor, depthCheckEnd);
    if (countOpenParenDepth(textBeforeSuffix) > 0) {
      outputSuffix = preservedSuffix;
    }
  }

  let output;
  if (isAfterComplete || isMultiTagFormat) {
    output = `${tagName}${outputSuffix}${shouldAppendComma ? ',' : ''}`;
  } else if (hasExplicitWeightedPrefix) {
    output = `${tagName}::${outputSuffix}${commaSuffix}`;
  } else if (hasExplicitArtistPrefix) {
    output = `${tagName}${outputSuffix}${commaSuffix}`;
  } else if (weight !== 1.0) {
    const weightStr = weight.toFixed(1);
    output = useArtist
      ? `${weightStr}::artist:${tagName}::${outputSuffix}${commaSuffix}`
      : `${weightStr}::${tagName}::${outputSuffix}${commaSuffix}`;
  } else {
    output = useArtist
      ? `artist:${tagName}${outputSuffix}${commaSuffix}`
      : `${tagName}${outputSuffix}${commaSuffix}`;
  }

  const replaced = replacePromptEditorSegment(context, start, replaceTail, output, {
    preferScope: false,
  });
  if (!replaced) return;
  hideAutocomplete();
}

// 防抖
function debounce(fn, delay) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
}

const handleInput = debounce(editor => {
  if (isOfficialPromptChunkQuery()) {
    hideAutocomplete();
    return;
  }

  const word = getCurrentWord();
  if (word.length >= CONFIG.MIN_QUERY_LENGTH) {
    const results = searchTags(word);
    if (results.length || isLoading) showAutocomplete(editor, results, word);
    else hideAutocomplete();
  } else hideAutocomplete();
}, CONFIG.DEBOUNCE_DELAY);

function refreshAutocomplete(editor) {
  if (isOfficialPromptChunkQuery()) {
    hideAutocomplete();
    return;
  }

  handleInput(editor);
}

