import Phaser from 'phaser';

import { COLORS, AIM, MAX_WIND, ROUND_OPTIONS, HP_OPTIONS, GAME_MODES } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { SHELLS } from '../config/shells.js';
import { PHASE } from '../sim/Simulation.js';
import { injectStyles } from './LobbyScene.js';
import { drawTowerTop } from '../ui/towerTop.js';
import { intToCss, shade } from '../render/visuals.js';

// Phone/tablet controller. Full-viewport responsive overlay, themed to the
// current biome. Aiming is graphical: drag on the tower view to set the angle
// (direction) and power (distance). Also: shell picker, biome/round picker for
// the chooser, haptic + audio feedback, and an over-the-top end-of-match
// cracktro. The server runs the match; this only sends intents.
export default class ControllerScene extends Phaser.Scene {
  constructor() {
    super('Controller');
  }

  init(data) {
    this.player = data.player;
    this.code = data.code;
    this.name = data.name || `Player ${data.player + 1}`;
    this.facing = this.player === 0 ? 1 : -1;
    this.ownTowerX = this.player === 0 ? 120 : 1280 - 120;
    this.color = this.player === 0 ? COLORS.towerP1 : COLORS.towerP2;
    this.biomeChooser = data.isBiomeChooser ? this.player : -1;
    this.biomeIndex = 0;
    this.roundsIndex = 1;
    this.hpIndex = 0;
    this.modeIndex = 0;
    this.shellIndex = 0;
    this.shotClock = null;
    this.serverReady = false;
    this.inMatch = false;
    this.postmatch = false;
    this.phase = null;
    this.prevPhase = null;
    this.locked = false;
    this.wind = 0;
    this.flash = 0;
    this.aimAngle = 45;
    this.aimPower = (AIM.minPower + AIM.maxPower) / 2;
    this.cracktro = null;
    this.ammo = { heavy: 1, light: 1, salvo: 1, explosive: 1 };
    this.roundCur = 0;
    this.hitsTaken = 0; // own-tower hits this round (drives escalating vibration)
    this.lastVibe = 0;
    this.unsubs = [];
  }

