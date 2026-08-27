// 拿真 Key 打真接口的检查脚本。**不进 CI**，只在本地手动跑。
//
//   cp .env.example .env   # 填 NAI_API_KEY
//   node scripts/live-check.mjs
//
// 跑的是 js/background/ 里真正上线的那份代码（和 test-llm / test-agent 同一个沙箱），
// 只是把 fetch 换成真的网络请求，所以请求体、协议分支、错误分类全都是线上那套。
//
// 三件事：
//   1. 拉模型列表 —— 看这家到底返回哪些 id（issue #2）
//   2. 打印将要发出去的请求体形状（重点看 tools[0] 有没有 type，issue #1）
//   3. 跑一次真实的写词请求，看它到底成不成
//
// 输出里的 API Key 一律打码。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackgroundSandbox } from './lib/background-sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    console.error('没找到 .env。先 `cp .env.example .env` 再把 NAI_API_KEY 填上。');
    process.exit(1);
  }

  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const API_KEY = env.NAI_API_KEY || '';
if (!API_KEY) {
  console.error('.env 里的 NAI_API_KEY 是空的。');
  process.exit(1);
}

// 全程只用这个函数往外打印，避免 Key 漏进日志
const redact = (text) => String(text ?? '').split(API_KEY).join('sk-***REDACTED***');
const log = (...parts) => console.log(...parts.map((p) => (typeof p === 'string' ? redact(p) : p)));

const config = {
  providerId: env.NAI_PROVIDER_ID || 'custom',
  label: env.NAI_PROVIDER_ID || '自定义',
  protocol: env.NAI_PROTOCOL || 'openai-chat',
  endpoint: env.NAI_ENDPOINT || '',
  apiKey: API_KEY,
  model: env.NAI_MODEL || '',
  temperature: 0.4,
  maxTokens: 700,
  reasoningEffort: env.NAI_REASONING_EFFORT || 'off',
};

log('════════ 配置 ════════');
log(`协议     ${config.protocol}`);
log(`Endpoint ${config.endpoint}`);
log(`模型     ${config.model}`);
log(`思考档位 ${config.reasoningEffort}`);
log(`Key      ${API_KEY.slice(0, 6)}…（${API_KEY.length} 位）`);

const TAG_INDEX = [
  { tag: 'school_uniform', category: '0', postCount: 900000, translation: '校服', aliases: [] },
  { tag: 'transparent_umbrella', category: '0', postCount: 12000, translation: '透明伞', aliases: [] },
  { tag: 'convenience_store', category: '0', postCount: 8000, translation: '便利店', aliases: [] },
];

// 真 fetch：mockFetch 只负责把发出去的请求记下来，请求本身照常打到网上
function realFetchBox() {
  const box = createBackgroundSandbox();
  box.setStorage({ 'nai-ac-tags': TAG_INDEX });
  const calls = box.mockFetch(async (call) => globalThis.fetch(call.url, call.options));
  return { box, calls };
}

async function step1Models() {
  log('\n════════ 1. 模型列表（issue #2）════════');
  const { box } = realFetchBox();
  try {
    const result = await box.get('listModels')(config, { retry: { maxAttempts: 1 } });
    log(`返回 ${result.models.length} 个模型：`);
    result.models.forEach((m) => log(`  · ${m}${m === config.model ? '   ← 当前配置的就是它' : ''}`));

    if (result.models.length && !result.models.includes(config.model)) {
      log(`\n⚠ 当前配的「${config.model}」不在返回列表里。`);
    }
    if (result.models.length > 1 && result.models.includes(config.model)) {
      const hidden = result.models.filter((m) => !m.includes(config.model));
      log(`\n这解释了 issue #2：datalist 会按输入框现值过滤，`);
      log(`「${config.model}」之外的 ${hidden.length} 个都不含这个子串，展开时会被滤掉。`);
    }
  } catch (error) {
    log(`✗ 失败：${error?.message || error}`);
    if (error?.kind) log(`  kind=${error.kind}  hint=${error.hint || '(无)'}`);
  }
}

async function step2Agent() {
  log('\n════════ 2 + 3. 真实写词请求（issue #1）════════');
  const { box, calls } = realFetchBox();

  const result = await box.get('runPromptAgent')({
    skill: {
      name: 'live-check',
      body: '写 NovelAI 提示词。锚定 tag 在前，自然语言在后。输出放在一个代码框里。',
      references: [],
    },
    request: '雨夜里，一个穿校服的女孩撑着透明伞站在便利店门口',
    primary: config,
    allowDanbooruLookup: false,
  }, { retry: { maxAttempts: 1 } });

  const sent = calls[0]?.body;
  if (sent) {
    log('发出去的请求体：');
    log(`  顶层字段  ${Object.keys(sent).join(', ')}`);
    const tool = sent.tools?.[0];
    log(`  tools[0]  ${tool ? Object.keys(tool).join(', ') : '(没挂工具)'}`);
    if (tool) {
      log(`  有 type   ${'type' in tool ? `✓ = ${JSON.stringify(tool.type)}` : '✗ 缺失 —— 严格的服务端会拒'}`);
    }
    log(`  max_tokens ${sent.max_tokens ?? sent.max_output_tokens ?? '(未设)'}`);
  }

  log(`\n请求数：${calls.length}（>1 说明模型调了 search_tags，工具回路走通了）`);

  if (result.ok) {
    log(`✓ 成功。用了 ${result.usedModel}，${result.usage?.totalTokens ?? '?'} tokens，${((result.durationMs || 0) / 1000).toFixed(1)}s`);
    if (result.truncated) log('⚠ 但被 max_tokens 截断了');
    log('\n───── 模型输出 ─────');
    log(result.text.slice(0, 1200) + (result.text.length > 1200 ? '\n…（截断显示）' : ''));
  } else {
    log(`✗ 失败：${result.error}`);
    log(`  kind=${result.errorKind}`);
    const last = result.attempts?.[result.attempts.length - 1];
    if (last) log(`  最后一次尝试：${JSON.stringify(last)}`);
  }
}

await step1Models();
await step2Agent();
log('\n跑完了。上面的输出里 Key 已经打码，可以直接贴。');
