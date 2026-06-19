import Phaser from 'phaser';

import { COLORS, MAX_WIND, GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';
import { livingResult } from '../sim/scoring.js';
import { injectStyles, saveName, BUILD_LABEL, REPO_URL } from './LobbyScene.js';
import { intToCss } from '../render/visuals.js';

// Third-player controller — the Intendant of the living world (lot 4). A wholly
// different persona from the artillery pad (ControllerScene): no aiming, no
// shells. Instead a joystick (move + aim the active tool, up = jump), a 2-row
// tool block (free terraform: Dig/Flatten/Fill — paid works: Stairs/Bridge),
// a big ACTION button, and an oscilloscope HUD whose broken-glass overlay is
// the Intendant's health. Ported from the validated mockup
// design/controller-p3.html; the server runs the sim, this only sends intents.
//
// The scene is purely intent-out / snapshot-in: it reads the snapshot's
// `battlefield` block (HP, economy, gloire, alignment, radar positions) and
// sends `intendant` (held input flags) + `intendantBuild` (edge-triggered).
const TOOL_SVG = {
  dig: '<path d="M14 3l4 4-3 3-4-4zM11 8l-7 9 3 3 9-7z"/>',
  fill: '<path d="M4 19h16M6 19l3-9 3 4 3-7 3 12"/>',
  flat: '<path d="M3 15l18-6M4 19h16"/>',
  stair: '<path d="M3 20h5v-4h5v-4h5V8"/>',
  bridge: '<path d="M3 9v8M21 9v8M3 11h18M5 17c4-4 10-4 14 0"/>',
};
const COST = { stair: 5, bridge: 5 };
const FREE = { dig: true, fill: true, flat: true };

// End-of-match verdict lines for the Intendant — the one player who learns the
// true three-way result (tie→P3, see src/sim/scoring.js). The duelists keep
// their own combat fanfare/shame texts in ControllerScene; the maker gets his
// own register, god-tier whether he was crowned or eclipsed.
const WIN_LINES = ['THE WORLD BOWS TO ITS MAKER', 'DEMIURGE ASCENDANT', 'YOU SHAPED IT — IT OBEYED', 'ARCHITECT OF EVERY FATE'];
const LOSE_LINES = ['THE CLAY SLIPPED YOUR GRASP', 'MORTALS WROTE THE ENDING', 'THE WORLD FORGOT ITS MAKER', 'YOUR CREATION OUTGREW YOU'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default class IntendantScene extends Phaser.Scene {
  constructor(key) {
    super(key || 'Intendant');
  }

  init(data) {
    this.player = 2;
    this.code = data.code;
    this.name = data.name || 'Intendant';
    this.token = data.token;
    this.localClient = data.client;
    this.localSfx = data.sfx;
    this.embed = data.embed || null;
    this.color = COLORS.intendant || 0xb483f0;

    this.unsubs = [];
    this.tool = 'dig';
    this.acting = false;
    this.dir = { x: 0, y: 0 };
    this.bf = null;            // latest battlefield block
    this.state = null;         // latest full state (wind, round, maxHp)
    this.impacts = [];         // broken-glass impact stars (one per HP lost)
    this.lastHp = null;
    this.lastSentAt = 0;
    this.lastSent = '';
    this.reconnecting = false;
    this.T = 0;
    this.prevPhase = null;      // rising-edge detection for matchEnd
    this.cracktro = null;       // end-of-match demiurge screen (null when off)
  }

  track(off) { this.unsubs.push(off); }

  create() {
    this.client = this.localClient || this.registry.get('client');
    // Audio: the Intendant is a controller persona — like P1/P2 it emits only
    // proximity SFX, never the ambient OST (the TV diffuses music). It shares the
    // controllers' 'ctlSfx' bus (created + unlocked by BootScene), kept distinct
    // from the TV's music-bearing 'sfx' bus. (audio-spatialization-convention)
    this.sfx = this.localSfx || this.registry.get('ctlSfx') || this.registry.get('sfx');
    injectStyles();
    injectIntendantStyles();

    const hex = intToCss(this.color);
    const overlay = document.createElement('div');
    overlay.className = 'tp-overlay tp-intendant';
    overlay.style.setProperty('--accent', hex);
    overlay.innerHTML = `
      <div class="ctl">
        <header>
          <img class="logo" id="home" src="icon.svg" alt="" title="Leave to room select" />
          <input id="name" maxlength="14" value="${escapeHtml(this.name)}" />
          <span class="room">Room ${this.code}</span>
        </header>
        <div id="hudWind">
          <span class="hud-round" id="round">0/0</span>
          <div id="hudBar"><i id="hudFill"></i><b id="hudTick"></b></div>
          <span class="hud-pct" id="wpct">calm</span>
        </div>
        <div class="scope"><canvas id="scope" width="744" height="186"></canvas></div>
        <div class="stats">
          <span class="chip"><span class="dot b"></span><span id="resB">0</span> &nbsp; <span class="dot r"></span><span id="resR">0</span></span>
          <span class="chip gold" id="trophy">🏆 <span id="score">0</span></span>
        </div>
        <div class="actblock" id="bar">
          <div class="arow r1">
            <button class="on" data-t="dig"><svg viewBox="0 0 24 24">${TOOL_SVG.dig}</svg><span>Dig</span></button>
            <button data-t="flat"><svg viewBox="0 0 24 24">${TOOL_SVG.flat}</svg><span>Flatten</span></button>
            <button data-t="fill"><svg viewBox="0 0 24 24">${TOOL_SVG.fill}</svg><span>Fill</span></button>
          </div>
          <div class="arow r2">
            <button data-t="stair"><span class="ct"><span class="dot b"></span>5<span class="dot r"></span>5</span><svg viewBox="0 0 24 24">${TOOL_SVG.stair}</svg><span>Stairs</span></button>
            <button data-t="bridge"><span class="ct"><span class="dot b"></span>5<span class="dot r"></span>5</span><svg viewBox="0 0 24 24">${TOOL_SVG.bridge}</svg><span>Bridge</span></button>
          </div>
        </div>
        <div class="bottom">
          <div class="jwrap"><div class="stick" id="stick"><div class="ring"></div><div class="up">⤒</div><canvas class="flag" id="flag" width="78" height="52"></canvas><div class="knob" id="knob"></div></div></div>
          <div class="awrap"><button class="action" id="action"><span class="eff" id="eff"></span><span id="aicon"></span></button></div>
        </div>
        <div id="status"></div>
        <div id="endscreen" hidden>
          <canvas id="fx"></canvas>
          <div id="endbtns">
            <button id="again" class="endbtn primary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 7l5 5V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-7z"/></svg><span>Shape anew</span></button>
            <button id="leaveEnd" class="endbtn ghost"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l1.4-1.4L8.83 13H16v-2H8.83l2.58-2.6L10 7l-5 5 5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z"/></svg><span>Withdraw</span></button>
          </div>
        </div>
      </div>
      <p class="tp-build"><a class="tp-build-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${BUILD_LABEL}</a></p>`;

    if (this.embed) {
      overlay.style.position = 'absolute';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.transformOrigin = 'top left';
      overlay.style.transform = `scale(${this.embed.scale})`;
      this.embed.container.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
    this.overlay = overlay;
    this.$ = (id) => overlay.querySelector(`#${id}`);

    this.scopeCv = this.$('scope');
    this.scopeCtx = this.scopeCv.getContext('2d');
    this.flagCv = this.$('flag');
    this.flagCtx = this.flagCv.getContext('2d');
    this.fx = this.$('fx');
    this.fxc = this.fx.getContext('2d');

    this.rememberSession();
    this.wireDom();
    this.startRenderLoop();

    this.track(this.client.on('snapshot', (m) => this.onSnapshot(m)));
    this.track(this.client.on('reslot', (m) => this.onReslot(m)));
    this.track(this.client.on('close', () => { this.reconnecting = true; }));
    this.track(this.client.on('reopen', () => { if (this.token) this.client.send('rejoin', { code: this.code, token: this.token, name: this.name }); }));
    this.track(this.client.on('rejoined', () => { this.reconnecting = false; }));
    this.track(this.client.on('rejoinFailed', () => this.goHome(true)));
    this.track(this.client.on('roomClosed', () => this.goHome(true)));

    this.installEscape();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
      if (this.winMove) window.removeEventListener('pointermove', this.winMove);
      if (this.winUp) window.removeEventListener('pointerup', this.winUp);
      overlay.remove();
    });

    this.refreshTools();
  }

  rememberSession() {
    try {
      sessionStorage.setItem('towerduel.session', JSON.stringify({ code: this.code, token: this.token, name: this.name, role: 'intendant' }));
    } catch { /* private mode */ }
  }

  installEscape() {
    this.escHandler = (e) => { if (e.key === 'Escape') this.goHome(); };
    window.addEventListener('keydown', this.escHandler);
  }

  goHome(skipSend = false) {
    if (!skipSend) this.client.send('goHome');
    try { sessionStorage.removeItem('towerduel.session'); } catch { /* ignore */ }
    this.scene.start('Lobby', { auto: 'join' });
  }

  onReslot(m) { if (typeof m.slot === 'number' && m.slot !== 2) { /* demoted off the Intendant seat: fall back to the pad */ this.scene.start('Controller', { player: m.slot, code: this.code, name: this.name, token: this.token }); } }

  // --- DOM wiring ----------------------------------------------------------

  wireDom() {
    // name edit
    const nameEl = this.$('name');
    nameEl.addEventListener('change', () => { this.name = nameEl.value.trim() || this.name; saveName(this.name); this.client.send('name', { name: this.name }); this.rememberSession(); });

    // end-of-match cracktro buttons (same contract as P1/P2 #endbtns): Shape anew
    // dismisses the screen back to the live pad; Withdraw leaves the room.
    this.$('again').addEventListener('click', () => this.dismissCracktro());
    this.$('leaveEnd').addEventListener('click', () => this.goHome());
    // The game logo doubles as a "leave to room select" button (same on P1/P2).
    this.$('home')?.addEventListener('click', () => this.goHome());

    // tool selection
    this.overlay.querySelectorAll('#bar button').forEach((b) => {
      b.addEventListener('pointerdown', () => {
        this.tool = b.dataset.t;
        this.overlay.querySelectorAll('#bar button').forEach((x) => x.classList.toggle('on', x === b));
        this.refreshTools();
      });
    });

    // joystick
    const stick = this.$('stick'); const knob = this.$('knob');
    const R = 42;
    const setKnob = (dx, dy) => {
      const m = Math.hypot(dx, dy) || 1; const c = Math.min(1, m / R);
      const kx = (dx / m) * R * c; const ky = (dy / m) * R * c;
      knob.style.transform = `translate(${kx}px,${ky}px)`;
      this.dir = { x: m > 6 ? kx / R : 0, y: m > 6 ? ky / R : 0 };
    };
    const at = (e) => { const r = stick.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; setKnob(t.clientX - r.left - 69, t.clientY - r.top - 77); };
    let sActive = false;
    stick.addEventListener('pointerdown', (e) => { sActive = true; at(e); });

    // ACTION
    const action = this.$('action');
    action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (COST[this.tool]) {
        // paid work: edge-triggered build (server pays + validates)
        if (this.afford(this.tool)) { this.client.send('intendantBuild', { type: this.tool }); this.flashEff(); }
      } else {
        this.acting = true;
      }
    });

    // Window-level listeners must be torn down on SHUTDOWN (a rejoin restarts the
    // scene): keep references so the cleanup hook can remove them.
    this.winMove = (e) => { if (sActive) at(e); };
    this.winUp = () => { if (sActive) { sActive = false; setKnob(0, 0); } this.acting = false; const eff = this.$('eff'); if (eff) eff.style.width = '0'; };
    window.addEventListener('pointermove', this.winMove);
    window.addEventListener('pointerup', this.winUp);
  }

  flashEff() { const eff = this.$('eff'); if (!eff) return; eff.style.transition = 'none'; eff.style.width = '100%'; window.requestAnimationFrame(() => { eff.style.transition = 'width .35s ease'; eff.style.width = '0'; }); }

  afford(t) { const c = COST[t]; if (!c) return true; const bp = this.bf ? this.bf.intendant.bp : [0, 0]; return bp[0] >= c && bp[1] >= c; }

  refreshTools() {
    const bp = this.bf ? this.bf.intendant.bp : [0, 0];
    this.overlay.querySelectorAll('#bar button').forEach((b) => {
      const c = COST[b.dataset.t];
      b.classList.toggle('out', !!c && (bp[0] < c || bp[1] < c));
    });
    this.$('aicon').innerHTML = `<svg viewBox="0 0 24 24">${TOOL_SVG[this.tool]}</svg>`;
    this.$('action').classList.toggle('out', !this.afford(this.tool));
  }

  // --- intents -------------------------------------------------------------

  // Recompute the held-input flags from the joystick + ACTION and push them to
  // the server when they change (throttled), so the Intendant's avatar moves /
  // terraforms in the authoritative sim.
  pumpInput(now) {
    const d = this.dir;
    const input = {
      left: d.x < -0.4,
      right: d.x > 0.4,
      up: d.y < -0.45,
      down: d.y > 0.45,
      jump: d.y < -0.45,
      dig: this.acting && this.tool === 'dig',
      fill: this.acting && this.tool === 'fill',
      flat: this.acting && this.tool === 'flat',
    };
    const sig = `${+input.left}${+input.right}${+input.up}${+input.down}${+input.dig}${+input.fill}${+input.flat}`;
    if (sig !== this.lastSent || now - this.lastSentAt > 200) {
      this.lastSent = sig; this.lastSentAt = now;
      this.client.send('intendant', input);
    }
  }

  // --- snapshot in ---------------------------------------------------------

  // P3 hears the living world from the Intendant's MOBILE position — the mic
  // follows his avatar, so his own sword/build and nearby combat sit up front.
  feedback(events) {
    if (!this.sfx || !this.bf || !this.bf.intendant) return;
    const I = this.bf.intendant;
    this.sfx.setListener({ mode: 'mic', x: I.x, y: I.y, range: 320 });
    const here = () => this.sfx.spatial({ x: I.x, y: I.y });
    const sp = (e) => this.sfx.spatial({ x: e.x, y: e.y });
    const vortex = this.state && this.state.biomeId === 'volcano';
    for (const e of events) {
      // His own acts (shield, build, dig) sit at the mic; the rest is placed.
      const mine = e.type === 'intParry' || e.type === 'intFatal' || e.type === 'intBuild' || e.type === 'intDig'
        || e.type === 'intBow' || e.type === 'intSword' || e.type === 'intHurt' || e.type === 'apparition' || e.type === 'glide';
      this.sfx.playEvent(e, mine ? here() : sp(e), { skinVortex: vortex });
    }
    // Projectile passage heard from his moving position (mobile mic, sustained).
    const voices = [];
    const range = 320; const r2 = range * range;
    for (const p of this.bf.projectiles) {
      const dx = p.x - I.x; const dy = p.y - I.y; const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      voices.push({ id: `b${p.id}`, intensity: 1 - Math.sqrt(d2) / range, freq: p.musket ? 3000 : p.gren ? 900 : p.bolt ? 1800 : p.fromI ? 1500 : 600 });
    }
    this.sfx.whistles(voices);
  }

  onSnapshot(m) {
    const state = m.state;
    this.state = state;
    const bf = state.battlefield;
    this.bf = bf || null;
    if (!bf) return;
    // The server ships the coarse battlefield terrain only when it actually
    // changes (+ a ~1 s keyframe), blanking it to [] on every other frame and
    // expecting the client to keep the last relief (see server/Room.js
    // gateTerrain; TvScene relies on the same contract). Persist it here so the
    // oscilloscope draws the true crest every frame instead of collapsing to a
    // flat line between the sparse terrain updates.
    if (bf.terrain && bf.terrain.length > 1) this._lastTerrain = bf.terrain;
    else if (this._lastTerrain) bf.terrain = this._lastTerrain;
    this.feedback(m.events || []);

    // broken glass = HP: one impact star per point lost; a heal/reset clears it.
    const hp = bf.intendant.hp;
    const maxHp = state.maxHp || 3;
    if (this.lastHp == null) this.lastHp = hp;
    if (hp < this.lastHp) {
      for (let k = this.lastHp - 1; k >= hp; k -= 1) {
        const i = maxHp - k - 1;
        this.impacts.push({ x: 744 * (0.18 + ((i * 0.37) % 0.64)), y: 186 * (0.22 + ((i * 0.53) % 0.56)), i, s: i * 1.7 + 0.6 });
      }
    } else if (hp > this.lastHp) {
      this.impacts = [];
    }
    this.lastHp = hp;

    // HUD numbers
    this.$('resB').textContent = bf.intendant.bp[0];
    this.$('resR').textContent = bf.intendant.bp[1];
    this.$('score').textContent = bf.score;
    this.$('round').textContent = `${bf.score}/${state.round.total}`;
    this.refreshTools();

    const st = this.$('status');
    if (st) {
      if (state.phase === 'matchEnd') {
        // 3-way result, tie→Intendant (see src/sim/scoring.js).
        const res = livingResult(state.scores[0], state.scores[1], bf.score);
        st.textContent = res.winner === 2 ? '🏆 Intendant — victory!' : (res.draw ? 'Duel draw' : 'A camp won the duel');
      } else {
        st.textContent = this.reconnecting ? 'Reconnecting…' : (bf.present ? '' : 'Standing down');
      }
    }

    // Raise the demiurge cracktro once, on the matchEnd edge; wipe it when a new
    // match pulls the phase back out (mirrors ControllerScene's startCracktro).
    if (state.phase === 'matchEnd' && this.prevPhase !== 'matchEnd') this.startCracktro(state);
    else if (state.phase !== 'matchEnd' && this.cracktro) this.clearEndScreen();
    this.prevPhase = state.phase;
  }

  // --- render loop ---------------------------------------------------------

  startRenderLoop() {
    const tick = () => {
      this.T += 1 / 60;
      this.pumpInput(performance.now());
      this.drawScope();
      this.drawFlag();
      this.drawWind();
      if (this.cracktro) this.drawCracktro();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  drawWind() {
    const wind = this.state ? this.state.wind : 0;
    const ratio = Math.min(Math.abs(wind) / MAX_WIND, 1);
    const f = this.$('hudFill');
    if (!f) return;
    if (ratio < 0.02) { f.style.width = '0'; } else if (wind > 0) { f.style.left = '50%'; f.style.right = 'auto'; f.style.width = `${ratio * 50}%`; f.style.borderRadius = '0 4px 4px 0'; } else { f.style.right = '50%'; f.style.left = 'auto'; f.style.width = `${ratio * 50}%`; f.style.borderRadius = '4px 0 0 4px'; }
    this.$('wpct').textContent = ratio < 0.02 ? 'calm' : `${Math.round(ratio * 100)}% ${wind > 0 ? '→' : '←'}`;
  }

  // Oscilloscope: the REAL terrain crest (the authoritative coarse heightfield
  // streamed in bf.terrain — same source the TV rebuilds), drawn segment by
  // segment and coloured by per-camp traversability so the Intendant reads where
  // each army can actually advance:
  //   blue only  → blue   (blue marches left→right; segment climbable that way)
  //   red only   → red    (red marches right→left)
  //   both       → purple (P3's colour — passable by either army)
  //   neither    → not drawn (an impassable cliff = a gap, no path there)
  // Traversability uses the sim's own walk test: a step is blocked when the climb
  // ahead exceeds climbSlope (in WORLD units, so the test is scale-correct). Real
  // radar dots for soldiers/towers/Intendant ride on top, then the HP overlay.
  drawScope() {
    const g = this.scopeCtx; const cv = this.scopeCv; const W = cv.width; const H = cv.height;
    const CS = 1.35;                 // climbSlope (DEFAULT_PARAMS.climbSlope)
    const GW = GAME_WIDTH; const GH = GAME_HEIGHT;
    const PAD = 12; const topY = 12; const baseY = H - 14;
    const bf = this.bf;
    const T = bf && bf.terrain && bf.terrain.length > 1 ? bf.terrain : null;
    // world x∈[0,GW] → canvas x; world y∈[0,GH] → canvas y (scope vertical band).
    const cx = (wx) => PAD + (wx / GW) * (W - 2 * PAD);
    const cy = (wy) => topY + (wy / GH) * (baseY - topY);
    const canvasToWorldX = (x) => ((x - PAD) / (W - 2 * PAD)) * GW;
    // world surface y at world x, lerped from the coarse heightfield (index by
    // fraction so it self-adjusts to whatever sample count the server sent).
    const wyAt = (wx) => {
      if (!T) return GH * 0.72;
      const fi = Math.max(0, Math.min(T.length - 1, (wx / GW) * (T.length - 1)));
      const i = Math.min(T.length - 2, Math.floor(fi));
      return T[i] + (T[i + 1] - T[i]) * (fi - i);
    };
    const hY = (x) => cy(wyAt(canvasToWorldX(x)));

    // Capture the ORIGINAL (round-start, pre-modification) crest the first time we
    // see each round's seed, so we can keep it as a faint reference under the live
    // path. The live terrain (T) then drifts from it as craters + the Intendant's
    // terraforming reshape the shared heightfield.
    const seed = this.state ? this.state.seed : null;
    if (T && seed !== this._origSeed) { this._origSeed = seed; this._origTerrain = T.slice(); }
    const O = this._origTerrain && this._origTerrain.length > 1 ? this._origTerrain : T;
    const oYAt = (wx) => {
      if (!O) return GH * 0.72;
      const fi = Math.max(0, Math.min(O.length - 1, (wx / GW) * (O.length - 1)));
      const i = Math.min(O.length - 2, Math.floor(fi));
      return O[i] + (O[i + 1] - O[i]) * (fi - i);
    };

    g.fillStyle = '#060a12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#12331e'; g.lineWidth = 1;
    for (let y = 18; y < H; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

    const seg = 8;
    // 1) Original crest — a faint grey reference line (round-start relief).
    g.strokeStyle = 'rgba(200,210,230,0.26)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let x = PAD; x <= W - PAD; x += seg) { const y = cy(oYAt(canvasToWorldX(x))); if (x === PAD) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();

    // 2) Live per-camp traversable segments on the CURRENT relief. A built
    //    plank/stair/bridge spanning a segment makes it passable for BOTH camps
    //    (purple); otherwise the climb test (world slope vs climbSlope) decides
    //    per march direction. Reflects craters + terraforming via bf.terrain.
    const structs = (bf && bf.structures) || [];
    const bridged = (a, b) => structs.some((p) => p.x1 >= a && p.x0 <= b);
    g.lineWidth = 3;
    for (let x = PAD; x < W - PAD - seg; x += seg) {
      const wx0 = canvasToWorldX(x); const wx1 = canvasToWorldX(x + seg);
      const w0 = wyAt(wx0); const w1 = wyAt(wx1);
      const dw = Math.max(1e-3, wx1 - wx0);
      let bOK; let rOK;
      if (bridged(wx0, wx1)) { bOK = true; rOK = true; }
      else { bOK = (w0 - w1) / dw <= CS; rOK = (w1 - w0) / dw <= CS; } // blue→right, red→left
      if (!bOK && !rOK) continue;          // impassable both ways → leave the grey crest only
      g.strokeStyle = (bOK && rOK) ? '#b483f0' : bOK ? '#5aa9e6' : '#e6685a';
      g.shadowColor = g.strokeStyle; g.shadowBlur = 6;
      g.beginPath(); g.moveTo(x, cy(w0)); g.lineTo(x + seg, cy(w1)); g.stroke();
    }
    g.shadowBlur = 0;

    // 3) The Intendant's works (planks/stairs/bridges) as solid purple bars.
    if (structs.length) {
      g.strokeStyle = '#c9a8ff'; g.lineWidth = 2.5;
      for (const p of structs) { g.beginPath(); g.moveTo(cx(p.x0), cy(p.y)); g.lineTo(cx(p.x1), cy(p.y)); g.stroke(); }
    }

    // real radar dots (world → canvas, on the real crest / their own y)
    if (bf) {
      for (const s of bf.soldiers) {
        if (s.deserter) continue;
        const x = cx(s.x); const y = s.y != null ? cy(s.y) : hY(x);
        g.fillStyle = s.owner === 0 ? '#5aa9e6' : '#e6685a';
        g.beginPath(); g.arc(x, y - 4, 2.6, 0, 6.28); g.fill();
      }
      // towers as double dots — use the authoritative artillery tower x (they
      // slide per round) rather than a hardcoded edge offset.
      const towerX = this.state && this.state.towers ? this.state.towers.map((t) => t.x) : [72, GW - 72];
      for (const t of bf.towers) {
        const tx = cx(towerX[t.owner] != null ? towerX[t.owner] : (t.owner === 0 ? 72 : GW - 72));
        g.fillStyle = '#cdd6e6';
        g.beginPath(); g.arc(tx, hY(tx) - 4, 5.2, 0, 6.28); g.fill();
      }
      // Intendant marker (his own position)
      if (!bf.intendant.dead) {
        const ix = cx(bf.intendant.x); const iy = bf.intendant.y != null ? cy(bf.intendant.y) : hY(ix);
        g.fillStyle = '#cfb6ff';
        g.beginPath(); g.arc(ix, iy - 6, 3.4, 0, 6.28); g.fill();
      }
    }

    // broken-glass HP overlay
    this.drawShatter(g, W, H);
  }

  drawShatter(g, W, H) {
    if (!this.impacts.length) return;
    const maxHp = this.state ? (this.state.maxHp || 3) : 3;
    const hp = this.lastHp == null ? maxHp : this.lastHp;
    const danger = 1 - hp / maxHp;
    g.save();
    for (const im of this.impacts) {
      const br = 6 + im.i * 2;
      for (let b = 0; b < br; b += 1) {
        const a = (b / br) * 6.28 + im.s; let x = im.x; let y = im.y; const len = 24 + ((im.i * 53 + b * 37) % 46);
        g.strokeStyle = 'rgba(206,224,255,.6)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(x, y);
        const st = 4;
        for (let s = 0; s < st; s += 1) {
          const sg = len / st; const j = Math.sin(im.s + b * 2.1 + s) * 0.5; x += Math.cos(a + j) * sg; y += Math.sin(a + j) * sg; g.lineTo(x, y);
          if (s === 1 && b % 2 === 0) { const bx = x + Math.cos(a + 1.4) * 10; const by = y + Math.sin(a + 1.4) * 10; g.moveTo(x, y); g.lineTo(bx, by); g.moveTo(x, y); }
        }
        g.stroke();
      }
      g.strokeStyle = 'rgba(235,244,255,.8)'; g.lineWidth = 1.2; g.beginPath(); g.arc(im.x, im.y, 3.5, 0, 6.28); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(im.x, im.y, 1.6, 0, 6.28); g.fill();
    }
    if (danger > 0) { g.fillStyle = `rgba(120,150,210,${0.05 + danger * 0.10})`; g.fillRect(0, 0, W, H); }
    g.restore();
  }

  // The 2nd-player gonfalon planted at the top-centre of the joystick, coloured
  // by alignment: truce = neutral grey, else the allied camp's colour.
  drawFlag() {
    const fg = this.flagCtx; const FW = this.flagCv.width; const FH = this.flagCv.height;
    const GOLD = '#f0c050'; const GOLD_DK = '#b8902e';
    const inv = this.bf ? this.bf.invader : -1;
    const allyHex = inv < 0 ? '#9aa0b5' : (inv === 0 ? '#e6685a' : '#5aa9e6');
    const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, v | 0)); return `rgb(${c((n >> 16) * f)},${c(((n >> 8) & 255) * f)},${c((n & 255) * f)})`; };
    const wind = this.state ? this.state.wind : 0; const MAXW = MAX_WIND;
    const gColor = (u, v) => {
      if (v < 0.12) return GOLD;
      if (u < 0.16 || u > 0.84) return shade(allyHex, 1.28);
      if (Math.abs(v - 0.5) < 0.07) return GOLD;
      if (v > 0.72 && Math.abs(u - 0.5) < 0.30 - (v - 0.72)) return GOLD_DK;
      return allyHex;
    };
    fg.clearRect(0, 0, FW, FH);
    const baseX = FW / 2; const baseY = FH - 2; const topY = 6; const Wd = 22; const L = FH - 12; const lean = (wind / MAXW) * Wd * 0.55;
    fg.strokeStyle = '#4a4f58'; fg.lineWidth = 2.6; fg.beginPath(); fg.moveTo(baseX, baseY); fg.lineTo(baseX, topY); fg.stroke();
    fg.lineWidth = 2; fg.beginPath(); fg.moveTo(baseX - Wd / 2 - 3, topY); fg.lineTo(baseX + Wd / 2 + 3, topY); fg.stroke();
    fg.fillStyle = GOLD; [-Wd / 2 - 3, Wd / 2 + 3].forEach((dx) => { fg.beginPath(); fg.arc(baseX + dx, topY, 2.4, 0, 6.28); fg.fill(); });
    const NU = 5; const NV = 8; const T = this.T;
    const node = (i, j) => { const fy = j / NV; const sway = Math.sin(T * 4 + fy * 2.2) * 2.2 * fy; const fork = fy > 0.7 ? (fy - 0.7) / 0.3 : 0; const ci = (i / NU) * (1 - fork * 0.55) + 0.5 * (fork * 0.55); return { x: baseX - Wd / 2 + Wd * ci + (lean + sway) * fy, y: topY + L * fy }; };
    for (let i = 0; i < NU; i += 1) {
      for (let j = 0; j < NV; j += 1) {
        const u = (i + 0.5) / NU; const v = (j + 0.5) / NV;
        if (v > 0.88 && Math.abs(u - 0.5) < 0.16) continue;
        const a = node(i, j); const b = node(i + 1, j); const c = node(i + 1, j + 1); const d = node(i, j + 1);
        fg.fillStyle = gColor(u, v); fg.beginPath(); fg.moveTo(a.x, a.y); fg.lineTo(b.x, b.y); fg.lineTo(c.x, c.y); fg.lineTo(d.x, d.y); fg.closePath(); fg.fill();
      }
    }
  }

  // --- end-of-match cracktro -----------------------------------------------

  // DPR-aware fit, ported from ControllerScene.fitCanvas.
  fitCanvas(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return r;
  }

  startCracktro(state) {
    const bf = state.battlefield;
    const res = livingResult(state.scores[0], state.scores[1], bf ? bf.score : 0);
    const won = res.winner === 2;
    const lines = won ? WIN_LINES : LOSE_LINES;
    const text = lines[(Math.random() * lines.length) | 0];
    // starfield seeds (only used on victory), receding from the vanishing point
    const stars = Array.from({ length: 90 }, (_, i) => ({ a: (i / 90) * Math.PI * 2 + i * 0.137, r: ((i * 53) % 100) / 100, z: 0.3 + ((i * 31) % 70) / 100 }));
    this.cracktro = { won, text, t: 0, stars };
    this.$('endscreen').hidden = false;
    // Crowned → a victory bugle; eclipsed stays silent (no salt in the wound),
    // same restraint as the duelist screen.
    if (won && this.sfx && this.sfx.fanfare) this.sfx.fanfare();
  }

  dismissCracktro() { this.clearEndScreen(); }

  // Wipe the end screen back to the live pad: drop the cracktro, clear leftover
  // pixels off the fx canvas, hide the layer.
  clearEndScreen() {
    this.cracktro = null;
    if (this.fxc && this.fx.width) this.fxc.clearRect(0, 0, this.fx.width, this.fx.height);
    if (this.$('endscreen')) this.$('endscreen').hidden = true;
  }

  // The demiurge floor: a violet vector terrain receding to a vanishing point
  // (the heightfield he sculpts), copper bars in his band, a sine-scrolling
  // verdict, and — on victory — god-rays + a starburst. Cold and architectural,
  // deliberately NOT the duelists' rainbow copper (see ControllerScene).
  drawCracktro() {
    const r = this.fitCanvas(this.fx, this.fxc);
    if (!r) return;
    const ctx = this.fxc, W = r.width, H = r.height;
    const c = this.cracktro; c.t += 1 / 60; const t = c.t; const won = c.won;
    const horizon = H * 0.40;
    const vpx = W / 2;

    // sky / void
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    if (won) { sky.addColorStop(0, '#1a1140'); sky.addColorStop(0.5, '#150f2e'); sky.addColorStop(1, '#0a0716'); }
    else { sky.addColorStop(0, '#14131c'); sky.addColorStop(0.5, '#100f18'); sky.addColorStop(1, '#08070d'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    if (won) {
      // god-rays from the vanishing point
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(vpx, horizon);
      const rays = 16; const len = Math.max(W, H); const spread = 0.14;
      for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2 + t * 0.25;
        const g = ctx.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
        g.addColorStop(0, 'rgba(242,200,121,0.18)'); g.addColorStop(0.4, 'rgba(180,131,240,0.05)'); g.addColorStop(1, 'rgba(180,131,240,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang - spread) * len, Math.sin(ang - spread) * len);
        ctx.lineTo(Math.cos(ang + spread) * len, Math.sin(ang + spread) * len);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // starfield streaking outward
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      c.stars.forEach((s) => {
        const prog = (t * s.z * 0.35 + s.r) % 1; const d = prog * Math.max(W, H) * 0.9;
        const x = vpx + Math.cos(s.a) * d; const y = horizon + Math.sin(s.a) * d * 0.62;
        if (y < 0 || y > H) return; const sz = 1 + prog * 2.4 * s.z;
        ctx.fillStyle = `rgba(255,250,235,${0.15 + prog * 0.7})`; ctx.fillRect(x, y, sz, sz);
      });
      ctx.restore();
    }

    // ridge silhouette (the crest he sculpted)
    ctx.beginPath(); ctx.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 12) { ctx.lineTo(x, horizon - (Math.sin(x * 0.018 + 1.3) * 10 + Math.sin(x * 0.045) * 6 + 14)); }
    ctx.lineTo(W, horizon); ctx.closePath();
    ctx.fillStyle = won ? '#241544' : '#161420'; ctx.fill();

    // vector terrain floor
    const rows = 22; const cols = 14; const floorH = H - horizon; const amp = won ? 26 : 7;
    const depthY = (d) => horizon + Math.pow(d, 1.9) * floorH;
    const wave = (x, d) => Math.sin(x * 0.012 + t * 1.3) * amp * d + Math.sin(x * 0.03 - t * 0.8) * amp * 0.5 * d;
    ctx.lineWidth = 1;
    const scroll = (t * 0.18) % (1 / rows);
    for (let i = 0; i <= rows; i++) {
      const d = i / rows + scroll; if (d > 1) continue;
      const baseY = depthY(d); const alpha = (won ? 0.5 : 0.32) * Math.min(1, d * 1.6);
      ctx.strokeStyle = won ? `rgba(180,131,240,${alpha})` : `rgba(120,116,150,${alpha})`;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 14) { const y = baseY + wave(x, d); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let cc = 0; cc <= cols; cc++) {
      const fx = (cc / cols - 0.5); ctx.beginPath();
      for (let i = 0; i <= rows; i++) {
        const d = i / rows; const baseY = depthY(d); const x = vpx + fx * W * (0.5 + d * d * 7.5); const y = baseY + wave(x, d);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = won ? 'rgba(180,131,240,0.22)' : 'rgba(120,116,150,0.14)'; ctx.stroke();
    }
    if (won) { ctx.strokeStyle = 'rgba(242,200,121,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(W, horizon); ctx.stroke(); }

    // copper bars band behind the text — violet, not the duelists' rainbow
    const bandH = H * 0.18; const bandY = H * 0.10;
    ctx.save(); ctx.beginPath(); ctx.rect(0, bandY, W, bandH); ctx.clip();
    for (let y = bandY; y < bandY + bandH; y += 5) {
      const f = (y - bandY) / bandH;
      if (won) { const hue = 250 + Math.sin(f * 6 + t * 2.2) * 32; const li = 42 + Math.sin(f * 9 - t * 2) * 16; ctx.fillStyle = `hsl(${hue},72%,${li}%)`; }
      else { const li = 20 + Math.sin(f * 7 - t) * 7; ctx.fillStyle = `hsl(258,14%,${li}%)`; }
      ctx.globalAlpha = 0.9; ctx.fillRect(0, y, W, 5);
    }
    ctx.restore();

    // sine-scrolling verdict (Fredoka to match the duelist cracktro)
    const msg = c.text + '    ✦    ';
    const fontPx = Math.round(H * 0.052);
    ctx.font = `bold ${fontPx}px Fredoka, sans-serif`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const cyMid = bandY + bandH / 2; const mw = ctx.measureText(msg).width; const speed = won ? 105 : 46;
    const startX = W - (t * speed) % (mw + W);
    for (let rep = 0; rep < 3; rep++) {
      let cx = startX + rep * mw;
      for (const ch of msg) {
        const cw = ctx.measureText(ch).width;
        if (cx > -50 && cx < W + 50) {
          const y = cyMid + Math.sin(cx * 0.018 + t * 5) * bandH * 0.18;
          ctx.lineWidth = 5; ctx.strokeStyle = won ? '#1a0f33' : '#000'; ctx.fillStyle = won ? '#fdfbff' : '#9a93bb';
          ctx.strokeText(ch, cx, y); ctx.fillText(ch, cx, y);
        }
        cx += cw;
      }
    }
  }
}

// Scoped styles for the Intendant pad, ported from design/controller-p3.html.
let intendantStylesInjected = false;
function injectIntendantStyles() {
  if (intendantStylesInjected) return;
  intendantStylesInjected = true;
  const css = `
  .tp-intendant{ --bg0:#0c0f1c;--bg1:#1b1830;--ink:#eef0f8;--mut:#9fb0c8;--line:#2b2748;--blue:#5aa9e6;--red:#e6685a;--gold:#f5c451;--glass:rgba(255,255,255,.06);
    position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#07080f;padding:12px;
    font:14px/1.3 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);z-index:20}
  .tp-intendant *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
  .tp-intendant .ctl{width:100%;max-width:402px;aspect-ratio:9/19.5;max-height:95vh;position:relative;border-radius:24px;overflow:hidden;
    background:radial-gradient(120% 70% at 50% 0%,#2a2150 0%,var(--bg1) 44%,var(--bg0) 100%);
    box-shadow:0 20px 60px #000a, inset 0 0 0 1px #ffffff10;display:flex;flex-direction:column;padding:12px 14px}
  .tp-intendant header{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .tp-intendant .logo{width:38px;height:38px;flex:none;border-radius:9px;overflow:hidden;line-height:0;cursor:pointer}
  .tp-intendant header input{flex:1;min-width:0;font-size:clamp(18px,5vw,28px);font-weight:bold;color:var(--accent);
    background:#ffffff0d;border:1px solid #ffffff26;border-radius:10px;padding:8px 11px}
  .tp-intendant header input:focus{outline:none;border-color:var(--accent)}
  .tp-intendant .room{font-size:clamp(13px,3.6vw,18px);color:#cdd6e6;white-space:nowrap}
  .tp-intendant #hudWind{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:320px;margin:10px auto 6px}
  .tp-intendant .hud-round{font-size:clamp(12px,3.4vw,16px);color:var(--mut);min-width:46px;text-align:right}
  .tp-intendant #hudBar{position:relative;flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.12)}
  .tp-intendant #hudFill{position:absolute;top:0;height:8px;width:0;background:var(--gold)}
  .tp-intendant #hudTick{position:absolute;top:0;left:50%;transform:translateX(-50%);width:2px;height:8px;background:#ffffffaa}
  .tp-intendant .hud-pct{font-size:clamp(12px,3.4vw,16px);color:#cdd6e6;min-width:54px}
  .tp-intendant .scope{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#060a12}
  .tp-intendant canvas{display:block;width:100%;height:auto}
  .tp-intendant .stats{display:flex;align-items:center;justify-content:center;gap:12px;margin:9px 0 3px}
  .tp-intendant .chip{display:inline-flex;align-items:center;gap:8px;background:var(--glass);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-weight:800;font-variant-numeric:tabular-nums}
  .tp-intendant .chip.gold{color:var(--gold);cursor:default}
  .tp-intendant .dot{width:11px;height:11px;border-radius:50%;display:inline-block}
  .tp-intendant .b{background:var(--blue)} .tp-intendant .r{background:var(--red)}
  .tp-intendant .actblock{margin:7px 0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .tp-intendant .arow{display:flex}
  .tp-intendant .arow.r1 button{border-bottom:1px solid var(--line)}
  .tp-intendant .actblock button{flex:1;border:none;border-right:1px solid var(--line);background:var(--glass);color:var(--ink);
    padding:8px 1px 6px;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;position:relative}
  .tp-intendant .arow button:last-child{border-right:none}
  .tp-intendant .arow.r1 button:first-child{border-top-left-radius:13px} .tp-intendant .arow.r1 button:last-child{border-top-right-radius:13px}
  .tp-intendant .arow.r2 button:first-child{border-bottom-left-radius:13px} .tp-intendant .arow.r2 button:last-child{border-bottom-right-radius:13px}
  .tp-intendant .actblock button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .tp-intendant .actblock button span{font-size:10px;font-weight:700}
  .tp-intendant .actblock button.on{background:#ffffff22;color:#fff;box-shadow:inset 0 0 0 2px var(--accent)}
  .tp-intendant .actblock button.out{opacity:.34}
  .tp-intendant .actblock .ct{position:absolute;top:2px;right:3px;display:flex;gap:2px;align-items:center;font-size:10px;font-weight:800;color:#cfd3e6}
  .tp-intendant .actblock .ct .dot{width:6.5px;height:6.5px}
  .tp-intendant .bottom{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end}
  .tp-intendant .jwrap,.tp-intendant .awrap{padding:16px;display:flex;align-items:flex-end;justify-content:center}
  .tp-intendant .stick{width:138px;height:138px;border-radius:50%;position:relative;touch-action:none;
    background:radial-gradient(circle at 50% 42%,#ffffff10,#ffffff05 60%,transparent),#0d1226;border:1px solid var(--line)}
  .tp-intendant .stick .ring{position:absolute;inset:8px;border-radius:50%;border:1px dashed #ffffff14}
  .tp-intendant .stick .up{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);color:#ffffff30;font-size:13px}
  .tp-intendant .flag{position:absolute;left:50%;bottom:100%;margin-bottom:-5px;transform:translateX(-50%);pointer-events:none}
  .tp-intendant .knob{position:absolute;width:54px;height:54px;border-radius:50%;left:42px;top:50px;
    background:radial-gradient(circle at 50% 35%,#cfb6ff,#8f63d0 70%,#6f49b0);box-shadow:0 6px 16px #0008,inset 0 2px 4px #fff6}
  .tp-intendant .action{width:150px;height:118px;border-radius:20px;border:none;cursor:pointer;position:relative;overflow:hidden;
    background:linear-gradient(180deg,#b78cf3,#8a57d8);box-shadow:0 8px 22px #6f49b066,inset 0 2px 0 #fff7;display:flex;align-items:center;justify-content:center}
  .tp-intendant .action:active{transform:translateY(2px)} .tp-intendant .action.out{filter:grayscale(.6) brightness(.72)}
  .tp-intendant .action .eff{position:absolute;left:0;bottom:0;height:100%;width:0;background:#ffffff30}
  .tp-intendant .action svg{width:46px;height:46px;fill:none;stroke:#190d31;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;position:relative;z-index:2}
  .tp-intendant #status{text-align:center;color:var(--mut);font-size:12px;min-height:14px;margin-top:4px}
  /* The shared .tp-build footer is white@19%, tuned for the lobby's slate
     gradient; on the Intendant's near-black (#07080f) backdrop it vanishes, so
     lift it to match P1/P2's perceived legibility. */
  .tp-intendant .tp-build{color:#ffffff66}
  /* End-of-match cracktro: a full-card layer (clipped by .ctl's radius) with the
     fx canvas behind the stacked P1/P2 stone-tablet buttons. */
  .tp-intendant #endscreen{position:absolute;inset:0;border-radius:24px;overflow:hidden;z-index:6}
  /* Respect the [hidden] attribute: a bare display:flex here would override the
     UA stylesheet's display:none and keep this full-card layer (z-index:6)
     painted over every control, swallowing all pointer events. Only flex when
     actually shown (JS toggles endscreen.hidden on the matchEnd rising edge). */
  .tp-intendant #endscreen:not([hidden]){display:flex;flex-direction:column}
  .tp-intendant #fx{position:absolute;inset:0;width:100%;height:100%;display:block}
  .tp-intendant #endbtns{position:relative;z-index:2;margin-top:auto;display:flex;flex-direction:column;gap:12px;padding:16px;
    background:linear-gradient(180deg,transparent,rgba(5,4,11,.62) 44%)}
  /* Stone tablets: chamfered corners + chunky 3D bevel pressing into a hard base
     edge — verbatim from ControllerScene #endbtns, scoped to the Intendant. */
  .tp-intendant .endbtn{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:0;
    padding:15px 18px;font-family:inherit;font-weight:bold;font-size:clamp(16px,4.6vw,22px);letter-spacing:.4px;color:#fff;border:none;cursor:pointer;border-radius:12px;
    -webkit-clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
    clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
    transition:transform .08s ease,filter .2s ease}
  .tp-intendant .endbtn svg{width:1.15em;height:1.15em;fill:currentColor;flex:none}
  .tp-intendant .endbtn:active{filter:brightness(1.06)}
  .tp-intendant #again.endbtn{background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(0,0,0,.22)),var(--accent);
    box-shadow:inset 0 3px 0 rgba(255,255,255,.5),inset 0 -4px 10px rgba(0,0,0,.4),inset 0 0 0 2px rgba(0,0,0,.18),0 6px 0 rgba(0,0,0,.35),0 12px 22px -10px #000}
  .tp-intendant #again.endbtn:active{transform:translateY(4px);box-shadow:inset 0 3px 0 rgba(255,255,255,.5),inset 0 -4px 10px rgba(0,0,0,.4),inset 0 0 0 2px rgba(0,0,0,.18),0 2px 0 rgba(0,0,0,.35)}
  .tp-intendant #leaveEnd.endbtn{background:linear-gradient(180deg,#2a3550,#1b2438);color:#dfe8f7;font-weight:600;
    box-shadow:inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 8px rgba(0,0,0,.4),inset 0 0 0 2px rgba(255,255,255,.10),0 5px 0 rgba(0,0,0,.3)}
  .tp-intendant #leaveEnd.endbtn:active{transform:translateY(3px);box-shadow:inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 8px rgba(0,0,0,.4),inset 0 0 0 2px rgba(255,255,255,.1),0 1px 0 rgba(0,0,0,.3)}
  .tp-intendant #leaveEnd.endbtn svg{opacity:.85}`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