  create() {
    this.client = this.registry.get('client');
    this.sfx = this.registry.get('sfx');
    const hex = `#${this.color.toString(16).padStart(6, '0')}`;

    injectStyles();
    injectControllerStyles();

    const overlay = document.createElement('div');
    overlay.className = 'tp-overlay tp-ctl';
    overlay.style.setProperty('--accent', hex);
    overlay.innerHTML = `
      <div class="tp-ctl-card">
        <header>
          <img class="tp-logo-sm" src="icon.svg" alt="" />
          <input id="name" maxlength="12" value="${escapeHtml(this.name)}" />
          <span class="room">Room ${this.code}</span>
        </header>
        <div id="info"></div>

        <div id="biome" hidden>
          <div class="row"><button id="biomeL">◀</button><span id="biomeName"></span><button id="biomeR">▶</button></div>
          <div class="row"><button id="roundsL">◀</button><span id="roundsName"></span><button id="roundsR">▶</button></div>
          <div class="row"><button id="hpL">◀</button><span id="hpName"></span><button id="hpR">▶</button></div>
          <div class="row"><button id="modeL">◀</button><span id="modeName"></span><button id="modeR">▶</button></div>
          <div class="hint">You set the biome, rounds, health and mode</div>
        </div>

        <canvas id="ttv"></canvas>

        <div id="controls" hidden>
          <div id="readout">Angle 45° · Power 50%</div>
          <div id="shells" class="shellrow">${SHELLS.map((s, i) => `<button data-shell="${i}" title="${s.name}"><b class="ct"></b><svg viewBox="0 0 24 24" fill="currentColor">${s.svg}</svg><span>${s.name}</span></button>`).join('')}</div>
          <button id="fire">VALIDATE SHOT</button>
          <div id="status"></div>
        </div>

        <canvas id="fx" hidden></canvas>
        <div id="post" hidden>
          <button id="again">Play again</button>
          <button id="leave" class="ghost">Disconnect</button>
        </div>
      </div>`;
    this.overlay = overlay;
    document.body.appendChild(overlay);
    this.$ = (id) => overlay.querySelector(`#${id}`);

    this.canvas = this.$('ttv');
    this.ctx = this.canvas.getContext('2d');
    this.fx = this.$('fx');
    this.fxc = this.fx.getContext('2d');

    this.wireEvents();
    this.startRenderLoop();

    this.track(this.client.on('roster', (m) => this.onRoster(m)));
    this.track(this.client.on('snapshot', (m) => this.onSnapshot(m)));
    this.track(this.client.on('demoted', (m) =>
      this.scene.start('Tv', { spectator: true, code: this.code, queue: m.queue }),
    ));
    this.track(this.client.on('close', () => { this.$('info').textContent = 'Disconnected'; }));

    this.applyBiome();
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      if (this.raf) cancelAnimationFrame(this.raf);
      this.sfx.flyby(0);
      overlay.remove();
    });
  }

  track(off) { this.unsubs.push(off); }

  wireEvents() {
    let nameTimer = 0;
    this.$('name').addEventListener('input', () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        this.name = this.$('name').value.trim() || `Player ${this.player + 1}`;
        this.client.send('name', { name: this.name });
      }, 300);
    });

    // Graphical aim: drag on the tower view.
    const pointer = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const py = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      this.setAimFromPoint(px, py, r.width, r.height);
      e.preventDefault();
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; pointer(e); });
    this.canvas.addEventListener('pointermove', (e) => { if (dragging) pointer(e); });
    window.addEventListener('pointerup', () => { dragging = false; });

    this.overlay.querySelectorAll('#shells button').forEach((btn) => {
      btn.addEventListener('click', () => this.selectShell(Number(btn.dataset.shell)));
    });
    this.$('fire').addEventListener('click', () => (this.locked ? this.cancel() : this.validate()));
    this.$('biomeL').addEventListener('click', () => this.cycleBiome(-1));
    this.$('biomeR').addEventListener('click', () => this.cycleBiome(1));
    this.$('roundsL').addEventListener('click', () => this.cycleRounds(-1));
    this.$('roundsR').addEventListener('click', () => this.cycleRounds(1));
    this.$('hpL').addEventListener('click', () => this.cycleHp(-1));
    this.$('hpR').addEventListener('click', () => this.cycleHp(1));
    this.$('modeL').addEventListener('click', () => this.cycleMode(-1));
    this.$('modeR').addEventListener('click', () => this.cycleMode(1));
    this.$('again').addEventListener('click', () => this.playAgain());
    this.$('leave').addEventListener('click', () => this.client.send('leave'));
  }

  // --- aim -----------------------------------------------------------------

  setAimFromPoint(px, py, w, h) {
    if (this.locked || this.phase !== PHASE.AIMING) return;
    const pivot = { x: w / 2, y: h * 0.48 }; // matches drawTowerTop
    const dx = (px - pivot.x) * this.facing; // forward = positive
    const dy = pivot.y - py; // up = positive
    let angle = (Math.atan2(Math.max(dy, 0), Math.max(dx, 0.0001)) * 180) / Math.PI;
    angle = Phaser.Math.Clamp(angle, AIM.minAngle, AIM.maxAngle);
    const maxR = h * 0.42;
    const ratio = Phaser.Math.Clamp(Math.hypot(dx, dy) / maxR, 0, 1);
    const power = AIM.minPower + ratio * (AIM.maxPower - AIM.minPower);
    this.aimAngle = angle;
    this.aimPower = power;
    this.updateReadout();
    const now = performance.now();
    if (now - (this.lastAimSent || 0) > 90) { this.lastAimSent = now; this.sendAim(); }
  }

  updateReadout() {
    const pw = Math.round(((this.aimPower - AIM.minPower) / (AIM.maxPower - AIM.minPower)) * 100);
    this.$('readout').textContent = `Angle ${Math.round(this.aimAngle)}° · Power ${pw}%`;
  }

  sendAim() { this.client.send('aim', { angle: this.aimAngle, power: this.aimPower }); }

  validate() {
    if (this.locked) return;
    this.locked = true;
    this.sendAim();
    this.client.send('ready', { value: true });
    this.sfx.blip(880);
    this.renderFireButton();
  }

  // Withdraw a locked order while the opponent has not validated yet.
  cancel() {
    if (this.phase !== PHASE.AIMING) return;
    this.locked = false;
    this.client.send('ready', { value: false });
    this.sfx.blip(440);
    this.unlock();
  }

  unlock() {
    this.locked = false;
    this.renderFireButton();
  }

  // The validate/cancel button, including the turbo shot-clock countdown.
  renderFireButton() {
    const btn = this.$('fire');
    if (this.phase === PHASE.FIRING && !this.turbo) {
      btn.disabled = true;
      btn.classList.remove('ready', 'waiting', 'urgent');
      btn.textContent = 'Firing…';
      return;
    }
    btn.disabled = false;
    const sc = this.shotClock;
    const clock = sc != null ? ` ${sc.toFixed(1)}s` : '';
    btn.classList.toggle('waiting', this.locked);
    btn.classList.toggle('urgent', !this.locked && sc != null && sc <= 2);
    if (this.locked) btn.textContent = `✖ Cancel${sc != null ? ` ·${clock}` : ' order'}`;
    else btn.textContent = sc != null ? `🔥 FIRE!${clock}` : 'VALIDATE SHOT';
  }

  // --- pickers -------------------------------------------------------------

  selectShell(idx) {
    const shell = SHELLS[idx];
    if (shell.id !== 'normal' && (this.ammo?.[shell.id] || 0) <= 0) return; // out of stock
    this.shellIndex = idx;
    this.sfx.blip(560);
    this.client.send('shell', { id: shell.id });
    this.updateShellUI();
  }

  // Stock badges (∞ for normal) + greying out spent specials + active highlight.
  updateShellUI() {
    this.overlay.querySelectorAll('#shells button').forEach((btn) => {
      const i = Number(btn.dataset.shell);
      const shell = SHELLS[i];
      const unlimited = shell.id === 'normal';
      const n = unlimited ? Infinity : this.ammo?.[shell.id] ?? 1;
      btn.querySelector('.ct').textContent = unlimited ? '∞' : String(n);
      btn.classList.toggle('out', !unlimited && n <= 0);
      btn.classList.toggle('on', i === this.shellIndex);
    });
  }

  isChooser() { return this.biomeChooser === this.player && (!this.inMatch || this.postmatch); }

  cycleBiome(dir) {
    this.biomeIndex = (this.biomeIndex + dir + BIOMES.length) % BIOMES.length;
    this.sfx.blip(700);
    this.client.send('config', { biomeId: BIOMES[this.biomeIndex].id });
    this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
    this.applyBiome();
  }

  cycleRounds(dir) {
    this.roundsIndex = (this.roundsIndex + dir + ROUND_OPTIONS.length) % ROUND_OPTIONS.length;
    this.sfx.blip(620);
    this.client.send('config', { rounds: ROUND_OPTIONS[this.roundsIndex] });
    this.$('roundsName').textContent = `${ROUND_OPTIONS[this.roundsIndex]} rounds`;
  }

  cycleHp(dir) {
    this.hpIndex = (this.hpIndex + dir + HP_OPTIONS.length) % HP_OPTIONS.length;
    this.sfx.blip(580);
    this.client.send('config', { hp: HP_OPTIONS[this.hpIndex] });
    this.$('hpName').textContent = hpLabel(HP_OPTIONS[this.hpIndex]);
  }

  cycleMode(dir) {
    this.modeIndex = (this.modeIndex + dir + GAME_MODES.length) % GAME_MODES.length;
    const m = GAME_MODES[this.modeIndex];
    this.sfx.blip(660);
    this.client.send('config', { turbo: m.turbo, cadence: m.cadence });
    this.$('modeName').textContent = m.label;
  }

  playAgain() {
    this.client.send('playAgain');
    this.$('again').disabled = true; this.$('again').textContent = 'Waiting for opponent…';
  }

  // Tint the controller to the current biome (dark enough to keep text legible).
  applyBiome() {
    const biome = BIOMES[this.biomeIndex] || BIOMES[0];
    const top = intToCss(shade(biome.sky[0], 0.38));
    this.overlay.style.background = `linear-gradient(180deg, ${top}, #0b1020)`;
  }

  // --- server messages -----------------------------------------------------

  onRoster(m) {
    this.biomeChooser = m.biomeChooser ?? -1;
    this.inMatch = !!m.inMatch;
    this.postmatch = !!m.postmatch;
    if (m.config) {
      const bi = BIOMES.findIndex((b) => b.id === m.config.biomeId);
      if (bi !== -1) { this.biomeIndex = bi; this.applyBiome(); }
      const ri = ROUND_OPTIONS.indexOf(m.config.rounds);
      if (ri !== -1) this.roundsIndex = ri;
      const hi = HP_OPTIONS.indexOf(m.config.hp);
      if (hi !== -1) this.hpIndex = hi;
      const mi = GAME_MODES.findIndex((g) => g.turbo === m.config.turbo && (!g.turbo || g.cadence === m.config.cadence));
      if (mi !== -1) this.modeIndex = mi;
    }
    // The match was aborted (opponent left) and the room is back to the lobby:
    // drop back to the pre-match waiting state.
    if (!m.inMatch && this.phase) {
      this.phase = null;
      this.prevPhase = null;
      this.clearEndScreen();
      this.unlock();
    }
    this.refresh();
  }

  onSnapshot(m) {
    const s = m.state;
    const me = s.towers[this.player];
    this.phase = s.phase;
    this.wind = s.wind;

    if (s.round.current !== this.roundCur) { this.roundCur = s.round.current; this.hitsTaken = 0; }
    if (me.ammo) this.ammo = me.ammo;
    const si = SHELLS.findIndex((x) => x.id === me.shell);
    if (si !== -1) this.shellIndex = si;
    this.turbo = !!s.turbo;
    this.shotClock = s.shotClock;

    this.feedback(m.events || [], me);
    this.proximity(s, me);

    // Re-arm once the server clears our ready flag (after a volley fires) — this
    // is how turbo lets us aim the next shot immediately, with no phase change.
    if (this.locked && this.serverReady && !me.ready) this.unlock();
    this.serverReady = me.ready;
    if (s.phase === PHASE.AIMING && this.prevPhase && this.prevPhase !== PHASE.AIMING) this.unlock();

    // The end-of-match cracktro owns the whole screen — keep the gameplay HUD
    // line and status text out of it so no live-match text bleeds through.
    if (s.phase !== PHASE.MATCH_END) {
      const dir = s.wind === 0 ? 'calm' : s.wind > 0 ? 'east →' : '← west';
      const strength = Math.round((Math.abs(s.wind) / MAX_WIND) * 100);
      this.$('info').textContent =
        `Round ${s.round.current}/${s.round.total}  ·  ${s.scores[0]}–${s.scores[1]}  ·  Wind ${strength}% ${dir}`;

      const opponent = s.towers[this.player === 0 ? 1 : 0];
      if (s.phase === PHASE.RESOLVING) this.$('status').textContent = s.banner || '…';
      else if (s.phase === PHASE.FIRING) this.$('status').textContent = 'Shots away!';
      else if (this.shotClock != null) {
        this.$('status').textContent = this.locked
          ? 'Locked — opponent on the clock' : '⏱ Fire before the clock runs out!';
      } else {
        this.$('status').textContent = this.locked ? 'Locked in — tap to cancel and re-aim'
          : opponent.ready ? 'Opponent ready — your move!' : 'Drag the tower to aim, then validate.';
      }
    }
    this.renderFireButton();

    if (s.phase === PHASE.MATCH_END && this.prevPhase !== PHASE.MATCH_END) {
      this.$('again').disabled = false; this.$('again').textContent = 'Play again';
      this.startCracktro(s);
    }
    if (s.phase !== PHASE.MATCH_END && this.cracktro) this.clearEndScreen();

    this.prevPhase = s.phase;
    this.refresh();
  }

  vibe(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern); // no-op / unsupported on iOS
  }

  // Audio + haptics from the POV of this player's own tower: events near the
  // opponent's tower make no sound on this phone.
  feedback(events, me) {
    const ox = this.ownTowerX;
    const oy = (me?.groundY ?? 600) - 48;
    const near = (x, y) => {
      // Pythagoras tells us the distance is sqrt(dx²+dy²), but the square root
      // is the costly part — and we only need it when the impact is in range.
      // So compare the *squared* distance first and reach for sqrt only inside.
      const thr = 560;
      const dx = x - ox;
      const dy = y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= thr * thr) return 0;
      return 1 - Math.sqrt(d2) / thr;
    };
    for (const e of events) {
      if (e.type === 'fire') {
        if (e.owner === this.player) { this.sfx.boom(); this.vibe(35); } // only my own cannon
      } else if (e.type === 'impact') {
        const v = near(e.x, e.y);
        if (v > 0.05) this.sfx.explosion(v); // only impacts near my tower, scaled
      } else if (e.type === 'hit') {
        if (e.target === this.player) {
          this.sfx.rubble(false); // one rubble on MY tower; opponent hits are silent here
          this.hitsTaken += 1;
          const p = [];
          for (let i = 0; i < this.hitsTaken; i += 1) { p.push(230); if (i < this.hitsTaken - 1) p.push(110); }
          this.vibe(p);
        }
      } else if (e.type === 'destroyed') {
        if (e.tower === this.player) this.sfx.rubble(true); // my tower falling: longer collapse
      }
    }
  }

  // Continuous "bullet whizz" + proximity buzz, scaled by how close the nearest
  // shell is to this player's own tower.
  proximity(s, me) {
    if (s.phase !== PHASE.FIRING || !s.projectiles.length) { this.sfx.flyby(0); return; }
    const ox = this.ownTowerX;
    const oy = me.groundY - 48;
    // Find the nearest shell by *squared* distance — sqrt is monotonic, so the
    // closest squared distance is the closest distance. In turbo many shells can
    // be airborne at once, so this saves a sqrt per shell every frame; we take
    // the single real square root only once, and only if something is in range.
    let bestSq = Infinity;
    for (const p of s.projectiles) {
      const dx = p.x - ox;
      const dy = p.y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestSq) bestSq = d2;
    }
    const threshold = 460; // ~36% of the screen width
    const intensity = bestSq < threshold * threshold ? 1 - Math.sqrt(bestSq) / threshold : 0;
    this.sfx.flyby(intensity);
    if (intensity > 0.06) {
      const now = performance.now();
      if (now - this.lastVibe > 110) {
        this.lastVibe = now;
        this.vibe(Math.round(8 + intensity * 55));
      }
    }
  }

  // Wipe every trace of the end-of-match cracktro so the next match (or the
  // lobby) starts from a clean controller: clear the leftover sine-scroller
  // pixels off the fx canvas and drop the stale status line.
  clearEndScreen() {
    this.cracktro = null;
    if (this.fxc && this.fx.width) this.fxc.clearRect(0, 0, this.fx.width, this.fx.height);
    if (this.$('status')) this.$('status').textContent = '';
  }

  refresh() {
    const matchEnd = this.phase === PHASE.MATCH_END;
    const playing = !!this.phase && !matchEnd;
    this.$('controls').hidden = !playing;
    this.$('post').hidden = !matchEnd;
    this.fx.hidden = !matchEnd;
    this.canvas.style.display = matchEnd ? 'none' : 'block'; // hide aim view during the cracktro
    // Mute the live HUD line behind the end screen (cleaned up afterwards).
    this.$('info').hidden = matchEnd;

    const showBiome = this.isChooser();
    this.$('biome').hidden = !showBiome;
    if (showBiome) {
      this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
      this.$('roundsName').textContent = `${ROUND_OPTIONS[this.roundsIndex]} rounds`;
      this.$('hpName').textContent = hpLabel(HP_OPTIONS[this.hpIndex]);
      this.$('modeName').textContent = GAME_MODES[this.modeIndex].label;
    }
    this.updateShellUI();
    if (playing) this.updateReadout();

    if (!this.phase) {
      this.$('info').textContent = showBiome
        ? 'Pick a biome — waiting for the opponent…'
        : 'Waiting for the opponent to join…';
    }
  }

  // --- rendering -----------------------------------------------------------

  startRenderLoop() {
    const loop = () => {
      this.flash = Math.max(0, this.flash - 0.04);
      if (this.phase === PHASE.FIRING && this.prevFireSeen !== true) { this.flash = 1; this.prevFireSeen = true; }
      if (this.phase !== PHASE.FIRING) this.prevFireSeen = false;
      this.drawView();
      if (this.cracktro) this.drawCracktro();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  fitCanvas(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return r;
  }

  drawView() {
    const r = this.fitCanvas(this.canvas, this.ctx);
    if (!r) return;
    drawTowerTop(this.ctx, r.width, r.height, {
      angle: this.aimAngle, power: this.aimPower, facing: this.facing,
      color: this.color, wind: this.wind, time: performance.now(), flash: this.flash,
      ready: this.locked && this.phase === PHASE.AIMING, // fuse goes out the moment we fire
    });
    if (this.phase === PHASE.AIMING && !this.locked) this.drawAimGuide(r.width, r.height);
  }

  drawAimGuide(w, h) {
    const ctx = this.ctx;
    const pivot = { x: w / 2, y: h * 0.48 };
    const maxR = h * 0.42;
    const a0 = AIM.minAngle * Math.PI / 180, a1 = AIM.maxAngle * Math.PI / 180;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, maxR, -a1 * 0 - 0, 0); // placeholder, replaced below
    ctx.restore();
    // arc of allowed angles
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    for (let a = AIM.minAngle; a <= AIM.maxAngle; a += 3) {
      const rad = a * Math.PI / 180;
      const x = pivot.x + this.facing * Math.cos(rad) * maxR;
      const y = pivot.y - Math.sin(rad) * maxR;
      a === AIM.minAngle ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    // current aim handle
    const ratio = (this.aimPower - AIM.minPower) / (AIM.maxPower - AIM.minPower);
    const rad = this.aimAngle * Math.PI / 180;
    const hx = pivot.x + this.facing * Math.cos(rad) * maxR * ratio;
    const hy = pivot.y - Math.sin(rad) * maxR * ratio;
    ctx.strokeStyle = `#${this.color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 7); ctx.fill();
    ctx.strokeStyle = `#${this.color.toString(16).padStart(6, '0')}`;
    ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 7); ctx.stroke();
  }

  // --- end-of-match cracktro ----------------------------------------------

  startCracktro(s) {
    const [s1, s2] = s.scores;
    const won = (this.player === 0 && s1 > s2) || (this.player === 1 && s2 > s1);
    const draw = s1 === s2;
    const wins = ['YOU SAVED THE WORLD!!!', 'LEGENDARY VICTORY', 'GLORY EVERLASTING'];
    const loses = ['DISGRACE FOR GENERATIONS', 'SHAME… UTTER SHAME', 'YOUR ANCESTORS WEEP'];
    const text = draw ? 'AN HONOURABLE DRAW' : won ? wins[(Math.random() * wins.length) | 0] : loses[(Math.random() * loses.length) | 0];
    this.cracktro = { text, won, draw, t: 0, stars: Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2 })) };
  }

  drawCracktro() {
    const r = this.fitCanvas(this.fx, this.fxc);
    if (!r) return;
    const ctx = this.fxc, W = r.width, H = r.height;
    const c = this.cracktro; c.t += 0.016;
    const t = c.t;

    if (c.won) {
      // rainbow copper bars
      for (let y = 0; y < H; y += 6) {
        const hue = (y * 1.5 + t * 160) % 360;
        ctx.fillStyle = `hsl(${hue},85%,55%)`; ctx.fillRect(0, y, W, 6);
      }
      // starburst
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      c.stars.forEach((st) => {
        const a = (t * st.z) % 1; const x = W / 2 + (st.x - 0.5) * W * 2 * a; const y = H / 2 + (st.y - 0.5) * H * 2 * a;
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x, y, 2 + st.z * 2, 2 + st.z * 2);
      });
      ctx.restore();
    } else if (c.draw) {
      ctx.fillStyle = '#2b2b33'; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#23232a'; ctx.fillRect(0, 0, W, H);
      // shameful rain
      ctx.strokeStyle = 'rgba(150,160,180,0.5)'; ctx.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        const x = (i * 53 + t * 60) % W; const y = (i * 71 + t * 380) % H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12); ctx.stroke();
      }
    }

    // sine-scrolling text
    const msg = c.text + '   ★   ';
    ctx.font = `bold ${Math.round(H * 0.2)}px Fredoka, sans-serif`;
    ctx.textBaseline = 'middle';
    const speed = c.won ? 150 : 55;
    let x = W - (t * speed) % (ctx.measureText(msg).width + W);
    // repeat to fill
    const mw = ctx.measureText(msg).width;
    for (let rep = 0; rep < 3; rep++) {
      drawWave(ctx, msg, x + rep * mw, H, t, c);
    }
    function drawWave(ctx2, str, startX, h, time, cc) {
      let cx = startX;
      for (const ch of str) {
        const cw = ctx2.measureText(ch).width;
        if (cx > -40 && cx < W + 40) {
          const y = h / 2 + Math.sin(cx * 0.02 + time * 6) * h * 0.16;
          ctx2.fillStyle = cc.won ? '#fff' : '#9aa0b0';
          ctx2.strokeStyle = cc.won ? '#1d2233' : '#000';
          ctx2.lineWidth = 4; ctx2.strokeText(ch, cx, y); ctx2.fillText(ch, cx, y);
        }
        cx += cw;
      }
    }
  }
}

