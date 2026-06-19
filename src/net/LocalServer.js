import Simulation from '../sim/Simulation.js';
import { BIOMES } from '../config/biomes.js';

// In-process "server" for the local two-players-on-one-screen mode. It mirrors
// the slice of server/Room.js the controller/TV actually rely on — config,
// camp, the start gate, the per-tick snapshot broadcast and the post-match
// rematch — but drops everything networked (sockets, reconnection grace, the
// spectator queue): both seats are always present and never drop. Two LocalClient
// façades (slots 0 and 1) plus the battlefield renderer ('tv') subscribe to it,
// so the existing ControllerScene/TvScene run unchanged against a real Simulation.
//
// Snapshots are emitted as the raw Simulation.snapshot() object (no binary codec
// — there is no wire to compress for), which the scenes consume identically to a
// decoded frame.
export default class LocalServer {
  constructor(names = ['Player 1', 'Player 2']) {
    this.config = { wins: 3, biomeId: BIOMES[0].id, hp: 1, turbo: false, cadence: 5, livingBattlefield: false, seed: null };
    this.players = [
      { name: names[0] || 'Player 1', isConfigOwner: true },  // slot 0 owns the lobby first
      { name: names[1] || 'Player 2', isConfigOwner: false },
    ];
    this.sim = null;
    this.campChooser = -1;
    this.campSide = -1;
    this.configDone = false;
    this.setup = true;
    this.postmatch = false;
    this.listeners = new Map(); // `${endpoint}:${type}` -> Set<cb>
  }

