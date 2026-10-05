// 把 js/artist/ 的全部 chunk 按上线顺序装进 vm 跑 —— 测的是真正上线的那份代码。
//
// 画师库页整个围着 DOM 转，这里只造一个「够用就行」的假 document：
//   · getElementById 按 id 现造元素，同一个 id 永远拿到同一个
//   · document 和元素上挂的监听器都记下来，测试直接派发假事件，走的是 09 里真的那份分发
//   · chrome.storage.local 是内存里的一张表
// 元素不做布局：要坐标的地方（半星按指针落在哪半边算）由测试自己给 getBoundingClientRect。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARTIST_DIR = path.join(ROOT, 'js', 'artist');

export function fakeElement(props = {}) {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    files: [],
    style: { setProperty(name, value) { this[name] = value; } },
    dataset: {},
    listeners,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    get className() { return [...classes].join(' '); },
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, event = {}) { for (const fn of listeners[type] || []) fn.call(this, { target: this, ...event }); },
    appendChild() {},
    remove() {},
    select() {},
    click() {},
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    ...props,
  };
}

export function createFakeDom() {
  const elements = new Map();
  const listeners = {};
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement({ id }));
      return elements.get(id);
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    execCommand: () => true,
    body: fakeElement(),
  };
  return {
    document,
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };
}

export function createArtistSandbox() {
  const dom = createFakeDom();
  const storage = {};
  const alerts = [];
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          for (const key of [].concat(keys)) if (key in storage) result[key] = storage[key];
          callback(result);
        },
        set(items, callback) {
          Object.assign(storage, items);
          callback?.();
        },
        getBytesInUse(_keys, callback) { callback(JSON.stringify(storage).length); },
      },
      onChanged: { addListener() {} },
    },
    tabs: { create() {} },
  };

  const sandbox = {
    console,
    Math,
    JSON,
    Date,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
    setTimeout: () => 0,
    clearTimeout() {},
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    document: dom.document,
    chrome,
    navigator: { clipboard: { writeText: async () => {} } },
    alert: (message) => alerts.push(String(message)),
    confirm: () => true,
    prompt: () => null,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);

  // 上线时这些 chunk 拼在同一个 IIFE 里、共用顶层作用域；这里拼成一段脚本、不包 IIFE，
  // 顶层的 let / const（data、currentArtistId……）测试才够得着。
  const source = fs.readdirSync(ARTIST_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => fs.readFileSync(path.join(ARTIST_DIR, name), 'utf8'))
    .join('\n\n');
  vm.runInContext(source, context, { filename: 'js/artist/*.js' });

  return {
    context,
    document: dom.document,
    dispatch: dom.dispatch,
    storage,
    alerts,
    get(name) {
      const value = vm.runInContext(`typeof ${name} !== 'undefined' ? ${name} : undefined`, context);
      if (value === undefined) throw new Error(`沙箱里没有 ${name}`);
      return value;
    },
    exec(code) {
      return vm.runInContext(code, context);
    },
    // 换一份画师库数据：在沙箱自己的 realm 里重建对象，再走一遍上线时的 ensureDataShape
    setData(library, currentArtistId = null) {
      vm.runInContext(`data = JSON.parse(${JSON.stringify(JSON.stringify(library))}); ensureDataShape(); currentArtistId = ${JSON.stringify(currentArtistId)};`, context);
    },
    // chrome.storage 里最后存下的那份画师库
    saved() {
      return JSON.parse(storage.naiArtistTracker_v1 || 'null');
    },
  };
}
