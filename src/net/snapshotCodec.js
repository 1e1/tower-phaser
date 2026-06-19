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

const MAGIC = 7; // format/version byte; lets the client reject foreign frames

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
const EVENT_TYPES = ['roundStart', 'fire', 'hit', 'impact', 'turnEnd', 'destroyed', 'matchEnd', 'shield', 'shieldHit', 'windsockDown',
  // living-battlefield events (lot C — append-only: existing indices preserved)
  'musket', 'grenadeLob', 'grenadeBurst', 'fieldFire', 'melee', 'soldierDeath', 'intParry', 'intFatal', 'intBuild', 'intDig', 'horde',
  // more living-battlefield events (append-only: existing indices preserved)
  'projGround', 'projFlesh', 'intBow', 'intSword', 'intHurt', 'towerVolley', 'apparition', 'glide', 'cannonWreck', 'engineerBuild'];

// Living-battlefield enums (optional mode). Order is the wire contract:
// append-only, never reorder. Mirror the string values used in battlefield.js.
const SOLDIER_KINDS = ['sword', 'bow', 'cata', 'engineer'];
const SOLDIER_STATES = ['emerge', 'enter', 'march', 'wait', 'fight', 'blocked', 'down', 'arrived', 'retreat', 'jump', 'climb', 'build'];
const I_ACTS = ['dig', 'fill', 'flat'];   // Intendant terraform stroke (none → flag bit)
const I_WEAPONS = ['bow', 'sword'];

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
    case 'windsockDown':
      w.i16(e.x); w.i16(e.y); w.u8(e.owner);
      break;
    case 'musket': case 'grenadeLob': case 'fieldFire': case 'soldierDeath': case 'horde': case 'cannonWreck':
      w.i16(e.x); w.i16(e.y); w.u8(e.owner);
      break;
    case 'grenadeBurst': case 'melee': case 'intParry': case 'intFatal':
    case 'intBow': case 'intSword': case 'intHurt': case 'apparition': case 'glide':
      w.i16(e.x); w.i16(e.y);
      break;
    case 'intBuild': case 'intDig': case 'projGround': case 'projFlesh': case 'engineerBuild':
      w.i16(e.x); w.i16(e.y); w.u8(e.kind);
      break;
    case 'towerVolley':
      w.i16(e.x); w.i16(e.y); w.u8(e.owner); w.u8(e.n);
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
    case 'windsockDown':
      return { type, x: r.i16(), y: r.i16(), owner: r.u8() };
    case 'musket': case 'grenadeLob': case 'fieldFire': case 'soldierDeath': case 'horde': case 'cannonWreck':
      return { type, x: r.i16(), y: r.i16(), owner: r.u8() };
    case 'grenadeBurst': case 'melee': case 'intParry': case 'intFatal':
    case 'intBow': case 'intSword': case 'intHurt': case 'apparition': case 'glide':
      return { type, x: r.i16(), y: r.i16() };
    case 'intBuild': case 'intDig': case 'projGround': case 'projFlesh': case 'engineerBuild':
      return { type, x: r.i16(), y: r.i16(), kind: r.u8() };
    case 'towerVolley':
      return { type, x: r.i16(), y: r.i16(), owner: r.u8(), n: r.u8() };
    default:
      return { type };
  }
}

