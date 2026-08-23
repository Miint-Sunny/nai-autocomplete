// 两层分类。第一层来自词典的 danbooru category（准），第二层是语义规则表（全）。
//
// 第一层只有五类，九成 tag 都落在 general 里，等于没分；第二层补的就是这九成。
// 规则表是离线确定性判定 —— 不查网、不问模型、结果可复现，没命中就老实标「其他」。
// 顺序即优先级：越具体的越靠前（closed eyes 是表情，blue eyes 才是外貌）。

const FLOW_SOURCE_BY_CATEGORY = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};

const FLOW_SEMANTIC_LABELS = {
  subject: '主体',
  quality: '质量',
  camera: '构图',
  light: '光影',
  expression: '表情',
  outfit: '服饰',
  appearance: '外貌',
  pose: '动作',
  scene: '场景',
  other: '其他',
};

const FLOW_SOURCE_LABELS = {
  general: '通用',
  artist: '画师',
  copyright: '版权',
  character: '角色',
  meta: '元信息',
  unknown: '词典无',
};

const FLOW_SEMANTIC_RULES = [
  {
    id: 'subject',
    pattern: /^\d+\+?(girls?|boys?|others?)$/,
    exact: ['solo', 'solo focus', 'multiple girls', 'multiple boys', 'multiple views', 'no humans',
      'girl', 'boy', 'male focus', 'female focus', 'couple', 'group', 'crowd', 'everyone'],
  },
  {
    id: 'quality',
    suffix: [' quality', ' complexity'],
    exact: ['masterpiece', 'best quality', 'absurdres', 'incredibly absurdres', 'highres', 'lowres',
      'very aesthetic', 'aesthetic', 'detailed', 'highly detailed', 'highly finished', 'no text',
      'official art', 'jpeg artifacts', 'scan', 'stunning composition', 'fine fabric emphasis',
      'beautiful detailed eyes', 'detailed background', 'upscaled', 'blurry'],
  },
  {
    id: 'camera',
    prefix: ['from '],
    suffix: [' shot', ' angle', ' view', ' focus', ' body'],
    exact: ['close-up', 'closeup', 'portrait', 'panorama', 'fisheye', 'foreshortening', 'perspective',
      'depth of field', 'bokeh', 'soft focus', 'blurred background', 'motion blur', 'dutch angle',
      'profile', 'straight-on', 'pov', 'first-person view', 'cropped', 'out of frame', 'wide shot',
      'rule of thirds', 'symmetry', 'centered'],
  },
  {
    id: 'light',
    suffix: [' lighting', ' light', ' theme', ' shadow', ' shadows', ' colors', ' palette', ' glow'],
    exact: ['backlighting', 'sidelighting', 'rim light', 'god rays', 'sunbeams', 'dappled sunlight',
      'komorebi', 'lens flare', 'bloom', 'soft bloom', 'glowing', 'sparkle', 'light particles',
      'golden hour', 'moonlight', 'sunlight', 'warm lighting', 'dim light',
      'light leaks', 'chromatic aberration', 'vignetting', 'film grain', 'overexposure', 'silhouette',
      'gradient', 'monochrome', 'greyscale', 'grayscale', 'sepia', 'limited palette', 'color grading',
      'high saturation', 'low saturation', 'ray tracing', 'global illumination', 'ambient occlusion',
      'subsurface scattering', 'depthness', 'tyndall effect', 'shiny skin', 'glossy skin', 'skin luster',
      'iridescent highlights', 'bright white light', 'atmospheric perspective'],
  },
  {
    id: 'expression',
    suffix: [' smile', ' expression'],
    exact: ['smile', 'smiling', 'grin', 'laughing', 'blush', 'embarrassed', 'crying', 'tears', 'angry',
      'sad', 'surprised', 'shocked', 'scared', 'serious', 'pout', 'frown', 'open mouth', 'closed mouth',
      'closed eyes', 'half-closed eyes', 'wide-eyed', 'wink', 'one eye closed', 'looking at viewer',
      'looking away', 'looking back', 'looking down', 'looking up', 'looking to the side', 'eye contact',
      'expressionless', 'smug', 'sleepy', 'tongue out', 'teeth', 'fang', 'sweat', 'sweatdrop', 'nervous',
      'happy', 'empty eyes', 'parted lips', 'clenched teeth'],
  },
  {
    id: 'outfit',
    suffix: [' uniform', ' dress', ' shirt', ' skirt', ' jacket', ' coat', ' hat', ' cap', ' shoes',
      ' boots', ' socks', ' gloves', ' ribbon', ' bow', ' hairband', ' headband', ' hair ornament',
      ' scarf', ' necktie', ' sweater', ' hoodie', ' pants', ' shorts', ' cape', ' cloak', ' apron',
      ' armor', ' kimono', ' swimsuit', ' bikini', ' legwear', ' pantyhose', ' thighhighs', ' earrings',
      ' necklace', ' bracelet', ' glasses', ' mask', ' headphones', ' bag', ' belt', ' collar', ' cutout'],
    exact: ['school uniform', 'serafuku', 'sailor collar', 'dress', 'shirt', 'skirt', 'jacket', 'coat',
      'hat', 'shoes', 'boots', 'socks', 'gloves', 'ribbon', 'bow', 'scarf', 'necktie', 'sweater',
      'hoodie', 'pants', 'shorts', 'cape', 'cloak', 'apron', 'armor', 'kimono', 'swimsuit', 'bikini',
      'pantyhose', 'thighhighs', 'earrings', 'necklace', 'bracelet', 'glasses', 'sunglasses', 'mask',
      'headphones', 'bag', 'belt', 'collar', 'jewelry', 'hair ornament', 'hairclip', 'nude', 'naked',
      'barefoot', 'off shoulder', 'bare shoulders', 'midriff', 'cleavage', 'clothing cutout'],
  },
  {
    id: 'appearance',
    suffix: [' hair', ' eyes', ' skin', ' bangs', ' ponytail', ' braid', ' braids', ' breasts',
      ' horns', ' ears', ' tail', ' wings', ' eyelashes', ' pupils'],
    exact: ['heterochromia', 'freckles', 'mole', 'scar', 'tan', 'twintails', 'ponytail', 'braid',
      'ahoge', 'hair between eyes', 'blunt bangs', 'sidelocks', 'slim', 'muscular', 'petite', 'tall',
      'wet hair', 'floating hair', 'hair flowing over'],
  },
  {
    id: 'pose',
    prefix: ['holding ', 'hand on ', 'hands on ', 'arms ', 'arm ', 'legs ', 'leg ', 'sitting ',
      'standing ', 'lying ', 'leaning ', 'carrying '],
    suffix: [' pose', ' position', ' motion'],
    exact: ['standing', 'sitting', 'lying', 'kneeling', 'squatting', 'walking', 'running', 'jumping',
      'flying', 'floating', 'dancing', 'leaning', 'crossed arms', 'crossed legs', 'outstretched arm',
      'spread arms', 'holding', 'holding hands', 'hugging', 'hug', 'carrying', 'reaching', 'pointing',
      'waving', 'stretching', 'dynamic pose', 'dynamic action', 'action pose', 'contrapposto',
      'on back', 'on stomach', 'on side', 'all fours', 'straddling', 'riding', 'v sign', 'peace sign',
      'salute', 'head tilt', 'bent over', 'arched back', 'motion lines', 'splashing'],
  },
  {
    id: 'scene',
    suffix: [' background', 'scape', ' station', ' store', ' room'],
    exact: ['indoors', 'outdoors', 'location', 'sky', 'cloud', 'clouds', 'night', 'day', 'daytime',
      'evening', 'morning', 'sunset', 'sunrise', 'dusk', 'dawn', 'twilight',
      'rain', 'raining', 'snow', 'snowing', 'fog', 'mist', 'wind', 'storm', 'puddle',
      'city', 'street', 'road', 'alley', 'forest', 'tree', 'trees', 'grass', 'flower', 'flowers',
      'water', 'ocean', 'sea', 'river', 'lake', 'beach', 'mountain', 'mountains', 'bedroom',
      'classroom', 'kitchen', 'bathroom', 'cafe', 'restaurant', 'shop', 'train', 'bus', 'car',
      'window', 'door', 'wall', 'floor', 'ceiling', 'bed', 'chair', 'table', 'desk', 'curtain',
      'plant', 'building', 'ruins', 'shrine', 'temple', 'church', 'garden', 'park', 'field',
      'underwater', 'space', 'stars', 'moon', 'sun', 'reflection', 'reed marsh'],
  },
];

