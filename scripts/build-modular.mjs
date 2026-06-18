import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = ROOT;

const CONTENT_CHUNK_DIR = 'js/content';
const ASSISTANT_CHUNK_DIR = 'js/assistant';
const BACKGROUND_CHUNK_DIR = 'js/background';
const STYLE_CHUNK_DIR = 'styles';

const CONTENT_BUNDLE = 'js/bundle/content.js';
const ASSISTANT_BUNDLE = 'js/bundle/image-assistant.js';
const BACKGROUND_BUNDLE = 'js/bundle/background.js';
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

function indentBlock(block, spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.length ? `${prefix}${line}` : ''))
    .join('\n');
}

function bundleScript({ chunkDir, bundlePath, preamble = '', epilogue = '' }) {
  const chunks = listChunkFiles(chunkDir);
  if (!chunks.length) {
    throw new Error(`No chunk files found in ${chunkDir}`);
  }

  const body = chunks
    .map((name) => readFile(path.posix.join(chunkDir, name)).trimEnd())
    .join('\n\n');

  const source = `(function () {
  'use strict';
${preamble ? `${indentBlock(preamble.trimEnd())}\n\n` : ''}${indentBlock(body)}
${epilogue ? `\n${indentBlock(epilogue.trimEnd())}\n` : ''}})();
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
    .filter((name) => name.endsWith('.css') && name !== 'bundle.css' && name !== 'index.css')
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
  epilogue: contentEpilogue,
});

bundleScript({
  chunkDir: ASSISTANT_CHUNK_DIR,
  bundlePath: ASSISTANT_BUNDLE,
  preamble: assistantPreamble,
  epilogue: assistantEpilogue,
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
console.log(`  ${STYLE_BUNDLE}`);

for (const file of [CONTENT_BUNDLE, ASSISTANT_BUNDLE, BACKGROUND_BUNDLE]) {
  validateBundle(file);
}
