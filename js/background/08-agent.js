// 提示词 Agent。按用户装载的 skill 写 NovelAI 提示词，本身不碰生成。
//
// 词典来自自动补全已经缓存的那份 danbooru 数据（chrome.storage.local['nai-ac-tags']，
// 含 post 量和中文释义），不再单独塞一份 6MB CSV 进扩展。
// 两道保险：跑之前先用中文反查预填一批已确认的 tag，跑的过程中模型还能调 search_tags 补查。

const AGENT_TAG_CACHE_KEY = 'nai-ac-tags';
const AGENT_PREFILTER_LIMIT = 40;
const AGENT_PREFILTER_MIN_POSTS = 400;
const AGENT_TOOL_RESULT_LIMIT = 8;
const AGENT_MAX_STEPS = 4;
// 快捷填入栏位的数量，不是 NovelAI 的模型上限 —— 这条得反复跟模型说清楚
const AGENT_MAX_CHARACTER_SLOTS = 6;

let agentTagIndex = null;

function storageGetLocal(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    } catch (error) {
      resolve({});
    }
  });
}

async function readAgentTagIndex() {
  if (agentTagIndex) return agentTagIndex;
  const stored = await storageGetLocal([AGENT_TAG_CACHE_KEY]);
  const raw = stored?.[AGENT_TAG_CACHE_KEY];
  const list = Array.isArray(raw) ? raw : parseJsonSafely(raw);
  agentTagIndex = Array.isArray(list) ? list : [];
  return agentTagIndex;
}

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[AGENT_TAG_CACHE_KEY]) agentTagIndex = null;
  });
} catch (error) {
  // 没有 storage 事件也不影响，只是缓存不会主动失效。
}

function normalizeTagText(text) {
  return String(text || '').toLowerCase().replace(/_/g, ' ').trim();
}

function toAgentTagEntry(item) {
  return {
    tag: item.tag,
    posts: Number(item.postCount) || 0,
    zh: String(item.translation || '').trim(),
  };
}

// 中英文都能查。分数只用来排序，不往外发 —— 模型看 post 量就够了。
function searchAgentTags(index, query, limit = AGENT_TOOL_RESULT_LIMIT) {
  const raw = String(query || '').trim();
  const q = normalizeTagText(raw);
  if (!q) return [];

  const results = [];
  for (const item of index) {
    if (!item?.tag) continue;
    const tag = normalizeTagText(item.tag);
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    let score = 0;

    if (tag === q) score = 1000;
    else if (aliases.some((alias) => normalizeTagText(alias) === q)) score = 800;
    else if (tag.startsWith(q)) score = 600;
    else if (tag.includes(q)) score = 400;
    else if (item.translation && String(item.translation).includes(raw)) score = 350;
    else if (aliases.some((alias) => normalizeTagText(alias).includes(q))) score = 200;

    if (!score) continue;
    results.push({ entry: toAgentTagEntry(item), score: score + Math.min(99, Math.log10((Number(item.postCount) || 0) + 1) * 12) });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit).map((row) => row.entry);
}

