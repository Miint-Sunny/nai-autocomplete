# 界面风格规范

面板、工作台抽屉、画师库独立页共用同一套设计语言。改任何样式前先读这份。

## 1. 两套 token，别搞混

| 文件 | 作用域 | 选择器 |
|---|---|---|
| [styles/01-tokens.css](./styles/01-tokens.css) | 自动补全 UI（content script 注入到网页里） | `html[data-nai-theme="..."]` |
| [styles/04-assistant-md3.css](./styles/04-assistant-md3.css) | 反推面板 / 工作台抽屉 / 画师库页 | `.nai-md3-root[data-theme="..."]` |

两套各自独立定义 `--md-sys-color-*`。**加主题必须两边都加**，否则补全弹窗在新主题下没配色。

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

全项目只有 4 处：面板、抽屉表面、画师库侧栏、画师库弹窗（外加两个纯遮罩层）。

区块、输入框、卡片**只用半透明背景，不加 backdrop-filter**。两个原因：

- **性能** —— 每个带 backdrop-filter 的元素都要单独合成一遍。
- **渲染伪影** —— 嵌套在已模糊的父级里，Chrome 会重新采样并糊出一块深色。标题栏上曾有一个 `blur(10px)`，就是它在面板顶部糊出一条黑带。

## 5. 控件规格

新控件不要自己定外观，套现成 class；只有布局（flex/grid/尺寸）才自己写。

| 控件 | class | 规格 |
|---|---|---|
| 按钮 / 页签 | `.nai-md3-tabs button` `.nai-md3-actions button` `.nai-md3-inline-action` | `999px` / `11px 12px` / 12px / 700 / `--nai-md3-chip-shadow` / hover `translateY(-1px)` |
| 主按钮 | `.nai-md3-primary` | `--nai-md3-primary-fill` + `on-primary` |
| 输入 / 下拉 | `.nai-md3-input` | `radius-md` / `12px 14px` / `--nai-md3-input-bg` / inset 阴影 / focus `0 0 0 4px accent-soft` |
| 列表卡片 | `.nai-history-item` | `radius-lg` / `12px` / `--nai-md3-history-item-bg` / `--nai-md3-soft-shadow` / hover `translateY(-2px)` |
| 抽屉行 | `.nai-library-row` | `radius-sm`（抽屉里的输入是 `radius-2xs` + `10px 11px`，比面板紧） |
| 面板 / 弹窗 | `.nai-md3-panel` | `radius-xl` / panel 双层渐变 / `--nai-md3-panel-shadow` / glass blur |

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

## 7. 改样式后怎么验

样式改动**必须实际渲染出来看**，computed style 对了不代表视觉对了 —— 黑边、裁切、伪影都只有截图才看得见。

搭一个带 `chrome` mock 的内联页（bundle.css + image-assistant.js 全内联），面板放在**高对比背景**上（纯白 / 彩色渐变 / 斜条纹），玻璃和边缘的毛病才会暴露。

定位可疑图层用逐层关掉对比，别猜：

```js
document.getElementById('diag').textContent = '.nai-md3-panel{box-shadow:none !important}';
```

依次试 `box-shadow` / `border-color` / `::before` / `::after` / `backdrop-filter`，哪个关掉问题消失就是哪个。局部放大用 `transform: scale(4)` + `transform-origin: top left`。
