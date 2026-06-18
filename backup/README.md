# Monolith archive (optional)

早期单文件备份，**不再是开发入口**。

日常维护请直接编辑：

- `js/content/` — 自动补全
- `js/assistant/` — 图像反推助手
- `js/background/` — Service Worker
- `styles/` — 样式分片（`01-*.css` … `05-*.css`）

改完后在仓库根目录执行：

```bash
node scripts/build-modular.mjs
```

脚本会把上述分片**打包**成 Chrome 实际加载的文件：

- `js/bundle/content.js`
- `js/bundle/image-assistant.js`
- `js/bundle/background.js`
- `styles/bundle.css`

`manifest.json` 只引用这些 bundle，不会直接加载 `js/content/*.js` 分片。
