'use strict';
/* ── Renderer main process ────────────────────────────────────────────────── */

const { formatBytes, formatSpeed, formatETA } = (() => {
  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  }
  function formatSpeed(bps) { return formatBytes(bps) + '/s'; }
  function formatETA(s) {
    if (!s || !isFinite(s) || s <= 0) return '--';
    if (s < 60) return Math.round(s) + 's';
    if (s < 3600) return Math.floor(s/60) + 'm ' + Math.round(s%60) + 's';
    return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
  }
  return { formatBytes, formatSpeed, formatETA };
})();

const fileIcons = {
  mp4:'🎬', mkv:'🎬', avi:'🎬', mov:'🎬', wmv:'🎬', flv:'🎬', webm:'🎬',
  mp3:'🎵', flac:'🎵', aac:'🎵', ogg:'🎵', wav:'🎵', wma:'🎵',
  pdf:'📄', doc:'📄', docx:'📄', xls:'📊', xlsx:'📊', ppt:'📊', pptx:'📊', txt:'📄',
  zip:'🗜', rar:'🗜', '7z':'🗜', tar:'🗜', gz:'🗜',
  exe:'💾', msi:'💾', dmg:'💾', apk:'💾',
  jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', bmp:'🖼', svg:'🖼', webp:'🖼',
};
function iconFor(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return fileIcons[ext] || '📦';
}

