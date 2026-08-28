# 提示词 Agent

按一份可替换的 skill 把中文画面描述写成 NovelAI 提示词，界面是一条**对话流**：发送 → 回复 → 在回复的基础上继续提。**只写提示词，不碰生成** —— 扩展里没有、也不会加任何触发出图的入口，结果也**不自动填入**，全部由回复卡片上的按钮写进输入框。

入口有两个，共用同一份界面与状态：反推面板的「写词」页，以及 novelai.net/image 工作台抽屉的「写词」窗口。

## 1. 一轮对话的流程

```
中文需求（对话输入框 → 发送）
 └ 本地预检：拿词典的中文释义反查，捞出一批「确定存在且模型掌握得好」的 tag
    └ runLlmToolLoop（js/background/06-llm-runner.js）
       ├ system   = skill 正文 + 参考资料 + 运行环境补充 + 规则核对（V5 / V4.5 按格式档二选一）
       ├ …历史…   = 之前的对话原样进 messages（最近 6 条、每条截 4000 字）
       ├ user     = 本轮需求 + 生成方式 + 角色栏数量 + 知识源 + 预检结果
       └ 模型不确定时调 search_tags 补查，最多 4 步
          └ 回复进对话流：代码框抽成卡片（填入 / 追加 / 改词 / 复制），散文留作说明
```

两道保险是有意的：预检省掉模型一轮轮试探性查证，工具兜住预检没覆盖到的词。

对话存在 `chrome.storage.local['nai-agent-conversation']`（只存 role / text / meta，卡片加载时重算），保留最近 24 条，「清空」开新对话。失败或取消的那轮会把刚发的消息撤回来，草稿留在输入框里。发送失败等反馈走面板顶部的全局状态条 —— 它对每一页可见，空了自动隐藏。

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

## 3. 提示词格式（V5 / V4.5）与生成方式

设置「提示词」段首有一个**提示词格式**档（`naiDialect`，默认 V5）：

| 档 | 路线 |
|---|---|
| **NAI V5** | 锚定的 danbooru tag + 自然语言句子混写 —— tag 定住硬事实，句子讲动作、互动、空间与光线 |
| **NAI V4.5** | 纯 tag 路线（Jun 29 那个时代的用法）：danbooru 查证优先，自然语言只补 tag 说不清的关系 |

跟着这个档走的有三处：写词的档位措辞（`AGENT_MODES.v5` / `.v45`）、附带的规则核对（下一节）、
以及内置反推预设 —— 档位切换时若当前预设正是 `nai-v5` / `nai-v4` 这对内置项，会自动跟着换，
用户自选的预设不碰。

`AGENT_MODES`（[js/background/08-agent.js](./js/background/08-agent.js)）四档 × 两套措辞，界面上是一条分段控件：

| 档 | V5 | V4.5 |
|---|---|---|
| 默认 | 锚定 tag 定硬事实 + 自然语言讲互动，混写 | tag 为主体、逐个查证，自然语言只补说不清的关系 |
| 展开 | 主提示词用自然语言讲透站位与互动，另给 Character 1、2… 角色栏 | 主提示词用精确 tag 交代构图与互动，角色栏最多 6 个 |
| 改写 | 整理、纠错、补齐，原样保留用户写下的内容与权重 | 同左，另把不合 danbooru 标准的写法修正 |
| 精简 | 优先精炼 tag，说不清才补一句 | 只输出查证过的 tag，不写句子 |

**措辞只写在后台**，前端只传档位名和格式档 —— 按钮上写的和发出去的永远是同一处文案。

改写档改的是「已经存在的那份提示词」。切过去时如果「当前提示词」没勾、对话里也没有上一轮版本，
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
| 导入 | 展开一个导入盒子：选 .md（可多选）或者直接粘一段进去，落在**同一个可编辑的文本域**里，看清楚解析出什么了再按「导入」 |
| 编辑正文 | 内置 skill 是只读的，保存时自动另存为你自己的一份并切过去，内置那份始终留着兜底 |
| 导出 | 把当前 skill 存成 .md（参考资料要单独保存） |
| 删除 | 内置的删不掉 |

导入盒子和「设置 → 提示词 → 导入酒馆预设」是**同一个组件**（[js/assistant/22-import-box.js](./js/assistant/22-import-box.js)），
两处的结构、样式、交互一模一样，只有「接受什么格式」「怎么解析」两处不同。

多选进来的文件在文本域里用 `<!-- nai-file: 名字 -->` 分隔：带 frontmatter `name:` 的那份当正文，
其余当参考资料 —— 不要求用户按顺序选。**把分隔行删掉就是把两份并成一份**，这也是直接粘一整段时的形态。

选文件优先走 File System Access（`showOpenFilePicker`），它认 `id`，
所以**下次点开还在上次那个文件夹**；非安全上下文或者被页面权限策略挡住时回退到 `<input type="file">`。

skill 存在 `chrome.storage.local['nai-agent-skills']`，当前选择存 `['nai-agent-active-skill']`。

