# TAG 流编辑器

把提示词拆成一个个可拖、可加权、可改词的 chip。**反推、写词 Agent、画师库产出的提示词都能送进来改，改完一次性写回网站输入框。**

它是现在缺的那个枢纽：以前四个地方都在往输入框里堆文本，进去就是一堵墙，想删一个 tag、给某个词加权只能数逗号。

## 1. 为什么是共享 chunk

覆盖层跑在 content 脚本、面板跑在 assistant 脚本，两个互相看不见的 IIFE。要让两处渲染零偏差，只能共享源码：`js/flow/` 由 [scripts/build-modular.mjs](./scripts/build-modular.mjs) **同时前置进两个 bundle**。

[scripts/test-build.mjs](./scripts/test-build.mjs) 断言产物**逐字**包含 `js/flow/` 的每个 chunk —— 打包一旦做任何变换，这条就红。

共享 chunk 里的符号一律带 `flow` / `FLOW_` 前缀，避免和各自 bundle 的全局撞名。

## 2. 数据模型

NAI 的提示词有三层结构，缺一层都会解析错：

```
段    1girl, outdoors | blonde hair | red hair |     ← `|` 分段，多角色时以 `|` 收尾
行    1girl, solo, full body.                        ← V5 是「tag 骨架 / 动作段 / 场景段」分层
      The character is running through water.
      soft lighting, light blue theme
条目  1girl · solo · 1.2::soft lighting:: · 8::a, b::  ← 逗号切分，可能夹着权重组
```

条目有三种：

| kind | 说明 |
|---|---|
| `tag` | 普通 tag，带 weight |
| `sentence` | 自然语言整段 —— 不查词典、不按逗号切碎，但**有职能、能加权、能就地改** |
| `group` | `1.5::rain, night::` 这样的权重组 |

**硬性要求：`serialize(parse(t)) === t`**。规范文本一字不差地回来，10 类形态逐条测。非规范输入（多余空格、`{}`/`[]`/`(x:1.2)` 旧权重）会被规范化成 NAI 数值语法，这是有意的。

### 行属性不能骑在条目身上

`newlineBefore` 和行尾句号是**行**的属性，只是寄存在某个条目上。条目一被挪走就出事：

```
a, b\nc, d          把 c 挪到最前 → 换行必须留给 d
1girl, from below.  把 from below 挪到最前 → 句号留给新的行尾
```

所以移除统一走 `flowDetachItem()`，把行首/行尾职责交接给邻居。第一版两条都错，测试抓出来的。

### 自然语言是一等公民，不是「能拖的一坨文本」

V5 靠自然语言吃饭，按字符数它占大头。但按**可编辑单元数** tag 占大头 —— skill 第 12 节的默认模式输出大致是「5 个锚点 tag + 2~3 个 NL 段 + 4 个氛围串 tag」，9 : 3。而且氛围串（第 3 节那整张词表）本身就是 tag，锚点 tag 又是唯一需要查证 post 量的部分。

所以分工是：**写词 Agent 负责产出（自然语言为主），改词负责调整（tag 为主，整段可搬可加权可改）**。为此整段必须享有和 tag 同等的待遇：

| 能力 | 依据 |
|---|---|
| **职能标签**（机位 / 场景 / 动作 / 光影 / 描述） | 第 5 节「一段一个职能」，且默认模式下动作段在前、场景段在后 —— 顺序有讲究就得一眼看出哪段是哪段 |
| **可加权** `1.2::The character is…::` | 第 11 节排查表：某一段没画出来就提权重 |
| **就地多行编辑** | 二百字的段落塞不进单行输入框 |
| **tag ⇄ 整句 手动互转** | 第 11 节「tag 被忽略 → 改用自然语言整句描述」 |

职能靠前缀与关键词判定（`The camera…`→机位、`The scene…`→场景、`The character…` / `Character A…`→动作、含 light/shadow→光影），认错了可以手动改判。

`归类` 排序**只动 tag、只在行内动**，永远不碰整段 —— 跨行搬动会把「tag 骨架 / 机位段 / 动作段 / 场景段 / 氛围串」这套分层拆散。排序用的是 skill 第 2 节的锚点顺序：人数/solo → 取景/视角 → **关键物体** → 其余，氛围串收尾。关键物体在词典里多半归不进任何语义类、落在「其他」，但它属于锚点，不能被扫到最后。