// --- living battlefield (optional mode) -----------------------------------
// The whole block is gated by a bool in the main frame, so a 2-player frame
// pays exactly one extra byte (false) and decodes to no `battlefield` key —
// keeping the legacy snapshot shape byte-identical in behaviour.
function writeBattlefield(w, b) {
  const r = b.round;
  w.u8((r.loserOwner + 1) & 0xff); // -1→0, 0→1, 1→2
  w.u8((r.ruinSide + 1) & 0xff);
  w.f32(r.ruinT);
  w.u8((r.lastWinner + 1) & 0xff);
  w.bool(r.scored);
  w.u8((b.invader + 1) & 0xff);
  w.bool(b.present);
  w.u8(b.score & 0xff);
  w.str(b.banner);

  // Intendant. Booleans + the small enums pack into one flag byte; weapon and
  // act are tiny so they ride as their own bytes for clarity.
  const I = b.intendant;
  let fl = 0;
  if (I.facing > 0) fl |= 1;
  if (I.dead) fl |= 2;
  if (I.playable) fl |= 4;
  if (I.attacking) fl |= 8;
  if (I.glide) fl |= 16;
  if (I.building) fl |= 32;
  if (I.aimAng != null) fl |= 64;
  w.u8(fl);
  w.i16(I.x); w.i16(I.y);
  w.u8(Math.max(0, Math.round(I.hp)));
  w.u8(idx(I_WEAPONS, I.weapon));
  w.u8(I.act == null ? 255 : idx(I_ACTS, I.act));
  w.u8(I.style & 0xff);
  w.u8(I.bp[0] & 0xff); w.u8(I.bp[1] & 0xff);
  if (I.aimAng != null) w.f32(I.aimAng);

  // Magic shield: quantised remaining window + hit pulse, then up to 6 impact
  // sparks (angle ±π scaled by 1000 → i16; remaining 0..0.45s scaled by 255).
  const sh = I.shield || { t: 0, hit: 0, fx: [] };
  w.u8(Math.max(0, Math.min(255, Math.round(sh.t * 40))));   // dur≤~6s fits u8
  w.u8(Math.max(0, Math.min(255, Math.round(sh.hit * 255))));
  const sfx = sh.fx || [];
  w.u8(Math.min(255, sfx.length));
  for (const f of sfx) { w.i16(Math.round(f.a * 1000)); w.u8(Math.max(0, Math.min(255, Math.round(f.t * 255)))); }

  // Two battlefield towers contribute only the musketry-alert flag (owner by
  // index; position + HP come from the artillery towers the renderer has).
  for (const t of b.towers) w.bool(t.warn);

  w.u16(b.structures.length);
  for (const p of b.structures) { w.i16(p.x0); w.i16(p.x1); w.i16(p.y); }

  // Engineer ladders (#14): foot (xb,yb) → top (xt,yt) of an inclined ladder.
  const ladders = b.ladders || [];
  w.u16(ladders.length);
  for (const L of ladders) { w.i16(L.xb); w.i16(L.yb); w.i16(L.xt); w.i16(L.yt); }

  // Coarse terrain (support bars are NOT sent — the renderer derives the strut
  // lattice from structures + this terrain).
  const terr = b.terrain || [];
  w.u16(terr.length);
  for (const h of terr) w.i16(h);

  w.u16(b.soldiers.length);
  for (const s of b.soldiers) {
    w.u16(s.id);
    w.i16(s.x); w.i16(s.y);
    w.u8(Math.max(0, Math.min(255, s.hp)));
    let sf = 0;
    if (s.owner) sf |= 1;
    if (s.deserter) sf |= 2;
    if (s.dir > 0) sf |= 4;
    sf |= (idx(SOLDIER_KINDS, s.kind) & 0x7) << 3;
    w.u8(sf);
    w.u8(idx(SOLDIER_STATES, s.st));
  }

  w.u16(b.horde.length);
  for (const s of b.horde) {
    w.u16(s.id);
    w.i16(s.x); w.i16(s.y);
    let hf = 0;
    if (s.owner) hf |= 1;
    if (s.bg) hf |= 2;
    if (s.dir > 0) hf |= 4;
    w.u8(hf);
    w.u8(idx(SOLDIER_STATES, s.st));
  }

  w.u16(b.projectiles.length);
  for (const p of b.projectiles) {
    w.u32(p.id); w.i16(p.x); w.i16(p.y);
    let pf = 0;
    if (p.ball) pf |= 1;
    if (p.gren) pf |= 2;
    if (p.bolt) pf |= 4;
    if (p.musket) pf |= 8;
    if (p.fromI) pf |= 16;
    if (p.owner != null) { pf |= 32; if (p.owner) pf |= 64; }
    w.u8(pf);
  }
}

