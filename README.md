# NovelAI Prompt Autocomplete

> ## 正在全力维护skill中 需要有关skill的更多反馈 https://github.com/Miint-Sunny/nai5-prompting

一个基于 Chrome Manifest V3 的 NovelAI 浏览器扩展：

- `NovelAI 标签自动补全`
- `基于 LLM 的图像反推助手`
- `按 skill 写提示词的 Agent`
- `TAG 流编辑器`
- `画师库与画师串管理`

项目仓库：<https://github.com/Miint-Sunny/nai-autocomplete>（fork 自 <https://github.com/saltysalrua/nai-autocomplete>）

## 功能概览

### 1. NovelAI 标签自动补全

在 `https://novelai.net/*` 页面注入标签补全能力：

- Danbooru 风格标签搜索
- 常用标签候选列表
- 本地缓存标签数据
- 支持下划线与空格转换开关
- 可给每个 TAG 画分类下划线（画师 / 角色 / 场景……，词典里查不到的画红虚线），默认关，在补全弹窗头部开
- 支持提示词区块分组、锁定与拖拽重排
- 支持将区块保存为词库条目，并通过 `char:xxx` / `style:xxx` 一类格式复用
- `char:` 条目可以填**别名**（中文名、原名、外号），写词时描述里提到任意一个就直接调用这个角色

### 2. 图像反推助手

在任意网页注入一个可呼出的 MD3 风格悬浮面板，用于选图、调用 LLM 反推提示词并自动复制结果。

支持能力：

- **NAI 原图直接读提示词**：PNG 文本块或 alpha 通道隐写，读到就不调模型 —— 零成本、不上传、逐字准确，读不到自动回退
- `Alt + Shift + 点击图片` 直接锁定图片并打开反推面板
- 手动选图模式
- Pixiv 一类覆盖层场景的选图兼容
- 图像直链失败时的抓图兜底与截图回退
- 悬浮窗可拖动、可缩放；右下那颗 **NAI 小方块本身也能拖**，位置记住不丢
- **两个入口各开各的界面**：右下悬浮球 → 悬浮窗；浏览器扩展图标 → 工作台（只在 novelai.net 出图页有，其他站点点图标一样开悬浮窗）
- 画师库可**导出离线手机版**：自包含 HTML，含画师、画师串和词库三个页签，发到手机就能搜和复制
- 支持历史记录
- 写词时本地词典查不到的 tag 会**实时问一次 danbooru**（含别名解析），只传 tag 名；开着 danbooru 标签页时优先借它的登录态。可在设置里关掉
- 支持角色替换模式
- **一键填入 Character 1～6**：写词产出的角色栏可直接填进 NovelAI 的角色提示词框，栏位不够会自动点「添加角色」补上（只填输入框，不碰「生成」）
- 支持默认代码框输出 / 手动包裹代码框
- 支持隐藏悬浮球，仅通过快捷键或扩展按钮呼出
- 在 NovelAI 以外的网站默认**不显示**悬浮球，点扩展图标呼出即可（可在设置里开回来）
- 内置 10 套主题预设，含 **流光玻璃 · 浅 / 深**（Apple 系统配色 + Liquid Glass 材质）
- 毛玻璃可开关，并有 iOS 风格滑块无级调节强度（0% = 实心，100% = 全玻璃）

### 3. 提示词 Agent（写词）

按一份**可替换的 skill** 把中文画面描述写成 NovelAI 提示词，界面是一条**对话流**：发送 → 回复 → 在回复的基础上继续提。反推面板的「写词」页和工作台抽屉的「写词」窗口都能用。

- 内置 nai5-prompting（NovelAI V5 内容提示词指南），开箱即用
- skill 可导入（多选 .md，带 frontmatter 的当正文、其余当参考资料）、可编辑、可导出、可切换；内置那份只读且始终保留
- **提示词格式两档**（设置 → 提示词）：**NAI V5** 是锚定 danbooru tag + 自然语言混写；**NAI V4.5** 回到纯 tag 路线、danbooru 查证优先。写词的档位措辞、附带的规则核对和内置反推预设都跟着切
- tag 查证走本地 danbooru 词典：先用中文释义反查预填一批确定存在的 tag，模型不确定时再调 `search_tags` 补查
- **四档生成方式**：默认 / 展开（多人分角色栏）/ 改写（整理现有提示词）/ 精简（优先准确 tag），V5 / V4.5 各一套措辞
- **角色栏数量**可指定 0~6，指定了就要求模型正好输出那么多个角色栏
- 自动附上目标版本的**规则核对**（V5：权重语法、两种透明、画面文字、`depthness` 等新 tag；V4.5：纯 tag 路线、角色栏上限 6），换成自己的 skill 也生效，可在设置里关
- **OC 点名**：中文描述里写到词库角色的名字或别名，就直接用它现成的外观串并指派 Character 栏位
- **结果不自动填入**：回复里的提示词块各带「填入 / 追加 / 改词 / 复制」，角色块一键填进 Character 栏；对话保存在本地，「清空」开新对话
- **只写提示词，不触发生成**