### 整句判定要保守

V5 提示词一半是自然语言，认错了整个流就散架。口径：≥6 词、或 ≥4 词且句号结尾、或 ≥4 词且含 the/is/are/while 之类。`hand on own chest`、`long flowing blonde hair` 这类长 tag 不能误判，测试里有反例。

句子里本来就有逗号，切完会碎成几块，所以同一行里**连续的整句会合回去** —— 拼接用的还是 `", "`，往返仍然一字不差。

## 3. 两层分类

| 层 | 来源 | 视觉 |
|---|---|---|
| 来源 | 词典的 danbooru category：画师 / 角色 / 版权 / 元 / 通用 | chip **左侧竖条**，general 走中性灰不抢戏 |
| 语义 | ~150 条规则表，把 general 细分 | chip **底色 + 文字色** |

语义十类：主体 / 外貌 / 服饰 / 动作 / 表情 / 场景 / 光影 / 构图 / 质量 / 其他。离线确定性判定，没命中就老实标「其他」。

**顺序即优先级**，冲突项有测试锁着：

- `closed eyes` 是表情，`blue eyes` 才是外貌
- `light blue theme` 是光影，`white background` 是场景
- `solo focus` 是主体，`face focus` 是构图

语义色只在基础块定义一次，用低透明度做底、实色做竖条和文字 —— 深浅两套主题都成立，不必逐主题复制。小字号下底色差别看不出来，所以**语义色也调进文字里**，这才是「一目了然」的实际来源。

**词典里查不到的 tag 用虚线框 + 红竖条 + `?` 标出来**，直接接上 nai5 skill 的「不确定的 tag 底部标注」环节。

## 4. 交互

| 操作 | 行为 |
|---|---|
| 左键拖 | 排序，落点显示一根竖线；拖到别的段页签上就是换角色 |
| 右键上下拖 | 调权重，步进 0.05，实时显示数值 |
| 滚轮 | 同上（触控板右键拖不好用时的备选） |
| 单击 | 底部输入框变成改词；点的是整段就变成四行文本框 |
| hover 上的 × | 移除 |
| Ctrl / ⌘ 点击 | 多选 → tag ⇄ 整句 / 加权成组 / 批量删除 / 整批移到某个角色段 |
| Ctrl+Z / Ctrl+Shift+Z | 撤销重做（撤销点存的是序列化文本） |

工具栏：撤销 / 重做 / 去重（同段内同名只留一个，权重取最大）/ 归类（**只在行内**归并，跨行搬动会把 V5 的分层拆散）/ 清空。

拖动一个组的任意成员移动的是整个组；要单独摘掉某个成员用它自己的 ×。

## 5. novelai.net 输入框上的覆盖层

站点的输入框是别人的 contenteditable，没法把里面的文本换成 chip。所以覆盖层的做法是**在真实文字上叠一层**，用的是同一套分类：

```
1girl, solo, cowboy shot, from below, transparent umbrella, night, rain,
‾‾‾‾‾  ‾‾‾‾  ‾‾‾‾‾‾‾‾‾‾‾  ‾‾‾‾‾‾‾‾‾‾  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ‾‾‾‾‾  ‾‾‾‾
 主体   主体     构图         构图           其他            场景   场景
```

**只有一条直下划线**，所有状态都是同一条线换粗细和样式：

| 视觉 | 含义 |
|---|---|
| 2px 实线，语义色 | 单个 tag 的语义分类 |
| 3px 实线，语义色 | 成组（词库条目）或已锁定 |
| 2px **虚线**，红色 | 词典里查不到，盖过上面两种 |

一开始做的是四层（色条 + 填充块 + 红框 + 权重气泡），叠在正文上噪点太大，权重气泡还会压到上一行；而且 NAI 的数值权重本来就写在正文里（`0.7::teshima nari::`），气泡是重复的。全部收成一条线。

「查不到」画**虚线**不是随手选的：`--nai-category-artist` 现在是红色（danbooru 自己就这么分类），和「查不到」的红只靠颜色分不开，得靠实线 / 虚线。所以这条线用 `border-bottom` 而不是 `box-shadow` —— 后者画不了虚线；`box-sizing` 必须跟着改成 `border-box`，不然这条边会把矩形撑高 2px。

