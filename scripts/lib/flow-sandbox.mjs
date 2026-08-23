// 把 js/flow/*.js 装进 vm 跑。这些 chunk 会被前置进 content 和 assistant 两个 bundle，
// 测试也按同样的方式整体加载，测的是真正上线的那份代码。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLOW_DIR = path.join(ROOT, 'js', 'flow');

export function createFlowSandbox(extraGlobals = {}) {
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
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  const files = fs
    .readdirSync(FLOW_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(FLOW_DIR, name), 'utf8'), context, { filename: `js/flow/${name}` });
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