// 用户是用中文描述画面的，词典里正好有中文释义列 —— 反过来扫一遍就能拿到
// 一批「确定存在、且模型掌握得不错」的 tag，省掉模型一轮轮试探性查证。
function prefilterAgentTags(index, text, limit = AGENT_PREFILTER_LIMIT) {
  const source = String(text || '');
  if (!source.trim()) return [];

  // 英文侧用「两端加空格」的整词匹配，多词 tag（cowboy shot）也能正确命中，
  // 又不会让 art 撞进 artist。
  const haystack = ` ${source.toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

  const seen = new Set();
  const hits = [];

  for (const item of index) {
    if (!item?.tag) continue;
    if ((Number(item.postCount) || 0) < AGENT_PREFILTER_MIN_POSTS) continue;

    const key = String(item.tag).toLowerCase();
    if (seen.has(key)) continue;

    // 单字释义（"手""光"）命中率太高、噪音太大，只认两字以上。
    const zh = String(item.translation || '').trim();
    const tag = normalizeTagText(item.tag);
    const matched = (zh.length >= 2 && source.includes(zh))
      || (tag.length >= 4 && haystack.includes(` ${tag} `));

    if (!matched) continue;
    seen.add(key);
    hits.push(toAgentTagEntry(item));
  }

  return hits.sort((a, b) => b.posts - a.posts).slice(0, limit);
}

function formatAgentTagList(entries) {
  return entries
    .map((entry) => `- ${entry.tag} (${entry.posts})${entry.zh ? ` — ${entry.zh}` : ''}`)
    .join('\n');
}

const AGENT_TAG_TOOL = {
  name: 'search_tags',
  description: '在 danbooru 标准 tag 词典里查证 tag 是否存在，返回标准写法、post 量与中文释义。中英文都能查；一次可以传多个词。',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: '要查证的词，中英文皆可，一次最多 10 个',
      },
    },
    required: ['queries'],
  },
};

// skill 是按「有 shell、能 grep CSV」的环境写的，这里得把查证方式改掉，
// 否则模型会认真地输出一串 grep 命令然后卡住。
const AGENT_RUNTIME_NOTE = `【运行环境补充（优先级高于 skill 里的查证章节）】
- 本环境没有 shell，也没有 references 目录。要查证 tag 时调用 search_tags 工具，它先查本地 danbooru 词典（含 post 量与中文释义），本地没有的再实时问一次 danbooru。
- 结果里带 source: "danbooru" 的表示来自实时查询、本地词典没有；带 note 的表示这个写法已被合并，按 note 里的标准写法用。
- 不要输出 grep 命令，也不要要求用户自己去查词典。
- 下面会先给出一批本地词典已确认存在的相关 tag，可以直接用；不够再调工具补查。
- 最终回复直接给结果，不要复述流程或解释你调了什么工具。`;

// NovelAI Diffusion V5 的官方公开规则。放在这里、不写进内置 skill，理由有两条：
//   · 换成自己的 skill 时它照样生效 —— 用户手上的 skill 多半是按 V4 写的
//   · 它是官方文档里的事实，不属于任何一份 skill 的私有内容
// 冲突时以这里为准：skill 管写作风格，这里管模型的能力边界。
// 出了新版本模型这段就会过时，所以设置里留了开关（默认开）。
const AGENT_NAI5_NOTE = `【NovelAI Diffusion V5 规则核对（与 skill 冲突时以这里为准）】
- 加权只用分段语法：\`1.2::tag::\` 加强、\`0.8::tag::\` 减弱，V4.5 及更新的模型支持负权重 \`-1::tag::\`。不要用大括号或方括号。每个数字权重都必须闭合 —— 禁止裸写 \`tag::\`，也禁止不闭合的 \`1.2::tag\`。
- V5 同时吃 danbooru tag 和自然语言，可以混写。官方支持英文和日文；中文只用来理解需求、或指定要画进画面的文字，输出主体一律英文。
- 分工：主提示词管统一画面、构图、环境和人物互动；独立角色栏只管外观，作用是减少角色特征串色。
- 角色数量：V5 改进了自由角色定位，能放的角色比旧版多。**不要沿用 V4 文档里「最多六人」和 5×5 网格那套旧限制**，也不要把官方演示里出现过的人数说成硬上限。
- 画面文字：V5 能把文字画进画面。要显示的文字用双引号原样标出，并说明字体、位置和载体（招牌、书页、屏幕……）。不要自己造 \`Text:\` 区块。
- 透明是两件事，别混：整张图要透明背景 → \`transparent background\` + \`has alpha\`，需要更强时可以写 \`2.1::transparent background::\`；伞、火焰、玻璃、魔法这类**物体本身半透明、但背景要留着** → \`alpha transparency\` + \`has alpha\`。
- V5 新增的 tag：\`depthness\`、\`attractive male\`、\`low complexity\` / \`medium complexity\` / \`high complexity\` / \`ultra complexity\`、\`has alpha\`。只在跟画面直接相关时用，不要当成固定的质量尾词挂在末尾。`;

function buildAgentSystemText(skill, options = {}) {
  const parts = [];
  const body = String(skill?.body || '').trim();
  if (body) parts.push(body);

  for (const reference of Array.isArray(skill?.references) ? skill.references : []) {
    const content = String(reference?.content || '').trim();
    if (!content) continue;
    parts.push(`## 参考资料：${reference.name || 'reference'}\n\n${content}`);
  }

  parts.push(AGENT_RUNTIME_NOTE);
  if (options.nai5Rules !== false) parts.push(AGENT_NAI5_NOTE);
  return parts.join('\n\n---\n\n');
}

// 生成方式分档。措辞放在后台、前端只传档位名 —— 要改说法时不用动 UI，
// 也不会出现「按钮上写的」和「发出去的」两套文案。
const AGENT_MODES = {
  default: '按 skill 的默认方式写：tag 骨架 + 精确的自然语言；有多个角色时另外给出各自的外观栏。',
  expanded: '展开写。主提示词要讲清动作、左右站位、前后层次和角色之间的互动，另外严格输出 Character 1、Character 2… 独立角色栏。角色栏只放外貌、发型、眼睛、身体特征、服装和配饰；动作、表情、镜头、场景、背景一律留在主提示词里，不要漏进角色栏。',
  refine: '改写用户已有的提示词：整理、纠错、补齐、理顺顺序。用户已经写下的内容和数字权重要原样保留，不要擅自加画师串、质量尾词或 UC。结果之外用一两句说明你改了哪几处、各针对什么问题。',
  tags: '优先给准确、精炼的 danbooru tag，能用 tag 表达的就不要写成句子；只有人物互动或空间关系用 tag 说不清时，才补一两句自然语言。',
};

function agentModeInstruction(mode) {
  return AGENT_MODES[mode] || AGENT_MODES.default;
}

function normalizeAgentCharacterCount(value) {
  const count = Math.trunc(Number(value) || 0);
  return Math.max(0, Math.min(AGENT_MAX_CHARACTER_SLOTS, count));
}

const AGENT_CONTEXT_LIMITS = {
  prompt: 4000,
  previous: 4000,
  artists: 24,
  characters: 16,
};

function clipText(text, limit) {
  const value = String(text || '').trim();
  return value.length > limit ? `${value.slice(0, limit)}\n…（已截断）` : value;
}

// 「用户在描述里写到名字或别名 = 点名了这个角色」。
// 返回第一次出现的位置，-1 表示没提到 —— 位置后面还要拿来排 slot。
function agentNameMentionIndex(text, candidate) {
  const name = String(candidate || '').trim().toLowerCase();
  if (!name) return -1;
  const haystack = String(text || '').toLowerCase();

  // 纯 ASCII 的名字必须卡词边界，否则 ray 会命中 array、x-ray。
  // 中日文没有词边界这回事，只能直接子串。
  if (/^[a-z0-9_'-]+$/.test(name)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[^a-z0-9_'-])${escaped}([^a-z0-9_'-]|$)`).exec(haystack);
    return match ? match.index : -1;
  }

  return haystack.indexOf(name);
}

// 参考实现把 OC 单独存了一份库；我们已经有词库的 char: 分类，
// 所以只在它上面加「别名」和「被点到才发」这两条逻辑，不另起一套数据。
// slot 按名字在描述里出现的先后排 —— 用户写「A 和 B」，A 就是 Character 1。
function findMentionedAgentCharacters(characters, text) {
  const source = String(text || '');
  if (!source.trim()) return [];

  return (Array.isArray(characters) ? characters : [])
    .map((entry) => {
      const names = [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
      const positions = names.map((name) => agentNameMentionIndex(source, name)).filter((at) => at >= 0);
      return positions.length ? { entry, at: Math.min(...positions) } : null;
    })
    .filter((hit) => hit && String(hit.entry?.prompt || '').trim())
    .sort((a, b) => a.at - b.at)
    .slice(0, AGENT_MAX_CHARACTER_SLOTS)
    .map((hit, index) => ({ ...hit.entry, slot: index + 1 }));
}

function formatAgentCharacterAliases(entry) {
  const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : []).filter(Boolean);
  return aliases.length ? `（又叫 ${aliases.join('、')}）` : '';
}

// UNL 的 Agent 请求会带上画师/OC 上下文、调用方历史、以及当前的整体与分角色提示词。
// 这里照同样的思路做：知识源由用户逐项勾选，没勾的一个字都不发。
//
// 最关键的是「当前提示词」和「上一轮结果」—— 有了它们 skill 第 1.4 节的迭代规则
// （每轮只改 2~3 处、说明改了什么、不整体重写）才第一次真的能触发。
function buildAgentContextBlocks(context, mentionText) {
  if (!context || typeof context !== 'object') return [];
  const blocks = [];

  const currentPrompt = clipText(context.currentPrompt, AGENT_CONTEXT_LIMITS.prompt);
  if (currentPrompt) {
    blocks.push(`【当前提示词框里的内容】本轮是**迭代**，不是重写。按 skill 的迭代规则：每轮只改 2~3 处，说明改了哪几处、针对什么问题，其余原样保留。\n\n${currentPrompt}`);
  }

  const previous = clipText(context.previous, AGENT_CONTEXT_LIMITS.previous);
  if (previous) {
    blocks.push(`【你上一轮给出的版本】用户在此基础上提要求，同样按迭代规则改。\n\n${previous}`);
  }

  const characters = Array.isArray(context.characters) ? context.characters : [];
  const mentioned = findMentionedAgentCharacters(characters, mentionText);

  if (mentioned.length) {
    // 点到名的直接指派栏位。全库都发过去只会让模型在没提到的角色之间摇摆，
    // 也白烧 token —— 这个知识源本来就是为「点名调用」准备的。
    const lines = mentioned
      .map((item) => `- Character ${item.slot} = ${item.name}${formatAgentCharacterAliases(item)}：${clipText(item.prompt, 400)}`)
      .join('\n');
    blocks.push(`【用户点名的角色（词库里已有的设定）】描述里写到了这几个名字，就是要用这几个角色。外观串原样放进对应的角色栏，除非用户明确要求换装或改造，否则不要替换角色设计。动作、互动和背景照常留在主提示词。\n${lines}`);
  } else if (characters.length) {
    const lines = characters
      .slice(0, AGENT_CONTEXT_LIMITS.characters)
      .map((item) => `- ${item.name}${formatAgentCharacterAliases(item)}：${clipText(item.prompt, 300)}`)
      .join('\n');
    blocks.push(`【用户词库里的角色】用户点名某个角色时直接用这里的串，不要自己另编外貌。\n${lines}`);
  }

  const artists = Array.isArray(context.artists) ? context.artists.slice(0, AGENT_CONTEXT_LIMITS.artists) : [];
  if (artists.length) {
    const lines = artists
      .map((item) => `- ${item.tag}${item.name ? `（${item.name}）` : ''}${item.rating ? ` ★${item.rating}` : ''}`)
      .join('\n');
    // skill 明说画师串由用户维护、输出中不包含，所以这里只能当参考资料，不能写进结果
    blocks.push(`【用户画师库里有的画师】**默认不要写进输出** —— 画师串由用户自己维护。只有用户明确问「用我库里哪个画师」时才引用。\n${lines}`);
  }

  return blocks;
}

function buildAgentUserText(payload, prefiltered) {
  const parts = [`画面需求：\n${String(payload.request || '').trim()}`];

  parts.push(`本轮的生成方式：${agentModeInstruction(payload.mode)}`);

  const characterCount = normalizeAgentCharacterCount(payload.characterCount);
  if (characterCount) {
    parts.push(`角色栏数量：正好 ${characterCount} 个。请输出 ${characterCount} 个独立角色栏，按 Character 1 到 Character ${characterCount} 顺序排列，不多不少。（1~6 是本扩展快捷填入栏位的数量，不是 NovelAI 的模型上限。）`);
  }

  const characterPrompt = String(payload.characterPrompt || '').trim();
  if (characterPrompt) {
    parts.push(`用户当前的角色外貌串（由用户维护，除非需要改动否则不要重复输出）：\n${characterPrompt}`);
  }

  const notes = String(payload.notes || '').trim();
  if (notes) parts.push(`补充要求：\n${notes}`);

  // 点名匹配只看用户自己写的字，不看知识源 —— 否则「上一轮结果」里出现过的
  // 名字会把角色一直粘着带下去，用户换了人也甩不掉。
  parts.push(...buildAgentContextBlocks(payload.context, `${payload.request || ''}\n${payload.characterPrompt || ''}\n${payload.notes || ''}`));

  if (prefiltered.length) {
    parts.push(`本地词典已确认存在的相关 tag（tag / post 量 / 中文）：\n${formatAgentTagList(prefiltered)}`);
  }

  return parts.join('\n\n');
}

function buildAgentMessages(payload, prefiltered) {
  return [
    { role: 'system', content: buildAgentSystemText(payload.skill, { nai5Rules: payload.nai5Rules !== false }) },
    { role: 'user', content: [{ type: 'text', text: buildAgentUserText(payload, prefiltered) }] },
  ];
}

// 本地词典是快照，冷门/新增/已合并的写法都查不到 —— 而这几类正是模型最容易编错的。
// 所以本地未命中的词再问一次 danbooru，命中就带上 source 让模型知道来源。
async function executeAgentTool(call, index, options = {}) {
  if (call.name !== 'search_tags') {
    return { error: `未知工具：${call.name}` };
  }

  const queries = Array.isArray(call.arguments?.queries)
    ? call.arguments.queries.slice(0, 10)
    : [String(call.arguments?.query || '')].filter(Boolean);

  if (!queries.length) return { error: 'queries 不能为空' };

  // 显式 opt-in。这是一次发往第三方的请求，调用方没说要就不发 ——
  // 面板那边永远会带上这个标志（设置里默认开），所以实际行为不变。
  const allowRemote = options.allowDanbooruLookup === true;
  if (!index.length && !allowRemote) {
    return { error: '本地词典尚未缓存。打开一次 novelai.net 让自动补全加载词典后即可查证；这轮先按常识写，并在底部标注不确定的 tag。' };
  }

  const results = {};
  for (const query of queries) {
    const matches = index.length ? searchAgentTags(index, query) : [];
    if (matches.length) {
      results[query] = matches;
      continue;
    }

    const remote = allowRemote ? await lookupTagOnDanbooru(query) : null;
    if (!remote) {
      results[query] = 'not_found';
      continue;
    }

    results[query] = remote.status === 'alias'
      ? { note: remote.note, matches: remote.matches }
      : remote.matches;
  }
  return results;
}

async function runPromptAgent(payload, options = {}) {
  const request = String(payload?.request || '').trim();
  if (!request) {
    return { ok: false, error: '请先写清楚要画什么。', errorKind: LLM_ERROR.CONFIG, attempts: [] };
  }
  if (!String(payload?.skill?.body || '').trim()) {
    return { ok: false, error: '当前没有可用的 skill，请先在设置里装载一个。', errorKind: LLM_ERROR.CONFIG, attempts: [] };
  }

  const configs = [payload.primary, payload.fallback].filter(Boolean);
  if (!configs.length) {
    return { ok: false, error: '未提供模型配置。', errorKind: LLM_ERROR.CONFIG, attempts: [] };
  }

  const now = options.now || (() => Date.now());
  const startedAt = now();
  const index = await readAgentTagIndex();
  const prefiltered = prefilterAgentTags(index, `${request}\n${payload.notes || ''}`);
  const messages = buildAgentMessages(payload, prefiltered);
  const toolSteps = [];

  const chain = await runConfigChain(
    configs,
    (config) => runLlmToolLoop({
      // Agent 的输出比反推长得多，700 的默认额度不够写完一版提示词。
      config: { ...config, messages, maxTokens: Math.max(Number(config.maxTokens) || 0, 2000) },
      tools: [AGENT_TAG_TOOL],
      maxSteps: numberOr(payload.maxSteps, AGENT_MAX_STEPS),
      executeTool: (call) => executeAgentTool(call, index, { allowDanbooruLookup: payload.allowDanbooruLookup }),
      onStep: ({ steps }) => {
        toolSteps.length = 0;
        toolSteps.push(...steps);
      },
    }, options),
    { ...options, kind: 'agent' },
  );

  if (!chain.ok) return formatChainFailure(chain, startedAt, now);

  const result = chain.value;
  return {
    ok: true,
    text: result.text,
    providerLabel: result.providerLabel,
    usedModel: result.model,
    usedFallback: chain.index > 0,
    usage: result.usage,
    durationMs: result.durationMs,
    attempts: chain.attempts,
    prefiltered,
    toolSteps: (result.steps || []).map((step) => ({
      name: step.name,
      queries: Array.isArray(step.arguments?.queries) ? step.arguments.queries : [],
    })),
  };
}
