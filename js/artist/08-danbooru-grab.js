/* ================= 自动抓取 D 站原图 ================= */
let grabRunning = false;
let grabStopFlag = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 等待标签页加载完成 */
function waitTabLoad(tabId, timeout) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); resolve(); }, timeout);
    const l = (tid, info) => {
      if (tid === tabId && info.status === 'complete') {
        clearTimeout(timer); chrome.tabs.onUpdated.removeListener(l); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(l);
  });
}

/* 找一个D站标签页，没有就自动打开一个 */
async function ensureDanbooruTab() {
  const tabs = await chrome.tabs.query({ url: 'https://danbooru.donmai.us/*' });
  if (tabs.length) return tabs[0];
  addLog('没有找到D站标签页，正在自动打开（如出现人机验证请完成它）...');
  const tab = await chrome.tabs.create({ url: 'https://danbooru.donmai.us/posts', active: true });
  await waitTabLoad(tab.id, 30000);
  await sleep(2000);
  return tab;
}

/* 通道2：借用户自己的D站标签页发请求（用浏览器已验证的身份，Cloudflare不会拦） */
async function fetchViaTab(url) {
  const tab = await ensureDanbooruTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        const t = await r.text();
        return { status: r.status, body: t.slice(0, 400000) };
      } catch (e) { return { status: -1, body: String(e) }; }
    },
    args: [url]
  });
  addLog('标签页通道: HTTP ' + result.status);
  return result;
}

/* 借标签页下载图片（返回blob） */
async function fetchImageViaTab(url) {
  const tabs = await chrome.tabs.query({ url: 'https://danbooru.donmai.us/*' });
  if (!tabs.length) return null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { status: r.status };
          const b = await r.blob();
          const dataUrl = await new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(b);
          });
          return { status: 200, dataUrl };
        } catch (e) { return { status: -1, err: String(e) }; }
      },
      args: [url]
    });
    if (result && result.status === 200 && result.dataUrl) {
      return await (await fetch(result.dataUrl)).blob();
    }
    addLog('标签页取图失败: HTTP ' + (result ? result.status : '无结果'));
  } catch (e) { addLog('标签页取图异常: ' + errText(e)); }
  return null;
}

async function fetchPosts(tag, count, rating, order) {
  const q = [tag, rating, order].filter(Boolean).join(' ');
  const apiUrl = 'https://danbooru.donmai.us/posts.json?limit=' + count + '&tags=' + encodeURIComponent(q);
  addLog('查询画师: ' + q);

  // 通道1：直接访问（带浏览器cookie，在D站通过过人机验证的话有机会成功）
  try {
    const res = await fetchWithTimeout(apiUrl, { credentials: 'include' });
    const ct = res.headers.get('content-type') || '';
    addLog(`直接访问: HTTP ${res.status} ${ct}`);
    if (res.ok && ct.includes('json')) return await res.json();
    if (res.status === 422) {
      if (rating && order) {
        addLog('搜索条件超过免费账号限制：自动取消排序，保留内容分级后重试');
        return await fetchPosts(tag, count, rating, '');
      }
      throw new Error(LIMIT_ERR);
    }
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    addLog('直接访问被拦，返回片段: ' + body);
  } catch (e) {
    if (e.message.includes('超限')) throw e;
    addLog('直接访问: ' + errText(e));
  }

  // 通道2：借用户自己的D站标签页（已验证身份，最可靠）
  try {
    const r = await fetchViaTab(apiUrl);
    if (r.status === 422) {
      if (rating && order) {
        addLog('标签页搜索条件超限：自动取消排序，保留内容分级后重试');
        return await fetchPosts(tag, count, rating, '');
      }
      throw new Error(LIMIT_ERR);
    }
    if (r.status === 200 && r.body.trim().startsWith('[')) return JSON.parse(r.body);
    addLog('标签页通道未成功，返回片段: ' + r.body.slice(0, 150).replace(/\s+/g, ' '));
  } catch (e) {
    if (e.message.includes('超限')) throw e;
    addLog('标签页通道: ' + errText(e));
  }

  // 通道3：jina 中转（目标网址的参数要转义，不然会被中转站自己吃掉）
  try {
    const proxyUrl = 'https://r.jina.ai/' + apiUrl.replace('?', '%3F').replace(/&/g, '%26');
    const res2 = await fetchWithTimeout(proxyUrl, {}, 20000);
    addLog('备用通道(jina): HTTP ' + res2.status);
    if (res2.status === 422) throw new Error(LIMIT_ERR);
    if (res2.ok) {
      const text = await res2.text();
      const marker = text.indexOf('Markdown Content:');
      const idx = text.indexOf('[', marker >= 0 ? marker : 0);
      if (idx >= 0) return JSON.parse(text.slice(idx));
      addLog('备用通道内容异常: ' + text.slice(0, 200).replace(/\s+/g, ' '));
    }
  } catch (e) {
    if (e.message.includes('超限')) throw e;
    addLog('备用通道(jina): ' + errText(e));
  }

  // 通道4：allorigins 中转
  try {
    const res3 = await fetchWithTimeout('https://api.allorigins.win/raw?url=' + encodeURIComponent(apiUrl), {}, 20000);
    addLog('备用通道(allorigins): HTTP ' + res3.status);
    if (res3.status === 422) throw new Error(LIMIT_ERR);
    if (res3.ok) {
      const text = await res3.text();
      if (text.trim().startsWith('[')) return JSON.parse(text);
      addLog('allorigins内容异常: ' + text.slice(0, 200).replace(/\s+/g, ' '));
    }
  } catch (e) {
    if (e.message.includes('超限')) throw e;
    addLog('备用通道(allorigins): ' + errText(e));
  }

  throw new Error('所有通道都失败了。请点左下角「📋 日志」→「复制日志」发给作者排查');
}

