
const SETTINGS_KEY = 'nai-llm-assistant-settings';
const HISTORY_KEY = 'nai-llm-reverse-history';
const PANEL_LAYOUT_KEY = 'nai-llm-panel-layout';
const FAB_POSITION_KEY = 'nai-fab-position';
const DRAWER_LAYOUT_KEY = 'nai-llm-drawer-layout';
const PROMPT_LIBRARY_KEY = 'nai-shared-prompt-library';
const AGENT_CONVERSATION_KEY = 'nai-agent-conversation';
const ROLE_LIBRARY_CATEGORY = 'char';
const PROMPT_LIBRARY_CATEGORIES = [
  { id: 'char', label: '角色' },
  { id: 'style', label: '风格' },
  { id: 'scene', label: '场景' },
  { id: 'outfit', label: '服装' },
  { id: 'pose', label: '动作' },
];
const MAX_HISTORY = 30;
const PANEL_MARGIN = 20;
const PANEL_MIN_WIDTH = 400;
const PANEL_MIN_HEIGHT = 260;
const DRAWER_MIN_WIDTH = 480;

const T = {
  title: 'NAI Autocomplete',
  fab: 'NAI',
  tabLibrary: '词库',
  tabReverse: '反推',
  tabHistory: '历史',
  tabSettings: '设置',
  quickHint: '快捷键：',
  pick: '手动选图',
  openImageFile: '打开图片',
  reverseCopy: '反推并复制',
  copyResult: '复制结果',
  previewEmpty: '尚未锁定图片',
  resultLabel: '反推结果（自动复制到剪切板）',
  resultPlaceholder: '反推结果会显示在这里',
  clearHistory: '清空历史',
  noHistory: '暂无历史记录',
  copy: '复制',
  load: '加载',
  serviceProvider: '服务商预设',
  protocol: '接口协议',
  model: '模型',
  systemPrompt: '系统提示词',
  reversePrompt: '反推指令（反推页不再单独输入）',
  roleMode: '替换角色模式',
  roleSystemPrompt: '角色模式系统提示词',
  roleReversePrompt: '角色模式反推指令',
  rolePrompt: '目标角色提示词',
  roleLibrary: '词库角色',
  roleLibraryPlaceholder: '选择已保存的 char: 角色词库',
  applyRoleLibrary: '套用到角色提示词',
  sectionAppearance: '外观',
  sectionAppearanceHint: '颜色与面板行为',
  sectionProvider: 'LLM 服务',
  sectionProviderHint: '模型、Endpoint 与连接检查',
  sectionPrompt: '提示词',
  sectionPromptHint: '反推逻辑与角色替换',
  sectionSampling: '生成参数',
  sectionSamplingHint: '采样与思考强度',
  sectionBehavior: '发送与输出',
  sectionBehaviorHint: '图片发送方式与输出行为',
  sectionFallback: '备用模型',
  sectionFallbackHint: '主模型失败后的兀底路由',
  defaultCodeFence: '默认代码框输出',
  wrapCodeButton: '包裹代码框',
  fetchModels: '获取模型',
  testConnection: '测试连接',
  fallbackMode: '启用备用模型（主模型失败时自动重试）',
  fallbackProvider: '备用服务商预设',
  fallbackProtocol: '备用接口协议',
  fallbackEndpoint: '备用 API Endpoint',
  fallbackModel: '备用模型',
  fallbackApiKey: '备用 API Key（按供应商保存）',
  themePreset: '颜色预设',
  agentFillCharacter: '填入 Character',
  agentFillAll: '全部填入',
  allowDanbooruLookup: '本地词典查不到时问一下 danbooru',
  autoCompleteEndpoint: 'Endpoint 只填到 base URL 就行',
  autoCompleteEndpointHint: '开着的话，Endpoint 填 https://api.deepseek.com 这种半截地址也能用 —— 按接口协议自动补上 /chat/completions、/v1/messages 之类的路径（各家 SDK 和酒馆都是这个口径）。自建网关认死了某个怪路径的话就关掉它，填什么就发什么。',
  allowDanbooruLookupHint: '本地词典是快照，冷门 tag、新 tag、以及已经被合并掉的旧写法都查不到 \u2014\u2014 而这几类正是模型最容易编错的。只在本地未命中时发一次请求，只传 tag 名。如果你开着 danbooru 标签页，会优先借它的登录态。',
  agentNai5Rules: '给写词附带目标版本的规则核对',
  agentNai5RulesHint: '按「提示词格式」选的版本，把对应的官方规则（权重语法、主提示词与角色栏分工、画面文字、透明等）追在 skill 末尾，换成你自己的 skill 也照样生效。skill 已经写全、或出了新版本模型，就关掉它。',
  preferNaiMetadata: 'NAI 原图优先本地读取（不调模型）',
  preferNaiMetadataHint: 'NAI 生成的图把提示词写在 PNG 文本块或 alpha 通道隐写里。读到就直接用：零成本、不上传、逐字准确；读不到自动回退到模型反推。',
  statusNaiMetadata: '已从 NAI 原图直读提示词，没有调用模型',
  sendImageAsDataUrl: '发送图片内容（关闭则发送原始 URL）',
  enableBooruTagContext: '附加网站标签上下文（Danbooru / Gelbooru）',
  showReverseEntry: '显示反推悬浮入口',
  showWorkbenchEntry: '在 NovelAI 出图页显示悬浮入口',
  showExternalEntry: '在其他网站显示反推悬浮入口',
  showExternalEntryHint: '悬浮球开的是悬浮窗（反推 / 写词 / 改词 / 画师 / 历史 / 设置）；工作台走浏览器扩展图标，只在 novelai.net 出图页有。其他网站默认不显示悬浮球，点扩展图标一样能开悬浮窗。',
  tabArtists: '画师库',
  artistQuickManage: '管理',
  artistQuickHint: '点卡片或 ＋ 追加到提示词；\ud83d\udccb 只复制',
  artistQuickModeArtists: '画师',
  artistQuickModeStrings: '画师串',
  artistQuickAllRatings: '全部星级',
  artistQuickInserted: '已追加到提示词 \u2713',
  artistQuickCopied: '已复制 \u2713',
  artistQuickCopyFailed: '复制失败，请手动复制',
  artistQuickCopiedNoField: '未找到提示词框，已复制到剪贴板',
  artistQuickNoTag: '这条记录没有可用的 tag',
  artistQuickOpenFailed: '打开画师库失败，请重新加载扩展',
  glassEffect: '毛玻璃效果',
  glassEffectHint: '面板、抽屉、弹窗与输入框使用半透明毛玻璃；关闭后改为实心背景。',
  glassStrength: '玻璃强度',
  reasoningEffort: '思考模式',
  fallbackReasoningEffort: '备用模型思考模式',
  reasoningHint: '反推任务通常不需要长思考。DeepSeek V4 默认开启且为高档，选「关闭」会显式关掉。',
  cancelRun: '取消',
  tabFlow: '改词',
  tabArtistsShort: '画师',
  sendToFlow: '送去改词',
  flowEmptyHint: '空的。点「读取输入框」把当前提示词拉进来，或者从反推 / 写词把结果送过来。',
  statusFlowEmpty: '当前流是空的。',
  statusFlowNoField: '这个页面上没找到提示词输入框。',
  statusFlowSourceEmpty: '输入框里没有内容。',
  statusFlowLoaded: '已读取输入框内容。',
  statusFlowReceived: '已送进改词页，可以逐个 tag 调了。',
  tabAgent: '写词',
  agentSkillLabel: 'skill',
  agentManage: 'skill',
  agentModeDefault: '默认',
  agentModeExpanded: '展开',
  agentModeRefine: '改写',
  agentModeTags: '精简',
  agentModeHintDefault: '锚定 tag 定住主体与风格，自然语言讲清动作与互动，混写。',
  agentModeHintExpanded: '主提示词用自然语言讲透动作、站位与互动，另外严格输出 Character 1、2… 独立角色栏。',
  agentModeHintRefine: '整理、纠错、补齐你现有的提示词，原样保留你写下的内容和权重。',
  agentModeHintTags: '优先给准确精炼的 danbooru tag，说不清的关系才补一句自然语言。',
  agentModeHintDefaultV45: '输出以查证过的 danbooru tag 为主，自然语言只补 tag 说不清的关系。',
  agentModeHintExpandedV45: '主提示词用精确 tag 交代构图与互动，另给 Character 1、2… 独立角色栏（最多 6 个）。',
  agentModeHintRefineV45: '整理、纠错、补齐你现有的提示词，并把不合 danbooru 标准的写法修正。',
  agentModeHintTagsV45: '只输出查证过的 danbooru tag，不写句子。',
  agentModeLabel: '生成方式',
  agentCountLabel: '角色栏',
  agentCountAuto: '自动',
  statusAgentRefineNeedsPrompt: '已切到改写档，并自动带上「当前提示词」。改写的是输入框里的现值。',
  agentRequestLabel: '画面需求',
  agentRequestPlaceholder: '用中文描述想要的画面，例如：雨夜里，一个穿校服的女孩撑着透明伞站在便利店门口，暖光从店里透出来',
  agentThreadEmpty: '描述画面后发送；结果不自动填入，用每块上的按钮写进输入框。',
  agentRun: '发送',
  agentClear: '清空',
  agentCopy: '复制',
  agentWrite: '填入',
  agentAppend: '追加',
  agentBlockMain: '主提示词',
  agentBlockCharacter: '角色外貌',
  agentBlockOther: '代码块',
  agentPromptWritten: '已写入提示词框 ✓',
  agentImport: '导入',
  agentExport: '导出',
  agentEdit: '编辑正文',
  agentSave: '保存',
  agentCancelEdit: '取消编辑',
  agentDelete: '删除',
  agentBuiltinBadge: '内置',
  agentBuiltinNote: '内置 skill 只读。保存修改会自动另存为你自己的一份并切换过去，内置那份始终保留。',
  agentSkillRefs: '参考资料：',
  agentNoSkillRefs: '没有参考资料',
  agentSourcesLabel: '知识源',
  agentSourceCurrentPrompt: '当前提示词',
  agentSourceCharacters: '词库角色',
  agentSourceArtists: '画师库',
  agentSourcesHint: '勾上的才会发给模型；对话本身自动带上，模型看得见自己上一轮的版本。「当前提示词」把输入框现值当成迭代基准。',
  naiDialectLabel: '提示词格式',
  naiDialectV5: 'NAI V5（锚定词 + 自然语言）',
  naiDialectV45: 'NAI V4.5（tag 为主 / danbooru 查证）',
  naiDialectHint: 'V5 是混写：锚定的 danbooru tag + 自然语言句子。V4.5 回到纯 tag 路线：danbooru 查证优先，自然语言只作补充。写词的档位措辞、附带的规则核对和内置反推预设会跟着切。',
  statusAgentRunning: '正在按 skill 写提示词...',
  statusAgentDone: '写完了。用回复里的按钮填入或复制。',
  statusAgentTruncated: '输出被 max_tokens 截断了，这一版没写完 —— 去设置里把 Max Tokens 调大，或把思考模式调低（思考过程也吃这个额度）。',
  agentMetaTruncated: '⚠ 被 max_tokens 截断',
  statusAgentNeedRequest: '请先描述要画的画面。',
  statusAgentCancelled: '已取消本次写作。',
  saveSettings: '保存设置',
  statusNeedImage: '请先通过快捷键或手动选图锁定图片。',
  statusNeedKey: '未配置 API Key，请切换到设置页保存配置。',
  statusNeedPrompt: '请先在设置页填写反推指令。',
  statusNeedRolePrompt: '已开启替换角色模式，请在设置页填写目标角色提示词。',
  statusRunning: '正在请求模型反推...',
  statusCancelling: '正在取消...',
  statusCancelled: '已取消本次反推。',
  statusRunningFallback: '主模型请求失败，正在切换到备用模型...',
  statusDoneCopied: '反推完成，已复制到剪切板。',
  statusDoneNotCopied: '反推完成，但自动复制失败。',
  statusDoneCopiedFallback: '主模型失败，已自动切换到备用模型并复制到剪切板。',
  statusDoneNotCopiedFallback: '主模型失败，已自动切换到备用模型，但自动复制失败。',
  statusSelectMode: '选图模式：点击一张图片，按 Esc 取消。',
  statusSelectCanceled: '已取消选图模式。',
  statusImageLocked: '图片已锁定。',
  statusSaved: '设置已保存。',
  statusHistoryCleared: '历史记录已清空。',
  statusCopied: '已复制结果。',
  statusCopyFailed: '暂无可复制结果或复制失败。',
  statusLoadedHistory: '已加载历史结果。',
  statusWrapped: '已将结果包裹为代码框。',
  statusNoResult: '暂无可包裹的结果。',
  statusRoleLibraryApplied: '已将词库角色套用到角色提示词。',
  statusRoleLibraryMissing: '请先选择一个词库角色。',
  statusTestingConnection: '正在测试连接...',
  statusNeedFallbackConfig: '已启用备用模型，请先完整配置备用服务商、Endpoint、Model 和 API Key。',
  statusContextInvalidated: '扩展已更新，请刷新当前页面后重试。',
  statusLibraryReady: '词库就绪，保存后会尝试同步到官方 Prompt Chunk。',
  statusLibrarySaved: '词库已保存，正在同步到官方 Prompt Chunk...',
  statusLibraryDeleted: '词库条目已删除。',
  statusLibrarySynced: '已同步到官方 Prompt Chunk。',
  statusLibrarySyncFailed: '本地词库已保留，但官方 Prompt Chunk 同步失败：',
  statusLibraryInvalid: '请填写分类、名称和提示词内容。',
  importStPreset: '导入酒馆预设',
  statusStPresetImportFailed: '导入 SillyTavern 预设失败：文件结构不符合预期或缺少 prompts。',
};

