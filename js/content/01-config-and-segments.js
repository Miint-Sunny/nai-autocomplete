const ASSISTANT_SETTINGS_KEY = 'nai-llm-assistant-settings';
const DEFAULT_THEME = 'novelai';
// 和面板的 DEFAULT_SETTINGS.glassStrength 对齐
const DEFAULT_GLASS_STRENGTH = 100;
const PROMPT_BLOCK_STORAGE_PREFIX = 'nai-ac-prompt-blocks';
const PROMPT_LIBRARY_KEY = 'nai-shared-prompt-library';
const PRESET_PROMPT_LIBRARY_CATEGORIES = [
  { id: 'char', label: '角色' },
  { id: 'style', label: '风格' },
  { id: 'scene', label: '场景' },
  { id: 'outfit', label: '服装' },
  { id: 'pose', label: '动作' },
];

const CONFIG = {
  CSV_URL: 'https://raw.githubusercontent.com/saltysalrua/nai-discordbot/refs/heads/main/danbooru_all_2.csv',
  MAX_RESULTS: 8,
  MIN_QUERY_LENGTH: 1,
  DEBOUNCE_DELAY: 150,
};
// 兜底值。真正显示的以 manifest 为准（见 contentScriptVersion）——
// 这个常量曾经停在 1.5.16 而 manifest 已经到 1.6.0，
// 而它正是用户判断「扩展重载有没有生效」的唯一依据，不能再让它走散。
const CONTENT_SCRIPT_VERSION = '1.6.1';

function contentScriptVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || CONTENT_SCRIPT_VERSION;
  } catch (error) {
    return CONTENT_SCRIPT_VERSION;
  }
}

// 全局设置
let settings = {
  convertSlashToSpace: false, // 下划线与空格互转
  highlightTags: false,       // 输入框里给每个 TAG 画分类下划线（默认关，补全弹窗头部可开）
};

let allTags = [];
let isLoading = true;
let activeEditor = null;
let selectedIndex = 0;
let currentResults = [];
let currentQuery = '';
let lastRenderedQuery = '';
let autocompleteContainer = null;
let lastAutocompleteContext = null;
let promptBlockPanel = null;
let promptBlockToolbar = null;
let promptBlocks = [];
let promptBlockSignature = '';
let promptBlockDragId = null;
let promptBlockDropIndicator = null;
let promptLibraryDialog = null;
let promptLibraryDialogState = { blockId: '', mode: 'block', selection: null };
let promptBlockStates = new WeakMap();
let promptBlockHistoryStates = new WeakMap();
let isPromptBlockDragMode = false;
let promptLibrary = [];
let autocompleteRepositionFrame = 0;
let promptBlockRenderFrame = 0;
let pendingPromptBlockRenderEditor = null;
let pendingPromptBlockToolbarUpdate = false;
let autocompletePointerDownAt = 0;
let autocompleteItemHandledAt = 0;
const PROMPT_SEGMENT_SEPARATORS = new Set([',', '，', '\n', '|']);

function isPromptSegmentSeparator(char) {
  return PROMPT_SEGMENT_SEPARATORS.has(char);
}

function findLastPromptSegmentBreak(text) {
  const source = String(text || '');
  let index = -1;
  PROMPT_SEGMENT_SEPARATORS.forEach(separator => {
    index = Math.max(index, source.lastIndexOf(separator));
  });
  return index;
}

function isPromptBoundaryChar(char) {
  return !char || isPromptSegmentSeparator(char);
}

function countOpenParenDepth(text) {
  let depth = 0;
  for (const char of String(text || '')) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
  }
  return depth;
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTagValue(tag) {
  return String(tag || '').replace(/\s+/g, ' ').trim();
}

function getMacroExpansion(node) {
  if (!(node instanceof HTMLElement)) return '';
  if (!node.classList.contains('macro-node')) return '';
  return node.dataset.macroExpansion || node.getAttribute('data-macro-expansion') || '';
}

function getEditorNodeText(node) {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (!(node instanceof HTMLElement)) {
    return '';
  }

  const macroExpansion = getMacroExpansion(node);
  if (macroExpansion) {
    return macroExpansion;
  }

  if (node.tagName === 'BR') {
    return '\n';
  }

  const isBlock = /^(P|DIV|LI)$/.test(node.tagName) && !node.classList.contains('macro-node');
  const text = Array.from(node.childNodes).map(getEditorNodeText).join('');
  return isBlock ? `${text}\n` : text;
}

function getEditorText(editor) {
  if (isPlainTextPromptEditor(editor)) {
    return String(editor.value || '').replace(/\u200b/g, '').trim();
  }
  return getEditorNodeText(editor).replace(/\u200b/g, '').trim();
}

// 每个 token 除了 tag 和分隔符，还记下它在原文里的真实起止位置（start/end 是
// trim 之后那段 tag，tokenEnd 连分隔符一起算）。
//
// 覆盖层原来是拿 tag.length + delimiter.length 一路累加推算偏移的，两种情况必然对不上：
//   1. `1girl , solo` —— tag 被 trim 掉的那个空格没人算，少一格
//   2. `a,,b` 或者空行 —— 空 token 连同它的分隔符一起被 if (tag) 丢掉，凭空少一整截
// 两个误差都是累加的，所以行数越多高亮歪得越离谱。位置只能从原文量，不能算。
function parsePromptTokens(text) {
  const source = String(text || '');
  const tokens = [];
  let current = '';
  let currentStart = 0;
  let index = 0;

  const pushToken = (raw, rawStart, delimiter, tokenEnd) => {
    const tag = raw.trim();
    if (!tag) return;
    const start = rawStart + (raw.length - raw.trimStart().length);
    tokens.push({ tag, delimiter, start, end: start + tag.length, tokenEnd });
  };

  while (index < source.length) {
    const char = source[index];
    if (isPromptSegmentSeparator(char)) {
      let delimiter = char;
      index += 1;

      while (index < source.length) {
        const next = source[index];
        if (isPromptSegmentSeparator(next) || /\s/.test(next)) {
          delimiter += next;
          index += 1;
          continue;
        }
        break;
      }

      pushToken(current, currentStart, delimiter, index);
      current = '';
      continue;
    }

    if (!current) currentStart = index;
    current += char;
    index += 1;
  }

  pushToken(current, currentStart, '', source.length);

  return tokens;
}

function splitPromptTags(text) {
  return parsePromptTokens(text).map(token => token.tag);
}

function serializePromptBlocks(blocks) {
  return blocks.map(block => block.tags.map((tag, index) => `${tag}${block.delimiters?.[index] || ''}`).join('')).join('');
}

function flattenPromptBlocks(blocks) {
  return blocks.flatMap(block => block.tags.map(tag => normalizeTagValue(tag)));
}

function getPlainQueryMatch(text) {
  const source = String(text || '');
  return source.match(/^(.*?)([\p{L}\p{N}_][\p{L}\p{N}_ '"\-./()]*)$/u);
}

function createSingleBlocksFromText(text) {
  return parsePromptTokens(text).map(token => ({
    id: createId('tag'),
    tags: [token.tag],
    delimiters: [token.delimiter],
    locked: false,
    isGroup: false,
  }));
}

function clonePromptBlocks(blocks) {
  return blocks.map(block => ({
    ...block,
    tags: [...block.tags],
    delimiters: [...(block.delimiters || block.tags.map((_, index) => index === block.tags.length - 1 ? '' : ', '))],
  }));
}

function hasCompletePromptBlockDelimiters(blocks) {
  return blocks.every(block => Array.isArray(block.delimiters) && block.delimiters.length === block.tags.length);
}
