import Phaser from 'phaser';

import { COLORS, AIM, MAX_WIND, WIN_OPTIONS, winsLabel, HP_OPTIONS, GAME_MODES, GAME_WIDTH } from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';
import { SHELLS } from '../config/shells.js';
import { PHASE } from '../sim/Simulation.js';
import { injectStyles, saveName, randomHandle, BUILD_LABEL, REPO_URL } from './LobbyScene.js';
import { drawTowerTop } from '../ui/towerTop.js';
import { intToCss, shade, towerPalette, BARREL_COOL, pivotCharge } from '../render/visuals.js';

// Each ammo type whistles a little differently (a slight variation): heavier
// shells sing lower, lighter shells higher. Keyed by shell id.
const WHISTLE_FREQ = { normal: 1200, heavy: 820, light: 1560, salvo: 1080, explosive: 980 };

// Phone/tablet controller. Full-viewport responsive overlay, themed to the
// current biome. Aiming is graphical: drag on the tower view to set the angle
// (direction) and power (distance). Also: shell picker, biome/round picker for
// the chooser, haptic + audio feedback, and an over-the-top end-of-match
// cracktro. The server runs the match; this only sends intents.
export default class ControllerScene extends Phaser.Scene {
  // Key is configurable so the local split-screen can run two pad instances
  // side by side ('LocalPadA'/'LocalPadB'); networked play uses the default.
  constructor(key) {
    super(key || 'Controller');
  }

  init(data) {
    this.player = data.player;
    this.code = data.code;
    this.name = data.name || randomHandle();
    this.token = data.token || null;
    // Local two-on-one-screen mode injects its own in-process transport and a
    // DOM mount/scale; absent these, the pad behaves exactly as the networked one.
    this.localClient = data.localClient || null;
    this.localSfx = data.localSfx || null; // local mode gives each pad its own audio (mutable per-pad)
    this.embed = data.embed || null; // { container: HTMLElement, scale: number }
    // Camp state must exist before applySlot so the colour starts neutral: a side
    // colour is earned by claiming a camp, never handed out by arrival order.
    this.campChooser = -1;
    this.campChosen = false;
    this.applySlot(this.player); // facing / own-tower X / side colour from the slot
    // --- pre-match setup ---
    this.isConfigOwner = !!data.isConfigOwner;
    this.setup = true;
    this.view = 'lobby'; // canonical view: 'lobby' | 'command' | 'cracktro'
    this.inSetup = true; // pre-match lobby until the first roster/snapshot says otherwise
    this.configDone = false;
    // Depth scroll: z=0 framed between two huge towers with the settings in the
    // distance; z=1 pulled back to the two small towers (the camp picker). The
    // entry position is set once per lobby (placedZ); the other player's camp
    // pick must never re-snap it.
    this.placedZ = false;
    this.z = 0;
    this.zTarget = 0;
    this.dragY = null; // active vertical drag origin, or null
    this.campPick = null; // { slot, t } crumble animation
    this.lastInteract = 0;
    this.reconnecting = false;
    this.biomeIndex = 0;
    this.roundsIndex = 1;
    this.hpIndex = 0;
    this.modeIndex = 0;
    this.livingBattlefield = false; // optional 3rd-player Intendant mode (config owner toggles it)
    this.shellIndex = 0;
    this.shotClock = null;
    this.serverReady = false;
    this.inMatch = false;
    this.postmatch = false;
    this.phase = null;
    this.prevPhase = null;
    this.locked = false;
    this.wind = 0;
    this.hp = 1;
    this.maxHp = 1;
    this.flash = 0;
    this.aimAngle = 45;
    this.aimPower = (AIM.minPower + AIM.maxPower) / 2;
    this.cracktro = null;
    this.ammo = { heavy: 1, light: 1, salvo: 1, explosive: 1, shield: 0 };
    this.roundCur = 0;
    this.hitsTaken = 0; // own-tower hits this round (drives escalating vibration)
    this.lastVibe = 0;
    this.unsubs = [];
  }

  // Slot drives side, own-tower position and the *potential* side colour. The
  // colour actually shown stays neutral until a camp is claimed (see myColor).
  // Re-derived on a camp swap (the server may move us between seats during setup).
  applySlot(slot) {
    this.player = slot;
    this.facing = slot === 0 ? 1 : -1;
    this.ownTowerX = slot === 0 ? 120 : 1280 - 120;
    this.slotColor = slot === 0 ? COLORS.towerP1 : COLORS.towerP2;
    this.color = this.myColor();
  }

  // A side has been settled (claimed by us, or the chooser is decided) — only
  // then does a player wear a colour; before that everyone reads as neutral.
  campDecided() {
    // Once a match is actually being played, both towers have a fixed side — wear
    // the slot colour even if we were auto-assigned and never tapped a camp (the
    // chooser keeps theirs; this catches the other player). The cracktro/lobby fall
    // back to the claim state below, so the rematch lobby still goes neutral.
    if (this.phase && this.phase !== PHASE.MATCH_END) return true;
    return this.campChosen || (this.campChooser != null && this.campChooser !== -1);
  }

  myColor() {
    // An in-flight pick adopts the tapped side immediately (matches the tower
    // glow), before the server's reslot lands; otherwise our settled slot colour.
    if (this.campPick) return this.campPick.slot === 0 ? COLORS.towerP1 : COLORS.towerP2;
    if (!this.campDecided()) return COLORS.towerNeutral;
    // Local fixed-seat mode: the chooser's pick colours BOTH pads — the chooser
    // wears the picked side, the OTHER wears the opposite (no more both-blue
    // collision). Networked play reslots on the server, so slotColor is already
    // the settled side there.
    if (this.localClient && this.campChooser !== this.player && this.campChooser !== -1 && this.campSide !== -1) {
      return this.campSide === 0 ? COLORS.towerP2 : COLORS.towerP1;
    }
    return this.slotColor;
  }

  // Re-tint the controller to the current side (neutral until a camp is claimed).
  // The accent threads through the name, fire button, shell highlights, aim view
  // and sync line, so the player wears their colours over the biome backdrop
  // without the screen turning monochrome or ever borrowing the rival's colour.
  applyAccent() {
    this.color = this.myColor();
    if (this.overlay) this.overlay.style.setProperty('--accent', intToCss(this.color));
  }

