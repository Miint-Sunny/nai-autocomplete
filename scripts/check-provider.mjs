// 拿真 Key 打真接口，看一家服务商到底能不能用。**不进 CI**，只在本地手动跑。
//
//   node scripts/check-provider.mjs            列出可选的服务商
//   node scripts/check-provider.mjs deepseek   用它跑一遍
//
// Key 从 .env 读（只有 NAI_API_KEY 一个），其余全部来自扩展自己那份
// PROVIDER_PRESETS —— 不在这儿重抄一份协议和 Endpoint，抄了就会和线上走散。
//
// 跑的是 js/background/ 里真正上线的那份代码（和 test-llm / test-agent 同一个沙箱），
// 只把 fetch 换成真网络请求，所以请求体、协议分支、错误分类都是线上那套。
//
// 输出里的 Key 一律打码，可以直接贴进 issue。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createBackgroundSandbox } from './lib/background-sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 服务商：直接用扩展里那份预设表 ──────────────────────────────
function readProviderPresets() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'assistant', '01-constants.js'), 'utf8');
  const match = source.match(/const PROVIDER_PRESETS = \[[\s\S]*?\n\];/);
  if (!match) throw new Error('没在 01-constants.js 里找到 PROVIDER_PRESETS');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nglobalThis.out = PROVIDER_PRESETS;`, context);
  return context.out;
}

// DeepSeek 另有一套 Anthropic 兼容接口，扩展的预设表里没有它
// （预设走 OpenAI 兼容那条）。这里补一个条目，好把两条路分别验一遍。
const EXTRA_PRESETS = [
  {
    // 复现用：协议改成了 Anthropic，Endpoint 还留着 DeepSeek 的 OpenAI 那条
    //（在设置里只动了协议下拉、没动地址，或者反过来）。
    id: 'mismatch',
    label: '错配：Anthropic 协议 + OpenAI Endpoint（复现用）',
    protocol: 'anthropic-messages',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-flash-vision-exp',
  },
  {
    // 复现用：DeepSeek 文档给的 base_url 是 https://api.deepseek.com/anthropic，
    // 直接把它填进 Endpoint 框是很自然的动作 —— 看那个裸路径后面挂的是什么处理器。
    id: 'deepseek-anthropic-bare',
    label: 'DeepSeek（Anthropic 裸 base_url，复现用）',
    protocol: 'anthropic-messages',
    endpoint: 'https://api.deepseek.com/anthropic',
    defaultModel: 'deepseek-v4-flash-vision-exp',
  },
  {
    id: 'deepseek-anthropic',
    label: 'DeepSeek（Anthropic 兼容）',
    protocol: 'anthropic-messages',
    endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
    defaultModel: 'deepseek-v4-flash-vision-exp',
  },
];

const PRESETS = [...readProviderPresets(), ...EXTRA_PRESETS].filter((p) => p.endpoint);

function readApiKey() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    console.error('没找到 .env。先 `cp .env.example .env` 再把 NAI_API_KEY 填上。');
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('NAI_API_KEY=')) continue;
    const value = trimmed.slice('NAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  console.error('.env 里的 NAI_API_KEY 是空的。');
  process.exit(1);
}

function printProviders() {
  console.log('可选的服务商（第一个参数填 id）：\n');
  for (const preset of PRESETS) {
    console.log(`  ${preset.id.padEnd(20)} ${preset.label}`);
    console.log(`  ${''.padEnd(20)} ${preset.protocol} · ${preset.endpoint}`);
  }
  console.log('\n例如： node scripts/check-provider.mjs deepseek');
}

const wanted = process.argv[2];
if (!wanted) {
  printProviders();
  process.exit(0);
}

const preset = PRESETS.find((p) => p.id === wanted);
if (!preset) {
  console.error(`不认识的服务商「${wanted}」。\n`);
  printProviders();
  process.exit(1);
}

const API_KEY = readApiKey();
// 全程只经这两个函数输出，Key 不可能漏出去
const redact = (text) => String(text ?? '').split(API_KEY).join('sk-***REDACTED***');
const log = (...parts) => console.log(...parts.map((p) => (typeof p === 'string' ? redact(p) : p)));

const config = {
  providerId: preset.id,
  label: preset.label,
  protocol: preset.protocol,
  endpoint: preset.endpoint,
  apiKey: API_KEY,
  model: process.argv[3] || preset.defaultModel,
  temperature: 0.4,
  // 第三个参数可以覆盖：node scripts/check-provider.mjs deepseek-anthropic '' 16000
  maxTokens: Number(process.argv[4]) || 700,
  reasoningEffort: 'off',
};

const TAG_INDEX = [
  { tag: 'school_uniform', category: '0', postCount: 900000, translation: '校服', aliases: [] },
  { tag: 'transparent_umbrella', category: '0', postCount: 12000, translation: '透明伞', aliases: [] },
  { tag: 'convenience_store', category: '0', postCount: 8000, translation: '便利店', aliases: [] },
];

// mockFetch 只负责把发出去的请求记下来，请求本身照常打到网上
function realFetchBox() {
  const box = createBackgroundSandbox();
  box.setStorage({ 'nai-ac-tags': TAG_INDEX });
  const calls = box.mockFetch(async (call) => globalThis.fetch(call.url, call.options));
  return { box, calls };
}

log(`${preset.label}  ·  ${config.protocol}`);
log(`${config.endpoint}`);
log(`模型 ${config.model}    Key ${API_KEY.slice(0, 6)}…（${API_KEY.length} 位）`);

// ── 1. 模型列表 ──────────────────────────────────────────────
log('\n──────── 模型列表 ────────');
try {
  const { box } = realFetchBox();
  const { models } = await box.get('listModels')(config, { retry: { maxAttempts: 1 } });
  log(`返回 ${models.length} 个：`);
  models.forEach((m) => log(`  · ${m}${m === config.model ? '   ← 当前用的就是它' : ''}`));

  if (models.length && !models.includes(config.model)) {
    log(`\n⚠ 当前配的「${config.model}」不在返回列表里 —— 预设的 defaultModel 可能过期了。`);
  } else if (models.length > 1) {
    const filtered = models.filter((m) => !m.includes(config.model));
    if (filtered.length) {
      log(`\n注：datalist 会按输入框现值过滤，只填「${config.model}」时`);
      log(`    另外 ${filtered.length} 个（${filtered.join('、')}）会被滤掉 —— 这就是 issue #2 的成因。`);
    }
  }
} catch (error) {
  log(`✗ 拉不到：${error?.message || error}`);
  if (error?.kind) log(`  kind=${error.kind}   hint=${error.hint || '(无)'}`);
}

