// 把 js/flow/*.js + js/content/*.js 按上线时的顺序装进 vm，测的是真正上线的那份 chunk。
// content bundle 的 epilogue 才调 init()，只加载 chunk 没有任何副作用。
//
// DOM 用下面这份最小替身。它只需要撑起 getEditorNodeText 和 buildEditorTextMap
// 那条链路会碰到的东西：nodeType / tagName / childNodes / classList.contains /
// dataset / parentNode，外加一个只记录端点的 Range。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLOW_DIR = path.join(ROOT, 'js', 'flow');
const CONTENT_DIR = path.join(ROOT, 'js', 'content');

const DOM_PRELUDE = `
const Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    this.childNodes = [];
    this.parentNode = null;
  }
}

class HTMLElement {
  constructor(tagName, options) {
    const config = options || {};
    this.nodeType = 1;
    this.tagName = tagName;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = config.dataset || {};
    const classes = new Set(config.classes || []);
    this.classList = { contains: (name) => classes.has(name) };
  }
  getAttribute() { return null; }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
}

function __text(value) {
  return new FakeText(value);
}

function __el(tagName, children, options) {
  const element = new HTMLElement(tagName, options);
  (children || []).forEach((child) => element.appendChild(child));
  return element;
}

const document = {
  createRange() {
    return {
      startContainer: null,
      startOffset: 0,
      endContainer: null,
      endOffset: 0,
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
      setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      get collapsed() {
        return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
      },
    };
  },
};
`;

function listChunks(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function createContentSandbox(extraGlobals = {}) {
  const sandbox = {
    console,
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    WeakMap,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { origin: 'https://novelai.net', pathname: '/image', hostname: 'novelai.net' },
    ...extraGlobals,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(DOM_PRELUDE, context, { filename: 'scripts/lib/content-sandbox.mjs (dom)' });

  for (const name of listChunks(FLOW_DIR)) {
    vm.runInContext(fs.readFileSync(path.join(FLOW_DIR, name), 'utf8'), context, { filename: `js/flow/${name}` });
  }
  for (const name of listChunks(CONTENT_DIR)) {
    vm.runInContext(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8'), context, { filename: `js/content/${name}` });
  }

  const get = (name) => {
    const value = vm.runInContext(`typeof ${name} !== 'undefined' ? ${name} : undefined`, context);
    if (value === undefined) throw new Error(`沙箱里没有 ${name}`);
    return value;
  };

  return {
    context,
    get,
    text: get('__text'),
    el: get('__el'),
  };
}

// 把 Range 端点还原成它覆盖的文本。tag 永远落在真实文本节点里（合成出来的换行、
// 宏展开不属于任何 tag），所以端点一旦跑到元素边界上就是回归，直接报错比悄悄放过好。
export function readRangeText(editor, range) {
  if (!range) throw new Error('没拿到 range');
  const flat = [];
  const visit = (node) => {
    if (node.nodeType === 3) {
      const value = node.textContent || '';
      for (let i = 0; i < value.length; i += 1) flat.push({ node, offset: i, char: value[i] });
      flat.push({ node, offset: value.length, char: '' });
      return;
    }
    if (node.nodeType !== 1) return;
    node.childNodes.forEach(visit);
  };
  editor.childNodes.forEach(visit);

  const indexOf = (node, offset) => {
    if (node.nodeType !== 3) {
      throw new Error(`range 端点落在了元素边界上（${node.tagName}），说明偏移算歪了`);
    }
    const found = flat.findIndex((entry) => entry.node === node && entry.offset === offset);
    if (found === -1) throw new Error('range 端点不在编辑器里');
    return found;
  };

  const start = indexOf(range.startContainer, range.startOffset);
  const end = indexOf(range.endContainer, range.endOffset);
  return flat.slice(start, end).map((entry) => entry.char).join('');
}