// ── State ─────────────────────────────────────────────────────────────────────
let downloads = [];
let selectedId = null;
let activeCategory = 'All';
let ctxTargetId = null;
let settings = {};

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  settings = await window.fdm.getSettings();
  applyTheme(settings.theme || 'light');
  downloads = await window.fdm.getDownloads();
  renderAll();

  // Events from main process
  window.fdm.on('download-added',          d => { upsert(d); renderAll(); });
  window.fdm.on('download-progress',       d => { upsert(d); renderAll(); });
  window.fdm.on('download-status-changed', d => { upsert(d); renderAll(); });
  window.fdm.on('download-complete',       d => { upsert(d); renderAll(); });
  window.fdm.on('download-error',          d => { upsert(d); renderAll(); });
  window.fdm.on('download-removed',        d => { downloads = downloads.filter(x => x.id !== d.id); renderAll(); });
  window.fdm.on('settings-changed',        s => { settings = s; applyTheme(s.theme); });

  // Toolbar
  document.getElementById('btn-add').addEventListener('click', () => window.fdm.showAddDialog({}));
  document.getElementById('btn-pause-all').addEventListener('click',  () => window.fdm.pauseAll());
  document.getElementById('btn-resume-all').addEventListener('click', () => window.fdm.resumeAll());
  document.getElementById('btn-settings').addEventListener('click',   () => openSettings());

  // Sidebar categories
  document.querySelectorAll('.cat-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.cat-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      activeCategory = el.dataset.cat;
      renderList();
    });
  });

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('ctx-menu');
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  // Context menu actions
  document.getElementById('ctx-menu').addEventListener('click', async (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item || !ctxTargetId) return;
    document.getElementById('ctx-menu').hidden = true;
    const action = item.dataset.action;
    const dl = downloads.find(d => d.id === ctxTargetId);
    if (!dl) return;
    switch (action) {
      case 'open':      if (dl.savePath) window.fdm.openFile(dl.savePath); break;
      case 'folder':    window.fdm.openFolder(dl.savePath || dl.saveFolder); break;
      case 'pause':     window.fdm.pauseDownload(dl.id); break;
      case 'resume':    window.fdm.resumeDownload(dl.id); break;
      case 'copy-url':  navigator.clipboard.writeText(dl.url); break;
      case 'remove':    window.fdm.removeDownload(dl.id, false); break;
      case 'remove-del': window.fdm.removeDownload(dl.id, true); break;
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      window.fdm.showAddDialog({});
    }
    if (e.key === 'Delete' && selectedId) {
      window.fdm.removeDownload(selectedId, false);
    }
    if (e.key === 'Escape') {
      document.getElementById('ctx-menu').hidden = true;
      document.getElementById('settings-overlay').hidden = true;
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function upsert(d) {
  const idx = downloads.findIndex(x => x.id === d.id);
  if (idx === -1) downloads.push(d); else downloads[idx] = { ...downloads[idx], ...d };
}

function filteredDownloads() {
  switch (activeCategory) {
    case 'All':         return downloads;
    case 'Downloading': return downloads.filter(d => d.status === 'downloading' || d.status === 'merging');
    case 'Completed':   return downloads.filter(d => d.status === 'complete');
    case 'Paused':      return downloads.filter(d => d.status === 'paused' || d.status === 'queued');
    default:            return downloads.filter(d => d.category === activeCategory);
  }
}

function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  updateBadges();
  renderList();
  renderStatusSummary();
}

function updateBadges() {
  const counts = { All: downloads.length };
  downloads.forEach(d => {
    counts[d.category] = (counts[d.category] || 0) + 1;
  });
  counts['Downloading'] = downloads.filter(d => d.status === 'downloading' || d.status === 'merging').length;
  counts['Completed']   = downloads.filter(d => d.status === 'complete').length;
  counts['Paused']      = downloads.filter(d => d.status === 'paused' || d.status === 'queued').length;
  document.querySelectorAll('.cat-badge').forEach(el => {
    const cat = el.id.replace('badge-', '');
    const n = counts[cat] || 0;
    el.textContent = n > 0 ? n : '';
    el.hidden = n === 0;
  });
}

function renderStatusSummary() {
  const active = downloads.filter(d => d.status === 'downloading');
  const totalSpeed = active.reduce((s, d) => s + (d.speed || 0), 0);
  const sumEl = document.getElementById('status-bar-summary');
  if (active.length > 0) {
    sumEl.textContent = `${active.length} active · ${formatSpeed(totalSpeed)}`;
  } else {
    sumEl.textContent = `${downloads.length} downloads`;
  }
}

function renderList() {
  const list = document.getElementById('download-list');
  const empty = document.getElementById('empty-state');
  const filtered = filteredDownloads();
  // Sort: downloading first, then queued, then paused, then complete, then error
  const order = { downloading:0, merging:1, queued:2, paused:3, complete:4, error:5, scheduled:6 };
  const sorted = [...filtered].sort((a, b) => (order[a.status]||99) - (order[b.status]||99) || b.addedAt - a.addedAt);

  if (sorted.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // Diff-update
  const existingIds = new Set([...list.querySelectorAll('.dl-card')].map(el => el.dataset.id));
  const newIds = new Set(sorted.map(d => d.id));

  // Remove stale
  list.querySelectorAll('.dl-card').forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  sorted.forEach((dl, idx) => {
    let card = list.querySelector(`.dl-card[data-id="${dl.id}"]`);
    if (!card) {
      card = buildCard(dl);
      list.appendChild(card);
    } else {
      updateCard(card, dl);
    }
    // Reorder
    if (list.children[idx] !== card) list.insertBefore(card, list.children[idx] || null);
  });
}

function buildCard(dl) {
  const card = document.createElement('div');
  card.className = 'dl-card';
  card.dataset.id = dl.id;
  card.setAttribute('role', 'listitem');
  card.innerHTML = cardHTML(dl);
  wireCard(card, dl);
  return card;
}

function updateCard(card, dl) {
  card.innerHTML = cardHTML(dl);
  wireCard(card, dl);
  if (selectedId === dl.id) card.classList.add('selected');
}

function cardHTML(dl) {
  const pct   = dl.totalSize > 0 ? (dl.downloadedSize / dl.totalSize * 100).toFixed(1) : 0;
  const icon  = iconFor(dl.filename);
  const badge = statusBadge(dl.status);
  const barCls = dl.status === 'complete' ? 'complete' : dl.status === 'error' ? 'error' : dl.status === 'paused' ? 'paused' : '';
  const sizeStr = dl.totalSize > 0
    ? `${formatBytes(dl.downloadedSize)} / ${formatBytes(dl.totalSize)}`
    : formatBytes(dl.downloadedSize);

  const pauseBtn  = (dl.status === 'downloading' || dl.status === 'queued')
    ? `<button class="dl-action-btn" data-action="pause" title="Pause">⏸</button>` : '';
  const resumeBtn = (dl.status === 'paused' || dl.status === 'error')
    ? `<button class="dl-action-btn" data-action="resume" title="Resume">▶</button>` : '';
  const openBtn   = dl.status === 'complete' && dl.savePath
    ? `<button class="dl-action-btn" data-action="open" title="Open file">📂</button>` : '';
  const removeBtn = `<button class="dl-action-btn danger" data-action="remove" title="Remove">✕</button>`;

  const speedStr = dl.status === 'downloading' && dl.speed > 0 ? formatSpeed(dl.speed) : '';
  const etaStr   = dl.status === 'downloading' && dl.eta    > 0 ? formatETA(dl.eta) : '';

  const segDots  = (dl.segments && dl.segments.length > 1)
    ? `<div class="dl-segments">${dl.segments.map(s => `<span class="seg-dot ${s.done ? 'done' : s.downloaded > 0 ? 'active' : ''}"></span>`).join('')}</div>`
    : '';

  return `
    <div class="dl-top">
      <div class="dl-icon">${icon}</div>
      <div class="dl-info">
        <div class="dl-filename" title="${esc(dl.filename)}">${esc(dl.filename || 'Fetching info…')}</div>
        <div class="dl-url" title="${esc(dl.url)}">${esc(dl.url)}</div>
      </div>
      <div class="dl-actions">${pauseBtn}${resumeBtn}${openBtn}${removeBtn}</div>
    </div>
    <div class="dl-progress-row">
      <div class="dl-progress-bar-wrap" title="${pct}%">
        <div class="dl-progress-bar ${barCls}" style="width:${dl.status==='complete'?100:pct}%"></div>
      </div>
      <span class="dl-status-badge badge-${dl.status}">${dl.status}</span>
    </div>
    ${segDots}
    <div class="dl-meta">
      <span title="Size">${sizeStr}</span>
      ${pct > 0 && dl.status !== 'complete' ? `<span>${pct}%</span>` : ''}
      ${speedStr ? `<span title="Speed">${speedStr}</span>` : ''}
      ${etaStr   ? `<span title="ETA">ETA: ${etaStr}</span>` : ''}
      ${dl.numConnections > 1 && dl.status === 'downloading' ? `<span>${dl.numConnections} threads</span>` : ''}
      ${dl.error ? `<span style="color:var(--danger)" title="${esc(dl.error)}">${esc(dl.error.slice(0,60))}</span>` : ''}
    </div>
  `;
}

function wireCard(card, dl) {
  // Select
  card.addEventListener('click', (e) => {
    if (e.target.closest('.dl-action-btn')) return;
    selectedId = dl.id;
    document.querySelectorAll('.dl-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  });

  // Double click → open
  card.addEventListener('dblclick', () => {
    if (dl.status === 'complete' && dl.savePath) window.fdm.openFile(dl.savePath);
  });

  // Action buttons
  card.querySelectorAll('.dl-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switch (btn.dataset.action) {
        case 'pause':   window.fdm.pauseDownload(dl.id);  break;
        case 'resume':  window.fdm.resumeDownload(dl.id); break;
        case 'open':    window.fdm.openFile(dl.savePath); break;
        case 'remove':  window.fdm.removeDownload(dl.id, false); break;
      }
    });
  });

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctxTargetId = dl.id;
    const menu = document.getElementById('ctx-menu');
    menu.hidden = false;
    menu.style.left = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 4) + 'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4) + 'px';
    // Update visibility of actions
    menu.querySelector('[data-action="pause"]').style.display   = (dl.status === 'downloading' || dl.status === 'queued') ? '' : 'none';
    menu.querySelector('[data-action="resume"]').style.display  = (dl.status === 'paused' || dl.status === 'error') ? '' : 'none';
    menu.querySelector('[data-action="open"]').style.display    = (dl.status === 'complete') ? '' : 'none';
  });
}

