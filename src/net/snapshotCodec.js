// Binary wire format for the high-frequency `snapshot` frame (~30 Hz). Every
// other message stays JSON — they are rare and small. Only the per-tick world
// state travels in binary, where re-encoding strings (names, biome, shell ids)
// as text 30 times a second is pure waste.
//
// This module is the SINGLE source of truth for the layout: the server imports
// `encodeSnapshot`, the browser client imports `decodeSnapshot`, and because the
// enum tables below are derived from the same shared config the two ends can
// never drift. The shape produced by `decodeSnapshot` is byte-for-byte the
// object `Simulation.snapshot()` would have produced, so the renderers consume
// it unchanged.
//
// If you add a field to `Simulation.snapshot()` or a new event payload, update
// BOTH halves here (encode + decode) in the same order, and bump MAGIC.
import { PHASE } from '../sim/Simulation.js';
import { SHELLS } from '../config/shells.js';
import { BIOMES } from '../config/biomes.js';

const MAGIC = 4; // format/version byte; lets the client reject foreign frames

// Enum tables. Index ⇄ id, shared by both ends. Order is the wire contract —
// only ever append, never reorder.
const PHASE_ORDER = [PHASE.LOBBY, PHASE.AIMING, PHASE.FIRING, PHASE.RESOLVING, PHASE.MATCH_END];
const SHELL_IDS = SHELLS.map((s) => s.id);
// A tower's current SELECTION can also be the shield (a deploy armed in place of
// a shot), which is not a real shell — so it gets its own append-only enum.
const SELECTION_IDS = SHELL_IDS.concat('shield');
const BIOME_IDS = BIOMES.map((b) => b.id);
// Special-shell ammo + the deployable shield, in the fixed order the simulation
// seeds it (see initAmmo). Append-only — never reorder.
const AMMO_KEYS = ['heavy', 'light', 'salvo', 'explosive', 'shield'];
const EVENT_TYPES = ['roundStart', 'fire', 'hit', 'impact', 'turnEnd', 'destroyed', 'matchEnd', 'shield', 'shieldHit'];

const idx = (arr, v, fallback = 0) => {
  const i = arr.indexOf(v);
  return i === -1 ? fallback : i;
};

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// Growable little writer over a DataView. All multi-byte values are big-endian
// (DataView's default); the reader mirrors that.
class Writer {
  constructor() {
    this.buf = new ArrayBuffer(256);
    this.view = new DataView(this.buf);
    this.off = 0;
  }

  _ensure(n) {
    if (this.off + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (cap < this.off + n) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }

  u8(v) { this._ensure(1); this.view.setUint8(this.off, v & 0xff); this.off += 1; }
  u16(v) { this._ensure(2); this.view.setUint16(this.off, v & 0xffff); this.off += 2; }
  u32(v) { this._ensure(4); this.view.setUint32(this.off, v >>> 0); this.off += 4; }
  i16(v) { this._ensure(2); this.view.setInt16(this.off, v); this.off += 2; }
  f32(v) { this._ensure(4); this.view.setFloat32(this.off, v); this.off += 4; }
  bool(v) { this.u8(v ? 1 : 0); }

  str(s) {
    const bytes = ENC.encode(s == null ? '' : String(s));
    this.u16(bytes.length);
    this._ensure(bytes.length);
    new Uint8Array(this.buf, this.off, bytes.length).set(bytes);
    this.off += bytes.length;
  }

  bytes() { return new Uint8Array(this.buf, 0, this.off); }
}

class Reader {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.u8arr = new Uint8Array(arrayBuffer);
    this.off = 0;
  }

  u8() { const v = this.view.getUint8(this.off); this.off += 1; return v; }
  u16() { const v = this.view.getUint16(this.off); this.off += 2; return v; }
  u32() { const v = this.view.getUint32(this.off); this.off += 4; return v; }
  i16() { const v = this.view.getInt16(this.off); this.off += 2; return v; }
  f32() { const v = this.view.getFloat32(this.off); this.off += 4; return v; }
  bool() { return this.u8() === 1; }

  str() {
    const n = this.u16();
    const s = DEC.decode(this.u8arr.subarray(this.off, this.off + n));
    this.off += n;
    return s;
  }
}

function writeEvent(w, e) {
  w.u8(idx(EVENT_TYPES, e.type));
  switch (e.type) {
    case 'roundStart':
      w.u8(e.round);
      break;
    case 'fire':
      w.u8(e.owner); w.i16(e.x); w.i16(e.y); w.f32(e.angle); w.u8(idx(SHELL_IDS, e.shell));
      break;
    case 'hit':
      w.i16(e.x); w.i16(e.y); w.u8(e.owner); w.u8(e.target); w.u8(idx(SHELL_IDS, e.shell));
      break;
    case 'impact':
      w.i16(e.x); w.i16(e.y); w.u8(e.r);
      break;
    case 'turnEnd':
      w.bool(e.decided);
      if (e.decided) { w.u8(e.scores[0]); w.u8(e.scores[1]); }
      break;
    case 'destroyed':
      w.u8(e.tower);
      break;
    case 'matchEnd':
      w.u8(e.scores[0]); w.u8(e.scores[1]);
      break;
    case 'shield':
      w.u8(e.owner); w.i16(e.x); w.i16(e.y);
      break;
    case 'shieldHit':
      w.i16(e.x); w.i16(e.y); w.u8(e.owner);
      break;
    default:
      break;
  }
}

