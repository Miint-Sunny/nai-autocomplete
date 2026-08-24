# 提示词 Agent

按一份可替换的 skill 把中文画面描述写成 NovelAI 提示词。**只写提示词，不碰生成** —— 扩展里没有、也不会加任何触发出图的入口。

入口有两个，共用同一份界面与状态：反推面板的「写词」页，以及 novelai.net/image 工作台抽屉的「写词」窗口。

## 1. 一次写作的流程

```
中文需求
 └ 本地预检：拿词典的中文释义反查，捞出一批「确定存在且模型掌握得好」的 tag
    └ runLlmToolLoop（js/background/06-llm-runner.js）
       ├ system = skill 正文 + 参考资料 + 运行环境补充 + V5 规则核对
       ├ user   = 需求 + 生成方式 + 角色栏数量 + 角色串 + 知识源 + 预检结果
       └ 模型不确定时调 search_tags 补查，最多 4 步
          └ 结果：markdown 回复 → 抽出代码框 → 复制 / 写入 / 追加
```

两道保险是有意的：预检省掉模型一轮轮试探性查证，工具兜住预检没覆盖到的词。

## 2. 词典从哪来

复用自动补全已经缓存的那份 danbooru 数据 —— `chrome.storage.local['nai-ac-tags']`，含 `postCount` 和中文释义。**没有再往扩展里塞一份 6MB CSV。**

代价是：用户从没打开过 novelai.net 时缓存是空的。这种情况 `search_tags` 返回一条可执行的说明（去开一次 novelai.net，本轮先按常识写并在底部标注不确定的 tag），而不是一个空数组让模型瞎猜。

预检的两条口径（`prefilterAgentTags`）：

- 中文侧要求释义 **≥ 2 字** —— 「手」「光」「雨」这种单字释义命中率太高，全是噪音。
- 英文侧用**两端加空格的整词匹配** —— 多词 tag（`cowboy shot`）能正确命中，`art` 不会撞进 `artist_name`。
- 两侧都要求 `postCount ≥ 400`，量太低的 tag 模型本身也画不准。

### 本地查不到时问 danbooru

本地那份是**快照**：冷门 tag、新 tag、以及已经被合并掉的旧写法都查不到 —— 而这几类恰恰是模型最容易编错的。
所以 `search_tags` 是两级的：本地命中直接返回；**本地未命中**的词才走
[js/background/10-danbooru.js](./js/background/10-danbooru.js) 实时问一次。

两条通道，不用第三方中转（那等于把查询内容送给别人）：

1. **后台直连** —— `host_permissions` 是 `<all_urls>`，不受 CORS 限制
2. **借用户自己打开着的 danbooru 标签页** —— 同源请求会带上他的 cookie，限流额度更高

三条自律：

- **只在本地未命中时查**，加上 10 分钟结果缓存 —— danbooru 的礼节是别超 10 请求/秒
- **查询串必须长得像 tag**（`/^[a-z0-9_().\-'!:]+$/`）。用户的中文描述整段送出去是不可接受的
- **任何一步失败都返回 `null`** —— 查证是加分项，不该让整轮生成挂掉

别名会被解析：模型写出废弃写法时，回的是「`catgirl` 已合并到 `cat_girl`，请用后者」，比一句 `not_found` 有用得多。
开关在设置的「发送与输出」，默认开。

## 3. 生成方式与角色栏数量

`AGENT_MODES`（[js/background/08-agent.js](./js/background/08-agent.js)）四档，界面上是一条分段控件：

| 档 | 干什么 |
|---|---|
| 默认 | tag 骨架 + 精确自然语言，多人时另给各自的外观栏 |
| 展开 | 主提示词讲清动作、站位、层次与互动，另外严格输出 Character 1、2… 独立角色栏 |
| 改写 | 整理、纠错、补齐用户已有的提示词，原样保留用户写下的内容与数字权重 |
| 精简 | 优先给准确、精炼的 tag，说不清的关系才补一两句自然语言 |

**措辞只写在后台**，前端只传档位名。以前是前端一句「本轮使用展开模式」——
按钮上写的和发出去的是两处文案，改一处就不一致。

改写档改的是「已经存在的那份提示词」。切过去时如果「当前提示词」和「上一轮结果」一个都没勾，
会自动勾上「当前提示词」并在状态条说一声 —— 自动勾是**看得见**的，那颗 chip 会亮起来。

