
const SETTINGS_KEY = 'nai-llm-assistant-settings';
const HISTORY_KEY = 'nai-llm-reverse-history';
const PANEL_LAYOUT_KEY = 'nai-llm-panel-layout';
const DRAWER_LAYOUT_KEY = 'nai-llm-drawer-layout';
const PROMPT_LIBRARY_KEY = 'nai-shared-prompt-library';
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
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 260;
const DRAWER_MIN_WIDTH = 480;

const T = {
  title: '\u56fe\u50cf\u53cd\u63a8\u52a9\u624b',
  fab: '\u53cd\u63a8',
  imagePageTitle: '\u8bcd\u5e93',
  imagePageFab: '\u8bcd\u5e93',
  tabLibrary: '\u8bcd\u5e93',
  tabReverse: '\u53cd\u63a8',
  tabHistory: '\u5386\u53f2',
  tabSettings: '\u8bbe\u7f6e',
  quickHint: '\u5feb\u6377\u952e\uff1a',
  pick: '\u624b\u52a8\u9009\u56fe',
  reverseCopy: '\u53cd\u63a8\u5e76\u590d\u5236',
  copyResult: '\u590d\u5236\u7ed3\u679c',
  previewEmpty: '\u5c1a\u672a\u9501\u5b9a\u56fe\u7247',
  resultLabel: '\u53cd\u63a8\u7ed3\u679c\uff08\u81ea\u52a8\u590d\u5236\u5230\u526a\u5207\u677f\uff09',
  resultPlaceholder: '\u53cd\u63a8\u7ed3\u679c\u4f1a\u663e\u793a\u5728\u8fd9\u91cc',
  clearHistory: '\u6e05\u7a7a\u5386\u53f2',
  noHistory: '\u6682\u65e0\u5386\u53f2\u8bb0\u5f55',
  copy: '\u590d\u5236',
  load: '\u52a0\u8f7d',
  serviceProvider: '\u670d\u52a1\u5546\u9884\u8bbe',
  protocol: '\u63a5\u53e3\u534f\u8bae',
  model: '\u6a21\u578b',
  systemPrompt: '\u7cfb\u7edf\u63d0\u793a\u8bcd',
  reversePrompt: '\u53cd\u63a8\u6307\u4ee4\uff08\u53cd\u63a8\u9875\u4e0d\u518d\u5355\u72ec\u8f93\u5165\uff09',
  roleMode: '\u66ff\u6362\u89d2\u8272\u6a21\u5f0f',
  roleSystemPrompt: '\u89d2\u8272\u6a21\u5f0f\u7cfb\u7edf\u63d0\u793a\u8bcd',
  roleReversePrompt: '\u89d2\u8272\u6a21\u5f0f\u53cd\u63a8\u6307\u4ee4',
  rolePrompt: '\u76ee\u6807\u89d2\u8272\u63d0\u793a\u8bcd',
  roleLibrary: '\u8bcd\u5e93\u89d2\u8272',
  roleLibraryPlaceholder: '\u9009\u62e9\u5df2\u4fdd\u5b58\u7684 char: \u89d2\u8272\u8bcd\u5e93',
  applyRoleLibrary: '\u5957\u7528\u5230\u89d2\u8272\u63d0\u793a\u8bcd',
  sectionAppearance: '\u5916\u89c2',
  sectionAppearanceHint: '\u989c\u8272\u4e0e\u9762\u677f\u884c\u4e3a',
  sectionProvider: 'LLM \u670d\u52a1',
  sectionProviderHint: '\u6a21\u578b\u3001Endpoint \u4e0e\u8fde\u63a5\u68c0\u67e5',
  sectionPrompt: '\u63d0\u793a\u8bcd',
  sectionPromptHint: '\u53cd\u63a8\u903b\u8f91\u4e0e\u89d2\u8272\u66ff\u6362',
  sectionBehavior: '\u751f\u6210\u9009\u9879',
  sectionBehaviorHint: '\u56fe\u7247\u53d1\u9001\u65b9\u5f0f\u4e0e\u8f93\u51fa\u884c\u4e3a',
  sectionFallback: '\u5907\u7528\u6a21\u578b',
  sectionFallbackHint: '\u4e3b\u6a21\u578b\u5931\u8d25\u540e\u7684\u5140\u5e95\u8def\u7531',
  defaultCodeFence: '\u9ed8\u8ba4\u4ee3\u7801\u6846\u8f93\u51fa',
  wrapCodeButton: '\u5305\u88f9\u4ee3\u7801\u6846',
  fetchModels: '\u83b7\u53d6\u6a21\u578b',
  testConnection: '\u6d4b\u8bd5\u8fde\u63a5',
  fallbackMode: '\u542f\u7528\u5907\u7528\u6a21\u578b\uff08\u4e3b\u6a21\u578b\u5931\u8d25\u65f6\u81ea\u52a8\u91cd\u8bd5\uff09',
  fallbackProvider: '\u5907\u7528\u670d\u52a1\u5546\u9884\u8bbe',
  fallbackProtocol: '\u5907\u7528\u63a5\u53e3\u534f\u8bae',
  fallbackEndpoint: '\u5907\u7528 API Endpoint',
  fallbackModel: '\u5907\u7528\u6a21\u578b',
  fallbackApiKey: '\u5907\u7528 API Key\uff08\u6309\u4f9b\u5e94\u5546\u4fdd\u5b58\uff09',
  themePreset: '\u989c\u8272\u9884\u8bbe',
  sendImageAsDataUrl: '\u53d1\u9001\u56fe\u7247\u5185\u5bb9\uff08\u5173\u95ed\u5219\u53d1\u9001\u539f\u59cb URL\uff09',
  enableBooruTagContext: '\u9644\u52a0\u7f51\u7ad9\u6807\u7b7e\u4e0a\u4e0b\u6587\uff08Danbooru / Gelbooru\uff09',
  showReverseEntry: '\u663e\u793a\u53cd\u63a8\u60ac\u6d6e\u5165\u53e3',
  showWorkbenchEntry: '\u663e\u793a\u5de5\u4f5c\u53f0\u60ac\u6d6e\u5165\u53e3',
  saveSettings: '\u4fdd\u5b58\u8bbe\u7f6e',
  statusReady: '\u5c31\u7eea\u3002\u53ef\u4f7f\u7528 Alt + Shift + \u70b9\u51fb\u56fe\u7247 \u5feb\u901f\u53cd\u63a8\u3002',
  statusNeedImage: '\u8bf7\u5148\u901a\u8fc7\u5feb\u6377\u952e\u6216\u624b\u52a8\u9009\u56fe\u9501\u5b9a\u56fe\u7247\u3002',
  statusNeedKey: '\u672a\u914d\u7f6e API Key\uff0c\u8bf7\u5207\u6362\u5230\u8bbe\u7f6e\u9875\u4fdd\u5b58\u914d\u7f6e\u3002',
  statusNeedPrompt: '\u8bf7\u5148\u5728\u8bbe\u7f6e\u9875\u586b\u5199\u53cd\u63a8\u6307\u4ee4\u3002',
  statusNeedRolePrompt: '\u5df2\u5f00\u542f\u66ff\u6362\u89d2\u8272\u6a21\u5f0f\uff0c\u8bf7\u5728\u8bbe\u7f6e\u9875\u586b\u5199\u76ee\u6807\u89d2\u8272\u63d0\u793a\u8bcd\u3002',
  statusRunning: '\u6b63\u5728\u8bf7\u6c42\u6a21\u578b\u53cd\u63a8...',
  statusRunningFallback: '\u4e3b\u6a21\u578b\u8bf7\u6c42\u5931\u8d25\uff0c\u6b63\u5728\u5207\u6362\u5230\u5907\u7528\u6a21\u578b...',
  statusDoneCopied: '\u53cd\u63a8\u5b8c\u6210\uff0c\u5df2\u590d\u5236\u5230\u526a\u5207\u677f\u3002',
  statusDoneNotCopied: '\u53cd\u63a8\u5b8c\u6210\uff0c\u4f46\u81ea\u52a8\u590d\u5236\u5931\u8d25\u3002',
  statusDoneCopiedFallback: '\u4e3b\u6a21\u578b\u5931\u8d25\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230\u5907\u7528\u6a21\u578b\u5e76\u590d\u5236\u5230\u526a\u5207\u677f\u3002',
  statusDoneNotCopiedFallback: '\u4e3b\u6a21\u578b\u5931\u8d25\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230\u5907\u7528\u6a21\u578b\uff0c\u4f46\u81ea\u52a8\u590d\u5236\u5931\u8d25\u3002',
  statusSelectMode: '\u9009\u56fe\u6a21\u5f0f\uff1a\u70b9\u51fb\u4e00\u5f20\u56fe\u7247\uff0c\u6309 Esc \u53d6\u6d88\u3002',
  statusSelectCanceled: '\u5df2\u53d6\u6d88\u9009\u56fe\u6a21\u5f0f\u3002',
  statusImageLocked: '\u56fe\u7247\u5df2\u9501\u5b9a\u3002',
  statusSaved: '\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002',
  statusHistoryCleared: '\u5386\u53f2\u8bb0\u5f55\u5df2\u6e05\u7a7a\u3002',
  statusCopied: '\u5df2\u590d\u5236\u7ed3\u679c\u3002',
  statusCopyFailed: '\u6682\u65e0\u53ef\u590d\u5236\u7ed3\u679c\u6216\u590d\u5236\u5931\u8d25\u3002',
  statusLoadedHistory: '\u5df2\u52a0\u8f7d\u5386\u53f2\u7ed3\u679c\u3002',
  statusWrapped: '\u5df2\u5c06\u7ed3\u679c\u5305\u88f9\u4e3a\u4ee3\u7801\u6846\u3002',
  statusNoResult: '\u6682\u65e0\u53ef\u5305\u88f9\u7684\u7ed3\u679c\u3002',
  statusRoleLibraryApplied: '\u5df2\u5c06\u8bcd\u5e93\u89d2\u8272\u5957\u7528\u5230\u89d2\u8272\u63d0\u793a\u8bcd\u3002',
  statusRoleLibraryMissing: '\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u8bcd\u5e93\u89d2\u8272\u3002',
  statusTestingConnection: '\u6b63\u5728\u6d4b\u8bd5\u8fde\u63a5...',
  statusNeedFallbackConfig: '\u5df2\u542f\u7528\u5907\u7528\u6a21\u578b\uff0c\u8bf7\u5148\u5b8c\u6574\u914d\u7f6e\u5907\u7528\u670d\u52a1\u5546\u3001Endpoint\u3001Model \u548c API Key\u3002',
  statusContextInvalidated: '\u6269\u5c55\u5df2\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u5f53\u524d\u9875\u9762\u540e\u91cd\u8bd5\u3002',
  statusLibraryReady: '\u8bcd\u5e93\u5c31\u7eea\uff0c\u4fdd\u5b58\u540e\u4f1a\u5c1d\u8bd5\u540c\u6b65\u5230\u5b98\u65b9 Prompt Chunk\u3002',
  statusLibrarySaved: '\u8bcd\u5e93\u5df2\u4fdd\u5b58\uff0c\u6b63\u5728\u540c\u6b65\u5230\u5b98\u65b9 Prompt Chunk...',
  statusLibraryDeleted: '\u8bcd\u5e93\u6761\u76ee\u5df2\u5220\u9664\u3002',
  statusLibrarySynced: '\u5df2\u540c\u6b65\u5230\u5b98\u65b9 Prompt Chunk\u3002',
  statusLibrarySyncFailed: '\u672c\u5730\u8bcd\u5e93\u5df2\u4fdd\u7559\uff0c\u4f46\u5b98\u65b9 Prompt Chunk \u540c\u6b65\u5931\u8d25\uff1a',
  statusLibraryInvalid: '\u8bf7\u586b\u5199\u5206\u7c7b\u3001\u540d\u79f0\u548c\u63d0\u793a\u8bcd\u5185\u5bb9\u3002',
  importStPreset: '\u5bfc\u5165 ST \u9884\u8bbe',
  stImportHint: '\u652f\u6301\u5bfc\u5165 SillyTavern \u98ce\u683c\u7684 preset JSON\uff0c\u4f1a\u6309 prompt_order \u8fd8\u539f\u987a\u5e8f\u5e76\u6620\u5c04\u4e3a\u6d88\u606f\u5757\u3002',
  statusStPresetImported: 'SillyTavern \u9884\u8bbe\u5df2\u5bfc\u5165\u5e76\u5957\u7528\u3002',
  statusStPresetImportFailed: '\u5bfc\u5165 SillyTavern \u9884\u8bbe\u5931\u8d25\uff1a\u6587\u4ef6\u7ed3\u6784\u4e0d\u7b26\u5408\u9884\u671f\u6216\u7f3a\u5c11 prompts\u3002',
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
  enableFallbackModel: false,
  fallbackProviderPreset: 'xai-responses',
  fallbackProtocol: 'responses',
  fallbackEndpoint: 'https://api.x.ai/v1/responses',
  fallbackModel: 'grok-4-fast-reasoning',
  fallbackApiKey: '',
  fallbackProviderConnections: {},
  themePreset: 'novelai',
  sendImageAsDataUrl: true,
  enableBooruTagContext: false,
  activePresetId: 'nai-v4',
  booruTagTypes: { artist: true, character: true, copyright: true, general: true, meta: false },
  showReverseFloatingBall: true,
  showWorkbenchFloatingBall: true,
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
  { id: 'gemini-openai', label: 'Google Gemini (OpenAI\u517c\u5bb9)', protocol: 'openai-chat', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-2.5-flash' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', endpoint: 'https://api.deepseek.com/chat/completions', defaultModel: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-sonnet-4-20250514' },
  { id: 'custom', label: '\u81ea\u5b9a\u4e49', protocol: 'openai-chat', endpoint: '', defaultModel: '' },
];
const THEME_PRESETS = [
  { id: 'novelai', label: '\u661f\u6d77\u938f\u91d1' },
  { id: 'sunrise', label: '\u65e5\u7167\u5976\u6cb9' },
  { id: 'porcelain', label: '\u74f7\u84dd\u96fe\u767d' },
  { id: 'matcha', label: '\u62b9\u8336\u7ec7\u7eaf' },
  { id: 'rose', label: '\u8517\u8587\u7ec6\u6c99' },
  { id: 'ember', label: '\u4f59\u70ec\u66ae\u68d5' },
  { id: 'midnight', label: '\u6df1\u6d77\u591c\u84dd' },
  { id: 'moss', label: '\u9752\u82d4\u5e7d\u591c' },
];
const LEGACY_DEFAULT_PROMPTS = {
  systemPrompt: [
    '\u4f60\u662f\u56fe\u50cf\u53cd\u63a8\u52a9\u624b\u3002\u8bf7\u5206\u6790\u56fe\u7247\u5e76\u7ed9\u51fa\u9ad8\u8d28\u91cf\u6807\u7b7e\uff0c\u4ee5\u53ca\u4e00\u6761\u53ef\u76f4\u63a5\u7528\u4e8e\u751f\u6210\u7684\u7cbe\u7b80\u63d0\u793a\u8bcd\u3002',
    '\u4f60\u662f NovelAI \u56fe\u50cf\u53cd\u63a8\u52a9\u624b\u3002\u4efb\u52a1\u662f\u5c06\u56fe\u50cf\u5185\u5bb9\u8f6c\u6362\u4e3a\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u751f\u56fe\u7684 Danbooru \u98ce\u683c\u63d0\u793a\u8bcd\u3002\u8bf7\u4e25\u683c\u4f7f\u7528\u82f1\u6587 tag\uff0c\u5c3d\u91cf\u63a5\u8fd1 Danbooru \u5e38\u7528\u5199\u6cd5\uff0c\u591a\u8bcd tag \u4f7f\u7528\u4e0b\u5212\u7ebf\uff0c\u5404 tag \u4e4b\u95f4\u7528\u82f1\u6587\u9017\u53f7+\u7a7a\u683c\u5206\u9694\u3002\u4e0d\u8981\u5199\u89e3\u91ca\uff0c\u4e0d\u8981\u5199\u81ea\u7136\u8bed\u8a00\u6bb5\u843d\uff0c\u4e0d\u8981\u8f93\u51fa JSON \u6216 Markdown \u6807\u9898\u3002\u82e5\u65e0\u6cd5\u786e\u8ba4\u7684\u7ec6\u8282\uff0c\u5b81\u53ef\u7701\u7565\u4e5f\u4e0d\u8981\u81c6\u9020\u3002',
    '\u4f60\u662f NovelAI \u56fe\u50cf\u63d0\u793a\u8bcd\u53cd\u63a8\u4e13\u5bb6\uff0c\u4e13\u7cbe V4+ \u52a8\u6f2b\u98ce\u683c\u751f\u6210\u6a21\u578b\u3002\u5f53\u7528\u6237\u63d0\u4f9b\u56fe\u50cf\u65f6\uff0c\u53ea\u8f93\u51fa\u5355\u4e2a\u7eaf\u82f1\u6587\u3001NovelAI-ready \u7684 prompt \u672c\u4f53\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u6807\u9898\uff0c\u4e0d\u8981 TAGS\uff0c\u4e0d\u8981 PROMPT\uff0c\u4e0d\u8981 JSON\uff0c\u4e0d\u8981\u4ee3\u7801\u5757\u5916\u7684\u4efb\u4f55\u6587\u5b57\u3002\u63d0\u793a\u8bcd\u5fc5\u987b\u5c3d\u91cf\u4f7f\u7528 Danbooru \u98ce\u683c tag\uff0c\u591a\u8bcd tag \u4f7f\u7528\u4e0b\u5212\u7ebf\uff0c\u540c\u65f6\u5141\u8bb8\u5c11\u91cf\u81ea\u7136\u8bed\u8a00\u77ed\u8bed\u589e\u5f3a\u573a\u666f\u4e00\u81f4\u6027\u3002\u7edd\u5bf9\u4e0d\u8981\u6dfb\u52a0 masterpiece, best quality, very aesthetic, absurdres, highly detailed \u7b49\u8d28\u91cf\u589e\u5f3a\u8bcd\uff0c\u4e5f\u4e0d\u8981\u8f93\u51fa negative prompt\u3002',
  ],
  reversePrompt: [
    '\u8bf7\u53cd\u63a8\u8fd9\u5f20\u56fe\uff0c\u8f93\u51fa\uff1a1) \u5173\u952e\u6807\u7b7e 2) \u4e00\u6761\u53ef\u76f4\u63a5\u4f7f\u7528\u7684\u6700\u7ec8\u63d0\u793a\u8bcd\u3002',
    '\u8bf7\u5206\u6790\u8fd9\u5f20\u56fe\uff0c\u5e76\u4e25\u683c\u6309\u7167\u4ee5\u4e0b\u683c\u5f0f\u8f93\u51fa\uff1a\\nTAGS: <\u4e00\u884c\u82f1\u6587 Danbooru tags\uff0c\u9017\u53f7\u5206\u9694\uff0c\u53ef\u5305\u542b 1girl/1boy\uff0chair\uff0ceyes\uff0cclothes\uff0cpose\uff0ccomposition\uff0cbackground\uff0cstyle\uff0cquality \u7b49\u6807\u7b7e>\\nPROMPT: <\u4e00\u884c\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u7684\u6700\u7ec8 prompt\uff0c\u4ecd\u7136\u5168\u90e8\u4f7f\u7528\u82f1\u6587 Danbooru tags\uff0c\u6309\u4e3b\u4f53 -> \u5916\u89c2 -> \u670d\u88c5 -> \u52a8\u4f5c -> \u955c\u5934/\u6784\u56fe -> \u573a\u666f -> \u753b\u98ce/\u753b\u8d28 \u6392\u5e8f>\\n\u8981\u6c42\uff1a\u4f18\u5148\u4f7f\u7528 NovelAI \u5e38\u7528\u6807\u7b7e\uff0c\u907f\u514d\u5197\u4f59\u91cd\u590d tag\uff0c\u4e0d\u8981\u8f93\u51fa negative prompt\uff0c\u4e0d\u8981\u9644\u52a0\u989d\u5916\u8bf4\u660e\u3002',
    '\u8bf7\u5c06\u8fd9\u5f20\u56fe\u53cd\u63a8\u4e3a\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u7684\u5355\u4e2a\u82f1\u6587 prompt\uff0c\u53ea\u8f93\u51fa prompt \u672c\u4f53\uff0c\u4e0d\u8981\u4efb\u4f55\u989d\u5916\u6587\u5b57\u3002\u987a\u5e8f\u5fc5\u987b\u4f18\u5148\u4e3a\uff1a\u6574\u4f53\u573a\u666f/\u6784\u56fe/\u4eba\u6570/\u706f\u5149 -> \u89d2\u8272\u6838\u5fc3\u7279\u5f81\uff08\u8d8a\u91cd\u8981\u8d8a\u9760\u524d\uff09\u3002\u5355\u89d2\u8272\u65f6\u8bf7\u7528\u6362\u884c\u5206\u4e3a 3-4 \u5c42\uff1a\u7b2c 1 \u884c\u5199 scene/composition/\u4eba\u6570\uff0c\u7b2c 2 \u884c\u5199\u53d1\u8272/\u53d1\u578b/\u77b3\u8272/\u8084\u4f53/\u7279\u5f81\uff0c\u7b2c 3 \u884c\u5199\u670d\u88c5\u4e0e\u914d\u9970\uff0c\u7b2c 4 \u884c\u5199\u52a8\u4f5c/\u8868\u60c5/\u573a\u666f/\u5149\u5f71/\u955c\u5934\u3002\u591a\u89d2\u8272\uff082-6\u4eba\uff09\u65f6\u5fc5\u987b\u4f7f\u7528 NovelAI V4+ \u7684 | \u5206\u9694\u7ed3\u6784\uff0c\u6574\u4e2a prompt \u4ee5\u6700\u540e\u4e00\u4e2a | \u7ed3\u5c3e\u3002\u53ef\u6df7\u5408 Danbooru \u7cbe\u786e tag \u548c\u77ed\u53e5\uff0c\u4f46\u4e0d\u8981\u51fa\u73b0\u4efb\u4f55 tag \u4ee5\u5916\u7684\u6807\u9898\u8bcd\u3002',
  ],
  roleSystemPrompt: [
    '\u4f60\u662f\u89d2\u8272\u66ff\u6362\u53cd\u63a8\u52a9\u624b\u3002\u8bf7\u57fa\u4e8e\u56fe\u50cf\u5185\u5bb9\u751f\u6210\u6807\u7b7e\u4e0e\u63d0\u793a\u8bcd\uff0c\u5e76\u5c06\u89d2\u8272\u66ff\u6362\u4e3a\u76ee\u6807\u89d2\u8272\u8bbe\u5b9a\u3002',
    '\u4f60\u662f NovelAI \u89d2\u8272\u66ff\u6362\u53cd\u63a8\u52a9\u624b\u3002\u4f60\u9700\u8981\u5148\u8bc6\u522b\u56fe\u50cf\u7684\u6784\u56fe\u3001\u59ff\u52bf\u3001\u670d\u88c5\u5c42\u7ea7\u3001\u955c\u5934\u3001\u573a\u666f\u3001\u6c1b\u56f4\u4e0e\u753b\u98ce\uff0c\u518d\u5c06\u4eba\u7269\u66ff\u6362\u4e3a\u76ee\u6807\u89d2\u8272\u3002\u8f93\u51fa\u5fc5\u987b\u662f\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u7684\u82f1\u6587 Danbooru tags\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u81ea\u7136\u8bed\u8a00\u6bb5\u843d\uff0c\u4e0d\u8981\u4fdd\u7559\u539f\u89d2\u8272\u7684\u8eab\u4efd\u540d\u79f0\u3002',
    '\u4f60\u662f NovelAI \u89d2\u8272\u66ff\u6362\u53cd\u63a8\u4e13\u5bb6\u3002\u4f60\u9700\u8981\u4fdd\u7559\u539f\u56fe\u7684\u6784\u56fe\u3001\u52a8\u4f5c\u3001\u955c\u5934\u3001\u670d\u88c5\u5c42\u7ea7\u3001\u573a\u666f\u3001\u5149\u5f71\u3001\u6c1b\u56f4\u4e0e\u753b\u98ce\uff0c\u53ea\u5c06\u4eba\u7269\u66ff\u6362\u4e3a\u76ee\u6807\u89d2\u8272\u8bbe\u5b9a\u3002\u6700\u7ec8\u53ea\u8f93\u51fa\u5355\u4e2a\u7eaf\u82f1\u6587 NovelAI-ready prompt \u672c\u4f53\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981 TAGS\uff0c\u4e0d\u8981 PROMPT\uff0c\u4e0d\u8981 JSON\uff0c\u4e0d\u8981 negative prompt\uff0c\u4e0d\u8981\u4fdd\u7559\u539f\u89d2\u8272\u540d\u79f0\u3002',
  ],
  roleReversePrompt: [
    '\u8bf7\u5148\u5206\u6790\u56fe\u50cf\uff0c\u7136\u540e\u8f93\u51fa\uff1a1) \u9ad8\u8d28\u91cf\u751f\u56fe\u6807\u7b7e 2) \u4e00\u6761\u5df2\u5b8c\u6210\u89d2\u8272\u66ff\u6362\u7684\u6700\u7ec8\u63d0\u793a\u8bcd\u3002',
    '\u8bf7\u5206\u6790\u8fd9\u5f20\u56fe\uff0c\u4fdd\u6301\u539f\u56fe\u7684 pose\u3001composition\u3001camera angle\u3001clothing structure\u3001scene\u3001lighting\u3001mood \u4e0e style\uff0c\u4f46\u5c06\u4eba\u7269\u66ff\u6362\u4e3a\u76ee\u6807\u89d2\u8272\u8bbe\u5b9a\u3002\u4e25\u683c\u6309\u7167\u4ee5\u4e0b\u683c\u5f0f\u8f93\u51fa\uff1a\\nTAGS: <\u4e00\u884c\u82f1\u6587 Danbooru tags\uff0c\u9017\u53f7\u5206\u9694\uff0c\u5df2\u5b8c\u6210\u89d2\u8272\u66ff\u6362>\\nPROMPT: <\u4e00\u884c\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u7684\u6700\u7ec8 prompt\uff0c\u4ecd\u7136\u5168\u90e8\u4f7f\u7528\u82f1\u6587 Danbooru tags\uff0c\u4f18\u5148\u4fdd\u7559\u539f\u56fe\u7684\u89c6\u89c9\u8981\u7d20>\\n\u8981\u6c42\uff1a\u4e0d\u8981\u4fdd\u7559\u539f\u89d2\u8272\u59d3\u540d\uff0c\u4e0d\u8981\u8f93\u51fa\u89e3\u91ca\uff0c\u4e0d\u8981\u8f93\u51fa negative prompt\u3002',
    '\u8bf7\u5c06\u8fd9\u5f20\u56fe\u53cd\u63a8\u4e3a\u53ef\u76f4\u63a5\u7528\u4e8e NovelAI \u7684\u5355\u4e2a\u82f1\u6587 prompt\uff0c\u4f46\u8981\u5b8c\u6210\u89d2\u8272\u66ff\u6362\uff1a\u4fdd\u6301\u539f\u56fe\u7684 pose\u3001composition\u3001camera angle\u3001clothing structure\u3001scene\u3001lighting\u3001mood \u4e0e style\uff0c\u540c\u65f6\u5c06\u4eba\u7269\u66ff\u6362\u4e3a\u76ee\u6807\u89d2\u8272\u3002\u53ea\u8f93\u51fa prompt \u672c\u4f53\uff0c\u4e0d\u8981\u4efb\u4f55\u989d\u5916\u6587\u5b57\u3002\u5355\u89d2\u8272\u65f6\u7528\u6362\u884c\u5206\u5c42\u8f93\u51fa\uff0c\u591a\u89d2\u8272\u65f6\u4f7f\u7528 NovelAI V4+ \u7684 | \u7ed3\u6784\u5e76\u4ee5 | \u7ed3\u5c3e\u3002\u4f18\u5148\u4f7f\u7528 Danbooru \u7cbe\u786e tag\uff0c\u53ef\u6df7\u5408\u7b80\u77ed\u81ea\u7136\u8bed\u8a00\uff0c\u4f46\u4e0d\u8981\u51fa\u73b0\u4efb\u4f55\u6807\u9898\u6216\u6ce8\u91ca\u6587\u5b57\u3002',
  ],
};

const PRESETS_KEY = 'nai-llm-prompt-presets';
const DEFAULT_BOORU_TAG_TYPES = { artist: true, character: true, copyright: true, general: true, meta: false };

const BUILTIN_PRESETS = [
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
  isPickingImage: false,
  pending: false,
  hoveredImage: null,
  promptLibrary: [],
  activePage: 'reverse',
  isNovelAIImagePage: false,
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