  // --- pub/sub (endpoint = 0 | 1 | 'tv') ----------------------------------
  on(endpoint, type, cb) {
    const key = `${endpoint}:${type}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(cb);
    return () => this.listeners.get(key)?.delete(cb);
  }

  emitTo(endpoint, type, msg) {
    this.listeners.get(`${endpoint}:${type}`)?.forEach((cb) => cb(msg));
  }

  broadcast(type, msg) {
    this.emitTo(0, type, msg);
    this.emitTo(1, type, msg);
    this.emitTo('tv', type, msg);
  }

  biome() {
    return BIOMES.find((b) => b.id === this.config.biomeId) || BIOMES[0];
  }

  // --- intent routing (mirrors server/index.js dispatch) -------------------
  // `slot` is the originating player (0/1); 'tv' never sends intents.
  handle(slot, type, payload = {}) {
    switch (type) {
      case 'config': this.setConfig(slot, payload); break;
      case 'configDone': this.markConfigDone(slot, payload.value); break;
      case 'camp': this.chooseCamp(slot, payload.slot); break;
      case 'aim': if (this.sim) this.sim.setAim(slot, payload.angle, payload.power); break;
      case 'ready': if (this.sim) this.sim.setReady(slot, payload.value !== false); break;
      case 'shell': if (this.sim) this.sim.setShell(slot, payload.id); break;
      // Living-world third-player intents (no-op unless a livingBattlefield sim runs).
      case 'intendant': if (this.sim && this.sim.battlefield) this.sim.battlefield.setIntendantInput(payload); break;
      case 'intendantBuild': if (this.sim && this.sim.battlefield) { if (payload.type === 'stair') this.sim.battlefield.buildStair(); else if (payload.type === 'bridge') this.sim.battlefield.buildBridge(); } break;
      case 'name': this.rename(slot, payload.name); break;
      case 'sync': this.sendRoster(); break;
      case 'goHome': case 'leave': this.broadcast('roomClosed', {}); break;
      default: break;
    }
  }

  configOwner() {
    return this.players.findIndex((p) => p && p.isConfigOwner);
  }

  // Both seats are always filled locally, so the start gate reduces to: owner
  // validated page 1 and a camp has been claimed.
  lobbyComplete() {
    return this.configDone && this.campChooser !== -1;
  }

  setConfig(slot, cfg) {
    if (slot !== this.configOwner()) return;
    if (Number.isFinite(cfg.wins)) this.config.wins = cfg.wins;
    if (BIOMES.some((b) => b.id === cfg.biomeId)) this.config.biomeId = cfg.biomeId;
    if (cfg.hp === 1 || cfg.hp === 2 || cfg.hp === 3) this.config.hp = cfg.hp;
    if (typeof cfg.turbo === 'boolean') this.config.turbo = cfg.turbo;
    if (Number.isFinite(cfg.cadence)) this.config.cadence = cfg.cadence;
    // Without this the toggle never reaches the roster: the owner's own pad
    // flips locally (so its portcullis animates) but the OTHER pad — which only
    // learns the mode from the broadcast config — never updates. (Mirrors the
    // networked Room.setConfig.)
    if (typeof cfg.livingBattlefield === 'boolean') this.config.livingBattlefield = cfg.livingBattlefield;
    // Replay a specific match seed (null clears it → next match mints a fresh one).
    if (cfg.seed === null || Number.isFinite(cfg.seed)) this.config.seed = cfg.seed;
    this.sendRoster();
  }

  markConfigDone(slot, value = true) {
    if (slot !== this.configOwner()) return;
    this.configDone = value !== false;
    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
  }

  // Locally the seats are fixed (slot 0 = left pad/tower, slot 1 = right), so a
  // camp tap just records the claimant — no seat-swapping. First tap wins; only
  // the claimant may re-adjust (matches the networked "fastest wins" rule).
  chooseCamp(slot, side) {
    if (!this.setup && !this.postmatch) return;
    if (this.campChooser !== -1 && slot !== this.campChooser) return;
    this.campChooser = slot;
    // The picked side (0 = blue, 1 = red) so the OTHER pad can wear the opposite
    // colour instead of colliding on the same side. Cosmetic in local (the
    // physical left/right towers keep their fixed colours).
    this.campSide = (side === 0 || side === 1) ? side : slot;
    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
  }

  rename(slot, name) {
    if (name && this.players[slot]) this.players[slot].name = name;
    if (this.sim) this.sim.names[slot] = this.players[slot].name;
    this.sendRoster();
  }

  maybeStart() {
    if (this.sim || this.postmatch) return;
    if (this.setup && this.lobbyComplete()) {
      this.setup = false;
      this.start();
    }
  }

  start() {
    this.postmatch = false;
    // Match seed: replay a chosen one (config.seed) or mint a fresh 32-bit seed.
    // Logged so a match can be reproduced exactly by feeding it back as config.seed.
    const seed = (this.config.seed != null)
      ? (this.config.seed >>> 0 || 1)
      : ((Math.random() * 0x100000000) >>> 0 || 1);
    this.matchSeed = seed;
    // eslint-disable-next-line no-console
    console.log(`[match] seed=${seed}`);
    this.sim = new Simulation({
      names: [this.players[0].name, this.players[1].name],
      winsNeeded: this.config.wins,
      biome: this.biome(),
      maxHp: this.config.hp,
      turbo: this.config.turbo,
      cadence: this.config.cadence,
      seed,
    });
    this.sim.start();
    this.sendRoster();
  }

  // Fixed-step advance + broadcast. The scene feeds it real dt; we step the sim
  // in whole DT chunks so physics match the authoritative server's cadence.
  step(dt) {
    if (!this.sim) return;
    this.sim.tick(dt);
    const events = this.sim.drainEvents();
    if (this.sim.phase === 'matchEnd' && !this.postmatch) this.enterPostmatch();
    this.broadcast('snapshot', { t: 'snapshot', state: this.sim.snapshot(), events });
  }

  // Match over: freeze the sim, hand the rematch lobby to the loser, require a
  // fresh page-1 validation + camp pick to restart.
  enterPostmatch() {
    this.postmatch = true;
    const loser = this.sim.loser();
    const owner = loser === -1 ? 0 : loser;
    this.players.forEach((p, i) => { if (p) p.isConfigOwner = i === owner; });
    this.configDone = false;
    this.campChooser = -1;
    this.campSide = -1;
    this.sendRoster();
  }

  maybeRematch() {
    if (this.postmatch && this.lobbyComplete()) {
      this.sim = null;
      this.postmatch = false;
      this.start();
    }
  }

  rosterPayload() {
    return {
      t: 'roster',
      config: this.config,
      configOwnerSlot: Math.max(0, this.configOwner()),
      postmatch: this.postmatch,
      inMatch: !!this.sim,
      setup: this.setup,
      configDone: this.configDone,
      campChooser: this.campChooser,
      campSide: this.campSide,
      players: this.players.map((p) => ({
        name: p?.name || null,
        connected: true,
        reconnecting: false,
        isConfigOwner: !!p?.isConfigOwner,
      })),
      queue: 0,
    };
  }

  sendRoster() {
    this.broadcast('roster', this.rosterPayload());
  }
}
