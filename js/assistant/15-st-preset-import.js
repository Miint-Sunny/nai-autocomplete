// SillyTavern（酒馆）预设导入。
//
// 结构对着官方 default/content/presets/openai/Default.json 核过：
//
//   prompts:      [{ identifier, name, role, content, system_prompt, marker }]
//   prompt_order: [{ character_id, order: [{ identifier, enabled }] }]
//
// 两个坑都出在「JSON 里的布尔值写成了字符串」：
//
//   * `marker: "False"` —— 字符串 "False" 本身是**真值**。照直 if 判断会把
//     enhanceDefinitions 这类「有正文、只是显式标注了自己不是占位符」的 prompt
//     整条丢掉，而且不报错，导入完只是少了几块。
//   * `system_prompt: "True"` 同理，只是它恰好不影响结果。
//
// prompt_order 里 character_id 100000 是 ST 的 dummy id（PromptManager 的
// promptOrder.strategy = 'global'、dummyId = 100000），也就是预设界面上那条全局顺序。
// 一份预设可以同时带着若干角色各自的顺序，取「第一条」会取错，得认这个 id。
//
// 占位符（chatHistory / worldInfoBefore / charDescription …）在 ST 那边是运行时
// 才填内容的槽，这边没有对应概念，导入时跳过 —— 但要如实报出来跳了哪些，
// 否则用户只会看到「导进来的比原来短」。

const ST_GLOBAL_CHARACTER_ID = 100000;

function stFlagTruthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function normalizeImportedPromptText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function getStPromptOrder(data) {
  const list = Array.isArray(data?.prompt_order) ? data.prompt_order : [];
  const usable = list.filter((entry) => entry && Array.isArray(entry.order));
  if (!usable.length) return [];
  const global = usable.find((entry) => Number(entry.character_id) === ST_GLOBAL_CHARACTER_ID);
  return (global || usable[0]).order;
}

function stPromptIdentifier(prompt, index) {
  return String(prompt?.identifier || prompt?.id || `prompt_${index}`).trim();
}

// 按 prompt_order 还原顺序；不在顺序表里的补在后面（ST 自己也是这么兜底的）。
// 关掉的条目**保留**下来并标成停用 —— 消息块编辑器本来就有启用开关，
// 直接丢掉等于把用户在酒馆里的取舍抹了。
function getOrderedPromptItemsFromStPreset(data) {
  const prompts = Array.isArray(data?.prompts)
    ? data.prompts.filter((item) => item && typeof item === 'object')
    : [];
  if (!prompts.length) return [];

  const byIdentifier = new Map();
  prompts.forEach((prompt, index) => {
    const identifier = stPromptIdentifier(prompt, index);
    if (identifier && !byIdentifier.has(identifier)) byIdentifier.set(identifier, prompt);
  });

  const ordered = [];
  const seen = new Set();

  getStPromptOrder(data).forEach((entry) => {
    const identifier = String(entry?.identifier || '').trim();
    if (!identifier || seen.has(identifier)) return;
    const prompt = byIdentifier.get(identifier);
    if (!prompt) return;
    seen.add(identifier);
    ordered.push({ prompt, enabled: entry?.enabled !== false && prompt?.enabled !== false });
  });

  prompts.forEach((prompt, index) => {
    const identifier = stPromptIdentifier(prompt, index);
    if (identifier && seen.has(identifier)) return;
    if (identifier) seen.add(identifier);
    ordered.push({ prompt, enabled: prompt?.enabled !== false });
  });

  return ordered;
}

// 没写 role 的一律当 system —— 酒馆那边不带 role 的 prompt 就是系统提示词，
// system_prompt 这个字段只是它在界面上的分组标记，不改变身份。
function readStPromptRole(prompt) {
  const explicit = String(prompt?.role || '').trim().toLowerCase();
  if (explicit === 'system' || explicit === 'user' || explicit === 'assistant') return explicit;
  return 'system';
}

function stPromptLabel(prompt, index) {
  return String(prompt?.name || prompt?.identifier || '').trim() || `第 ${index + 1} 条`;
}

