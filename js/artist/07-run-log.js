/* ================= 运行日志（方便排查问题） ================= */
let grabLogs = [];

function addLog(msg) {
  const t = new Date();
  const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  grabLogs.push(`[${time}] ${msg}`);
  if (grabLogs.length > 200) grabLogs.shift();
  renderLogs();
}
function renderLogs() {
  const box = document.getElementById('logContent');
  if (box) {
    box.textContent = grabLogs.length ? grabLogs.join('\n') : '（还没有日志）';
    box.scrollTop = box.scrollHeight;
  }
}
function openLogModal() {
  renderLogs();
  document.getElementById('logModal').classList.add('show');
}

/* 带超时的 fetch：卡住超过限定时间就放弃，换别的通道 */
function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}
function errText(e) {
  return e.name === 'AbortError' ? '连接超时（15秒无响应，网络可能被拦截）' : e.message;
}
const LIMIT_ERR = '搜索条件超限：你同时选了「排序+分级」，加上画师tag共3个条件，D站免费账号最多2个。请把其中一项改成「不限」';

/* 一键诊断：测试所有网络通道，结果写进日志 */
async function runDiagnosis() {
  openLogModal();
  addLog('===== 开始诊断连接 =====');
  addLog('浏览器UA: ' + navigator.userAgent.slice(0, 80));
  let diagnosticPost = null;
  try {
    const r = await fetchWithTimeout('https://danbooru.donmai.us/posts.json?limit=1', { credentials: 'include' }, 10000);
    addLog(`①D站API直连: HTTP ${r.status} ${r.headers.get('content-type') || ''}`);
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const posts = await r.json();
      diagnosticPost = Array.isArray(posts) ? posts[0] : null;
    }
  } catch (e) { addLog('①D站API直连: ' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://danbooru.donmai.us/', { credentials: 'include' }, 10000);
    addLog(`②D站首页: HTTP ${r.status}`);
  } catch (e) { addLog('②D站首页: ' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://r.jina.ai/https%3A%2F%2Fdanbooru.donmai.us%2Fposts.json%3Flimit%3D1', {}, 15000);
    addLog(`③备用通道(jina): HTTP ${r.status}`);
  } catch (e) { addLog('③备用通道(jina): ' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://danbooru.donmai.us/posts.json?limit=1'), {}, 15000);
    addLog(`④备用通道(allorigins): HTTP ${r.status}`);
  } catch (e) { addLog('④备用通道(allorigins): ' + errText(e)); }
  const imageUrls = diagnosticPost ? postImageCandidates(diagnosticPost) : [];
  if (!imageUrls.length) {
    addLog('⑤真实图片地址: 没有可测试的作品图片；图床根目录返回 403 不代表图片不可访问');
  } else {
    let loaded = false;
    for (const candidate of imageUrls.slice(0, 3)) {
      try {
        const r = await fetchWithTimeout(candidate.url, { credentials: 'include' }, 10000);
        addLog(`⑤真实图片(${candidate.label}): HTTP ${r.status} ${r.headers.get('content-type') || ''}`);
        if (r.ok) { loaded = true; break; }
      } catch (e) { addLog(`⑤真实图片(${candidate.label}): ` + errText(e)); }
    }
    if (!loaded) addLog('提示：图片不可访问时仍会保存画师作品标签和原帖入口，不影响后续画师。');
  }
  addLog('===== 诊断完成，点「复制日志」发给作者 =====');
}

