import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = ROOT;

const CONTENT_CHUNK_DIR = 'js/content';
const ASSISTANT_CHUNK_DIR = 'js/assistant';
const BACKGROUND_CHUNK_DIR = 'js/background';
const ARTIST_CHUNK_DIR = 'js/artist';
const FLOW_CHUNK_DIR = 'js/flow';
const STYLE_CHUNK_DIR = 'styles';

const CONTENT_BUNDLE = 'js/bundle/content.js';
const ASSISTANT_BUNDLE = 'js/bundle/image-assistant.js';
const BACKGROUND_BUNDLE = 'js/bundle/background.js';
const ARTIST_BUNDLE = 'js/bundle/artist-library.js';
const STYLE_BUNDLE = 'styles/bundle.css';

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/^\uFEFF/, '');
}

function writeOut(relPath, content) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function listChunkFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// sharedDirs 里的 chunk 会前置进多个 bundle。content 脚本和 assistant 脚本
// 是两个互相看不见的 IIFE，流编辑器要在两边渲染得一模一样，只能这样共享源码。
// 共享 chunk 里的符号一律带 flow / FLOW_ 前缀，避免和各自 bundle 里的全局撞名。
function bundleScript({ chunkDir, bundlePath, preamble = '', epilogue = '', sharedDirs = [] }) {
  const chunks = listChunkFiles(chunkDir);
  if (!chunks.length) {
    throw new Error(`No chunk files found in ${chunkDir}`);
  }

  const sharedBody = sharedDirs.flatMap((dir) => listChunkFiles(dir)
    .map((name) => readFile(path.posix.join(dir, name)).trimEnd()));

  const body = [...sharedBody, ...chunks
    .map((name) => readFile(path.posix.join(chunkDir, name)).trimEnd())]
    .join('\n\n');

  // 不要给 body 加缩进：多行模板字符串（默认提示词、内置 skill 正文）的内容
  // 会被逐行插进两个空格，出去的就不是源文件里那份文本了。
  const source = `(function () {
'use strict';
${preamble ? `${preamble.trimEnd()}\n\n` : ''}${body}
${epilogue ? `\n${epilogue.trimEnd()}\n` : ''}})();
`;

  writeOut(bundlePath, `${source}\n`);
  return bundlePath;
}

function bundleBackground() {
  const chunks = listChunkFiles(BACKGROUND_CHUNK_DIR);
  if (!chunks.length) {
    throw new Error(`No chunk files found in ${BACKGROUND_CHUNK_DIR}`);
  }

  const source = `${chunks
    .map((name) => readFile(path.posix.join(BACKGROUND_CHUNK_DIR, name)).trimEnd())
    .join('\n\n')}
`;

  writeOut(BACKGROUND_BUNDLE, `${source}\n`);
  return BACKGROUND_BUNDLE;
}

function bundleStyles() {
  const full = path.join(ROOT, STYLE_CHUNK_DIR);
  const chunks = fs
    .readdirSync(full)
    .filter((name) => name.endsWith('.css')
      && name !== 'bundle.css'
      && name !== 'index.css'
      && name !== 'artist-library.css')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const source = `${chunks
    .map((name) => readFile(path.posix.join(STYLE_CHUNK_DIR, name)).trimEnd())
    .join('\n\n')}
`;

  writeOut(STYLE_BUNDLE, `${source}\n`);
  return STYLE_BUNDLE;
}

function seedBackgroundFromBackupIfMissing() {
  if (listChunkFiles(BACKGROUND_CHUNK_DIR).length) return;

  const backupPath = path.join(ROOT, 'backup', 'background.js');
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Missing ${BACKGROUND_CHUNK_DIR} chunks and backup/background.js`);
  }

  const lines = readFile('backup/background.js').split(/\r?\n/);
  writeOut(path.join(BACKGROUND_CHUNK_DIR, '01-action.js'), `${lines.slice(0, 47).join('\n')}\n`);
  writeOut(path.join(BACKGROUND_CHUNK_DIR, '02-llm.js'), `${lines.slice(47).join('\n')}\n`);
}

function writeServiceWorkerEntry() {
  writeOut('background.js', `importScripts('${BACKGROUND_BUNDLE.replace(/\\/g, '/')}');\n`);
}

function writeManifest() {
  const templatePath = path.join(ROOT, 'backup', 'manifest.monolith.json');
  const manifest = JSON.parse(
    fs.existsSync(templatePath)
      ? readFile('backup/manifest.monolith.json')
      : readFile('manifest.json'),
  );

  // manifest.json owns the version (the release workflow reads it); the backup
  // template only supplies structure, so never let a stale template reset it.
  const currentManifestPath = path.join(ROOT, 'manifest.json');
  if (fs.existsSync(currentManifestPath)) {
    const currentVersion = JSON.parse(readFile('manifest.json')).version;
    if (currentVersion) manifest.version = currentVersion;
  }

  manifest.background.service_worker = 'background.js';
  manifest.content_scripts = manifest.content_scripts.map((entry) => {
    if (entry.js?.some((file) => file.endsWith('content.js'))) {
      return { ...entry, js: [CONTENT_BUNDLE], css: [STYLE_BUNDLE] };
    }
    if (entry.js?.some((file) => file.endsWith('image-assistant.js'))) {
      return { ...entry, js: [ASSISTANT_BUNDLE], css: [STYLE_BUNDLE] };
    }
    return entry;
  });

  writeOut('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

function removeLegacyRootMonoliths() {
  for (const file of ['content.js', 'image-assistant.js', 'styles.css']) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

function validateBundle(relPath) {
  execSync(`node --check "${path.join(ROOT, relPath)}"`, { stdio: 'inherit' });
}

const assistantPreamble = `if (window.top !== window.self) return;
if (window.__naiAssistantV4Loaded) return;
window.__naiAssistantV4Loaded = true;`;

const assistantEpilogue = `init().catch((error) => {
  console.error('[NAI Assistant] Failed to initialize:', error);
});`;

const contentEpilogue = `if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}`;

seedBackgroundFromBackupIfMissing();

bundleScript({
  chunkDir: CONTENT_CHUNK_DIR,
  bundlePath: CONTENT_BUNDLE,
  sharedDirs: [FLOW_CHUNK_DIR],
  epilogue: contentEpilogue,
});

bundleScript({
  chunkDir: ASSISTANT_CHUNK_DIR,
  bundlePath: ASSISTANT_BUNDLE,
  sharedDirs: [FLOW_CHUNK_DIR],
  preamble: assistantPreamble,
  epilogue: assistantEpilogue,
});

bundleScript({
  chunkDir: ARTIST_CHUNK_DIR,
  bundlePath: ARTIST_BUNDLE,
});

bundleBackground();
bundleStyles();
writeServiceWorkerEntry();
writeManifest();
removeLegacyRootMonoliths();

console.log('Bundled from split sources:');
console.log(`  ${CONTENT_BUNDLE}`);
console.log(`  ${ASSISTANT_BUNDLE}`);
console.log(`  ${BACKGROUND_BUNDLE}`);
console.log(`  ${ARTIST_BUNDLE}`);
console.log(`  ${STYLE_BUNDLE}`);

for (const file of [CONTENT_BUNDLE, ASSISTANT_BUNDLE, BACKGROUND_BUNDLE, ARTIST_BUNDLE]) {
  validateBundle(file);
}
