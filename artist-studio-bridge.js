// NAI Studio <-> 原 NAI 画师记录本 同步桥接
// 只读取画师的轻量字段，不把 entries 里的大图通过 postMessage 传给网页。
const NAI_STUDIO_KEY = 'naiArtistTracker_v1';

async function readArtists() {
  return new Promise(resolve => {
    chrome.storage.local.get(NAI_STUDIO_KEY, res => {
      try {
        const raw = res[NAI_STUDIO_KEY] ? JSON.parse(res[NAI_STUDIO_KEY]) : { artists: [] };
        resolve((raw.artists || []).map(a => ({
          id: a.id,
          name: a.name || '',
          tag: a.tag || '',
          categories: Array.isArray(a.categories) ? a.categories : (Array.isArray(a.labels) ? a.labels : []),
          rating: Number(a.rating || 0),
          notes: a.notes || ''
        })));
      } catch {
        resolve([]);
      }
    });
  });
}

async function pushArtists() {
  const artists = await readArtists();
  window.postMessage({ type: 'NAI_STUDIO_ARTISTS', source: 'nai-artist-extension', artists }, '*');
}

window.addEventListener('message', e => {
  if (e.source !== window) return;
  if (e.data?.type === 'NAI_STUDIO_REQUEST_ARTISTS') pushArtists();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[NAI_STUDIO_KEY]) pushArtists();
});

pushArtists();
