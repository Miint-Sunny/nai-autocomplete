# 界面风格规范

面板、工作台抽屉、画师库独立页共用同一套设计语言。改任何样式前先读这份。

## 1. 两套 token，别搞混

| 文件 | 作用域 | 选择器 |
|---|---|---|
| [styles/01-tokens.css](./styles/01-tokens.css) | 自动补全 UI（content script 注入到网页里） | `html[data-nai-theme="..."]` |
| [styles/04-assistant-md3.css](./styles/04-assistant-md3.css) | 反推面板 / 工作台抽屉 / 画师库页 | `.nai-md3-root[data-theme="..."]` |

两套各自独立定义 `--md-sys-color-*`。**加主题必须两边都加**，否则补全弹窗在新主题下没配色。

**圆角档位、玻璃档位、控件填充（`--nai-md3-chip-bg` / `-shadow`）在两边各有一份**（值一致）。
圆角和玻璃那两组不是偷懒，是 CSS 的硬约束：自定义属性在
「声明它的那个元素」上就把 `var()` 代换掉了，派生值（`--nai-md3-glass-blur` / `-level`）必须和它
依赖的档位（`-radius` / `-floor`）落在**同一个元素**上。面板那份挂在 `.nai-md3-root`，补全弹窗挂在
`body` 上、不在那棵树里，只能在 `<html>` 上再算一遍。改档位记得两边同步。

`--nai-md3-chip-bg` 是纯粹为了让两边长得一样：面板里的按钮/页签是**提亮的半透明白**
（深色 6%、浅色 74%），补全弹窗以前用不透明的 `--md-sys-color-surface` —— 比卡片还暗，
一个凸一个凹，并排就是两套东西。**加主题时这两组也要一起加。**

画师库独立页（[pages/artist-library.html](./pages/artist-library.html)）的 `<body>` 挂 `class="nai-md3-root" data-standalone="true"`，直接复用第二套；`[data-standalone="true"]` 只负责把 `position: fixed` 重置掉。

## 2. 主题预设

10 套，注册在 `THEME_PRESETS`（[js/assistant/01-constants.js](./js/assistant/01-constants.js)）。

`sunrise` 是基础块本身（无 `[data-theme]` 选择器），基础块的值是**浅色**的。

- **深色主题**必须自带全套 —— 漏一个就会回落到基础块的浅色值上串色。
- **浅色主题**可以只覆盖颜色，其余回落，这是合理的。
- `--nai-md3-tab-active-*` 三个在样式里是带 fallback 引用的（fallback 跟着主色走），可不定义。

改完跑一遍：

```bash
node scripts/check-theme-tokens.mjs
```

它拿 `novelai`（覆盖最完整的深色主题）当模板，只对深色主题要求全覆盖。

**流光玻璃 · 浅 / 深** 是 Apple 系统配色（systemBlue `#007AFF` / `#0A84FF`、systemGray 阶、`#F2F2F7` / `#000`）+ Liquid Glass 材质，额外覆盖圆角档位和玻璃档位，并把 `--nai-md3-primary-fill` 换成实色（Apple 的按钮不用渐变）。

## 3. 圆角规则

容器走变量并按主题缩放；胶囊和极小值不参与。

| 档位 | 基础 | Apple | 用于 |
|---|---|---|---|
| `--nai-md3-radius-xl` | 28px | 26px | 面板、弹窗、抽屉表面 |
| `--nai-md3-radius-lg` | 22px | 20px | 区块、卡片、列表项 |
| `--nai-md3-radius-md` | 18px | 14px | 标题栏、输入框、结果框 |
| `--nai-md3-radius-sm` | 14px | 10px | 小容器、图片框、代码块 |
| `--nai-md3-radius-xs` | 12px | 10px | 图标钮、缩略图、导航项 |
| `--nai-md3-radius-2xs` | 10px | 8px | 极小控件 |
| `999px` | — | — | 胶囊按钮 / chip / 开关 / 滑块轨道 |

基础值刻意等于收敛前的原值，所以既有 8 套主题观感零变化。

**新写样式一律用变量**，只有真胶囊才写 `999px`，`≤8px` 的装饰性小圆角可以硬编码。标题栏曾经是 `999px`，两行标题时会胀成一颗药丸 —— 容器不要用胶囊。

