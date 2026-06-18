function ensureOfficialChunkBridgeScript() {
  if (document.documentElement.dataset.naiOfficialChunkBridgeInjected === 'true') return;
  document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'true';

  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('official-chunk-bridge.js');
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => {
      document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    document.documentElement.dataset.naiOfficialChunkBridgeInjected = 'error';
  }
}

// CSV 解析，正确处理引号中的逗号
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// 加载标签
async function loadTags() {
  try {
    const cached = localStorage.getItem('nai-ac-tags');
    const cacheTime = localStorage.getItem('nai-ac-tags-time');
    if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 86400000) {
      allTags = JSON.parse(cached);
      isLoading = false;
      console.log(`[NAI-AC] 已从缓存加载 ${allTags.length} 个标签`);
      return;
    }

    const response = await fetch(CONFIG.CSV_URL);
    const text = await response.text();
    const lines = text.split('\n');
    allTags = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = parseCSVLine(line);
      if (parts[0]) {
        allTags.push({
          tag: parts[0].trim(),
          category: parts[1]?.trim() || '0',
          postCount: parseInt(parts[2]) || 0,
          aliases: parts[3]?.split(',').map(a => a.trim()).filter(Boolean) || [],
          translation: parts[4]?.split('|')[0]?.trim() || '',
        });
      }
    }

    allTags.sort((a, b) => b.postCount - a.postCount);
    localStorage.setItem('nai-ac-tags', JSON.stringify(allTags.slice(0, 50000)));
    localStorage.setItem('nai-ac-tags-time', Date.now().toString());
    isLoading = false;
    console.log(`[NAI-AC] 已加载 ${allTags.length} 个标签`);
  } catch (e) {
    console.error('[NAI-AC] 标签加载失败:', e);
    isLoading = false;
  }
}

// 搜索标签
function searchTags(query) {
  if (!query || query.length < CONFIG.MIN_QUERY_LENGTH) return [];
  if (String(query || '').startsWith('@')) return [];
  const q = query.toLowerCase().replace(/_/g, ' ');
  const results = [];

  promptLibrary.forEach(entry => {
    const keys = getPromptLibrarySearchKeys(entry);
    let score = 0;
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().replace(/_/g, ' ');
      if (normalizedKey === q) {
        score = Math.max(score, 3000);
      } else if (normalizedKey.startsWith(q)) {
        score = Math.max(score, 2400);
      } else if (normalizedKey.includes(q)) {
        score = Math.max(score, 1800);
      }
    }

    if (score > 0) {
      results.push({
        ...entry,
        resultType: 'prompt-library',
        category: 'library',
        translation: getPromptLibrarySummary(entry),
        postCount: entry.tags.length,
        score: score + entry.tags.length / 100,
      });
    }
  });

  for (const tag of allTags) {
    if (results.length >= CONFIG.MAX_RESULTS * 3) break;
    const t = tag.tag.toLowerCase().replace(/_/g, ' ');
    const tr = tag.translation?.toLowerCase() || '';
    const aliases = tag.aliases || [];

    if (t.startsWith(q)) {
      results.push({ ...tag, score: 1000 + tag.postCount / 1e6 });
    } else if (t.includes(q)) {
      results.push({ ...tag, score: 500 + tag.postCount / 1e6 });
    } else if (tr.includes(q)) {
      results.push({ ...tag, score: 300 + tag.postCount / 1e6 });
    } else if (aliases.some(a => a.toLowerCase().replace(/_/g, ' ').includes(q))) {
      results.push({ ...tag, score: 200 + tag.postCount / 1e6, matchedAlias: aliases.find(a => a.toLowerCase().includes(q)) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, CONFIG.MAX_RESULTS);
}

// 创建补全容器
