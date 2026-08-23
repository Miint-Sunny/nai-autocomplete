// 内置 skill：nai5-prompting。Agent 开箱即用的默认写作规范。
// 用户可以在「写词 → skill」里换成自己的（导入 .md 或直接改正文），内置这份始终保留为兜底。
//
// 正文原样保存，只有查证方式在运行时被 AGENT_RUNTIME_NOTE 覆盖
// （原文是让 grep 本地 CSV，扩展里改成调 search_tags 工具）。

const BUILTIN_AGENT_SKILL = {
  id: 'builtin-nai5-prompting',
  builtin: true,
  name: "nai5-prompting",
  description: "NovelAI Diffusion V5 内容提示词写作完整指南（独立版，无需参考其他文档）。以自然语言为主体、danbooru 标准 tag 作锚点；氛围串（光影/色彩/质量词）按内容自由组合、位置在内容之后。双模式输出——默认紧凑模式（单人动作并入主提示词，多人次要 tag 跟在人物描述后），用户说\"展开\"时用严格分段模式（Character 1: / Character 2: 动作段）。角色栏只写外貌服装，画师串、UC 由用户独立维护不在输出中。当用户要求写 NAI / NovelAI V5 提示词、设计动作场景构图、调整光影色彩氛围、多角色互动、透明背景/文字渲染/漫画分页、排查内容层面出图问题（串味、构图崩坏、画面平、色调不对、tag 被忽略）、查证 danbooru tag 是否存在时使用本 skill，即使没有明确说\"提示词\"也应触发。涉及 `::` 权重语法、自然语言混写、角色栏分工的问题也适用。",
  body: `# NovelAI V5 内容提示词指南

来源：NovelAI 官方 V5 发布博客、用户 328 张 V5 实出图元数据统计、群收集提示词文档、danbooru 标准 tag 词典。适用模型 \`nai-diffusion-5-full\` / \`nai-diffusion-5-curated\`。本 skill 自包含。

覆盖范围：画面内容（构图、动作、场景、光影、色彩、质量词）。画师串与 UC 由用户自行维护，输出中不包含、不重复、不评价。

附带资源：
- [references/examples.md](references/examples.md) — 实测完整范例（双模式 + 氛围串），写 prompt 前先读
- [references/danbooru_all_2.csv](references/danbooru_all_2.csv) — 150,661 个 danbooru 标准 tag，查证用（见第 4 节）

## 1. 用户约定（优先级最高）

### 1.1 权重写法

- 增强使用 \`1.X::tag::\` 数值语法，不使用花括号堆叠。闭合 \`::\` 必须存在；无开头权重的裸 \`tag::\` 视为语法错误。
- 弱化使用 \`0.X::tag::\`（0–1 区间）；\`-N::tag::\` 为负权重，用于定向移除或概念反转（见第 6 节）。

### 1.2 内容分工

1. 角色栏只写角色外貌和服装，不写动作、场景、环境。任何模式下均成立。
2. 动作与场景写在主提示词栏，按双模式组织（见第 1.3 节）。
3. 画师串与 UC 由用户维护。氛围串（光影/色彩/质量词）由本 skill 根据内容需要给出（见第 3 节）。

### 1.3 输出格式（双模式）

**默认模式**（用户只给画面描述）——主提示词一个代码块，紧凑连写：

单人：不拆分 Character 段。人物动作 NL 紧接 tag 骨架，场景环境 NL 在后。
\`\`\`
1girl, solo, full body, dynamic pose, from below.
The character is ...（动作/姿势/运动状态，主语用 The character）
The scene is ...（场景结构、配景、光影）
\`\`\`
- tag 骨架可包含人物相关 tag（\`looking at viewer\`、\`dynamic pose\`、表情/姿势类、关键持有物）。
- 动作段在前、场景段在后，分段换行。

多人：场景段 + 人物动作段（"Character A ... Character B ..."简述动作与空间关系）；次要的修饰 tag（\`blush\`、\`motion lines\` 等）可跟在人物描述之后。
\`\`\`
2girls, full body, dynamic action.
场景 NL。Character A ...。Character B ...。, 次要tag, 次要tag
\`\`\`

**展开模式**（用户明确说"展开"）——严格分段，空行分隔：
\`\`\`
1girl, solo, full body, from below.
场景环境 NL：场景结构、机位、配景、光影（不含角色动作）。

Character 1: 动作/姿势/运动状态/与场景道具的互动。

Character 2:（多人时）同上，写清与 Character 1 的空间关系和道具归属。
\`\`\`

**两种模式共同的输出结构**：
1. 主提示词：一个代码块（格式如上）。不含外貌服装、画师串、UC。
2. 角色外貌栏：独立代码块，只写外貌服装 tag。若本轮未改动且由用户维护，注明"照你自己的角色串"，不重复输出。
3. 构图：单独一行，只写方向（竖图 / 横图 / 超宽 / 方图），不写像素尺寸。
4. 底部：列出不确定的 tag 及删除后的兜底 tag（若有）。没有则不写。

### 1.4 其他约定

- 关键物体写成独立 tag 置于前部，不埋入自然语言短语（\`wooden canoe, reed marsh\` 优于 \`wooden canoe in reed marsh\`）。
- 输出一个确定版本，不并列多个方案。
- 不确定是否存在的 tag：先写入 prompt，在输出底部统一标注，由用户通过输入框的 tag 知识指示圆点确认（圆点越实，模型掌握越好）。查证方法见第 4 节。
- 迭代时每轮修改 2–3 处，说明修改内容及对应问题，不整体重写。
- 首版默认充实密度（约 10 个锚点 tag + 完整 NL 段落），不提供最小骨架；上限为不烧图（单 tag 权重不过高、场景物体不超过约 20 个）。

## 2. Prompt 结构与位置原则

V5 自然语言理解较 4.5 显著提升，提示词长度上限增加。实际写法为三类成分的组合：

| 成分 | 承担内容 | 位置 |
|---|---|---|
| 锚点 tag | 人数、solo、取景、视角、关键物体 | 前部 |
| 自然语言 | 镜头、动作、空间关系、光影叙事、氛围、材质 | 中部 |
| 氛围串 | 光影词、色彩词、质量词 | 后部（内容之后） |

位置原则：prompt 中靠前的成分对画面的影响力更大。内容（构图与主体）置于前部；氛围串置于内容之后，避免压过内容。氛围串的定义与用法见第 3 节。

锚点 tag（模型按 tag 分布理解，稳定性高）：
- 人数：\`1girl\` / \`2girls\` / \`1boy\` / \`3girls\` 等（多人时仅在主提示词开头出现一次）
- \`solo\`
- 取景/视角：\`full body\` \`upper body\` \`close-up\` \`wide shot\` \`cowboy shot\` / \`from below\` \`from above\` \`from side\` \`dutch angle\` 等
- 关键独立物体：\`transparent umbrella\`、\`wooden canoe\` 等
- 特殊 tag：\`transparent background\`、\`high complexity\`、\`location\` 等（见第 8 节）

适合用自然语言表达的内容（tag 体系表达能力不足的部分）：
- 镜头语言：机位、焦距感、景深、透视关系
- 动作、姿势、运动状态
- 空间关系：前后、朝向、视线方向、道具归属
- 光影叙事：光源方向、色温、投影形状、第二光源
- 氛围、质感、材质、天气；带时态的叙事内容

## 3. 氛围串（光影 / 色彩 / 质量词）

实测中光影、色彩、质量词对 V5 出图的影响显著高于 4.5。氛围串指按内容需要临时组合的光影词、色彩词与质量词，不是预先配好的固定组合。

使用原则：
- 从内容反推选词：先确定光源方向、时间、天气、色调，再选词。
- 需要氛围的画面（情绪场景、特定时段、特殊光效）重点给；简单立绘或白底图少给或不给（质量词已由官方预设覆盖）。
- 位置在内容之后；也可将光影词分散写入场景 NL（此种形态不涉及位置问题）。
- 默认不加权，逗号并列即可；只有实测某层效果不足时才对该层加权（如 \`1.2::soft lighting::\`），不为加权而加权。
- 注意：用户画师串中已含 \`-0.6::flat color ::\`、\`year 20XX\` 等固定成分，氛围串不要重复包含这些。

形态示例（不加权并列，置于内容之后）：
\`\`\`
…内容骨架与 NL…, soft natural lighting, soft lighting, golden hour, light blue theme
\`\`\`

按职能分层的词表（每层按需取 0–2 个，不全部堆叠）：

| 层 | 词 |
|---|---|
| 主光方向 | \`sidelighting\` \`backlighting\` \`rim lighting\` \`front lighting\` \`face lighting\` |
| 氛围光 | \`dappled sunlight\` \`komorebi\` \`sunbeams\` \`god rays\` \`golden hour\` \`warm lighting\` \`dim light\` \`cinematic lighting\` \`volumetric lighting\` \`dramatic lighting\` \`soft lighting\` \`soft natural lighting\` |
| 光效 | \`lens flare\` \`bloom\` \`soft bloom\` \`light particles\` \`light leaks\` \`glowing light\` \`bright white light\` \`iridescent highlights\` \`overexposure\` |
| 阴影 | \`intense shadows\` \`soft shadows\` \`drop shadow\` \`cast shadows\` \`tyndall effect\` \`depthness\`（V5 新增） |
| 材质光（特写） | \`shiny skin\` \`glossy skin\` \`skin luster\` \`subsurface scattering\` \`glistening skin\` |
| 渲染系（厚涂/3D 向） | \`ray tracing\` \`global illumination\` \`ambient occlusion\` |
| 镜头景深 | \`bokeh\` \`depth of field\` \`soft focus\` \`blurred background\` \`motion blur\` |
| 色彩基调 | \`pastel colors\` \`vibrant colors\` \`muted colors\` \`high saturation\` \`low saturation\` \`warm colors\` \`bright colors\` \`natural colors\` |
| 主题色 | \`blue theme\` \`light blue theme\` \`pink theme\` \`white theme\` \`green theme\` 等，可叠加 2 个；自由短语亦可（\`creamy pastel colors, pale blue and lavender\`） |
| 限色 | \`limited palette\` \`color grading\` |

选词逻辑（以内容的物理合理性为准，不背场景配方）：
- 每个词都有实际含义，与内容矛盾就是错词。例：\`depth of field\`、\`bokeh\` 是浅景深虚化，用于特写/人像；大场景需要全景清晰，用了反而压掉远景细节。
- 推理路径示例：森林场景 → 光从树冠间隙进入 → \`dappled sunlight\` / \`komorebi\`；傍晚人像 → 光源低且暖 → \`golden hour\` + \`rim lighting\`；厚涂画风 → 需要材质光和渲染质感 → \`subsurface scattering\` / \`ray tracing\`。
- 柔光日常向的实测高频尾（84 次）：\`soft light\`。

质量词：
- \`very aesthetic\`、\`masterpiece\`、\`no text\` 由官方 light 画质预设自动附加，**skill 不输出这些词**。
- 需要更高完成度时存在加权用法，如实测的 \`8::best quality, absurdres, very aesthetic, detailed, masterpiece::\`；是否加权视效果而定。
- 密度控制：正常美图 \`high complexity\`；海报或大场景 \`ultra complexity\`。
- 细节向：\`highly finished\` / \`detailed background\` / \`fine fabric emphasis\` / \`beautiful detailed eyes\` / \`stunning composition\`。

负权重可用于氛围调整（通用项，不含用户串内固定成分）：
- \`-1::monochrome ::\`（画面缺色时反转）
- \`-2::backlighting ::\`（逆光导致面部过暗时）
- \`-2::upscaled, blurry ::\`（通用清理项）

## 4. 锚点 tag 清单与查证

高频锚点：

| 类别 | tag |
|---|---|
| 人数 | \`1girl\` \`2girls\` \`3girls\` \`1boy\` \`2boys\` \`1other\` |
| 单人 | \`solo\` |
| 取景 | \`full body\` \`upper body\` \`lower body\` \`close-up\` \`cowboy shot\` \`wide shot\` \`portrait\` |
| 视角 | \`from below\` \`from above\` \`from side\` \`from behind\` \`dutch angle\` \`foreshortening\` |
| 姿势氛围 | \`dynamic pose\` \`dynamic action\` \`looking at viewer\` |
| 场景 | \`indoors\` \`outdoors\` \`location\`（indoors/outdoors 合集，防止白背景虚空） |
| 背景 | \`simple background\` \`white background\` \`transparent background\` |

\`references/danbooru_all_2.csv\` 列结构：\`tag名, 分类ID, post量, "别名1,别名2", 中文释义, 内置分类, 内置子类\`

查证方法：
\`\`\`bash
grep -i '^foreshortening,' references/danbooru_all_2.csv   # 精确查询存在性与量级
grep '苔藓' references/danbooru_all_2.csv                  # 中文反查英文 tag
grep -i 'ponytail' references/danbooru_all_2.csv | head    # 模糊查找一类 tag
\`\`\`

判读规则：
- post 量（第 3 列）反映模型掌握程度：10 万以上可放心使用；1–10 万正常使用；几千以下建议换近义 tag 或改用自然语言。
- 第 4 列为别名：按直觉写法查不到时，检查它是否为别名，反查标准 tag 名。
- 中文列用于反查。
- CSV 查不到的 tag：先写入 prompt，在底部标注，由用户通过输入框圆点确认。

## 5. 自然语言写作技法

以下句式均来自实测有效样本：

**镜头语言**：按摄影指令的方式书写。
- 机位："The camera is placed extremely low, almost touching the bottom step, using a dramatic wide-angle perspective."
- 透视使用对比句式："One foot is very close to the lens while the rest of her body rapidly recedes into depth."

**运动状态**：描述进行中的状态而非结果。
- "Her body is caught halfway through a natural running motion."
- 衣物头发的被动响应："Her clothing and hair react to the movement and wind rather than hanging motionless."（否定句用于排除静止感有效）

**空间与归属**（多人防串味的主要手段）：
- 成对书写位置："Character A stands at the left side of the room beneath a red safelight. Character B stands farther back on the right side beside an enlarger."
- 道具归属："The umbrella belongs only to Character B."
- 互动绑定同一物体："The tongs visibly grip the edge of the same sheet of photographic paper."

**场景物体**：清单式罗列 + 整体性要求。
- "The darkroom contains several separate chemical trays, bottles, measuring cylinders, clips, hanging prints, an enlarger, a timer, shelves and a small sink."
- 清单后补充："The equipment should remain recognizable and spatially coherent rather than dissolving into abstract machinery."

**光影叙事**：主光源 + 第二光源。
- "The red safelight dominates the room, but a thin strip of neutral light enters beneath the closed door and produces a second subtle lighting direction."
- 投影形状："Strong late-afternoon sunlight creates complicated cast shadows across the steps."

**句法**：
- 主语：默认单人用 "The character"；多人或展开模式用 "Character A/B" 或 "Character 1/2"。
- 一段一个职能：场景、机位、光影、动作各自成段。时态使用现在进行时或一般现在时。

## 6. 权重语法

| 写法 | 效果 |
|---|---|
| \`1.5::rain, night ::\` | 数值强调，直到 \`::\` 结束 |
| \`0.5::coat ::\` | 0–1 区间弱化 |
| \`-1::hat ::\` | 负权重，定向移除或反转概念 |
| \`{tag}\` / \`[tag]\` | 旧语法，仅在识别旧串时参考 |

- 实测常用档位：增强 1.2 / 1.25 / 1.5 / 2；弱化 0.5–0.8；负权重 -1 / -2 / -3。
- 负权重用法：定向移除（\`-1::hat ::\`，不足时加深至 -3）；概念反转（白背景虚空 \`-1::simple background ::, location\`；画面缺色 \`-1::monochrome ::\`）。
- 内容中不期望出现的具体元素直接以负权重写入正文，如 \`-2::nude ::\`。
- \`::\` 可闭合任何未配平的 \`{\` \`[\`。

## 7. 多角色

- V5 使用自由画布定位（在 output viewer 中直接摆放），实测最多 22 个角色同框。prompt 内人物编号/顺序应与画布定位对应。
- 人数 tag 仅在主提示词开头出现一次；角色栏中只写不带数字的 \`girl\` / \`boy\`。
- 默认模式：动作用 "Character A / Character B" 连写简述，次要 tag 跟在人物描述后。展开模式：严格按 \`Character 1:\` / \`Character 2:\` 分段，归属关系写全。
- 复杂互动（多人、动作纠缠、道具交换）即使用户未要求也建议使用展开模式，并在输出中注明原因。
- 串泄漏处理：NL 写死归属；提示用户在该角色 UC 栏排除对方特征；检查人数 tag 未在角色栏重复出现。
- 旧交互语法 \`source#hug\` / \`target#hug\` / \`mutual#hug\` 仍可用，可靠性不稳定，优先使用自然语言。

## 8. 文字渲染与漫画

文字：
- 用引号包裹文字内容，前端自动生成 Text: 块；手动书写 \`Text:\` 块会关闭该自动功能。
- 支持中日英等多语言渲染，长度上限较 4.5 显著增加。
- 文字样式与位置用自然语言描述："A handwritten speech bubble with green text and a white background, floating next to the purple haired girl's head, \\"Hello, world!\\""

漫画：
- 单次生成整页多格漫画：自然语言描述分镜布局（格数、每格内容、阅读顺序），配合角色画布定位。
- 不再限于 2koma。

## 9. 内容向特殊 tag

V5 新增：
- \`transparent background\` — 透明背景；不稳定时 \`2.1::transparent background::\`
- \`has alpha\` — 使用 alpha 通道（较抽象）；\`alpha transparency\` — 场景物体半透明（魔法特效、火焰、伞）
- \`depthness\` — 增加阴影纵深
- \`attractive male\` — 如字面
- \`low complexity\` / \`medium complexity\` / \`high complexity\` / \`ultra complexity\` — 内容复杂度
- \`visual novel bg\` / \`visual novel cg\` / \`visual novel sprite\` — Galgame 风格

沿用：\`location\`（indoors/outdoors 合集）。

## 10. 参数基线（328 张实测统计）

仅在用户询问或排查问题时提供参数建议，不随 prompt 输出。

| 参数 | 建议 | 实测分布 |
|---|---|---|
| Steps | 28–32 | 28 (66%)、32 (24%) |
| Guidance (CFG) | 典型 6.5；风格化可降至 4 | 6.5 (57%)、7 / 4 / 6 次之 |
| Sampler | Euler 系 | k_euler (41%)、k_euler_ancestral (39%)、k_dpmpp_2s_ancestral (11%) |
| Noise Schedule | karras | 绝对主流 |
| Prompt Guidance Rescale | 0.4 为主 | 0.4 (58%)、0、0.2 |

构图输出只写方向（竖图/横图/超宽/方图）。参考对应：竖图 832x1216 / 960x1408 / 1024x1536，方图 1024x1024，横图 1536x1024。

## 11. 排查速查

| 症状 | 处理 |
|---|---|
| tag 被忽略 | 提权重 / 移到前部 / 拆成独立 tag / 改用自然语言整句描述 |
| 画面平、缺少层次 | 氛围串补充光影层（主光方向 + 阴影形状）；色彩层次差加主题色 |
| 色调不符 | 加主题色 tag 或 \`limited palette\`；色彩词前移 |
| 逆光面部过暗 | \`-2::backlighting ::\` 或补充 \`front lighting\` / \`face lighting\` |
| 角色白背景虚空 | \`-1::simple background ::, location\` |
| 多角色特征串味 | 改展开模式写死归属 + 编号对应定位 + 检查人数 tag 位置 |
| 动作僵硬 | 动作改用 NL 描述进行中的状态 + 衣物头发被动响应 |
| 场景糊成抽象物 | 清单后补整体性要求句 |
| 透视不对 | 机位 + 对比句式 |
| 文字不出/出错 | 引号包裹 + NL 描述位置样式 |
| 透明背景不稳 | \`2.1::transparent background::\` |
| 固定物体始终画不对 | 模型知识盲区，更换构图思路而不是堆 tag |
| tag 不确定 | grep CSV 词典；查不到则先写入并底部标注，输入框圆点确认 |

## 12. 输出流程汇总

1. 判断模式：用户只给画面描述 → 默认模式；用户说"展开" → 展开模式；多人复杂互动可主动使用展开模式并注明原因。
2. 主提示词（一个代码块）：
   - 默认单人：tag 骨架（可含人物 tag）+ 动作 NL（The character，在前）+ 场景光影 NL（在后）。
   - 默认多人：tag 骨架 + 场景 NL + Character A/B 动作简述 + 次要 tag 收尾。
   - 展开模式：tag 骨架 + 纯场景 NL，空行后 \`Character 1:\` / \`Character 2:\` 动作段。
   - 需要氛围时：氛围串加权块置于内容之后，或散入场景 NL（第 3 节）。
3. 角色外貌栏：独立代码块，只写外貌服装 tag；用户维护且本轮未改时注明"照你自己的角色串"。
4. 构图：单独一行，只写方向。
5. 底部：不确定的 tag（若有）+ 兜底方案。
6. 输出一个确定版本；迭代时说明修改了哪 2–3 处、针对什么问题。`,
  references: [
    {
      name: 'examples.md',
      content: `# V5 内容 prompt 完整范例（双模式，源自实测出图改写）

结构：主提示词（一个代码块）→ 角色外貌栏 → 构图短行。默认模式紧凑连写，展开模式严格分段。

## 范例 1：单人动态场景 · 默认模式（xlsx 中最常见的形态）

**主提示词：**
\`\`\`
1girl, solo, full body, dynamic pose, from below.
The character is running down a long outdoor concrete staircase toward the camera. One foot is very close to the lens while the rest of her body rapidly recedes into depth. Her body is caught halfway through a natural running motion. One hand is reaching toward the handrail while the other arm swings backward. Her clothing and hair react to the movement and wind rather than hanging motionless.
The staircase continues far upward behind her, surrounded by utility poles, tangled electrical cables, retaining walls and densely packed houses on a steep hillside.
The camera is placed extremely low, almost touching the bottom step, using a dramatic wide-angle perspective. Strong late-afternoon sunlight creates complicated cast shadows across the steps.
\`\`\`

**角色外貌栏：**
\`\`\`
girl, petite, side swept bangs, silver blue hair, sea blue eyes, long hair, wispy bangs, long side locks, cat girl, cat tail, cat ears, 1.5::side ponytail::, mint leaf shape hairclip, white inner ear fluff, medium breasts,
japanese school uniform, serafuku, white shirt, white sailor collar with navy blue double trims, navy blue crossed ribbon bowtie, 1.2::grey cardigan::, oversized cardigan, 1.2::white pleated skirt,:: striped skirt, navy blue trim on skirt, white sheer thighhigh,
\`\`\`

**构图：** 推荐竖图

要点：
- 人物进主 tag：\`dynamic pose\` 直接进骨架；动作 NL 用 "The character" 打头紧接骨架，场景、机位、光影依次在后。
- 动作写"进行中"状态 + 衣物被动响应 + 透视对比句。

## 范例 2：单人简单构图 · 默认模式

**主提示词：**
\`\`\`
1girl, solo, upper body, close-up, looking at viewer, simple background, white background, colored lineart.
The character faces the viewer with a happy expression, mouth open, one hand raised in a claw pose near her face. Soft even lighting, minimal composition.
\`\`\`

**角色外貌栏：** 照用户自己的角色串（如角色有版权名，放角色栏加权：\`1.2::rossi_(arknights)::\`）

**构图：** 推荐竖图

要点：构图简单时 NL 一两句即可，人物 tag（\`looking at viewer\`）全部进骨架。

## 范例 3：双人互动 · 默认模式（次要 tag 收尾）

**主提示词：**
\`\`\`
2girls, full body, wide shot, highly detailed interior.
Two characters are working in a small cluttered photography darkroom. The darkroom contains several separate chemical trays, bottles, measuring cylinders, clips, hanging prints, an enlarger, a timer, shelves and a small sink. The equipment should remain recognizable and spatially coherent rather than dissolving into abstract machinery.
Character A stands at the left side of the room beneath the red safelight, using metal tongs to lift a photographic print from a developing tray. Character B stands farther back on the right side beside the enlarger, adjusting one of its knobs with one hand while holding a strip of photographic negatives in the other.
The red safelight dominates the room, but a thin strip of neutral light enters beneath the closed door and produces a second subtle lighting direction.
, -1::blush,:: motion lines
\`\`\`

**构图：** 推荐竖图

要点：
- 默认多人：场景 → Character A/B 动作简述 → 光影，次要 tag（\`-1::blush::\`、\`motion lines\`）跟在人物描述后收尾。
- 两角色外貌仍走各自角色栏（见范例 4），用带权重对撞特征防串味。

## 范例 4：双人互动 · 展开模式（用户说"展开"时）

**主提示词：**
\`\`\`
2girls, wide shot, highly detailed interior.
The scene is a small cluttered photography darkroom. The darkroom contains several separate chemical trays, bottles, measuring cylinders, clips, hanging prints, an enlarger, a timer, shelves and a small sink. The equipment should remain recognizable and spatially coherent rather than dissolving into abstract machinery.
The red safelight dominates the room, but a thin strip of neutral light enters beneath the closed door and produces a second subtle lighting direction.

Character 1: She stands at the left side of the room beneath the red safelight, using metal tongs to lift a photographic print from a developing tray. The tongs visibly grip the edge of the sheet of photographic paper.

Character 2: She stands farther back on the right side beside the enlarger, adjusting one of its knobs with one hand while holding a strip of photographic negatives in the other. She is watching Character 1's work.
\`\`\`

**角色外貌栏（char1 / char2 两块，只写外貌服装）：**
\`\`\`
girl, petite, silver blue hair, sea blue eyes, long hair, side swept bangs, cat girl, cat ears, cat tail, 1.5::side ponytail::, white inner ear fluff,
japanese school uniform, serafuku, white shirt, navy blue crossed ribbon bowtie, 1.2::grey cardigan::, 1.2::white pleated skirt,:: white sheer thighhigh,
\`\`\`
\`\`\`
girl, loli, vampire, small fangs, 1.2::glowing ice-blue long hair::, disheveled hair, wispy bangs, 1.2::crimson eyes, star-shaped pupils::, 1.2::blue and white cat ears::, pointy ears, black ribbon choker, neck bell,
serafuku, 1.3::dark purple and white color scheme::, 1.3::dark purple sailor collar, silver star embroidery::, 1.2::crimson neckerchief::, 1.3::dark purple pleated skirt::, black thighhighs, dark brown loafers, leather school bag, 1.1::small bat charm on bag::,
\`\`\`

**构图：** 推荐竖图

要点：
- 展开模式场景段纯净（零动作），动作全部进 Character 段，归属限定写死（"the same sheet"、"watching Character 1's work"）。
- Character 编号 = 角色栏顺序 = 画布定位，三者对应。
- 复杂互动、动作纠缠、道具交换的场景优先用展开模式。

## 角色外貌栏通用结构

按层写：基础（体型/年龄感）→ 发型 → 眼睛 → 特殊特征（兽耳/尾巴等）→ 服装（整体→上装→下装→袜→鞋→配饰）。关键特征带数值权重：

\`\`\`
girl, petite, [发型tag...], [眼睛tag...], [特征tag 可加权...],
[服装整体tag], [上装 可加权...], [下装 可加权...], [袜/鞋/配饰...],
\`\`\`

只写外貌服装——动作、场景元素一律不进角色栏；表情状态用 NL 写在主提示词动作部分。

## 范例 5：氛围串殿后（8.22 新图实测，按内容优先原则调整位置）

内容骨架在前、氛围词不加权殿后——柔光卧室场景：

\`\`\`
1girl, solo, relaxed, bedroom, window, vines, floating_curtains, blush, couch, full body, indoors, looking at viewer, plant, potted plant, fluffy carpet, on_couch, view outside the window, day, straight-on, cowboy_shot, light_smile, hand near face, soft natural lighting, cinematic composition, soft lighting, best lighting, light blue theme, face lighting, front lighting
\`\`\`

要点：
- prompt 前部影响力最大，内容骨架（人数/场景/动作）占前部；氛围词放在内容之后，服务于内容。
- 默认不加权，逗号并列即可；只有实测效果不足时才对个别层加权。
- 氛围词内部分层：主光（soft natural lighting）+ 总评（best lighting）；主题色 \`light blue theme\` 定整图色调；\`face lighting, front lighting\` 指人物受光。
- \`very aesthetic\`、\`masterpiece\` 等由官方 light 画质预设自动附加，不写入 prompt；\`high complexity\` 之类的密度词按需给。`,
    },
  ],
};
