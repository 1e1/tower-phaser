// Round-trip test for the binary snapshot codec (lot 2), focused on the
// optional living-battlefield block added on top of the legacy 2-player frame.
//
//   node test/codec.test.mjs
//
// Proves:
//   (a) a 2-player frame (mode OFF) round-trips with NO battlefield key
//       (legacy shape strictly preserved),
//   (b) a living-battlefield frame round-trips: round/economy/intendant/towers
//       and every soldier, horde unit, structure, bar and projectile survive
//       encode→decode byte-for-byte (within the documented rounding),
//   (c) determinism: encoding the same state twice yields identical bytes.
//
// Pure Node, no Phaser, no DOM. Exit 0 = green.

import Simulation from '../src/sim/Simulation.js';
import { encodeSnapshot, decodeSnapshot } from '../src/net/snapshotCodec.js';

const DT = 1 / 60;
let passed = 0;
let failed = 0;
const log = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (ok) passed += 1; else failed += 1; };
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

const biome = { id: 'test', roughness: 1, heightVariance: 0, centralRise: 0, windScale: 1, distanceVariance: 0 };
const lcg = () => { let a = 0x1234567; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };

function roundtrip(state, events = []) {
  const bytes = encodeSnapshot(state, events);
  // ws delivers an ArrayBuffer; mirror that (a fresh, exactly-sized buffer).
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { decoded: decodeSnapshot(ab), bytes };
}

// --- (a) legacy 2-player frame: no battlefield key --------------------------
{
  const sim = new Simulation({ names: ['Alice', 'Bob'], winsNeeded: 3, biome, maxHp: 3, random: lcg() });
  sim.start();
  for (let i = 0; i < 120; i += 1) sim.tick(DT);
  const state = sim.snapshot();
  const { decoded } = roundtrip(state);
  log(state.battlefield === undefined, '(a) source 2P snapshot has no battlefield block');
  log(decoded.state.battlefield === undefined, '(a) decoded 2P frame has no battlefield key');
  log(decoded.state.names[0] === 'Alice' && decoded.state.names[1] === 'Bob', '(a) legacy fields still round-trip (names)');
  log(decoded.state.towers.length === 2 && approx(decoded.state.towers[0].hp, state.towers[0].hp), '(a) legacy towers round-trip');
}

// --- (b) living-battlefield frame round-trips -------------------------------
{
  const sim = new Simulation({ names: ['P1', 'P2'], winsNeeded: 3, biome, maxHp: 3, livingBattlefield: true, random: lcg() });
  sim.start();
  const bf = sim.battlefield;
  bf.setIntendantInput({ right: true, dig: true });
  // Run long enough to spawn a few soldiers and move the Intendant around.
  for (let i = 0; i < 60 * 8; i += 1) sim.tick(DT);
  // Force a horde by destroying the red tower, then a tick to fire endSequence.
  bf.onTowerDestroyed(1);
  sim.tick(DT);
  // Inject the rest of the world AFTER the last tick (so nothing is stepped away
  // before the snapshot) to exercise every wire branch: aim angle, structures,
  // bars, alignment, economy, and one projectile of each shape.
  bf.I.aimAng = 0.42; bf.I.weapon = 'bow'; bf.I.style = 1;
  bf.I.bp = [7, 3];
  bf.invader = 1;
  bf.structures.push({ x0: 600, x1: 616, y: 320 }, { x0: 616, x1: 632, y: 315 });
  bf.arrows.push({ x: 500, y: 200, ball: true, gren: false, owner: 0, life: 2 });
  bf.arrows.push({ x: 510, y: 210, ball: true, gren: true, owner: 1, dmg: 1, cr: 12, life: 2 });
  bf.arrows.push({ x: 520, y: 220, bolt: true, owner: 1, life: 1 });
  bf.arrows.push({ x: 530, y: 230, musket: true, soldier: true, owner: 0, life: 1 });
  bf.arrows.push({ x: 540, y: 240, fromI: true, life: 1 });
  // active magic shield with two impact sparks (exercises the shield wire branch)
  bf.I.shieldT = 1.2; bf.I.shieldHit = 0.8; bf.I.shieldFx = [{ a: 1.234, t: 0.4 }, { a: -2.1, t: 0.15 }];

  const state = sim.snapshot();
  const src = state.battlefield;
  log(!!src && src.soldiers.length > 0, `(b) source has a battlefield block (${src ? src.soldiers.length : 0} soldiers, ${src ? src.horde.length : 0} horde)`);

  const { decoded } = roundtrip(state);
  const got = decoded.state.battlefield;
  log(!!got, '(b) decoded frame carries the battlefield block');

  // round + scalars
  const r = src.round; const gr = got.round;
  log(gr.loserOwner === r.loserOwner && gr.ruinSide === r.ruinSide && gr.lastWinner === r.lastWinner && gr.scored === r.scored && approx(gr.ruinT, r.ruinT, 0.05), '(b) round block round-trips');
  log(got.invader === src.invader && got.present === src.present && got.score === src.score && got.banner === src.banner, '(b) invader/present/score/banner round-trip');

  // intendant
  const I = src.intendant; const gI = got.intendant;
  const iOk = gI.x === I.x && gI.y === I.y && gI.hp === Math.max(0, Math.round(I.hp))
    && gI.facing === I.facing && gI.weapon === I.weapon && gI.dead === I.dead
    && gI.playable === I.playable && gI.building === I.building && gI.act === I.act
    && gI.bp[0] === I.bp[0] && gI.bp[1] === I.bp[1] && approx(gI.aimAng, I.aimAng, 1e-3);
  log(iOk, '(b) intendant round-trips (pos/hp/weapon/flags/economy/aim)');

  // magic shield (quantised window + pulse + impact sparks)
  const sh = I.shield; const gsh = gI.shield;
  const shOk = !!gsh && approx(gsh.t, sh.t, 0.03) && approx(gsh.hit, sh.hit, 0.01)
    && gsh.fx.length === sh.fx.length && gsh.fx.every((f, i) => approx(f.a, sh.fx[i].a, 2e-3) && approx(f.t, sh.fx[i].t, 0.01));
  log(shOk, `(b) intendant shield round-trips (window + ${gsh ? gsh.fx.length : 0} impact sparks)`);

  // towers (warn only, owner by index)
  const tOk = got.towers.length === 2 && got.towers.every((t, i) => t.owner === i && t.warn === src.towers[i].warn);
  log(tOk, '(b) battlefield towers round-trip (warn flag, owner by index)');

  // structures
  const stOk = got.structures.length === src.structures.length && got.structures.every((p, i) => p.x0 === src.structures[i].x0 && p.x1 === src.structures[i].x1 && p.y === src.structures[i].y);
  log(stOk, `(b) ${got.structures.length} structures round-trip`);

  // coarse terrain
  const teOk = got.terrain.length === src.terrain.length && got.terrain.every((h, i) => h === src.terrain[i]);
  log(teOk, `(b) coarse terrain round-trips (${got.terrain.length} samples)`);

  // soldiers
  const solOk = got.soldiers.length === src.soldiers.length && got.soldiers.every((s, i) => {
    const o = src.soldiers[i];
    return s.id === o.id && s.owner === o.owner && s.x === o.x && s.y === o.y && s.hp === o.hp && s.kind === o.kind && s.st === o.st && s.deserter === o.deserter && s.dir === o.dir;
  });
  log(solOk, `(b) ${got.soldiers.length} soldiers round-trip (id/owner/pos/hp/kind/st/deserter/dir)`);

  // horde
  const hOk = got.horde.length === src.horde.length && got.horde.every((s, i) => {
    const o = src.horde[i];
    return s.id === o.id && s.owner === o.owner && s.x === o.x && s.y === o.y && s.st === o.st && s.bg === o.bg && s.dir === o.dir;
  });
  log(hOk, `(b) ${got.horde.length} horde units round-trip`);

  // projectiles
  const pOk = got.projectiles.length === src.projectiles.length && got.projectiles.every((p, i) => {
    const o = src.projectiles[i];
    return p.x === o.x && p.y === o.y && p.ball === o.ball && p.gren === o.gren && p.bolt === o.bolt && p.musket === o.musket && p.fromI === o.fromI && p.owner === o.owner;
  });
  log(pOk, `(b) ${got.projectiles.length} projectiles round-trip (shape flags + owner)`);

  // (c) determinism of the wire bytes
  const a = encodeSnapshot(state);
  const b = encodeSnapshot(state);
  log(a.byteLength === b.byteLength && a.every((v, i) => v === b[i]), `(c) identical state → identical bytes (${a.byteLength}B)`);
}