// 反推链路靠 {{booru_tags}} 把标签塞进去，酒馆预设里当然没有这个变量。
// 缺了它导入完就是个不会读图的预设，所以补在最后一条启用的 user 块后面。
function ensureBooruVariable(blocks) {
  if (blocks.some((block) => block.enabled && block.content.includes('{{booru_tags}}'))) return false;

  const lastUserBlock = [...blocks].reverse().find((block) => block.role === 'user' && block.enabled);
  if (lastUserBlock) {
    lastUserBlock.content = `${lastUserBlock.content}\n\n{{booru_tags}}`;
  } else {
    blocks.push({ id: generateBlockId(), role: 'user', content: '{{booru_tags}}', enabled: true });
  }
  return true;
}

function getStPresetName(data) {
  return String(data?.name || data?.id || '').trim() || 'ST 导入';
}

// 解析和落库分开：导入盒子要先把「会得到什么」讲清楚，用户点了导入才真写进去。
function analyzeStPreset(data) {
  const ordered = getOrderedPromptItemsFromStPreset(data);
  if (!ordered.length) throw new Error(T.statusStPresetImportFailed);

  const blocks = [];
  const skipped = [];

  ordered.forEach(({ prompt, enabled }, index) => {
    const content = normalizeImportedPromptText(prompt?.content);
    if (stFlagTruthy(prompt?.marker) || !content) {
      skipped.push(stPromptLabel(prompt, index));
      return;
    }
    blocks.push({
      id: generateBlockId(),
      role: readStPromptRole(prompt),
      content,
      enabled,
    });
  });

  if (!blocks.length) throw new Error(T.statusStPresetImportFailed);

  const addedBooruVar = ensureBooruVariable(blocks);
  return { name: getStPresetName(data), blocks, skipped, addedBooruVar };
}

function convertStPresetToBlocks(data) {
  return analyzeStPreset(data).blocks;
}

async function applyImportedStPreset(preset) {
  state.settings.activePresetId = preset.id;
  if (ui.settings.activePresetId) ui.settings.activePresetId.value = preset.id;
  if (ui.wb?.presetId) ui.wb.presetId.value = preset.id;
  renderPresetSelector();
  renderWorkbenchPresetSelector();
  renderPresetEditor('settings');
  renderPresetEditor('workbench');
  updateRoleSectionVisibility();
  updateWorkbenchRoleSectionVisibility();

  const presetsSaved = await saveCustomPresets();
  if (!presetsSaved) {
    setStatus(T.statusContextInvalidated, true);
    return false;
  }

  const settingsSaved = await storageSet({ [SETTINGS_KEY]: state.settings });
  if (!settingsSaved) {
    setStatus(T.statusContextInvalidated, true);
    return false;
  }

  return true;
}

function importStPresetObject(data) {
  const analysis = analyzeStPreset(data);
  const preset = {
    id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: analysis.name,
    builtIn: false,
    blocks: analysis.blocks,
  };
  state.customPresets.push(normalizePreset(preset));
  return { preset, analysis };
}

// ── 导入盒子用的两个钩子 ────────────────────────────────────────

function describeStPresetImport(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, summary: '' };

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, summary: `不是合法的 JSON：${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    const analysis = analyzeStPreset(data);
    const enabled = analysis.blocks.filter((block) => block.enabled).length;
    const parts = [`「${analysis.name}」→ ${analysis.blocks.length} 个消息块（启用 ${enabled} 个）`];
    if (analysis.skipped.length) {
      parts.push(`跳过 ${analysis.skipped.length} 个没有正文的占位符：${analysis.skipped.slice(0, 6).join('、')}${analysis.skipped.length > 6 ? '…' : ''}`);
    }
    if (analysis.addedBooruVar) parts.push('已自动补上 {{booru_tags}}');
    return { ok: true, summary: parts.join(' · ') };
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : String(error) };
  }
}

async function commitStPresetImport(text) {
  if (!ensureExtensionContext()) throw new Error(T.statusContextInvalidated);

  const data = JSON.parse(String(text || '').trim());
  const { preset, analysis } = importStPresetObject(data);
  const applied = await applyImportedStPreset(preset);
  if (!applied) throw new Error(T.statusContextInvalidated);

  const extra = analysis.skipped.length ? `，跳过 ${analysis.skipped.length} 个占位符` : '';
  return `已导入并套用「${preset.name}」：${analysis.blocks.length} 个消息块${extra}。`;
}
