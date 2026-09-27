// background.js — service worker for Free Download Manager Chrome extension
// Manifest V3 service worker

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_PORT = 43218;
const FDM_APP_ID   = 'com.freedownloadmanager.app'; // native messaging host name (not used in MV3 direct socket)
let fdmPort = DEFAULT_PORT;

// Extensions + MIME types to intercept automatically
const INTERCEPT_EXTENSIONS = new Set([
  'exe','msi','dmg','pkg','deb','rpm','apk',
  'zip','rar','7z','tar','gz','bz2','xz',
  'mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpeg','mpg',
  'mp3','flac','aac','ogg','wav','wma','m4a',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'iso','img',
]);

const INTERCEPT_MIME = new Set([
  'application/zip','application/x-zip-compressed',
  'application/x-rar-compressed','application/x-7z-compressed',
  'application/octet-stream',
  'application/x-msdownload','application/vnd.ms-windows-store',
  'video/mp4','video/x-matroska','video/quicktime','video/x-msvideo',
  'audio/mpeg','audio/flac','audio/ogg',
  'application/pdf',
  'application/x-iso9660-image',
]);

// ── Storage ───────────────────────────────────────────────────────────────────
chrome.storage.sync.get({ fdmPort: DEFAULT_PORT, interceptEnabled: true }, (data) => {
  fdmPort = data.fdmPort || DEFAULT_PORT;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.fdmPort) fdmPort = changes.fdmPort.newValue;
});

// ── Download Interception ─────────────────────────────────────────────────────
chrome.downloads.onCreated.addListener(async (item) => {
  const { interceptEnabled } = await chrome.storage.sync.get({ interceptEnabled: true });
  if (!interceptEnabled) return;
  if (!shouldIntercept(item)) return;

  // Cancel the browser's own download immediately
  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({ id: item.id });
  });

  // Forward to FDM desktop app
  sendToFDM({
    type: 'addDownload',
    url: item.url,
    filename: item.filename ? item.filename.split(/[/\\]/).pop() : '',
    referer: item.referrer || '',
    userAgent: navigator.userAgent,
  });

  // Show notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Free Download Manager',
    message: `Sending to FDM: ${(item.filename || item.url).split(/[/\\]/).pop().slice(0, 60)}`,
  });
});

function shouldIntercept(item) {
  // Check file extension from URL
  try {
    const u = new URL(item.url);
    const parts = u.pathname.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase().split('?')[0] : '';
    if (INTERCEPT_EXTENSIONS.has(ext)) return true;
  } catch (_) {}

  // Check mime type
  if (item.mime && INTERCEPT_MIME.has(item.mime.split(';')[0].trim().toLowerCase())) return true;

  // Check filename extension
  if (item.filename) {
    const parts = item.filename.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    if (INTERCEPT_EXTENSIONS.has(ext)) return true;
  }

  return false;
}

// ── FDM Communication ─────────────────────────────────────────────────────────
async function sendToFDM(msg) {
  try {
    // We communicate via a local HTTP/socket server that the Electron app runs
    const resp = await fetch(`http://127.0.0.1:${fdmPort}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'chrome-extension://' + chrome.runtime.id },
      body: JSON.stringify(msg),
    });
    return await resp.json();
  } catch (err) {
    console.error('[FDM Extension] Could not reach FDM desktop app:', err.message);
    // FDM not running — open fallback notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Free Download Manager — Not Running',
      message: 'Please start the Free Download Manager application.',
    });
    return null;
  }
}

// ── Context Menu ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'fdm-download-link',
    title: 'Download with Free Download Manager',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: 'fdm-download-video',
    title: 'Download video with Free Download Manager',
    contexts: ['video', 'audio'],
  });
  chrome.contextMenus.create({
    id: 'fdm-download-image',
    title: 'Download image with Free Download Manager',
    contexts: ['image'],
  });
  chrome.contextMenus.create({
    id: 'fdm-sep',
    type: 'separator',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: 'fdm-download-all-links',
    title: 'Download all links on page with FDM',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'fdm-download-link':
      sendToFDM({ type: 'addDownload', url: info.linkUrl, referer: info.pageUrl, userAgent: navigator.userAgent });
      break;
    case 'fdm-download-video':
      sendToFDM({ type: 'addDownload', url: info.srcUrl, referer: info.pageUrl, userAgent: navigator.userAgent });
      break;
    case 'fdm-download-image':
      sendToFDM({ type: 'addDownload', url: info.srcUrl, referer: info.pageUrl, userAgent: navigator.userAgent });
      break;
    case 'fdm-download-all-links':
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectLinks,
      }, (results) => {
        if (results && results[0] && results[0].result) {
          results[0].result.forEach(url => {
            sendToFDM({ type: 'addDownload', url, referer: info.pageUrl, userAgent: navigator.userAgent });
          });
        }
      });
      break;
  }
});

function collectLinks() {
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.href)
    .filter(h => h && h.startsWith('http'));
  return [...new Set(links)];
}

// ── Message from popup / content script ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'addDownload') {
    sendToFDM(msg).then(r => sendResponse({ ok: true, result: r })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg.type === 'getStatus') {
    sendToFDM({ type: 'getStatus' }).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === 'getPort') {
    sendResponse({ port: fdmPort });
    return false;
  }
});
