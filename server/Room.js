import Simulation, { PHASE } from '../src/sim/Simulation.js';
import { BIOMES } from '../src/config/biomes.js';

const TICK_MS = 33; // ~30 Hz authoritative step and broadcast rate
const DT = TICK_MS / 1000;

// A single match room. It holds up to two player slots, an ordered waiting queue
// of extra participants (who spectate until a slot frees), any number of TV
// spectators, and the authoritative simulation. The match auto-starts when both
// slots are filled; after a match the loser picks the next biome and both
// players choose to play again or leave.
export default class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.tvs = new Set();
    this.players = [null, null]; // each: { socket, name, playAgain }
    this.waiting = []; // each: { socket, name }
    this.config = { rounds: 3, biomeId: BIOMES[0].id, hp: 1 };
    this.biomeChooser = 0; // slot that picks the biome (first player, then loser)
    this.postmatch = false;
    this.sim = null;
    this.loop = null;
  }

  biome() {
    return BIOMES.find((b) => b.id === this.config.biomeId) || BIOMES[0];
  }

  bothFilled() {
    return !!(this.players[0] && this.players[1]);
  }

  empty() {
    return this.tvs.size === 0 && this.players.every((p) => !p) && this.waiting.length === 0;
  }

  // --- joining -------------------------------------------------------------

  addTv(socket) {
    this.tvs.add(socket);
    this.sendRoster();
  }

  // Returns { role, slot? } describing where the participant landed.
  addParticipant(socket, name) {
    const slot = this.players.findIndex((p) => p === null);
    if (slot !== -1) {
      this.assignPlayer(slot, socket, name);
      return { role: 'player', slot };
    }
    socket.role = 'spectator';
    this.waiting.push({ socket, name });
    this.sendRoster();
    return { role: 'spectator', queue: this.waiting.length };
  }

  assignPlayer(slot, socket, name) {
    this.players[slot] = { socket, name, playAgain: this.postmatch };
    socket.role = 'player';
    socket.slot = slot;
    if (this.sim) this.sim.names[slot] = name;
    this.maybeStart();
    this.maybeRematch();
    this.sendRoster();
  }

  maybeStart() {
    if (this.bothFilled() && !this.sim && !this.postmatch) this.start();
  }

  // --- match lifecycle -----------------------------------------------------

  start() {
    if (!this.bothFilled()) return false;
    this.postmatch = false;
    this.players.forEach((p) => {
      if (p) p.playAgain = false;
    });
    this.sim = new Simulation({
      names: [this.players[0].name, this.players[1].name],
      totalRounds: this.config.rounds,
      biome: this.biome(),
      maxHp: this.config.hp,
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
    this.broadcast({ t: 'snapshot', state: this.sim.snapshot(), events });
  }

  enterPostmatch() {
    this.postmatch = true;
    const loser = this.sim.loser();
    this.biomeChooser = loser === -1 ? 0 : loser;
    this.players.forEach((p) => {
      if (p) p.playAgain = false;
    });
    this.sendRoster();
  }

  maybeRematch() {
    if (this.postmatch && this.bothFilled() && this.players.every((p) => p && p.playAgain)) {
      this.sim = null;
      this.start();
    }
  }

  // --- intents -------------------------------------------------------------

  // Only the current chooser (first player, then the loser) sets the match
  // options — both the biome and the round count. The TV has no say.
  setConfig(socket, rounds, biomeId, hp) {
    if (socket.role === 'player' && socket.slot === this.biomeChooser) {
      if (Number.isFinite(rounds)) this.config.rounds = rounds;
      if (BIOMES.some((b) => b.id === biomeId)) this.config.biomeId = biomeId;
      if (hp === 1 || hp === 2 || hp === 3) this.config.hp = hp;
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

  playAgain(socket) {
    const i = socket.slot;
    if (socket.role !== 'player' || !this.players[i]) return;
    this.players[i].playAgain = true;
    this.sendRoster();
    this.maybeRematch();
  }

  // Abort the current match and return the room to the invitation lobby so a
  // new player can take the empty seat (the TV shows the code + QR again).
  resetToLobby() {
    this.sim = null;
    this.postmatch = false;
    this.players.forEach((p) => {
      if (p) p.playAgain = false;
    });
    const occupied = this.players.findIndex(Boolean);
    this.biomeChooser = occupied === -1 ? 0 : occupied;
    this.sendRoster();
  }

  // A player voluntarily frees their slot; they drop to the back of the queue
  // and the next waiting participant takes the seat (or we return to the lobby).
  leave(socket) {
    const i = socket.slot;
    if (socket.role !== 'player' || this.players[i] == null) return;
    this.players[i] = null;
    socket.slot = undefined;
    socket.role = 'spectator';

    this.promoteInto(i); // an existing waiting player takes over (not the leaver)
    this.waiting.push({ socket, name: socket.name });
    this.send(socket, { t: 'demoted', queue: this.waiting.length });

    if (this.sim && !this.bothFilled()) this.resetToLobby();
    this.sendRoster();
  }

  // Promote the front of the waiting queue into a freed slot (takeover).
  promoteInto(slot) {
    const next = this.waiting.shift();
    if (!next) return;
    this.players[slot] = { socket: next.socket, name: next.name, playAgain: this.postmatch };
    next.socket.role = 'player';
    next.socket.slot = slot;
    if (this.sim) this.sim.names[slot] = next.name;
    this.send(next.socket, {
      t: 'promote',
      player: slot,
      name: next.name,
      isBiomeChooser: slot === this.biomeChooser,
    });
    this.maybeStart();
    this.maybeRematch();
  }

  // --- messaging -----------------------------------------------------------

  rosterPayload() {
    return {
      t: 'roster',
      code: this.code,
      config: this.config,
      biomeChooser: this.biomeChooser,
      postmatch: this.postmatch,
      inMatch: !!this.sim,
      players: this.players.map((p) => ({
        name: p?.name || null,
        connected: !!p,
        playAgain: !!p?.playAgain,
      })),
      queue: this.waiting.length,
    };
  }

  sendRoster() {
    this.broadcast(this.rosterPayload());
    this.waiting.forEach((w, idx) =>
      this.send(w.socket, { t: 'queue', position: idx + 1, size: this.waiting.length }),
    );
  }

  send(socket, msg) {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    const sockets = [
      ...this.tvs,
      ...this.players.filter(Boolean).map((p) => p.socket),
      ...this.waiting.map((w) => w.socket),
    ];
    for (const s of sockets) {
      if (s.readyState === 1) s.send(data);
    }
  }

  // --- disconnects ---------------------------------------------------------

  removeSocket(socket) {
    this.tvs.delete(socket);
    this.waiting = this.waiting.filter((w) => w.socket !== socket);

    const i = this.players.findIndex((p) => p && p.socket === socket);
    if (i !== -1) {
      this.players[i] = null;
      this.promoteInto(i); // a waiting spectator takes over mid-match if any
      if (!this.players[i] && this.sim) this.resetToLobby(); // else back to invitation
    }

    this.sendRoster();
    if (this.empty()) this.dispose();
  }

  dispose() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.sim = null;
    this.onEmpty(this.code);
  }
}