补全弹窗是 `radius-md`（它是「结果框」），列表项 `radius-sm`。这两个以前是硬编码的 `6px` / `5px`，
在弹窗还是实心小卡片时看不出问题；一旦上了玻璃，紧圆角和面板的 `radius-xl` 就完全不像同一套东西了。

## 4. 玻璃系统

由 `--nai-md3-glass-amount`（0..1）单值驱动，其余全部按它插值：

```
--nai-md3-glass-blur   = blur(radius × amount) saturate(1 + saturate × amount)
--nai-md3-glass-level  = calc(100% - (100% - floor) × amount)
```

所以一个滑块就能在「实心 ↔ 全玻璃」之间无级调节。`amount` 由 `applyThemePreset()` 写成 inline 变量；`glassEffect` 关闭或强度为 0 时同时打上 `[data-glass="off"]`，负责把 `backdrop-filter` 设成 `none`、把表面换成实心色。

主题可覆盖 `--nai-md3-glass-radius` / `-radius-soft` / `-saturate` / `-floor` / `-floor-soft` / `-rim-color`。

### 文字浓度也跟着玻璃走

玻璃越透，底下透过来的东西越杂，文字越压不住。两级墨色都由同一个 `amount` 驱动：

| token | 用于 | amount=0 | amount=1 |
|---|---|---|---|
| `--nai-md3-ink-label` | 开关行标签这类「那一行的主内容」 | 向主文字色靠 45% | 就是主文字色 |
| `--nai-md3-ink-muted` | 提示、注脚、状态、历史元信息、placeholder | 主题原本的 `on-surface-variant` | 向主文字色靠 42% |

深色浅色两个方向都成立 —— 浅色主题的主文字色更深，靠过去就是变深。

**新写次要文字用 `--nai-md3-ink-muted`，不要直接用 `--md-sys-color-on-surface-variant`**，否则它在全玻璃下会糊掉。

### 只有顶层表面能加 backdrop-filter

全项目只有 5 处：面板、抽屉表面、画师库侧栏、画师库弹窗、**补全弹窗**（外加两个纯遮罩层）。

判据是「**顶层**」，不是「重要」：这几个都直接挂在 `body` 上、不嵌在任何已模糊的父级里。
补全弹窗满足这条，所以它算第 5 处；它内部的头/脚/胶囊开关只稀释背景，一个都不加模糊。

区块、输入框、卡片**只用半透明背景，不加 backdrop-filter**。两个原因：

- **性能** —— 每个带 backdrop-filter 的元素都要单独合成一遍。
- **渲染伪影** —— 嵌套在已模糊的父级里，Chrome 会重新采样并糊出一块深色。标题栏上曾有一个 `blur(10px)`，就是它在面板顶部糊出一条黑带。

## 5. 控件规格

新控件不要自己定外观，套现成 class；只有布局（flex/grid/尺寸）才自己写。

| 控件 | class | 规格 |
|---|---|---|
| 动作按钮 / chip | `.nai-md3-actions button` `.nai-md3-inline-action` | `999px` / `11px 12px` / 12px / 700 / `--nai-md3-chip-shadow` / hover `translateY(-1px)` |
| 页签（导航） | `.nai-md3-tabs button` | 同上，但上下内边距 `8px` —— 导航不必和主要动作一样高（轨道 38px） |
| 主按钮 | `.nai-md3-primary` | `--nai-md3-primary-fill` + `on-primary` |
| 输入 / 下拉 | `.nai-md3-input` | `radius-md` / `12px 14px` / `--nai-md3-input-bg` / inset 阴影 / focus `0 0 0 4px accent-soft` |
| 列表卡片 | `.nai-history-item` | `radius-lg` / `12px` / `--nai-md3-history-item-bg` / `--nai-md3-soft-shadow` / hover `translateY(-2px)` |
| 抽屉行 | `.nai-library-row` | `radius-sm`（抽屉里的输入是 `radius-2xs` + `10px 11px`，比面板紧） |
| 面板 / 弹窗 | `.nai-md3-panel` | `radius-xl` / panel 双层渐变 / `--nai-md3-panel-shadow` / glass blur |
| 补全弹窗 | `.nai-autocomplete-container` | `radius-md` / 同一份 panel 配方（辉光 + 双层渐变 + `elevation-3` + rim）/ glass blur |

