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

