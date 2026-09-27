'use strict';
/**
 * DownloadManager — orchestrates tasks, queue, scheduler, persistence.
 */

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { DownloadTask } = require('./download-engine');
const { DOWNLOAD_STATUS, DEFAULT_SETTINGS } = require('../shared/constants');
const { getCategoryForUrl, generateId } = require('../shared/utils');

class DownloadManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.settings = this._loadSettings();
    this.tasks = new Map();   // id → DownloadTask
    this._active = new Set(); // ids currently downloading
    this._schedulerTimer = null;
    this._loadPersistedDownloads();
    this._startScheduler();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  _loadSettings() {
    const saved = this.store.get('settings', {});
    const s = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!s.defaultSaveFolder) {
      const home = require('os').homedir();
      s.defaultSaveFolder = path.join(home, 'Downloads');
    }
    // Ensure folder exists
    fs.mkdirSync(s.defaultSaveFolder, { recursive: true });
    return s;
  }

  saveSettings(newSettings) {
    this.settings = Object.assign({}, this.settings, newSettings);
    this.store.set('settings', this.settings);
    this.emit('settings-changed', this.settings);
    // Re-apply speed limit to active tasks
    for (const task of this.tasks.values()) {
      task.speedLimit = this.settings.speedLimitEnabled ? this.settings.speedLimitKBps * 1024 : 0;
    }
    this._startScheduler();
  }

  getSettings() { return this.settings; }

  // ── Persistence ───────────────────────────────────────────────────────────

  _loadPersistedDownloads() {
    const list = this.store.get('downloads', []);
    for (const data of list) {
      const task = this._makeTask(data);
      // Don't auto-resume downloading tasks (they become paused after crash)
      if (task.status === DOWNLOAD_STATUS.DOWNLOADING) {
        task.status = DOWNLOAD_STATUS.PAUSED;
      }
      this.tasks.set(task.id, task);
    }
  }

  _persist() {
    const list = Array.from(this.tasks.values()).map(t => t.getProgress());
    this.store.set('downloads', list);
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  _canStartNew() {
    return this._active.size < this.settings.maxSimultaneous;
  }

  _processQueue() {
    if (!this._canStartNew()) return;
    for (const task of this.tasks.values()) {
      if (!this._canStartNew()) break;
      if (task.status === DOWNLOAD_STATUS.QUEUED) {
        this._startTask(task);
      }
    }
  }

  _startTask(task) {
    this._active.add(task.id);
    task.start().then(() => {
      this._active.delete(task.id);
      this._persist();
      this._processQueue();
    }).catch(() => {
      this._active.delete(task.id);
      this._persist();
      this._processQueue();
    });
    task.on('progress', (info) => {
      this.emit('download-progress', info);
      this._persist();
    });
    task.on('complete', (t) => {
      this.emit('download-complete', t.getProgress());
    });
    task.on('error', (err, t) => {
      this.emit('download-error', { id: t.id, message: err.message });
    });
    task.on('merging', (t) => {
      this.emit('download-progress', { ...t.getProgress(), status: DOWNLOAD_STATUS.MERGING });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  addDownload(opts) {
    const id = generateId();
    const category = opts.category || getCategoryForUrl(opts.url, this.settings.categories);
    const saveFolder = opts.saveFolder || this._folderForCategory(category);
    fs.mkdirSync(saveFolder, { recursive: true });

    const task = this._makeTask({
      id, ...opts, category, saveFolder,
      status: DOWNLOAD_STATUS.QUEUED,
      addedAt: Date.now(),
    });
    this.tasks.set(id, task);
    this.emit('download-added', task.getProgress());
    this._persist();
    this._processQueue();
    return id;
  }

  _makeTask(data) {
    const task = new DownloadTask(data, this.settings);
    return task;
  }

  pauseDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === DOWNLOAD_STATUS.DOWNLOADING) {
      task.pause();
      this._active.delete(id);
      this._persist();
      this._processQueue();
    } else if (task.status === DOWNLOAD_STATUS.QUEUED) {
      task.status = DOWNLOAD_STATUS.PAUSED;
      this._persist();
    }
    this.emit('download-status-changed', task.getProgress());
  }

  resumeDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === DOWNLOAD_STATUS.PAUSED || task.status === DOWNLOAD_STATUS.ERROR) {
      task.status = DOWNLOAD_STATUS.QUEUED;
      this._persist();
      this._processQueue();
      this.emit('download-status-changed', task.getProgress());
    }
  }

  removeDownload(id, deleteFile = false) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.abort();
    if (deleteFile && task.savePath && fs.existsSync(task.savePath)) {
      try { fs.unlinkSync(task.savePath); } catch (_) {}
    }
    this.tasks.delete(id);
    this._active.delete(id);
    this._persist();
    this.emit('download-removed', { id });
    this._processQueue();
  }

  getDownloads() {
    return Array.from(this.tasks.values()).map(t => t.getProgress());
  }

  pauseAll() {
    for (const task of this.tasks.values()) {
      if (task.status === DOWNLOAD_STATUS.DOWNLOADING || task.status === DOWNLOAD_STATUS.QUEUED) {
        this.pauseDownload(task.id);
      }
    }
  }

  resumeAll() {
    for (const task of this.tasks.values()) {
      if (task.status === DOWNLOAD_STATUS.PAUSED) {
        this.resumeDownload(task.id);
      }
    }
  }

  _folderForCategory(category) {
    const cat = this.settings.categories[category];
    if (!cat) return this.settings.defaultSaveFolder;
    if (path.isAbsolute(cat.folder)) return cat.folder;
    return path.join(require('os').homedir(), cat.folder);
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  _startScheduler() {
    if (this._schedulerTimer) clearInterval(this._schedulerTimer);
    if (!this.settings.scheduler || !this.settings.scheduler.enabled) return;
    this._schedulerTimer = setInterval(() => this._checkSchedule(), 60 * 1000);
    this._checkSchedule();
  }

  _checkSchedule() {
    const { scheduler } = this.settings;
    if (!scheduler || !scheduler.enabled) return;
    const now = new Date();
    const day = now.getDay();
    if (!scheduler.daysOfWeek.includes(day)) return;
    const [sh, sm] = scheduler.startTime.split(':').map(Number);
    const [eh, em] = scheduler.stopTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const inWindow = nowMins >= startMins && nowMins < endMins;
    if (inWindow) {
      this.resumeAll();
    } else {
      this.pauseAll();
    }
  }
}

module.exports = { DownloadManager };
