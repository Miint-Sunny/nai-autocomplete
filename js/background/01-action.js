// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[NAI-AC] Extension installed');
});

// 两个界面，两个入口：
//   · 右下悬浮球 → 悬浮窗（反推 / 写词 / 改词 / 画师 / 历史 / 设置）
//   · 浏览器扩展图标 → 工作台（只在 novelai.net 出图页有；别处退回悬浮窗）
function isWorkbenchPage(url) {
  try {
    const parsed = new URL(url || '');
    return parsed.origin === 'https://novelai.net' && parsed.pathname === '/image';
  } catch (error) {
    return false;
  }
}

function updateActionTitle(tabId, url) {
  if (!tabId) return;
  const title = isWorkbenchPage(url) ? '工作台' : '图像反推助手';
  chrome.action.setTitle({ tabId, title });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  const message = isWorkbenchPage(tab.url)
    ? { type: 'nai-open-workbench' }
    : { type: 'nai-open-panel', page: 'reverse' };

  chrome.tabs.sendMessage(tab.id, message, () => {
    if (chrome.runtime.lastError) {
      console.warn('[NAI-AC] Failed to open UI from action click:', chrome.runtime.lastError.message);
    }
  });
});

const ARTIST_LIBRARY_PAGE = 'pages/artist-library.html';

function focusOrOpenArtistLibrary() {
  const url = chrome.runtime.getURL(ARTIST_LIBRARY_PAGE);
  chrome.tabs.query({ url }, (tabs) => {
    const existing = !chrome.runtime.lastError && tabs?.[0];
    if (existing?.id) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    chrome.tabs.create({ url });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'nai-open-artist-library') return false;
  focusOrOpenArtistLibrary();
  sendResponse({ ok: true });
  return true;
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

