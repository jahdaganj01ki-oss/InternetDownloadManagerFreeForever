'use strict';
/**
 * DownloadEngine — core multi-segment download engine.
 *
 * Strategy:
 *  1. HEAD the URL to get Content-Length and Accept-Ranges.
 *  2. If server supports ranges AND file > threshold → split into N segments.
 *  3. Each segment streams into a temp file.
 *  4. On completion → merge all temp files → final file.
 *  5. Supports pause/resume (each segment saves its byte offset).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { generateId, getFilenameFromUrl } = require('../shared/utils');
const { DOWNLOAD_STATUS } = require('../shared/constants');

const SEGMENT_THRESHOLD = 1 * 1024 * 1024; // 1 MB min size before splitting
const MERGE_CHUNK = 256 * 1024;             // 256 KB read chunk during merge

class Segment {
  constructor(id, start, end) {
    this.id = id;
    this.start = start;        // byte offset start (inclusive)
    this.end = end;            // byte offset end (inclusive, -1 = unknown)
    this.downloaded = 0;
    this.done = false;
    this.req = null;
    this.writeStream = null;
    this.tmpFile = '';
  }
}

class DownloadTask extends EventEmitter {
  constructor(opts, settings) {
    super();
    this.id = opts.id || generateId();
    this.url = opts.url;
    this.originalUrl = opts.originalUrl || opts.url;
    this.referer = opts.referer || '';
    this.userAgent = opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    this.filename = opts.filename || '';
    this.saveFolder = opts.saveFolder || settings.defaultSaveFolder;
    this.savePath = '';           // final full path, set after HEAD
    this.tmpDir = '';             // folder for segment temp files
    this.totalSize = opts.totalSize || 0;
    this.downloadedSize = 0;
    this.status = opts.status || DOWNLOAD_STATUS.QUEUED;
    this.segments = [];
    this.numConnections = Math.min(opts.connections || settings.maxConnections, 16);
    this.supportsRange = false;
    this.category = opts.category || 'General';
    this.addedAt = opts.addedAt || Date.now();
    this.completedAt = opts.completedAt || null;
    this.error = null;
    this.speedLimit = settings.speedLimitEnabled ? settings.speedLimitKBps * 1024 : 0;
    this._speedSamples = [];
    this._lastProgressEmit = 0;
    this._aborted = false;
    this._pauseRequested = false;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async start() {
    this._aborted = false;
    this._pauseRequested = false;
    this.status = DOWNLOAD_STATUS.DOWNLOADING;
    try {
      await this._resolve();
      await this._downloadAllSegments();
      if (!this._aborted && !this._pauseRequested) {
        await this._merge();
        this.status = DOWNLOAD_STATUS.COMPLETE;
        this.completedAt = Date.now();
        this.emit('complete', this);
      }
    } catch (err) {
      if (!this._pauseRequested && !this._aborted) {
        this.status = DOWNLOAD_STATUS.ERROR;
        this.error = err.message;
        this.emit('error', err, this);
      }
    }
  }

  pause() {
    this._pauseRequested = true;
    this.status = DOWNLOAD_STATUS.PAUSED;
    this.segments.forEach(s => { if (s.req) { try { s.req.destroy(); } catch (_) {} } });
  }

  abort() {
    this._aborted = true;
    this._pauseRequested = false;
    this.segments.forEach(s => { if (s.req) { try { s.req.destroy(); } catch (_) {} } });
    this._cleanupTmp();
  }

  getProgress() {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      savePath: this.savePath,
      saveFolder: this.saveFolder,
      category: this.category,
      totalSize: this.totalSize,
      downloadedSize: this.downloadedSize,
      status: this.status,
      segments: this.segments.map(s => ({
        id: s.id, start: s.start, end: s.end, downloaded: s.downloaded, done: s.done
      })),
      numConnections: this.numConnections,
      supportsRange: this.supportsRange,
      addedAt: this.addedAt,
      completedAt: this.completedAt,
      error: this.error,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _resolve() {
    const info = await this._head(this.url);
    // Handle redirects stored in info.finalUrl
    if (info.finalUrl) this.url = info.finalUrl;
    this.totalSize = info.contentLength || 0;
    this.supportsRange = info.acceptRanges && this.totalSize > SEGMENT_THRESHOLD;
    if (!this.filename) {
      this.filename = getFilenameFromUrl(this.url, info.contentDisposition);
    }
    // Ensure unique filename
    this.savePath = this._uniquePath(path.join(this.saveFolder, this.filename));
    this.filename = path.basename(this.savePath);
    // Temp dir
    this.tmpDir = this.savePath + '.fdm_tmp';
    if (!fs.existsSync(this.tmpDir)) fs.mkdirSync(this.tmpDir, { recursive: true });
    // Create segments
    this._buildSegments();
  }

  _buildSegments() {
    if (!this.supportsRange || this.totalSize <= 0) {
      // Single segment
      const seg = new Segment(0, 0, -1);
      seg.tmpFile = path.join(this.tmpDir, 'seg_0.tmp');
      // Resume: check existing
      if (fs.existsSync(seg.tmpFile)) {
        seg.downloaded = fs.statSync(seg.tmpFile).size;
        seg.start = seg.downloaded;
        this.downloadedSize = seg.downloaded;
      }
      this.segments = [seg];
      return;
    }
    const n = this.numConnections;
    const chunkSize = Math.floor(this.totalSize / n);
    for (let i = 0; i < n; i++) {
      const start = i * chunkSize;
      const end = i === n - 1 ? this.totalSize - 1 : start + chunkSize - 1;
      const seg = new Segment(i, start, end);
      seg.tmpFile = path.join(this.tmpDir, `seg_${i}.tmp`);
      // Resume: restore progress
      if (fs.existsSync(seg.tmpFile)) {
        const written = fs.statSync(seg.tmpFile).size;
        if (written > 0) {
          seg.downloaded = written;
          const resumeStart = start + written;
          if (resumeStart > end) {
            seg.done = true;
          } else {
            seg.start = resumeStart;
          }
          this.downloadedSize += written;
        }
      }
      this.segments.push(seg);
    }
  }

  async _downloadAllSegments() {
    const pending = this.segments.filter(s => !s.done);
    // Run all segments in parallel
    await Promise.all(pending.map(seg => this._downloadSegment(seg)));
  }

  _downloadSegment(seg) {
    return new Promise((resolve, reject) => {
      if (this._aborted || this._pauseRequested) {
        return resolve();
      }
      const flags = seg.downloaded > 0 ? 'a' : 'w';
      seg.writeStream = fs.createWriteStream(seg.tmpFile, { flags });

      const headers = { 'User-Agent': this.userAgent };
      if (this.referer) headers['Referer'] = this.referer;
      const rangeStart = seg.start + seg.downloaded; // already adjusted for resume in _buildSegments, but seg.start may have been updated
      const actualStart = seg.start; // seg.start is already the resume position
      if (this.supportsRange && seg.end !== -1) {
        headers['Range'] = `bytes=${actualStart}-${seg.end}`;
      }

      const parsed = new URL(this.url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          seg.writeStream.close();
          this.url = new URL(res.headers.location, this.url).href;
          resolve(this._downloadSegment(seg));
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`HTTP ${res.statusCode} for segment ${seg.id}`));
          return;
        }
        res.on('data', (chunk) => {
          if (this._aborted || this._pauseRequested) {
            req.destroy();
            seg.writeStream.end();
            return resolve();
          }
          seg.writeStream.write(chunk);
          seg.downloaded += chunk.length;
          this.downloadedSize += chunk.length;
          this._emitProgress();
        });
        res.on('end', () => {
          seg.writeStream.end(() => {
            seg.done = true;
            resolve();
          });
        });
        res.on('error', reject);
      });
      req.on('error', (err) => {
        if (this._pauseRequested || this._aborted) return resolve();
        reject(err);
      });
      seg.req = req;
      req.end();
    });
  }

  _emitProgress() {
    const now = Date.now();
    if (now - this._lastProgressEmit < 400) return;
    this._lastProgressEmit = now;
    this._speedSamples.push({ t: now, b: this.downloadedSize });
    if (this._speedSamples.length > 8) this._speedSamples.shift();
    let speed = 0;
    if (this._speedSamples.length >= 2) {
      const oldest = this._speedSamples[0];
      const newest = this._speedSamples[this._speedSamples.length - 1];
      const dt = (newest.t - oldest.t) / 1000;
      if (dt > 0) speed = (newest.b - oldest.b) / dt;
    }
    const remaining = this.totalSize > 0 ? (this.totalSize - this.downloadedSize) / Math.max(speed, 1) : 0;
    this.emit('progress', {
      ...this.getProgress(),
      speed,
      eta: remaining,
      percent: this.totalSize > 0 ? (this.downloadedSize / this.totalSize) * 100 : 0,
    });
  }

  async _merge() {
    if (this.segments.length === 1) {
      // Just rename
      this.status = DOWNLOAD_STATUS.MERGING;
      this.emit('merging', this);
      fs.renameSync(this.segments[0].tmpFile, this.savePath);
    } else {
      this.status = DOWNLOAD_STATUS.MERGING;
      this.emit('merging', this);
      const out = fs.createWriteStream(this.savePath);
      for (const seg of this.segments) {
        await new Promise((resolve, reject) => {
          const inp = fs.createReadStream(seg.tmpFile, { highWaterMark: MERGE_CHUNK });
          inp.pipe(out, { end: false });
          inp.on('end', resolve);
          inp.on('error', reject);
        });
      }
      out.end();
      await new Promise(r => out.on('finish', r));
    }
    this._cleanupTmp();
  }

  _cleanupTmp() {
    try {
      if (this.tmpDir && fs.existsSync(this.tmpDir)) {
        fs.readdirSync(this.tmpDir).forEach(f => {
          try { fs.unlinkSync(path.join(this.tmpDir, f)); } catch (_) {}
        });
        fs.rmdirSync(this.tmpDir);
      }
    } catch (_) {}
  }

  _uniquePath(filePath) {
    if (!fs.existsSync(filePath)) return filePath;
    const ext = path.extname(filePath);
    const base = filePath.slice(0, filePath.length - ext.length);
    let i = 1;
    while (fs.existsSync(`${base} (${i})${ext}`)) i++;
    return `${base} (${i})${ext}`;
  }

  async _head(url, redirects = 0) {
    if (redirects > 10) throw new Error('Too many redirects');
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        headers: {
          'User-Agent': this.userAgent,
          ...(this.referer ? { 'Referer': this.referer } : {}),
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          resolve(this._head(next, redirects + 1));
          return;
        }
        resolve({
          contentLength: parseInt(res.headers['content-length'] || '0', 10),
          acceptRanges: (res.headers['accept-ranges'] || '') === 'bytes',
          contentDisposition: res.headers['content-disposition'] || '',
          contentType: res.headers['content-type'] || '',
          finalUrl: url,
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('HEAD timeout')); });
      req.end();
    });
  }
}

module.exports = { DownloadTask };
