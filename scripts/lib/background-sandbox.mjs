// 把 js/background/*.js 原样装进一个 vm 沙箱里跑。
//
// 这些 chunk 在浏览器里是拼成一个 service worker 脚本执行的（没有 import/export），
// 所以测试也照同样的方式拼 —— 测的是真正上线的那份代码，不是为测试另写的副本。
// 需要的浏览器 API（fetch / chrome / OffscreenCanvas）全部由这里注入，
// 于是每个测试都能精确控制服务端返回什么。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKGROUND_DIR = path.join(ROOT, 'js', 'background');

function readChunks() {
  return fs
    .readdirSync(BACKGROUND_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => ({ name, source: fs.readFileSync(path.join(BACKGROUND_DIR, name), 'utf8') }));
}

function createChromeMock() {
  const listeners = {
    message: [], installed: [], actionClicked: [], tabsUpdated: [], tabsActivated: [], storageChanged: [],
  };
  const calls = [];
  const store = {};

  const record = (method, args) => calls.push({ method, args });

  return {
    listeners,
    calls,
    store,
    api: {
      runtime: {
        lastError: null,
        getURL: (relative) => `chrome-extension://test/${relative}`,
        onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
        onMessage: { addListener: (fn) => listeners.message.push(fn) },
        sendMessage: (...args) => record('runtime.sendMessage', args),
      },
      action: {
        setTitle: (...args) => record('action.setTitle', args),
        onClicked: { addListener: (fn) => listeners.actionClicked.push(fn) },
      },
      tabs: {
        query: (_query, callback) => callback?.([]),
        create: (...args) => record('tabs.create', args),
        update: (...args) => record('tabs.update', args),
        get: (_id, callback) => callback?.(null),
        captureVisibleTab: (_windowId, _options, callback) => callback?.('data:image/png;base64,'),
        onUpdated: { addListener: (fn) => listeners.tabsUpdated.push(fn) },
        onActivated: { addListener: (fn) => listeners.tabsActivated.push(fn) },
      },
      windows: { update: (...args) => record('windows.update', args) },
      storage: {
        local: {
          get: (keys, callback) => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            callback?.(Object.fromEntries(wanted.map((key) => [key, store[key]]).filter(([, v]) => v !== undefined)));
          },
          set: (values, callback) => { Object.assign(store, values); callback?.(); },
        },
        onChanged: { addListener: (fn) => listeners.storageChanged.push(fn) },
      },
    },
  };
}

export function createBackgroundSandbox() {
  const chromeMock = createChromeMock();

  const sandbox = {
    chrome: chromeMock.api,
    console,
    fetch: async () => {
      throw new Error('测试未安装 fetch mock');
    },
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    btoa: (input) => Buffer.from(input, 'binary').toString('base64'),
    atob: (input) => Buffer.from(input, 'base64').toString('binary'),
    // 图片工具在 LLM 测试里用不到，给个存在即可的桩，免得加载期就炸。
    OffscreenCanvas: class {},
    createImageBitmap: async () => {
      throw new Error('createImageBitmap 未在测试中实现');
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);

  for (const chunk of readChunks()) {
    vm.runInContext(chunk.source, context, { filename: `js/background/${chunk.name}` });
  }

  return {
    context,
    chrome: chromeMock,

    // 取沙箱里的顶层函数/常量来直接测。
    get(name) {
      const value = vm.runInContext(`typeof ${name} !== 'undefined' ? ${name} : undefined`, context);
      if (value === undefined) throw new Error(`沙箱里没有 ${name}`);
      return value;
    },

    // 装一个 fetch mock，返回它记录到的调用列表。
    mockFetch(handler) {
      const calls = [];
      sandbox.fetch = async (url, options = {}) => {
        const call = {
          url,
          options,
          headers: options.headers || {},
          body: safeJsonParse(options.body),
          rawBody: options.body,
          signal: options.signal,
        };
        calls.push(call);
        return handler(call, calls.length);
      };
      return calls;
    },

    // 往 chrome.storage.local 里塞数据（比如自动补全缓存的 tag 词典）。
    setStorage(values) {
      Object.assign(chromeMock.store, values);
      for (const listener of chromeMock.listeners.storageChanged) {
        listener(Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: values[key] }])), 'local');
      }
    },

    // 走真正的消息路由，和 content script 发消息的路径完全一致。
    sendMessage(message, sender = {}) {
      return new Promise((resolve, reject) => {
        let handled = false;
        for (const listener of chromeMock.listeners.message) {
          const keepAlive = listener(message, sender, (response) => {
            handled = true;
            resolve(response);
          });
          if (keepAlive === true) handled = true;
        }
        if (!handled) reject(new Error(`没有监听器处理 ${message?.type}`));
      });
    },
  };
}

function safeJsonParse(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

// ───────────────────────────── 响应构造器 ─────────────────────────────

function makeHeaders(map) {
  const lower = new Map(Object.entries(map).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (key) => (lower.has(String(key).toLowerCase()) ? lower.get(String(key).toLowerCase()) : null) };
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders({ 'content-type': 'application/json', ...headers }),
    body: null,
    text: async () => text,
  };
}

export function textResponse(text, { status = 200, contentType = 'text/plain', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders({ 'content-type': contentType, ...headers }),
    body: null,
    text: async () => text,
  };
}

// SSE：按块吐，这样增量解析的路径才真的被走到。
export function sseResponse(chunks, { status = 200, contentType = 'text/event-stream', headers = {} } = {}) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders({ 'content-type': contentType, ...headers }),
    body: {
      getReader: () => ({
        read: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true }),
      }),
    },
    text: async () => chunks.join(''),
  };
}

export function networkFailure(message = 'Failed to fetch') {
  return () => Promise.reject(new TypeError(message));
}

// 永不返回、只对 abort 有反应 —— 用来测超时和取消。
export function hangingResponse() {
  return (call) => new Promise((_resolve, reject) => {
    const signal = call.options?.signal;
    if (!signal) return;
    const abort = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