const DEFAULT_SETTINGS = {
  providerPreset: 'openai',
  protocol: 'openai-chat',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-mini',
  apiKey: '',
  providerConnections: {},
  systemPrompt: `You are an anime-style image-to-prompt converter for a platform that
supports structured multi-character prompts.

\u2550\u2550\u2550 OUTPUT FORMAT \u2550\u2550\u2550

Single character:
Output one single-line prompt. No separators.

Multiple characters:
Output using pipe syntax:
{base prompt} | {character 1 prompt} | {character 2 prompt} | ...

Base prompt contains: framing, shot type, camera angle,
background/setting, lighting, atmosphere, color scheme,
and any shared scene elements.

Each character prompt contains: that character's appearance
(hair, eyes, expression), outfit (top to bottom), pose,
and any interaction tags specific to them.

Character order: describe characters from left to right,
or foreground to background.

\u2550\u2550\u2550 INTERACTION TAG SYNTAX \u2550\u2550\u2550

When characters physically or visually interact, attach a directional
prefix to the relevant action tag to indicate the role of each character
in that action.

The prefix indicates ACTION DIRECTION, not character identity or gender.
There are exactly three valid prefixes - no others are permitted:

source#{action}  - this character is performing / initiating the action
target#{action}  - this character is receiving the action
mutual#{action}  - both characters perform the action on each other

Usage:
One hugging the other:   char1: source#hug     |  char2: target#hug
Mutual hug:              char1: mutual#hug     |  char2: mutual#hug
Eye contact:             char1: mutual#eye_contact | char2: mutual#eye_contact
Grabbing collar:         char1: source#grabbing_collar
                         char2: target#grabbing_collar

CRITICAL:
- The prefix describes WHO IS DOING THE ACTION, not who the character is.
- Do NOT use gender, role, or identity as prefixes.
- The only valid prefixes are: source#, target#, mutual#
- Invalid examples (never output these):
    female#hug, male#hug, girl#hug, char1#hug, left#hug, A#hug

\u2550\u2550\u2550 TAG ORDER (per segment) \u2550\u2550\u2550

Base prompt:
[shot type / framing] -> [character count] -> [setting/background] ->
[lighting direction + quality] -> [dominant color atmosphere]

Per character:
[hair color, length, style] -> [eye color] -> [expression] ->
[outfit top to bottom] -> [pose / body orientation] ->
[interaction tags] -> [accessories / props]

\u2550\u2550\u2550 NATURAL LANGUAGE RULES \u2550\u2550\u2550

Use natural language phrases ONLY for:
- Complex limb placement where tag order is ambiguous
  e.g., "right arm extended forward, left hand on hip"
- Spatial depth or overlap between characters or objects
- Lighting gradient or color direction
  e.g., "warm rim light from the left"

If an element is unclear or partially visible, qualify it:
e.g., "partially visible skirt", "possible earring"
Never invent or assert unclear elements.

\u2550\u2550\u2550 PRIORITY ORDER \u2550\u2550\u2550

1. Composition, framing, crop, camera angle, perspective
2. Number of characters, their relative positions (left/right,
 foreground/background), and physical interactions
3. Pose, gesture, limb placement, body orientation (per character)
4. Lighting direction, dominant colors, color relationships
5. Core character traits: hair, eyes, expression
6. Outfit structure, silhouette, layering
7. Accessories, props, background details, art style if distinctive

\u2550\u2550\u2550 STRICT PROHIBITIONS \u2550\u2550\u2550

- Do not output quality tags or quality-related words.
- Do not output explanations, titles, labels, bullet points,
JSON, or multiple versions.
- Do not invent props, clothing parts, or effects not clearly visible.
- Do not mix pipe syntax with any label or structural text
outside the segments.
- Do not use the pipe character | for any purpose other than
separating base/character segments.`,
  reversePrompt: `Analyze this image and output a structured English prompt for
anime-style image generation.

Step through internally before writing:
1. Count characters and identify their positions and interactions.
2. If multiple characters: plan base prompt vs. per-character split.
3. Identify all physical/visual interactions between characters
 and assign source#, target#, or mutual# prefixes to action tags.
4. Work through priority order: composition -> character positions
 -> poses -> lighting/color -> appearance -> outfit -> details.

Output format:
- Single character: one clean single-line prompt.
- Multiple characters: base | char1 | char2 | ... (pipe-separated,
no labels, no extra text)

Output only the final prompt. Nothing else.`,
  enableRoleReplaceMode: false,
  roleSystemPrompt: `You are an anime-style image-to-prompt converter specialized in
character-swap reconstruction.

Your task:
1. Accurately reconstruct the original image structure.
2. Replace only the specified character(s) with the target character(s),
 while preserving all non-identity visual information as faithfully
 as possible.
Output only the final prompt. No explanations, titles, JSON, labels,
bullet points, quality tags, or multiple versions.

\u2550\u2550\u2550 OUTPUT FORMAT \u2550\u2550\u2550

Single character:
Output one single-line prompt.

Multiple characters:
Output using pipe syntax:
{base prompt} | {character 1 prompt} | {character 2 prompt} | ...

Base prompt: framing, shot type, camera angle, background/setting,
lighting, atmosphere, color scheme, shared scene elements.

Each character prompt: that character's appearance, outfit, pose,
and interaction tags. Characters ordered left to right, or
foreground to background.

If only some characters are being swapped, non-swapped characters
are reconstructed as-is. Only the specified character slots receive
the target character's identity traits.

\u2550\u2550\u2550 INTERACTION TAG SYNTAX \u2550\u2550\u2550

When characters physically or visually interact, attach a directional
prefix to the relevant action tag to indicate the role of each character
in that action.

The prefix indicates ACTION DIRECTION, not character identity or gender.
There are exactly three valid prefixes - no others are permitted:

source#{action}  - this character is performing / initiating the action
target#{action}  - this character is receiving the action
mutual#{action}  - both characters perform the action on each other

Usage:
One hugging the other:   char1: source#hug     |  char2: target#hug
Mutual hug:              char1: mutual#hug     |  char2: mutual#hug
Eye contact:             char1: mutual#eye_contact | char2: mutual#eye_contact
Grabbing collar:         char1: source#grabbing_collar
                         char2: target#grabbing_collar

CRITICAL:
- The prefix describes WHO IS DOING THE ACTION, not who the character is.
- Do NOT use gender, role, or identity as prefixes.
- The only valid prefixes are: source#, target#, mutual#
- Invalid examples (never output these):
    female#hug, male#hug, girl#hug, char1#hug, left#hug, A#hug

\u2550\u2550\u2550 SWAP BOUNDARY RULES \u2550\u2550\u2550

REPLACE (identity layer - swap these):
- Hair color, length, and style
- Eye color
- Facial features and expression style
- Character-exclusive signature accessories
  (e.g., unique hair ornaments, iconic props)

PRESERVE (structure layer - do not change these):
- Pose, gesture, limb placement, body orientation
- Composition, framing, crop, camera angle, perspective
- Lighting direction, dominant colors, atmosphere
- Clothing structure and silhouette
  (keep original clothing unless it directly conflicts with
  the target character's identity; if conflict exists,
  adjust the minimum necessary - do not redesign the outfit)
- Background, environment, scene elements
- Number of characters and their relative positions
- Interaction structure and roles between characters

When original clothing conflicts with the target character:
Prioritize pose, composition, and color logic.
Adjust only the minimum identity-critical elements.
Do not redesign the image around the target character.

\u2550\u2550\u2550 TAG ORDER (per segment) \u2550\u2550\u2550

Base prompt:
[shot type / framing] -> [character count] -> [setting/background] ->
[lighting direction + quality] -> [dominant color atmosphere]

Per character:
[hair color, length, style] -> [eye color] -> [expression] ->
[outfit top to bottom] -> [pose / body orientation] ->
[interaction tags] -> [accessories / props]

\u2550\u2550\u2550 PRIORITY ORDER \u2550\u2550\u2550

1. Overall composition, framing, crop, camera angle, perspective
2. Number of characters, relative positions, and interaction structure
3. Pose, gesture, limb placement, body orientation (per character)
4. Lighting direction, dominant colors, color relationships
5. Clothing structure, silhouette, layering, accessory placement
6. Target character identity and defining traits
7. Smaller visual details

\u2550\u2550\u2550 NATURAL LANGUAGE RULES \u2550\u2550\u2550

Use natural language ONLY for:
- Complex limb placement where tag order is ambiguous
- Spatial depth or overlap between characters or objects
- Lighting gradient or color direction
- Multi-character spatial relationships

If an element is unclear or partially visible, qualify it:
e.g., "partially visible skirt", "possible earring"
Never invent or assert unclear elements.

\u2550\u2550\u2550 STRICT PROHIBITIONS \u2550\u2550\u2550

- Do not redesign the image around the target character.
- Do not invent new poses, actions, props, clothing pieces,
background elements, or color schemes.
- Do not simplify critical pose or composition info into vague tags.
- Do not output quality tags or quality-related words.
- Do not use | for any purpose other than segment separation.`,
  roleReversePrompt: `Analyze this image and output a structured English prompt for
anime-style image generation with character swap.

Work through these steps internally before writing:

1. Reconstruct the original image structure:
 composition, framing, camera angle, character count and positions,
 poses and interactions, lighting, color scheme, clothing, background.

2. Identify which character(s) to replace and which to preserve.
 Determine each character's interaction role (source / target / mutual)
 and preserve those roles exactly.

3. Apply the target character's identity only to the specified slot(s):
 replace hair, eyes, and identity-exclusive traits.
 Keep all structural elements - pose, clothing silhouette,
 lighting, composition - unchanged.
 If clothing conflicts with the target character's identity,
 adjust the minimum necessary; do not redesign.

4. Choose output format:
 - Single character -> one clean single-line prompt.
 - Multiple characters -> base | char1 | char2 | ...
   (pipe-separated, no labels, no extra text)

Output only the final prompt. Nothing else.`,
  rolePrompt: '',
  defaultCodeFence: false,
  temperature: 0.4,
  maxTokens: 700,
  reasoningEffort: 'off',
  fallbackReasoningEffort: 'off',
  enableFallbackModel: false,
  fallbackProviderPreset: 'xai-responses',
  fallbackProtocol: 'responses',
  fallbackEndpoint: 'https://api.x.ai/v1/responses',
  fallbackModel: 'grok-4-fast-reasoning',
  fallbackApiKey: '',
  fallbackProviderConnections: {},
  themePreset: 'novelai',
  preferNaiMetadata: true,
  allowDanbooruLookup: true,
  autoCompleteEndpoint: true,
  agentNai5Rules: true,
  naiDialect: 'v5',
  sendImageAsDataUrl: true,
  enableBooruTagContext: false,
  activePresetId: 'nai-v5',
  booruTagTypes: { artist: true, character: true, copyright: true, general: true, meta: false },
  showReverseFloatingBall: true,
  showWorkbenchFloatingBall: true,
  showExternalFloatingBall: false,
  glassEffect: true,
  glassStrength: 100,
};



