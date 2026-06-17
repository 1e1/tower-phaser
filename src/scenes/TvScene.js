import Phaser from 'phaser';
import QRCode from 'qrcode';

import { GAME_WIDTH, GAME_HEIGHT, COLORS, turboBars, SHIELD, WINDSOCK } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { generateHeights } from '../sim/terrain.js';
import { PHASE } from '../sim/Simulation.js';
import { BUILD_ID, REPO_URL } from './LobbyScene.js';
import Background from '../objects/Background.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Hud from '../objects/Hud.js';
import { computeWindsock, shade, towerPalette } from '../render/visuals.js';
import { runBenchmark } from '../systems/benchmark.js';

// Deterministic [0,1) hash for the collapse debris, so brick layout and throw
// vectors are stable across a resume/replay of the same destruction.
function frag(n) {
  const v = Math.sin(n * 91.7) * 43758.5453;
  return v - Math.floor(v);
}

// Render projectiles this many ms behind the latest snapshot. Snapshots land at
// ~30 Hz (33 ms apart); holding a small buffer lets us interpolate positions at
// the display refresh rate instead of stepping once per network tick, so shells
// glide smoothly on a 60/120 Hz screen. The TV is a spectator view, so the tiny
// added latency is invisible and well worth the smoothness.
const PROJ_RENDER_DELAY_MS = 55;

// Big-screen view. As the host (role 'tv') it shows the room code + QR and the
// round count, and renders the authoritative match. As a queued spectator it
// only renders the match with a queue badge. The match auto-starts server-side
// when both player slots are filled, so the TV never needs keyboard input.
export default class TvScene extends Phaser.Scene {
  constructor() {
    super('Tv');
  }

  init(data) {
    this.code = data.code;
    this.token = data.token || null; // host reconnect token (anchors the room)
    this.lanIp = data.lanIp || null;
    this.publicHost = data.publicHost || null;
    this.spectator = !!data.spectator;
    this.queuePos = data.queue || 0;
    this.mode = this.spectator ? 'spectating' : 'lobby';
    this.cfgWins = 3;
    this.cfgBiomeId = BIOMES[0].id;
    this.configOwnerSlot = 0;
    this.roster = [
      { name: null, connected: false },
      { name: null, connected: false },
    ];
    this.lastBanner = '';
    this.seed = -1;
    this.wind = 0;
    this.endShown = false;
    this.unsubs = [];
    this._warmBiomeId = null;   // biome the lobby has pre-built the battlefield for
    this._warmBackground = null;
    this._warmTerrain = null;
  }

