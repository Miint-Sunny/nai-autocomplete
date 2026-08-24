// 往网页的 Character 栏里填提示词。
//
// V5 多角色是主力场景，但我们以前只能写主提示词，角色栏得用户自己一个个粘。
//
// 只填输入框，不碰「生成」——「不要加任何触发出图的功能」那条红线在这儿也算数。

const NAI_FIELD_SELECTOR = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
const NAI_ADD_CHARACTER_PATTERN = /add\s*(a\s*)?character|添加角色|新增角色|追加角色/i;
// 角色栏最多试到 6 个：这是我们这边快捷位的数量，不是 NAI 的模型上限
const NAI_MAX_CHARACTER_SLOTS = 6;

function naiFieldSignals(element) {
  return [
    element?.id,
    element?.name,
    element?.className,
    element?.getAttribute?.('placeholder'),
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
  ].join(' ').toLowerCase();
}

function isNaiEditableField(element) {
  if (!element || !element.isConnected) return false;
  if (element.disabled || element.readOnly) return false;
  if (element.tagName === 'TEXTAREA') return true;
  if (element.tagName === 'INPUT') {
    return !['hidden', 'checkbox', 'radio', 'submit', 'button', 'range', 'file'].includes(
      String(element.type || '').toLowerCase(),
    );
  }
  return element.isContentEditable
    || element.getAttribute?.('contenteditable') === 'true'
    || element.getAttribute?.('role') === 'textbox';
}

function isNaiNegativeField(element) {
  return /negative|undesired|\buc\b|反向|负面|不希望/.test(naiFieldSignals(element));
}

// 「角色名称」不是提示词栏，得先排掉 —— 它和角色提示词栏挨在一起，签名里都有 character
function isNaiCharacterField(element) {
  if (!element) return false;
  const signals = naiFieldSignals(element);
  if (/character[-_ ]?name|角色名称|角色名/.test(signals)) return false;
  if (/character[-_ ]?prompt|char[-_ ]?caption|角色提示词|人物提示词|character\s*\d/.test(signals)) return true;

  // 站点没在字段上留签名时，退一步看它在不在角色卡片容器里
  const card = element.closest?.('[data-character-index], [data-testid*="character"], [class*="character-card"], [class*="CharacterCard"], [class*="characterPrompt"]');
  return Boolean(card) && /prompt|caption|提示词|描述/.test(signals);
}

function listNaiCharacterFields() {
  return Array.from(document.querySelectorAll(NAI_FIELD_SELECTOR))
    .filter((field) => isNaiEditableField(field) && !isNaiNegativeField(field) && isNaiCharacterField(field));
}

function findNaiAddCharacterButton() {
  return Array.from(document.querySelectorAll('button, [role="button"]')).find((button) => {
    if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') return false;
    return NAI_ADD_CHARACTER_PATTERN.test([
      button.innerText,
      button.textContent,
      button.getAttribute?.('aria-label'),
      button.getAttribute?.('title'),
    ].join(' '));
  }) || null;
}

// React 不认直接赋值给 .value —— 它记的是自己那份 state，得走原生 setter 再派 input 事件
function setNaiFieldValue(field, value) {
  field.focus?.();
  if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') {
    const prototype = field.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.setSelectionRange?.(value.length, value.length);
  } else {
    field.textContent = value;
  }
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function nextNaiFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

// 点「添加角色」补足栏位。参考实现点完只 await 一个微任务就去数，React 还没重渲染完，
// 会漏数然后误判「加不上去了」。这里等一帧再数，并且连续两轮不涨就停 —— 不能无限点。
async function ensureNaiCharacterFields(count) {
  let fields = listNaiCharacterFields();
  let stalled = 0;

  while (fields.length < count && stalled < 2) {
    const button = findNaiAddCharacterButton();
    if (!button) break;

    const before = fields.length;
    button.click();
    await nextNaiFrame();
    fields = listNaiCharacterFields();
    stalled = fields.length > before ? 0 : stalled + 1;
  }

  return fields;
}

// characters: [{ prompt, label?, slot? }]，slot 从 1 起
async function fillNaiCharacterFields(characters) {
  const desired = (Array.isArray(characters) ? characters : [])
    .map((entry, index) => ({
      slot: Math.max(1, Math.min(NAI_MAX_CHARACTER_SLOTS, Number(entry?.slot) || index + 1)),
      prompt: String(entry?.prompt || '').trim(),
    }))
    .filter((entry) => entry.prompt);

  if (!desired.length) {
    return { ok: false, filled: 0, reason: 'empty', message: '没有可以填入的角色提示词。' };
  }

  const needed = Math.max(...desired.map((entry) => entry.slot));
  const fields = await ensureNaiCharacterFields(needed);

  if (!fields.length) {
    return {
      ok: false,
      filled: 0,
      reason: 'not-found',
      message: '这个页面上没找到 Character 栏。请在 NovelAI 的出图页打开角色提示词后再试。',
    };
  }

  if (fields.length < needed) {
    return {
      ok: false,
      filled: 0,
      reason: 'too-few',
      message: `只找到 ${fields.length} 个 Character 栏，需要 ${needed} 个。请先在网页里添加到 ${needed} 个角色。`,
    };
  }

  desired.forEach((entry) => setNaiFieldValue(fields[entry.slot - 1], entry.prompt));
  return { ok: true, filled: desired.length, message: `已填入 ${desired.length} 个 Character 栏` };
}