function statusBadge(s) {
  const map = { downloading:'⬇', complete:'✔', paused:'⏸', error:'✕', queued:'…', merging:'🔀', scheduled:'📅' };
  return map[s] || s;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Settings dialog ───────────────────────────────────────────────────────────
async function openSettings() {
  settings = await window.fdm.getSettings();
  const port = await window.fdm.getNMPort();
  document.getElementById('s-save-folder').value   = settings.defaultSaveFolder || '';
  document.getElementById('s-max-conn').value       = settings.maxConnections    || 8;
  document.getElementById('s-max-sim').value        = settings.maxSimultaneous   || 3;
  document.getElementById('s-ask-where').checked    = !!settings.askWhereToSave;
  document.getElementById('s-speed-en').checked     = !!settings.speedLimitEnabled;
  document.getElementById('s-speed-val').value      = settings.speedLimitKBps    || 0;
  document.getElementById('s-sched-en').checked     = !!(settings.scheduler && settings.scheduler.enabled);
  document.getElementById('s-sched-start').value    = (settings.scheduler && settings.scheduler.startTime) || '08:00';
  document.getElementById('s-sched-stop').value     = (settings.scheduler && settings.scheduler.stopTime)  || '23:00';
  document.getElementById('s-tray').checked         = !!settings.minimizeToTray;
  document.getElementById('s-theme').value          = settings.theme || 'light';
  document.getElementById('nm-port-display').textContent = port;
  document.getElementById('settings-overlay').hidden = false;
}

document.getElementById && document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settings-close').addEventListener('click',  () => { document.getElementById('settings-overlay').hidden = true; });
  document.getElementById('settings-cancel').addEventListener('click', () => { document.getElementById('settings-overlay').hidden = true; });

  document.getElementById('s-browse').addEventListener('click', async () => {
    const folder = await window.fdm.chooseFolder();
    if (folder) document.getElementById('s-save-folder').value = folder;
  });

  document.getElementById('settings-save').addEventListener('click', async () => {
    const newSettings = {
      defaultSaveFolder: document.getElementById('s-save-folder').value,
      maxConnections:    parseInt(document.getElementById('s-max-conn').value) || 8,
      maxSimultaneous:   parseInt(document.getElementById('s-max-sim').value) || 3,
      askWhereToSave:    document.getElementById('s-ask-where').checked,
      speedLimitEnabled: document.getElementById('s-speed-en').checked,
      speedLimitKBps:    parseInt(document.getElementById('s-speed-val').value) || 0,
      minimizeToTray:    document.getElementById('s-tray').checked,
      theme:             document.getElementById('s-theme').value,
      scheduler: {
        enabled:   document.getElementById('s-sched-en').checked,
        startTime: document.getElementById('s-sched-start').value,
        stopTime:  document.getElementById('s-sched-stop').value,
        daysOfWeek: [0,1,2,3,4,5,6],
        action: 'start',
      },
    };
    settings = await window.fdm.saveSettings(newSettings);
    applyTheme(settings.theme);
    document.getElementById('settings-overlay').hidden = true;
  });
});