补全弹窗的材质是把面板那份配方**用第一套 token 复述一遍**，不是另配一套：左上角辉光 +
竖向双层渐变 + rim + blur。辉光跟着 `--md-sys-color-primary` 走，所以十套主题自动成立，
不用维护第三份配色。曾经它是单色平铺 + `elevation-3`，上了玻璃之后和面板并排一看就是两种材质。

### 弹窗里只有三种控件

不统一的根子是**结构**，不是配色。以前一行里有原生 checkbox、两个独立的加减按钮、一段裸文字、
一个和按钮长得一模一样但点不动的徽章 —— 全是胶囊，看不出哪个能点。现在收成三种，各有各的形：

| 结构 | class | 用途 | 长相 |
|---|---|---|---|
| 可切换 | `.nai-ac-chip[aria-pressed]` | `_ ⇄ 空格` / `TAG 下划线` / `artist:` | 未按下＝描边胶囊；按下＝整颗 `--nai-md3-primary-fill`，同 `.nai-md3-tabs button.active` |
| 分段控件 | `.nai-ac-stepper` | 权重加减 | 一颗胶囊三段，不是三个独立块 |
| 纯信息 | `.nai-autocomplete-count` | post 数 | 不给填充不给描边，`ink-muted` + 等宽数字 |

**原生 `<input type="checkbox">` 一个都不留。** 面板全局把它重置成 `appearance: none` 再自绘
（`.nai-md3-switch` 的轨道 + 滑块），弹窗这边曾经留着系统勾选框 —— 两处并排就是两套控件语言。
弹窗行高只有 30px，塞不下 44×26 的开关，所以用「按下即填充的胶囊」表达同一件事。

按下态一律走 `--nai-md3-primary-fill`，**不要给某一颗单独配色**。`artist:` 试过填画师红，
但深色主题的 `--md-sys-color-on-primary` 是深色（它们的主色本来就是浅色系），压在红底上看不清；
分类身份交给行首那颗色点就够了。

### 外围结构：不要横线切块

**面板整块没有一条全幅分隔线**（`04-assistant-md3.css` 里那 4 条全在词库抽屉）。分组靠的是
内嵌圆角岛（`.nai-md3-header`：`radius-md` + `inset 0 0 0 1px` 描边 + `margin-bottom`）和留白。
Apple 的 popover / Spotlight / 菜单也是这套 —— 一整块连续材质，没有标题栏和状态栏。

补全弹窗的头尾曾经是**各带背景色和 1px 分隔线的全幅栏**，把卡片切成三条。材质、控件都对齐之后，
剩下这两条横线就是最后一处「不是同一个东西」。现在头尾都是透明的，直接坐在同一块玻璃上。

**包边是外亮内柔两层，不是一条发丝线。** 面板是
`border: 1px solid var(--nai-md3-panel-border)`（**带色调的浅色 rim**）再加一个
`::before` 内圈 `--nai-md3-panel-inner-border`。补全弹窗曾经用 `outline-variant` 那种
**深色发丝线** —— 深色主题上一条深线压在玻璃边缘，边缘发硬，看着就是另一种材质。
两个 token 在第一套里也各有一份，值完全一致。

`outline-variant` 那种发丝线**只用在控件上**（面板的按钮/页签就是它），卡片边缘不要用。

两条配套的规矩：

- **左内边距全卡片统一 12px** —— 标题、行首色点、脚注文字落在同一条竖线上。以前是 8 / 12 / 9px，
  差几像素，看不出为什么但就是不齐。
- **没有分隔线之后，滚动边界靠淡出交代**（Apple 的 scroll edge）。列表上下各 6px 的
  `mask-image` 渐变，宽度**刚好等于列表的上下内边距** —— 没滚动时落在空白上看不见，
  一滚起来内容就从头尾化开。别用横线代替它。

### 参数行：label 固定宽，控件落在同一条竖线上

写词页有三组「本轮参数」（生成方式 / 角色栏 / 知识源），是同一种行：
**一句 11px 的 muted label + 一组控件**。

- **全幅胶囊轨只留给页面导航。** 生成方式最初是一条和顶部页签一模一样的
  `.nai-md3-tabs`，两条并排就是两个导航 —— 而且「改写」档和「改词」页还撞名。
  收进参数行之后，面板里只剩一条全幅轨。
