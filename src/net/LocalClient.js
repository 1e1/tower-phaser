// Per-endpoint façade over a LocalServer, exposing the exact surface the scenes
// use on the real network Client (`on(type, cb) -> unsubscribe`, `send(type,
// payload)`, `connect()`), so ControllerScene/TvScene cannot tell they are
// driving an in-process LocalServer instead of a WebSocket. `endpoint` is the
// player slot (0/1) for a controller pad, or 'tv' for the battlefield renderer.
export default class LocalClient {
  constructor(server, endpoint) {
    this.server = server;
    this.endpoint = endpoint;
    this.connected = true;
  }

  on(type, cb) {
    return this.server.on(this.endpoint, type, cb);
  }

  send(type, payload = {}) {
    if (this.endpoint === 'tv') return; // the renderer is read-only
    this.server.handle(this.endpoint, type, payload);
  }

  // The scenes call connect() on boot; locally we are already "connected". Fire
  // the initial roster on the next microtask so listeners registered right after
  // construction still receive it.
  connect() {
    Promise.resolve().then(() => this.server.sendRoster());
  }

  close() {}
}
