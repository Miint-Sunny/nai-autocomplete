# LLM 服务

反推、连接测试、模型列表，以及后面要做的提示词 Agent，全部走这一条链路。改任何一层前先读这份。

## 0. 反推不一定要调模型

NAI 生成的图把提示词写在自己身上，两个位置：

| 通道 | 说明 |
|---|---|
| PNG 文本块 | `tEXt` / `zTXt` / `iTXt`，键是 `Description`（正向）和 `Comment`（一段 JSON） |
| alpha 通道最低位隐写 | 签名 `stealth_pnginfo` / `pngcomp` / `rgbinfo` / `rgbcomp`，`comp` 是 gzip |

[js/background/02-nai-metadata.js](./js/background/02-nai-metadata.js) 两条都读，读到就直接出结果 ——
零 token、不上传图片、逐字准确；读不到自动回退到模型反推。开关在设置的「发送与输出」里，默认开。

**时机是死的**：`applyImageBudget` 会把图缩到 1536 并转 JPEG，两种元数据会一起没掉。
所以读取必须在预算之前、还拿着原始字节的那一刻。`respondWithBudgetedImage` 里
`readMetadata` 是显式 opt-in，只有「真的拿到原图字节」的路径才打开（截图和分块拼接是画布重绘，
不可能带元数据，给它们解一遍全尺寸像素纯属浪费）。

## 1. 分层

浏览器里这些文件会被 [scripts/build-modular.mjs](./scripts/build-modular.mjs) 按文件名顺序拼成一个 service worker 脚本，共用同一个作用域，没有 import/export。

| 文件 | 职责 | 不该知道的事 |
|---|---|---|
| [03-llm-errors.js](./js/background/03-llm-errors.js) | 错误分类、重试/切换策略、脱敏 | 具体协议 |
| [04-llm-protocols.js](./js/background/04-llm-protocols.js) | 各协议的请求构造与响应解析 | 重试、超时 |
| [05-llm-transport.js](./js/background/05-llm-transport.js) | 超时、取消、重试退避、SSE 增量读取 | 服务商是谁 |
| [06-llm-runner.js](./js/background/06-llm-runner.js) | 校验、主备切换、JSON 输出、工具循环 | HTTP 细节 |
| [07-llm-models.js](./js/background/07-llm-models.js) | 模型列表 | — |
| [08-messages.js](./js/background/08-messages.js) | `chrome.runtime` 消息路由 | 业务逻辑 |

方向是单向的：runner → transport → protocols → errors。**协议层不要引用 transport，transport 不要认识任何服务商。**

## 2. 一次请求的流程

```
前端 sendRuntimeMessage({ type:'nai-llm-chat', runId, payload:{ primary, fallback } })
  └ 08-messages   登记 runId（可取消）
     └ runLlmWithFallback   主 → 失败且 failoverable → 备
        └ runLlmRequest     校验 → 建请求 → 解析 → 空结果检查
           └ llmHttp        重试循环
              └ performLlmRequest   超时/取消合成 signal → fetch → SSE 或 JSON
```

返回结构对前端保持向后兼容，只做加法：

```js
{ ok, text, raw, providerLabel, usedModel, usedEndpoint,   // 一直都有
  usedFallback, usage, finishReason, durationMs, httpAttempts, retries, attempts }
```

失败时是 `{ ok:false, error, errorKind, errorHint, attempts }`。`error` 里已经把 hint 拼进去了，前端直接 `setStatus(response.error)` 即可。

## 3. 错误分类

两个决策全靠它：**要不要重试**、**要不要切备用模型**。混在一起会出两种坏事 —— 用户按了取消却触发备用模型跑完一轮；或者 400 参数错在主备两家各撞一次，白等一倍时间。

| kind | 触发 | 重试 | 切备用 |
|---|---|---|---|
| `aborted` | 用户取消 | ✗ | ✗ |
| `config` | 缺 Endpoint / Model / Key | ✗ | ✓ |
| `auth` | 401 / 403 | ✗ | ✓ |
| `rate_limit` | 429 | ✓ | ✓ |
| `server` | 5xx | ✓ | ✓ |
| `timeout` | 408 / 504 / 本地超时 | ✓ | ✓ |
| `network` | fetch 直接 reject | ✓ | ✓ |
| `bad_request` | 4xx 其余 | ✗ | ✓ |
| `not_found` | 404 | ✗ | ✓ |
| `empty` | 200 但没有正文 | ✗ | ✓ |
| `parse` | 不是 JSON / SSE | ✗ | ✓ |

两条不那么显然的：

- **`aborted` 是唯一不切备用的**。切了的话「取消」在用户眼里就变成了「又跑了一轮」。
- **`config` 重试无用但要切备用**。主模型没填 Key 恰恰是最该走备用的场景。

`empty` 的文案按 `finish_reason` 分岔：`length` 直接说「撞到 max_tokens，思考过程也算在这个额度里」，比笼统的「模型返回空」有用得多。

## 4. 重试

指数退避 + ±25% 抖动，默认 3 次、600ms 起、6s 封顶。

`Retry-After` 认秒数也认 HTTP 日期。**但服务端要求等待超过 15 秒时不重试，直接返回让上层切备用** —— 用户盯着面板，切一家比干等 60 秒快得多。`computeRetryDelay()` 返回 `null` 就是这个意思。

重试只在 transport 做。上层拿到的要么是成功，要么是一个已经放弃重试的 `LlmError`。

## 5. 各家的坑

