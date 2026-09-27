'use strict';
// options.js

const ALL_EXTS = [
  'exe','msi','dmg','pkg','deb','rpm','apk',
  'zip','rar','7z','tar','gz','bz2','xz',
  'mp4','mkv','avi','mov','wmv','flv','webm',
  'mp3','flac','aac','ogg','wav','wma',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'iso','img',
];

const DEFAULT_EXTS = new Set([
  'exe','msi','dmg','pkg','apk',
  'zip','rar','7z','tar','gz',
  'mp4','mkv','avi','mov',
  'mp3','flac',
  'pdf','iso',
]);

document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get({
    fdmPort: 43218,
    interceptedExts: [...DEFAULT_EXTS],
    interceptAll: false,
    showNotif: true,
  }, (data) => {
    document.getElementById('fdm-port').value  = data.fdmPort;
    document.getElementById('intercept-all').checked = data.interceptAll;
    document.getElementById('show-notif').checked     = data.showNotif;

    const enabledExts = new Set(data.interceptedExts);
    const grid = document.getElementById('ext-grid');
    ALL_EXTS.forEach(ext => {
      const chip = document.createElement('span');
      chip.className = 'ext-chip' + (enabledExts.has(ext) ? ' on' : '');
      chip.textContent = '.' + ext;
      chip.dataset.ext = ext;
      chip.addEventListener('click', () => chip.classList.toggle('on'));
      grid.appendChild(chip);
    });
  });

  document.getElementById('save-btn').addEventListener('click', () => {
    const interceptedExts = [...document.querySelectorAll('.ext-chip.on')].map(c => c.dataset.ext);
    chrome.storage.sync.set({
      fdmPort:         parseInt(document.getElementById('fdm-port').value) || 43218,
      interceptedExts,
      interceptAll:    document.getElementById('intercept-all').checked,
      showNotif:       document.getElementById('show-notif').checked,
    }, () => {
      const saved = document.getElementById('saved');
      saved.classList.add('show');
      setTimeout(() => saved.classList.remove('show'), 2000);
    });
  });
});