// skill 第 5 节要求「一段一个职能：场景、机位、光影、动作各自成段」，
// 而且默认模式下动作段在前、场景段在后。既然顺序有讲究，就得让人一眼看出哪段是哪段。
const FLOW_SENTENCE_ROLES = [
  { id: 'camera', label: '机位', patterns: [/^the camera\b/i, /\bcamera is (placed|positioned)\b/i, /\bwide-angle\b/i, /\bthe (shot|framing|lens)\b/i] },
  { id: 'scene', label: '场景', patterns: [/^the (scene|room|background|setting|environment|space|street|sky)\b/i, /\bcontains (several|a|an|the)\b/i] },
  { id: 'action', label: '动作', patterns: [/^the character\b/i, /^character\s*[a-z0-9]/i, /^(she|he|they|her|his|their)\b/i, /\b(is|are) (caught|running|leaning|reaching|holding|standing|sitting)\b/i] },
  { id: 'light', label: '光影', patterns: [/\b(light|lighting|sunlight|shadow|shadows|safelight|glow|glare|silhouette)\b/i] },
];

function flowSentenceRole(text) {
  const value = String(text || '').trim();
  for (const role of FLOW_SENTENCE_ROLES) {
    if (role.patterns.some((pattern) => pattern.test(value))) return role;
  }
  return { id: 'prose', label: '描述' };
}

