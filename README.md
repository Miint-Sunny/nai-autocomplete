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
- 内置浅色 / 暗色主题预设

### 3. 多模型与多服务商

设置页支持主模型 + 备用模型两套配置。

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
- DeepSeek
- Anthropic
- 自定义

协议支持：

- OpenAI Chat Completions
- Responses API
- Anthropic Messages API

### 4. 本轮重点改进

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
- [styles/](./styles/)：`01-*.css` … `05-*.css` 样式分片

构建后 Chrome 实际加载的是打包产物（**不要手改**）：

- [js/bundle/content.js](./js/bundle/content.js)
- [js/bundle/image-assistant.js](./js/bundle/image-assistant.js)
- [js/bundle/background.js](./js/bundle/background.js)
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