- **label 固定 `48px`**，三行的控件才落在同一条竖线上（和「卡片左内边距统一 12px」同一个道理）。
- **label 用 `line-height` 对齐，不要 `align-items: center`。** 知识源那行会换行，
  居中的话 label 会飘到两行中间去。行高走 `--nai-agent-row-height`，
  抽屉里控件更高（34px / 400 而不是 28px / 700），在那边重设一次这个变量就够了。
- **会换行的控件要自己包一层 flex 容器**（`.nai-agent-row-controls`）。
  直接把胶囊摊在行上，第二行会退回到 label 的位置，那条竖线就断了。

单选（生成方式、角色栏）是**分段控件** —— `.nai-md3-tabs` 那条轨道就是面板尺度的
「一颗胶囊分成几段」，和补全弹窗的 `.nai-ac-stepper` 同一种结构。多选（知识源）才是独立胶囊。
两者高度必须对上：轨道比胶囊高 6px 是它自己那圈 3px 边框，**里面的按钮要一样高**。

### 凸起还是凹陷，看的是填充方向和阴影

面板的按钮是 `--nai-md3-chip-bg`（**提亮的半透明白**）+ `--nai-md3-chip-shadow`，所以是凸的。
弹窗的控件曾经是不透明的 `--md-sys-color-surface`（**比卡片还暗**）且没有阴影，所以是凹的。
两个都要对上，只改填充不给阴影还是平的。hover 也照抄面板：`translateY(-1px)` + `chip-hover-shadow`。

### 密度：补全弹窗比面板紧

面板是常驻工作区，补全弹窗是打字时一闪而过的下拉，两者密度不同是对的，但别把间距浪费掉。
行高曾经是 `min-height: 50px` —— 那正好是「标题 + 译名」两行的高度，结果**没有译名的单行也被
撑到 50px**，一屏只放得下三条。现在是 `30px` 起、由内容撑开（两行 40px、单行 30px）。

### 固定开销的当前值

改这些数之前先量一遍，别凭感觉调。

| | 悬浮窗 | 工作台 |
|---|---|---|
| 外壳内边距 | `14px 16px 12px` | — |
| 标题栏 | 46px（`7px 12px`，关闭钮 32×32） | 61px（`10px 20px`，标题 20px） |
| 页签轨 / 侧栏项 | 38px（轨 `3px`，按钮 `8px`） | 34px（`0 8px`） |
| 滚动区内边距 | `2px 14px 10px` | `16px 20px` |
| 状态条 | 内容的一部分 | 全幅横条 `7px 20px`，**空了就 `display: none`** |

几处踩过的：

- **两个外边距会叠在一起。** 标题栏的 `margin-bottom: 12px` 加页签轨的 `margin-top: 12px`
  = 24px 的空档，看不出是谁留的。现在标题栏不带 margin，间距只由页签轨一处负责。
- **底部内边距别叠两层。** 面板 `padding-bottom: 24px` + 滚动区 `padding-bottom: 28px`
  = 52px 的死区。
- **容器的高度往往由里面最高的那个控件定。** 标题栏 58px 不是因为标题（22px），
  是因为关闭钮 38px。想矮就先看那颗按钮。

### 短页面要长满，不要留白

面板的高度是**打开那一下**按当时那一页定死的（`keepPanelInsideViewport` 会写死 inline height），
切到内容更少的页就会空出一大截 —— 历史页曾经空 353px，画师页 147px。

做法是让滚动区变 flex 列，可见的那页 `flex: 1 0 auto`，页里再指定**一个**吃掉剩余高度的元素：

```css
.nai-md3-body { display: flex; flex-direction: column; }
.nai-md3-page:not(.nai-hidden) { display: flex; flex: 1 0 auto; flex-direction: column; }
.nai-md3-page[data-page="reverse"] > .nai-md3-result { flex: 1 0 auto; }
```

**`1 0 auto` 不是 `1`。** `flex: 1` 会把 basis 设成 0，内容比容器高的页（设置、写词）会被压扁；
`1 0 auto` 是「有富余就长，绝不缩」，超高的页照旧交给滚动区滚。

同理，**列表不要写死 `max-height`**。画师列表曾经封在 460px，面板拉高之后下面就是一截空白。

## 6. 反复踩到的坑

