// Thin WebSocket client: connects to the room server, sends JSON intents and
// dispatches incoming messages to per-type listeners. Shared across scenes via
// the Phaser game registry.
export default class Client {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.queue = [];
    this.connected = false;
  }

  url() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(this.url());
    this.ws.onopen = () => {
      this.connected = true;
      this.queue.forEach((m) => this.ws.send(m));
      this.queue = [];
      this.emit('open', {});
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.emit('close', {});
    };
    this.ws.onmessage = (event) => {
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