### 运行环境补充

skill 原文是按「有 shell、能 grep 本地 CSV」写的。扩展里没有 shell，所以 `AGENT_RUNTIME_NOTE` 会追加在 system 末尾，把查证方式改成调 `search_tags`，并声明它优先级高于 skill 里的查证章节。**换自己的 skill 时不用管这段，它是自动加的。**

### 规则核对（V5 / V4.5 二选一）

`AGENT_NAI5_NOTE` / `AGENT_NAI45_NOTE` 跟在运行环境补充后面，按「提示词格式」二选一自动追加。
V4.5 那份是纯 tag 路线的能力边界：tag 先查证再用、角色栏上限 6 个、站位靠网站的 5×5 位置控件、
不认识 V5 的新 tag。V5 那份是 V5 的官方公开规则：

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
所以设置的「发送与输出」里留了开关（「给写词附带目标版本的规则核对」），默认开。
内置 skill 是按 V5 写的；选 V4.5 档时规则核对会把输出拉回 tag 路线，
但更对路的做法是导入一份按 V4 时代写的 skill。

## 5. 知识源 —— 让它能「改」而不只是能「写」

skill 第 1.4 节写着「迭代时每轮修改 2–3 处，说明修改内容及对应问题，不整体重写」。这条规则靠两件事成立：

**对话历史自动带上。** 之前的问答原样进 messages（`buildAgentHistoryMessages`，最近 6 条、每条截 4000 字），
模型直接看见自己上一轮说过什么 —— 所以旧版那个要手动勾的「上一轮结果」知识源没有了，
多轮追加就是接着说话。带历史的那轮，user 文本里会点明「这是对话的延续，只动需要动的地方」。

**可勾选的知识源**只剩三类，**没勾的一个字都不发**：

| 知识源 | 内容 | 作用 |
|---|---|---|
| 当前提示词 | 网站输入框里的现值 | 以输入框现值为迭代基准：只改 2~3 处并说明改了什么 |
| 词库角色 | 词库里的 `char:` 条目 | 描述里点到名字就直接用现成的串，不让模型另编外貌 —— 见下 |
| 画师库 | 画师库当前页的画师（按星级排） | **默认不写进输出** —— skill 明说画师串由用户维护。只有用户问起才引用 |

每类都有截断和条数上限（正文 4000 字、画师 120 条、角色 16 条），不会把请求撑爆。

画师那条上限管的是**单个画师条目**，不是整条画师串。画师库按家族分页，一页上百个画师是常态，
所以上限要能装下**整整一页** —— 曾经是 24，最大的一页会被砍掉八成，
而**截断的一页比不发更糟**：模型会以为那一页就只有这几个画师。

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

只看**本轮**用户自己写的字，不看知识源、也不看对话历史 ——
否则上一轮出现过的名字会把角色一直粘着带下去，用户换了人也甩不掉。

筛选在**后台**做，不在面板：面板先截断的话，用户正好点到的那个可能已经被截掉了。

> 两份 `normalizePromptLibraryEntry`（content 一份、assistant 一份）都要认 `aliases`。
> 少认一份，用户在那一侧存一次词条别名就静悄悄没了 —— `scripts/test-build.mjs` 守着这条。

## 6. 输出怎么用

模型按 skill 的规范返回 markdown，回复进对话流：代码框抽成卡片（第一个是主提示词，之后是角色外貌），
其余散文直接排在卡片上方 —— 构图方向、不确定 tag 的标注都在那里。模型没按格式给代码框时，
整段回复就当唯一一块，填入 / 复制永远有的按。

- 主提示词块：**填入**（整段替换网站输入框）/ **追加**（逗号接在已有内容后）/ **改词**（送去流编辑器）/ **复制**
- 角色块：**填入 Character n** / **复制**
- 多块回复末尾有 **全部填入**：主提示词写进输入框 + 角色块逐个填进 Character 栏

找输入框和写入的逻辑与画师库共用 `writePromptFieldValue()`（[js/assistant/16-artist-quick.js](./js/assistant/16-artist-quick.js)）：走原生 setter + `input` 事件，否则 React 那边的状态不会跟着更新。

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

和 LLM 服务共用 [scripts/lib/background-sandbox.mjs](./scripts/lib/background-sandbox.mjs)，跑的是真正上线的那份代码。覆盖预检口径、词典查证、消息装配、生成方式分档（V5 / V4.5 两套）、角色栏数量、规则核对二选一、对话历史注入与裁剪、OC 点名、工具回路、主备切换和取消。

别名的归一化在 [scripts/test-content.mjs](./scripts/test-content.mjs)（content 侧那份 normalize）。

另有一条打包不变量：

```bash
node scripts/test-build.mjs
```

它断言**产物逐字包含每个源 chunk**。这条不是形式主义 —— bundler 曾经给每行加两个空格做缩进，于是多行模板字符串（默认提示词、内置 skill 正文）里的内容被逐行插进两个空格，markdown 对行首空白是敏感的。
