import Phaser from 'phaser';
import QRCode from 'qrcode';

import { GAME_WIDTH, GAME_HEIGHT, COLORS, ROUND_OPTIONS, GAME_MODES } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { generateHeights } from '../sim/terrain.js';
import { PHASE } from '../sim/Simulation.js';
import Background from '../objects/Background.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Hud from '../objects/Hud.js';
import { computeWindsock } from '../render/visuals.js';
import { runBenchmark } from '../systems/benchmark.js';

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
    this.publicHost = data.publicHost || null;
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
        isBiomeChooser: m.isBiomeChooser,
      }),
    ));

    // Ask the server for the current roster (needed after a scene restart, e.g.
    // returning to the lobby when a player left mid-match).
    this.client.send('sync');

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

    if (this.textures.exists('logo')) {
      add(this.add.image(cx, 58, 'logo').setOrigin(0.5).setDisplaySize(78, 78));
    }
    add(this.text(cx, 130, 'TOWER DUEL', 58, COLORS.hud, true));
    add(this.text(cx, 182, 'Join from your phone', 24, COLORS.hudDim));
    add(this.add.text(cx, 250, this.code.split('').join(' '), {
      fontFamily: 'Trebuchet MS, sans-serif', fontSize: '88px', color: COLORS.hud, fontStyle: 'bold',
    }).setOrigin(0.5));

    this.buildQr(cx, 420);

    this.biomeInfo = add(this.text(cx, 566, '', 26, COLORS.hudDim));
    this.rosterText = add(this.text(cx, 620, '', 24, COLORS.hudDim));
    this.statusText = add(this.text(cx, 672, 'Waiting for players…', 26, COLORS.hudDim));

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
    // An explicit PUBLIC_HOST override always wins; otherwise only swap a
    // loopback host for the detected LAN IP (the URL the TV used works as-is).
    if (this.publicHost) {
      hostname = this.publicHost;
    } else if ((hostname === 'localhost' || hostname === '127.0.0.1') && this.lanIp) {
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

  refreshLobby() {
    if (this.mode !== 'lobby') return;
    const biome = BIOMES[this.biomeIndex] || BIOMES[0];
    const rounds = ROUND_OPTIONS[this.roundsIndex];
    const hp = this.cfgHp || 1;
    const mode = this.cfgMode || 'Classic';
    const chooser = this.roster[this.biomeChooser]?.name || `Player ${this.biomeChooser + 1}`;
    this.biomeInfo.setText(`${biome.name} · ${rounds} rounds · ${hp} HP · ${mode}  (set by ${chooser})`);

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

  // --- roster / snapshots --------------------------------------------------

  onRoster(m) {
    this.roster = m.players;
    this.biomeChooser = m.biomeChooser ?? 0;
    if (m.config) {
      this.biomeIndex = Math.max(0, BIOMES.findIndex((b) => b.id === m.config.biomeId));
      this.roundsIndex = Math.max(0, ROUND_OPTIONS.indexOf(m.config.rounds));
      this.cfgHp = m.config.hp || 1;
      const mode = GAME_MODES.find((g) => g.turbo === m.config.turbo && (!g.turbo || g.cadence === m.config.cadence));
      this.cfgMode = mode ? mode.label : 'Classic';
    }
    if (this.mode === 'lobby') this.refreshLobby();
    // A player went missing mid-match: the room reset to the invitation lobby,
    // so rebuild this scene back to the code + QR screen.
    else if ((this.mode === 'match' || this.mode === 'end') && !m.inMatch) {
      this.scene.restart({ code: this.code, lanIp: this.lanIp, publicHost: this.publicHost, spectator: this.spectator, queue: this.queuePos });
    }
  }

  onSnapshot(m) {
    // A fresh match started after a finished one (the loser may have changed
    // the biome): rebuild the scene cleanly.
    if (this.endShown && m.state.phase !== PHASE.MATCH_END) {
      this.scene.restart({
        code: this.code,
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
    this.background = new Background(this, biome, this.quality);

    this.terrain = new Terrain(this, biome.terrain);
    this.loadTerrain(state.seed);

    this.towers = this.buildTowers(state, 0);
    this.windsockGfx = this.add.graphics().setDepth(2);

    this.createEmitters();
    this.shotGfx = this.add.graphics().setDepth(5);
    this.projTrails = new Map();
    this.hud = new Hud(this, state.names, [COLORS.towerP1, COLORS.towerP2], {
      code: this.code,
      joinUrl: this.joinUrl(),
    });

    this.roundNo = state.round.current;
    this.lastDestroyed = 1;
    this.panActive = false;
    this.cameras.main.setScroll(0, 0);
  }

  // Create the two towers at a world offset (used by the camera-pan transition).
  buildTowers(state, ox) {
    const towers = [
      new Tower(this, 120 + ox, state.towers[0].groundY, COLORS.towerP1, 1),
      new Tower(this, GAME_WIDTH - 120 + ox, state.towers[1].groundY, COLORS.towerP2, -1),
    ];
    towers.forEach((t, i) => {
      t.gfx.setDepth(1);
      t.maxHp = state.maxHp || 1;
      t.hp = state.towers[i].hp ?? t.maxHp;
      t.draw();
    });
    return towers;
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
    if (this.panActive) return;
    this.drawMidWindsock(_time);
    // Spark the fuse of any ready cannon.
    if (this.towers && this.fuseSpark) {
      for (const t of this.towers) {
        if (t.ready) {
          const f = t.fuseTip;
          this.fuseSpark.emitParticleAt(f.x, f.y, 1);
        }
      }
    }
  }

  // A windsock planted in the middle of the battlefield (#1), driven by the
  // eased wind so it matches the particles.
  drawMidWindsock(time) {
    const g = this.windsockGfx;
    if (!g) return;
    g.clear();
    const x = GAME_WIDTH / 2;
    const baseY = this.terrain.heightAt(x);
    const ws = computeWindsock(x, baseY, this.background.windValue, time, 46);
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
      this.loadTerrain(state.seed);
    }
    this.terrain.applyCraters(state.craters);

    this.towers.forEach((t, i) => {
      const ts = state.towers[i];
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

    this.drawProjectiles(state.projectiles);
  }

  // Inter-round camera pan toward the destroyed tower, advancing one screen.
  startPan(state) {
    this.panActive = true;
    const dir = this.lastDestroyed === 0 ? -1 : 1;
    const ox = dir * GAME_WIDTH;

    const oldTerrain = this.terrain;
    const oldTowers = this.towers;

    const nextTerrain = new Terrain(this, this.biome.terrain);
    nextTerrain.setHeights(generateHeights(state.seed, this.biome.roughness ?? 1));
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
        this.projTrails = new Map();
        this.panActive = false;
      },
    );
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
        this.dustExplosion(e.x, e.y);
      } else if (e.type === 'hit') {
        this.explode(e.x, e.y, e.target === 0 ? COLORS.towerP1 : COLORS.towerP2, true);
      } else if (e.type === 'destroyed') {
        this.explodeTower(e.tower);
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

  // Crumble the destroyed tower (#10): a burst of stone debris, hard shake, and
  // the tower sinking and fading. It is removed shortly after by the round pan.
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
    this.tweens.add({ targets: t.gfx, y: 26, alpha: 0.25, duration: 600, ease: 'Quad.easeIn' });
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
