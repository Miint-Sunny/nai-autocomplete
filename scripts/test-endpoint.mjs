// Endpoint 的地址口径：只给 base URL 时按协议把路径补上。
//
//   node scripts/test-endpoint.mjs
//
// 补法取各家官方 SDK 的口径：OpenAI 系的 base 自带 /v1（api.openai.com/v1），
// 客户端只补末段；Anthropic 的 base 不带版本号（api.anthropic.com），
// 由客户端补 /v1/messages。酒馆和各家 SDK 都是这样，所以用户习惯的就是填 base。

import assert from 'node:assert/strict';
import { group, test, run } from './lib/tiny-test.mjs';
import { createAssistantSandbox } from './lib/assistant-sandbox.mjs';

const box = createAssistantSandbox();
const complete = box.get('completeEndpointPath');
const resolve = box.get('resolveEndpoint');
const detect = box.get('detectProtocolEndpointMismatch');

// ═══════════════════════ 1. 只给 base URL ═══════════════════════

group('只给 base URL 就补上路径');

test('三种协议各补各的', () => {
  assert.equal(complete('openai-chat', 'https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(complete('anthropic-messages', 'https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.equal(complete('responses', 'https://api.x.ai/v1'), 'https://api.x.ai/v1/responses');
});

test('base 自带版本段就不再补一个 v1', () => {
  // /anthropic/v1 + /v1/messages 会变成 /anthropic/v1/v1/messages
  assert.equal(
    complete('anthropic-messages', 'https://api.deepseek.com/anthropic/v1'),
    'https://api.deepseek.com/anthropic/v1/messages'
  );
  assert.equal(
    complete('openai-chat', 'https://api.openai.com/v1'),
    'https://api.openai.com/v1/chat/completions'
  );
});

test('DeepSeek 的两条路都补得对', () => {
  assert.equal(complete('openai-chat', 'https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(
    complete('anthropic-messages', 'https://api.deepseek.com/anthropic'),
    'https://api.deepseek.com/anthropic/v1/messages'
  );
});

test('结尾多写了斜杠也认', () => {
  assert.equal(complete('openai-chat', 'https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
});

// ═══════════════════════ 2. 什么时候不该动 ═══════════════════════

group('该原样保留的情况');

test('已经是完整地址就一个字符都不动', () => {
  for (const [protocol, endpoint] of [
    ['openai-chat', 'https://api.deepseek.com/chat/completions'],
    ['anthropic-messages', 'https://api.anthropic.com/v1/messages'],
    ['responses', 'https://api.x.ai/v1/responses'],
  ]) {
    assert.equal(complete(protocol, endpoint), endpoint);
  }
});

test('长着另一种协议的样子不动它 —— 那是配错了协议，该报错不该补', () => {
  const endpoint = 'https://api.deepseek.com/chat/completions';
  assert.equal(complete('anthropic-messages', endpoint), endpoint);
  // 补完还是要能被认出是错配，两者得配套
  assert.match(detect('anthropic-messages', complete('anthropic-messages', endpoint)), /OpenAI Chat Completions/);
});

test('空的、不是网址的、认不出的协议，都不炸', () => {
  assert.equal(complete('openai-chat', ''), '');
  assert.equal(complete('openai-chat', '   '), '');
  assert.equal(complete('openai-chat', '不是网址'), '不是网址');
  assert.equal(complete('没这个协议', 'https://api.deepseek.com'), 'https://api.deepseek.com');
});

// ═══════════════════════ 3. 开关 ═══════════════════════

group('开关');

test('关掉就一个字符都不动 —— 自建网关可能就认那个怪路径', () => {
  const gateway = 'https://gw.example.com/v1/proxy';
  assert.equal(resolve('openai-chat', gateway, false), gateway);
  // 开着的话它会被当成 base URL 补上路径，这正是这个开关存在的理由
  assert.equal(resolve('openai-chat', gateway, true), 'https://gw.example.com/v1/proxy/chat/completions');
});

test('没传开关状态时默认按开着算', () => {
  assert.equal(resolve('openai-chat', 'https://api.deepseek.com', undefined), 'https://api.deepseek.com/chat/completions');
});

test('关掉时前后空白还是要去掉', () => {
  assert.equal(resolve('openai-chat', '  https://gw.example.com/x  ', false), 'https://gw.example.com/x');
});

// ═══════════════════════ 4. 和警告行配套 ═══════════════════════

group('和 Endpoint 警告配套');

test('补全之后警告就该闭嘴', () => {
  for (const [protocol, base] of [
    ['openai-chat', 'https://api.deepseek.com'],
    ['anthropic-messages', 'https://api.deepseek.com/anthropic'],
    ['responses', 'https://api.x.ai/v1'],
  ]) {
    assert.equal(detect(protocol, complete(protocol, base)), '', `${base} 补完之后不该再报`);
  }
});

test('开关关掉时，只填域名仍然要报出来', () => {
  const message = detect('anthropic-messages', resolve('anthropic-messages', 'https://api.deepseek.com', false));
  assert.match(message, /只填了域名/);
});

await run('Endpoint 地址口径');
