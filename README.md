# NovelAI Prompt Autocomplete

一个基于 Chrome Manifest V3 的 NovelAI 浏览器扩展，当前包含两部分能力：

- `NovelAI 标签自动补全`
- `基于 LLM 的图像反推助手`

项目仓库：<https://github.com/saltysalrua/nai-autocomplete>

## 功能概览

### 1. NovelAI 标签自动补全

在 `https://novelai.net/*` 页面注入标签补全能力：

- Danbooru 风格标签搜索
- 常用标签候选列表
- 本地缓存标签数据
- 支持下划线与空格转换开关
- 支持提示词区块分组、锁定与拖拽重排
- 支持将区块保存为词库条目，并通过 `char:xxx` / `style:xxx` 一类格式复用

### 2. 图像反推助手

在任意网页注入一个可呼出的 MD3 风格悬浮面板，用于选图、调用 LLM 反推提示词并自动复制结果。

支持能力：

- `Alt + Shift + 点击图片` 直接锁定图片并打开反推面板
- 手动选图模式
- Pixiv 一类覆盖层场景的选图兼容
- 图像直链失败时的抓图兜底与截图回退
- 悬浮窗可拖动、可缩放
- 点击浏览器扩展图标可直接打开当前页面内的反推窗口
- 支持历史记录
- 支持角色替换模式
- 支持默认代码框输出 / 手动包裹代码框
- 支持隐藏悬浮球，仅通过快捷键或扩展按钮呼出
- 在 NovelAI 以外的网站默认**不显示**悬浮球，点扩展图标呼出即可（可在设置里开回来）
- 内置 10 套主题预设，含 **流光玻璃 · 浅 / 深**（Apple 系统配色 + Liquid Glass 材质）
- 毛玻璃可开关，并有 iOS 风格滑块无级调节强度（0% = 实心，100% = 全玻璃）

### 3. 提示词 Agent（写词）

按一份**可替换的 skill** 把中文画面描述写成 NovelAI 提示词。反推面板的「写词」页和工作台抽屉的「写词」窗口都能用。

- 内置 nai5-prompting（NovelAI V5 内容提示词指南），开箱即用
- skill 可导入（多选 .md，带 frontmatter 的当正文、其余当参考资料）、可编辑、可导出、可切换；内置那份只读且始终保留
- tag 查证走本地 danbooru 词典：先用中文释义反查预填一批确定存在的 tag，模型不确定时再调 `search_tags` 补查
- 默认 / 展开两种输出模式
- 结果里的代码框单独成卡片，可复制、整段写入提示词框、或以逗号追加
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

### 5. 本轮重点改进

- 修复共享词库在扩展重载后的持久化问题，并在词库更新后立即刷新图像反推里的 `char:` 角色列表
- 修复自动补全在普通文本、`artist:` 与带权重格式下的替换边界问题，避免重复前缀、误删后续内容或漏补逗号
- 修复区块操作后的 `Ctrl+Z` 回滚同步，撤销时区块框会跟随编辑器内容一起回退
- 自动补全对带权重格式的替换更稳定，修复 `::, ::,`、`),),` 一类尾巴重复问题
- 光标停在 `1.2::tag::` 的尾部也能触发补全
- 补全框会尽量贴近当前光标位置，减少遮挡正在编辑的 tag
- 新增提示词区块系统，可对一段 tag 分组、锁定、拖动排序并保留换行分隔
- 新增共享词库系统，可将区块保存为 `分类:名称`，并在自动补全中整块插入
- 图像反推助手现已支持从 `char:` 词库条目直接套用角色替换提示词
- 新增 3 套暗色主题：
  - `余烬暮棕`
  - `深海夜蓝`
  - `青苔幽夜`

## 安装方式

### 方式一：从 Release 下载

前往 Releases 页面下载 zip：

- <https://github.com/saltysalrua/nai-autocomplete/releases>

解压后，在 Chrome / Edge 中打开扩展管理页，启用开发者模式，再选择“加载已解压的扩展程序”。

### 方式二：直接加载仓库目录

1. 克隆仓库
2. 打开浏览器扩展管理页
3. 启用开发者模式
4. 选择“加载已解压的扩展程序”
5. 选择项目目录 `nai-autocomplete`

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
   - 点击浏览器扩展图标打开当前页反推窗口后点击“手动选图”
3. 在设置页填写 LLM 配置
4. 点击“反推并复制”
5. 结果会写入面板并自动复制到剪切板
6. 若启用角色替换模式，可在设置页从 `char:` 词库中直接套用角色提示词

### 设置页可配置项

- 服务商预设
- 接口协议
- Endpoint
- Model
- API Key
- 系统提示词
- 反推提示词
- 角色替换模式
- 备用模型
- 默认代码框输出
- 是否显示悬浮球
- 颜色预设
- 获取模型
- 测试连接

## 默认工作流

推荐使用流程：

1. 先在设置页选择服务商预设
2. 填写 API Key
3. 点击“获取模型”自动拉取可用模型
4. 点击“测试连接”确认主模型 / 备用模型配置有效
5. 再开始图像反推

## 项目结构

维护时改这些（**源码**）：

- [js/content/](./js/content/)：自动补全分片
- [js/assistant/](./js/assistant/)：图像反推助手分片
- [js/background/](./js/background/)：后台 Service Worker 分片
- [js/artist/](./js/artist/)：画师库独立页面分片
- [pages/artist-library.html](./pages/artist-library.html)：画师库页面骨架
- [styles/](./styles/)：`01-*.css` … `06-*.css` 样式分片
- [styles/artist-library.css](./styles/artist-library.css)：画师库页面样式（不进 `bundle.css`）

构建后 Chrome 实际加载的是打包产物（**不要手改**）：

- [js/bundle/content.js](./js/bundle/content.js)
- [js/bundle/image-assistant.js](./js/bundle/image-assistant.js)
- [js/bundle/background.js](./js/bundle/background.js)
- [js/bundle/artist-library.js](./js/bundle/artist-library.js)
- [styles/bundle.css](./styles/bundle.css)
- [manifest.json](./manifest.json)
- [background.js](./background.js)：`importScripts` 入口

[backup/](./backup/) 仅保留早期单文件归档，不是日常开发入口。

## 开发说明

1. 编辑 `js/`、`styles/` 下的分片源码
2. 在仓库根目录执行：

```bash
node scripts/build-modular.mjs
```

3. 在浏览器扩展页重新加载扩展

### 为什么要打包？

Chrome 的 content script **不能**把多个独立 `.js` 文件当成一个 IIFE 作用域来共享 `const` / `let`。  
所以维护用分片，运行时用构建脚本把分片**合并回单个 bundle**——这才是「拆分维护、整体运行」。

常用本地校验：

```bash
node scripts/build-modular.mjs
```

## 已知说明

- 图像反推依赖你自己配置的 LLM 服务，不内置 API Key
- 某些站点会对图片直链做防盗链限制，扩展已内置兜底逻辑，但仍可能受站点策略影响
- 不同服务商支持的模型、协议和视觉能力并不完全一致

## License

本项目使用仓库内的 [LICENSE](./LICENSE)。
