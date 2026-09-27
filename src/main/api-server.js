'use strict';
/**
 * HTTP API Server — lets the Chrome extension communicate with FDM via fetch().
 * Listens on 127.0.0.1 only (loopback), so it's not exposed to the network.
 */

const http = require('http');
const { EventEmitter } = require('events');

class ApiServer extends EventEmitter {
  constructor(manager, port = 43218) {
    super();
    this.manager = manager;
    this.port = port;
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => {
      // CORS — only allow requests from Chrome extension origins
      const origin = req.headers['origin'] || '';
      if (origin.startsWith('chrome-extension://') || origin === '') {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
      }
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST' || req.url !== '/api') {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('end', () => {
        let msg;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const result = this._handle(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      this.emit('listening', this.port);
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        this.port++;
        if (this.port > 43300) {
          console.error('[FDM API] Could not find a free port');
          return;
        }
        setTimeout(() => this.start(), 100);
      }
    });
  }

  _handle(msg) {
    switch (msg.type) {
      case 'ping':
        return { type: 'pong', version: '1.0.0' };

      case 'addDownload': {
        if (!msg.url) return { type: 'error', message: 'url required' };
        const id = this.manager.addDownload({
          url:       msg.url,
          filename:  msg.filename  || '',
          referer:   msg.referer   || '',
          userAgent: msg.userAgent || '',
          saveFolder: '',
        });
        return { type: 'downloadAdded', id };
      }

      case 'getStatus': {
        const downloads = this.manager.getDownloads();
        return { type: 'status', downloads };
      }

      case 'showWindow':
        this.emit('show-window');
        return { type: 'ok' };

      case 'pauseDownload':
        if (msg.id) this.manager.pauseDownload(msg.id);
        return { type: 'ok' };

      case 'resumeDownload':
        if (msg.id) this.manager.resumeDownload(msg.id);
        return { type: 'ok' };

      default:
        return { type: 'error', message: 'Unknown type: ' + msg.type };
    }
  }

  stop() {
    if (this.server) this.server.close();
  }
}

module.exports = { ApiServer };
