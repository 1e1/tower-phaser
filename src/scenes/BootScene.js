import Phaser from 'phaser';

import { generateTextures } from '../systems/textures.js';
import Sfx from '../systems/Sfx.js';
import Client from '../net/Client.js';
import { detectRole } from '../net/device.js';
import { BUILD_ID } from './LobbyScene.js';

// Boot scene. Prepares the shared systems (procedural textures, audio, network
// client) and routes straight to the right entry — no title/"press start"
// screen. The device decides:
//   TV      -> host automatically and show the battlefield
//   phone   -> jump to the "join as player" form (code + name)
//   else    -> show the host / join choice
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // The game emblem, shown on the home/lobby screens. Rasterised large so it
    // stays crisp on a TV; it is the only shipped image asset (text SVG).
    this.load.svg('logo', 'icon.svg', { width: 320, height: 320 });
  }

  create() {
    this.maybeForceUpdate(); // a stale PWA refreshes itself when scanned from a newer host
    generateTextures(this);
    if (!this.registry.get('sfx')) this.registry.set('sfx', new Sfx());
    if (!this.registry.get('client')) {
      const client = new Client();
      client.connect();
      this.registry.set('client', client);
    }
    if (!this.registry.get('quality')) this.registry.set('quality', 'full');

    // Audio can only start after a gesture; the context starts suspended. We keep
    // re-arming rather than unlocking once: phones (the controllers) re-suspend
    // the context whenever the page backgrounds — lock screen, app switch,
    // incoming call, notification shade — and a one-shot listener would never
    // wake it again, leaving the phone silent for the rest of the session. So
    // resume on every gesture (a cheap no-op once running) and whenever the page
    // returns to the foreground.
    const sfx = this.registry.get('sfx');
    const wake = () => sfx.unlock();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

    const role = detectRole();
    if (role === 'local') { this.scene.start('Local'); return; } // ?local / #local direct entry
    const auto = role === 'tv' ? 'host' : role === 'phone' ? 'join' : null;
    this.scene.start('Lobby', { auto });
  }

  // The QR/link carries the host's build id (?v=…). If our running bundle differs
  // we are a stale PWA: pull the new service worker and reload, exactly once per
  // target build (a sessionStorage guard prevents a refresh loop when the new
  // build genuinely cannot be fetched — offline, or not yet deployed).
  maybeForceUpdate() {
    const want = new URLSearchParams(window.location.search).get('v');
    if (!want || want === BUILD_ID) return; // fresh, or no hint to compare against
    let tried = null;
    try { tried = sessionStorage.getItem('towerduel.upd'); } catch { /* private mode */ }
    if (tried === want) return; // already attempted this target this session
    try { sessionStorage.setItem('towerduel.upd', want); } catch { /* ignore */ }

    if (!('serviceWorker' in navigator)) { window.location.reload(); return; }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { window.location.reload(); return; }
      // skipWaiting/clientsClaim (vite.config) make a new SW take control as soon
      // as it installs; reload the moment it does.
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      reg.update().catch(() => {});
      // Fallback if the SW was already current (no controllerchange will fire):
      // reload once to re-pull; the session guard stops any loop.
      setTimeout(() => window.location.reload(), 3000);
    }).catch(() => window.location.reload());
  }
}
