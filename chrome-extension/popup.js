'use strict';
// popup.js

const DEFAULT_PORT = 43218;
let fdmPort = DEFAULT_PORT;
let fdmOnline = false;

async function getPort() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'getPort' }, r => resolve((r && r.port) || DEFAULT_PORT));
  });
}

async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${fdmPort}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ping' }),
    });
    const data = await r.json();
    return data && data.type === 'pong';
  } catch { return false; }
}

async function getStatus() {
  try {
    const r = await fetch(`http://127.0.0.1:${fdmPort}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'getStatus' }),
    });
    return await r.json();
  } catch { return null; }
}

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

function renderDownloads(data) {
  const section = document.getElementById('active-section');
  const list    = document.getElementById('active-list');
  if (!data || !data.downloads || data.downloads.length === 0) {
    section.hidden = true; return;
  }
  const active = data.downloads.filter(d => d.status !== 'complete' && d.status !== 'error').slice(0, 5);
  if (active.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  list.innerHTML = active.map(d => {
    const pct = d.totalSize > 0 ? Math.round(d.downloadedSize / d.totalSize * 100) : 0;
    const name = (d.filename || d.url || '').split(/[/\\]/).pop().slice(0, 38);
    const badge = d.status === 'complete' ? 'badge-ok' : 'badge-dl';
    return `
      <div class="dl-item">
        <div class="dl-name" title="${name}">${name} <span class="badge ${badge}">${d.status}</span></div>
        <div class="dl-bar-wrap"><div class="dl-bar ${d.status==='complete'?'complete':''}" style="width:${d.status==='complete'?100:pct}%"></div></div>
        <div class="dl-meta">
          <span>${formatBytes(d.downloadedSize)}${d.totalSize>0?' / '+formatBytes(d.totalSize):''}</span>
          ${pct > 0 ? `<span>${pct}%</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  fdmPort = await getPort();

  // Restore intercept toggle state
  chrome.storage.sync.get({ interceptEnabled: true }, ({ interceptEnabled }) => {
    document.getElementById('intercept-toggle').checked = interceptEnabled;
  });

  document.getElementById('intercept-toggle').addEventListener('change', (e) => {
    chrome.storage.sync.set({ interceptEnabled: e.target.checked });
  });

  // Check FDM connection
  fdmOnline = await ping();
  const dot = document.getElementById('status-dot');
  const msg = document.getElementById('status-msg');
  if (fdmOnline) {
    dot.classList.add('online');
    msg.textContent = 'Connected to Free Download Manager';
    const status = await getStatus();
    renderDownloads(status);
  } else {
    dot.classList.remove('online');
    msg.textContent = '⚠ FDM is not running. Please start it.';
  }

  // Download button
  document.getElementById('btn-download').addEventListener('click', async () => {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return;
    const btn = document.getElementById('btn-download');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    chrome.runtime.sendMessage({ type: 'addDownload', url, referer: '', userAgent: navigator.userAgent }, (r) => {
      if (r && r.ok) {
        btn.textContent = '✔ Sent to FDM';
        btn.style.background = '#34a853';
        document.getElementById('url-input').value = '';
        setTimeout(() => { btn.textContent = 'Download with FDM'; btn.style.background = ''; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = '✕ FDM not reachable';
        btn.style.background = '#d93025';
        setTimeout(() => { btn.textContent = 'Download with FDM'; btn.style.background = ''; btn.disabled = false; }, 2500);
      }
    });
  });

  // Open FDM app (just focuses existing window via native messaging)
  document.getElementById('btn-open-app').addEventListener('click', () => {
    fetch(`http://127.0.0.1:${fdmPort}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'showWindow' }),
    }).catch(() => {});
    window.close();
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Pre-fill URL from current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.startsWith('http')) {
      // Only pre-fill if it looks like a downloadable URL
      const url = tabs[0].url;
      if (/\.(exe|msi|zip|rar|7z|mp4|mkv|mp3|pdf|apk|iso)(\?|$)/i.test(url)) {
        document.getElementById('url-input').value = url;
      }
    }
  });
});
