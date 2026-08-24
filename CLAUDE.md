# 给 AI 助手的项目须知

Claude Code 读的是这个文件（不是 `AGENTS.md`）。动手前先按需读下面对应的那份文档。

> ⚠️ 本仓库里的 **`AGENT.md` 是「提示词 Agent」这个功能的文档**，和 `AGENTS.md` 那套约定无关，别搞混。

## 文档索引

| 文档 | 什么时候必须读 |
|---|---|
| [STYLE.md](./STYLE.md) | 改任何样式之前。两套 token 体系、圆角规则、玻璃系统、控件规格，以及反复踩到的坑 |
| [LLM.md](./LLM.md) | 改 LLM 链路之前。分层、错误分类表、重试策略、各家服务商的坑 |
| [AGENT.md](./AGENT.md) | 改提示词 Agent 或 skill 机制之前 |
| [FLOW.md](./FLOW.md) | 改 TAG 流编辑器之前。NAI 三层结构、两层分类、覆盖层 |

## 源码结构

浏览器扩展没有打包器，`scripts/build-modular.mjs` 按文件名顺序把 chunk **拼接**成 bundle。

| 目录 | 产物 | 说明 |
|---|---|---|
| `js/content/` | `js/bundle/content.js` | 自动补全、提示词区块覆盖层（只在 novelai.net 等站点） |
| `js/assistant/` | `js/bundle/image-assistant.js` | 反推面板、写词、改词、画师库快捷面板（所有站点） |
| `js/background/` | `js/bundle/background.js` | service worker：LLM 服务、Agent、图片抓取 |
| `js/artist/` | `js/bundle/artist-library.js` | 画师库独立页 |
| `js/flow/` | **同时进** content 与 assistant | TAG 流编辑器组件（共享 chunk） |
| `styles/` | `styles/bundle.css` | 除 `artist-library.css` 外全部拼进去 |

**不要手改 `js/bundle/` 和 `styles/bundle.css`** —— 它们是产物且已 gitignore。改 chunk 后跑构建。

同一个 bundle 内所有 chunk 共用作用域，没有 import/export：

- 新增顶层符号前先 `grep` 确认不撞名
- `js/flow/` 会进两个 bundle，里面的符号一律带 `flow` / `FLOW_` 前缀
- **打包只做拼接、不做任何变换**（`scripts/test-build.mjs` 守着这条）。曾经它给每行加两个空格做缩进，结果多行模板字符串里的内容被逐行插进两个空格

## 改完必须跑

```bash
node scripts/build-modular.mjs && node scripts/check-theme-tokens.mjs && node scripts/test-llm.mjs && node scripts/test-agent.mjs && node scripts/test-metadata.mjs && node scripts/test-danbooru.mjs && node scripts/test-flow.mjs && node scripts/test-content.mjs && node scripts/test-build.mjs
```

CI 跑的就是这一串。测试用 `node:vm` 加载**真正上线的那份 chunk**，不是为测试另写的副本（见 `scripts/lib/*-sandbox.mjs`）。

**样式改动光跑脚本不够 —— 必须实际渲染出来截图看。** computed style 对了不代表视觉对了；黑边、裁切、伪影只有截图才看得见。方法见 STYLE.md 第 8 节。

## 产品约束

- **不要加任何触发出图 / 自动生成的功能**，有封号风险。写提示词、改提示词、写回输入框可以，点「生成」不行
- 版本号在 `manifest.json`，release workflow 读它。功能改动记得 bump
- 参考过 [HainTag](https://github.com/1756141021/HainTag)（GPL-3.0）与 Ultimate_Novelai_launcher 的**逻辑**，代码全部重写，不复制
- 用中文写注释、提交信息和文档
- **仓库是公开 fork**（origin `Miint-Sunny`，upstream `saltysalrua` 只取不推）。推 origin 就是公开发布
- 迭代内置 skill 默认走「写词 → skill → 导入 .md」，**不要直接改 `17-agent-skill-builtin.js`** —— 改它等于把新版 skill 一起公开
