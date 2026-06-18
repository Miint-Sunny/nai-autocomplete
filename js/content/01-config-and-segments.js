const ASSISTANT_SETTINGS_KEY = 'nai-llm-assistant-settings';
const DEFAULT_THEME = 'sunrise';
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
const CONTENT_SCRIPT_VERSION = '1.5.15';

// 全局设置
let settings = {
  convertSlashToSpace: false, // 下划线与空格互转
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
const PROMPT_BLOCK_COLORS = ['#f08a5d', '#7aa7ff', '#76b89a', '#c68cff', '#f4b860', '#e97a9a'];
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

function parsePromptTokens(text) {
  const source = String(text || '');
  const tokens = [];
  let current = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (isPromptSegmentSeparator(char)) {
      const tag = current.trim();
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

      if (tag) {
        tokens.push({ tag, delimiter });
      }
      current = '';
      continue;
    }

    current += char;
    index += 1;
  }

  const lastTag = current.trim();
  if (lastTag) {
    tokens.push({ tag: lastTag, delimiter: '' });
  }

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