function readEvent(r) {
  const type = EVENT_TYPES[r.u8()];
  switch (type) {
    case 'roundStart':
      return { type, round: r.u8() };
    case 'fire':
      return { type, owner: r.u8(), x: r.i16(), y: r.i16(), angle: r.f32(), shell: SHELL_IDS[r.u8()] };
    case 'hit':
      return { type, x: r.i16(), y: r.i16(), owner: r.u8(), target: r.u8(), shell: SHELL_IDS[r.u8()] };
    case 'impact':
      return { type, x: r.i16(), y: r.i16(), r: r.u8() };
    case 'turnEnd': {
      const decided = r.bool();
      return decided ? { type, decided, scores: [r.u8(), r.u8()] } : { type, decided };
    }
    case 'destroyed':
      return { type, tower: r.u8() };
    case 'matchEnd':
      return { type, scores: [r.u8(), r.u8()] };
    case 'shield':
      return { type, owner: r.u8(), x: r.i16(), y: r.i16() };
    case 'shieldHit':
      return { type, x: r.i16(), y: r.i16(), owner: r.u8() };
    default:
      return { type };
  }
}

// Encode { state, events } into a binary frame. `state` is the object returned
// by Simulation.snapshot(); `events` is the drained event list. Returns a
// Uint8Array (ws sends it as a binary frame).
export function encodeSnapshot(state, events = []) {
  const w = new Writer();
  w.u8(MAGIC);
  w.u8(idx(PHASE_ORDER, state.phase));
  w.u8(state.round.current); w.u8(state.round.total);
  w.f32(state.wind);
  w.u8(state.scores[0]); w.u8(state.scores[1]);
  w.u32(state.seed);
  w.u8(idx(BIOME_IDS, state.biomeId));
  w.str(state.banner);
  w.u8(state.maxHp || 1);
  w.bool(state.turbo);
  // shotClock is null until a turbo player commits and starts the clock.
  if (state.shotClock == null) { w.bool(false); } else { w.bool(true); w.f32(state.shotClock); }
  w.str(state.names[0]); w.str(state.names[1]);

  w.u16(state.craters.length);
  for (const c of state.craters) { w.i16(c.x); w.i16(c.y); w.u8(c.r); }

  // Exactly two towers, always.
  for (const t of state.towers) {
    w.bool(t.ready);
    w.f32(t.groundY); w.f32(t.angle); w.f32(t.power);
    w.u8(idx(SELECTION_IDS, t.shell));
    w.f32(t.hp);
    for (const k of AMMO_KEYS) w.u8(t.ammo[k] || 0);
    // Deployed shield: present flag, then centre, plate-axis unit vector, and the
    // open flag (true while its owner is firing through it).
    if (t.shield) {
      w.bool(true); w.i16(t.shield.x); w.i16(t.shield.y); w.f32(t.shield.ux); w.f32(t.shield.uy); w.bool(t.shield.open);
    } else {
      w.bool(false);
    }
  }

  w.u16(state.projectiles.length);
  // shell id rides along so the controller can vary the per-shell whistle by
  // ammo type (accurate even in turbo, where mixed types share the air).
  for (const p of state.projectiles) { w.u32(p.id); w.i16(p.x); w.i16(p.y); w.u8(p.owner); w.u8(idx(SHELL_IDS, p.shell)); }

  w.u8(events.length);
  for (const e of events) writeEvent(w, e);

  return w.bytes();
}

// Decode a binary frame (ArrayBuffer) back into { state, events }, shaped
// exactly like the server's snapshot() + drained events. Throws on a bad magic
// byte so the caller can ignore a foreign/legacy frame.
export function decodeSnapshot(arrayBuffer) {
  const r = new Reader(arrayBuffer);
  if (r.u8() !== MAGIC) throw new Error('bad snapshot magic');

  const phase = PHASE_ORDER[r.u8()];
  const round = { current: r.u8(), total: r.u8() };
  const wind = r.f32();
  const scores = [r.u8(), r.u8()];
  const seed = r.u32();
  const biomeId = BIOME_IDS[r.u8()];
  const banner = r.str();
  const maxHp = r.u8();
  const turbo = r.bool();
  const shotClock = r.bool() ? r.f32() : null;
  const names = [r.str(), r.str()];

  const craterCount = r.u16();
  const craters = [];
  for (let i = 0; i < craterCount; i += 1) craters.push({ x: r.i16(), y: r.i16(), r: r.u8() });

  const towers = [];
  for (let i = 0; i < 2; i += 1) {
    const ready = r.bool();
    const groundY = r.f32();
    const angle = r.f32();
    const power = r.f32();
    const shell = SELECTION_IDS[r.u8()];
    const hp = r.f32();
    const ammo = {};
    for (const k of AMMO_KEYS) ammo[k] = r.u8();
    const shield = r.bool() ? { x: r.i16(), y: r.i16(), ux: r.f32(), uy: r.f32(), open: r.bool() } : null;
    towers.push({ ready, groundY, angle, power, shell, hp, ammo, shield });
  }

  const projCount = r.u16();
  const projectiles = [];
  for (let i = 0; i < projCount; i += 1) {
    projectiles.push({ id: r.u32(), x: r.i16(), y: r.i16(), owner: r.u8(), shell: SHELL_IDS[r.u8()] });
  }

  const eventCount = r.u8();
  const events = [];
  for (let i = 0; i < eventCount; i += 1) events.push(readEvent(r));

  const state = {
    phase, round, wind, scores, seed, biomeId, banner,
    maxHp, turbo, shotClock, names, craters, towers, projectiles,
  };
  return { state, events };
}
