import Phaser from 'phaser';
import QRCode from 'qrcode';

import { GAME_WIDTH, GAME_HEIGHT, COLORS, ROUND_OPTIONS } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { generateHeights } from '../sim/terrain.js';
import { PHASE } from '../sim/Simulation.js';
import Background from '../objects/Background.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Hud from '../objects/Hud.js';

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
    this.lanIp = data.lanIp || null;
    this.spectator = !!data.spectator;
    this.queuePos = data.queue || 0;
    this.mode = this.spectator ? 'spectating' : 'lobby';
    this.roundsIndex = 1;
    this.biomeIndex = 0;
    this.biomeChooser = 0;
    this.roster = [
      { name: null, connected: false },
      { name: null, connected: false },
    ];
    this.lastBanner = '';
    this.seed = -1;
    this.wind = 0;
    this.endShown = false;
    this.unsubs = [];
  }

  create() {
    this.client = this.registry.get('client');
    this.sfx = this.registry.get('sfx');
    this.quality = this.registry.get('quality') || 'full';

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
        isBiomeChooser: m.isBiomeChooser,
      }),
    ));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      if (this.badge) this.badge.remove();
    });
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

    add(this.text(cx, 64, 'TOWER DUEL', 60, COLORS.hud, true));
    add(this.text(cx, 138, 'Join from your phone', 24, COLORS.hudDim));
    add(this.add.text(cx, 220, this.code.split('').join(' '), {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '92px', color: COLORS.hud, fontStyle: 'bold',
    }).setOrigin(0.5));

    this.buildQr(cx, 400);

    this.biomeInfo = add(this.text(cx, 540, '', 26, COLORS.hudDim));
    this.roundsText = add(
      this.add
        .text(cx, 584, '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '28px', color: COLORS.hud })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.cycleRounds()),
    );
    this.rosterText = add(this.text(cx, 632, '', 24, COLORS.hudDim));
    this.statusText = add(this.text(cx, 678, 'Waiting for players…', 26, COLORS.hudDim));

    this.refreshLobby();
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
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && this.lanIp) {
      hostname = this.lanIp;
    }
    const port = loc.port ? `:${loc.port}` : '';
    return `${loc.protocol}//${hostname}${port}/?code=${this.code}`;
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

  cycleRounds() {
    this.roundsIndex = (this.roundsIndex + 1) % ROUND_OPTIONS.length;
    this.sfx.blip(620);
    this.client.send('config', { rounds: ROUND_OPTIONS[this.roundsIndex] });
    this.refreshLobby();
  }

  refreshLobby() {
    if (this.mode !== 'lobby') return;
    const biome = BIOMES[this.biomeIndex] || BIOMES[0];
    const chooser = this.roster[this.biomeChooser]?.name || `Player ${this.biomeChooser + 1}`;
    this.biomeInfo.setText(`Biome: ${biome.name}  (chosen by ${chooser})`);
    this.roundsText.setText(`◀ ${ROUND_OPTIONS[this.roundsIndex]} rounds ▶`);

    const slot = (p, i) => (p.connected ? `P${i + 1}: ${p.name}` : `P${i + 1}: waiting…`);
    this.rosterText.setText(`${slot(this.roster[0], 0)}     ${slot(this.roster[1], 1)}`);
    this.statusText.setText(
      this.roster[0].connected && this.roster[1].connected
        ? 'Starting…'
        : 'Match starts when both players join',
    );
  }

  // --- spectator intro -----------------------------------------------------

  buildSpectatorIntro() {
    this.lobby = [this.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Spectating — waiting for the match…', 30, COLORS.hudDim)];
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

  // --- roster / snapshots --------------------------------------------------

  onRoster(m) {
    this.roster = m.players;
    this.biomeChooser = m.biomeChooser ?? 0;
    if (m.config) {
      this.biomeIndex = Math.max(0, BIOMES.findIndex((b) => b.id === m.config.biomeId));
      this.roundsIndex = Math.max(0, ROUND_OPTIONS.indexOf(m.config.rounds));
    }
    if (this.mode === 'lobby') this.refreshLobby();
  }

  onSnapshot(m) {
    // A fresh match started after a finished one (the loser may have changed
    // the biome): rebuild the scene cleanly.
    if (this.endShown && m.state.phase !== PHASE.MATCH_END) {
      this.scene.restart({
        code: this.code,
        lanIp: this.lanIp,
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
    this.background = new Background(this, biome, this.quality);

    this.terrain = new Terrain(this, biome.terrain);
    this.loadTerrain(state.seed);

    this.towers = [
      new Tower(this, 120, state.towers[0].groundY, COLORS.towerP1, 1),
      new Tower(this, GAME_WIDTH - 120, state.towers[1].groundY, COLORS.towerP2, -1),
    ];
    this.towers.forEach((t) => t.gfx.setDepth(1));

    this.createEmitters();
    this.shotGfx = this.add.graphics().setDepth(5);
    this.projTrails = new Map();
    this.hud = new Hud(this, state.names, [COLORS.towerP1, COLORS.towerP2]);
  }

  loadTerrain(seed) {
    this.seed = seed;
    this.terrain.setHeights(generateHeights(seed, this.biome.roughness ?? 1));
  }

  createEmitters() {
    const opts = (extra) => ({ emitting: false, ...extra });
    this.flashEmitter = this.add.particles(0, 0, 'flash', opts({ lifespan: 220, scale: { start: 1.4, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD' })).setDepth(6);
    this.sparkEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 250, max: 650 }, speed: { min: 90, max: 340 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 420, blendMode: 'ADD' })).setDepth(6);
    this.debrisEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 400, max: 950 }, speed: { min: 60, max: 280 }, angle: { min: 190, max: 350 }, scale: { start: 1.3, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 700, tint: this.biome.terrain.dark })).setDepth(6);
    this.smokeEmitter = this.add.particles(0, 0, 'smoke', opts({ lifespan: { min: 500, max: 1100 }, speed: { min: 10, max: 60 }, scale: { start: 0.6, end: 2.4 }, alpha: { start: 0.45, end: 0 } })).setDepth(6);
  }

  update(_time, delta) {
    if (this.mode !== 'match') return;
    const dt = Math.min(delta / 1000, 0.05);
    this.background.update(dt);
  }

  renderState(state) {
    this.wind = state.wind;
    this.background.setWind(state.wind);

    if (state.seed !== this.seed) this.loadTerrain(state.seed);

    this.towers.forEach((t, i) => {
      const ts = state.towers[i];
      t.groundY = ts.groundY;
      t.pivotY = ts.groundY - 96;
      t.angle = ts.angle;
      t.power = ts.power;
      t.draw();
    });

    this.hud.updateScores(state.scores);
    this.hud.updateRound(state.round.current, state.round.total);
    this.hud.updateWind({ value: state.wind });
    this.hud.updateStatus(state.towers);

    this.drawProjectiles(state.projectiles);

    if (state.banner && state.banner !== this.lastBanner) this.hud.showBanner(state.banner);
    this.lastBanner = state.banner;

    if (state.phase === PHASE.MATCH_END && !this.endShown) this.showEnd(state);
  }

  drawProjectiles(projectiles) {
    const active = new Set(projectiles.map((p) => p.id));
    for (const id of this.projTrails.keys()) {
      if (!active.has(id)) this.projTrails.delete(id);
    }
    for (const p of projectiles) {
      const tr = this.projTrails.get(p.id) || [];
      tr.push({ x: p.x, y: p.y });
      if (tr.length > 34) tr.shift();
      this.projTrails.set(p.id, tr);
    }

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
        this.explode(e.x, e.y, this.biome.terrain.edge, false);
      } else if (e.type === 'hit') {
        this.explode(e.x, e.y, e.target === 0 ? COLORS.towerP1 : COLORS.towerP2, true);
      }
    }
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
      this.sfx.hit();
      this.shake(260, 0.012);
    } else {
      this.sparkEmitter.emitParticleAt(x, y, lite ? 4 : 8);
      this.sfx.explosion();
      this.shake(150, 0.006);
    }
  }

  showEnd(state) {
    this.endShown = true;
    const cx = GAME_WIDTH / 2;
    const [s1, s2] = state.scores;
    let title;
    if (s1 > s2) title = `${state.names[0]} wins!`;
    else if (s2 > s1) title = `${state.names[1]} wins!`;
    else title = "It's a draw!";

    this.endGroup = [
      this.add.text(cx, GAME_HEIGHT * 0.42, title, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '78px', color: COLORS.hud, fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(1001),
      this.add.text(cx, GAME_HEIGHT * 0.56, `${s1} — ${s2}`, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '48px', color: COLORS.hud }).setOrigin(0.5).setDepth(1001),
      this.add.text(cx, GAME_HEIGHT * 0.7, 'Players choose to play again on their device', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '26px', color: COLORS.hudDim }).setOrigin(0.5).setDepth(1001),
    ];
  }
}
