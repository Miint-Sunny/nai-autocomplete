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

// UNL 把 prompts.yaml 当成硬性的构建/运行期依赖，发版前跑 validator 卡住。
// 我们的对应物是内置 skill：它决定 Agent 开箱即用的行为，坏了要在 CI 就红，不能等用户发现。
test('内置 skill 满足最低形状要求', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'js/assistant/17-agent-skill-builtin.js'), 'utf8');
  const skill = (0, eval)(`${source.replace('const BUILTIN_AGENT_SKILL', 'var BUILTIN_AGENT_SKILL')};BUILTIN_AGENT_SKILL`);

  assert.equal(skill.builtin, true);
  assert.ok(skill.id, '缺 id');
  assert.ok(skill.name?.trim(), '缺 name');
  assert.ok(skill.description?.trim(), '缺 description —— 决定用户什么时候该用它');
  assert.ok(skill.body.length > 2000, `正文只有 ${skill.body.length} 字，多半是被截断了`);

  // 这三节是 Agent 行为的支柱：输出格式、氛围串、以及排查表
  for (const heading of ['## 1.', '## 3.', '## 12.']) {
    assert.ok(skill.body.includes(heading), `正文缺少小节 ${heading}`);
  }
  assert.ok(/1\.\dX?::/.test(skill.body) || skill.body.includes('::'), '正文应说明 :: 权重语法');

  assert.ok(Array.isArray(skill.references), 'references 必须是数组');
  for (const reference of skill.references) {
    assert.ok(reference.name?.trim(), '参考资料缺 name');
    assert.ok(reference.content?.trim().length > 200, `参考资料 ${reference.name} 内容过短`);
  }
});

test('manifest 版本不会被打包重置', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

await run('打包测试');
