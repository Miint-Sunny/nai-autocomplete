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
    box.textContent = grabLogs.length ? grabLogs.join('\n') : '暂无日志';
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
  return e.name === 'AbortError' ? '连接超时：15 秒内没有响应，网络可能被拦截' : e.message;
}
const LIMIT_ERR = '搜索条件超出限制：画师 tag、排序和内容分级共 3 个条件，Danbooru 免费账号最多支持 2 个。请将排序方式改为「最新发布」，或将内容分级改为「不限」。';
// 报错是什么类型看 code，不看文案：以前靠 message 里有没有「超限」「备用通道」来判断，
// 文案改过一次措辞，「所有通道都失败时中止批量获取」就悄悄失效了。
const GRAB_ERROR_LIMIT = 'search-limit';
const GRAB_ERROR_NETWORK = 'network';
function grabError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/* 一键诊断：测试所有网络通道，结果写进日志 */
async function runDiagnosis() {
  openLogModal();
  addLog('===== 开始网络诊断 =====');
  addLog('浏览器 UA：' + navigator.userAgent.slice(0, 80));
  let diagnosticPost = null;
  try {
    const r = await fetchWithTimeout('https://danbooru.donmai.us/posts.json?limit=1', { credentials: 'include' }, 10000);
    addLog(`① Danbooru API 直连：HTTP ${r.status} ${r.headers.get('content-type') || ''}`);
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const posts = await r.json();
      diagnosticPost = Array.isArray(posts) ? posts[0] : null;
    }
  } catch (e) { addLog('① Danbooru API 直连：' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://danbooru.donmai.us/', { credentials: 'include' }, 10000);
    addLog(`② Danbooru 首页：HTTP ${r.status}`);
  } catch (e) { addLog('② Danbooru 首页：' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://r.jina.ai/https%3A%2F%2Fdanbooru.donmai.us%2Fposts.json%3Flimit%3D1', {}, 15000);
    addLog(`③ 备用通道（jina）：HTTP ${r.status}`);
  } catch (e) { addLog('③ 备用通道（jina）：' + errText(e)); }
  try {
    const r = await fetchWithTimeout('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://danbooru.donmai.us/posts.json?limit=1'), {}, 15000);
    addLog(`④ 备用通道（allorigins）：HTTP ${r.status}`);
  } catch (e) { addLog('④ 备用通道（allorigins）：' + errText(e)); }
  const imageUrls = diagnosticPost ? postImageCandidates(diagnosticPost) : [];
  if (!imageUrls.length) {
    addLog('⑤ 图片地址：没有可测试的作品图片（图床根目录返回 403 不代表图片无法访问）');
  } else {
    let loaded = false;
    for (const candidate of imageUrls.slice(0, 3)) {
      try {
        const r = await fetchWithTimeout(candidate.url, { credentials: 'include' }, 10000);
        addLog(`⑤ 图片（${candidate.label}）：HTTP ${r.status} ${r.headers.get('content-type') || ''}`);
        if (r.ok) { loaded = true; break; }
      } catch (e) { addLog(`⑤ 图片（${candidate.label}）：` + errText(e)); }
    }
    if (!loaded) addLog('提示：图片无法访问时，仍会保存作品的 tag 和原帖链接，不影响后续画师。');
  }
  addLog('===== 诊断完成。如需排查问题，请点击「复制日志」发给开发者 =====');
}