「角色栏」是 0~6 的分段控件，0 = 自动。选了就会要求模型**正好**输出那么多个角色栏，
并按 Character 1 到 Character N 排。这个 1~6 是我们快捷填入栏位的数量，
**不是 NovelAI 的模型上限** —— 这句话在发出去的文本里也写着，免得模型自己把它当限制。

## 4. skill 是什么

一份带 YAML frontmatter 的 markdown，外加若干参考资料：

```markdown
---
name: nai5-prompting
description: 什么时候该用这份 skill
---

# 正文……
```

内置的是 nai5-prompting（[js/assistant/17-agent-skill-builtin.js](./js/assistant/17-agent-skill-builtin.js)，正文与 references/examples.md 逐字保存）。

**替换方式**（「写词 → skill」）：

| 操作 | 说明 |
|---|---|
| 导入 .md | 可多选。带 frontmatter `name:` 的当正文，其余当参考资料 —— 不要求用户按顺序选 |
| 编辑正文 | 内置 skill 是只读的，保存时自动另存为你自己的一份并切过去，内置那份始终留着兜底 |
| 导出 | 把当前 skill 存成 .md（参考资料要单独保存） |
| 删除 | 内置的删不掉 |

skill 存在 `chrome.storage.local['nai-agent-skills']`，当前选择存 `['nai-agent-active-skill']`。

### 运行环境补充

skill 原文是按「有 shell、能 grep 本地 CSV」写的。扩展里没有 shell，所以 `AGENT_RUNTIME_NOTE` 会追加在 system 末尾，把查证方式改成调 `search_tags`，并声明它优先级高于 skill 里的查证章节。**换自己的 skill 时不用管这段，它是自动加的。**

### NovelAI V5 规则核对

`AGENT_NAI5_NOTE` 跟在运行环境补充后面，同样是自动追加的，内容是 V5 的官方公开规则：

- 加权只用分段语法 `1.2::tag::` / `0.8::tag::`，V4.5+ 支持负权重；**每个权重必须闭合**
- tag 与自然语言可以混写，官方支持英文和日文，输出主体一律英文
- 主提示词管画面与互动，独立角色栏只管外观（用来减少特征串色）
- **否掉 V4 文档里「最多六人」和 5×5 网格那套旧限制** —— V5 改进了自由角色定位
- 画面文字用双引号原样标出，并说明字体、位置、载体；不要自己造 `Text:` 区块
- 两种透明别混：整图透明背景是 `transparent background` + `has alpha`，
  伞/火焰/玻璃这类物体半透明但保留背景是 `alpha transparency` + `has alpha`
- 新 tag `depthness` / `attractive male` / `low|medium|high|ultra complexity` / `has alpha`，
  只在与画面直接相关时用，别当固定质量尾词

**为什么不写进内置 skill：**

1. 换成自己的 skill 时它照样生效 —— 用户手上那份多半是按 V4 写的
2. 它是官方文档里的事实，不属于任何一份 skill 的私有内容
3. `17-agent-skill-builtin.js` 是不动的（见 [CLAUDE.md](./CLAUDE.md)）

冲突时以这段为准：skill 管写作风格，这段管模型的能力边界。出了新版本模型它就会过时，
所以设置的「发送与输出」里留了开关，默认开。

## 5. 知识源 —— 让它能「改」而不只是能「写」

skill 第 1.4 节写着「迭代时每轮修改 2–3 处，说明修改内容及对应问题，不整体重写」。这条规则以前**永远触发不了** —— Agent 根本看不见上一版长什么样。

现在请求可以带上四类上下文，逐项勾选，**没勾的一个字都不发**：

| 知识源 | 内容 | 作用 |
|---|---|---|
| 当前提示词 | 网站输入框里的现值 | 本轮变成迭代：只改 2~3 处并说明改了什么 |
| 上一轮结果 | Agent 上一次给的版本 | 多轮追加：「上一版不错，把光影再压一点」 |
| 词库角色 | 词库里的 `char:` 条目 | 描述里点到名字就直接用现成的串，不让模型另编外貌 —— 见下 |
| 画师库 | 画师库当前页的画师（按星级排） | **默认不写进输出** —— skill 明说画师串由用户维护。只有用户问起才引用 |