// ── 2. 真实写词（会挂 search_tags 工具）──────────────────────
log('\n──────── 写词（带工具）────────');
const { box, calls } = realFetchBox();
const result = await box.get('runPromptAgent')({
  skill: {
    name: 'check-provider',
    body: '写 NovelAI 提示词。锚定 tag 在前，自然语言在后。结果放进一个代码框。',
    references: [],
  },
  request: '雨夜里，一个穿校服的女孩撑着透明伞站在便利店门口',
  primary: config,
  // 和扩展的默认一致：本地词典没有的词，再实时问一次 danbooru。
  // 关掉它、又只给三个 tag 的话，模型查什么都是 not_found，会一直换词重试 ——
  // 那是脚本造出来的假象，不是线上的行为。
  allowDanbooruLookup: true,
}, { retry: { maxAttempts: 1 } });

const sent = calls[0]?.body;
if (sent) {
  const tool = sent.tools?.[0];
  log(`请求体字段  ${Object.keys(sent).join(', ')}`);
  log(`tools[0]    ${tool ? Object.keys(tool).join(', ') : '(没挂工具)'}`);
  // Anthropic 的自定义工具本来就不带 type（带了反而被拒），OpenAI 系才必须有
  if (tool) {
    const wantsType = config.protocol !== 'anthropic-messages';
    const hasType = 'type' in tool;
    log(`有 type     ${hasType ? `有 ${JSON.stringify(tool.type)}` : '无'}   ${hasType === wantsType ? '✓ 符合该协议的 spec' : '✗ 和该协议的 spec 不符'}`);
  }
  log(`额度        ${sent.max_tokens ?? sent.max_output_tokens ?? '(未设)'}`);
}
log(`请求次数    ${calls.length}${calls.length > 1 ? '（>1 = 模型调了 search_tags，工具回路通了）' : ''}`);

if (result.ok) {
  log(`\n✓ 成功 · ${result.usedModel} · ${result.usage?.totalTokens ?? '?'} tokens · ${((result.durationMs || 0) / 1000).toFixed(1)}s`);
  if (result.truncated) log('⚠ 被 max_tokens 截断了');
  log('\n' + result.text.slice(0, 1000) + (result.text.length > 1000 ? '\n…（截断显示）' : ''));
} else {
  log(`\n✗ 失败：${result.error}`);
  log(`  kind=${result.errorKind}`);
  (result.attempts || []).forEach((a, i) => log(`  尝试 ${i + 1}: ${JSON.stringify(a)}`));
}

log('\n上面的 Key 已打码，可以直接贴。');