详见 [AGENT.md](./AGENT.md)。

### 4. TAG 流编辑器（改词）

把提示词拆成一个个可拖、可加权、可改词的 chip。面板「改词」页和工作台抽屉「改词」窗口都能用。

- 认得 NAI 的三层结构：`|` 分段（多角色按段分页签）、换行分层、逗号条目（含 `1.2::a, b::` 权重组）
- 自然语言整句单独成块，不会被逗号切碎
- 三种权重写法都认（`{x}` / `[x]` / `(x:1.2)`），出去统一成 NAI 数值语法
- 两层分类着色：左竖条是 danbooru 来源（画师/角色/版权/元），底色是语义细分（主体/外貌/服饰/动作/表情/场景/光影/构图/质量）
- **词典里查不到的 tag 会被标出来**
- 左键拖排序、右键上下拖调权重、点一下改词（带补全）、多选批量、撤销重做
- 反推结果、写词 Agent 结果都能一键「送去改词」；也能直接读取 / 写回网站输入框

详见 [FLOW.md](./FLOW.md)。

### 5. 画师库与画师串

完整的画师风格记录本，作为独立扩展页打开（扩展图标 → 反推面板 → 「画师库」→「管理」）。

支持能力：

- 多页画师库，每页独立保存画师、分类、星级、图片和画师串
- 画师记录：NAI tag、星级、分类标签、笔记、作品缩略图
- 原图 vs NAI 生成图并排对比记录，附 prompt 与相似度评分
- 画师串收藏：关联原始 PNG **无损保存**，自动解析其中的 Prompt / Seed / 模型 / Steps / CFG
- 从 Danbooru 自动抓取画师原图，支持单画师与批量、可随时停止、遇 403 保留作品信息
- 完整备份 / 追加导入 / 画师串单独导出 / 手机离线 HTML 导出
- 分类标签管理，画师与画师串共用，支持多标签组合筛选
- 存储占用与无损原图统计

反推面板与 NovelAI 工作台抽屉里都有「画师库」页，可搜索、按分类和星级筛选，
点卡片或 `＋` 直接把画师 tag / 画师串追加到当前提示词框，`📋` 只复制。

### 6. 多模型与多服务商

设置页支持主模型 + 备用模型两套配置。

首选组合是 **OpenAI 兼容协议 + 带视觉能力的 flash 级模型**，各服务商预设默认模型都按这个口径给。

支持能力：

- 主模型失败后自动切换备用模型
- 自动获取模型列表
- 测试连接按钮
- 服务商预设 + 协议预设

当前内置预设：

- OpenAI
- OpenRouter
- xAI (Chat Completions)
- xAI (Responses API)
- Google Gemini (OpenAI 兼容)
- Google Vertex AI (OpenAI 兼容)
- DeepSeek
- Anthropic
- 自定义

协议支持：

- OpenAI Chat Completions
- Responses API
- Anthropic Messages API

## 安装方式

### 从 Release 下载（推荐）

1. 到 <https://github.com/Miint-Sunny/nai-autocomplete/releases> 下载 `nai-autocomplete-vX.Y.Z.zip`
2. **解压到一个固定目录**，之后别删也别挪 —— 扩展是从这个目录加载的，不是导入后就可以丢
3. Chrome / Edge 打开 `chrome://extensions`，右上角打开「开发者模式」
4. 点「加载已解压的扩展程序」，选解压出来的 `nai-autocomplete` 文件夹

首次在 novelai.net 使用时会自动拉取 danbooru 标签词典并缓存到本地，**这一步需要能访问 GitHub**。词典拉下来之后自动补全、Agent 的 tag 查证、流编辑器的分类着色都靠它。

