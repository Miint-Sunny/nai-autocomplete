// 打包 + 自检。发布产物的文件清单只此一份，release workflow 调它，CI 也调它。
//
//   node scripts/package.mjs            构建并校验（CI 用）
//   node scripts/package.mjs --zip      再打成 dist/nai-autocomplete-vX.Y.Z.zip
//
// 校验的是「解压出来能不能直接加载」：manifest 引用的每个文件、每个页面里
// 引用的每个资源，都必须真的在包里。少一个文件用户装上就是坏的。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PACKAGE_DIR = path.join(DIST, 'nai-autocomplete');

// 发布产物的完整清单。源码 chunk、测试、文档、backup 模板都不进包。
const FILES = [
  'manifest.json',
  'background.js',
  'official-chunk-bridge.js',
  'artist-studio-bridge.js',
  'LICENSE',
  'README.md',
  'js/bundle/content.js',
  'js/bundle/image-assistant.js',
  'js/bundle/background.js',
  'js/bundle/artist-library.js',
  'styles/bundle.css',
  'styles/artist-library.css',
  'pages/artist-library.html',
];

const DIRS = ['icons'];

function copyFile(relative) {
  const from = path.join(ROOT, relative);
  if (!fs.existsSync(from)) throw new Error(`清单里的 ${relative} 不存在`);
  const to = path.join(PACKAGE_DIR, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(relative) {
  const from = path.join(ROOT, relative);
  if (!fs.existsSync(from)) throw new Error(`清单里的目录 ${relative} 不存在`);
  fs.cpSync(from, path.join(PACKAGE_DIR, relative), { recursive: true });
}

// manifest 里所有指向本地文件的字段
function manifestReferences(manifest) {
  const refs = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value && !/^https?:/.test(value)) refs.add(value);
  };

  add(manifest.background?.service_worker);
  for (const entry of manifest.content_scripts || []) {
    (entry.js || []).forEach(add);
    (entry.css || []).forEach(add);
  }
  Object.values(manifest.icons || {}).forEach(add);
  for (const entry of manifest.web_accessible_resources || []) {
    (entry.resources || []).forEach(add);
  }
  return [...refs].sort();
}

// 扩展页里的 src / href，按页面自身位置解析
function pageReferences(relativePage) {
  const source = fs.readFileSync(path.join(PACKAGE_DIR, relativePage), 'utf8');
  const base = path.dirname(relativePage);
  return [...source.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(https?:|data:|#|mailto:)/.test(value))
    .map((value) => path.posix.normalize(path.posix.join(base, value)));
}

function validate() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'manifest.json'), 'utf8'));
  const missing = [];

  const check = (relative, source) => {
    if (!fs.existsSync(path.join(PACKAGE_DIR, relative))) missing.push(`${relative}（来自 ${source}）`);
  };

  for (const reference of manifestReferences(manifest)) check(reference, 'manifest.json');
  for (const page of FILES.filter((file) => file.endsWith('.html'))) {
    for (const reference of pageReferences(page)) check(reference, page);
  }

  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) {
    missing.push(`manifest.version 形如 x.y.z（当前 ${manifest.version}）`);
  }

  return { manifest, missing };
}

execFileSync('node', [path.join(ROOT, 'scripts/build-modular.mjs')], { stdio: 'pipe' });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(PACKAGE_DIR, { recursive: true });
FILES.forEach(copyFile);
DIRS.forEach(copyDir);

const { manifest, missing } = validate();

if (missing.length) {
  console.error('打包校验未通过，以下引用在包里找不到：');
  for (const item of missing) console.error(`  ✗ ${item}`);
  process.exit(1);
}

const fileCount = fs.readdirSync(PACKAGE_DIR, { recursive: true })
  .filter((name) => fs.statSync(path.join(PACKAGE_DIR, name)).isFile()).length;

console.log(`✓ 打包校验通过：v${manifest.version}，${fileCount} 个文件`);

if (process.argv.includes('--zip')) {
  const archive = `nai-autocomplete-v${manifest.version}.zip`;
  execFileSync('zip', ['-rq', archive, 'nai-autocomplete'], { cwd: DIST });
  const size = fs.statSync(path.join(DIST, archive)).size;
  console.log(`✓ dist/${archive}（${(size / 1024).toFixed(0)} KB）`);
}
