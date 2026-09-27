'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fdm', {
  // Downloads
  getDownloads:   ()              => ipcRenderer.invoke('get-downloads'),
  addDownload:    (opts)          => ipcRenderer.invoke('add-download', opts),
  pauseDownload:  (id)            => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id)            => ipcRenderer.invoke('resume-download', id),
  removeDownload: (id, del)       => ipcRenderer.invoke('remove-download', id, del),
  openFile:       (p)             => ipcRenderer.invoke('open-file', p),
  openFolder:     (p)             => ipcRenderer.invoke('open-folder', p),
  pauseAll:       ()              => ipcRenderer.invoke('pause-all'),
  resumeAll:      ()              => ipcRenderer.invoke('resume-all'),
  showAddDialog:  (opts)          => ipcRenderer.invoke('show-add-dialog', opts),
  // Settings
  getSettings:    ()              => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s)             => ipcRenderer.invoke('save-settings', s),
  chooseFolder:   ()              => ipcRenderer.invoke('choose-folder'),
  getNMPort:      ()              => ipcRenderer.invoke('get-nm-port'),
  // Events
  on: (channel, cb) => {
    const allowed = [
      'download-added','download-progress','download-status-changed',
      'download-complete','download-error','downloads-list',
      'settings-changed','download-removed','prefill-url',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});
