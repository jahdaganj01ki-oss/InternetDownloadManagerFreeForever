'use strict';
/**
 * Electron main process entry point.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');

// Import our modules
let Store;
try {
  Store = require('electron-store');
} catch {
  // Fallback simple store using JSON file
  const fs = require('fs');
  const storePath = path.join(app.getPath ? app.getPath('userData') : os.homedir(), 'fdm-store.json');
  Store = class SimpleStore {
    constructor() { try { this._data = JSON.parse(fs.readFileSync(storePath,'utf8')); } catch { this._data = {}; } }
    get(k, def) { return k in this._data ? this._data[k] : def; }
    set(k, v) { this._data[k] = v; fs.writeFileSync(storePath, JSON.stringify(this._data), 'utf8'); }
  };
}

const { DownloadManager } = require('./download-manager');
const { ApiServer } = require('./api-server');
const { IPC, DOWNLOAD_STATUS } = require('../shared/constants');
const { formatBytes, formatSpeed } = require('../shared/utils');

let mainWindow = null;
let addWindow = null;
let tray = null;
let manager = null;
let nmServer = null;
let store = null;
const isDev = process.argv.includes('--dev');

// ── App Init ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  store = new Store({ name: 'fdm-data' });
  manager = new DownloadManager(store);

  // Wire manager events → window
  manager.on('download-added',          d => sendToWindow(IPC.DOWNLOAD_ADDED, d));
  manager.on('download-progress',       d => sendToWindow(IPC.DOWNLOAD_PROGRESS, d));
  manager.on('download-status-changed', d => sendToWindow(IPC.DOWNLOAD_STATUS_CHANGED, d));
  manager.on('download-complete',       d => sendToWindow(IPC.DOWNLOAD_COMPLETE, d));
  manager.on('download-error',          d => sendToWindow(IPC.DOWNLOAD_ERROR, d));
  manager.on('settings-changed',        s => sendToWindow(IPC.SETTINGS_CHANGED, s));
  manager.on('download-removed',        d => sendToWindow('download-removed', d));

  // HTTP API server (for Chrome extension via fetch)
  nmServer = new ApiServer(manager, manager.settings.nativeMessagingPort);
  nmServer.start();
  nmServer.on('listening', (port) => {
    console.log(`[FDM] HTTP API server on port ${port}`);
    if (port !== manager.settings.nativeMessagingPort) {
      manager.saveSettings({ nativeMessagingPort: port });
    }
  });
  nmServer.on('show-window', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (manager && manager.settings.minimizeToTray) {
    // keep running in tray
  } else {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nmServer) nmServer.stop();
});

// ── Windows ───────────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 680,
    minWidth: 700, minHeight: 450,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    titleBarStyle: 'default',
    title: 'Free Download Manager',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.on('close', (e) => {
    if (manager && manager.settings.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createAddWindow(opts = {}) {
  if (addWindow) { addWindow.focus(); return; }
  addWindow = new BrowserWindow({
    width: 540, height: 340,
    resizable: false,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Add New Download',
    icon: path.join(__dirname, '../../assets/icon.png'),
  });
  addWindow.loadFile(path.join(__dirname, '../renderer/add.html'));
  addWindow.once('ready-to-show', () => {
    if (opts.url) {
      addWindow.webContents.send('prefill-url', opts);
    }
    addWindow.show();
  });
  addWindow.on('closed', () => { addWindow = null; });
  if (isDev) addWindow.webContents.openDevTools({ mode: 'detach' });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Free Download Manager');
  updateTrayMenu();
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Open Free Download Manager', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Add New Download', click: () => createAddWindow() },
    { type: 'separator' },
    { label: 'Pause All', click: () => manager.pauseAll() },
    { label: 'Resume All', click: () => manager.resumeAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  if (tray) tray.setContextMenu(menu);
}

function sendToWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_DOWNLOADS, () => manager.getDownloads());
ipcMain.handle(IPC.GET_SETTINGS,  () => manager.getSettings());

ipcMain.handle(IPC.SAVE_SETTINGS, (_e, settings) => {
  manager.saveSettings(settings);
  return manager.getSettings();
});

ipcMain.handle(IPC.ADD_DOWNLOAD, async (_e, opts) => {
  if (!opts.saveFolder) {
    const settings = manager.getSettings();
    if (settings.askWhereToSave) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose save folder',
        defaultPath: settings.defaultSaveFolder,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths.length) {
        opts.saveFolder = result.filePaths[0];
      } else {
        opts.saveFolder = settings.defaultSaveFolder;
      }
    }
  }
  return manager.addDownload(opts);
});

ipcMain.handle(IPC.PAUSE_DOWNLOAD,  (_e, id) => manager.pauseDownload(id));
ipcMain.handle(IPC.RESUME_DOWNLOAD, (_e, id) => manager.resumeDownload(id));
ipcMain.handle(IPC.REMOVE_DOWNLOAD, (_e, id, deleteFile) => manager.removeDownload(id, deleteFile));

ipcMain.handle(IPC.OPEN_FILE, (_e, filePath) => {
  shell.openPath(filePath);
});
ipcMain.handle(IPC.OPEN_FOLDER, (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle(IPC.SHOW_ADD_DIALOG, (_e, opts) => {
  createAddWindow(opts || {});
});

ipcMain.handle('choose-folder', async () => {
  const settings = manager.getSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Download Folder',
    defaultPath: settings.defaultSaveFolder,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!result.canceled && result.filePaths.length) return result.filePaths[0];
  return null;
});

ipcMain.handle('get-nm-port', () => manager.settings.nativeMessagingPort);

ipcMain.handle('pause-all',  () => manager.pauseAll());
ipcMain.handle('resume-all', () => manager.resumeAll());