const PROTOCOL_OPTIONS = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions' },
  { id: 'responses', label: 'Responses API' },
  { id: 'anthropic-messages', label: 'Anthropic Messages API' },
];

const PROVIDER_PRESETS = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-chat', endpoint: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openai/gpt-4.1-mini' },
  { id: 'xai-chat', label: 'xAI (Chat Completions)', protocol: 'openai-chat', endpoint: 'https://api.x.ai/v1/chat/completions', defaultModel: 'grok-4' },
  { id: 'xai-responses', label: 'xAI (Responses API)', protocol: 'responses', endpoint: 'https://api.x.ai/v1/responses', defaultModel: 'grok-4-fast-reasoning' },
  { id: 'gemini-openai', label: 'Google Gemini (OpenAI兼容)', protocol: 'openai-chat', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-2.5-flash' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', endpoint: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-v4-flash-vision-exp' },
  { id: 'vertex-openai', label: 'Google Vertex AI (OpenAI兼容)', protocol: 'openai-chat', endpoint: 'https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/endpoints/openapi/chat/completions', defaultModel: 'google/gemini-3.5-flash' },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-sonnet-5' },
  { id: 'custom', label: '自定义', protocol: 'openai-chat', endpoint: '', defaultModel: '' },
];
const NAI_DIALECT_OPTIONS = [
  { id: 'v5', label: T.naiDialectV5 },
  { id: 'v45', label: T.naiDialectV45 },
];