function readBattlefield(r) {
  const round = {
    loserOwner: r.u8() - 1, ruinSide: r.u8() - 1, ruinT: r.f32(),
    lastWinner: r.u8() - 1, scored: r.bool(),
  };
  const invader = r.u8() - 1;
  const present = r.bool();
  const score = r.u8();
  const banner = r.str();

  const fl = r.u8();
  const x = r.i16(); const y = r.i16();
  const hp = r.u8();
  const weapon = I_WEAPONS[r.u8()];
  const actI = r.u8();
  const style = r.u8();
  const bp = [r.u8(), r.u8()];
  const aimAng = (fl & 64) ? r.f32() : null;
  const shT = r.u8() / 40;
  const shHit = r.u8() / 255;
  const shN = r.u8();
  const shFx = [];
  for (let i = 0; i < shN; i += 1) shFx.push({ a: r.i16() / 1000, t: r.u8() / 255 });
  const intendant = {
    x, y, hp, weapon, style, bp,
    facing: (fl & 1) ? 1 : -1,
    dead: !!(fl & 2), playable: !!(fl & 4), attacking: !!(fl & 8),
    glide: !!(fl & 16), building: !!(fl & 32),
    act: actI === 255 ? null : I_ACTS[actI], aimAng,
    shield: { t: shT, hit: shHit, fx: shFx },
  };

  const towers = [];
  for (let i = 0; i < 2; i += 1) towers.push({ owner: i, warn: r.bool() });

  const structCount = r.u16();
  const structures = [];
  for (let i = 0; i < structCount; i += 1) structures.push({ x0: r.i16(), x1: r.i16(), y: r.i16() });

  const ladderCount = r.u16();
  const ladders = [];
  for (let i = 0; i < ladderCount; i += 1) ladders.push({ xb: r.i16(), yb: r.i16(), xt: r.i16(), yt: r.i16() });

  const terrCount = r.u16();
  const terrain = [];
  for (let i = 0; i < terrCount; i += 1) terrain.push(r.i16());

  const solCount = r.u16();
  const soldiers = [];
  for (let i = 0; i < solCount; i += 1) {
    const id = r.u16(); const sx = r.i16(); const sy = r.i16(); const shp = r.u8();
    const sf = r.u8(); const st = SOLDIER_STATES[r.u8()];
    soldiers.push({
      id, x: sx, y: sy, hp: shp, st,
      owner: (sf & 1) ? 1 : 0, deserter: !!(sf & 2), dir: (sf & 4) ? 1 : -1,
      kind: SOLDIER_KINDS[(sf >> 3) & 0x7],
    });
  }

  const hordeCount = r.u16();
  const horde = [];
  for (let i = 0; i < hordeCount; i += 1) {
    const id = r.u16(); const hx = r.i16(); const hy = r.i16();
    const hf = r.u8(); const st = SOLDIER_STATES[r.u8()];
    horde.push({ id, x: hx, y: hy, st, owner: (hf & 1) ? 1 : 0, bg: !!(hf & 2), dir: (hf & 4) ? 1 : -1 });
  }

  const projCount = r.u16();
  const projectiles = [];
  for (let i = 0; i < projCount; i += 1) {
    const pid = r.u32(); const px = r.i16(); const py = r.i16(); const pf = r.u8();
    projectiles.push({
      id: pid, x: px, y: py,
      ball: !!(pf & 1), gren: !!(pf & 2), bolt: !!(pf & 4), musket: !!(pf & 8), fromI: !!(pf & 16),
      owner: (pf & 32) ? ((pf & 64) ? 1 : 0) : null,
    });
  }

  return { round, invader, present, score, banner, intendant, towers, structures, ladders, terrain, soldiers, horde, projectiles };
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

  // Central windsock: alive flag + anchor (the pole top). x/y depend on the
  // round's terrain, so they ride the wire rather than being recomputed.
  const ws = state.windsock || { x: 0, y: 0, alive: true };
  w.bool(ws.alive); w.i16(ws.x); w.i16(ws.y);

  // Exactly two towers, always.
  for (const t of state.towers) {
    w.bool(t.ready);
    w.i16(t.x); // tower slides along its platform per round (0..GAME_WIDTH)
    w.f32(t.groundY); w.f32(t.angle); w.f32(t.power);
    w.u8(idx(SELECTION_IDS, t.shell));
    w.f32(t.hp);
    for (const k of AMMO_KEYS) w.u8(t.ammo[k] || 0);
    // Deployed shields stack: a count, then one record each — centre, plate-axis
    // unit vector, and the open flag (true while its owner is firing through it).
    const shields = t.shields || [];
    w.u8(shields.length);
    for (const s of shields) { w.i16(s.x); w.i16(s.y); w.f32(s.ux); w.f32(s.uy); w.bool(s.open); }
  }

  w.u16(state.projectiles.length);
  // shell id rides along so the controller can vary the per-shell whistle by
  // ammo type (accurate even in turbo, where mixed types share the air).
  for (const p of state.projectiles) { w.u32(p.id); w.i16(p.x); w.i16(p.y); w.u8(p.owner); w.u8(idx(SHELL_IDS, p.shell)); }

  // Optional living-battlefield block (3rd-player mode). One flag byte when off.
  if (state.battlefield) { w.bool(true); writeBattlefield(w, state.battlefield); } else { w.bool(false); }

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

  const windsock = { alive: r.bool(), x: r.i16(), y: r.i16() };

  const towers = [];
  for (let i = 0; i < 2; i += 1) {
    const ready = r.bool();
    const x = r.i16();
    const groundY = r.f32();
    const angle = r.f32();
    const power = r.f32();
    const shell = SELECTION_IDS[r.u8()];
    const hp = r.f32();
    const ammo = {};
    for (const k of AMMO_KEYS) ammo[k] = r.u8();
    const shieldCount = r.u8();
    const shields = [];
    for (let s = 0; s < shieldCount; s += 1) shields.push({ x: r.i16(), y: r.i16(), ux: r.f32(), uy: r.f32(), open: r.bool() });
    towers.push({ ready, x, groundY, angle, power, shell, hp, ammo, shields });
  }

  const projCount = r.u16();
  const projectiles = [];
  for (let i = 0; i < projCount; i += 1) {
    projectiles.push({ id: r.u32(), x: r.i16(), y: r.i16(), owner: r.u8(), shell: SHELL_IDS[r.u8()] });
  }

  const battlefield = r.bool() ? readBattlefield(r) : null;

  const eventCount = r.u8();
  const events = [];
  for (let i = 0; i < eventCount; i += 1) events.push(readEvent(r));

  const state = {
    phase, round, wind, scores, seed, biomeId, banner,
    maxHp, turbo, shotClock, names, craters, windsock, towers, projectiles,
  };
  // Only attach the key when present, so the 2-player decoded shape is unchanged.
  if (battlefield) state.battlefield = battlefield;
  return { state, events };
}