async function fetchImageBlob(url) {
  try {
    const res = await fetchWithTimeout(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }, 12000);
    if (res.ok) {
      const blob = await res.blob();
      if (!blob.type || blob.type.startsWith('image/')) return blob;
      addLog('图片直连返回的不是图片: ' + blob.type);
    }
    addLog('图片直连失败: HTTP ' + res.status + ' ' + url.slice(0, 80));
  } catch (e) {
    addLog('图片直连: ' + errText(e));
  }
  const viaTab = await fetchImageViaTab(url);
  if (viaTab) return viaTab;
  try {
    const res2 = await fetchWithTimeout('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {}, 20000);
    if (res2.ok) {
      const blob = await res2.blob();
      if (!blob.type || blob.type.startsWith('image/')) return blob;
      addLog('图片备用通道返回的不是图片: ' + blob.type);
    }
    addLog('图片备用通道失败: HTTP ' + res2.status);
  } catch (e) {
    addLog('图片备用通道: ' + errText(e));
  }
  return null;
}

function postImageCandidates(post) {
  const candidates = [];
  const seen = new Set();
  const add = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) return;
    let url;
    try { url = new URL(value, 'https://danbooru.donmai.us').href; }
    catch { return; }
    if (!/^https:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, label });
  };
  add(post.large_file_url, '样图');
  add(post.file_url, '原图');
  add(post.preview_file_url, '缩略图');
  add(post.preview_url, '预览图');
  const variants = Array.isArray(post.media_asset?.variants) ? post.media_asset.variants : [];
  for (const variant of variants) add(variant.url || variant.file_url, variant.type || variant.label || '备用尺寸');
  add(post.media_asset?.file_url, '资源原图');
  return candidates;
}

async function fetchPostImage(post) {
  if (post.file_ext && ['mp4', 'webm', 'zip', 'swf'].includes(post.file_ext)) return null;
  const candidates = postImageCandidates(post);
  if (!candidates.length) return null;
  for (const candidate of candidates) {
    try {
      const blob = await fetchImageBlob(candidate.url);
      if (!blob) continue;
      const dataUrl = await new Promise(resolve => {
      const obj = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const max = 900;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(obj);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(obj); resolve(null); };
      img.src = obj;
    });
      if (dataUrl) {
        addLog(`作品 #${post.id} 已下载${candidate.label}`);
        return dataUrl;
      }
    } catch (e) { addLog(`作品 #${post.id} ${candidate.label}失败: ${errText(e)}`); }
  }
  addLog(`作品 #${post.id} 所有图片地址不可用，将保留标签和原帖入口`);
  return null;
}

function postToEntry(post, dataUrl) {
  return {
    id: uid(),
    originalImg: dataUrl || null,
    sourcePostId: post.id,
    sourcePostUrl: `https://danbooru.donmai.us/posts/${post.id}`,
    sourceImageUrl: postImageCandidates(post)[0]?.url || '',
    naiImg: null,
    prompt: '',
    score: 0,
    comment: `D站作品 #${post.id}（赞 ${post.score ?? 0}）${dataUrl ? '' : ' · 图片暂时无法访问，可打开原帖或手动补图'}\n标签：${post.tag_string || ''}`,
    createdAt: Date.now()
  };
}