  create() {
    this.client = this.localClient || this.registry.get('client');
    // Controllers use the dedicated 'ctlSfx' bus (proximity SFX only) — never the
    // TV's 'sfx' bus, so they can't pick up the ambient music. Both buses are
    // unlocked by BootScene on the first gesture.
    this.sfx = this.localSfx || this.registry.get('ctlSfx') || this.registry.get('sfx');
    const hex = intToCss(this.color);

    injectStyles();
    injectControllerStyles();

    const overlay = document.createElement('div');
    overlay.className = 'tp-overlay tp-ctl';
    overlay.style.setProperty('--accent', hex);
    overlay.innerHTML = `
      <div class="tp-ctl-card">
        <header>
          <img class="tp-logo-sm" id="home" src="icon.svg" alt="" title="Leave to room select" />
          <input id="name" maxlength="14" value="${escapeHtml(this.name)}" />
          <span class="room">${this.code ? `Room ${escapeHtml(this.code)}` : ''}</span>
        </header>
        <div id="info" hidden>
          <div id="hudWind">
            <span id="hudRound" class="hud-round"></span>
            <div id="hudBar"><i id="hudFill"></i><b id="hudTick"></b></div>
            <span id="hudPct" class="hud-pct"></span>
          </div>
        </div>

        <div id="setup" hidden>
          <div id="setupSync"><span id="syncMe"></span><span id="syncOpp"></span></div>
          <div id="setupStage">
            <canvas id="setupCanvas"></canvas>
            <div id="cfg">
              <div class="row"><button id="biomeL">◀</button><span id="biomeName"></span><button id="biomeR">▶</button></div>
              <div class="row"><button id="roundsL">◀</button><span id="roundsName"></span><button id="roundsR">▶</button></div>
              <div class="row"><button id="hpL">◀</button><span id="hpName"></span><button id="hpR">▶</button></div>
              <div class="row"><button id="modeL">◀</button><span id="modeName"></span><button id="modeR">▶</button></div>
              <div class="row"><button id="lbL">◀</button><span id="lbName"></span><button id="lbR">▶</button></div>
            </div>
            <div id="scrollHint"><span>⌄</span></div>
          </div>
          <div id="setupStatus"></div>
          <button id="stepBack" class="ghost" hidden>Step back — let someone waiting take my seat</button>
          <button id="leave" class="ghost">Leave room</button>
        </div>

        <canvas id="ttv"></canvas>

        <div id="controls" hidden>
          <div id="readout">Angle 45° · Power 50%</div>
          <div id="shells" class="shellrow"><button data-shell="shield" title="Shield"><b class="ct"></b><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 3v6c0 4.2-2.9 8-7 9-4.1-1-7-4.8-7-9V5z"/></svg><span>Shield</span></button>${SHELLS.map((s, i) => `<button data-shell="${i}" title="${s.name}"><b class="ct"></b><svg viewBox="0 0 24 24" fill="currentColor">${s.svg}</svg><span>${s.name}</span></button>`).join('')}</div>
          <button id="fire"><span class="bore"></span><span class="lbl">VALIDATE SHOT</span><span class="track"><i class="drain"></i></span></button>
          <div id="status"></div>
        </div>

        <canvas id="fx" hidden></canvas>
        <div id="endbtns" hidden>
          <button id="again" class="endbtn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 7l5 5V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-7z"/></svg>
            <span>Rematch</span>
          </button>
          <button id="leaveEnd" class="endbtn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l1.4-1.4L8.83 13H16v-2H8.83l2.58-2.6L10 7l-5 5 5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z"/></svg>
            <span>Bow out</span>
          </button>
        </div>
      </div>
      <p class="tp-build"><a class="tp-build-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${BUILD_LABEL}</a></p>`;
    this.overlay = overlay;
    if (this.embed) {
      // Split-screen: drop the pad into its half-screen wrapper and scale the
      // full-viewport design down to fit. The pad keeps its vh/vw layout (which
      // still resolves to the full window) and is shrunk visually; the wrapper's
      // overflow:hidden + sizing confine both the picture and the touch area to
      // this player's region, so the two pads never steal each other's taps.
      overlay.style.position = 'absolute';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.transformOrigin = 'top left';
      overlay.style.transform = `scale(${this.embed.scale})`;
      this.embed.container.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
    this.$ = (id) => overlay.querySelector(`#${id}`);

    this.canvas = this.$('ttv');
    this.ctx = this.canvas.getContext('2d');
    this.fx = this.$('fx');
    this.fxc = this.fx.getContext('2d');
    this.stage = this.$('setupCanvas');
    this.stageCtx = this.stage.getContext('2d');

    this.rememberSession(); // so a reconnect after lock/sleep can reclaim the seat
    this.wireEvents();
    this.startRenderLoop();

    this.track(this.client.on('roster', (m) => this.onRoster(m)));
    this.track(this.client.on('snapshot', (m) => this.onSnapshot(m)));
    this.track(this.client.on('reslot', (m) => this.onReslot(m)));
    // --- connection lifecycle (lock/sleep recovery) ---
    this.track(this.client.on('close', () => this.onDisconnected()));
    this.track(this.client.on('reopen', () => this.onReopen()));
    this.track(this.client.on('rejoined', (m) => this.onRejoined(m)));
    this.track(this.client.on('rejoinFailed', () => this.goHome(true)));
    this.track(this.client.on('joined', (m) => this.onReJoinedFresh(m)));
    this.track(this.client.on('roomClosed', () => this.goHome(true)));

    this.installEscape();
    this.applyBiome();
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
      this.sfx.whistles([]); // silence any lingering shell whistles
      overlay.remove();
    });
  }

  // --- session / reconnection ----------------------------------------------

  rememberSession() {
    try {
      sessionStorage.setItem(
        'towerduel.session',
        JSON.stringify({ code: this.code, token: this.token, name: this.name }),
      );
    } catch { /* private mode */ }
  }

  forgetSession() {
    try { sessionStorage.removeItem('towerduel.session'); } catch { /* ignore */ }
  }

  onDisconnected() {
    this.reconnecting = true;
    this.refresh();
  }

  // The socket recovered. Reclaim the held seat with our token; the server falls
  // back to a fresh join if the 10s grace window already lapsed.
  onReopen() {
    if (this.token) this.client.send('rejoin', { code: this.code, token: this.token, name: this.name });
  }

  onRejoined(m) {
    if (m.slot === 2) { this.scene.start('Intendant', { code: this.code, name: this.name, token: m.token || this.token }); return; }
    this.reconnecting = false;
    if (typeof m.slot === 'number' && m.slot !== this.player) this.applySlot(m.slot);
    if (m.token) this.token = m.token;
    if (typeof m.isConfigOwner === 'boolean') this.isConfigOwner = m.isConfigOwner;
    // Come back wearing our colours, not neutral grey: restore the claimed side.
    if (typeof m.campChooser === 'number') {
      this.campChooser = m.campChooser;
      if (m.campChooser === this.player) this.campChosen = true;
    }
    this.rememberSession();
    this.applyBiome();
    this.applyAccent();
    this.refresh();
  }

  // rejoin fell back to a fresh add: keep playing if we got a seat, else spectate.
  onReJoinedFresh(m) {
    if (m.role === 'spectator') {
      this.forgetSession();
      this.scene.start('Tv', { spectator: true, code: this.code, queue: m.queue });
      return;
    }
    if (m.slot === 2) { this.scene.start('Intendant', { code: this.code, name: this.name, token: m.token || this.token }); return; }
    this.reconnecting = false;
    if (typeof m.slot === 'number') this.applySlot(m.slot);
    if (m.token) this.token = m.token;
    this.isConfigOwner = !!m.isConfigOwner;
    if (typeof m.campChooser === 'number') {
      this.campChooser = m.campChooser;
      if (m.campChooser === this.player) this.campChosen = true;
    }
    this.rememberSession();
    this.applyBiome();
    this.applyAccent();
    this.refresh();
  }

  onReslot(m) {
    if (typeof m.slot === 'number') this.applySlot(m.slot);
    if (typeof m.isConfigOwner === 'boolean') this.isConfigOwner = m.isConfigOwner;
    this.applyBiome();
    this.refresh();
  }

  // Escape on a keyboard device returns to the home screen. A TV closing tears
  // the room down (all players are sent home); a phone simply disconnects.
  installEscape() {
    if (this.embed) return; // in split-screen the host LocalScene owns the exit key
    this.escHandler = (e) => { if (e.key === 'Escape') this.goHome(); };
    window.addEventListener('keydown', this.escHandler);
  }

  goHome(skipSend = false) {
    // In split-screen the pad doesn't own the screen — hand the exit to the host
    // LocalScene, which tears down both pads + the arena and returns to the lobby.
    if (this.embed) { this.scene.get('Local')?.exit(); return; }
    if (!skipSend) this.client.send('goHome');
    this.forgetSession();
    this.token = null;
    this.scene.start('Lobby', { auto: 'join' });
  }

  track(off) { this.unsubs.push(off); }

  wireEvents() {
    let nameTimer = 0;
    this.$('name').addEventListener('input', () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        this.name = this.$('name').value.trim() || randomHandle();
        this.client.send('name', { name: this.name });
        saveName(this.name); // persist on this device for next time
        this.rememberSession();
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
      const k = btn.dataset.shell;
      btn.addEventListener('click', () => this.selectShell(k === 'shield' ? 'shield' : Number(k)));
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
    this.$('lbL').addEventListener('click', () => this.toggleBattle());
    this.$('lbR').addEventListener('click', () => this.toggleBattle());
    this.$('leave').addEventListener('click', () => this.goHome());
    // The game logo doubles as a "leave to room select" button (same on P3).
    this.$('home')?.addEventListener('click', () => this.goHome());
    this.$('stepBack').addEventListener('click', () => this.client.send('stepBack'));
    // CRACKTRO buttons: replay reveals the rematch lobby; quit leaves the room.
    this.$('again').addEventListener('click', () => this.dismissCracktro());
    this.$('leaveEnd').addEventListener('click', () => this.goHome());

    this.wireSetup();
  }

  // Depth scroll: a vertical drag (or wheel) pulls the camera back from z=0
  // (settings framed between two huge towers) to z=1 (the two small towers — the
  // camp picker). Tapping a tower at the camp end claims a side / confirms ready.
  wireSetup() {
    const stage = this.$('setupStage');
    let startY = 0;
    let startZ = 0;
    let moved = false;
    const begin = (e) => {
      if (!this.canScroll()) return;
      this.dragY = startY = e.touches ? e.touches[0].clientY : e.clientY;
      startZ = this.zTarget;
      moved = false;
    };
    const move = (e) => {
      if (this.dragY == null) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const h = stage.getBoundingClientRect().height || 1;
      // Dragging up (finger up) pulls the camera back — like scrolling down.
      this.zTarget = Phaser.Math.Clamp(startZ + (startY - y) / (h * 0.7), 0, 1);
      this.z = this.zTarget;
      if (Math.abs(y - startY) > 10) moved = true; // touch jitter tolerance: a tap stays a tap
      this.noteInteract();
      e.preventDefault();
    };
    const end = () => {
      if (this.dragY == null) return;
      this.dragY = null;
      this.snapZ(); // settle to config or camp end
    };
    stage.addEventListener('pointerdown', begin);
    stage.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    stage.addEventListener('wheel', (e) => {
      if (!this.canScroll()) return;
      this.zTarget = Phaser.Math.Clamp(this.zTarget + Math.sign(e.deltaY) * 0.34, 0, 1);
      this.noteInteract();
      this.snapZ();
      e.preventDefault();
    }, { passive: false });

    // Tap a tower at the camp end: pick a side (chooser) or confirm (others).
    // Gate on the settled intent (zTarget), not the still-animating z, so a tap
    // lands the moment the camp end is selected rather than after the lerp.
    this.stage.addEventListener('pointerup', (e) => {
      if (moved || this.zTarget < 0.5) return; // only a deliberate tap, at the camp end
      const r = this.stage.getBoundingClientRect();
      const x = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX) - r.left;
      this.tapTower(x < r.width / 2 ? 0 : 1);
    });
  }

  // --- setup flow ----------------------------------------------------------

  noteInteract() { this.lastInteract = performance.now(); }

  // Exactly one canonical view is shown at any time (the frozen state machine):
  //   LOBBY      — pre-match setup, and the rematch lobby after the cracktro
  //   COMMANDEMENT — aiming / firing, through all rounds
  //   CRACKTRO   — end-of-match fx + Rejouer/Quitter
  // (ACCUEIL lives in LobbyScene, before this scene starts.)
  computeView() {
    const matchEnd = this.phase === PHASE.MATCH_END;
    if (matchEnd && this.cracktro) return 'cracktro';
    if (this.phase && !matchEnd) return 'command';
    // No live phase yet. A reconnect (or a reload) can land here mid-match — the
    // sim is still running on the server (inMatch) but our first snapshot hasn't
    // arrived to set the phase. Hold on the command view rather than dropping into
    // the lobby and flashing the camp picker: camp choice only belongs to a genuine
    // pre-match (setup) or rematch (postmatch) lobby.
    if (this.inMatch && !this.setup && !this.postmatch) return 'command';
    return 'lobby'; // pre-match, or rematch lobby once the cracktro is dismissed
  }

  inLobby() {
    return this.view === 'lobby';
  }

  // Only the config owner moves between the settings page and the camp page; the
  // other player is held on the camp page (no access to the settings). The owner
  // keeps this freedom throughout the lobby — a camp pick never locks them out.
  canScroll() {
    return this.inLobby() && this.isConfigOwner;
  }

  // Resolve what this player does in the lobby, from the roster state. Page 2 is
  // "fastest wins" for both personas, so the Rival may also claim a side.
  //   config-chooser : Architect — owns page 1 AND has/claims the camp
  //   config-only    : Architect — owns page 1, opponent took the camp first
  //   camp-chooser   : Rival — may claim the camp (no page-1 access)
  //   camp-taken     : Rival — the Architect took the camp first; locked to the rest
  setupRole() {
    const me = this.player;
    if (this.campChooser === -1) {
      return this.isConfigOwner ? 'config-chooser' : 'camp-chooser';
    }
    if (this.isConfigOwner) return this.campChooser === me ? 'config-chooser' : 'config-only';
    return this.campChooser === me ? 'camp-chooser' : 'camp-taken';
  }

  setZ(z) {
    this.zTarget = z;
    this.noteInteract();
  }

  // Settle the scroll to whichever end is closer. For the config owner, crossing
  // into the camp end validates the settings; scrolling back to the settings
  // page retracts that validation, so the match cannot start while the owner is
  // still on page 1 (even if the rival has already claimed a side).
  snapZ() {
    const goCamp = this.zTarget >= 0.5;
    if (this.isConfigOwner && goCamp !== this.configDone) {
      this.configDone = goCamp;
      this.client.send('configDone', { value: goCamp });
    }
    this.setZ(goCamp ? 1 : 0);
  }

  // A tower was tapped at the camp end. Only a chooser may claim a side; the
  // config-only Architect and the camp-taken Rival have nothing to tap.
  tapTower(slot) {
    // Camp choice is only ever valid in a genuine lobby (pre-match setup or the
    // post-match rematch) — never mid-match. This mirrors the server's own guard
    // so a reconnecting device that briefly renders the picker can't claim a side.
    if (!this.setup && !this.postmatch) return;
    const role = this.setupRole();
    if ((role === 'config-chooser' || role === 'camp-chooser') && !this.campChosen) {
      this.chooseCampSlot(slot);
    }
  }

  chooseCampSlot(slot) {
    if (this.campChosen) return;
    this.campChosen = true;
    this.campPick = { slot, t: 0 }; // drives the "other tower crumbles" animation
    this.sfx.blip(880);
    this.client.send('camp', { slot });
    this.refresh();
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

  // A burst of muzzle smoke + a flash from the FIRE button's cannon bore, the
  // instant our shot leaves the barrel. Particles are short-lived DOM nodes on
  // the body (so they can drift past the button), centred on the bore.
  fireSmoke() {
    const bore = this.overlay && this.overlay.querySelector('#fire .bore');
    if (!bore) return;
    const r = bore.getBoundingClientRect();
    if (!r.width) return;
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    const flash = document.createElement('div');
    flash.className = 'tp-mflash';
    flash.style.left = `${ox}px`;
    flash.style.top = `${oy}px`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 240);
    for (let i = 0; i < 8; i += 1) {
      const p = document.createElement('div');
      p.className = 'tp-puff';
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.3; // upward fan
      const dist = 26 + Math.random() * 56;
      const s = 9 + Math.random() * 16;
      p.style.left = `${ox}px`;
      p.style.top = `${oy}px`;
      p.style.width = `${s}px`;
      p.style.height = `${s}px`;
      p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * dist - 16}px`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }

  // The validate/cancel button: label, the turbo shot-clock countdown bar, and
  // the escalating-shake urgency. Updates the inner .lbl/.drain (never the button
  // text directly, which would wipe the bore/track elements).
  renderFireButton() {
    const btn = this.$('fire');
    const lbl = btn.querySelector('.lbl');
    const drain = btn.querySelector('.drain');
    // Classic: once the volley is away it is inert until the next aim. Cover
    // RESOLVING too, otherwise the order lock (still set) would briefly show
    // "✖ Cancel order" between the shells landing and the next AIMING phase.
    if ((this.phase === PHASE.FIRING || this.phase === PHASE.RESOLVING) && !this.turbo) {
      this.locked = false; // drop the stale order lock so AIMING re-arms cleanly
      btn.disabled = true;
      btn.classList.remove('waiting', 'urgent', 'hasclock');
      btn.style.removeProperty('--shk');
      lbl.textContent = 'Firing…';
      return;
    }
    btn.disabled = false;
    const sc = this.shotClock;
    const clock = sc != null ? ` ${sc.toFixed(1)}s` : '';
    btn.classList.toggle('waiting', this.locked);
    const urgent = !this.locked && sc != null && sc <= 2;
    btn.classList.toggle('urgent', urgent);

    // Shot-clock bar: drains from full to empty over the mode's cadence.
    btn.classList.toggle('hasclock', sc != null);
    if (drain) {
      const max = GAME_MODES[this.modeIndex]?.cadence || 8;
      drain.style.width = sc != null ? `${Math.max(0, Math.min(1, sc / max)) * 100}%` : '100%';
    }
    // Escalating shake: amplitude grows as the last 2s tick away (~0.8px → ~4px).
    if (urgent) btn.style.setProperty('--shk', `${(0.8 + (2 - sc) * 1.6).toFixed(2)}px`);
    else btn.style.removeProperty('--shk');

    if (this.locked) lbl.textContent = `✖ Cancel${sc != null ? ` ·${clock}` : ' order'}`;
    else if (this.shellIndex === 'shield') lbl.textContent = sc != null ? `🛡 DEPLOY${clock}` : '🛡 DEPLOY SHIELD';
    else lbl.textContent = sc != null ? `🔥 FIRE!${clock}` : 'VALIDATE SHOT';
  }

  // --- pickers -------------------------------------------------------------

  selectShell(idx) {
    if (idx === 'shield') {
      if ((this.ammo?.shield || 0) <= 0) return; // no shield in stock
      this.shellIndex = 'shield';
      this.sfx.blip(620);
      this.client.send('shell', { id: 'shield' });
      this.updateShellUI();
      this.renderFireButton();
      return;
    }
    const shell = SHELLS[idx];
    if (shell.id !== 'normal' && (this.ammo?.[shell.id] || 0) <= 0) return; // out of stock
    this.shellIndex = idx;
    this.sfx.blip(560);
    this.client.send('shell', { id: shell.id });
    this.updateShellUI();
    this.renderFireButton();
  }

  // Stock badges (∞ for normal, a count for specials + the shield) + greying out
  // empty entries + active highlight.
  updateShellUI() {
    this.overlay.querySelectorAll('#shells button').forEach((btn) => {
      const k = btn.dataset.shell;
      if (k === 'shield') {
        const n = this.ammo?.shield ?? 0;
        btn.querySelector('.ct').textContent = String(n);
        btn.classList.toggle('out', n <= 0);
        btn.classList.toggle('on', this.shellIndex === 'shield');
        return;
      }
      const i = Number(k);
      const shell = SHELLS[i];
      const unlimited = shell.id === 'normal';
      const n = unlimited ? Infinity : this.ammo?.[shell.id] ?? 1;
      btn.querySelector('.ct').textContent = unlimited ? '∞' : String(n);
      btn.classList.toggle('out', !unlimited && n <= 0);
      btn.classList.toggle('on', i === this.shellIndex);
    });
  }

  // Who may edit the match settings: the config owner (first player before the
  // first match, the loser between matches).
  canEditConfig() {
    return this.inLobby() && this.isConfigOwner;
  }

  cycleBiome(dir) {
    if (!this.canEditConfig()) return;
    this.biomeIndex = (this.biomeIndex + dir + BIOMES.length) % BIOMES.length;
    this.sfx.blip(700);
    this.client.send('config', { biomeId: BIOMES[this.biomeIndex].id });
    this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
    this.applyBiome();
  }

  cycleRounds(dir) {
    if (!this.canEditConfig()) return;
    this.roundsIndex = (this.roundsIndex + dir + WIN_OPTIONS.length) % WIN_OPTIONS.length;
    this.sfx.blip(620);
    this.client.send('config', { wins: WIN_OPTIONS[this.roundsIndex] });
    this.$('roundsName').textContent = winsLabel(WIN_OPTIONS[this.roundsIndex]);
  }

  cycleHp(dir) {
    if (!this.canEditConfig()) return;
    this.hpIndex = (this.hpIndex + dir + HP_OPTIONS.length) % HP_OPTIONS.length;
    this.sfx.blip(580);
    this.client.send('config', { hp: HP_OPTIONS[this.hpIndex] });
    this.$('hpName').textContent = hpLabel(HP_OPTIONS[this.hpIndex]);
  }

  cycleMode(dir) {
    if (!this.canEditConfig()) return;
    this.modeIndex = (this.modeIndex + dir + GAME_MODES.length) % GAME_MODES.length;
    const m = GAME_MODES[this.modeIndex];
    this.sfx.blip(660);
    this.client.send('config', { turbo: m.turbo, cadence: m.cadence });
    this.$('modeName').textContent = m.label;
  }

  // Toggle the optional living-battlefield (3rd-player Intendant) mode. A single
  // boolean: either arrow flips it. When on, the 3rd phone to join becomes the
  // Intendant instead of queueing as a spectator (server-side).
  toggleBattle() {
    if (!this.canEditConfig()) return;
    this.livingBattlefield = !this.livingBattlefield;
    this.sfx.blip(640);
    this.client.send('config', { livingBattlefield: this.livingBattlefield });
    this.$('lbName').textContent = battleLabel(this.livingBattlefield);
  }

  // Tint the controller to the current biome (dark enough to keep text legible).
  applyBiome() {
    const biome = BIOMES[this.biomeIndex] || BIOMES[0];
    const top = intToCss(shade(biome.sky[0], 0.38));
    this.overlay.style.background = `linear-gradient(180deg, ${top}, #0b1020)`;
  }

  // --- server messages -----------------------------------------------------

  onRoster(m) {
    const wasInMatch = this.inMatch;
    const wasPostmatch = this.postmatch;
    this.inMatch = !!m.inMatch;
    this.postmatch = !!m.postmatch;
    this.setup = !!m.setup;
    this.configDone = !!m.configDone;
    this.campChooser = m.campChooser ?? -1;
    this.campSide = m.campSide ?? -1; // local: the side the chooser picked (so the other pad wears the opposite)
    this.queueSize = m.queue || 0; // waiting spectators — gates the Step-back affordance
    this.roster = m.players || [];
    this.isConfigOwner = !!this.roster[this.player]?.isConfigOwner;
    this.oppConnected = !!this.roster[this.player === 0 ? 1 : 0]?.connected;
    this.inSetup = this.setup && !this.inMatch;

    if (m.config) {
      const bi = BIOMES.findIndex((b) => b.id === m.config.biomeId);
      if (bi !== -1) { this.biomeIndex = bi; this.applyBiome(); }
      const ri = WIN_OPTIONS.indexOf(m.config.wins);
      if (ri !== -1) this.roundsIndex = ri;
      const hi = HP_OPTIONS.indexOf(m.config.hp);
      if (hi !== -1) this.hpIndex = hi;
      const mi = GAME_MODES.findIndex((g) => g.turbo === m.config.turbo && (!g.turbo || g.cadence === m.config.cadence));
      if (mi !== -1) this.modeIndex = mi;
      if (typeof m.config.livingBattlefield === 'boolean') this.livingBattlefield = m.config.livingBattlefield;
    }

    // The match was aborted (opponent left) and the room is back to the lobby:
    // drop the match state and re-place us in the depth scene.
    if (!m.inMatch && (this.phase || wasInMatch)) {
      this.phase = null;
      this.prevPhase = null;
      this.clearEndScreen();
      this.unlock();
      this.campChosen = false;
      this.campPick = null;
      this.placedZ = false;
    }

    // Match just ended: the server releases the camp (campChooser → -1), but BOTH
    // players must keep their own colours through the cracktro — not just the one
    // who had tapped to claim a side. We latch campChosen here so the auto-assigned
    // player doesn't snap to neutral the instant the chooser is cleared; neutral is
    // only applied once they tap Rematch (dismissCracktro) or Bow out (goHome).
    if (this.postmatch && !wasPostmatch) {
      this.campChosen = true;
    }

    // Reconcile the optimistic local camp pick with the authoritative chooser.
    // When the camp is released for a rematch (campChooser back to -1), we do NOT
    // reset here: the player keeps their colours through the end-of-match cracktro
    // and only goes neutral once they tap Rematch (see dismissCracktro) — or the
    // match was aborted, handled by the !inMatch reset above.
    if (this.campChooser === this.player) {
      this.campChosen = true;
    } else if (this.campChooser !== -1) {
      // Lost the first-tap race: drop our optimistic pick and settle to the rest.
      this.campChosen = false;
      this.campPick = null;
    }
    this.refresh();
  }

  onSnapshot(m) {
    const s = m.state;
    const me = s.towers[this.player];
    this.phase = s.phase;
    this.wind = s.wind;
    // Our tower now slides along its platform per round: track the authoritative
    // x so proximity audio/haptics fire from the real cannon position.
    if (me.x != null) this.ownTowerX = me.x;

    if (s.round.current !== this.roundCur) { this.roundCur = s.round.current; this.hitsTaken = 0; }
    // Own tower health drives the damage/ruin look on the controller's tower view.
    this.maxHp = s.maxHp || 1;
    this.hp = me.hp == null ? this.maxHp : me.hp;
    if (me.ammo) this.ammo = me.ammo;
    if (me.shell === 'shield') {
      this.shellIndex = 'shield';
    } else {
      const si = SHELLS.findIndex((x) => x.id === me.shell);
      if (si !== -1) this.shellIndex = si;
    }
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
      this.renderHud(s);

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
      this.startCracktro(s);
    }
    if (s.phase !== PHASE.MATCH_END && this.cracktro) this.clearEndScreen();

    this.prevPhase = s.phase;
    this.refresh();
  }

  // The in-match HUD line under the player's name: a centre-anchored wind gauge,
  // same design as the Battlefield score bar. The score itself is rendered as
  // spoils around the aiming tower on the canvas (trophies won / rubble lost).
  renderHud(s) {
    this.wins = s.scores[this.player] | 0;
    this.losses = s.scores[this.player === 0 ? 1 : 0] | 0;

    this.$('hudRound').textContent = `${s.round.current}/${s.round.total}`;
    const ratio = Math.min(Math.abs(s.wind) / MAX_WIND, 1);
    const pct = Math.round(ratio * 100);
    this.$('hudPct').textContent = s.wind === 0 ? 'calm' : `${pct}% ${s.wind > 0 ? '→' : '←'}`;
    const fill = this.$('hudFill');
    if (ratio < 0.005) {
      fill.style.width = '0';
    } else if (s.wind > 0) {
      fill.style.left = '50%'; fill.style.right = 'auto';
      fill.style.width = `${ratio * 50}%`;
      fill.style.borderRadius = '0 4px 4px 0';
    } else {
      fill.style.right = '50%'; fill.style.left = 'auto';
      fill.style.width = `${ratio * 50}%`;
      fill.style.borderRadius = '4px 0 0 4px';
    }
  }

  vibe(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern); // no-op / unsupported on iOS
  }

  // Audio + haptics from the POV of this player's own tower: events near the
  // opponent's tower make no sound on this phone.
  feedback(events, me) {
    const ox = this.ownTowerX;
    const oy = (me?.groundY ?? 600) - 48;
    // Mic range from this tower, shared by near() AND the listener below. It MUST
    // live in feedback's scope: a previous version declared it inside near(), so
    // the setListener call referencing `thr` threw a ReferenceError every tick —
    // which silently aborted feedback() before it could drop the fire lock (so
    // the button stuck on "Cancel order") and before any spatial SFX played.
    const thr = 560;
    const near = (x, y) => {
      // Pythagoras tells us the distance is sqrt(dx²+dy²), but the square root
      // is the costly part — and we only need it when the impact is in range.
      // So compare the *squared* distance first and reach for sqrt only inside.
      const dx = x - ox;
      const dy = y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= thr * thr) return 0;
      return 1 - Math.sqrt(d2) / thr;
    };
    // Living-world SFX heard from THIS tower (mic). spatial() returns null when
    // out of range → the centre-of-map Intendant actions stay silent on a phone.
    this.sfx.setListener({ mode: 'mic', x: ox, y: oy, range: thr });
    const sp = (ev) => this.sfx.spatial({ x: ev.x, y: ev.y });
    for (const e of events) {
      if (e.type === 'fire') {
        if (e.owner === this.player) {
          this.sfx.boomModern(); this.vibe(35); // only my own cannon
          this.fireSmoke(); // smoke + flash burst from the FIRE button's cannon bore
          // Our shot is away: drop the order lock so the button returns to
          // "FIRE/VALIDATE" instead of staying stuck on "Cancel order". In turbo
          // there is no phase change to re-arm on, so this event is what does it.
          if (this.locked) this.unlock();
        }
      } else if (e.type === 'impact') {
        const v = near(e.x, e.y);
        if (v > 0.05) this.sfx.explosionModern({ vol: v }); // only impacts near my tower, scaled
      } else if (e.type === 'hit') {
        if (e.target === this.player) {
          this.sfx.rubbleModern({ vol: 0.7 }); // one rubble on MY tower; opponent hits are silent here
          this.hitsTaken += 1;
          const p = [];
          for (let i = 0; i < this.hitsTaken; i += 1) { p.push(230); if (i < this.hitsTaken - 1) p.push(110); }
          this.vibe(p);
        }
      } else if (e.type === 'destroyed') {
        if (e.tower === this.player) this.sfx.rubbleModern(); // my tower falling: longer collapse
      } else if (e.type === 'shield') {
        if (e.owner === this.player) { this.sfx.shieldUp(); this.vibe(30); if (this.locked) this.unlock(); }
      } else if (e.type === 'shieldHit') {
        if (e.owner === this.player) { this.sfx.shieldBlock(); this.vibe([20, 40, 30]); } // my shield saved me
      } else if (e.type === 'musket' || e.type === 'grenadeLob' || e.type === 'grenadeBurst' || e.type === 'fieldFire' || e.type === 'melee' || e.type === 'soldierDeath' || e.type === 'intParry' || e.type === 'intFatal' || e.type === 'intBuild' || e.type === 'intDig' || e.type === 'horde'
        || e.type === 'cannonWreck' || e.type === 'projGround' || e.type === 'projFlesh' || e.type === 'intBow' || e.type === 'intSword' || e.type === 'intHurt' || e.type === 'towerVolley' || e.type === 'apparition' || e.type === 'glide') {
        this.sfx.playEvent(e, sp(e)); // spatial() returns null out of mic range → skipped
      }
    }
  }

  // The tower is a "mic": every airborne shell whistles, but only within 20% of
  // the screen width of THIS player's tower — loudest right at the tower, silent
  // at the edge of range. Each shell is its own voice (a triple salvo = three
  // overlapping whistles), and it plays whenever shells are up: classic (FIRING)
  // and turbo (shells fly during AIMING). A shell launching from here is loud
  // then fades as it leaves; an incoming one swells as it nears.
  proximity(s, me) {
    const ox = this.ownTowerX;
    const oy = (me.groundY ?? 600) - 48;
    const range = GAME_WIDTH * 0.20; // mic range = 20% of the screen width
    const r2 = range * range;
    const voices = [];
    let nearest = 0;
    // Compare squared distances first; take the one sqrt only when in range.
    const add = (id, x, y, freq) => {
      const dx = x - ox; const dy = y - oy; const d2 = dx * dx + dy * dy;
      if (d2 >= r2) return; // out of mic range -> no sound
      const intensity = 1 - Math.sqrt(d2) / range; // 1 at the tower, 0 at the edge
      voices.push({ id, intensity, freq });
      if (intensity > nearest) nearest = intensity;
    };
    for (const p of s.projectiles) add(p.id, p.x, p.y, WHISTLE_FREQ[p.shell] ?? WHISTLE_FREQ.normal);
    // Living-world projectiles whistle past too (musket zip, lobbed grenade, boulet).
    const bf = s.battlefield;
    if (bf) for (const p of bf.projectiles) add(`b${p.id}`, p.x, p.y, p.musket ? 3000 : p.gren ? 900 : p.bolt ? 1800 : p.fromI ? 1500 : 600);
    this.sfx.whistles(voices);
    // Proximity haptic buzz tracks the closest shell in range (throttled).
    if (nearest > 0.06) {
      const now = performance.now();
      if (now - this.lastVibe > 110) {
        this.lastVibe = now;
        this.vibe(Math.round(8 + nearest * 55));
      }
    }
  }

  // Skip / finish the cracktro: wipe it and reveal the rematch lobby underneath.
  // This is where the finished match's side is dropped — colours are kept through
  // the whole cracktro and only go neutral now (on Rematch), so both towers stand
  // again for a fresh pick.
  dismissCracktro() {
    this.clearEndScreen();
    this.campChosen = false;
    this.campPick = null;
    this.applyAccent();
    this.refresh();
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
    this.view = this.computeView();
    const v = this.view;

    this.applyAccent(); // neutral until a camp is claimed, then the side colour

    this.$('setup').hidden = v !== 'lobby';
    // Step back: cede my seat to a waiting player (non-owner only — a promoted
    // player can't inherit lobby ownership, so the owner must Leave instead).
    this.$('stepBack').hidden = !(v === 'lobby' && this.queueSize > 0 && !this.isConfigOwner);
    this.$('controls').hidden = v !== 'command';
    this.fx.hidden = v !== 'cracktro';
    this.$('endbtns').hidden = v !== 'cracktro';
    this.canvas.style.display = v === 'command' ? 'block' : 'none'; // aim view only mid-match
    this.$('info').hidden = v !== 'command';

    this.overlay.classList.toggle('reconnecting', !!this.reconnecting);
    if (v === 'lobby') this.renderSetup();
    else this.placedZ = false; // re-place on the next lobby entry
    this.updateShellUI();
    if (v === 'command') this.updateReadout();
  }

  // Drive the depth-scene lobby (pre-match and rematch alike): config labels +
  // editability, the one-time entry placement, the scroll hint and status line.
  renderSetup() {
    this.$('biomeName').textContent = BIOMES[this.biomeIndex].name;
    this.$('roundsName').textContent = winsLabel(WIN_OPTIONS[this.roundsIndex]);
    this.$('hpName').textContent = hpLabel(HP_OPTIONS[this.hpIndex]);
    this.$('modeName').textContent = GAME_MODES[this.modeIndex].label;
    this.$('lbName').textContent = battleLabel(this.livingBattlefield);
    this.$('cfg').classList.toggle('locked', !this.canEditConfig());

    const status = this.$('setupStatus');
    this.renderSync();

    // Place the camera once per lobby: the config owner starts on the settings
    // (page 1), everyone else on the camp page (page 2). Never re-snap after —
    // the other player's camp pick must not move us.
    if (!this.placedZ) {
      this.setZ(this.isConfigOwner ? 0 : 1);
      this.placedZ = true;
    }

    const role = this.setupRole();
    this.$('scrollHint').hidden = !(this.canScroll() && this.zTarget < 0.5);

    // Colour says which side you are on — never spell out "blue"/"red".
    if (role === 'config-chooser') {
      status.textContent = this.zTarget < 0.5
        ? 'Set up the match, then scroll down to pick your tower'
        : (this.campChosen ? 'Your tower is set — starting soon' : 'Tap a tower to claim it');
    } else if (role === 'config-only') {
      status.textContent = this.zTarget < 0.5
        ? 'Set up the match — your rival claimed a side'
        : 'Your rival picked first — starting soon';
    } else if (role === 'camp-chooser') {
      status.textContent = this.campChosen ? 'Your tower is set — waiting…' : 'Tap a tower to claim it';
    } else { // camp-taken
      status.textContent = 'Your side is set — waiting for the start…';
    }
  }

  // Persistent two-sided line shown in the lobby, so each player sees the other's
  // state (joining / setting up / side claimed).
  renderSync() {
    const oppSlot = this.player === 0 ? 1 : 0;
    const oppEl = this.$('syncOpp');
    const meDone = this.campChosen || (this.isConfigOwner && this.configDone && this.zTarget >= 0.5);
    this.$('syncMe').textContent = meDone ? 'You · ready ✓' : 'You · setting up…';
    oppEl.classList.remove('ready', 'off');
    if (!this.oppConnected) {
      oppEl.textContent = 'Opponent · not here yet';
      oppEl.classList.add('off');
    } else if (this.campChooser === oppSlot) {
      oppEl.textContent = 'Opponent · side claimed ✓';
      oppEl.classList.add('ready');
    } else {
      oppEl.textContent = 'Opponent · setting up…';
    }
  }

  // --- rendering -----------------------------------------------------------

  startRenderLoop() {
    const loop = () => {
      this.flash = Math.max(0, this.flash - 0.04);
      if (this.phase === PHASE.FIRING && this.prevFireSeen !== true) { this.flash = 1; this.prevFireSeen = true; }
      if (this.phase !== PHASE.FIRING) this.prevFireSeen = false;
      this.drawView();
      if (this.$ && !this.$('setup').hidden) this.drawSetupStage();
      if (this.cracktro) this.drawCracktro();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // --- setup depth scene ---------------------------------------------------

  // One continuous depth space. z=0: the settings panel is in focus, framed by
  // two huge towers whose inner edges bleed in from the screen sides. Pulling
  // back (z→1) shrinks the towers and draws them together into the camp picker
  // while the settings recede and fade out.
  drawSetupStage() {
    const t = performance.now();
    if (this.dragY == null) this.z += (this.zTarget - this.z) * 0.16;

    // Portcullis target: lowered (closed, 0) in classic duel, raised (open, 1)
    // in living battlefield. Eased so the grille only ANIMATES when the mode is
    // toggled, and sits still otherwise.
    const herseTarget = this.livingBattlefield ? 1 : 0;
    if (this._herseOpen == null) this._herseOpen = herseTarget;
    else this._herseOpen += (herseTarget - this._herseOpen) * 0.12;

    // Page 1 holds perfectly still — the bobbing scroll-hint arrow is enough of
    // an invitation to pull back; the towers must not drift on their own.
    const z = Phaser.Math.Clamp(this.z, 0, 1);

    // Settings panel recedes and dissolves as we pull back; once faded it lets
    // taps through to the towers behind it.
    const cfg = this.$('cfg');
    const fade = Phaser.Math.Clamp(1 - z / 0.55, 0, 1);
    cfg.style.opacity = String(fade);
    // Keep the centring translate (CSS uses top/left:50% + translate(-50%,-50%));
    // overriding transform with scale() alone would drop it and shift the panel.
    cfg.style.transform = `translate(-50%,-50%) scale(${0.78 + 0.22 * fade})`;
    cfg.style.pointerEvents = fade > 0.3 ? 'auto' : 'none';

    const r = this.fitCanvas(this.stage, this.stageCtx);
    if (!r) return;
    const ctx = this.stageCtx;
    const W = r.width;
    const H = r.height;
    ctx.clearRect(0, 0, W, H);

    // ground shimmer
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, H * 0.9, W, H * 0.1);

    if (this.campPick) this.campPick.t = Math.min(1, this.campPick.t + 0.05);
    // The viewer's side is settled once a camp has been claimed (by them or the
    // chooser); the framing towers then reflect it even from page 1.
    const settled = this.campPick ||
      (this.setupRole() !== 'config-chooser' && this.setupRole() !== 'camp-chooser' &&
       this.campChooser >= 0);
    const colors = [COLORS.towerP1, COLORS.towerP2];
    // The slot we'll end up in — the tapped side wins immediately, before the
    // server's reslot lands, so the glow/crumble never flickers inverted.
    const mySlot = this.campPick ? this.campPick.slot : this.player;

    for (let slot = 0; slot < 2; slot += 1) {
      // Depth interpolation: huge & at the edges up close → small & centred far.
      const baseY = (H * 0.96) - (1 - z) * H * 0.06;
      const h = H * (1.5 - z * 1.0); // 1.5H close, 0.5H pulled back
      const w = Math.max(40, W * (0.5 - z * 0.32));
      const edgeX = slot === 0 ? -W * 0.06 : W * 1.06; // inner edge bleeds in
      const campX = slot === 0 ? W * 0.3 : W * 0.7;
      const cx = edgeX + (campX - edgeX) * z;
      const facing = slot === 0 ? 1 : -1;

      let oy = 0;
      let alpha = 1;
      let glow = 0;
      const crumbling = settled && slot !== mySlot;
      if (crumbling) {
        const ct = this.campPick ? this.campPick.t : 1;
        oy = ct * h * 0.5;
        alpha = (1 - ct) * z; // only visible once pulled back, then falls away
      } else if (settled && slot === mySlot) {
        glow = colors[slot]; // your standing tower
      }
      // Fade the framing towers in slightly as we approach the camp end so the
      // picker reads cleanly.
      drawTowerGlyph(ctx, cx, baseY + oy, w, h, colors[slot], facing, {
        time: t, fuse: z > 0.6 && !crumbling, alpha, glow, herse: this._herseOpen,
      });

    }
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
      biome: BIOMES[this.biomeIndex], // themes the mountain backdrop
      wins: this.wins | 0, losses: this.losses | 0,
      hp: this.hp, maxHp: this.maxHp,
      // Camp banner standing where the windsock used to: the first seat
      // (players[0]) flies an étendard, the second a gonfalon.
      banner: this.player === 0 ? 'standard' : 'gonfalon',
      // Fuse sparks while our shot is committed and waiting (locked locally or
      // confirmed ready by the server); it goes out the moment the volley fires.
      ready: (this.locked || this.serverReady) && this.phase === PHASE.AIMING,
    });
    if (this.phase === PHASE.AIMING && !this.locked) {
      if (this.shellIndex === 'shield') this.drawShieldPreview(r.width, r.height);
      else this.drawAimGuide(r.width, r.height);
    }
  }

  // Preview the deflecting plate where the shield will be deployed: along the aim
  // direction, at a distance set by power, perpendicular to that line.
  drawShieldPreview(w, h) {
    const ctx = this.ctx;
    const pivot = { x: w / 2, y: h * 0.48 };
    const maxR = h * 0.42;
    const ratio = (this.aimPower - AIM.minPower) / (AIM.maxPower - AIM.minPower);
    const rad = (this.aimAngle * Math.PI) / 180;
    const dx = this.facing * Math.cos(rad);
    const dy = -Math.sin(rad);
    const hx = pivot.x + dx * maxR * ratio;
    const hy = pivot.y + dy * maxR * ratio;
    const ux = -dy; const uy = dx; // plate axis (perpendicular to aim)
    const L = Math.max(20, h * 0.12);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#dfe6f2'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hx + ux * L, hy + uy * L); ctx.lineTo(hx - ux * L, hy - uy * L); ctx.stroke();
    ctx.strokeStyle = intToCss(this.color); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hx + ux * L, hy + uy * L); ctx.lineTo(hx - ux * L, hy - uy * L); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawAimGuide(w, h) {
    const ctx = this.ctx;
    const pivot = { x: w / 2, y: h * 0.48 };
    const maxR = h * 0.42;
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
    ctx.strokeStyle = intToCss(this.color);
    ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 7); ctx.fill();
    ctx.strokeStyle = intToCss(this.color);
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

    // The winner's phone gets a victory bugle; the loser already heard their own
    // tower collapse, so it stays silent (no salt in the wound).
    if (won) this.sfx.fanfare();
    // The rematch lobby is revealed only when the player taps Rejouer (no timer).
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

