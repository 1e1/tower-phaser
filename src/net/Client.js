import { decodeSnapshot } from './snapshotCodec.js';

// Thin WebSocket client: connects to the room server, sends JSON intents and
// dispatches incoming messages to per-type listeners. Shared across scenes via
// the Phaser game registry. The per-tick `snapshot` frame arrives as a binary
// message (see snapshotCodec); everything else is JSON.
export default class Client {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.queue = [];
    this.connected = false;
    this.everConnected = false; // distinguishes the first open from a reconnect
    this.reconnectTimer = null;
  }

  url() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(this.url());
    this.ws.binaryType = 'arraybuffer'; // snapshot frames arrive as binary
    this.ws.onopen = () => {
      this.connected = true;
      const reconnected = this.everConnected;
      this.everConnected = true;
      this.queue.forEach((m) => this.ws.send(m));
      this.queue = [];
      // 'open' fires every time; 'reopen' only on a recovered connection, so a
      // scene can re-announce itself (e.g. a phone reclaiming its held seat).
      this.emit('open', { reconnected });
      if (reconnected) this.emit('reopen', {});
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.emit('close', {});
      // Keep trying to come back: a phone that locked/slept drops its socket but
      // the server holds its seat briefly. Idle lobby sockets recover too.
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1200);
      }
    };
    this.ws.onmessage = (event) => {
      // Binary frames are the compact per-tick snapshot; decode and dispatch as
      // a normal 'snapshot' message so scenes consume it unchanged.
      if (typeof event.data !== 'string') {
        let decoded;
        try {
          decoded = decodeSnapshot(event.data);
        } catch {
          return;
        }
        this.emit('snapshot', { t: 'snapshot', state: decoded.state, events: decoded.events });
        return;
      }
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.emit(msg.t, msg);
    };
  }

  send(type, payload = {}) {
    const data = JSON.stringify({ t: type, ...payload });
    if (this.connected) this.ws.send(data);
    else this.queue.push(data);
  }

  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
    return () => this.listeners.get(type).delete(cb);
  }

  emit(type, msg) {
    const set = this.listeners.get(type);
    if (set) set.forEach((cb) => cb(msg));
  }
}