async function grabImagesForArtist(artist, count, rating, order, onProgress) {
  alignArtistComparisonEntries(artist);
  const posts = await fetchPosts(artist.tag, count, rating, order);
  if (!Array.isArray(posts) || posts.length === 0) return { images: 0, metadata: 0, duplicates: 0, paired: 0 };
  const result = { images: 0, metadata: 0, duplicates: 0, paired: 0 };
  const generatedOnly = artist.entries.slice().reverse().filter(entry => entry.naiImg && !entry.originalImg && !entry.sourcePostId);
  const keepGeneratedRecordsFirst = artist.entries.some(entry => entry.naiImg);
  const existingPosts = new Set(artist.entries.map(entry => String(entry.sourcePostId || (String(entry.comment || '').match(/D站(?:原图|作品)\s*#(\d+)/) || [])[1] || '')).filter(Boolean));
  for (let index = 0; index < posts.length; index++) {
    const p = posts[index];
    if (grabStopFlag) break;
    if (existingPosts.has(String(p.id))) { result.duplicates++; continue; }
    if (onProgress) onProgress(`处理第 ${index + 1}/${posts.length} 张：已下载 ${result.images} 张，已保留 ${result.metadata} 条作品信息...`);
    const dataUrl = await fetchPostImage(p);
    const original = postToEntry(p, dataUrl);
    const generated = generatedOnly.shift();
    if (generated) {
      attachOriginalToEntry(generated, original);
      result.paired++;
    } else if (keepGeneratedRecordsFirst) {
      artist.entries.unshift(original);
    } else {
      artist.entries.push(original);
    }
    existingPosts.add(String(p.id));
    if (dataUrl) result.images++;
    else result.metadata++;
    await sleep(400); // 温柔一点，别给D站太大压力
  }
  return result;
}

function setGrabUI(running, mode) {
  const prefix = mode === 'batch' ? 'Batch' : 'Grab';
  document.getElementById('btnStop' + prefix).style.display = running ? '' : 'none';
  document.getElementById('btnStart' + prefix).disabled = running;
}

async function startGrab() {
  if (grabRunning) return;
  const a = getArtist(currentArtistId);
  if (!a) return;
  if (!a.tag) { alert('这个画师还没填 tag，先点「编辑」补上'); return; }
  const count = parseInt(document.getElementById('gCount').value);
  const order = document.getElementById('gOrder').value;
  const rating = document.getElementById('gRating').value;
  const prog = document.getElementById('grabProgress');
  grabRunning = true; grabStopFlag = false;
  setGrabUI(true, 'single');
  try {
    prog.textContent = `正在查询 D 站：${a.tag} ...`;
    const result = await grabImagesForArtist(a, count, rating, order, t => prog.textContent = t);
    save(); renderList(); renderArtist();
    if (result.images || result.metadata) {
      prog.textContent = `完成！下载 ${result.images} 张图片${result.paired ? `，与 ${result.paired} 张 NAI 图对齐` : ''}，保留 ${result.metadata} 条无图作品信息${result.duplicates ? `，跳过 ${result.duplicates} 条重复作品` : ''} ✓`;
    } else {
      prog.textContent = result.duplicates ? `这些作品已经保存过了，跳过 ${result.duplicates} 条重复记录` : '没有找到该画师的作品；可以检查画师 tag 和分级条件';
    }
  } catch (e) {
    prog.textContent = '❌ ' + e.message;
  }
  grabRunning = false;
  setGrabUI(false, 'single');
}

async function startBatch() {
  if (grabRunning) return;
  const per = parseInt(document.getElementById('bCount').value);
  const order = document.getElementById('bOrder').value;
  const rating = document.getElementById('bRating').value;
  const skip = document.getElementById('bSkip').checked;
  const prog = document.getElementById('batchProgress');
  const targets = data.artists.filter(a => a.tag && (!skip || !a.entries.some(e => e.originalImg || e.sourcePostId)));
  if (!targets.length) { prog.textContent = '没有需要抓的画师（都已有作品记录，或没填tag）'; return; }
  grabRunning = true; grabStopFlag = false;
  setGrabUI(true, 'batch');
  let okArtists = 0;
  let totalImages = 0, totalMetadata = 0;
  const failed = [];
  let abortMsg = '';
  for (let i = 0; i < targets.length; i++) {
    if (grabStopFlag) break;
    const a = targets[i];
    prog.textContent = `[${i + 1}/${targets.length}] ${a.name} ...`;
    try {
      const result = await grabImagesForArtist(a, per, rating, order, null);
      if (result.images > 0 || result.metadata > 0 || result.duplicates > 0) {
        okArtists++;
        totalImages += result.images;
        totalMetadata += result.metadata;
        save();
      } else failed.push(a.name + '(无作品)');
    } catch (e) {
      failed.push(a.name);
      if (String(e.message).includes('防火墙') || String(e.message).includes('超限') || String(e.message).includes('备用通道')) {
        abortMsg = '❌ ' + e.message + '\n（已中止批量任务，解决后重新点「开始批量抓取」即可，已抓过的会自动跳过）';
        break;
      }
    }
    if (currentArtistId === a.id) renderArtist();
    await sleep(800);
  }
  if (abortMsg) {
    prog.textContent = abortMsg;
  } else if (grabStopFlag) {
    prog.textContent = `已停止。成功 ${okArtists} 位画师，下载 ${totalImages} 张图片，保留 ${totalMetadata} 条无图作品`;
  } else {
    prog.textContent = `批量完成！处理 ${okArtists} 位画师，下载 ${totalImages} 张图片，保留 ${totalMetadata} 条无图作品` + (failed.length ? `，未找到作品 ${failed.length} 位：${failed.slice(0, 5).join('、')}${failed.length > 5 ? '...' : ''}` : '');
  }
  renderList();
  grabRunning = false;
  setGrabUI(false, 'batch');
}

