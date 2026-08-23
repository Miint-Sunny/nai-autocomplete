// 打包只做拼接，不做任何变换 —— 这条不变量必须守住。
// 曾经 bundler 给每一行加两个空格做缩进，结果多行模板字符串（默认提示词、
// 内置 skill 正文）里的内容被逐行插进两个空格，出去的就不是源文件里那份文本了。
//
//   node scripts/test-build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { group, test, run } from './lib/tiny-test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  { chunkDir: 'js/content', bundle: 'js/bundle/content.js' },
  { chunkDir: 'js/assistant', bundle: 'js/bundle/image-assistant.js' },
  // 共享 chunk：同一份源码要逐字进两个 bundle，两处渲染才可能零偏差
  { chunkDir: 'js/flow', bundle: 'js/bundle/content.js' },
  { chunkDir: 'js/flow', bundle: 'js/bundle/image-assistant.js' },
  { chunkDir: 'js/background', bundle: 'js/bundle/background.js' },
  { chunkDir: 'js/artist', bundle: 'js/bundle/artist-library.js' },
  { chunkDir: 'styles', bundle: 'styles/bundle.css', ext: '.css', skip: ['bundle.css', 'index.css', 'artist-library.css'] },
];

execFileSync('node', [path.join(ROOT, 'scripts/build-modular.mjs')], { stdio: 'pipe' });

function readChunks({ chunkDir, ext = '.js', skip = [] }) {
  return fs
    .readdirSync(path.join(ROOT, chunkDir))
    .filter((name) => name.endsWith(ext) && !skip.includes(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => ({ name, source: fs.readFileSync(path.join(ROOT, chunkDir, name), 'utf8').trimEnd() }));
}

group('打包不改动源码');

for (const target of TARGETS) {
  test(`${target.bundle} 逐字包含 ${target.chunkDir}/ 的每个 chunk`, () => {
    const bundle = fs.readFileSync(path.join(ROOT, target.bundle), 'utf8');
    for (const chunk of readChunks(target)) {
      assert.ok(
        bundle.includes(chunk.source),
        `${target.chunkDir}/${chunk.name} 在产物里被改过（缩进、换行或转义）`,
      );
    }
  });
}

group('内置 skill 与来源一致');

test('内置 skill 正文没有被打包过程动过', () => {
  const chunk = fs.readFileSync(path.join(ROOT, 'js/assistant/17-agent-skill-builtin.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'js/bundle/image-assistant.js'), 'utf8');

  // markdown 对行首空白敏感（四空格就变成代码块），所以逐字比对
  assert.ok(bundle.includes(chunk.trimEnd()), '内置 skill chunk 未逐字进入产物');
  assert.match(chunk, /^## 1\. 用户约定/m, 'skill 正文应保留行首无缩进的小节标题');
});

test('manifest 版本不会被打包重置', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

await run('打包测试');