function hpLabel(n) {
  return `${'❤'.repeat(n)} ${n} HP`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectControllerStyles() {
  if (document.getElementById('tp-ctl-styles')) return;
  const style = document.createElement('style');
  style.id = 'tp-ctl-styles';
  style.textContent = `
    .tp-ctl{align-items:stretch;}
    .tp-ctl-card{width:100%;max-width:560px;margin:auto;display:flex;flex-direction:column;}
    .tp-ctl header{display:flex;justify-content:space-between;align-items:center;gap:12px;}
    .tp-ctl .tp-logo-sm{width:38px;height:38px;flex:none;border-radius:9px;}
    .tp-ctl #name{flex:1;min-width:0;font-size:clamp(22px,6vw,34px);font-weight:bold;color:var(--accent);
      background:transparent;border:none;border-bottom:2px dashed #ffffff55;padding:4px 2px;}
    .tp-ctl .room{font-size:clamp(13px,3.6vw,20px);color:#cdd6e6;white-space:nowrap;}
    .tp-ctl #info{font-size:clamp(15px,4.2vw,24px);margin:10px 0 4px;color:#eaf3ff;}
    .tp-ctl #ttv{width:100%;height:34vh;min-height:190px;display:block;margin:4px 0;touch-action:none;cursor:crosshair;}
    .tp-ctl .row{display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0;}
    .tp-ctl .row button{width:auto;background:transparent;color:#fff;border:none;font-size:30px;cursor:pointer;padding:0 8px;}
    .tp-ctl #biomeName,.tp-ctl #roundsName,.tp-ctl #hpName{font-size:clamp(18px,5vw,26px);font-weight:bold;min-width:130px;text-align:center;}
    .tp-ctl #biome .hint{font-size:14px;color:#cdd6e6;margin-top:2px;text-align:center;}
    .tp-ctl #readout{text-align:center;font-size:clamp(15px,4.2vw,22px);color:#eaf3ff;margin:2px 0 4px;}
    .tp-ctl .shellrow{display:flex;justify-content:center;gap:8px;margin:6px 0;}
    .tp-ctl .shellrow button{position:relative;flex:1;max-width:74px;padding:8px 2px 5px;display:flex;flex-direction:column;align-items:center;gap:3px;
      background:#ffffff14;border:2px solid transparent;border-radius:12px;cursor:pointer;color:#cdd6e6;}
    .tp-ctl .shellrow button svg{width:26px;height:26px;}
    .tp-ctl .shellrow button span{font-size:10px;font-weight:bold;}
    .tp-ctl .shellrow button .ct{position:absolute;top:1px;right:5px;font-size:11px;font-weight:bold;color:#ffd27a;}
    .tp-ctl .shellrow button.on{border-color:var(--accent);background:#ffffff28;color:#fff;}
    .tp-ctl .shellrow button.out{opacity:.32;}
    .tp-ctl #fire,.tp-ctl #again,.tp-ctl #leave{width:100%;margin-top:10px;padding:clamp(16px,3vh,26px);
      font-size:clamp(20px,5.4vw,30px);font-weight:bold;border:none;border-radius:18px;background:var(--accent);color:#fff;cursor:pointer;}
    .tp-ctl #fire:disabled,.tp-ctl #again:disabled{background:#3a4a66;opacity:.7;}
    .tp-ctl #fire.ready{background:#2f7d32;}
    .tp-ctl #fire.waiting{background:#c9892b;}
    .tp-ctl #fire.urgent{background:#d63b2f;animation:tp-pulse .5s ease-in-out infinite;}
    @keyframes tp-pulse{50%{filter:brightness(1.25);}}
    .tp-ctl .ghost{background:transparent;border:2px solid #ffffff44;color:#cdd6e6;}
    .tp-ctl #status{font-size:clamp(14px,4vw,22px);margin-top:12px;color:#cdd6e6;text-align:center;min-height:26px;}
    .tp-ctl #fx{width:100%;height:34vh;min-height:200px;border-radius:14px;display:block;margin:6px 0;}
    .tp-ctl #post{display:flex;flex-direction:column;}
  `;
  document.head.appendChild(style);
}