const REASONING_EFFORTS = [
  { id: 'off', label: '关闭' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
];

const THEME_PRESETS = [
  { id: 'novelai', label: '星海鎏金' },
  { id: 'sunrise', label: '日照奶油' },
  { id: 'porcelain', label: '瓷蓝雾白' },
  { id: 'matcha', label: '抹茶织纯' },
  { id: 'rose', label: '蔗薇细沙' },
  { id: 'ember', label: '余烬暮棕' },
  { id: 'midnight', label: '深海夜蓝' },
  { id: 'moss', label: '青苔幽夜' },
  { id: 'liquid-light', label: '流光玻璃 \u00b7 浅' },
  { id: 'liquid-dark', label: '流光玻璃 \u00b7 深' },
];
const LEGACY_DEFAULT_PROMPTS = {
  systemPrompt: [
    '你是图像反推助手。请分析图片并给出高质量标签，以及一条可直接用于生成的精简提示词。',
    '你是 NovelAI 图像反推助手。任务是将图像内容转换为可直接用于 NovelAI 生图的 Danbooru 风格提示词。请严格使用英文 tag，尽量接近 Danbooru 常用写法，多词 tag 使用下划线，各 tag 之间用英文逗号+空格分隔。不要写解释，不要写自然语言段落，不要输出 JSON 或 Markdown 标题。若无法确认的细节，宁可省略也不要臆造。',
    '你是 NovelAI 图像提示词反推专家，专精 V4+ 动漫风格生成模型。当用户提供图像时，只输出单个纯英文、NovelAI-ready 的 prompt 本体，不要解释，不要标题，不要 TAGS，不要 PROMPT，不要 JSON，不要代码块外的任何文字。提示词必须尽量使用 Danbooru 风格 tag，多词 tag 使用下划线，同时允许少量自然语言短语增强场景一致性。绝对不要添加 masterpiece, best quality, very aesthetic, absurdres, highly detailed 等质量增强词，也不要输出 negative prompt。',
  ],
  reversePrompt: [
    '请反推这张图，输出：1) 关键标签 2) 一条可直接使用的最终提示词。',
    '请分析这张图，并严格按照以下格式输出：\\nTAGS: <一行英文 Danbooru tags，逗号分隔，可包含 1girl/1boy，hair，eyes，clothes，pose，composition，background，style，quality 等标签>\\nPROMPT: <一行可直接用于 NovelAI 的最终 prompt，仍然全部使用英文 Danbooru tags，按主体 -> 外观 -> 服装 -> 动作 -> 镜头/构图 -> 场景 -> 画风/画质 排序>\\n要求：优先使用 NovelAI 常用标签，避免冗余重复 tag，不要输出 negative prompt，不要附加额外说明。',
    '请将这张图反推为可直接用于 NovelAI 的单个英文 prompt，只输出 prompt 本体，不要任何额外文字。顺序必须优先为：整体场景/构图/人数/灯光 -> 角色核心特征（越重要越靠前）。单角色时请用换行分为 3-4 层：第 1 行写 scene/composition/人数，第 2 行写发色/发型/瞳色/肄体/特征，第 3 行写服装与配饰，第 4 行写动作/表情/场景/光影/镜头。多角色（2-6人）时必须使用 NovelAI V4+ 的 | 分隔结构，整个 prompt 以最后一个 | 结尾。可混合 Danbooru 精确 tag 和短句，但不要出现任何 tag 以外的标题词。',
  ],
  roleSystemPrompt: [
    '你是角色替换反推助手。请基于图像内容生成标签与提示词，并将角色替换为目标角色设定。',
    '你是 NovelAI 角色替换反推助手。你需要先识别图像的构图、姿势、服装层级、镜头、场景、氛围与画风，再将人物替换为目标角色。输出必须是可直接用于 NovelAI 的英文 Danbooru tags，不要解释，不要自然语言段落，不要保留原角色的身份名称。',
    '你是 NovelAI 角色替换反推专家。你需要保留原图的构图、动作、镜头、服装层级、场景、光影、氛围与画风，只将人物替换为目标角色设定。最终只输出单个纯英文 NovelAI-ready prompt 本体，不要解释，不要 TAGS，不要 PROMPT，不要 JSON，不要 negative prompt，不要保留原角色名称。',
  ],
  roleReversePrompt: [
    '请先分析图像，然后输出：1) 高质量生图标签 2) 一条已完成角色替换的最终提示词。',
    '请分析这张图，保持原图的 pose、composition、camera angle、clothing structure、scene、lighting、mood 与 style，但将人物替换为目标角色设定。严格按照以下格式输出：\\nTAGS: <一行英文 Danbooru tags，逗号分隔，已完成角色替换>\\nPROMPT: <一行可直接用于 NovelAI 的最终 prompt，仍然全部使用英文 Danbooru tags，优先保留原图的视觉要素>\\n要求：不要保留原角色姓名，不要输出解释，不要输出 negative prompt。',
    '请将这张图反推为可直接用于 NovelAI 的单个英文 prompt，但要完成角色替换：保持原图的 pose、composition、camera angle、clothing structure、scene、lighting、mood 与 style，同时将人物替换为目标角色。只输出 prompt 本体，不要任何额外文字。单角色时用换行分层输出，多角色时使用 NovelAI V4+ 的 | 结构并以 | 结尾。优先使用 Danbooru 精确 tag，可混合简短自然语言，但不要出现任何标题或注释文字。',
  ],
};

const PRESETS_KEY = 'nai-llm-prompt-presets';
const DEFAULT_BOORU_TAG_TYPES = { artist: true, character: true, copyright: true, general: true, meta: false };

const BUILTIN_PRESETS = [
  {
    id: 'nai-v5',
    name: 'NovelAI V5',
    builtIn: true,
    blocks: [
      {
        id: 'nai-v5-sys', role: 'system', enabled: true,
        content: `You are an image-to-prompt converter for NovelAI Diffusion V5,
an anime model that reads a hybrid of anchor Danbooru tags and
natural-language sentences.

═══ OUTPUT STYLE ═══

Anchor tags pin down hard facts: character count, hair/eye color,
clothing items, objects, medium, style. Natural language carries what
tags cannot: actions, interactions, spatial relationships, lighting
direction, atmosphere.

Write anchor tags first, then flowing sentences. Example:
2girls, cafe, window seat, afternoon, one girl in a black blazer leans
across the table to steal a bite of the other's parfait, warm sunlight
from the left, soft depth of field

═══ OUTPUT FORMAT ═══

Single character:
One continuous prompt mixing anchor tags and sentences.

Multiple characters:
{base prompt} | {character 1} | {character 2} | ...

Base prompt: scene, composition, lighting, and ALL actions and
interactions between characters — mostly natural language over a few
anchor tags. Each character segment: appearance only (hair, eyes,
outfit, accessories) as anchor tags. Actions, expressions and camera
never go into character segments.

═══ RULES ═══

- Weight syntax when needed: 1.2::tag or phrase:: — always closed.
- Text visible in the image: quote it verbatim in double quotes and say
  where it appears and on what (sign, page, screen...).
- Do not output quality tags, negative prompts, explanations, JSON,
  labels, or multiple versions.
- Do not invent elements not clearly visible in the image.`,
      },
      {
        id: 'nai-v5-user', role: 'user', enabled: true,
        content: `Analyze this image and write a NovelAI V5 prompt that combines anchor
Danbooru tags with natural-language sentences.

Think through:
1. Scene, composition, camera and lighting (mostly natural language)
2. Character count and every interaction between characters
3. Per-character appearance anchors (tags)

Format: single character → one prompt; multiple characters →
base | char1 | char2 | ... with appearance-only character segments.
Output only the final prompt. Nothing else.

{{booru_tags}}`,
      },
    ],
  },
  {
    id: 'nai-v4',
    name: 'NovelAI V4+',
    builtIn: true,
    blocks: [
      { id: 'nai-v4-sys', role: 'system', content: DEFAULT_SETTINGS.systemPrompt, enabled: true },
      { id: 'nai-v4-user', role: 'user', content: DEFAULT_SETTINGS.reversePrompt + '\n\n{{booru_tags}}', enabled: true },
    ],
  },
  {
    id: 'anima',
    name: 'Anima',
    builtIn: true,
    blocks: [
      {
        id: 'anima-sys', role: 'system', enabled: true,
        content: `You are an image-to-prompt converter for Anima, an anime illustration model that uses a hybrid of natural language descriptions and Danbooru-style tags.

═══ OUTPUT STYLE ═══

Anima prompts blend short natural-language phrases with precise tags.
Use natural language for: scene setting, spatial relationships, lighting mood,
complex poses, and emotional atmosphere.
Use tags for: concrete visual attributes (hair color, eye color, clothing items,
accessories, specific expressions).

Example output style:
A girl sitting by the window in warm afternoon light, black hair, long hair,
blue eyes, white sundress, bare shoulders, looking outside with a gentle smile,
sunlight casting soft shadows across her lap

═══ OUTPUT FORMAT ═══

Single character:
Output one continuous paragraph mixing NL phrases and tags. No line breaks
unless the prompt exceeds roughly 200 words.

Multiple characters:
Use Anima's character separator syntax:
{base scene description} ||| {character 1} ||| {character 2} ||| ...

Base: full scene/atmosphere in natural language + relevant scene tags.
Each character: appearance tags + pose/action in NL phrases.

═══ PRIORITY ORDER ═══

1. Scene atmosphere, lighting, time of day, location (NL preferred)
2. Composition, camera angle, framing (mix of NL and tags)
3. Character count and positions (NL)
4. Per-character: hair, eyes, expression (tags)
5. Per-character: outfit from top to bottom (tags, NL for complex layers)
6. Pose, gesture, body language (NL preferred)
7. Props, accessories, background details (tags)
8. Art style if distinctive (tags)

═══ RULES ═══

- Prefer natural language over pure tags when describing spatial relationships,
actions, and atmosphere.
- Use tags for unambiguous visual attributes (hair_color, clothing_items).
- Do NOT output quality tags or meta tags.
- Do NOT output explanations, JSON, markdown, or multiple versions.
- Do NOT invent elements not visible in the image.
- Keep total length under 300 words for single character,
under 150 words per segment for multi-character.`,
      },
      {
        id: 'anima-user', role: 'user', enabled: true,
        content: `Analyze this image and write an Anima-style prompt that blends natural language descriptions with precise Danbooru tags.

Think through:
1. Overall scene atmosphere and lighting
2. Composition and framing
3. Character appearance (use tags) and pose (use natural language)
4. Outfit details (tags for items, NL for how they're worn)

Output only the final prompt. Nothing else.

{{booru_tags}}`,
      },
    ],
  },
  {
    id: 'role-swap',
    name: '角色替换',
    builtIn: true,
    blocks: [
      { id: 'rs-sys', role: 'system', content: DEFAULT_SETTINGS.roleSystemPrompt, enabled: true },
      { id: 'rs-role', role: 'user', content: '目标角色设定：{{role_prompt}}\n\n要求：在同一次回复中完成反推与角色替换，直接输出最终可用的提示词。', enabled: true },
      { id: 'rs-user', role: 'user', content: DEFAULT_SETTINGS.roleReversePrompt + '\n\n{{booru_tags}}', enabled: true },
    ],
  },
];

const state = {
  settings: { ...DEFAULT_SETTINGS },
  customPresets: [],
  history: [],
  selectedImage: null,
  lastResult: '',
  isOpen: false,
  drawerOpen: false,
  fabPosition: null,
  isPickingImage: false,
  pending: false,
  cancellableRunId: null,
  pendingScope: '',
  hoveredImage: null,
  promptLibrary: [],
  activePage: 'reverse',
  isNovelAIImagePage: false,
  isNovelAISite: false,
  flow: {
    text: '',
    editors: [],
  },
  agent: {
    loaded: false,
    skills: [],
    activeSkillId: '',
    request: '',
    conversation: [],
    mode: 'default',
    characterCount: 0,
    managerOpen: false,
    editing: null,
    sources: { currentPrompt: false, characters: false, artists: false },
  },
  artistQuick: {
    loaded: false,
    library: { artists: [], labels: [], artistStrings: [], pages: [], activePageId: '' },
    pageId: '',
    mode: 'artists',
    search: '',
    category: '',
    rating: 0,
    visibleCount: 60,
    lastPromptField: null,
  },
  libraryEditingId: '',
  libraryEditorOpen: false,
  workbenchPage: 'library',
  workbenchSidebarCollapsed: false,
  extensionContextInvalidated: false,
  lastSettingsPresetTextarea: null,
  lastWorkbenchPresetTextarea: null,
  panelLayout: null,
  drawerLayout: null,
  drawerResize: {
    active: false,
    moved: false,
    startX: 0,
    startWidth: 0,
    rafId: 0,
    clientX: 0,
  },
  panelDrag: {
    active: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    width: 0,
    height: 0,
  },
  panelResize: {
    active: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0,
  },
  panelInteraction: {
    rafId: 0,
    clientX: 0,
    clientY: 0,
  },
};

const ui = {
  root: null,
  fab: null,
  artist: { hosts: [] },
  agent: { hosts: [] },
  panel: null,
  header: null,
  resizeHandle: null,
  status: null,
  preview: null,
  previewHint: null,
  resultOutput: null,
  sendButton: null,
  historyList: null,
  libraryList: null,
  navButtons: [],
  pages: {},
  settings: {},
  library: {
    drawer: null,
    status: null,
    editor: null,
    sidebarToggle: null,
    settingsPanel: null,
  },
};
