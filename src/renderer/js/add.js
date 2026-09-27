'use strict';
/* Add-download window script */

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await window.fdm.getSettings();
  document.getElementById('add-folder').value = settings.defaultSaveFolder || '';
  document.getElementById('add-conns').value  = settings.maxConnections    || 8;

  // Pre-fill from extension or showAddDialog opts
  window.fdm.on('prefill-url', (opts) => {
    if (opts.url)      document.getElementById('add-url').value      = opts.url;
    if (opts.filename) document.getElementById('add-filename').value = opts.filename;
    document.getElementById('add-url').select();
  });

  document.getElementById('add-browse').addEventListener('click', async () => {
    const folder = await window.fdm.chooseFolder();
    if (folder) document.getElementById('add-folder').value = folder;
  });

  document.getElementById('btn-cancel-add').addEventListener('click', () => window.close());

  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('add-url').value.trim();
    const errEl = document.getElementById('add-error');
    errEl.hidden = true;
    if (!url) {
      errEl.textContent = 'Please enter a URL.';
      errEl.hidden = false;
      return;
    }
    try { new URL(url); } catch {
      errEl.textContent = 'Invalid URL.';
      errEl.hidden = false;
      return;
    }
    const opts = {
      url,
      filename:    document.getElementById('add-filename').value.trim() || '',
      saveFolder:  document.getElementById('add-folder').value.trim()   || '',
      connections: parseInt(document.getElementById('add-conns').value) || 8,
    };
    try {
      await window.fdm.addDownload(opts);
      window.close();
    } catch (err) {
      errEl.textContent = 'Error: ' + err.message;
      errEl.hidden = false;
    }
  });
});