> **想自己改行为（比如调高某个上限）的话：** Release 包里只有 `js/bundle/*.js` 这些**构建产物**，没有 `js/` 下的源码 chunk。直接改 bundle 只对当前这份解压目录有效，**下次更新覆盖掉就没了**，而且不会有任何提示。要长期生效请按下面「从源码构建」来改源码 chunk。

### 从源码构建

仓库里**没有**打包产物（`js/bundle/` 和 `styles/bundle.css` 已 gitignore），克隆下来直接加载会失败，必须先构建：

```bash
git clone https://github.com/Miint-Sunny/nai-autocomplete.git
cd nai-autocomplete
node scripts/build-modular.mjs
```

然后按上面第 3、4 步加载仓库根目录。想验证发布包是否完整：

```bash
node scripts/package.mjs --zip
```

## 使用说明

### 自动补全

1. 打开 `NovelAI` 页面
2. 在提示词输入区域输入标签
3. 使用候选列表完成补全
4. 选中多个 tag 后可创建区块，并直接拖动排序
5. 将区块保存到词库后，可通过搜索 `yuukarin` 或 `char:yuukarin` 直接补全整块

### 图像反推

1. 打开任意图片页面
2. 使用以下任一方式选图：
   - `Alt + Shift + 点击图片`
   - 点击右下角的 NAI 小方块打开悬浮窗后点击“手动选图”（也可以点浏览器扩展图标）
3. 在设置页填写 LLM 配置
4. 点击“反推并复制”
5. 结果会写入面板并自动复制到剪切板
6. 若启用角色替换模式，可在设置页从 `char:` 词库中直接套用角色提示词

### 写词（提示词 Agent）

1. 面板切到「写词」
2. 挑「生成方式」（默认 / 展开 / 改写 / 精简），需要固定人数时再点「角色栏」的数字
3. 在底部输入框用中文描述想要的画面，点「发送」。**写到词库角色的名字或别名，就等于点名了这个角色** —— 记得勾上知识源里的「词库角色」
4. 在回复的基础上继续提要求就是迭代 —— 对话历史自动带上，它只改需要改的地方并说明改了什么。要以**输入框现值**为基准改，就勾上「当前提示词」（切「改写」档会自动帮你勾）
5. 回复里的提示词块用「填入 / 追加 / 复制」写进输入框、「改词」送去流编辑器；多角色时「全部填入」把主提示词和 Character 栏一次填齐。「清空」开新对话

### 改词（TAG 流编辑器）

1. 面板切到「改词」，点「读取输入框」把当前提示词拉进来（或从反推 / 写词直接送过来）
2. 每个 tag 是一个 chip，颜色是它的分类；**虚线加红边的是词典里查不到的**
3. 左键拖排序，右键上下拖（或滚轮）调权重，点一下改词，Ctrl 点多选
4. 多角色提示词会按 `|` 分成「基础 / 角色 1 / 角色 2」页签，跨页签拖就是换角色
5. 改完点「写入输入框」

### 设置页可配置项

| 分组 | 项 |
|---|---|
| 外观 | 颜色预设（10 套，含流光玻璃浅/深）、毛玻璃开关、玻璃强度滑块、三处悬浮球开关 |
| LLM 服务 | 服务商预设、接口协议、Endpoint、Model、API Key（带 ⓘ 获取指引）、思考模式、获取模型、测试连接 |
| 提示词 | 系统提示词、反推指令、角色替换模式、目标角色提示词、词库角色套用 |
| 生成选项 | 发送图片内容 / 原始 URL、附加网站标签上下文、默认代码框输出 |
| 备用模型 | 独立的服务商 / 协议 / Endpoint / Model / Key / 思考模式，主模型失败时自动接管 |

## 默认工作流

推荐使用流程：

1. 先在设置页选择服务商预设
2. 填写 API Key
3. 点击“获取模型”自动拉取可用模型
4. 点击“测试连接”确认主模型 / 备用模型配置有效
5. 再开始图像反推

## 文档

| 文档 | 内容 |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | 给 AI 助手看的项目须知（Claude Code 读这个，不是 `AGENTS.md`） |
| [STYLE.md](./STYLE.md) | 界面风格规范：两套 token、圆角、玻璃系统、控件规格 |
| [LLM.md](./LLM.md) | LLM 服务：分层、错误分类、重试策略、各家服务商的坑、图片预算 |
| [AGENT.md](./AGENT.md) | 提示词 Agent：skill 格式、知识源、tag 查证 |
| [FLOW.md](./FLOW.md) | TAG 流编辑器：NAI 三层结构、两层分类、输入框覆盖层 |

