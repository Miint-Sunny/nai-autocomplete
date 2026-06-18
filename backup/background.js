// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[NAI-AC] Extension installed');
});

function getActionPage(url) {
  try {
    const parsed = new URL(url || '');
    return parsed.origin === 'https://novelai.net' && parsed.pathname === '/image'
      ? 'library'
      : 'reverse';
  } catch (error) {
    return 'reverse';
  }
}

function updateActionTitle(tabId, url) {
  if (!tabId) return;
  const title = getActionPage(url) === 'library' ? '词库' : '图像反推助手';
  chrome.action.setTitle({ tabId, title });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  const page = getActionPage(tab.url);

  chrome.tabs.sendMessage(tab.id, { type: 'nai-open-panel', page }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[NAI-AC] Failed to open panel from action click:', chrome.runtime.lastError.message);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || tab.url) {
    updateActionTitle(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    updateActionTitle(tabId, tab?.url);
  });
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function dataUrlToImageSource(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mediaType: match[1],
    data: match[2],
  };
}

function extractTextParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.output_text === 'string') return item.output_text;
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean);
}

function extractAssistantText(data) {
  const chatChoice = data?.choices?.[0]?.message?.content;
  if (typeof chatChoice === 'string' && chatChoice.trim()) {
    return chatChoice.trim();
  }
  if (Array.isArray(chatChoice)) {
    const text = extractTextParts(chatChoice).join('\n').trim();
    if (text) return text;
  }

  const anthropicContent = data?.content;
  if (Array.isArray(anthropicContent)) {
    const text = extractTextParts(anthropicContent).join('\n').trim();
    if (text) return text;
  }

  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    const text = data.output
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        if (Array.isArray(item.content)) return extractTextParts(item.content);
        return extractTextParts([item]);
      })
      .join('\n')
      .trim();
    if (text) return text;
  }

  return '';
}

function extractStreamingText(data) {
  const chunks = [];

  const chatDelta = data?.choices?.[0]?.delta?.content;
  if (typeof chatDelta === 'string' && chatDelta) {
    chunks.push(chatDelta);
  } else if (Array.isArray(chatDelta)) {
    const text = extractTextParts(chatDelta).join('');
    if (text) chunks.push(text);
  }

  if (typeof data?.delta === 'string' && data.delta) {
    chunks.push(data.delta);
  }
  if (typeof data?.delta?.text === 'string' && data.delta.text) {
    chunks.push(data.delta.text);
  }
  if (typeof data?.text === 'string' && data.text) {
    chunks.push(data.text);
  }
  if (typeof data?.output_text === 'string' && data.output_text) {
    chunks.push(data.output_text);
  }

  return chunks.join('');
}

function parseJsonSafely(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function parseEventStream(rawText) {
  const chunks = [];
  let finalData = null;

  const blocks = String(rawText || '').split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) continue;

    const payloadText = dataLines.join('\n').trim();
    if (!payloadText || payloadText === '[DONE]') continue;

    const payload = parseJsonSafely(payloadText);
    if (!payload) continue;

    if (payload?.type === 'response.completed' && payload.response) {
      finalData = payload.response;
    } else if (payload?.type === 'message_stop' && payload.message) {
      finalData = payload.message;
    } else {
      finalData = payload;
    }

    const deltaText = extractStreamingText(payload);
    if (deltaText) {
      chunks.push(deltaText);
    }
  }

  const text = chunks.join('').trim() || extractAssistantText(finalData);
  return {
    data: finalData || { stream: rawText },
    text,
  };
}

function extractErrorMessage(data, fallbackMessage) {
  if (!data) return fallbackMessage;
  if (typeof data === 'string' && data.trim()) return data.trim();
  return data?.error?.message || data?.message || data?.error || fallbackMessage;
}

