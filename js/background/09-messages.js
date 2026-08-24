// 消息路由。图片相关的处理保持原样，LLM 相关的换成新的 runner，
// 并补上 runId（可取消）与调试日志两个入口。

const LLM_MESSAGE_TIMEOUT_MS = 90000;
// Agent 一轮里可能要跑好几次请求（工具循环），单次给的额度也就更宽。
const AGENT_MESSAGE_TIMEOUT_MS = 120000;

// 图片一律先过预算再回给前端：反推、截图、拼接三条路都会走到模型请求里去
// 顺序不能反：applyImageBudget 会缩图并转 JPEG，PNG 文本块和 alpha 隐写会一起没掉。
// 元数据必须在压缩之前、还拿着原始字节的时候读。
async function readNaiMetadataFromDataUrl(dataUrl) {
  try {
    const match = /^data:([^;,]*)[^,]*,(.*)$/s.exec(String(dataUrl || ''));
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return await extractNaiMetadata(bytes, match[1] || 'image/png');
  } catch (error) {
    return null;
  }
}

async function respondWithBudgetedImage(sendResponse, payload) {
  // 显式 opt-in：截图和分块拼接出来的图是画布重绘的，永远不可能带元数据，
  // 给它们再解一遍全尺寸像素纯属浪费。
  const naiMetadata = payload.readMetadata ? await readNaiMetadataFromDataUrl(payload.dataUrl) : null;
  const budgeted = await applyImageBudget(payload.dataUrl);
  const { readMetadata: _ignored, ...rest } = payload;
  sendResponse({
    ...rest,
    ok: true,
    naiMetadata,
    dataUrl: budgeted.dataUrl,
    imageBytes: budgeted.bytes,
    imageOriginalBytes: budgeted.originalBytes ?? budgeted.bytes,
    imageResized: budgeted.changed,
    imageWidth: budgeted.width,
    imageHeight: budgeted.height,
  });
}

