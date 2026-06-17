import Phaser from 'phaser';

import { COLORS, SHIELD, MAX_WIND, GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { PHASE } from '../sim/Simulation.js';
import { generateHeights } from '../sim/terrain.js';
import { intToCss } from '../render/visuals.js';
import Background from '../objects/Background.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Sfx from '../systems/Sfx.js';
import LocalServer from '../net/LocalServer.js';
import LocalClient from '../net/LocalClient.js';
import ControllerScene from './ControllerScene.js';

// Two-players-on-one-screen mode. A single in-process LocalServer drives one
// authoritative Simulation; two ControllerScene pads (loopback clients) sit in
// the bottom half, and THIS scene renders the battlefield in the top band. The
// Phaser canvas is FIT-scaled into a resized #game parent, so shrinking the
// battlefield is just a CSS resize — no camera gymnastics. Nothing here touches
// the networked TvScene/Room, so online play is unaffected.
const PAD_KEYS = ['LocalPadA', 'LocalPadB'];
const STEP_DT = 0.033;       // fixed sim step — matches the server's 33 ms tick
const MAX_STEPS = 6;         // cap catch-up per frame (no spiral of death after a stall)
const INIT_FRACTION = 0.56;  // the divider starts here (battlefield share of the height)
const DIVIDER_H = 10;        // grab-bar thickness, px
const MIN_ZONE = 120;        // each zone keeps at least this many px
const PAD_SCALE = 0.44;      // a full-viewport pad shrunk to fit a bottom half

export default class LocalScene extends Phaser.Scene {
  constructor() {
    super('Local');
  }

  init(data) {
    this.names = data?.names || ['Player 1', 'Player 2'];
    this.acc = 0;
    this.synced = false;
    this.seed = null;
    this.biomeId = null;
    this.built = false;
    this.roundNo = 0;
    this.lastDestroyed = 1; // direction seed for the first inter-round pan
    this.panActive = false;
    this._warmBiomeId = null;   // biome the setup screen has pre-built the battlefield for
    this._warmBackground = null;
    this._warmTerrain = null;
  }

  create() {
    this.server = new LocalServer(this.names);
    this.tv = new LocalClient(this.server, 'tv');
    this.unsubs = [
      this.tv.on('snapshot', (m) => this.onSnapshot(m.state, m.events)),
      this.tv.on('roster', (m) => this.onRoster(m)),
    ];

    // Three independent audio sources (this is a dev/test harness): each pad gets
    // its OWN Sfx instance so P1/P2 can be muted separately, plus a battlefield
    // bus reserved for any shared-screen audio. AudioContexts are lazy + need a
    // gesture, so unlock all three on the first interaction.
    this.bfSfx = new Sfx();
    this.padSfx = [new Sfx(), new Sfx()];
    this.audioUnlock = () => [this.bfSfx, ...this.padSfx].forEach((s) => s.unlock());
    window.addEventListener('pointerdown', this.audioUnlock, { once: true });

    this.shieldGfx = this.add.graphics().setDepth(3);
    this.shieldFx = [null, null];     // per-tower eased render state {x,y,ux,uy,appear,open}
    this.shieldTarget = [null, null]; // latest authoritative shield (or null)
    this.projGfx = this.add.graphics().setDepth(5);

    this.layoutDom();
    this.spawnPads();
    this.buildDevBar();

    this.escHandler = (e) => { if (e.key === 'Escape') this.exit(); };
    window.addEventListener('keydown', this.escHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // --- DOM split layout ----------------------------------------------------
  // Battlefield: #game kept at FULL-WINDOW size so its FIT scale equals the very
  // first render (full width) and never changes; it is centred inside a movable,
  // overflow-hidden zone, so the divider only reveals/clips more of that fixed-
  // scale picture — it never rescales it. Remotes: two half-width wrappers,
  // content top-aligned + clipped. The off-zone parts are simply masked.
  layoutDom() {
    const H = window.innerHeight;
    this.dividerPx = Math.round(H * INIT_FRACTION);

    this.gameDiv = document.getElementById('game');
    this.gameHome = this.gameDiv?.parentElement || document.body;
    this.gameCss = this.gameDiv ? this.gameDiv.style.cssText : '';

    this.bfZone = document.createElement('div');
    this.bfZone.style.cssText =
      `position:fixed;left:0;top:0;width:100vw;height:${this.dividerPx}px;overflow:hidden;background:#0b1020;`
      + 'display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(this.bfZone);
    if (this.gameDiv) {
      // Centre the canvas with flexbox and turn OFF Phaser's own autoCenter, which
      // mis-aligns after the reparent. #game stays FULL-WINDOW (100vw x 100vh) so
      // Phaser's FIT scale equals the first render and any later (deferred) refresh
      // recomputes the same value — no scale jump. Flex centres it H+V; the zone's
      // overflow:hidden clips whatever falls outside the band.
      this.prevAutoCenter = this.scale.autoCenter;
      this.scale.autoCenter = Phaser.Scale.NO_CENTER;
      this.gameDiv.style.cssText =
        'flex:none;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;';
      this.bfZone.appendChild(this.gameDiv);
      this.scale.refresh(); // applies NO_CENTER; scale stays full-window
    }

    const mkWrap = (left) => {
      const w = document.createElement('div');
      w.className = 'tp-localpad';
      w.style.cssText = `position:fixed;left:${left};width:50vw;overflow:hidden;background:#0b1020;`;
      document.body.appendChild(w);
      return w;
    };
    this.wraps = [mkWrap('0'), mkWrap('50vw')];

    // Draggable divider (editor-style).
    this.divider = document.createElement('div');
    this.divider.style.cssText =
      `position:fixed;left:0;width:100vw;height:${DIVIDER_H}px;z-index:20;cursor:row-resize;`
      + 'background:#1b2740;display:flex;align-items:center;justify-content:center;touch-action:none;';
    this.divider.innerHTML = '<div style="width:54px;height:4px;border-radius:3px;background:#5b7fbf;"></div>';
    document.body.appendChild(this.divider);

    this.dragging = false;
    this.onDragStart = (e) => { this.dragging = true; e.preventDefault(); };
    this.onDragMove = (e) => {
      if (!this.dragging) return;
      this.setDivider(e.touches ? e.touches[0].clientY : e.clientY);
    };
    this.onDragEnd = () => { this.dragging = false; };
    this.divider.addEventListener('pointerdown', this.onDragStart);
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);

    this.setDivider(this.dividerPx);
  }

  // Move the boundary: resize the clip windows only — the frozen #game and the
  // scaled pads are left untouched, so neither rescales.
  setDivider(px) {
    const H = window.innerHeight;
    this.dividerPx = Math.max(MIN_ZONE, Math.min(H - MIN_ZONE, px));
    this.bfZone.style.height = `${this.dividerPx}px`;
    this.divider.style.top = `${this.dividerPx - DIVIDER_H / 2}px`;
    const remoteH = H - this.dividerPx;
    this.wraps.forEach((w) => { w.style.top = `${this.dividerPx}px`; w.style.height = `${remoteH}px`; });
  }

  spawnPads() {
    PAD_KEYS.forEach((key, i) => {
      const client = new LocalClient(this.server, i);
      this.scene.add(key, new ControllerScene(key), true, {
        player: i,
        name: this.names[i],
        isConfigOwner: i === 0,
        localClient: client,
        localSfx: this.padSfx[i],
        embed: { container: this.wraps[i], scale: PAD_SCALE },
      });
    });
  }

  // --- dev overlay: live scoreboard + per-source audio mutes ---------------
  // Rendered as DOM pinned to the TOP of the battlefield zone, so it stays visible
  // however the divider clips the canvas (the real Phaser Hud sits at canvas-top
  // and would be cut off by the centred band). It faithfully reproduces the server
  // scoreboard: a dark bezelled card with two name+win-pip columns framing a
  // central amber wind gauge.
  buildDevBar() {
    const GW = 120; // wind-gauge track width (px), matches the server gauge feel
    const col = (align) => {
      const d = document.createElement('div');
      d.style.cssText = `display:flex;flex-direction:column;align-items:${align};gap:3px;`;
      return d;
    };
    const mkName = (color, align) => {
      const e = document.createElement('div');
      e.style.cssText = `font:bold 18px 'Trebuchet MS',sans-serif;color:${intToCss(color)};text-align:${align};`;
      return e;
    };
    const mkPips = () => {
      const e = document.createElement('div');
      e.style.cssText = "font-size:14px;line-height:1;letter-spacing:3px;font-family:'Trebuchet MS',sans-serif;";
      return e;
    };

    const card = document.createElement('div');
    card.style.cssText =
      'position:absolute;top:6px;left:50%;transform:translateX(-50%);z-index:15;pointer-events:none;'
      + 'display:flex;align-items:center;gap:18px;padding:7px 18px;white-space:nowrap;'
      + 'background:rgba(10,16,32,0.74);border:2px solid rgba(255,255,255,0.13);border-radius:14px;';

    // Left column: P1 name + pips.
    const left = col('flex-start');
    this.elName0 = mkName(COLORS.towerP1, 'left');
    this.elPips0 = mkPips();
    left.append(this.elName0, this.elPips0);

    // Centre column: WIND label, gauge track (centre-anchored fill + tick), readout.
    const centre = col('center');
    const wlabel = document.createElement('div');
    wlabel.textContent = 'WIND';
    wlabel.style.cssText = "font:bold 10px 'Trebuchet MS',sans-serif;letter-spacing:1px;color:#f0d79b;";
    const track = document.createElement('div');
    track.style.cssText = `position:relative;width:${GW}px;height:8px;border-radius:4px;background:rgba(255,255,255,0.12);`;
    this.elWindFill = document.createElement('div');
    this.elWindFill.style.cssText = 'position:absolute;top:0;height:8px;background:#f5c451;width:0;left:50%;';
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;top:0;left:${GW / 2 - 1}px;width:2px;height:8px;background:rgba(255,255,255,0.45);`;
    track.append(this.elWindFill, tick);
    this.elWindText = document.createElement('div');
    this.elWindText.style.cssText = "font:bold 13px 'Trebuchet MS',sans-serif;color:#f5c451;";
    centre.append(wlabel, track, this.elWindText);
    this._gaugeHalf = GW / 2;

    // Right column: P2 name + pips.
    const right = col('flex-end');
    this.elName1 = mkName(COLORS.towerP2, 'right');
    this.elPips1 = mkPips();
    right.append(this.elName1, this.elPips1);

    card.append(left, centre, right);
    this.bfZone.appendChild(card);
    this.devBar = card;

    // Audio mutes — a separate dev cluster in the corner, not part of the scoreboard.
    const mutes = document.createElement('div');
    mutes.style.cssText = 'position:absolute;top:8px;right:10px;z-index:16;display:flex;gap:6px;pointer-events:auto;';
    const mk = (label, sfx) => {
      const b = document.createElement('button');
      b.style.cssText =
        "font:600 12px/1 'Trebuchet MS',sans-serif;padding:5px 8px;border-radius:7px;"
        + 'border:1px solid #3a4a66;background:#16203a;color:#cdd6e6;cursor:pointer;';
      const render = () => { b.textContent = `${sfx.enabled ? '🔊' : '🔇'} ${label}`; b.style.opacity = sfx.enabled ? '1' : '0.45'; };
      render();
      b.addEventListener('click', () => { sfx.toggle(); render(); });
      return b;
    };
    mutes.append(mk('BF', this.bfSfx), mk('P1', this.padSfx[0]), mk('P2', this.padSfx[1]));
    this.bfZone.appendChild(mutes);
    this.muteBar = mutes;

    this.renderScore();
  }

  // Update the live scoreboard from a snapshot: coloured names, win-pips (filled =
  // rounds won, hollow = still to play, count = first-to-N) and the wind gauge.
  renderScore(state) {
    if (!this.devBar) return;
    const names = state?.names || this.names;
    const scores = state?.scores || [0, 0];
    const wins = state?.round?.total || 0;
    const windV = state?.wind ?? 0;

    this.elName0.textContent = names[0];
    this.elName1.textContent = names[1];

    const pips = (score, color, reverse) => {
      const dots = [];
      for (let i = 0; i < wins; i += 1) {
        const filled = i < score;
        dots.push(`<span style="color:${filled ? intToCss(color) : '#3a4a66'}">${filled ? '●' : '○'}</span>`);
      }
      if (reverse) dots.reverse();
      return dots.join('');
    };
    this.elPips0.innerHTML = pips(scores[0], COLORS.towerP1, false);
    this.elPips1.innerHTML = pips(scores[1], COLORS.towerP2, true);

    // Centre-anchored gauge: fill grows from the middle toward the wind direction.
    // Round only the outer end so the fill stays flush against the centre tick —
    // rounding the centre side would detach it into a lens/circle at low force.
    const ratio = Math.min(Math.abs(windV) / MAX_WIND, 1);
    const len = this._gaugeHalf * ratio;
    const r = Math.min(4, len);
    this.elWindFill.style.width = `${len}px`;
    this.elWindFill.style.left = windV >= 0 ? `${this._gaugeHalf}px` : `${this._gaugeHalf - len}px`;
    this.elWindFill.style.borderRadius = windV >= 0 ? `0 ${r}px ${r}px 0` : `${r}px 0 0 ${r}px`;
    this.elWindFill.style.opacity = len > 0.5 ? '1' : '0';
    const arrow = windV === 0 ? '·' : windV > 0 ? '→' : '←';
    this.elWindText.textContent = `${Math.round(ratio * 100)}% ${arrow}`;
  }

  // Per-round arena shape from the authoritative state: platform heights ride on
  // the transmitted tower groundY, the central massif is a per-biome knob. Keeps
  // the rendered ground in step with the (now variable) platform heights.
  terrainOpts(state) {
    return {
      leftY: state.towers[0].groundY,
      rightY: state.towers[1].groundY,
      centralRise: this.biome.centralRise ?? 0,
    };
  }

  // --- battlefield render (mirrors the slice of TvScene we need) -----------
  onSnapshot(state, events) {
    this.renderScore(state);
    if (!this.built || state.biomeId !== this.biomeId) this.buildArena(state);

    if (this.panActive) return; // the pan owns the world during the transition

    // A new round begins (new seed): slide the camera into the next arena.
    if (state.seed !== this.seed) {
      if (state.round.current > this.roundNo) {
        this.startPan(state);
        return;
      }
      // Same-round seed change (a resync): reload terrain in place, no pan.
      this.seed = state.seed;
      this.terrain.setHeights(generateHeights(this.seed, this.biome.roughness ?? 1, this.terrainOpts(state)));
    }
    this.terrain.applyCraters(state.craters); // impact marks (resets with the seed above)

    this.background.setWind(state.wind);
    this.towers.forEach((t, i) => {
      const ts = state.towers[i];
      if (ts.x != null) { t.x = ts.x; t.pivotX = ts.x; } // tower slides per round
      t.groundY = ts.groundY;
      t.pivotY = ts.groundY - 96;
      t.angle = ts.angle;
      t.power = ts.power; // drives the barrel heat-glow (charge readout)
      t.ready = ts.ready && state.phase === PHASE.AIMING; // fuse lit only while aiming
      t.maxHp = state.maxHp || 1;
      t.hp = ts.hp ?? t.maxHp;
      t.draw();
    });

    this.shieldTarget = state.towers.map((t) => t.shield); // eased + drawn in update()

    const g = this.projGfx;
    g.clear();
    for (const p of state.projectiles) {
      g.fillStyle(p.owner === 0 ? COLORS.towerP1 : COLORS.towerP2, 1);
      g.fillCircle(p.x, p.y, 5);
    }

    this.processEvents(events || []);
  }

  // While the pads are still in setup, pre-build the battlefield for the
  // configured biome (hidden) so the first match start doesn't stall (mirrors
  // TvScene). Only the first arena is prewarmed; later biome changes rebuild.
  onRoster(m) {
    if (m.config && m.config.biomeId) this.prewarmArena(m.config.biomeId);
  }

  prewarmArena(biomeId) {
    if (this.built || this._warmBiomeId === biomeId) return;
    this.discardPrewarm();
    const biome = BIOMES.find((b) => b.id === biomeId) || BIOMES[0];
    this._warmBiomeId = biome.id;
    this._warmBackground = new Background(this, biome).setVisible(false);
    this._warmTerrain = new Terrain(this, biome.terrain);
    // Placeholder surface: pays the canvas allocation + texture upload now; the
    // real seeded heightfield is a cheap redraw when the arena is adopted.
    this._warmTerrain.setHeights(generateHeights(0, biome.roughness ?? 1, { centralRise: biome.centralRise ?? 0 }));
    this._warmTerrain.image.setVisible(false);
  }

  discardPrewarm() {
    if (this._warmBackground) { this._warmBackground.destroy(); this._warmBackground = null; }
    if (this._warmTerrain) { this._warmTerrain.destroy(); this._warmTerrain = null; }
    this._warmBiomeId = null;
  }

  buildArena(state) {
    if (this.background) this.background.destroy?.();
    if (this.terrain) this.terrain.destroy?.();
    if (this.towers) this.towers.forEach((t) => t.gfx.destroy());

    this.biome = BIOMES.find((b) => b.id === state.biomeId) || BIOMES[0];
    this.biomeId = state.biomeId;

    // Adopt the prewarmed renderers when the biome matches (first match start);
    // otherwise build fresh.
    if (this._warmBiomeId === this.biomeId && this._warmBackground && this._warmTerrain) {
      this.background = this._warmBackground;
      this.terrain = this._warmTerrain;
      this.background.setVisible(true);
      this.terrain.image.setVisible(true);
      this._warmBackground = null;
      this._warmTerrain = null;
      this._warmBiomeId = null;
    } else {
      this.discardPrewarm();
      this.background = new Background(this, this.biome);
      this.terrain = new Terrain(this, this.biome.terrain);
    }
    this.seed = state.seed;
    this.terrain.setHeights(generateHeights(this.seed, this.biome.roughness ?? 1, this.terrainOpts(state)));
    this.towers = this.buildTowers(state, 0);
    this.createEmitters();
    this.projGfx.setDepth(5);
    this.roundNo = state.round?.current ?? 0;
    this.lastDestroyed = 1;
    this.panActive = false;
    this.cameras.main.setScroll(0, 0);
    this.built = true;
  }

  // Build the two towers at a world offset (used by the camera-pan transition);
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

  // Impact/destruction particle systems, mirrored from TvScene. Re-created per
  // biome (debris/dust tints track the terrain palette), so tear down any prior
  // set first to avoid leaking emitters across an arena rebuild.
  createEmitters() {
    (this._emitters || []).forEach((e) => e.destroy());
    const opts = (extra) => ({ emitting: false, ...extra });
    const t = this.biome.terrain;
    this.flashEmitter = this.add.particles(0, 0, 'flash', opts({ lifespan: 220, scale: { start: 1.4, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD' })).setDepth(6);
    this.sparkEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 250, max: 650 }, speed: { min: 90, max: 340 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 420, blendMode: 'ADD' })).setDepth(6);
    this.debrisEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 400, max: 950 }, speed: { min: 60, max: 280 }, angle: { min: 190, max: 350 }, scale: { start: 1.3, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 700, tint: t.dark })).setDepth(6);
    this.smokeEmitter = this.add.particles(0, 0, 'smoke', opts({ lifespan: { min: 500, max: 1100 }, speed: { min: 10, max: 60 }, scale: { start: 0.6, end: 2.4 }, alpha: { start: 0.45, end: 0 } })).setDepth(6);
    this.dustEmitter = this.add.particles(0, 0, 'smoke', opts({ lifespan: { min: 700, max: 1500 }, speedX: { min: -45, max: 45 }, speedY: { min: -70, max: -18 }, gravityY: 50, scale: { start: 0.5, end: 2.8 }, alpha: { start: 0.55, end: 0 }, tint: t.edge })).setDepth(-1);
    this.gritEmitter = this.add.particles(0, 0, 'spark', opts({ lifespan: { min: 350, max: 800 }, speed: { min: 40, max: 170 }, angle: { min: 200, max: 340 }, gravityY: 640, scale: { start: 0.9, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: t.dark })).setDepth(-1);
    this._emitters = [this.flashEmitter, this.sparkEmitter, this.debrisEmitter, this.smokeEmitter, this.dustEmitter, this.gritEmitter];
  }

  // --- impact / destruction effects (mirrored from TvScene, full quality) ---
  processEvents(events) {
    for (const e of events) {
      if (e.type === 'fire') {
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
        this.sparkEmitter.emitParticleAt(e.x, e.y, 6);
        this.smokeEmitter.emitParticleAt(e.x, e.y, 2);
        this.bfSfx.boom();
        this.cameras.main.shake(110, 0.004);
      } else if (e.type === 'impact') {
        this.dustEmitter.emitParticleAt(e.x, e.y, 9);
        this.gritEmitter.emitParticleAt(e.x, e.y, 11);
        this.bfSfx.explosion();
        this.cameras.main.shake(140, 0.005);
      } else if (e.type === 'hit') {
        this.explode(e.x, e.y, e.target === 0 ? COLORS.towerP1 : COLORS.towerP2);
      } else if (e.type === 'destroyed') {
        this.explodeTower(e.tower);
      } else if (e.type === 'shield') {
        this.bfSfx.shieldUp();
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
      } else if (e.type === 'shieldHit') {
        this.bfSfx.shieldBlock();
        const col = e.owner === 0 ? COLORS.towerP1 : COLORS.towerP2;
        const ring = this.add.circle(e.x, e.y, 6, col, 0.9).setDepth(7);
        this.tweens.add({ targets: ring, radius: 46, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
        this.flashEmitter.emitParticleAt(e.x, e.y, 1);
        this.sparkEmitter.emitParticleAt(e.x, e.y, 14);
        this.cameras.main.shake(150, 0.006);
      }
    }
  }

  explode(x, y, ringColor) {
    const ring = this.add.circle(x, y, 6, ringColor, 0.9).setDepth(7);
    this.tweens.add({ targets: ring, radius: 60, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
    this.flashEmitter.emitParticleAt(x, y, 1);
    this.smokeEmitter.emitParticleAt(x, y, 5);
    this.debrisEmitter.emitParticleAt(x, y, 16);
    this.sparkEmitter.emitParticleAt(x, y, 18);
    this.bfSfx.rubble(false);
    this.cameras.main.shake(260, 0.012);
  }

  // Crumble the destroyed tower: stone debris, a hard shake, and the tower
  // sinking + fading. It is removed shortly after by the inter-round pan.
  explodeTower(i) {
    const t = this.towers[i];
    if (!t || this.panActive) return;
    this.lastDestroyed = i;
    const b = t.bounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    this.flashEmitter.emitParticleAt(cx, cy, 1);
    this.smokeEmitter.emitParticleAt(cx, cy, 7);
    this.debrisEmitter.emitParticleAt(cx, cy, 26);
    this.sparkEmitter.emitParticleAt(cx, cy, 20);
    this.bfSfx.rubble(true);
    this.cameras.main.shake(420, 0.02);
    this.tweens.add({ targets: t.gfx, y: 26, alpha: 0.25, duration: 600, ease: 'Quad.easeIn' });
  }

  // Inter-round camera pan toward the destroyed tower, advancing one screen —
  // the new arena is built one screen over and slid into view.
  startPan(state) {
    this.panActive = true;
    const dir = this.lastDestroyed === 0 ? -1 : 1;
    const ox = dir * GAME_WIDTH;

    const oldTerrain = this.terrain;
    const oldTowers = this.towers;

    const nextTerrain = new Terrain(this, this.biome.terrain);
    nextTerrain.setHeights(generateHeights(state.seed, this.biome.roughness ?? 1, this.terrainOpts(state)));
    nextTerrain.setX(ox);
    const nextTowers = this.buildTowers(state, ox);

    // Clear transient layers so stale shots/shields don't ride along the slide.
    this.projGfx.clear();
    this.shieldTarget = [null, null];

    this.cameras.main.pan(
      GAME_WIDTH / 2 + ox, GAME_HEIGHT / 2, 1100, 'Sine.easeInOut', true,
      (cam, progress) => {
        if (progress < 1) return;
        oldTerrain.destroy();
        oldTowers.forEach((t) => t.destroy());
        nextTerrain.setX(0);
        nextTowers.forEach((t) => { t.x -= ox; t.pivotX -= ox; t.draw(); });
        this.terrain = nextTerrain;
        this.towers = nextTowers;
        this.seed = state.seed;
        this.roundNo = state.round.current;
        this.cameras.main.setScroll(0, 0);
        // Bake the pan into the scenery so the parallax decor stays put instead
        // of snapping back when the scroll resets.
        this.background.shiftWorld(ox);
        this.panActive = false;
      },
    );
  }

  update(_time, delta) {
    if (!this.synced) { this.server.sendRoster(); this.synced = true; } // initial lobby push

    // Advance the sim on a FIXED step so local physics match the authoritative
    // server (33 ms) and a fast shell can't tunnel through terrain on a slow
    // frame. Render/wind smoothing still run once per real frame.
    const frameDt = Math.min(delta / 1000, 0.1);
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= STEP_DT && steps < MAX_STEPS) { this.server.step(STEP_DT); this.acc -= STEP_DT; steps += 1; }
    if (this.acc > STEP_DT) this.acc = 0; // shed the backlog after a long stall

    const renderDt = Math.min(frameDt, 0.05);
    if (this.background) this.background.update(renderDt);
    this.animateShields(renderDt);
  }

  // Eased deflector-plate render, mirrored from the TV: each tower's shield grows
  // in on deploy, opens a centre gap when its owner fires through it, and fades on
  // shatter / round end.
  animateShields(dt) {
    const g = this.shieldGfx;
    if (!g) return;
    g.clear();
    const k = Math.min(1, dt * 12);
    for (let i = 0; i < 2; i += 1) {
      const target = this.shieldTarget?.[i] || null;
      let fx = this.shieldFx[i];
      if (target) {
        if (!fx) fx = this.shieldFx[i] = { x: target.x, y: target.y, ux: target.ux, uy: target.uy, appear: 0, open: target.open ? 1 : 0 };
        fx.x = target.x; fx.y = target.y; fx.ux = target.ux; fx.uy = target.uy;
        fx.appear += (1 - fx.appear) * k;
        fx.open += ((target.open ? 1 : 0) - fx.open) * Math.min(1, dt * 16);
      } else if (fx) {
        fx.appear += (0 - fx.appear) * k;
        if (fx.appear < 0.03) { this.shieldFx[i] = null; continue; }
      } else {
        continue;
      }
      const col = i === 0 ? COLORS.towerP1 : COLORS.towerP2;
      const half = SHIELD.plateHalf * fx.appear;
      const gap = fx.open * 13;
      const alpha = Math.max(0, fx.appear) * (1 - 0.45 * fx.open);
      const ux = fx.ux; const uy = fx.uy;
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

  // --- exit / cleanup ------------------------------------------------------
  exit() {
    this.scene.start('Lobby', { auto: null });
  }

  teardown() {
    this.discardPrewarm(); // drop an unconsumed setup-phase prewarm (frees its canvas texture)
    this.unsubs?.forEach((off) => off());
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    if (this.audioUnlock) window.removeEventListener('pointerdown', this.audioUnlock);
    if (this.onDragMove) window.removeEventListener('pointermove', this.onDragMove);
    if (this.onDragEnd) window.removeEventListener('pointerup', this.onDragEnd);
    PAD_KEYS.forEach((k) => { if (this.scene.get(k)) this.game.scene.remove(k); });
    // Release the per-source AudioContexts so re-entering the mode doesn't leak them.
    [this.bfSfx, ...(this.padSfx || [])].forEach((s) => { try { s?.ctx?.close(); } catch { /* already closed */ } });
    this.wraps?.forEach((w) => w.remove());
    this.divider?.remove();
    // Restore #game + Phaser's autoCenter to their normal-play state before
    // dropping the zone.
    if (this.gameDiv) {
      this.gameHome.appendChild(this.gameDiv);
      this.gameDiv.style.cssText = this.gameCss || '';
    }
    if (this.prevAutoCenter !== undefined) this.scale.autoCenter = this.prevAutoCenter;
    this.scale.refresh();
    this.bfZone?.remove();
  }
}