这张表是踩出来的，动协议层前先看：

| 服务商 / 协议 | 坑 |
|---|---|
| 所有 OpenAI 兼容 | 发未知字段会直接 400。关闭思考时**一个思考相关字段都不能带** |
| DeepSeek | V4 默认就开着思考且是高档。选「关闭」必须显式发 `thinking:{type:'disabled'}`，否则白白拖慢反推 |
| DeepSeek | `deepseek-chat` / `deepseek-reasoner` 两个旧别名已于 2026-07-24 完全退役 |
| Responses (xAI) | 只认 `low` / `high` 两档，中档往上取 |
| Responses（通用） | assistant 历史消息的内容类型是 `output_text`，不是 `input_text` —— 全写成 `input_text` 会被严格实现拒掉（写词对话流带上历史后踩到） |
| Anthropic | 开 extended thinking 时**不接受 `temperature`**，且 `max_tokens` 必须大于 `budget_tokens` |
| Anthropic | 不接受相邻的两条同角色消息，要合并 |
| Anthropic | 没有 JSON 模式。用预填 `{` 逼它进对象，解析时补回来；开了思考不能预填 |
| Anthropic | 工具字段是 `input_schema` 不是 `parameters`；回填要用 `tool_use` / `tool_result` 块 |
| Gemini | 模型列表的 Key 走 query，不走 `Authorization` 头 |
| Vertex | 要的是 `gcloud auth print-access-token` 输出的 access token，约 1 小时过期 |
| 中转站 | 可能把 SSE 标成 `text/plain`，也可能返回 HTML 错误页。两种都单独识别 |

## 6. 取消与超时

默认 90 秒超时（连接测试 25 秒）。在这之前，一个卡住的 Endpoint 会让面板永远停在「反推中」，且没有出路。

带 `runId` 的请求登记在 `activeLlmRuns` 里，`nai-llm-cancel` 可掐掉。面板上主按钮在请求在途时变成「取消」，不再是禁用态。

## 7. 图片预算

反推是把整张图 base64 塞进请求里。一张 12MB 的 PNG 编码后约 16MB —— 慢、贵，而且不少服务商直接 400。所以图片在回给前端之前先过一道预算（`js/background/02-image-tools.js`）：

- 长边超过 1536px 就等比缩（视觉模型看这个分辨率绰绰有余）
- 缩完仍超 1.4MB 才转 JPEG（q=0.85）；能留 PNG 就留 PNG
- 已经小于 220KB 的不动 —— 重编码只会掉画质
- GIF 直接放过：重编码只会拿到第一帧还丢了信息

「缩到多大、转不转格式」抽成纯函数 `planImageBudget()`，因为 OffscreenCanvas 在测试环境里没有，但这个判断必须能测。

**分块截图的每一块都不能单独压** —— 宽高会和 `tiles` 里声明的对不上，拼出来是错位的。所以 `nai-capture-visible-area` 带 `raw: true` 时跳过预算，压缩留到 `nai-stitch-capture-tiles` 拼完再做。

页面里内嵌的 `data:` 图片不经过抓取环节，走 `nai-budget-image` 单独补一次。

## 8. 给 Agent 用的两个原语

```js
runLlmJson(config, options)      // → { value, text, repaired }
runLlmToolLoop({ config, tools, executeTool, maxSteps }, options)
```

- `runLlmJson` 先按协议开 JSON 模式，用 `extractJsonBlock()` 宽松解析（剥代码框、括号配对扫描、跳过字符串内的括号）。失败**只修一次**：把原文和「这不是合法 JSON」回喂。两次给不出的模型，第三次通常也给不出。
- `runLlmToolLoop` 里工具自身抛错会被包成 `{error}` 喂回模型而不是炸掉整轮 —— 模型往往能换个参数重试。`maxSteps` 是硬闸，防模型卡在反复调同一个工具上。

## 9. 测试

```bash
node scripts/test-llm.mjs
```

[scripts/lib/background-sandbox.mjs](./scripts/lib/background-sandbox.mjs) 把 `js/background/*.js` 按上线时同样的顺序拼起来，丢进 `node:vm` 跑，`fetch` / `chrome` 全部注入。**测的是真正上线的那份代码，不是为测试另写的副本。**

沙箱提供 `mockFetch()`、`sendMessage()`（走真正的消息路由）和几个响应构造器：`jsonResponse` / `textResponse` / `sseResponse`（按块吐，增量路径才真被走到）/ `networkFailure` / `hangingResponse`（只对 abort 有反应，用来测超时和取消）。

两个注意点：

- 沙箱里造出来的对象属于另一个 realm，`assert.deepStrictEqual` 会因为原型不同判不等。测试里用 `deepEqual()` 包装（走一遍 JSON 再比）。
- 测重试时传 `sleep: async (ms) => slept.push(ms)`，既跑得快又能断言真实等了多久。

## 10. 加一家服务商 / 加一个协议

**加服务商**：只改 `PROVIDER_PRESETS`（[js/assistant/01-constants.js](./js/assistant/01-constants.js)）。如果它有独特脾气（像 DeepSeek 的 thinking），在协议适配器里按 `config.providerId` 分岔，并补一条测试。

**加协议**：在 `LLM_PROTOCOLS` 里加一项，实现 `buildRequest` / `parseResult` / `parseStreamEvent` / `buildModelsRequest`，然后在 `PROTOCOL_OPTIONS` 里登记。传输层和错误层不需要动 —— 需要动就说明分层破了。
