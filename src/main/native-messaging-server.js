'use strict';
/**
 * Native Messaging Host — bridges Chrome extension ↔ download manager.
 * Protocol: 4-byte little-endian length prefix + JSON body (Chrome NM spec).
 */

const net = require('net');
const { EventEmitter } = require('events');

class NativeMessagingServer extends EventEmitter {
  constructor(manager, port = 43218) {
    super();
    this.manager = manager;
    this.port = port;
    this.server = null;
  }

  start() {
    this.server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (data) => {
        buf = Buffer.concat([buf, data]);
        while (buf.length >= 4) {
          const msgLen = buf.readUInt32LE(0);
          if (buf.length < 4 + msgLen) break;
          const msgBuf = buf.slice(4, 4 + msgLen);
          buf = buf.slice(4 + msgLen);
          try {
            const msg = JSON.parse(msgBuf.toString('utf8'));
            this._handle(msg, socket);
          } catch (e) {
            this._send(socket, { type: 'error', message: 'Invalid JSON' });
          }
        }
      });
      socket.on('error', () => {});
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      this.emit('listening', this.port);
    });
    this.server.on('error', (err) => {
      // Try next port
      if (err.code === 'EADDRINUSE') {
        this.port++;
        setTimeout(() => this.start(), 200);
      }
    });
  }

  _handle(msg, socket) {
    switch (msg.type) {
      case 'ping':
        this._send(socket, { type: 'pong', version: '1.0.0' });
        break;
      case 'addDownload': {
        const id = this.manager.addDownload({
          url: msg.url,
          filename: msg.filename || '',
          referer: msg.referer || '',
          userAgent: msg.userAgent || '',
          saveFolder: '',
        });
        this._send(socket, { type: 'downloadAdded', id });
        break;
      }
      case 'getStatus': {
        const downloads = this.manager.getDownloads();
        this._send(socket, { type: 'status', downloads });
        break;
      }
      default:
        this._send(socket, { type: 'error', message: 'Unknown type: ' + msg.type });
    }
  }

  _send(socket, obj) {
    const json = JSON.stringify(obj);
    const buf = Buffer.from(json, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buf.length, 0);
    socket.write(Buffer.concat([header, buf]));
  }

  stop() {
    if (this.server) this.server.close();
  }
}

module.exports = { NativeMessagingServer };
