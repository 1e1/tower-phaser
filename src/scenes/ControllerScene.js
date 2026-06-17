import Phaser from 'phaser';

import { COLORS, AIM, MAX_WIND, ROUND_OPTIONS } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { PHASE } from '../sim/Simulation.js';
import { injectStyles } from './LobbyScene.js';
import { drawTowerTop } from '../ui/towerTop.js';

// Phone/tablet controller. Full-viewport responsive HTML overlay showing the
// player's editable name, an animated mini view of their own tower top, the aim
// controls, the biome picker when it is this player's turn to choose, and the
// end-of-match play-again / disconnect choice. Sends intents; the server runs
// the match.
export default class ControllerScene extends Phaser.Scene {
  constructor() {
    super('Controller');
  }

  init(data) {
    this.player = data.player;
    this.code = data.code;
    this.name = data.name || `Player ${data.player + 1}`;
    this.facing = this.player === 0 ? 1 : -1;
    this.color = this.player === 0 ? COLORS.towerP1 : COLORS.towerP2;
    this.biomeChooser = data.isBiomeChooser ? this.player : -1;
    this.biomeIndex = 0;
    this.roundsIndex = 1;
    this.inMatch = false;
    this.postmatch = false;
    this.phase = null;
    this.prevPhase = null;
    this.locked = false;
    this.wind = 0;
    this.flash = 0;
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
          <input id="name" maxlength="12" value="${escapeHtml(this.name)}" />
          <span class="room">Room ${this.code}</span>
        </header>
        <div id="info"></div>

        <div id="biome" hidden>
          <div class="row"><button id="biomeL">◀</button><span id="biomeName"></span><button id="biomeR">▶</button></div>
          <div class="row"><button id="roundsL">◀</button><span id="roundsName"></span><button id="roundsR">▶</button></div>
          <div class="hint">You set the biome and rounds</div>
        </div>

        <canvas id="ttv"></canvas>

        <div id="controls" hidden>
          <label>Angle <b id="angV"></b>°</label>
          <input id="ang" type="range" min="${AIM.minAngle}" max="${AIM.maxAngle}" value="45" />
          <label>Power <b id="powV"></b>%</label>
          <input id="pow" type="range" min="0" max="100" value="50" />
          <button id="fire">VALIDATE SHOT</button>
          <div id="status"></div>
        </div>

        <div id="post" hidden>
          <div id="result"></div>
          <button id="again">Play again</button>
          <button id="leave" class="ghost">Disconnect</button>
        </div>

        <div id="banner"></div>
      </div>`;
    this.overlay = overlay;
    document.body.appendChild(overlay);
    this.$ = (id) => overlay.querySelector(`#${id}`);

    this.canvas = this.$('ttv');
    this.ctx = this.canvas.getContext('2d');
    this.angInput = this.$('ang');
    this.powInput = this.$('pow');
    this.updateValueLabels();
    this.wireEvents();
    this.startRenderLoop();

    this.track(this.client.on('roster', (m) => this.onRoster(m)));
    this.track(this.client.on('snapshot', (m) => this.onSnapshot(m)));
    this.track(this.client.on('queue', () => {}));
    this.track(this.client.on('demoted', (m) =>
      this.scene.start('Tv', { spectator: true, code: this.code, queue: m.queue }),
    ));
    this.track(this.client.on('close', () => {
      this.$('info').textContent = 'Disconnected';
    }));

    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      if (this.raf) cancelAnimationFrame(this.raf);
      overlay.remove();
    });
  }

  track(off) {
    this.unsubs.push(off);
  }

  wireEvents() {
    let nameTimer = 0;
    this.$('name').addEventListener('input', () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        this.name = this.$('name').value.trim() || `Player ${this.player + 1}`;
        this.client.send('name', { name: this.name });
      }, 300);
    });

    let throttle = 0;
    const onInput = () => {
      this.updateValueLabels();
      const now = performance.now();
      if (now - throttle > 90) {
        throttle = now;
        this.sendAim();
      }
    };
    this.angInput.addEventListener('input', onInput);
    this.powInput.addEventListener('input', onInput);
    this.$('fire').addEventListener('click', () => this.validate());

    this.$('biomeL').addEventListener('click', () => this.cycleBiome(-1));
    this.$('biomeR').addEventListener('click', () => this.cycleBiome(1));
    this.$('roundsL').addEventListener('click', () => this.cycleRounds(-1));
    this.$('roundsR').addEventListener('click', () => this.cycleRounds(1));
    this.$('again').addEventListener('click', () => this.playAgain());
    this.$('leave').addEventListener('click', () => this.client.send('leave'));
  }

  // --- aim -----------------------------------------------------------------

  sliderToPower(v) {
    return AIM.minPower + (v / 100) * (AIM.maxPower - AIM.minPower);
  }

  currentAim() {
    return {
      angle: Number(this.angInput.value),
      power: this.sliderToPower(Number(this.powInput.value)),
    };
  }

  updateValueLabels() {
    this.$('angV').textContent = Math.round(Number(this.angInput.value));
    this.$('powV').textContent = Math.round(Number(this.powInput.value));
  }

  sendAim() {
    const { angle, power } = this.currentAim();
    this.client.send('aim', { angle, power });
  }

  validate() {
    if (this.locked) return;
    this.locked = true;
    this.sendAim();
    this.client.send('ready', { value: true });
    this.sfx.blip(880);
    const btn = this.$('fire');
    btn.disabled = true;
    btn.classList.add('ready');
    btn.textContent = 'LOCKED — waiting…';
  }

  unlock() {
    this.locked = false;
    const btn = this.$('fire');
    btn.disabled = false;
    btn.classList.remove('ready');
    btn.textContent = 'VALIDATE SHOT';
  }

  // --- biome ---------------------------------------------------------------

  isChooser() {
    return this.biomeChooser === this.player && (!this.inMatch || this.postmatch);
  }

  cycleBiome(dir) {
    this.biomeIndex = (this.biomeIndex + dir + BIOMES.length) % BIOMES.length;
    this.sfx.blip(700);
    this.client.send('config', { biomeId: BIOMES[this.biomeIndex].id });
    this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
  }

  cycleRounds(dir) {
    this.roundsIndex = (this.roundsIndex + dir + ROUND_OPTIONS.length) % ROUND_OPTIONS.length;
    this.sfx.blip(620);
    this.client.send('config', { rounds: ROUND_OPTIONS[this.roundsIndex] });
    this.$('roundsName').textContent = `${ROUND_OPTIONS[this.roundsIndex]} rounds`;
  }

  playAgain() {
    this.client.send('playAgain');
    this.$('again').disabled = true;
    this.$('again').textContent = 'Waiting for opponent…';
  }

  // --- server messages -----------------------------------------------------

  onRoster(m) {
    this.biomeChooser = m.biomeChooser ?? -1;
    this.inMatch = !!m.inMatch;
    this.postmatch = !!m.postmatch;
    if (m.config) {
      const idx = BIOMES.findIndex((b) => b.id === m.config.biomeId);
      if (idx !== -1) this.biomeIndex = idx;
      const ri = ROUND_OPTIONS.indexOf(m.config.rounds);
      if (ri !== -1) this.roundsIndex = ri;
    }
    this.refresh();
  }

  onSnapshot(m) {
    const s = m.state;
    this.phase = s.phase;
    this.wind = s.wind;

    if (s.phase === PHASE.FIRING && this.prevPhase !== PHASE.FIRING) this.flash = 1;
    if (s.phase === PHASE.AIMING && this.prevPhase && this.prevPhase !== PHASE.AIMING) {
      this.unlock();
    }

    const dir = s.wind === 0 ? 'calm' : s.wind > 0 ? 'east →' : '← west';
    const strength = Math.round((Math.abs(s.wind) / MAX_WIND) * 100);
    this.$('info').textContent =
      `Round ${s.round.current}/${s.round.total}  ·  ${s.scores[0]}–${s.scores[1]}  ·  Wind ${strength}% ${dir}`;

    const opponent = s.towers[this.player === 0 ? 1 : 0];
    if (s.phase === PHASE.AIMING) {
      this.$('status').textContent = this.locked
        ? 'Waiting for opponent…'
        : opponent.ready
          ? 'Opponent ready — your move!'
          : 'Set your shot, then validate.';
    } else if (s.phase === PHASE.FIRING) {
      this.$('status').textContent = 'Shots away!';
    } else if (s.phase === PHASE.RESOLVING) {
      this.$('status').textContent = s.banner || '…';
    }

    if (s.phase === PHASE.MATCH_END) {
      // Reset the play-again control once, when the match ends.
      if (this.prevPhase !== PHASE.MATCH_END) {
        this.$('again').disabled = false;
        this.$('again').textContent = 'Play again';
      }
      this.fillResult(s);
    }

    this.prevPhase = s.phase;
    this.refresh();
  }

  fillResult(s) {
    const [s1, s2] = s.scores;
    const won = (this.player === 0 && s1 > s2) || (this.player === 1 && s2 > s1);
    const draw = s1 === s2;
    this.$('result').textContent = `${draw ? 'Draw' : won ? 'You win!' : 'You lose'}  (${s1}–${s2})`;
    this.$('banner').textContent = '';
  }

  // Central visibility based on the current phase.
  refresh() {
    const matchEnd = this.phase === PHASE.MATCH_END;
    const playing = !!this.phase && !matchEnd;
    const preMatch = !this.phase;

    this.$('controls').hidden = !playing;
    this.$('post').hidden = !matchEnd;

    const showBiome = this.isChooser();
    this.$('biome').hidden = !showBiome;
    if (showBiome) {
      this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
      this.$('roundsName').textContent = `${ROUND_OPTIONS[this.roundsIndex]} rounds`;
    }

    if (preMatch) {
      this.$('info').textContent = showBiome
        ? 'Pick a biome — waiting for the opponent…'
        : 'Waiting for the opponent to join…';
    }
  }

  // --- tower-top animation -------------------------------------------------

  startRenderLoop() {
    const loop = () => {
      this.flash = Math.max(0, this.flash - 0.04);
      this.drawView();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  drawView() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { angle, power } = this.currentAim();
    drawTowerTop(this.ctx, rect.width, rect.height, {
      angle,
      power,
      facing: this.facing,
      color: this.color,
      wind: this.wind,
      time: performance.now(),
      flash: this.flash,
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function injectControllerStyles() {
  if (document.getElementById('tp-ctl-styles')) return;
  const style = document.createElement('style');
  style.id = 'tp-ctl-styles';
  style.textContent = `
    .tp-ctl{align-items:stretch;}
    .tp-ctl-card{width:100%;max-width:560px;margin:auto;display:flex;flex-direction:column;}
    .tp-ctl header{display:flex;justify-content:space-between;align-items:center;gap:12px;}
    .tp-ctl #name{flex:1;min-width:0;font-size:clamp(22px,6vw,34px);font-weight:bold;color:var(--accent);
      background:transparent;border:none;border-bottom:2px dashed #44557a;padding:4px 2px;}
    .tp-ctl .room{font-size:clamp(13px,3.6vw,20px);color:#9fb0c8;white-space:nowrap;}
    .tp-ctl #info{font-size:clamp(15px,4.2vw,24px);margin:10px 0 4px;color:#cfe;}
    .tp-ctl #ttv{width:100%;height:30vh;min-height:160px;display:block;margin:6px 0;}
    .tp-ctl #biome{text-align:center;margin:6px 0;}
    .tp-ctl #biome .row{display:flex;align-items:center;justify-content:center;gap:18px;}
    .tp-ctl #biome button{width:auto;background:transparent;color:#fff;border:none;font-size:34px;cursor:pointer;padding:0 8px;}
    .tp-ctl #biome #biomeName{font-size:clamp(22px,6vw,32px);font-weight:bold;min-width:140px;}
    .tp-ctl #biome .hint{font-size:14px;color:#9fb0c8;margin-top:2px;}
    .tp-ctl label{display:block;font-size:clamp(18px,5vw,28px);margin:12px 0 4px;}
    .tp-ctl input[type=range]{width:100%;height:46px;accent-color:var(--accent);}
    .tp-ctl #fire,.tp-ctl #again,.tp-ctl #leave{width:100%;margin-top:18px;padding:clamp(18px,3.4vh,30px);
      font-size:clamp(20px,5.4vw,32px);font-weight:bold;border:none;border-radius:18px;
      background:var(--accent);color:#fff;cursor:pointer;}
    .tp-ctl #fire:disabled,.tp-ctl #again:disabled{background:#3a4a66;opacity:.7;}
    .tp-ctl #fire.ready{background:#2f7d32;}
    .tp-ctl .ghost{background:transparent;border:2px solid #44557a;color:#9fb0c8;}
    .tp-ctl #result{font-size:clamp(26px,7vw,40px);font-weight:bold;text-align:center;margin:8px 0;}
    .tp-ctl #status{font-size:clamp(14px,4vw,22px);margin-top:14px;color:#9fb0c8;text-align:center;min-height:26px;}
    .tp-ctl #banner{font-size:clamp(28px,8vw,46px);font-weight:bold;text-align:center;margin-top:4vh;}
  `;
  document.head.appendChild(style);
}
