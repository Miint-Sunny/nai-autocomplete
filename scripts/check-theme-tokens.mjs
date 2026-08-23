// 主题变量完整性检查。
// 深色主题必须自带全套（基础块是浅色，回落过去会串色）；
// 浅色主题允许回落，只查它有没有漏掉深色专属的那几个。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'styles/04-assistant-md3.css'), 'utf8');

const DARK_THEMES = new Set(['ember', 'midnight', 'moss', 'novelai', 'liquid-dark']);

// 这几个在样式里是带 fallback 引用的（fallback 跟着主色走），主题不定义也不会串色
const OPTIONAL = new Set([
  '--nai-md3-tab-active-bg',
  '--nai-md3-tab-active-fg',
  '--nai-md3-tab-active-shadow',
]);

// 只认「选择器独占、不是多选择器组一员」的块
function ownBlock(selector) {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]"]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`, 'g');
  for (const m of css.matchAll(re)) {
    if (css.slice(0, m.index + 1).trimEnd().endsWith(',')) continue;
    return new Set([...m[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]));
  }
  return null;
}

const template = ownBlock('.nai-md3-root[data-theme="novelai"]');
if (!template) throw new Error('找不到 novelai 主题块（它是完整性模板）');

const themes = new Set(
  [...css.matchAll(/\.nai-md3-root\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]),
);

let failed = 0;
for (const theme of [...themes].sort()) {
  const own = ownBlock(`.nai-md3-root[data-theme="${theme}"]`);
  if (!own) { console.log(`${theme}: 跳过（只出现在多选择器组里）`); continue; }
  const missing = [...template].filter((k) => !own.has(k) && !OPTIONAL.has(k));
  const isDark = DARK_THEMES.has(theme);
  if (!missing.length) { console.log(`${theme}: ✓ ${own.size} 个`); continue; }
  if (isDark) { failed++; console.log(`${theme}: ✗ 深色主题缺 ${missing.length} 个 → ${missing.join(' ')}`); }
  else console.log(`${theme}: ✓ ${own.size} 个（浅色，另 ${missing.length} 个回落基础块）`);
}

// 自引用的 CSS 变量（--x: var(--x)）属于 invalid at computed-value time：
// 整个属性作废，用到它的规则静默退成 unset。不会报错，只会让某些主题看起来「坏了一半」。
// 抽公共变量时手一滑就会写出来，所以放进 CI 兜住。
function findSelfReferences(source) {
  const found = [];
  for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]*);/gi)) {
    const [, name, value] = m;
    // 不能用 \b 收尾：--x 会误配到 --x-color 上（`-` 本身就是词边界）。
    if (new RegExp(`var\\(\\s*${name}(?![\\w-])`).test(value)) {
      found.push({ name, line: source.slice(0, m.index).split('\n').length });
    }
  }
  return found;
}

const styleDir = path.join(ROOT, 'styles');
for (const file of fs.readdirSync(styleDir).filter((n) => n.endsWith('.css') && n !== 'bundle.css')) {
  for (const issue of findSelfReferences(fs.readFileSync(path.join(styleDir, file), 'utf8'))) {
    failed++;
    console.log(`styles/${file}:${issue.line}: ✗ ${issue.name} 自引用，该属性会整个失效`);
  }
}

if (failed) { console.error(`\n检查未通过（${failed} 项）`); process.exit(1); }
console.log('\n全部主题变量检查通过');