### 6.1 玻璃上的描边必须半透明

Apple 主题一开始用了 separator 实色 `#38383a` 做 `--md-sys-color-outline-variant`。但玻璃上的控件填充是**提亮的半透明白**，描边却是**不透明深灰** —— 比填充还暗，于是每个按钮外圈都描了一圈黑边。

现在深色是 `rgba(255,255,255,0.14)`、浅色是 `rgba(0,0,0,0.10)`，跟着底色走。**任何要叠在玻璃上的边框色都必须带 alpha。**

### 6.2 滚动容器会把阴影裁成直边

`overflow: auto` / `overflow-x: hidden` 的容器会在自己边界切掉子元素的 `box-shadow`，切口是刀切一样的直边，很显眼。

`.nai-md3-body`（`overflow:auto`）和 `.nai-md3-page`（`overflow-x:hidden`）都用 `padding-inline: 14px` + `margin-inline: -14px` 撑出余量：裁切边界外推，内容位置不变。**两层都要做** —— 只做外层没用，裁切发生在最内层那个。

新加滚动容器时，如果里面的元素带外阴影，照这个模式处理。

### 6.3 `.nai-md3-root button { font: inherit }` 权重是 (0,1,1)

单类规则（如 `.nai-md3-inline-action`，权重 (0,1,0)）**压不住它**，字号字重会被重置成继承值。

给按钮定字体必须用 (0,2,0) 以上，例如 `.nai-artist-quick button.nai-md3-inline-action`。同理，抽屉里要覆盖这条覆盖，还得再高一级。

### 6.4 自定义属性不能自引用

```css
/* 错的 —— 循环引用，整个属性作废 */
--nai-md3-primary-fill: var(--nai-md3-primary-fill);
```

CSS 变量自引用属于 *invalid at computed-value time*，结果不是「保持原值」而是**整个属性变成 guaranteed-invalid**。用到它的 `background: var(--nai-md3-primary-fill)` 会退成 `unset`，主按钮直接变成没有背景的裸文字。

抽公共变量时最容易写出这行 —— 把原来的值搬进变量定义，手一滑就写成了变量名本身。而且它**不会报错**，只在没有覆盖该变量的主题里静默失效（Apple 两套主题定义了实色，所以看起来「只有部分主题坏」，很容易误判成主题的问题）。

### 6.5 阴影浓度按背景挑，不是越浓越高级

深色主题的 `--nai-md3-panel-shadow` 曾是 `rgba(0,0,0,0.64)` + 68px 模糊。面板浮在浅色宿主页上时，那圈黑晕比面板本身还抢眼。

Apple 的材质阴影靠**大范围低透明度**（`0 18px 48px rgba(0,0,0,0.26)`），不靠浓度。

## 7. 信息架构：两处导航、两处设置

**两个界面，两个入口，各开各的：**

| 入口 | 打开 | 在哪儿有 |
|---|---|---|
| 右下的 NAI 小方块 | 悬浮窗 `.nai-md3-panel` | 所有站点（可在设置里分别关掉三种场景） |
| 浏览器扩展图标 | 工作台 `.nai-library-drawer` | 只有 novelai.net 出图页；别处退回悬浮窗 |

两个可以同时开着，各自的 × 只关自己（所以关闭按钮是两个 action：`close` / `close-drawer`）。
曾经出图页上 `openPanel()` 会掉头去开工作台 —— **悬浮窗在那儿没有任何入口能打开**，
而且 `setPage` 还会把 targetPage 强制成面板早已不存在的 `'library'`，真开出来也是一片空白。
一个界面被另一个界面顺手劫持，往往不会报错，只会静悄悄消失。

同一批功能有**两个入口**，两边必须排成一样的顺序，否则用户在两个界面里找同一个开关会找不到。

| 面向 | 导航 | 顺序 |
|---|---|---|
| 反推面板 `.nai-md3-tabs` | 页签 | 反推 → 写词 → 改词 → 画师 → 历史 → 设置 |
| 工作台抽屉 `.nai-workbench-sidebar` | 侧栏 | 词库 → 写词 → 改词 → 画师库 → 预设 → 设置 |

中段（**写词 → 改词 → 画师**）两边一致，这是「做词」的流程；各自的主场（反推 / 词库）在最前，
配置类（历史·预设·设置）在最后。

