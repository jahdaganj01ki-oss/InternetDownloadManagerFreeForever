'use strict';

const CATEGORIES = {
  General: { exts: [], folder: 'Downloads' },
  Documents: { exts: ['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','txt','rtf','csv'], folder: 'Downloads\\Documents' },
  Music: { exts: ['mp3','flac','aac','ogg','wav','wma','m4a'], folder: 'Downloads\\Music' },
  Videos: { exts: ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpeg','mpg'], folder: 'Downloads\\Videos' },
  Compressed: { exts: ['zip','rar','7z','tar','gz','bz2','xz'], folder: 'Downloads\\Compressed' },
  Programs: { exts: ['exe','msi','dmg','deb','rpm','pkg','apk'], folder: 'Downloads\\Programs' },
  Images: { exts: ['jpg','jpeg','png','gif','bmp','svg','webp','tiff','ico'], folder: 'Downloads\\Images' },
};

const DEFAULT_SETTINGS = {
  maxConnections: 8,         // max parallel connections per file
  maxSimultaneous: 3,        // max simultaneous downloads
  defaultSaveFolder: '',     // populated at runtime
  speedLimitEnabled: false,
  speedLimitKBps: 0,
  startOnBoot: false,
  minimizeToTray: true,
  askWhereToSave: true,
  categories: CATEGORIES,
  scheduler: {
    enabled: false,
    startTime: '08:00',
    stopTime: '23:00',
    daysOfWeek: [1,2,3,4,5,6,0],  // Mon-Sun
    action: 'start',               // start | stop | shutdown
  },
  proxy: {
    enabled: false,
    host: '',
    port: 8080,
    username: '',
    password: '',
  },
  nativeMessagingPort: 43218,
  theme: 'light',
};

const DOWNLOAD_STATUS = {
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETE: 'complete',
  ERROR: 'error',
  MERGING: 'merging',
  SCHEDULED: 'scheduled',
};

const IPC = {
  // Renderer -> Main
  ADD_DOWNLOAD: 'add-download',
  PAUSE_DOWNLOAD: 'pause-download',
  RESUME_DOWNLOAD: 'resume-download',
  REMOVE_DOWNLOAD: 'remove-download',
  OPEN_FILE: 'open-file',
  OPEN_FOLDER: 'open-folder',
  GET_DOWNLOADS: 'get-downloads',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  SHOW_ADD_DIALOG: 'show-add-dialog',
  // Main -> Renderer
  DOWNLOAD_ADDED: 'download-added',
  DOWNLOAD_PROGRESS: 'download-progress',
  DOWNLOAD_STATUS_CHANGED: 'download-status-changed',
  DOWNLOAD_COMPLETE: 'download-complete',
  DOWNLOAD_ERROR: 'download-error',
  DOWNLOADS_LIST: 'downloads-list',
  SETTINGS_CHANGED: 'settings-changed',
};

module.exports = { CATEGORIES, DEFAULT_SETTINGS, DOWNLOAD_STATUS, IPC };
