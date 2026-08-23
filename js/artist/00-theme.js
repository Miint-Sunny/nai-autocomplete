// 画师库独立页跟随反推助手设置里的主题预设与毛玻璃开关。
const ARTIST_PAGE_SETTINGS_KEY = 'nai-llm-assistant-settings';
const ARTIST_PAGE_DEFAULT_THEME = 'novelai';

function applyArtistPageAppearance(settings) {
  document.body.dataset.theme = settings?.themePreset || ARTIST_PAGE_DEFAULT_THEME;

  const strength = Number(settings?.glassStrength);
  const clamped = Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : 100;
  const amount = settings?.glassEffect === false ? 0 : clamped / 100;
  document.body.dataset.glass = amount > 0 ? 'on' : 'off';
  document.body.style.setProperty('--nai-md3-glass-amount', String(amount));
}

chrome.storage.local.get(ARTIST_PAGE_SETTINGS_KEY, (result) => {
  if (chrome.runtime.lastError) return;
  applyArtistPageAppearance(result?.[ARTIST_PAGE_SETTINGS_KEY]);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[ARTIST_PAGE_SETTINGS_KEY]) return;
  applyArtistPageAppearance(changes[ARTIST_PAGE_SETTINGS_KEY].newValue);
});
