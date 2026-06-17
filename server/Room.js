import Simulation, { PHASE } from '../src/sim/Simulation.js';
import { BIOMES } from '../src/config/biomes.js';
import { encodeSnapshot } from '../src/net/snapshotCodec.js';

const TICK_MS = 33; // ~30 Hz authoritative step and broadcast rate
const DT = TICK_MS / 1000;

// How long a vacated player slot is held open after a disconnect, so a phone
// that locked/slept (and dropped its socket) can reconnect into the same seat
// instead of losing it. After this, the slot is freed (promoted/reset) as usual.
const GRACE_MS = 10_000;

let tokenSeq = 0;
// A reconnect token is the stable identity of a player across socket drops. It
// need not be cryptographic — rooms are short-lived and local — just unique.
function newToken() {
  tokenSeq += 1;
  return `${Date.now().toString(36)}-${tokenSeq.toString(36)}`;
}

// A single match room. It holds up to two player slots, an ordered waiting queue
// of extra participants (who spectate until a slot frees), any number of TV
// spectators, and the authoritative simulation.
//
// Lobby / start sequence. There is NO auto-start. The config owner (the first
// connected player) sets the match options (biome/rounds/hp/mode) on "page 1"
// and validates them; either player may then claim a camp (tower/colour) on
// "page 2". The match starts as soon as: both seats filled and present + the
// config owner validated page 1 (configDone) + a camp has been claimed
// (campChooser) — the other player inherits the opposite side. The owner can
// configure before the second player even arrives, and the second player's camp
// pick never disturbs the owner's navigation.
//
// End of match: the finished sim is kept frozen at MATCH_END (so the TV holds
// the result and the phones play their cracktro), and the room re-enters the
// same lobby for a rematch — except the LOSER becomes the config owner (sets
// page 1 + picks the camp on page 2) and the winner only observes. The rematch
// starts when the loser completes the lobby; then the frozen sim is replaced.
export default class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.tvs = new Set();
    // The host TV anchors the room. It negotiates a reconnect token on first host
    // and, like a player, keeps a GRACE_MS window to reclaim its place after a
    // blip; if it does not return, the whole room is torn down (roomClosed).
    this.tvToken = null;
    this.tvGraceTimer = null;
    // each player: { socket, name, token, isConfigOwner, disconnected, graceTimer }
    this.players = [null, null];
    this.waiting = []; // each: { socket, name }
    this.config = { wins: 3, biomeId: BIOMES[0].id, hp: 1, turbo: false, cadence: 5 };
    this.postmatch = false; // rematch lobby (sim kept frozen at MATCH_END)
    // --- lobby (pre-match and rematch) ---
    this.setup = true; // true until the first match starts
    this.configDone = false; // the config owner validated the match settings
    this.campChooser = -1; // slot that claimed the camp (-1 = undecided)
    this.sim = null;
    this.loop = null;
  }

  biome() {
    return BIOMES.find((b) => b.id === this.config.biomeId) || BIOMES[0];
  }

  // The slot that owns the config + validation for the current lobby: the first
  // connected player pre-match, the loser post-match. -1 if no one holds it.
  configOwner() {
    return this.players.findIndex((p) => p && p.isConfigOwner);
  }

  // Never leave a populated lobby ownerless (e.g. the owner left pre-match):
  // without an owner no one could validate page 1, so the match could never
  // start. Hand ownership to the first present player.
  ensureConfigOwner() {
    if (this.sim && !this.postmatch) return; // mid-match: ownership is irrelevant
    if (this.configOwner() !== -1) return;
    const heir = this.players.findIndex((p) => p && !p.disconnected);
    if (heir !== -1) this.players[heir].isConfigOwner = true;
  }

  // Lobby is complete and the match may (re)start: both seats filled and present,
  // page 1 validated by the owner, and a camp claimed (the other side inferred).
  lobbyComplete() {
    return (
      this.bothFilled() &&
      this.players.every((p) => p && !p.disconnected) &&
      this.configDone &&
      this.campChooser !== -1
    );
  }

  bothFilled() {
    return !!(this.players[0] && this.players[1]);
  }

  // A held (disconnected-but-reserved) slot still counts as occupied, so the room
  // is "empty" only when no live OR held participant remains. A pending TV grace
  // also keeps the room alive (the host may reclaim it).
  empty() {
    return (
      this.tvs.size === 0 &&
      !this.tvGraceTimer &&
      this.players.every((p) => !p) &&
      this.waiting.length === 0
    );
  }

  // --- joining -------------------------------------------------------------

  addTv(socket) {
    if (this.tvGraceTimer) { clearTimeout(this.tvGraceTimer); this.tvGraceTimer = null; }
    if (!this.tvToken) this.tvToken = newToken();
    socket.tvToken = this.tvToken;
    this.tvs.add(socket);
    this.sendRoster();
  }

  // Reclaim the host anchor after a transient disconnect (host reload / blip).
  // Returns true on success; false means the token did not match (caller hosts
  // fresh). Cancels the teardown grace and re-attaches the socket as the TV.
  reattachTv(socket, token) {
    if (!token || token !== this.tvToken) return false;
    if (this.tvGraceTimer) { clearTimeout(this.tvGraceTimer); this.tvGraceTimer = null; }
    socket.role = 'tv';
    socket.room = this;
    socket.tvToken = this.tvToken;
    this.tvs.add(socket);
    this.send(socket, { t: 'rehosted', code: this.code });
    this.sendRoster();
    return true;
  }

  // The host TV vanished for good (grace expired without a reconnect): the room
  // has no anchor, so tear the whole instance down for everyone.
  dropTv() {
    this.tvGraceTimer = null;
    if (this.tvs.size > 0) return; // a host reconnected in time
    this.broadcast({ t: 'roomClosed' });
    this.players.forEach((p) => { if (p?.graceTimer) clearTimeout(p.graceTimer); });
    this.players = [null, null];
    this.waiting = [];
    this.dispose();
  }

  // Returns { role, slot?, token?, ... } describing where the participant landed.
  addParticipant(socket, name) {
    const slot = this.players.findIndex((p) => p === null);
    if (slot !== -1) {
      const token = this.assignPlayer(slot, socket, name);
      return {
        role: 'player',
        slot,
        token,
        setup: this.setup,
        configDone: this.configDone,
        campChooser: this.campChooser,
        isConfigOwner: !!this.players[slot]?.isConfigOwner,
      };
    }
    socket.role = 'spectator';
    this.waiting.push({ socket, name });
    this.sendRoster();
    return { role: 'spectator', queue: this.waiting.length };
  }

  assignPlayer(slot, socket, name) {
    const firstEver = this.setup && this.players.every((p) => !p);
    const token = newToken();
    this.players[slot] = {
      socket,
      name,
      token,
      isConfigOwner: firstEver, // the first connected player owns the config
      disconnected: false,
      graceTimer: null,
    };
    socket.role = 'player';
    socket.slot = slot;
    socket.token = token;
    if (this.sim) this.sim.names[slot] = name;

    // The camp is claimed on a first-tap-wins basis on the camp page: whoever
    // taps a tower first (see chooseCamp) becomes that side, so the chooser is
    // left undecided here.

    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
    return token;
  }

  maybeStart() {
    if (this.sim || this.postmatch) return;
    if (this.setup) {
      // Start gate: page 1 validated by the owner + a camp claimed (+ both here).
      if (this.lobbyComplete()) {
        this.setup = false;
        this.start();
      }
      return;
    }
    // Past initial setup (queue refill after an abort): start when both seats
    // are filled and present again.
    if (this.bothFilled() && this.players.every((p) => p && !p.disconnected)) this.start();
  }

  // --- match lifecycle -----------------------------------------------------

  start() {
    if (!this.bothFilled()) return false;
    this.postmatch = false;
    this.sim = new Simulation({
      names: [this.players[0].name, this.players[1].name],
      winsNeeded: this.config.wins,
      biome: this.biome(),
      maxHp: this.config.hp,
      turbo: this.config.turbo,
      cadence: this.config.cadence,
    });
    this.sim.start();
    this.startLoop();
    this.sendRoster();
    return true;
  }

  startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.step(), TICK_MS);
  }

  step() {
    if (!this.sim) return;
    this.sim.tick(DT);
    const events = this.sim.drainEvents();
    // Catches both a natural finish and a forced end (player left mid-match).
    if (this.sim.phase === PHASE.MATCH_END && !this.postmatch) this.enterPostmatch();
    // The hot path: a binary frame instead of JSON (see snapshotCodec).
    this.broadcastRaw(encodeSnapshot(this.sim.snapshot(), events));
  }

  // Match finished: freeze the sim at MATCH_END (the TV keeps the result, phones
  // play the cracktro) and re-open the lobby for a rematch with the LOSER as the
  // config owner — the winner only observes. Page 1 + camp must be redone.
  enterPostmatch() {
    this.postmatch = true;
    const loser = this.sim.loser();
    const owner = loser === -1 ? 0 : loser; // a draw hands the lobby to slot 0
    this.players.forEach((p, i) => {
      if (p) p.isConfigOwner = i === owner;
    });
    this.configDone = false;
    this.campChooser = -1;
    this.sendRoster();
  }

  // Start the rematch once the loser has completed the lobby (validated page 1 +
  // picked a camp): replace the frozen finished sim with a fresh one.
  maybeRematch() {
    if (this.postmatch && this.lobbyComplete()) {
      this.sim = null;
      this.postmatch = false;
      this.start();
    }
  }

  // --- lobby intents -------------------------------------------------------

  // The config owner toggles their page-1 validation by scrolling between the
  // settings page (false) and the camp page (true). The match can only start
  // while the owner is validated (on the camp page) — scrolling back to page 1
  // retracts it, so the owner sitting on the settings page can never be dragged
  // into a match by the rival claiming a side first.
  markConfigDone(socket, value = true) {
    if (socket.role !== 'player' || socket.slot !== this.configOwner()) return;
    this.configDone = value !== false;
    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
  }

  // Pick the camp by tapping a tower: `slot` is the desired side (0 = left/blue,
  // 1 = right/red). Swaps seats if needed; the config-owner flag travels with the
  // player record, so picking the other colour also moves ownership along.
  chooseCamp(socket, slot) {
    if (socket.role !== 'player' || (!this.setup && !this.postmatch)) return;
    const from = socket.slot;
    // Page 2 is "fastest wins" for EITHER persona (pre- and post-match alike):
    // the Architect or the Rival may claim a side. Once claimed, only that player
    // may re-adjust. The start still waits on the Architect validating page 1.
    if (this.campChooser !== -1 && from !== this.campChooser) return;
    const target = slot === 0 || slot === 1 ? slot : from;
    if (target !== from) this.moveTo(from, target);
    const dest = this.players.findIndex((p) => p && p.socket === socket);
    if (dest !== -1) this.campChooser = dest;
    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
  }

  // Move the player in `from` into `to`, swapping with whoever is in `to`.
  // Keeps socket.slot and the config-owner flag attached to the player record.
  moveTo(from, to) {
    const a = this.players[from];
    const b = this.players[to];
    this.players[to] = a;
    this.players[from] = b;
    if (a) {
      a.socket.slot = to;
      this.notifySlot(a, to);
    }
    if (b) {
      b.socket.slot = from;
      this.notifySlot(b, from);
    }
    if (this.sim) {
      this.sim.names[to] = a?.name ?? this.sim.names[to];
      this.sim.names[from] = b?.name ?? this.sim.names[from];
    }
  }

  notifySlot(player, slot) {
    if (player.socket) this.send(player.socket, { t: 'reslot', slot, isConfigOwner: !!player.isConfigOwner });
  }

  // --- intents -------------------------------------------------------------

  // Only the config owner (first player pre-match, the loser post-match) sets the
  // match options — biome, rounds, health, mode. The TV has no say.
  setConfig(socket, cfg = {}) {
    const allowed = socket.role === 'player' && this.players[socket.slot]?.isConfigOwner;
    if (allowed) {
      if (Number.isFinite(cfg.wins)) this.config.wins = cfg.wins;
      if (BIOMES.some((b) => b.id === cfg.biomeId)) this.config.biomeId = cfg.biomeId;
      if (cfg.hp === 1 || cfg.hp === 2 || cfg.hp === 3) this.config.hp = cfg.hp;
      if (typeof cfg.turbo === 'boolean') this.config.turbo = cfg.turbo;
      if (Number.isFinite(cfg.cadence)) this.config.cadence = cfg.cadence;
    }
    this.sendRoster();
  }

  rename(socket, name) {
    if (!name) return;
    socket.name = name;
    const i = socket.slot;
    if (socket.role === 'player' && this.players[i]) {
      this.players[i].name = name;
      if (this.sim) this.sim.names[i] = name;
    } else {
      const w = this.waiting.find((x) => x.socket === socket);
      if (w) w.name = name;
    }
    this.sendRoster();
  }

  handleAim(socket, angle, power) {
    const i = socket.slot;
    if (socket.role === 'player' && this.sim) this.sim.setAim(i, angle, power);
  }

  handleReady(socket, value) {
    const i = socket.slot;
    if (socket.role === 'player' && this.sim) this.sim.setReady(i, value);
  }

  handleShell(socket, id) {
    const i = socket.slot;
    if (socket.role === 'player' && this.sim) this.sim.setShell(i, id);
  }

  // Abort the current match and return the room to the invitation lobby so a
  // new player can take the empty seat (the TV shows the code + QR again). The
  // remaining player becomes the config owner; a fresh camp pick restarts.
  resetToLobby() {
    this.sim = null;
    this.postmatch = false;
    this.setup = true;
    this.configDone = true; // config persists across an abort; no need to redo it
    this.campChooser = -1; // re-pick a camp to restart
    const occupied = this.players.findIndex(Boolean);
    this.players.forEach((p, i) => {
      if (p) p.isConfigOwner = i === occupied;
    });
    this.sendRoster();
  }

  // Promote the front of the waiting queue into a freed slot (takeover).
  promoteInto(slot) {
    const next = this.waiting.shift();
    if (!next) return;
    const token = newToken();
    this.players[slot] = {
      socket: next.socket,
      name: next.name,
      token,
      isConfigOwner: false, // a promoted player never owns the lobby config
      disconnected: false,
      graceTimer: null,
    };
    next.socket.role = 'player';
    next.socket.slot = slot;
    next.socket.token = token;
    if (this.sim) this.sim.names[slot] = next.name;
    this.send(next.socket, {
      t: 'promote',
      player: slot,
      name: next.name,
      token,
      isConfigOwner: false,
    });
    this.maybeStart();
    this.maybeRematch();
  }

  // --- leaving / going home ------------------------------------------------

  // Escape-to-home / explicit disconnect. A host TV closes the whole room (all
  // participants are sent back to their home screen). A player/spectator leaves
  // immediately with no grace hold (they chose to go).
  exit(socket) {
    if (socket.role === 'tv') {
      this.broadcast({ t: 'roomClosed' });
      this.players.forEach((p) => {
        if (p?.graceTimer) clearTimeout(p.graceTimer);
      });
      this.players = [null, null];
      this.waiting = [];
      this.tvs.clear();
      this.dispose();
      return;
    }
    this.dropParticipant(socket, false);
  }

  // --- disconnects ---------------------------------------------------------

  // A socket dropped (close/terminate). A player keeps their seat for GRACE_MS
  // so a reconnect can reclaim it; everyone else is removed at once.
  removeSocket(socket) {
    const i = this.players.findIndex((p) => p && p.socket === socket);
    if (i !== -1) {
      const p = this.players[i];
      p.disconnected = true;
      p.socket = null;
      if (p.graceTimer) clearTimeout(p.graceTimer);
      p.graceTimer = setTimeout(() => this.dropHeld(i, p.token), GRACE_MS);
      this.sendRoster();
      if (this.empty()) this.dispose();
      return;
    }
    // The host TV: hold the room for a grace window instead of dropping it. If
    // the host does not return within GRACE_MS, the whole room is torn down.
    if (this.tvs.has(socket)) {
      this.tvs.delete(socket);
      if (this.tvs.size === 0 && !this.tvGraceTimer) {
        this.tvGraceTimer = setTimeout(() => this.dropTv(), GRACE_MS);
      }
      this.sendRoster();
      return;
    }
    this.waiting = this.waiting.filter((w) => w.socket !== socket);
    this.sendRoster();
    if (this.empty()) this.dispose();
  }

  // A held slot's grace window expired without a reconnect: free it for real.
  dropHeld(slot, token) {
    const p = this.players[slot];
    if (!p || p.token !== token || !p.disconnected) return; // already reclaimed
    this.dropParticipant(p.socket, true, slot, token);
  }

  // Common removal for a leaving/expired player: vacate the slot, promote a
  // waiting spectator if any, otherwise abort the match back to the lobby.
  dropParticipant(socket, fromGrace, gSlot, gToken) {
    if (!fromGrace) {
      this.tvs.delete(socket);
      this.waiting = this.waiting.filter((w) => w.socket !== socket);
    }
    const i = fromGrace ? gSlot : this.players.findIndex((p) => p && p.socket === socket);
    if (i != null && i !== -1 && this.players[i] && (!fromGrace || this.players[i].token === gToken)) {
      if (this.players[i].graceTimer) clearTimeout(this.players[i].graceTimer);
      this.players[i] = null;
      if (socket) {
        socket.slot = undefined;
        socket.role = 'spectator';
      }
      this.promoteInto(i); // a waiting spectator takes over if any
      if (!this.players[i] && this.sim) this.resetToLobby();
    }
    if (socket && !fromGrace) socket.room = null;
    this.sendRoster();
    if (this.empty()) this.dispose();
  }

  // Reclaim a held slot with a matching token after a reconnect. Returns true on
  // success; false means the grace window had already expired (caller falls back
  // to a fresh join).
  rejoin(socket, token, name) {
    const i = this.players.findIndex((p) => p && p.token === token && p.disconnected);
    if (i === -1) return false;
    const p = this.players[i];
    if (p.graceTimer) {
      clearTimeout(p.graceTimer);
      p.graceTimer = null;
    }
    p.socket = socket;
    p.disconnected = false;
    if (name) p.name = name;
    socket.room = this;
    socket.role = 'player';
    socket.slot = i;
    socket.token = token;
    if (this.sim) this.sim.names[i] = p.name;
    this.send(socket, {
      t: 'rejoined',
      code: this.code,
      slot: i,
      token,
      isConfigOwner: !!p.isConfigOwner,
      setup: this.setup,
      configDone: this.configDone,
      campChooser: this.campChooser,
      inMatch: !!this.sim,
      postmatch: this.postmatch,
    });
    this.sendRoster();
    return true;
  }

  // --- messaging -----------------------------------------------------------

  rosterPayload() {
    return {
      t: 'roster',
      code: this.code,
      config: this.config,
      biomeChooser: Math.max(0, this.configOwner()), // config owner slot (TV label)
      postmatch: this.postmatch,
      inMatch: !!this.sim,
      setup: this.setup,
      configDone: this.configDone,
      campChooser: this.campChooser,
      players: this.players.map((p) => ({
        name: p?.name || null,
        connected: !!p && !p.disconnected,
        reconnecting: !!p?.disconnected,
        isConfigOwner: !!p?.isConfigOwner,
      })),
      queue: this.waiting.length,
    };
  }

  sendRoster() {
    this.ensureConfigOwner(); // normalize ownership before every broadcast
    this.broadcast(this.rosterPayload());
    this.waiting.forEach((w, idx) =>
      this.send(w.socket, { t: 'queue', position: idx + 1, size: this.waiting.length }),
    );
  }

  send(socket, msg) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    this.broadcastRaw(JSON.stringify(msg));
  }

  // Send pre-serialized data (a JSON string or a binary snapshot frame) to every
  // socket in the room. ws sends a Uint8Array as a binary frame automatically.
  broadcastRaw(data) {
    const sockets = [
      ...this.tvs,
      ...this.players.filter((p) => p && p.socket).map((p) => p.socket),
      ...this.waiting.map((w) => w.socket),
    ];
    for (const s of sockets) {
      if (s.readyState === 1) s.send(data);
    }
  }

  dispose() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.sim = null;
    if (this.tvGraceTimer) { clearTimeout(this.tvGraceTimer); this.tvGraceTimer = null; }
    this.players.forEach((p) => {
      if (p?.graceTimer) clearTimeout(p.graceTimer);
    });
    this.onEmpty(this.code);
  }
}