// --- (d) living-battlefield EVENTS round-trip (lot C) -----------------------
{
  const sim = new Simulation({ names: ['P1', 'P2'], winsNeeded: 3, biome, maxHp: 3, random: lcg() });
  sim.start();
  const state = sim.snapshot();
  const events = [
    { type: 'musket', x: 120, y: 200, owner: 1 },
    { type: 'grenadeLob', x: -40, y: 90, owner: 0 },
    { type: 'grenadeBurst', x: 333, y: 410 },
    { type: 'fieldFire', x: 800, y: 250, owner: 1 },
    { type: 'melee', x: 640, y: 360 },
    { type: 'soldierDeath', x: 50, y: 600, owner: 0 },
    { type: 'intParry', x: 640, y: 340 },
    { type: 'intFatal', x: 641, y: 341 },
    { type: 'intBuild', x: 600, y: 320, kind: 1 },
    { type: 'intDig', x: 12, y: 9, kind: 2 },
    { type: 'horde', x: 72, y: 600, owner: 0 },
    // 2nd-pass timbres (lot C, append-only)
    { type: 'projGround', x: 30, y: 40, kind: 0 },
    { type: 'projGround', x: 31, y: 41, kind: 1 },
    { type: 'projFlesh', x: 32, y: 42, kind: 1 },
    { type: 'intBow', x: 33, y: 43 },
    { type: 'intSword', x: 34, y: 44 },
    { type: 'intHurt', x: 35, y: 45 },
    { type: 'towerVolley', x: 36, y: 46, owner: 1, n: 4 },
    { type: 'apparition', x: 37, y: 0 },
    { type: 'glide', x: 38, y: 48 },
    { type: 'cannonWreck', x: 39, y: 49, owner: 0 },
  ];
  const { decoded } = roundtrip(state, events);
  const ev = decoded.events;
  log(ev.length === events.length, `(d) ${ev.length}/${events.length} battlefield events decoded`);
  const same = ev.every((g, i) => {
    const o = events[i];
    return g.type === o.type && (o.x === undefined || g.x === o.x) && (o.y === undefined || g.y === o.y)
      && (o.owner === undefined || g.owner === o.owner) && (o.kind === undefined || g.kind === o.kind)
      && (o.n === undefined || g.n === o.n);
  });
  log(same, '(d) every new event type round-trips (type/x/y/owner/kind)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