function buildFetchFailureMessage(url, error) {
  let hostText = url;
  let extraHints = [];

  try {
    const parsed = new URL(url);
    hostText = `${parsed.protocol}//${parsed.host}`;

    if (parsed.protocol === 'http:') {
      extraHints.push('Endpoint \u4f7f\u7528\u4e86 HTTP');
    }

    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname)) {
      extraHints.push('Endpoint \u662f\u672c\u673a\u670d\u52a1');
    }

    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(parsed.hostname)) {
      extraHints.push('Endpoint \u662f\u5185\u7f51\u5730\u5740');
    }
  } catch (parseError) {
    // keep original url
  }

  const detail = String(error instanceof Error ? error.message : error || '').trim() || 'Failed to fetch';
  const hintText = extraHints.length ? ` \u53ef\u80fd\u70b9\uff1a${extraHints.join('\uff0c')}\u3002` : '';

  return `\u672a\u62ff\u5230 HTTP \u54cd\u5e94\uff08${hostText}\uff09\uff0c\u5c5e\u4e8e\u7f51\u7edc\u5c42 failed to fetch\u3002\u8fd9\u901a\u5e38\u4e0d\u662f\u6a21\u578b\u8fd4\u56de\u7a7a\u6587\u672c\uff0c\u800c\u662f Endpoint \u6839\u672c\u6ca1\u6709\u6210\u529f\u8fd4\u56de HTTP \u54cd\u5e94\u3002\u8bf7\u68c0\u67e5 Endpoint \u3001\u7aef\u53e3\u3001\u534f\u8bae\u3001\u8bc1\u4e66\u6216\u4ee3\u7406\u914d\u7f6e\u3002${hintText} \u539f\u59cb\u9519\u8bef\uff1a${detail}`;
}

function buildOpenAIChatMessages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    return {
      role: message.role,
      content: message.content.map((item) => {
        if (item.type === 'text') {
          return { type: 'text', text: item.text };
        }

        if (item.type === 'image_url') {
          return {
            type: 'image_url',
            image_url: { url: item.image_url?.url || '' },
          };
        }

        return item;
      }),
    };
  });
}

function buildResponsesInput(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return {
        role: message.role,
        content: [{ type: 'input_text', text: String(message.content || '') }],
      };
    }

    return {
      role: message.role,
      content: message.content.map((item) => {
        if (item.type === 'text') {
          return { type: 'input_text', text: item.text };
        }

        if (item.type === 'image_url') {
          return {
            type: 'input_image',
            image_url: item.image_url?.url || '',
          };
        }

        return item;
      }),
    };
  });
}
function buildAnthropicPayload(config) {
  const systemParts = [];
  const userParts = [];

  (config.messages || []).forEach((message) => {
    const items = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: String(message.content || '') }];

    items.forEach((item) => {
      if (item.type === 'text') {
        const part = { type: 'text', text: item.text };
        if (message.role === 'system') systemParts.push(part);
        else userParts.push(part);
        return;
      }

      if (item.type === 'image_url' && message.role !== 'system') {
        const source = dataUrlToImageSource(item.image_url?.url || '');
        if (source) {
          userParts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: source.mediaType,
              data: source.data,
            },
          });
        }
      }
    });
  });

  return {
    model: config.model,
    system: systemParts.map((part) => part.text).join('\n\n').trim() || undefined,
    messages: [{ role: 'user', content: userParts }],
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.4,
    max_tokens: typeof config.maxTokens === 'number' ? config.maxTokens : 700,
    stream: false,
  };
}

function buildRequestConfig(config) {
  const protocol = config.protocol || 'openai-chat';
  const endpoint = config.endpoint;
  const apiKey = config.apiKey;

  if (!endpoint || !apiKey || !config.model || !Array.isArray(config.messages)) {
    throw new Error('Missing required LLM parameters');
  }

  if (protocol === 'responses') {
    return {
      url: endpoint,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: buildResponsesInput(config.messages),
          temperature: typeof config.temperature === 'number' ? config.temperature : 0.4,
          max_output_tokens: typeof config.maxTokens === 'number' ? config.maxTokens : 700,
          stream: false,
        }),
      },
    };
  }

  if (protocol === 'anthropic-messages') {
    return {
      url: endpoint,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(buildAnthropicPayload(config)),
      },
    };
  }

  return {
    url: endpoint,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildOpenAIChatMessages(config.messages),
        temperature: typeof config.temperature === 'number' ? config.temperature : 0.4,
        max_tokens: typeof config.maxTokens === 'number' ? config.maxTokens : 700,
        stream: false,
      }),
    },
  };
}

async function runLlmRequest(config) {
  const request = buildRequestConfig(config);
  let response;

  try {
    response = await fetch(request.url, request.options);
  } catch (error) {
    throw new Error(buildFetchFailureMessage(request.url, error));
  }

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  let data = null;
  let text = '';

  if (contentType.includes('text/event-stream')) {
    const parsedStream = parseEventStream(rawText);
    data = parsedStream.data;
    text = parsedStream.text;
  } else {
    data = parseJsonSafely(rawText);
    text = extractAssistantText(data);
    if (!text && typeof rawText === 'string' && rawText.trim() && !data) {
      text = rawText.trim();
    }
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `LLM request failed: ${response.status}`));
  }

  return {
    text,
    raw: data || rawText,
  };
}

