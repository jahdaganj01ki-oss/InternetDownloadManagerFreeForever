// content.js — injected into every page
// Watches for dynamic download links and video sources, adds "Download with FDM" buttons

'use strict';

(function () {
  if (window.__fdm_content_loaded) return;
  window.__fdm_content_loaded = true;

  const EXT_RE = /\.(exe|msi|zip|rar|7z|tar|gz|bz2|mp4|mkv|avi|mov|mp3|flac|aac|wav|pdf|dmg|apk|iso)(\?|$)/i;

  // ── Float button for video/audio elements ──────────────────────────────────
  function addFDMButton(el, url) {
    if (el.__fdm_btn) return;
    el.__fdm_btn = true;
    const btn = document.createElement('button');
    btn.textContent = '⬇ FDM';
    btn.title = 'Download with Free Download Manager';
    btn.style.cssText = `
      position:absolute; z-index:2147483647;
      background:#1a73e8; color:#fff; border:none; border-radius:4px;
      padding:4px 9px; font-size:11px; font-weight:700; cursor:pointer;
      font-family:sans-serif; box-shadow:0 2px 8px rgba(0,0,0,.3);
      pointer-events:all;
    `;
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'addDownload', url, referer: location.href });
      btn.textContent = '✔ Sent';
      btn.style.background = '#34a853';
      setTimeout(() => { btn.textContent = '⬇ FDM'; btn.style.background = '#1a73e8'; }, 2000);
    });

    // Position near element
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; display:inline-block; pointer-events:none;';

    const parent = el.parentNode;
    if (parent) {
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
    }
    wrap.appendChild(btn);
    btn.style.top = '8px';
    btn.style.right = '8px';
  }

  // ── Scan page links ────────────────────────────────────────────────────────
  function scanLinks() {
    document.querySelectorAll('a[href]').forEach(a => {
      if (!a.__fdm_scanned && EXT_RE.test(a.href)) {
        a.__fdm_scanned = true;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'addDownload', url: a.href, referer: location.href });
        });
        // Add small badge
        const badge = document.createElement('sup');
        badge.textContent = '[FDM]';
        badge.style.cssText = 'color:#1a73e8;font-size:9px;font-weight:700;margin-left:2px;';
        a.appendChild(badge);
      }
    });
  }

  // ── MutationObserver for dynamic content ──────────────────────────────────
  const observer = new MutationObserver(() => scanLinks());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  scanLinks();

  // ── Message from background / popup ───────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'collectLinks') {
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(h => EXT_RE.test(h));
      return [...new Set(links)];
    }
  });
})();
