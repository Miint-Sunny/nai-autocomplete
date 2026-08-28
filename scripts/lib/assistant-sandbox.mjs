// 把 js/assistant/ 里的**纯逻辑** chunk 装进 vm 跑。
//
// 整个 assistant bundle 是围着 DOM 转的，整体加载得先造半个浏览器；
// 但导入这条链路（酒馆预设 JSON → 消息块、skill markdown → skill 对象）是纯函数，
// 只要把它依赖的那几个 chunk 按上线顺序拼进来就能直接测 —— 测的仍然是真正上线的那份代码。
//
// 需要新的 chunk 时往 CHUNKS 里加，别在测试里另抄一份实现。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSISTANT_DIR = path.join(ROOT, 'js', 'assistant');

const CHUNKS = [
  '01-constants.js',
  '02-presets-and-prompt-utils.js',
  '03-prompt-library-and-storage.js',
  '07-llm-config.js',
  '15-st-preset-import.js',
  '18-agent-skills.js',
];

export function createAssistantSandbox(extraGlobals = {}) {
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
    setTimeout,
    clearTimeout,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    ...extraGlobals,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  for (const name of CHUNKS) {
    vm.runInContext(fs.readFileSync(path.join(ASSISTANT_DIR, name), 'utf8'), context, {
      filename: `js/assistant/${name}`,
    });
  }

  return {
    context,
    get(name) {
      const value = vm.runInContext(`typeof ${name} !== 'undefined' ? ${name} : undefined`, context);
      if (value === undefined) throw new Error(`沙箱里没有 ${name}`);
      return value;
    },
  };
}
