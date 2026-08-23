# 提示词 Agent

按一份可替换的 skill 把中文画面描述写成 NovelAI 提示词。**只写提示词，不碰生成** —— 扩展里没有、也不会加任何触发出图的入口。

入口有两个，共用同一份界面与状态：反推面板的「写词」页，以及 novelai.net/image 工作台抽屉的「写词」窗口。

## 1. 一次写作的流程

```
中文需求
 └ 本地预检：拿词典的中文释义反查，捞出一批「确定存在且模型掌握得好」的 tag
    └ runLlmToolLoop（js/background/06-llm-runner.js）
       ├ system = skill 正文 + 参考资料 + 运行环境补充
       ├ user   = 需求 + 模式 + 角色串 + 预检结果
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

## 3. skill 是什么

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

## 4. 知识源 —— 让它能「改」而不只是能「写」

skill 第 1.4 节写着「迭代时每轮修改 2–3 处，说明修改内容及对应问题，不整体重写」。这条规则以前**永远触发不了** —— Agent 根本看不见上一版长什么样。

现在请求可以带上四类上下文，逐项勾选，**没勾的一个字都不发**：

| 知识源 | 内容 | 作用 |
|---|---|---|
| 当前提示词 | 网站输入框里的现值 | 本轮变成迭代：只改 2~3 处并说明改了什么 |
| 上一轮结果 | Agent 上一次给的版本 | 多轮追加：「上一版不错，把光影再压一点」 |
| 词库角色 | 词库里的 `char:` 条目 | 用户点名角色时直接用现成的串，不让模型另编外貌 |
| 画师库 | 画师库当前页的画师（按星级排） | **默认不写进输出** —— skill 明说画师串由用户维护。只有用户问起才引用 |

每类都有截断和条数上限（正文 4000 字、画师 24 条、角色 16 条），不会把请求撑爆。

这套分法学自 Ultimate_Novelai_launcher 的 Agent 请求形状（images / caller history / knowledge-source selection / artist-OC context / current whole-per-character prompts），逻辑参考，代码是重写的。

## 5. 输出怎么用

模型按 skill 的规范返回 markdown。界面把其中的代码框抽出来单独成卡片：第一个是主提示词，第二个是角色外貌，每张卡片三个按钮：

- **复制** — 到剪贴板
- **写入** — 整段替换当前页面的提示词框
- **追加** — 以逗号接在已有内容之后

找输入框和写入的逻辑与画师库共用 `writePromptFieldValue()`（[js/assistant/16-artist-quick.js](./js/assistant/16-artist-quick.js)）：走原生 setter + `input` 事件，否则 React 那边的状态不会跟着更新。

底下的「完整回复」保留原始 markdown —— 构图方向、不确定 tag 的标注都在那里。

## 6. 文件

| 文件 | 职责 |
|---|---|
| [js/background/08-agent.js](./js/background/08-agent.js) | 词典索引、预检、`search_tags` 工具、消息装配、跑工具循环 |
| [js/assistant/17-agent-skill-builtin.js](./js/assistant/17-agent-skill-builtin.js) | 内置 skill 数据 |
| [js/assistant/18-agent-skills.js](./js/assistant/18-agent-skills.js) | skill 仓库：解析、存取、导入、编辑、导出 |
| [js/assistant/19-agent.js](./js/assistant/19-agent.js) | 界面：markup、渲染、事件、发起写作 |
| [styles/07-agent.css](./styles/07-agent.css) | 布局（外观一律套既有 class，见 [STYLE.md](./STYLE.md)） |

LLM 那一层的分工见 [LLM.md](./LLM.md)。Agent 不自己发 HTTP，主备切换、重试、取消全部走同一套。

## 7. 测试

```bash
node scripts/test-agent.mjs
```

和 LLM 服务共用 [scripts/lib/background-sandbox.mjs](./scripts/lib/background-sandbox.mjs)，跑的是真正上线的那份代码。覆盖预检口径、词典查证、消息装配、工具回路、主备切换和取消。

另有一条打包不变量：

```bash
node scripts/test-build.mjs
```

它断言**产物逐字包含每个源 chunk**。这条不是形式主义 —— bundler 曾经给每行加两个空格做缩进，于是多行模板字符串（默认提示词、内置 skill 正文）里的内容被逐行插进两个空格，markdown 对行首空白是敏感的。