> `AGENT.md` 是「提示词 Agent」这个功能的文档，和 `AGENTS.md` 那套约定无关。

## 项目结构

维护时改这些（**源码**）：

| 目录 | 说明 |
|---|---|
| [js/content/](./js/content/) | 自动补全、提示词区块覆盖层 |
| [js/assistant/](./js/assistant/) | 反推面板、写词、改词、画师库快捷面板 |
| [js/background/](./js/background/) | Service Worker：LLM 服务、Agent、图片处理 |
| [js/artist/](./js/artist/) | 画师库独立页 |
| [js/flow/](./js/flow/) | TAG 流编辑器组件（**同时**进 content 与 assistant 两个 bundle） |
| [styles/](./styles/) | `01-*.css` … `08-*.css` 样式分片 |
| [pages/artist-library.html](./pages/artist-library.html) | 画师库页面骨架 |

构建产物（**不要手改**，已 gitignore）：`js/bundle/*.js`、`styles/bundle.css`。

同一个 bundle 内所有分片共用作用域，没有 import/export，新增顶层符号前先 `grep` 确认不撞名。

## 开发说明

```bash
node scripts/build-modular.mjs   # 改完分片先构建
```

### 拿真 Key 做一次真实调用

`.env` 已经在 `.gitignore` 里（仓库是公开的，别删那几行）：

```bash
cp .env.example .env              # 填 NAI_API_KEY
node scripts/check-provider.mjs            # 不带参数：列出可选的服务商
node scripts/check-provider.mjs deepseek   # 用它跑一遍
```

跑的是 `js/background/` 里真正上线的那份代码，只把 fetch 换成真网络请求 ——
会拉一次模型列表、打印将要发出去的请求体形状，再跑一次真实的写词（带工具）。
服务商和 Endpoint 取自扩展自己那份 `PROVIDER_PRESETS`，不在脚本里重抄一遍。
输出里的 Key 一律打码，可以直接贴进 issue。**不进 CI**，只在本地手动跑。

**改 LLM 协议层之前先用它跑一遍** —— 协议层的对错只有真服务端能判定，
单元测试只能守住「发出去的形状是不是我以为的那个」，守不住「这个形状对不对」。

改完跑这一串（CI 跑的也是它）：

```bash
node scripts/check-theme-tokens.mjs   # 主题变量完整性 + CSS 变量自引用
node scripts/test-llm.mjs             # LLM 服务
node scripts/test-agent.mjs           # 提示词 Agent 与图片预算
node scripts/test-metadata.mjs        # NAI 原图元数据（PNG 文本块 + alpha 隐写）
node scripts/test-danbooru.mjs        # danbooru 查询通道
node scripts/test-flow.mjs            # TAG 流模型与分类
node scripts/test-content.mjs         # 输入框覆盖层的分词偏移
node scripts/test-build.mjs           # 打包不改动源码
node scripts/package.mjs              # 发布包完整性
```

测试用 `node:vm` 加载**真正上线的那份分片**，不是为测试另写的副本。样式改动光跑脚本不够，必须实际渲染出来截图看（见 [STYLE.md](./STYLE.md) 第 9 节）。

### 为什么要打包？

Chrome 的 content script **不能**把多个独立 `.js` 文件当成一个 IIFE 作用域来共享 `const` / `let`。所以维护用分片，运行时用构建脚本把分片**合并回单个 bundle** —— 拆分维护、整体运行。

打包只做拼接、不做任何变换（`scripts/test-build.mjs` 守着这条）。

## 已知说明

- 图像反推依赖你自己配置的 LLM 服务，不内置 API Key
- 某些站点会对图片直链做防盗链限制，扩展已内置兜底逻辑，但仍可能受站点策略影响
- 不同服务商支持的模型、协议和视觉能力并不完全一致
- 首次使用需要能访问 GitHub 拉取标签词典；拉不到时自动补全和 tag 查证会退化，但不影响其余功能
- 发给模型的图片会先压到 1536px / 1.4MB 以内，太大的原图会被等比缩小
- **不提供任何自动生成 / 批量出图功能**，扩展只写提示词和改提示词

## License

本项目使用仓库内的 [LICENSE](./LICENSE)。