每类都有截断和条数上限（正文 4000 字、画师 24 条、角色 16 条），不会把请求撑爆。

这套分法学自 Ultimate_Novelai_launcher 的 Agent 请求形状（images / caller history / knowledge-source selection / artist-OC context / current whole-per-character prompts），逻辑参考，代码是重写的。

### OC 角色：写到名字就等于点名

参考实现给 OC 单开了一个库。我们**不另起一套数据** —— 词库的 `char:` 分类本来就是干这个的，
只在它上面加两件事：

1. **别名**（`aliases`）。词库编辑区多一栏「别名」，只在分类是「角色」时出现。
   逗号、顿号、分号、换行都能分隔，去重去空，最多 8 条、每条 40 字。
2. **点名匹配**（`findMentionedAgentCharacters`）。描述里写到名字或别名 → 只发这几个角色，
   并按**出现的先后**直接指派 `Character 1`、`Character 2`…；一个都没点到才退回原来的整份列表。

匹配口径分两套：纯 ASCII 的名字**卡词边界**（`ray` 不能被 `array`、`x-ray` 带出来），
中日文没有词边界这回事，只能直接子串。

只看用户自己写的字（需求 + 角色外貌串 + 补充要求），**不看知识源** ——
否则「上一轮结果」里出现过的名字会把角色一直粘着带下去，用户换了人也甩不掉。

筛选在**后台**做，不在面板：面板先截断的话，用户正好点到的那个可能已经被截掉了。

> 两份 `normalizePromptLibraryEntry`（content 一份、assistant 一份）都要认 `aliases`。
> 少认一份，用户在那一侧存一次词条别名就静悄悄没了 —— `scripts/test-build.mjs` 守着这条。

## 6. 输出怎么用

模型按 skill 的规范返回 markdown。界面把其中的代码框抽出来单独成卡片：第一个是主提示词，第二个是角色外貌，每张卡片三个按钮：

- **复制** — 到剪贴板
- **写入** — 整段替换当前页面的提示词框
- **追加** — 以逗号接在已有内容之后

找输入框和写入的逻辑与画师库共用 `writePromptFieldValue()`（[js/assistant/16-artist-quick.js](./js/assistant/16-artist-quick.js)）：走原生 setter + `input` 事件，否则 React 那边的状态不会跟着更新。

底下的「完整回复」保留原始 markdown —— 构图方向、不确定 tag 的标注都在那里。

## 7. 文件

| 文件 | 职责 |
|---|---|
| [js/background/08-agent.js](./js/background/08-agent.js) | 词典索引、预检、`search_tags` 工具、消息装配、跑工具循环 |
| [js/assistant/17-agent-skill-builtin.js](./js/assistant/17-agent-skill-builtin.js) | 内置 skill 数据 |
| [js/assistant/18-agent-skills.js](./js/assistant/18-agent-skills.js) | skill 仓库：解析、存取、导入、编辑、导出 |
| [js/assistant/19-agent.js](./js/assistant/19-agent.js) | 界面：markup、渲染、事件、发起写作 |
| [js/assistant/21-nai-character-fields.js](./js/assistant/21-nai-character-fields.js) | 把角色栏结果填进网页的 Character 1~6 |
| [styles/07-agent.css](./styles/07-agent.css) | 布局（外观一律套既有 class，见 [STYLE.md](./STYLE.md)） |

LLM 那一层的分工见 [LLM.md](./LLM.md)。Agent 不自己发 HTTP，主备切换、重试、取消全部走同一套。

## 8. 测试

```bash
node scripts/test-agent.mjs
node scripts/test-danbooru.mjs
```

和 LLM 服务共用 [scripts/lib/background-sandbox.mjs](./scripts/lib/background-sandbox.mjs)，跑的是真正上线的那份代码。覆盖预检口径、词典查证、消息装配、生成方式分档、角色栏数量、V5 规则核对、OC 点名、工具回路、主备切换和取消。

别名的归一化在 [scripts/test-content.mjs](./scripts/test-content.mjs)（content 侧那份 normalize）。

另有一条打包不变量：

```bash
node scripts/test-build.mjs
```

它断言**产物逐字包含每个源 chunk**。这条不是形式主义 —— bundler 曾经给每行加两个空格做缩进，于是多行模板字符串（默认提示词、内置 skill 正文）里的内容被逐行插进两个空格，markdown 对行首空白是敏感的。