async function runLlmWithFallback(payload) {
  const attempts = [];
  const configs = [payload.primary, payload.fallback].filter(Boolean);

  for (const config of configs) {
    try {
      const result = await runLlmRequest(config);
      return {
        ok: true,
        text: result.text,
        raw: result.raw,
        providerLabel: config.label || config.providerId || config.protocol || 'custom',
        usedModel: config.model,
        usedEndpoint: config.endpoint,
        attempts,
      };
    } catch (error) {
      attempts.push({
        label: config.label || config.providerId || config.protocol || 'custom',
        model: config.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const lastError = attempts[attempts.length - 1]?.error || 'LLM request failed';
  return {
    ok: false,
    error: lastError,
    attempts,
  };
}

function deriveModelsEndpoint(config) {
  const endpointUrl = new URL(config.endpoint);

  if (config.providerId === 'gemini-openai') {
    endpointUrl.pathname = '/v1beta/models';
    endpointUrl.search = '';
    endpointUrl.searchParams.set('key', config.apiKey);
    return endpointUrl.toString();
  }

  let path = endpointUrl.pathname;
  path = path.replace(/\/(chat\/completions|responses|messages)\/?$/, '/models');
  if (!/\/models\/?$/.test(path)) {
    path = path.replace(/\/+$/, '') + '/models';
  }
  endpointUrl.pathname = path;
  endpointUrl.search = '';
  return endpointUrl.toString();
}

function buildModelsRequestConfig(config) {
  const endpoint = deriveModelsEndpoint(config);

  if (config.providerId === 'gemini-openai') {
    return {
      url: endpoint,
      options: {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    };
  }

  if (config.protocol === 'anthropic-messages') {
    return {
      url: endpoint,
      options: {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
    };
  }

  return {
    url: endpoint,
    options: {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
  };
}

function extractModelIds(data, config) {
  if (Array.isArray(data?.data)) {
    return data.data
      .map((item) => (item && typeof item.id === 'string' ? item.id : ''))
      .filter(Boolean);
  }

  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (typeof item.id === 'string') return item.id;
        if (typeof item.name === 'string') {
          return item.name.replace(/^models\//, '');
        }
        return '';
      })
      .filter(Boolean);
  }

  return [];
}

async function listModels(config) {
  if (!config?.endpoint || !config?.apiKey) {
    throw new Error('Missing required model list parameters');
  }

  const request = buildModelsRequestConfig(config);
  const response = await fetch(request.url, request.options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const messageText =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `Model list request failed: ${response.status}`;
    throw new Error(messageText);
  }

  const models = Array.from(new Set(extractModelIds(data, config))).sort((a, b) => a.localeCompare(b));
  return { models, raw: data };
}
async function cropCapturedArea(dataUrl, rect) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const dpr = Number(rect.devicePixelRatio) || 1;
  const sx = Math.max(0, Math.floor(rect.left * dpr));
  const sy = Math.max(0, Math.floor(rect.top * dpr));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.floor(rect.width * dpr)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.floor(rect.height * dpr)));

  const canvas = new OffscreenCanvas(sw, sh);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to crop captured image');
  }

  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await croppedBlob.arrayBuffer();
  return 'data:image/png;base64,' + arrayBufferToBase64(buffer);
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
        if (!imageUrl || typeof imageUrl !== 'string') {
          throw new Error('Missing image URL');
        }

        const fetchOptions = {
          credentials: 'include',
          cache: 'no-cache',
        };

        if (/^https?:/i.test(referrer)) {
          fetchOptions.referrer = referrer;
          fetchOptions.referrerPolicy = 'strict-origin-when-cross-origin';
        }

        let response = await fetch(imageUrl, fetchOptions);
        if (!response.ok && fetchOptions.referrer) {
          response = await fetch(imageUrl, {
            credentials: 'include',
            cache: 'no-cache',
          });
        }

        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? 'Image fetch failed: 403. The site may be blocking hotlink requests; try selecting the fully visible image again.'
              : 'Image fetch failed: ' + response.status
          );
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const buffer = await response.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);

        sendResponse({
          ok: true,
          dataUrl: 'data:' + contentType + ';base64,' + base64,
          sourceUrl: imageUrl,
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
        sendResponse({
          ok: true,
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

  if (message.type === 'nai-llm-chat') {
    (async () => {
      try {
        const result = await runLlmWithFallback(message.payload || {});
        sendResponse(result);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }

  if (message.type === 'nai-list-models') {
    (async () => {
      try {
        const result = await listModels(message.payload || {});
        sendResponse({ ok: true, models: result.models, raw: result.raw });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }

  return false;
});