这层装饰可以整个关掉 —— 补全弹窗头部的「TAG 下划线」，存在 `localStorage['nai-ac-settings'].highlightTags`，**默认关**。**关掉的只有下划线**：词库的保存 / 取消区块 / 锁定按钮和拖拽热区照常，那是功能不是装饰。

hover 显示中文与 post 量，按住 Alt 每个 tag 都能拖着换位置（原来只有成组的能拖）。

### 偏移：两套坐标不能混

覆盖层要把「第几个 tag」换算成屏幕上的矩形，中间隔着两次换算，两次都出过错（都是**累加**误差，行数越多歪得越离谱）：

1. **tag 在正文里的位置**必须由 [parsePromptTokens](./js/content/01-config-and-segments.js) 边扫边记（`start` / `end` / `tokenEnd`），不能拿 `tag.length + delimiter.length` 累加 —— 被 `trim()` 掉的空格和开头那个空 token 都不进账。
2. **正文偏移换成 DOM 位置**必须走 [createRangeFromEditorTextOffsets](./js/content/01-editor-adapter.js)。`getEditorText()` 会给 `<br>` 和块级元素补 `\n`、把宏节点换成展开文本、再去掉 `\u200b` 并 trim —— 这些字符在文本节点里根本不存在。而自动补全那条链路用的 `createRangeFromTextOffsets` 吃的是 `Range.toString()` 坐标（只有文本节点），两套坐标混用，每个换行错一格。

改 `getEditorNodeText` 的时候 `buildEditorTextMap` 必须跟着改，两边是同一套规则的两个视角。[scripts/test-content.mjs](./scripts/test-content.mjs) 守着这条：每个 tag 圈到 DOM 上必须还是它自己。

覆盖层直接挂在 `body` 上、不在 `.nai-md3-root` 里，所以语义色板在 `:root` 也有一份字面值兜底；面板里那份跟着主题 token 走。

两个必须走 `flowParseItem` 而不是简单剥括号的理由：

- `1.3::soft lighting::` 是 NAI 数值权重语法，不解开就查不到词典，整个 tag 会被误标成「查不到」
- 自然语言被逗号切出来的碎片不是 tag，不能拿去查词典，更不能标红

## 6. 文件

| 文件 | 职责 |
|---|---|
| [js/flow/01-model.js](./js/flow/01-model.js) | 文本 ⇄ 结构、结构操作 |
| [js/flow/02-classify.js](./js/flow/02-classify.js) | 两层分类 + 规则表 |
| [js/flow/03-dictionary.js](./js/flow/03-dictionary.js) | 词典懒加载与查询 |
| [js/flow/04-render.js](./js/flow/04-render.js) | HTML 产出 |
| [js/flow/05-editor.js](./js/flow/05-editor.js) | 组件：状态、历史、指针交互 |
| [js/assistant/20-flow-page.js](./js/assistant/20-flow-page.js) | 面板「改词」页与抽屉「改词」窗口的落地 |
| [styles/08-flow.css](./styles/08-flow.css) | 外观（控件套既有 class，见 [STYLE.md](./STYLE.md)） |

词典和 Agent 用的是同一份 —— 自动补全缓存的 `chrome.storage.local['nai-ac-tags']`。只在流编辑器第一次打开时才加载：三万条数据不该躺在每个网页的内存里。

## 7. 测试

```bash
node scripts/test-flow.mjs
node scripts/test-content.mjs
```

[scripts/lib/flow-sandbox.mjs](./scripts/lib/flow-sandbox.mjs) 把 `js/flow/*.js` 按上线时同样的顺序装进 `node:vm`。模型和分类是纯逻辑，全部可测；渲染与指针交互靠浏览器里的合成事件验证（见 STYLE.md 第 9 节的验证方法）。

[scripts/lib/content-sandbox.mjs](./scripts/lib/content-sandbox.mjs) 同样装 `js/flow/*` + `js/content/*`（content bundle 的 epilogue 才调 `init()`，只加载分片没有副作用），另外配一份最小 DOM 替身：`nodeType` / `tagName` / `childNodes` / `classList.contains` / `dataset` / `parentNode`，外加一个只记端点的 Range。覆盖层的偏移就是拿它守的。

一个测试期的坑：合成 PointerEvent 没有真实指针，`setPointerCapture` 会抛 `NotFoundError`。真实使用时捕获是必要的（拖到画布外仍要收到 move/up），所以不能省，只能 try/catch 兜住。