function flowNormalizeTagName(name) {
  return String(name || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function flowMatchSemanticRule(rule, name) {
  if (rule.pattern && rule.pattern.test(name)) return true;
  if (rule.exact && rule.exact.includes(name)) return true;
  if (rule.prefix && rule.prefix.some((prefix) => name.startsWith(prefix))) return true;
  if (rule.suffix && rule.suffix.some((suffix) => name.endsWith(suffix))) return true;
  return false;
}

function flowSemanticOf(name) {
  const normalized = flowNormalizeTagName(name);
  if (!normalized) return 'other';
  for (const rule of FLOW_SEMANTIC_RULES) {
    if (flowMatchSemanticRule(rule, normalized)) return rule.id;
  }
  return 'other';
}

// dictEntry 来自自动补全缓存的那份 danbooru 词典（tag / category / postCount / translation）。
// 查不到不是错误 —— 恰恰是最该标出来的：模型多半也不认识这个词。
function flowClassify(name, dictEntry) {
  const source = dictEntry ? (FLOW_SOURCE_BY_CATEGORY[Number(dictEntry.category)] || 'general') : 'unknown';
  // 画师 / 角色 / 版权本身就是明确类别，不必再套语义规则
  const semantic = source === 'general' || source === 'unknown' ? flowSemanticOf(name) : source;
  return {
    source,
    sourceLabel: FLOW_SOURCE_LABELS[source] || FLOW_SOURCE_LABELS.unknown,
    semantic,
    semanticLabel: flowSemanticLabel(semantic),
    known: Boolean(dictEntry),
    posts: Number(dictEntry?.postCount) || 0,
    zh: String(dictEntry?.translation || '').trim(),
  };
}

function flowSemanticLabel(semantic) {
  return FLOW_SEMANTIC_LABELS[semantic] || FLOW_SOURCE_LABELS[semantic] || FLOW_SEMANTIC_LABELS.other;
}