function toMessageError(error) {
  const llmError = asLlmError(error);
  return {
    ok: false,
    error: llmError.toDisplayString(),
    errorKind: llmError.kind,
    errorHint: llmError.hint,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'nai-fetch-image-dataurl') {
    (async () => {
      try {
        const imageUrl = message.url;
        const referrer = typeof message.referrer === 'string' ? message.referrer : sender?.tab?.url || '';
        const candidateUrls = Array.isArray(message.urls)
          ? message.urls.filter((url) => typeof url === 'string' && url)
          : [];
        const urls = expandGelbooruHotlinkCandidates(candidateUrls.length ? candidateUrls : imageUrl ? [imageUrl] : []);

        if (!urls.length) {
          throw new Error('Missing image URL');
        }

        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        const getReferrerCandidates = (targetUrl) => {
          const referrers = [];
          if (/^https?:/i.test(referrer)) referrers.push(referrer);
          if (/pximg\.net/i.test(targetUrl)) referrers.push('https://www.pixiv.net/');
          if (/gelbooru\.com/i.test(targetUrl)) referrers.push('https://gelbooru.com/');
          return [...new Set(referrers), ''];
        };

        const isRemoteCdnImage = (targetUrl) => /pximg\.net/i.test(targetUrl) || /img\d+\.gelbooru\.com/i.test(targetUrl);

        const fetchImage = async (targetUrl) => {
          let lastError = null;
          const normalizedUrl = normalizeGelbooruCdnUrl(targetUrl);

          for (const requestReferrer of getReferrerCandidates(normalizedUrl)) {
            const fetchOptions = {
              cache: 'no-cache',
              headers: fetchHeaders,
              credentials: isRemoteCdnImage(normalizedUrl) ? 'omit' : 'include',
            };

            if (requestReferrer) {
              fetchOptions.referrer = requestReferrer;
              fetchOptions.referrerPolicy = 'strict-origin-when-cross-origin';
            } else {
              fetchOptions.referrerPolicy = 'no-referrer';
            }

            try {
              const response = await fetch(normalizedUrl, fetchOptions);
              if (!response.ok) {
                throw new Error(
                  response.status === 403
                    ? 'Image fetch failed: 403. The site may be blocking hotlink requests; try selecting the fully visible image again.'
                    : 'Image fetch failed: ' + response.status,
                );
              }

              const contentType = response.headers.get('content-type') || '';
              if (contentType && !/^image\//i.test(contentType) && !/^application\/octet-stream$/i.test(contentType)) {
                throw new Error('Image fetch failed: response is not an image');
              }

              const buffer = await response.arrayBuffer();
              if (buffer.byteLength < 64) {
                throw new Error('Image fetch failed: empty response');
              }

              const resolvedType = /^image\//i.test(contentType) ? contentType : 'image/png';
              return {
                dataUrl: 'data:' + resolvedType + ';base64,' + arrayBufferToBase64(buffer),
                sourceUrl: normalizedUrl,
              };
            } catch (error) {
              lastError = error;
            }
          }

          throw lastError || new Error('Image fetch failed');
        };

        let lastError = null;
        for (const targetUrl of urls) {
          try {
            const result = await fetchImage(targetUrl);
            await respondWithBudgetedImage(sendResponse, { ...result, readMetadata: true });
            return;
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error('Image fetch failed');
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }
  if (message.type === 'nai-stitch-capture-tiles') {
    (async () => {
      try {
        const width = Number(message.width);
        const height = Number(message.height);
        const dpr = Number(message.devicePixelRatio) || 1;
        const tiles = Array.isArray(message.tiles) ? message.tiles : [];

        if (!width || !height || !tiles.length) {
          throw new Error('Missing stitch tiles');
        }

        const dataUrl = await stitchCaptureTiles(width, height, tiles, dpr);
        await respondWithBudgetedImage(sendResponse, { dataUrl });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }
  if (message.type === 'nai-capture-visible-area') {
    (async () => {
      try {
        const rect = message.rect || {};
        if (typeof rect.left !== 'number' || typeof rect.top !== 'number' || typeof rect.width !== 'number' || typeof rect.height !== 'number') {
          throw new Error('Missing capture rect');
        }

        const screenshotDataUrl = await new Promise((resolve, reject) => {
          chrome.tabs.captureVisibleTab(sender?.tab?.windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(dataUrl);
          });
        });

        const croppedDataUrl = await cropCapturedArea(screenshotDataUrl, rect);

        // 分块截图的每一块都得保持原尺寸，压缩要等拼完再做 ——
        // 单独压每一块会让宽高和 tiles 里声明的对不上，拼出来是错位的。
        if (message.raw) {
          sendResponse({ ok: true, dataUrl: croppedDataUrl, sourceUrl: sender?.tab?.url || '' });
          return;
        }

        await respondWithBudgetedImage(sendResponse, {
          dataUrl: croppedDataUrl,
          sourceUrl: sender?.tab?.url || '',
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }

  // 页面上直接就是 data URL 的图片不经过抓取环节，得单独走一次预算
  if (message.type === 'nai-budget-image') {
    (async () => {
      try {
        await respondWithBudgetedImage(sendResponse, {
          dataUrl: message.dataUrl,
          readMetadata: message.readMetadata !== false,
        });
      } catch (error) {
        sendResponse({ ok: true, dataUrl: message.dataUrl, imageResized: false });
      }
    })();

    return true;
  }

  if (message.type === 'nai-llm-chat') {
    (async () => {
      const runId = typeof message.runId === 'string' ? message.runId : '';
      const controller = registerLlmRun(runId);

      try {
        const result = await runLlmWithFallback(message.payload || {}, {
          signal: controller?.signal,
          timeoutMs: numberOr(message.timeoutMs, LLM_MESSAGE_TIMEOUT_MS),
        });
        sendResponse({ ...result, runId });
      } catch (error) {
        sendResponse({ ...toMessageError(error), runId });
      } finally {
        releaseLlmRun(runId);
      }
    })();

    return true;
  }

  if (message.type === 'nai-agent-run') {
    (async () => {
      const runId = typeof message.runId === 'string' ? message.runId : '';
      const controller = registerLlmRun(runId);

      try {
        const result = await runPromptAgent(message.payload || {}, {
          signal: controller?.signal,
          timeoutMs: numberOr(message.timeoutMs, AGENT_MESSAGE_TIMEOUT_MS),
        });
        sendResponse({ ...result, runId });
      } catch (error) {
        sendResponse({ ...toMessageError(error), runId });
      } finally {
        releaseLlmRun(runId);
      }
    })();

    return true;
  }

  if (message.type === 'nai-llm-cancel') {
    sendResponse({ ok: true, cancelled: cancelLlmRun(message.runId) });
    return true;
  }

  if (message.type === 'nai-llm-debug-log') {
    sendResponse({ ok: true, entries: llmDebugLog.slice(0, LLM_DEBUG_LOG_LIMIT) });
    return true;
  }

  if (message.type === 'nai-list-models') {
    (async () => {
      try {
        const result = await listModels(message.payload || {});
        sendResponse({ ok: true, models: result.models, raw: result.raw });
      } catch (error) {
        sendResponse(toMessageError(error));
      }
    })();

    return true;
  }

  return false;
});