  create() {
    this.client = this.registry.get('client');
    this.sfx = this.registry.get('sfx');
    this.input.keyboard.on('keydown-M', () => {
      const on = this.sfx.toggle();
      if (this.hud) this.hud.showBanner(on ? 'Sound on' : 'Sound off', 700);
    });
    // Probe render performance on the screen that actually renders the match,
    // and pick a quality tier (read later, in enterMatch).
    runBenchmark(this);

    if (this.spectator) this.buildSpectatorIntro();
    else this.buildLobby();

    this.track(this.client.on('roster', (m) => this.onRoster(m)));
    this.track(this.client.on('snapshot', (m) => this.onSnapshot(m)));
    this.track(this.client.on('queue', (m) => this.onQueue(m)));
    this.track(this.client.on('promote', (m) =>
      this.scene.start('Controller', {
        player: m.player,
        code: this.code,
        name: m.name,
        token: m.token,
        isConfigOwner: false,
      }),
    ));

    // The host TV closes the whole room (all players are sent home); a spectator
    // just leaves. roomClosed also reaches spectators when the host quits.
    this.track(this.client.on('roomClosed', () => {
      if (!this.leaving) this.scene.start('Lobby', { auto: 'join' });
    }));

    // Host reconnection (lock/sleep/blip): the socket auto-reconnects, then we
    // reclaim the room anchor with our token within the server's 10s grace.
    this.track(this.client.on('close', () => this.showReconnecting(true)));
    this.track(this.client.on('reopen', () => {
      if (this.token && !this.spectator) this.client.send('rehost', { code: this.code, token: this.token });
    }));
    this.track(this.client.on('rehosted', () => { this.showReconnecting(false); this.client.send('sync'); }));
    this.escHandler = (e) => { if (e.key === 'Escape') this.goHome(); };
    window.addEventListener('keydown', this.escHandler);

    // Ask the server for the current roster (needed after a scene restart, e.g.
    // returning to the lobby when a player left mid-match).
    this.client.send('sync');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.sfx.windStop();
      this.discardPrewarm(); // drop an unconsumed lobby prewarm (frees its canvas texture)
      this.unsubs.forEach((off) => off());
      window.removeEventListener('keydown', this.escHandler);
      if (this.badge) this.badge.remove();
      if (this.reconnectBanner) { this.reconnectBanner.remove(); this.reconnectBanner = null; }
      if (this.oppBanner) { this.oppBanner.remove(); this.oppBanner = null; }
    });
  }

  // Escape returns to the home screen: as the host this tears the room down for
  // everyone; as a spectator it just disconnects this device.
  goHome() {
    this.leaving = true;
    this.client.send('goHome');
    this.scene.start('Lobby', { auto: this.spectator ? 'join' : 'host' });
  }

  track(off) {
    this.unsubs.push(off);
  }

  // --- host lobby ----------------------------------------------------------

  buildLobby() {
    const cx = GAME_WIDTH / 2;
    this.lobby = [];
    document.title = `Tower Duel — Room ${this.code}`;
    const add = (o) => {
      this.lobby.push(o);
      return o;
    };

    if (this.textures.exists('logo')) {
      add(this.add.image(cx, 58, 'logo').setOrigin(0.5).setDisplaySize(78, 78));
    }
    add(this.text(cx, 130, 'TOWER DUEL', 58, COLORS.hud, true));
    // The room code is the only thing a phone needs to type — no instructions.
    add(this.add.text(cx, 232, this.code.split('').join(' '), {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '84px', color: COLORS.hud, fontStyle: 'bold',
    }).setOrigin(0.5));

    this.buildQr(cx, 396);

    // The match the Architect is configuring (icon-only bar), and the two players
    // coloured by their side — labelled with their fun handle (never a real name).
    this.cfgBar = add(this.add.graphics());
    this.playersBar = add(this.add.graphics());
    this.playerNames = [0, 1].map(() => add(
      this.add.text(0, 0, '', {
        fontFamily: 'Trebuchet MS, sans-serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0.5),
    ));

    // Discreet build stamp, so you can confirm the TV and the phones are running
    // the same deploy (and not a cached one).
    // Clickable (no visible affordance): jumps to the project home on GitHub.
    add(this.text(cx, GAME_HEIGHT - 16, `build ${BUILD_ID}`, 14, '#5a6478')
      .setInteractive({ useHandCursor: false })
      .on('pointerdown', () => window.open(REPO_URL, '_blank', 'noopener,noreferrer')));

    this.refreshLobby();
  }

  // --- graphical lobby bars (no text / no names) ---------------------------

  refreshLobby() {
    if (this.mode !== 'lobby' || !this.cfgBar) return;
    this.drawConfigBar();
    this.drawPlayersBar();
    this.prewarmArena();
  }

  // The TV idles in the lobby while players connect — use that window to pre-build
  // the two expensive renderers (parallax background + terrain texture) for the
  // configured biome, hidden, so starting the match doesn't stall a TV-class CPU.
  // Rebuilt if the configured biome changes; adopted (or discarded) in enterMatch.
  prewarmArena() {
    if (this.spectator || this._warmBiomeId === this.cfgBiomeId) return;
    this.discardPrewarm();
    const biome = BIOMES.find((b) => b.id === this.cfgBiomeId) || BIOMES[0];
    this._warmBiomeId = biome.id;
    this._warmBackground = new Background(this, biome, this.quality).setVisible(false);
    this._warmTerrain = new Terrain(this, biome.terrain);
    // Draw a placeholder surface so the canvas allocation + texture upload happen
    // now; the real seeded heightfield is a cheap redraw on match entry.
    this._warmTerrain.setHeights(generateHeights(0, biome.roughness ?? 1, { centralRise: biome.centralRise ?? 0 }));
    this._warmTerrain.image.setVisible(false);
  }

  discardPrewarm() {
    if (this._warmBackground) { this._warmBackground.destroy(); this._warmBackground = null; }
    if (this._warmTerrain) { this._warmTerrain.destroy(); this._warmTerrain = null; }
    this._warmBiomeId = null;
  }

  // The configured match, read at a glance, fully dressed in the biome: a
  // darkened sky→ground gradient panel rimmed in the biome's celestial accent,
  // a biome medallion, HP hearts, the cadence gauge (a turn-by-turn glyph in
  // Classic, or 1–3 lit bars in Turbo: 8s→1, 5s→2, 2s→3) and one pip per round.
  drawConfigBar() {
    const biome = BIOMES.find((b) => b.id === this.cfgBiomeId) || BIOMES[0];
    const hp = this.cfgHp || 1;
    const rounds = this.cfgWins || 3;
    const g = this.cfgBar;
    g.clear();

    const W = 760; const H = 70; const x = (GAME_WIDTH - W) / 2; const y = 556;
    const cy = y + H / 2;
    const accent = biome.celestial?.color ?? 0xffffff;

    // Biome-dressed panel: a darkened sky at the top easing to dark ground at the
    // bottom, so the strip reads as a slice of the chosen world yet keeps icons
    // legible. The celestial colour rims it.
    const sky = Phaser.Display.Color.IntegerToColor(biome.sky[0]);
    const grd = Phaser.Display.Color.IntegerToColor(biome.terrain.dark);
    const top = Phaser.Display.Color.GetColor(sky.r * 0.5 + 10, sky.g * 0.5 + 10, sky.b * 0.5 + 14);
    const bot = Phaser.Display.Color.GetColor(grd.r * 0.65 + 8, grd.g * 0.65 + 8, grd.b * 0.65 + 10);
    g.fillGradientStyle(top, top, bot, bot, 1);
    g.fillRoundedRect(x, y, W, H, 16);
    g.lineStyle(2, accent, 0.8); g.strokeRoundedRect(x, y, W, H, 16);

    const turbo = !!this.cfgTurbo;
    const lit = turboBars(this.cfgCadence ?? 0); // 8s→1, 5s→2, 2s→3
    const elems = [
      { w: 40, draw: (ex) => this.biomeMedallion(g, ex, cy, biome, accent) },
      { w: hp * 38, draw: (ex) => { for (let i = 0; i < hp; i += 1) this.heart(g, ex + 19 + i * 38, cy, 13, 0xff7a6a); } },
      turbo
        ? { w: 66, draw: (ex) => { for (let i = 0; i < 3; i += 1) { g.fillStyle(i < lit ? 0xe7b54a : 0x3a4a66, 1); g.fillRoundedRect(ex + i * 22, cy - 8 - i * 4, 16, 16 + i * 8, 3); } } }
        : { w: 44, draw: (ex) => this.turnGlyph(g, ex + 22, cy, accent) },
      { w: rounds * 26, draw: (ex) => { g.fillStyle(0xffffff, 1); for (let i = 0; i < rounds; i += 1) g.fillCircle(ex + 13 + i * 26, cy, 8); } },
    ];
    const GAP = 32;
    const total = elems.reduce((s, e) => s + e.w, 0) + GAP * (elems.length - 1);
    let ex = x + (W - total) / 2;
    elems.forEach((e, idx) => {
      e.draw(ex);
      ex += e.w;
      if (idx < elems.length - 1) {
        const dx = ex + GAP / 2;
        g.lineStyle(1, 0xffffff, 0.18); g.beginPath(); g.moveTo(dx, y + 16); g.lineTo(dx, y + H - 16); g.strokePath();
        ex += GAP;
      }
    });
  }

  // A small graphics heart (two lobes + a point).
  heart(g, cx, cy, r, color) {
    g.fillStyle(color, 1);
    g.fillCircle(cx - r * 0.5, cy - r * 0.35, r * 0.58);
    g.fillCircle(cx + r * 0.5, cy - r * 0.35, r * 0.58);
    g.fillTriangle(cx - r, cy - r * 0.1, cx + r, cy - r * 0.1, cx, cy + r * 0.95);
  }

  // A little medallion of the chosen biome: its sky, a celestial body and a
  // ground hill, rimmed in the accent — the bar's "which world" badge.
  biomeMedallion(g, ex, cy, biome, accent) {
    const mx = ex + 19;
    const r = 17;
    g.fillStyle(biome.sky[0], 1); g.fillCircle(mx, cy, r);
    g.fillStyle(biome.terrain.fill, 1); g.fillTriangle(mx - 11, cy + 12, mx, cy - 2, mx + 11, cy + 12);
    g.fillStyle(accent, 1); g.fillCircle(mx + 6, cy - 7, 5);
    g.lineStyle(2, accent, 0.9); g.strokeCircle(mx, cy, r);
  }

  // Classic (turn-by-turn) glyph: two opposing arcs with arrowheads, the
  // universal "alternating turns / cycle" mark. Replaces the turbo bars.
  turnGlyph(g, gx, gy, color) {
    const r = 12;
    g.lineStyle(3.5, color, 1);
    g.beginPath(); g.arc(gx, gy, r, Phaser.Math.DegToRad(205), Phaser.Math.DegToRad(335), false); g.strokePath();
    g.beginPath(); g.arc(gx, gy, r, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155), false); g.strokePath();
    this.arrowHead(g, gx, gy, r, 335, color);
    this.arrowHead(g, gx, gy, r, 155, color);
  }

  // A filled triangle riding the circle at `deg`, pointing along the (clockwise)
  // tangent — the head of a curved arrow.
  arrowHead(g, cx, cy, r, deg, color) {
    const a = Phaser.Math.DegToRad(deg);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    const ta = a + Math.PI / 2; // clockwise tangent
    const tx = Math.cos(ta); const ty = Math.sin(ta);
    const nx = Math.cos(a); const ny = Math.sin(a);
    const s = 6;
    g.fillStyle(color, 1);
    g.fillTriangle(
      px + tx * s, py + ty * s,
      px - nx * s * 0.8 - tx * s * 0.2, py - ny * s * 0.8 - ty * s * 0.2,
      px + nx * s * 0.8 - tx * s * 0.2, py + ny * s * 0.8 - ty * s * 0.2,
    );
  }

  // Two pills, one per seat, coloured by the chosen side (neutral until a camp is
  // claimed) and labelled with the player's fun handle. State is fill/outline.
  drawPlayersBar() {
    const g = this.playersBar;
    g.clear();
    const decided = this.campChooser !== -1;
    const W = 300; const H = 44; const gap = 40; const y = 646;
    const total = W * 2 + gap; const x0 = (GAME_WIDTH - total) / 2;
    const sideColor = [COLORS.towerP1, COLORS.towerP2];
    const neutral = COLORS.towerNeutral;

    for (let i = 0; i < 2; i += 1) {
      const p = this.roster[i] || {};
      const x = x0 + i * (W + gap);
      const present = p.connected;
      const reconnecting = p.reconnecting;
      const color = decided ? sideColor[i] : neutral;

      if (present) {
        g.fillStyle(color, 0.9); g.fillRoundedRect(x, y, W, H, 22);
      } else {
        // waiting / reconnecting: hollow outline (amber while reconnecting)
        g.lineStyle(2, reconnecting ? 0xe7b54a : neutral, reconnecting ? 0.9 : 0.5);
        g.strokeRoundedRect(x, y, W, H, 22);
      }
      // avatar dot
      g.fillStyle(present ? 0xffffff : neutral, present ? 0.95 : 0.5);
      g.fillCircle(x + 28, y + H / 2, 9);
      // claimed-side check mark
      if (this.campChooser === i) {
        g.lineStyle(4, 0xffffff, 0.95); g.beginPath();
        g.moveTo(x + W - 46, y + H / 2); g.lineTo(x + W - 36, y + H / 2 + 9); g.lineTo(x + W - 20, y + H / 2 - 11);
        g.strokePath();
      }
      // fun handle (never a real name); hidden until the seat is taken
      const label = this.playerNames[i];
      label.setPosition(x + 46, y + H / 2);
      label.setText(present || reconnecting ? (p.name || '') : '');
      label.setColor(present ? '#ffffff' : '#9fb0c8');
    }
  }

  text(x, y, str, size, color, bold = false) {
    return this.add
      .text(x, y, str, {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
        align: 'center',
      })
      .setOrigin(0.5);
  }

  joinUrl() {
    const loc = window.location;
    let hostname = loc.hostname;
    // An explicit PUBLIC_HOST override always wins; otherwise only swap a
    // loopback host for the detected LAN IP (the URL the TV used works as-is).
    if (this.publicHost) {
      hostname = this.publicHost;
    } else if ((hostname === 'localhost' || hostname === '127.0.0.1') && this.lanIp) {
      hostname = this.lanIp;
    }
    const port = loc.port ? `:${loc.port}` : '';
    // Advertise the build this host is running: a phone whose cached PWA bundle
    // differs from `v` knows it is stale and force-updates on scan (see BootScene
    // maybeForceUpdate). Harmless to older clients that ignore the param.
    return `${loc.protocol}//${hostname}${port}/?code=${this.code}&v=${encodeURIComponent(BUILD_ID)}`;
  }

  buildQr(x, y) {
    const canvas = document.createElement('canvas');
    QRCode.toCanvas(canvas, this.joinUrl(), { margin: 1, width: 200 }, (err) => {
      if (err || this.mode !== 'lobby') return;
      const key = `qr-${this.code}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, canvas);
      this.lobby.push(this.add.image(x, y, key).setOrigin(0.5));
    });
  }

  // --- spectator intro -----------------------------------------------------

  buildSpectatorIntro() {
    const cx = GAME_WIDTH / 2;
    this.lobby = [];
    if (this.textures.exists('logo')) {
      this.lobby.push(this.add.image(cx, GAME_HEIGHT / 2 - 70, 'logo').setOrigin(0.5).setDisplaySize(96, 96));
    }
    this.lobby.push(this.text(cx, GAME_HEIGHT / 2 + 16, 'Spectating — waiting for the match…', 30, COLORS.hudDim));
    this.buildBadge();
  }

  buildBadge() {
    if (this.badge) return;
    const badge = document.createElement('div');
    badge.style.cssText =
      'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:20;' +
      'background:rgba(0,0,0,.55);color:#fff;padding:8px 18px;border-radius:20px;' +
      "font-family:'Trebuchet MS',sans-serif;font-size:18px;";
    this.badge = badge;
    document.body.appendChild(badge);
    this.updateBadge();
  }

  updateBadge() {
    if (this.badge) {
      this.badge.textContent = this.queuePos
        ? `Spectating · #${this.queuePos} in queue`
        : 'Spectating';
    }
  }

  onQueue(m) {
    this.queuePos = m.position;
    this.updateBadge();
  }

  // A full-width banner while the host socket is recovering. The server holds the
  // room (and all players) for 10s; if we miss that window it sends roomClosed.
  showReconnecting(on) {
    if (on && !this.reconnectBanner) {
      const b = document.createElement('div');
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:40;text-align:center;padding:10px;' +
        "background:#c9892b;color:#fff;font-weight:bold;font-size:20px;font-family:'Trebuchet MS',sans-serif;";
      b.textContent = 'Reconnecting…';
      this.reconnectBanner = b;
      document.body.appendChild(b);
    } else if (!on && this.reconnectBanner) {
      this.reconnectBanner.remove();
      this.reconnectBanner = null;
    }
  }

  // --- roster / snapshots --------------------------------------------------

  onRoster(m) {
    this.roster = m.players;
    this.configOwnerSlot = m.configOwnerSlot ?? 0;
    this.setup = !!m.setup;
    this.configDone = !!m.configDone;
    this.campChooser = m.campChooser ?? -1;
    if (m.config) {
      // The TV only displays the config, so it keeps the raw values (not the
      // setup-screen indices the controller needs to cycle the options).
      this.cfgBiomeId = m.config.biomeId;
      this.cfgWins = m.config.wins;
      this.cfgHp = m.config.hp || 1;
      this.cfgTurbo = !!m.config.turbo;
      this.cfgCadence = m.config.cadence ?? 0;
    }
    if (this.mode === 'lobby') this.refreshLobby();
    // A player was finally released (grace window lapsed): the room reset to the
    // invitation lobby, so rebuild this scene back to the code + QR screen.
    else if ((this.mode === 'match' || this.mode === 'end') && !m.inMatch) {
      this.scene.restart({ code: this.code, token: this.token, lanIp: this.lanIp, publicHost: this.publicHost, spectator: this.spectator, queue: this.queuePos });
      return;
    }
    // A player dropped but their seat is still held (the 10s grace): the TV stays
    // on the battlefield and shows it is waiting, rather than bailing to the home
    // screen. It only leaves once the seat is released (inMatch flips false above).
    if (this.mode === 'match') {
      const lost = (m.players || []).some((p) => p && p.reconnecting);
      this.showOpponentReconnecting(lost);
    }
  }

  // A banner shown over the battlefield while a player's seat is held open after
  // a drop, so the wait reads as intentional (the seat is reclaimed on reconnect,
  // or freed after the grace window — at which point the TV returns to the lobby).
  showOpponentReconnecting(on) {
    if (on && !this.oppBanner) {
      const b = document.createElement('div');
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:35;text-align:center;padding:10px;' +
        "background:#c9892b;color:#fff;font-weight:bold;font-size:20px;font-family:'Trebuchet MS',sans-serif;";
      b.textContent = 'A player disconnected — holding the match…';
      this.oppBanner = b;
      document.body.appendChild(b);
    } else if (!on && this.oppBanner) {
      this.oppBanner.remove();
      this.oppBanner = null;
    }
  }

  onSnapshot(m) {
    // A fresh match started after a finished one (the loser may have changed
    // the biome): rebuild the scene cleanly.
    if (this.endShown && m.state.phase !== PHASE.MATCH_END) {
      this.scene.restart({
        code: this.code,
        token: this.token,
        lanIp: this.lanIp,
        publicHost: this.publicHost,
        spectator: this.spectator,
        queue: this.queuePos,
      });
      return;
    }
    if (this.mode === 'lobby' || this.mode === 'spectating') this.enterMatch(m.state);
    if (this.mode !== 'match') return;
    this.renderState(m.state);
    this.processEvents(m.events || []);
  }

  enterMatch(state) {
    this.mode = 'match';
    (this.lobby || []).forEach((o) => o.destroy());
    this.lobby = [];

    const biome = BIOMES.find((b) => b.id === state.biomeId) || BIOMES[0];
    this.biome = biome;

    // Adopt the lobby-prewarmed renderers when the biome still matches; otherwise
    // (spectator, or the biome changed since the prewarm) build them fresh now.
    if (this._warmBiomeId === biome.id && this._warmBackground && this._warmTerrain) {
      this.background = this._warmBackground;
      this.terrain = this._warmTerrain;
      this.background.setVisible(true);
      this.terrain.image.setVisible(true);
      this._warmBackground = null;
      this._warmTerrain = null;
      this._warmBiomeId = null;
    } else {
      this.discardPrewarm();
      this.background = new Background(this, biome, this.quality);
      this.terrain = new Terrain(this, biome.terrain);
    }
    this.loadTerrain(state.seed, this.terrainOpts(state));

    this.towers = this.buildTowers(state, 0);
    this.windsockGfx = this.add.graphics().setDepth(2);
    this.shieldGfx = this.add.graphics().setDepth(3);
    this.shieldFx = [[], []];     // per-tower LIST of eased render states {x,y,ux,uy,appear,open}
    this.shieldTarget = [[], []]; // per-tower LIST of latest authoritative shields

    this.createEmitters();
    this.shotGfx = this.add.graphics().setDepth(5);
    this.projTrails = new Map();
    this.projSnaps = []; // recent {time, list} snapshots, for interpolation
    this.hud = new Hud(this, state.names, [COLORS.towerP1, COLORS.towerP2], {
      code: this.code,
      joinUrl: this.joinUrl(),
    });

    this.roundNo = state.round.current;
    this.lastDestroyed = 1;
    this.panActive = false;
    this.fragments = []; // tumbling brick graphics from the last collapse
    this.cameras.main.setScroll(0, 0);

    this.sfx.windStart();
    this.sfx.musicStart(this.biome.id, this.roundNo, this.isDecider(state));
  }

  // True when the current round can hand a player the match — someone is one win
  // short of the target (round.total carries the first-to-N win goal). Drives the
  // tension theme.
  isDecider(state) {
    return Math.max(state.scores[0], state.scores[1]) >= state.round.total - 1;
  }

  // Create the two towers at a world offset (used by the camera-pan transition).
  // x and groundY come from the authoritative state (both vary per round).
  buildTowers(state, ox) {
    const towers = [
      new Tower(this, state.towers[0].x + ox, state.towers[0].groundY, COLORS.towerP1, 1),
      new Tower(this, state.towers[1].x + ox, state.towers[1].groundY, COLORS.towerP2, -1),
    ];
    towers.forEach((t, i) => {
      t.gfx.setDepth(1);
      t.maxHp = state.maxHp || 1;
      t.hp = state.towers[i].hp ?? t.maxHp;
      t.draw();
    });
    return towers;
  }

  // Per-round arena shape, reconstructed from the authoritative state so the
  // rendered terrain matches the server's collisions exactly: platform heights
  // ride on the transmitted tower groundY (towers stand on the flat platforms),
  // the central massif is a deterministic per-biome knob.
  terrainOpts(state) {
    return {
      leftY: state.towers[0].groundY,
      rightY: state.towers[1].groundY,
      centralRise: this.biome.centralRise ?? 0,
    };
  }

  loadTerrain(seed, opts) {
    this.seed = seed;
    this.terrain.setHeights(generateHeights(seed, this.biome.roughness ?? 1, opts));
  }

  createEmitters() {
    const opts = (extra) => ({ emitting: false, ...extra });
    this.flashEmitter = this.add.particles(0, 0, 'flash', opts({ lifespan: 220, scale: { start: 1.4, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD' })).setDepth(6);
    this.sparkEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 250, max: 650 }, speed: { min: 90, max: 340 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 420, blendMode: 'ADD' })).setDepth(6);
    this.debrisEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 400, max: 950 }, speed: { min: 60, max: 280 }, angle: { min: 190, max: 350 }, scale: { start: 1.3, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 700, tint: this.biome.terrain.dark })).setDepth(6);
    this.smokeEmitter = this.add.particles(0, 0, 'smoke', opts({ lifespan: { min: 500, max: 1100 }, speed: { min: 10, max: 60 }, scale: { start: 0.6, end: 2.4 }, alpha: { start: 0.45, end: 0 } })).setDepth(6);

    // Ground-impact dust lives BEHIND the terrain (negative depth) so the relief
    // masks it: soft earthy clouds billow up out of the crater while grit sprays
    // and falls back into the ground.
    this.dustEmitter = this.add
      .particles(0, 0, 'smoke', opts({
        lifespan: { min: 700, max: 1500 },
        speedX: { min: -45, max: 45 },
        speedY: { min: -70, max: -18 },
        gravityY: 50,
        scale: { start: 0.5, end: 2.8 },
        alpha: { start: 0.55, end: 0 },
        tint: this.biome.terrain.edge,
      }))
      .setDepth(-1);
    this.gritEmitter = this.add
      .particles(0, 0, 'spark', opts({
        lifespan: { min: 350, max: 800 },
        speed: { min: 40, max: 170 },
        angle: { min: 200, max: 340 },
        gravityY: 640,
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.85, end: 0 },
        tint: this.biome.terrain.dark,
      }))
      .setDepth(-1);

    // Fuse spark that flickers on a ready cannon (replaces the "READY" text).
    this.fuseSpark = this.add
      .particles(0, 0, 'spark', opts({
        lifespan: { min: 200, max: 480 },
        speed: { min: 20, max: 70 },
        angle: { min: 230, max: 310 },
        gravityY: 120,
        scale: { start: 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffe680, 0xff8c2a],
        blendMode: 'ADD',
      }))
      .setDepth(2);
  }

  update(_time, delta) {
    if (this.mode !== 'match') return;
    const dt = Math.min(delta / 1000, 0.05);
    this.background.update(dt);
    this.sfx.windUpdate(this.background.windValue); // eased wind drives the ambient bed
    if (this.panActive) return;
    this.drawMidWindsock(_time);
    this.animateShields(dt);
    // Spark the fuse of any ready cannon.
    if (this.towers && this.fuseSpark) {
      for (const t of this.towers) {
        if (t.ready) {
          const f = t.fuseTip;
          this.fuseSpark.emitParticleAt(f.x, f.y, 1);
        }
      }
    }
    this.renderProjectiles();
  }

  // Draw projectiles at a point slightly in the past, interpolating between the
  // two buffered snapshots that bracket it, so motion is smooth between the
  // 30 Hz network ticks. Matches shells by id; one present in only one of the
  // two snapshots (just spawned, or about to vanish) is drawn at its known pos.
  renderProjectiles() {
    const snaps = this.projSnaps;
    if (!snaps || !snaps.length) return;

    const renderTime = this.time.now - PROJ_RENDER_DELAY_MS;
    if (renderTime <= snaps[0].time) { this.drawProjectiles(snaps[0].list); return; }
    const newest = snaps[snaps.length - 1];
    if (renderTime >= newest.time) { this.drawProjectiles(newest.list); return; }

    let older = snaps[0];
    let newer = newest;
    for (let i = 0; i < snaps.length - 1; i += 1) {
      if (snaps[i].time <= renderTime && renderTime <= snaps[i + 1].time) {
        older = snaps[i];
        newer = snaps[i + 1];
        break;
      }
    }
    const span = newer.time - older.time || 1;
    const f = Math.max(0, Math.min(1, (renderTime - older.time) / span));

    const om = new Map(older.list.map((p) => [p.id, p]));
    const nm = new Map(newer.list.map((p) => [p.id, p]));
    const out = [];
    for (const id of new Set([...om.keys(), ...nm.keys()])) {
      const a = om.get(id);
      const b = nm.get(id);
      if (a && b) out.push({ id, owner: b.owner, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      else out.push(a || b);
    }
    this.drawProjectiles(out);
  }

  // A windsock planted in the middle of the battlefield (#1), driven by the
  // eased wind so it matches the particles. It is now an authoritative 1-HP
  // target: its alive flag + anchor come from the snapshot (windsockState), and
  // it vanishes once shot down. The wire y is the pole TOP, so the pole base is
  // y + WINDSOCK.poleH.
  drawMidWindsock(time) {
    const g = this.windsockGfx;
    if (!g) return;
    g.clear();
    const ws0 = this.windsockState;
    if (!ws0 || !ws0.alive) return;
    const x = ws0.x;
    const baseY = ws0.y + WINDSOCK.poleH;
    const ws = computeWindsock(x, baseY, this.background.windValue, time, WINDSOCK.poleH);
    g.lineStyle(4, 0x6b7180, 1);
    g.beginPath();
    g.moveTo(ws.pole.x1, ws.pole.y1);
    g.lineTo(ws.pole.x2, ws.pole.y2);
    g.strokePath();
    for (const seg of ws.segments) {
      g.fillStyle(seg.color, 1);
      g.beginPath();
      g.moveTo(seg.quad[0].x, seg.quad[0].y);
      for (let k = 1; k < seg.quad.length; k += 1) g.lineTo(seg.quad[k].x, seg.quad[k].y);
      g.closePath();
      g.fillPath();
    }
  }

  // Deployed shields, drawn each frame with eased transitions: a plate that
  // scales in on deploy (appear), splits open down the middle while its owner
  // fires through it (open), and fades out when it shatters or the round ends.
  // Each tower may stack several plates: its fx list is matched to the snapshot
  // shields by array index — an index present in the snapshot eases toward it; a
  // trailing fx entry past the snapshot length fades out then drops.
  animateShields(dt) {
    const g = this.shieldGfx;
    if (!g) return;
    g.clear();
    const k = Math.min(1, dt * 12); // easing rate
    for (let i = 0; i < 2; i += 1) {
      const targets = this.shieldTarget?.[i] || [];
      const list = this.shieldFx[i];
      const col = i === 0 ? COLORS.towerP1 : COLORS.towerP2;
      // Walk the longer of the two so we both spawn new plates and fade dropped
      // ones; iterate backwards so splicing a faded entry doesn't skip indices.
      const n = Math.max(list.length, targets.length);
      for (let s = n - 1; s >= 0; s -= 1) {
        const target = targets[s] || null;
        let fx = list[s];
        if (target) {
          if (!fx) fx = list[s] = { x: target.x, y: target.y, ux: target.ux, uy: target.uy, appear: 0, open: target.open ? 1 : 0 };
          fx.x = target.x; fx.y = target.y; fx.ux = target.ux; fx.uy = target.uy;
          fx.appear += (1 - fx.appear) * k;
          fx.open += ((target.open ? 1 : 0) - fx.open) * Math.min(1, dt * 16);
        } else if (fx) {
          fx.appear += (0 - fx.appear) * k; // shatter / round-end fade-out
          if (fx.appear < 0.03) { list.splice(s, 1); continue; }
        } else {
          continue;
        }
        const half = SHIELD.plateHalf * fx.appear;
        const gap = fx.open * 13; // middle opening when the owner fires through it
        const alpha = Math.max(0, fx.appear) * (1 - 0.45 * fx.open);
        const ux = fx.ux; const uy = fx.uy;
        // Two half-plates with a gap in the centre (gap 0 = solid).
        const segs = [[gap, half], [-gap, -half]];
        for (const [from, to] of segs) {
          const bx = fx.x + ux * from; const by = fx.y + uy * from;
          const ex = fx.x + ux * to; const ey = fx.y + uy * to;
          g.lineStyle(10, 0xdfe6f2, alpha); g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.strokePath();
          g.lineStyle(4, col, alpha); g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.strokePath();
        }
        g.fillStyle(0xffffff, alpha * (1 - fx.open)); g.fillCircle(fx.x, fx.y, 4 * fx.appear);
      }
    }
  }

  renderState(state) {
    this.wind = state.wind;
    this.background.setWind(state.wind);

    // HUD always tracks the authoritative state, even during the pan.
    this.hud.updateNames(state.names);
    this.hud.updateScores(state.scores);
    this.hud.updateRound(state.round.current, state.round.total);
    this.hud.updateWind({ value: state.wind });
    if (state.banner && state.banner !== this.lastBanner) this.hud.showBanner(state.banner);
    this.lastBanner = state.banner;
    if (state.phase === PHASE.MATCH_END && !this.endShown) this.showEnd(state);

    if (this.panActive) return; // the pan owns the world during the transition

    // A new round begins (new seed): slide the camera into the next arena.
    if (state.seed !== this.seed) {
      if (state.round.current > this.roundNo) {
        this.startPan(state);
        return;
      }
      this.loadTerrain(state.seed, this.terrainOpts(state));
    }
    this.terrain.applyCraters(state.craters);

    this.towers.forEach((t, i) => {
      const ts = state.towers[i];
      // x is constant within a round (the sim only moves towers at newTerrain);
      // syncing it here keeps a non-pan terrain reload (resync) in step.
      if (ts.x != null) { t.x = ts.x; t.pivotX = ts.x; }
      t.groundY = ts.groundY;
      t.pivotY = ts.groundY - 96;
      t.angle = ts.angle;
      t.power = ts.power;
      // Fuse is lit only while still aiming; it goes out the instant we fire.
      t.ready = ts.ready && state.phase === PHASE.AIMING;
      t.maxHp = state.maxHp || 1;
      t.hp = ts.hp ?? t.maxHp;
      t.draw();
    });

    this.shieldTarget = state.towers.map((t) => t.shields || []); // eased + drawn in update()
    this.windsockState = state.windsock; // authoritative alive + anchor; drawn in update()

    // Projectiles aren't drawn here: their positions are buffered and rendered,
    // interpolated, from update() at the display refresh rate.
    this.projSnaps.push({ time: this.time.now, list: state.projectiles });
    if (this.projSnaps.length > 4) this.projSnaps.shift();

    // Accumulate trail history at the network rate, so trail length stays
    // independent of the render framerate (drawProjectiles only renders it).
    const active = new Set(state.projectiles.map((p) => p.id));
    for (const id of this.projTrails.keys()) {
      if (!active.has(id)) this.projTrails.delete(id);
    }
    for (const p of state.projectiles) {
      const tr = this.projTrails.get(p.id) || [];
      tr.push({ x: p.x, y: p.y });
      if (tr.length > 34) tr.shift();
      this.projTrails.set(p.id, tr);
    }
  }

  // Inter-round camera pan toward the destroyed tower, advancing one screen.
  startPan(state) {
    this.panActive = true;
    this.clearFragments(); // collapse debris from this round must not ride along
    // Crossfade the music (volume + tempo) across the same 1.1 s camera slide.
    this.sfx.musicTransition(this.biome.id, state.round.current, this.isDecider(state), 1.1);
    const dir = this.lastDestroyed === 0 ? -1 : 1;
    const ox = dir * GAME_WIDTH;

    const oldTerrain = this.terrain;
    const oldTowers = this.towers;

    const nextTerrain = new Terrain(this, this.biome.terrain);
    nextTerrain.setHeights(generateHeights(state.seed, this.biome.roughness ?? 1, this.terrainOpts(state)));
    nextTerrain.setX(ox);
    const nextTowers = this.buildTowers(state, ox);

    this.cameras.main.pan(
      GAME_WIDTH / 2 + ox, GAME_HEIGHT / 2, 1100, 'Sine.easeInOut', true,
      (cam, progress) => {
        if (progress < 1) return;
        oldTerrain.destroy();
        oldTowers.forEach((t) => t.destroy());
        nextTerrain.setX(0);
        nextTowers.forEach((t) => {
          t.x -= ox; t.pivotX -= ox; t.draw();
        });
        this.terrain = nextTerrain;
        this.towers = nextTowers;
        this.seed = state.seed;
        this.roundNo = state.round.current;
        this.cameras.main.setScroll(0, 0);
        // Bake the pan into the scenery so the parallax decor keeps the position
        // the pan left it at instead of snapping back when the scroll resets.
        this.background.shiftWorld(ox);
        this.projTrails = new Map();
        this.projSnaps = [];
        this.panActive = false;
      },
    );
  }

  drawProjectiles(projectiles) {
    // Trail history is accumulated at the network rate (see renderState); here
    // we only render: the fading afterglow from history plus the interpolated
    // head passed in.
    // Shells must read clearly over any biome: a fading afterglow trail, a dark
    // outline for contrast on light terrain, a saturated body, and a white core
    // for contrast on dark terrain.
    const g = this.shotGfx;
    g.clear();
    for (const p of projectiles) {
      const color = p.owner === 0 ? COLORS.projectileP1 : COLORS.projectileP2;
      const tr = this.projTrails.get(p.id) || [];
      tr.forEach((pt, idx) => {
        const f = idx / tr.length;
        g.fillStyle(0x05070d, f * 0.22);
        g.fillCircle(pt.x, pt.y, 4.5 * f + 1.5);
        g.fillStyle(color, f * 0.8);
        g.fillCircle(pt.x, pt.y, 3.2 * f + 1);
      });
      g.fillStyle(0x05070d, 0.85);
      g.fillCircle(p.x, p.y, 8.5);
      g.fillStyle(color, 1);
      g.fillCircle(p.x, p.y, 6);
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(p.x, p.y, 2.6);
    }
  }

  shake(duration, intensity) {
    if (this.quality !== 'lite') this.cameras.main.shake(duration, intensity);
  }

  processEvents(events) {
    const lite = this.quality === 'lite';
    for (const e of events) {
      if (e.type === 'fire') {
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
        this.sparkEmitter.emitParticleAt(e.x, e.y, lite ? 3 : 6);
        this.smokeEmitter.emitParticleAt(e.x, e.y, 2);
        this.sfx.boom();
        this.shake(110, 0.004);
      } else if (e.type === 'impact') {
        this.dustExplosion(e.x, e.y);
      } else if (e.type === 'hit') {
        this.explode(e.x, e.y, e.target === 0 ? COLORS.towerP1 : COLORS.towerP2, true);
      } else if (e.type === 'destroyed') {
        this.explodeTower(e.tower);
      } else if (e.type === 'shield') {
        this.sfx.shieldUp();
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
      } else if (e.type === 'shieldHit') {
        this.sfx.shieldBlock();
        const col = e.owner === 0 ? COLORS.towerP1 : COLORS.towerP2;
        const ring = this.add.circle(e.x, e.y, 6, col, 0.9).setDepth(7);
        this.tweens.add({ targets: ring, radius: 46, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
        this.sparkEmitter.emitParticleAt(e.x, e.y, this.quality === 'lite' ? 6 : 14);
        this.shake(150, 0.006);
      } else if (e.type === 'windsockDown') {
        // Bounty downed: a small burst where the windsock stood (it stops being
        // drawn next snapshot). The firer banks a shield (awarded server-side).
        const col = e.owner === 0 ? COLORS.towerP1 : COLORS.towerP2;
        const ring = this.add.circle(e.x, e.y, 6, col, 0.9).setDepth(7);
        this.tweens.add({ targets: ring, radius: 40, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
        this.sparkEmitter.emitParticleAt(e.x, e.y, this.quality === 'lite' ? 5 : 12);
        this.sfx.shieldUp();
        this.shake(140, 0.005);
      }
    }
  }

  // Dusty ground impact, rendered behind the terrain so the relief occludes it.
  dustExplosion(x, y) {
    const lite = this.quality === 'lite';
    this.dustEmitter.emitParticleAt(x, y, lite ? 4 : 9);
    this.gritEmitter.emitParticleAt(x, y, lite ? 4 : 11);
    this.sfx.explosion();
    this.shake(140, 0.005);
  }

  explode(x, y, ringColor, isTowerHit) {
    const lite = this.quality === 'lite';
    const ring = this.add.circle(x, y, 6, ringColor, 0.9).setDepth(7);
    this.tweens.add({ targets: ring, radius: isTowerHit ? 60 : 38, alpha: 0, duration: isTowerHit ? 420 : 320, onComplete: () => ring.destroy() });
    this.flashEmitter.emitParticleAt(x, y, 1);
    this.smokeEmitter.emitParticleAt(x, y, isTowerHit ? 5 : 3);
    this.debrisEmitter.emitParticleAt(x, y, lite ? 6 : isTowerHit ? 16 : 10);
    if (isTowerHit) {
      this.sparkEmitter.emitParticleAt(x, y, lite ? 8 : 18);
      this.sfx.rubble(false);
      this.shake(260, 0.012);
    } else {
      this.sparkEmitter.emitParticleAt(x, y, lite ? 4 : 8);
      this.sfx.explosion();
      this.shake(150, 0.006);
    }
  }

  // Crumble the destroyed tower (#10): a burst of stone debris and a hard shake,
  // then the body fractures into textured stone bricks that tumble and settle.
  // The standing tower collapses to a persistent rubble mound (Tower.draw renders
  // the ruin once hp hits 0); the ruin is carried away later by the round pan.
  explodeTower(i) {
    const t = this.towers[i];
    if (!t || this.panActive) return;
    this.lastDestroyed = i;
    const b = t.bounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const lite = this.quality === 'lite';
    this.flashEmitter.emitParticleAt(cx, cy, 1);
    this.smokeEmitter.emitParticleAt(cx, cy, lite ? 3 : 7);
    this.debrisEmitter.emitParticleAt(cx, cy, lite ? 10 : 26);
    this.sparkEmitter.emitParticleAt(cx, cy, lite ? 8 : 20);
    this.sfx.rubble(true);
    this.shake(420, lite ? 0.01 : 0.02);
    this.spawnBrickFragments(t, lite);
    t.hp = 0; // collapse the standing body to a ruin under the flying bricks
    t.draw();
  }

  // Shatter a tower body into stone bricks that tumble out and settle on the
  // ground. Each brick carries the masonry texture so it reads as stone in
  // flight; ~a third clump into a taller two-course block for a mix of small
  // bricks and bigger chunks. The graphics are tracked so the pan can clear them.
  spawnBrickFragments(t, lite) {
    const b = t.bounds;
    const groundY = b.y + b.height;
    const pal = towerPalette(t.color);
    const cols = lite ? 3 : 4;
    const ubw = b.width / cols;
    const ubh = ubw / 1.35; // stone-brick proportion
    const usable = b.height * 0.82; // upper body that fractures
    const rows = Math.max(4, Math.round(usable / ubh));
    const consumed = {};
    let idx = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (consumed[`${r}_${c}`]) continue;
        let span = 1;
        if (r < rows - 1 && frag(r * 5 + c * 3 + 1) > 0.64) {
          span = 2;
          consumed[`${r + 1}_${c}`] = true;
        }
        const w = ubw - 1.5;
        const h = ubh * span - 1.5;
        const g = this.add.graphics().setDepth(6);
        this.drawBrick(g, w, h, ubh, idx, t.color, pal);
        g.x = b.x + c * ubw + ubw / 2;
        g.y = b.y + r * ubh + (ubh * span) / 2;
        const driftX = (c - (cols - 1) / 2) * 26 + (frag(idx * 7) - 0.5) * 60;
        this.fragments.push(g);
        this.tweens.add({
          targets: g,
          x: g.x + driftX,
          y: groundY - h / 2 - frag(idx * 9) * 10,
          rotation: (frag(idx * 5 + 2) - 0.5) * 2.4,
          duration: 620 + frag(idx * 3) * 520,
          ease: 'Quad.easeIn',
        });
        idx += 1;
      }
    }
  }

  // A single masonry brick centred on the graphics origin: tinted stone, internal
  // mortar courses in running bond, a lit top edge and a shadowed base.
  drawBrick(g, w, h, brickH, seed, color, pal) {
    const x0 = -w / 2;
    const y0 = -h / 2;
    g.fillStyle(shade(color, 0.9 + frag(seed) * 0.16), 1);
    g.fillRect(x0, y0, w, h);
    g.lineStyle(1.5, pal.mortar, 1);
    for (let yy = y0 + brickH; yy < y0 + h - 1; yy += brickH) {
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + w, yy); g.strokePath();
    }
    let course = 0;
    for (let yy = y0; yy < y0 + h; yy += brickH, course += 1) {
      const off = (course % 2) * (brickH * 0.7);
      for (let xx = x0 + off; xx < x0 + w - 1; xx += brickH * 1.35) {
        if (xx <= x0) continue;
        g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, Math.min(yy + brickH, y0 + h)); g.strokePath();
      }
    }
    g.fillStyle(pal.lit, 0.4); g.fillRect(x0, y0, w, 3);
    g.fillStyle(0x000000, 0.22); g.fillRect(x0, y0 + h - 3, w, 3);
    g.lineStyle(1.5, pal.mortar, 1); g.strokeRect(x0, y0, w, h);
  }

  clearFragments() {
    if (this.fragments) this.fragments.forEach((g) => g.destroy());
    this.fragments = [];
  }

  showEnd(state) {
    this.endShown = true;
    this.sfx.windStop();
    this.sfx.musicStop();
    const cx = GAME_WIDTH / 2;
    const [s1, s2] = state.scores;
    let title;
    if (s1 > s2) title = `${state.names[0]} wins!`;
    else if (s2 > s1) title = `${state.names[1]} wins!`;
    else title = "It's a draw!";

    const loserName = this.roster?.[this.configOwnerSlot]?.name || 'The loser';
    this.endGroup = [
      this.add.text(cx, GAME_HEIGHT * 0.42, title, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '78px', color: COLORS.hud, fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(1001),
      this.add.text(cx, GAME_HEIGHT * 0.56, `${s1} — ${s2}`, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '48px', color: COLORS.hud }).setOrigin(0.5).setDepth(1001),
      this.add.text(cx, GAME_HEIGHT * 0.7, `${loserName} sets up the rematch…`, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '26px', color: COLORS.hudDim }).setOrigin(0.5).setDepth(1001),
    ];
  }
}