// Label for the living-battlefield toggle row in the lobby config.
function battleLabel(on) {
  return on ? '⚔ Living battlefield' : 'Classic duel';
}

// A compact stone tower for the setup screens (peek + camp picker). Mirrors the
// TV battlefield tower: a masonry body (running-bond courses), crenellations with
// mortar joints, relief shading, and a raised barrel whose length/width track the
// body so it scales correctly at any size. Optional calm fuse ember + side glow.
function drawTowerGlyph(ctx, cx, baseY, w, h, color, facing, o = {}) {
  const bx = cx - w / 2;
  const by = baseY - h;
  const baseAlpha = o.alpha != null ? o.alpha : 1;
  const bodyCss = intToCss(color);
  const pal = towerPalette(color);
  const mortarCss = intToCss(pal.mortar);
  const litCss = intToCss(pal.lit);
  const darkCss = intToCss(pal.dark);
  const joint = Math.max(1, w * 0.02);

  ctx.save();
  ctx.globalAlpha = baseAlpha;
  if (o.glow) {
    ctx.shadowColor = intToCss(o.glow);
    ctx.shadowBlur = 22;
  }

  // Stone body.
  roundRect(ctx, bx, by, w, h, 6);
  ctx.fillStyle = bodyCss;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Masonry: offset courses drawn as mortar joints, clipped to the body.
  ctx.save();
  roundRect(ctx, bx, by, w, h, 6);
  ctx.clip();
  ctx.strokeStyle = mortarCss;
  ctx.lineWidth = joint;
  const rowH = Math.max(10, h / 7);
  const blockW = Math.max(14, w / 2.4);
  let row = 0;
  for (let y = by + rowH; y < by + h; y += rowH, row += 1) {
    ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + w, y); ctx.stroke();
    const off = (row % 2) * (blockW / 2);
    for (let x = bx + off; x < bx + w; x += blockW) {
      if (x <= bx) continue;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
    }
  }
  // Top highlight + base shadow for relief.
  ctx.globalAlpha = baseAlpha * 0.5;
  ctx.fillStyle = litCss;
  ctx.fillRect(bx, by, w, Math.max(2, h * 0.03));
  ctx.globalAlpha = baseAlpha * 0.18;
  ctx.fillStyle = '#000000';
  ctx.fillRect(bx, by + h - Math.max(4, h * 0.06), w, Math.max(4, h * 0.06));
  ctx.restore();

  // Sally-port at the foot — now ALWAYS present (was living-battlefield only),
  // fitted with an animated portcullis (herse) that slowly raises and lowers.
  {
    const dw = w * 0.34;
    const dh = Math.min(h * 0.4, dw * 1.3);
    const dx = cx - dw / 2;
    const dy = baseY - dh;
    const r = dw / 2;
    const arch = () => {
      ctx.beginPath();
      ctx.moveTo(dx, baseY);
      ctx.lineTo(dx, dy + r);
      ctx.arc(dx + r, dy + r, r, Math.PI, Math.PI * 2, false);
      ctx.lineTo(dx + dw, baseY);
      ctx.closePath();
    };
    ctx.globalAlpha = baseAlpha;
    arch();
    ctx.fillStyle = '#120d0a';
    ctx.fill();
    // Portcullis: 0 = lowered (classic, closed), 1 = raised (living, open). The
    // caller eases this only when the mode toggles, so it's otherwise static.
    const open = o.herse != null ? o.herse : 0;
    const gh = dh * (1 - open);
    if (gh > 2) {
      const inset = dw * 0.14;
      const gx0 = dx + inset; const gx1 = dx + dw - inset;
      const gTop = dy + r * 0.7;
      const gBot = Math.min(baseY - 1, gTop + gh);
      ctx.save();
      arch(); ctx.clip();                       // keep the grille inside the doorway
      ctx.strokeStyle = '#6b7180';
      ctx.lineWidth = Math.max(1, w * 0.018);
      ctx.globalAlpha = baseAlpha * 0.92;
      for (let i = 0; i <= 4; i += 1) { const gx = gx0 + (gx1 - gx0) * (i / 4); ctx.beginPath(); ctx.moveTo(gx, gTop); ctx.lineTo(gx, gBot); ctx.stroke(); }
      for (let i = 0; i <= 3; i += 1) { const gy = gTop + (gBot - gTop) * (i / 3); ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx1, gy); ctx.stroke(); }
      ctx.restore();
    }
    ctx.globalAlpha = baseAlpha;
    ctx.lineWidth = joint;
    ctx.strokeStyle = mortarCss;
    arch();
    ctx.stroke();
  }

  // Arrow-slit (meurtrière): slim dark loophole offset toward the facing — the
  // musketry port from the validated lab tower (battlefield-lab.html:456). Always
  // drawn, like the merlons.
  {
    const slitW = Math.max(2, w * (4 / 56));
    const slitH = h * (16 / 96);
    const slitX = cx + facing * (w * (16 / 56)) - slitW / 2;
    const slitY = by + h * (20 / 96);
    ctx.fillStyle = '#08060c';
    ctx.fillRect(slitX, slitY, slitW, slitH);
  }

  // Crenellated top (merlons) with a mortar outline.
  const merlon = (w - 8) / 5;
  const mh = Math.max(7, h * 0.05);
  ctx.lineWidth = joint;
  for (let i = 0; i < 3; i += 1) {
    const mx = bx + 4 + i * merlon * 2;
    ctx.fillStyle = darkCss;
    ctx.fillRect(mx, by - mh, merlon, mh);
    ctx.strokeStyle = mortarCss;
    ctx.strokeRect(mx, by - mh, merlon, mh);
  }

  // Forge-cannon, raised ~40°, sized to the body (same length/width ratio as the
  // TV tower: ~0.46 of the height long, ~0.13 of the width thick). The lobby
  // tower is at rest (no charge), so it mirrors the battlefield gun's GEOMETRY —
  // tube, gueule, pivot, mèche — in its neutral cool-iron colours rather than
  // glowing with power.
  const px = cx;
  const py = by + Math.max(2, h * 0.02);
  const rad = (40 * Math.PI) / 180;
  const blen = h * 0.46;
  const bwid = Math.max(4, w * 0.13);

  // Tube: cool iron with a relief gradient (lit breech → cool muzzle) so it reads
  // as the same forged metal as the battlefield barrel, with round volume.
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(-Math.sin(rad), facing * Math.cos(rad)));
  const tube = ctx.createLinearGradient(0, 0, blen, 0);
  tube.addColorStop(0, intToCss(shade(BARREL_COOL, 1.18))); // breech (lit)
  tube.addColorStop(1, intToCss(BARREL_COOL));              // muzzle (cool)
  ctx.fillStyle = tube;
  roundRect(ctx, 0, -bwid / 2, blen, bwid, bwid * 0.4);
  ctx.fill();
  // Crown highlight along the upper edge for round relief.
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(blen * 0.1, -bwid / 2 + bwid * 0.14, blen * 0.82, Math.max(1, bwid * 0.16));
  // Gueule (muzzle opening): a dark bore at the tip.
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.arc(blen, 0, bwid * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pivot = powder reserve: a relief hub (lit rim → packed core) ringed by the
  // powder gauge track, shown empty at rest — the battlefield tower's hub.
  const pc = pivotCharge(AIM.minPower);
  const hubR = Math.max(4, w * 0.09);
  const hub = ctx.createRadialGradient(px - hubR * 0.3, py - hubR * 0.3, hubR * 0.2, px, py, hubR);
  hub.addColorStop(0, intToCss(pc.rim));
  hub.addColorStop(1, intToCss(pc.core));
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(px, py, hubR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, w * 0.03);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(px, py, hubR + Math.max(2, w * 0.035), 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Mèche (fuse): a short wick rising from the breech, tipped with a calm ember
  // when armed — the spark re-anchored onto the new cannon's wick.
  const fx = px - facing * w * 0.18;
  const fy = py - h * 0.14;
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = Math.max(1.5, w * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px - facing * w * 0.05, py - h * 0.03);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (o.fuse) {
    const tw = 0.55 + 0.25 * Math.sin((o.time || 0) * 0.012);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseAlpha * 0.6;
    const r = Math.max(3, h * 0.035) * tw;
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 2);
    g.addColorStop(0, 'rgba(255,224,150,0.7)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
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
    /* A slim accent rail at the top is the player's "colours" — it eases from
       neutral slate to the chosen side, signature without going monochrome. */
    .tp-ctl-card{width:100%;max-width:560px;margin:auto;display:flex;flex-direction:column;
      border-top:4px solid var(--accent);border-radius:0 0 14px 14px;padding-top:10px;
      box-shadow:0 -2px 22px -8px var(--accent);transition:border-color .55s ease,box-shadow .55s ease;}
    .tp-ctl header{display:flex;justify-content:space-between;align-items:center;gap:12px;}
    .tp-ctl .tp-logo-sm{width:38px;height:38px;flex:none;border-radius:9px;cursor:pointer;}
    .tp-ctl #name{flex:1;min-width:0;font-size:clamp(18px,5vw,28px);font-weight:bold;color:var(--accent);
      background:#ffffff0d;border:1px solid #ffffff26;border-radius:10px;padding:8px 11px;transition:color .55s ease;}
    .tp-ctl #name:focus{outline:none;border-color:var(--accent);}
    .tp-ctl .room{font-size:clamp(13px,3.6vw,20px);color:#cdd6e6;white-space:nowrap;}
    /* Respect [hidden]: a bare display:flex (specificity 1,1,0) would override
       the UA display:none and keep the wind HUD's gap visible outside command. */
    .tp-ctl #info{flex-direction:column;align-items:center;gap:8px;margin:10px 0 4px;color:#eaf3ff;}
    .tp-ctl #info:not([hidden]){display:flex;}
    /* Wind gauge — the Battlefield score-bar bar, centre-anchored. */
    .tp-ctl #hudWind{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:320px;}
    .tp-ctl .hud-round{font-size:clamp(12px,3.4vw,16px);color:#9fb0c8;min-width:38px;text-align:right;}
    .tp-ctl #hudBar{position:relative;flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.12);}
    .tp-ctl #hudFill{position:absolute;top:0;height:8px;width:0;background:#f5c451;}
    .tp-ctl #hudTick{position:absolute;top:0;left:50%;transform:translateX(-50%);width:2px;height:8px;
      background:rgba(255,255,255,.45);border-radius:1px;}
    .tp-ctl .hud-pct{font-size:clamp(12px,3.4vw,16px);color:#cdd6e6;min-width:54px;text-align:left;
      font-variant-numeric:tabular-nums;}
    .tp-ctl #ttv{width:100%;height:34vh;min-height:190px;display:block;margin:4px 0;touch-action:none;cursor:crosshair;}
    .tp-ctl .row{display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0;}
    .tp-ctl .row button{width:auto;background:transparent;color:#fff;border:none;font-size:30px;cursor:pointer;padding:0 8px;}
    .tp-ctl #biomeName,.tp-ctl #roundsName,.tp-ctl #hpName,.tp-ctl #modeName,.tp-ctl #lbName{font-size:clamp(18px,5vw,26px);font-weight:bold;min-width:130px;text-align:center;}
    .tp-ctl #setupSync{display:flex;justify-content:space-between;gap:10px;align-items:center;
      font-size:clamp(13px,3.6vw,17px);font-weight:bold;margin:8px 0 2px;}
    .tp-ctl #setupSync span{flex:1;padding:6px 10px;border-radius:10px;background:#ffffff10;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .tp-ctl #syncMe{text-align:left;color:var(--accent);}
    .tp-ctl #syncOpp{text-align:right;color:#cdd6e6;}
    .tp-ctl #syncOpp.ready{color:#7fd98a;background:#2f7d3222;}
    .tp-ctl #syncOpp.off{color:#e7a14a;}
    .tp-ctl #setupStage{position:relative;width:100%;height:52vh;min-height:320px;overflow:hidden;
      margin:6px 0;touch-action:none;cursor:ns-resize;border-radius:14px;}
    .tp-ctl #setupCanvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
    .tp-ctl #cfg{position:absolute;top:50%;left:50%;width:90%;transform:translate(-50%,-50%);
      transform-origin:center;will-change:transform,opacity;}
    .tp-ctl #cfg.locked{opacity:.6;}
    .tp-ctl #cfg.locked .row button{visibility:hidden;}
    .tp-ctl #scrollHint{position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#cdd6e6;
      font-size:13px;pointer-events:none;}
    .tp-ctl #scrollHint span{display:inline-block;font-size:26px;line-height:1;animation:tp-bob 1.3s ease-in-out infinite;}
    @keyframes tp-bob{0%,100%{transform:translateY(0);opacity:.5;}50%{transform:translateY(6px);opacity:1;}}
    .tp-ctl #setupStatus{font-size:clamp(14px,4vw,20px);text-align:center;color:#cdd6e6;min-height:22px;margin-top:6px;}
    .tp-ctl.reconnecting:after{content:'Reconnecting…';position:fixed;top:0;left:0;right:0;z-index:30;
      text-align:center;padding:8px;background:#c9892b;color:#fff;font-weight:bold;font-size:16px;}
    .tp-ctl #readout{text-align:center;font-size:clamp(15px,4.2vw,22px);color:#eaf3ff;margin:2px 0 4px;}
    .tp-ctl .shellrow{display:flex;justify-content:center;gap:8px;margin:6px 0;}
    .tp-ctl .shellrow button{position:relative;flex:1;max-width:74px;padding:8px 2px 5px;display:flex;flex-direction:column;align-items:center;gap:3px;
      background:#ffffff14;border:2px solid transparent;border-radius:12px;cursor:pointer;color:#cdd6e6;}
    .tp-ctl .shellrow button svg{width:26px;height:26px;}
    .tp-ctl .shellrow button span{font-size:10px;font-weight:bold;}
    .tp-ctl .shellrow button .ct{position:absolute;top:1px;right:5px;font-size:11px;font-weight:bold;color:#ffd27a;}
    .tp-ctl .shellrow button.on{border-color:var(--accent);background:#ffffff28;color:#fff;}
    .tp-ctl .shellrow button.out{opacity:.32;}
    /* FIRE — a siege-engine key: iron-banded frame, corner rivets, a cannon bore
       the muzzle smoke pours from, on a camp-coloured face (--face). */
    .tp-ctl #fire{position:relative;width:100%;margin-top:10px;padding:clamp(16px,3vh,26px) 18px;
      display:flex;align-items:center;justify-content:center;gap:12px;overflow:visible;
      font-size:clamp(20px,5.4vw,30px);font-weight:bold;border:none;border-radius:12px;color:#fff;cursor:pointer;
      -webkit-tap-highlight-color:transparent;
      background:
        radial-gradient(circle at 13px 13px,#cfd6e2 2.8px,transparent 3.4px),
        radial-gradient(circle at calc(100% - 13px) 13px,#cfd6e2 2.8px,transparent 3.4px),
        radial-gradient(circle at 13px calc(100% - 13px),#cfd6e2 2.8px,transparent 3.4px),
        radial-gradient(circle at calc(100% - 13px) calc(100% - 13px),#cfd6e2 2.8px,transparent 3.4px),
        linear-gradient(180deg,rgba(255,255,255,.24),rgba(0,0,0,.24)),var(--face,var(--accent));
      box-shadow:inset 0 0 0 4px #232a38,inset 0 0 0 6px rgba(255,255,255,.10),0 6px 0 rgba(0,0,0,.4),0 13px 24px -10px #000;
      transition:background .4s ease,box-shadow .12s ease;}
    .tp-ctl #fire .lbl{position:relative;z-index:2;}
    .tp-ctl #fire .bore{flex:none;width:26px;height:26px;border-radius:50%;position:relative;z-index:2;
      background:radial-gradient(circle at 50% 42%,#000 44%,#1a1f2a 46%,#2c3342 64%,#444c5e 80%);
      box-shadow:inset 0 0 0 3px rgba(255,255,255,.32),inset 0 2px 5px #000;}
    .tp-ctl #fire:active{transform:translateY(4px);box-shadow:inset 0 0 0 4px #232a38,inset 0 0 0 6px rgba(255,255,255,.10),0 2px 0 rgba(0,0,0,.4);}
    .tp-ctl #fire:disabled{filter:grayscale(.5) brightness(.82);opacity:.8;}
    .tp-ctl #fire.waiting{--face:#c9892b;}
    /* Shot-clock countdown: a centred bar that leaves the corner rivets visible. */
    .tp-ctl #fire .track{position:absolute;left:50%;transform:translateX(-50%);bottom:7px;width:54%;height:5px;
      border-radius:3px;background:rgba(0,0,0,.32);overflow:hidden;display:none;z-index:2;}
    .tp-ctl #fire.hasclock .track{display:block;}
    .tp-ctl #fire .track .drain{display:block;height:100%;width:100%;background:#fff;border-radius:3px;transition:width .12s linear;}
    /* Urgency = an escalating shake (light→strong via --shk), readable on any camp. */
    .tp-ctl #fire.urgent{animation:tp-shake .42s ease-in-out infinite;}
    @keyframes tp-shake{
      0%,100%{transform:translate(0,0);}
      20%{transform:translate(calc(var(--shk,1px) * -1),calc(var(--shk,1px) * .4));}
      40%{transform:translate(var(--shk,1px),calc(var(--shk,1px) * -.4));}
      60%{transform:translate(calc(var(--shk,1px) * -1),calc(var(--shk,1px) * -.4));}
      80%{transform:translate(var(--shk,1px),calc(var(--shk,1px) * .4));}
    }
    /* Muzzle smoke + flash, spawned on the document body at the bore on firing. */
    .tp-puff{position:fixed;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:60;
      background:radial-gradient(circle,rgba(223,230,240,.85),rgba(150,166,184,.6) 55%,transparent 72%);
      animation:tp-puff .76s ease-out forwards;}
    @keyframes tp-puff{from{opacity:.85;transform:translate(-50%,-50%) scale(.4);}
      to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.9);}}
    .tp-mflash{position:fixed;width:44px;height:44px;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:61;
      background:radial-gradient(circle,rgba(255,244,190,.95),rgba(255,180,70,.5) 50%,transparent 70%);animation:tp-mflash .22s ease-out forwards;}
    @keyframes tp-mflash{from{opacity:1;transform:translate(-50%,-50%) scale(.5);}to{opacity:0;transform:translate(-50%,-50%) scale(1.6);}}
    .tp-ctl .ghost{background:transparent;border:2px solid #ffffff44;color:#cdd6e6;}
    .tp-ctl #leave{display:block;margin:14px auto 0;padding:8px 18px;font-size:14px;border:none;
      background:transparent;color:#9fb0c8;cursor:pointer;text-decoration:underline;}

    /* --- end-of-match: a courteous send-off + crafted "stone tablet" buttons --- */
    /* Respect [hidden]: a bare display:flex would override the UA display:none and
       leave the Rematch/Bow-out tablets visible in the lobby. Only flex when shown. */
    .tp-ctl #endbtns{display:none;flex-direction:column;gap:12px;align-items:stretch;margin-top:6px;}
    .tp-ctl #endbtns:not([hidden]){display:flex;}
    /* Softly chamfered corners + a chunky 3D bevel and a hard base edge: a
       pressable stone tablet, not a flat rounded rectangle. */
    .tp-ctl .endbtn{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;
      width:100%;margin:0;padding:clamp(14px,2.6vh,20px) 18px;font-family:inherit;font-weight:bold;
      font-size:clamp(17px,4.8vw,24px);letter-spacing:.4px;color:#fff;border:none;cursor:pointer;border-radius:12px;
      -webkit-tap-highlight-color:transparent;
      -webkit-clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
      clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
      transition:transform .08s ease,filter .2s ease;}
    .tp-ctl .endbtn svg{width:1.15em;height:1.15em;fill:currentColor;flex:none;}
    .tp-ctl .endbtn:active{filter:brightness(1.06);}
    /* Primary (Rematch) — camp-coloured stone, lit top, hard cast base edge. */
    .tp-ctl #again.endbtn{background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(0,0,0,.22)),var(--accent);
      box-shadow:inset 0 3px 0 rgba(255,255,255,.5),inset 0 -4px 10px rgba(0,0,0,.4),inset 0 0 0 2px rgba(0,0,0,.18),0 6px 0 rgba(0,0,0,.35),0 12px 22px -10px #000;}
    .tp-ctl #again.endbtn:active{transform:translateY(4px);box-shadow:inset 0 3px 0 rgba(255,255,255,.5),inset 0 -4px 10px rgba(0,0,0,.4),inset 0 0 0 2px rgba(0,0,0,.18),0 2px 0 rgba(0,0,0,.35);}
    /* Courteous exit (Bow out) — a quieter slate tablet, same physical feel. */
    .tp-ctl #leaveEnd.endbtn{background:linear-gradient(180deg,#2a3550,#1b2438);color:#dfe8f7;font-weight:600;
      box-shadow:inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 8px rgba(0,0,0,.4),inset 0 0 0 2px rgba(255,255,255,.10),0 5px 0 rgba(0,0,0,.3);}
    .tp-ctl #leaveEnd.endbtn:active{transform:translateY(3px);box-shadow:inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 8px rgba(0,0,0,.4),inset 0 0 0 2px rgba(255,255,255,.1),0 1px 0 rgba(0,0,0,.3);}
    .tp-ctl #leaveEnd.endbtn svg{opacity:.85;}
    .tp-ctl #status{font-size:clamp(14px,4vw,22px);margin-top:12px;color:#cdd6e6;text-align:center;min-height:26px;}
    .tp-ctl #fx{width:100%;height:34vh;min-height:200px;border-radius:14px;display:none;margin:6px 0;cursor:pointer;}
    .tp-ctl #fx:not([hidden]){display:block;}
  `;
  document.head.appendChild(style);
}