设置分组两边也一样，顺序 = 用户实际配置的顺序：

**主模型 → 备用模型 → 生成参数 → 发送与输出 → 提示词 → 外观**

不配就用不了的排最前，纯个性化的排最后。工作台那份曾经是外观打头，和面板对不上。
备用模型曾经隔着「生成参数」和「发送与输出」排在第四 —— 它和主模型是同一件事（配一个模型服务），
中间夹两段不相干的东西，配完主模型还得往下翻。

几条踩过的：

- **面板里的模型服务字段一律占整行，不并排两半。** 面板半宽的下拉只剩约 150px 能写字，
  而「OpenAI Chat Completions」要 169px、「Google Vertex AI (OpenAI兼容)」要 199px，
  模型名（`google/gemini-3.5-flash`）同理 —— 三个字段一起看不全，等于配完不知道自己配了什么。
  抽屉宽得多，服务商/协议那一对仍然是两列。**两半并排前先量一下最长的那个值。**

- **控制某段显隐的开关，要放在那段里面。**「启用备用模型」曾经在「生成选项」末尾，控制的却是
  下一整段。现在它常显在「备用模型」段首，`[data-fallback-section]` 只包住字段 ——
  **开关本身不能被它自己藏掉**，否则关了就再也打不开。
- **同一个概念的字段不要跨段。** 备用模型的思考强度曾经和主模型的并排在「生成参数」里。
- **说明文字贴着它解释的那组。** 外观段曾经把悬浮球说明和玻璃说明一起堆在段末；玻璃开关还夹在
  三个悬浮球开关中间，和它的强度滑块隔开。
- **永远显示不出来的导航项要删掉，不是留着。** 面板页签第一个曾经是「词库」：非 NAI 页被 CSS 藏掉，
  NAI 页整个面板都是隐藏的，点了只会被 `setPage` 弹回「反推」。
- **点了没反应的控件也一样。** 工作台侧栏的「收起」在 `max-width: 980px` 下毫无作用 ——
  那个断点里侧栏本来就被压成 58px 图标条，收不收都一样。现在那个宽度直接把按钮藏掉。
- **收起类控件必须自带「怎么展开」。** 侧栏收起后文字被藏起来，只剩一个箭头，而箭头**不会翻面** ——
  按钮收起前后长得一模一样，看上去就只有收起没有展开。翻面靠
  `[aria-expanded="false"] .nai-workbench-nav-icon { transform: rotate(180deg) }`，
  `title` / `aria-label` 同步改。**状态变了，控件的样子就得跟着变**，光改被藏起来的那行字不算。

## 8. 离线导出的手机版

[js/artist/02-mobile-export.js](./js/artist/02-mobile-export.js) 生成的是一张**自包含 HTML**，
发到手机上离线看。它引不到扩展的 CSS，所以配色和规格是 **novelai 主题的静态快照** ——
但 **token 名字、圆角档位、材质配方必须和面板那份逐字一致**，否则就是两个产品。

它曾经用一套完全独立的紫色配色（`#151722` / `#202333` / `#c3a2ff`），和设计语言毫无关系。
现在：卡片走 panel 配方（辉光 + 双层渐变 + 外亮内柔两层包边 + `elevation-3`），
页签是「未按下描边胶囊 / 按下整颗填充」，输入框是 `radius-md` + `input-bg` + inset 阴影。

**没有 `backdrop-filter`** —— 独立页背后没有东西可模糊，加了只是白费合成。

改主题 token 时记得这份快照要跟着更新；它不会自动跟。

## 9. 改样式后怎么验

样式改动**必须实际渲染出来看**，computed style 对了不代表视觉对了 —— 黑边、裁切、伪影都只有截图才看得见。

搭一个带 `chrome` mock 的内联页（bundle.css + image-assistant.js 全内联），面板放在**高对比背景**上（纯白 / 彩色渐变 / 斜条纹），玻璃和边缘的毛病才会暴露。

定位可疑图层用逐层关掉对比，别猜：

```js
document.getElementById('diag').textContent = '.nai-md3-panel{box-shadow:none !important}';
```

依次试 `box-shadow` / `border-color` / `::before` / `::after` / `backdrop-filter`，哪个关掉问题消失就是哪个。局部放大用 `transform: scale(4)` + `transform-origin: top left`。
