// Headless Node harness for the living-battlefield sim (lot 1).
//
//   node test/battlefield.test.mjs
//
// Proves, façon harness:
//   (a) ZERO Math.random calls during the whole run (global spy throws),
//   (b) a soldier crosses a gully via a bridge laid by the Intendant,
//   (c) end of round (tower destroyed → horde → success iff a soldier reaches
//       the ruin, failure otherwise),
//   (d) N frames without exception,
//   (e) determinism (same seed → identical state).
//
// Pure Node, no Phaser. Exit code 0 = all green.

import Battlefield from '../src/sim/battlefield.js';
import Simulation from '../src/sim/Simulation.js';

const DT = 1 / 60;
let passed = 0;
let failed = 0;
const log = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (ok) passed += 1; else failed += 1; };

// --- (a) Math.random guard: any call during the sim is a hard failure -------
const realRandom = Math.random;
let randomCalls = 0;
Math.random = function trapped() { randomCalls += 1; throw new Error('Math.random() called in seeded sim'); };

// --- synthetic flat-ish world with a deep central gully ---------------------
// y grows downward (screen space). A flat platform at y=300, with a gully
// (much larger y = lower ground) carved in the middle that no soldier can
// descend/climb without help.
function gullyWorld() {
  const width = 1280;
  const height = 720;
  const platformWidth = 220;
  const platY = 300;
  const heights = new Float32Array(width).fill(platY);
  // gully from x=560..720: a deep pit (y=560) the pathfinder treats as a wall.
  for (let x = 560; x <= 720; x += 1) heights[x] = 560;
  return {
    width, height, platformWidth, towerX: [120, 1160], craterR: 38, heights,
    heightAt(x) { const i = Math.max(0, Math.min(width - 1, Math.round(x))); return heights[i]; },
    carveCrater() {}, dig() {}, fill() {}, flatten() {}, bash() {}, editColumn() {},
  };
}

function run(fn) {
  try { fn(); } catch (e) { Math.random = realRandom; console.error('EXCEPTION:', e.stack); failed += 1; }
}

// --- (b) bridge crossing ----------------------------------------------------
run(() => {
  const world = gullyWorld();
  const bf = new Battlefield({ seed: 4242, world, params: { spawnFreq: 999 } });
  bf.invader = -1; // truce: keep the Intendant out of combat

  // No path across the raw gully (proves the obstacle is real).
  const before = bf.findPath(120, world.heightAt(120), 1160);
  log(before == null, '(b) no path across the bare gully (obstacle is real)');

  // Lay a flat bridge of planks spanning the gully at platform height.
  for (let x = 540; x <= 740; x += 16) bf.structures.push({ x0: x, x1: x + 16, y: 300 });
  bf.navVer += 1;
  const after = bf.findPath(120, world.heightAt(120), 1160);
  log(after != null, '(b) path exists once the bridge is laid');

  // Spawn one blue soldier and march it; it must reach the right tower.
  const s = bf.newSoldier(0);
  s.st = 'march'; s.x = 130; s.y = 300; bf.soldiers = [s];
  let crossed = false;
  for (let i = 0; i < 60 * 60; i += 1) {
    bf.step(DT);
    if (bf.soldiers.length === 0 || (bf.soldiers[0] && bf.soldiers[0].x > 1000)) { crossed = true; break; }
  }
  // gone=true (reached enemy tower) removes it from the list, or it got past the gully far side.
  log(crossed, '(b) the soldier traverses the gully via the bridge');
});

// --- (c) end of round: success and failure cases ----------------------------
function roundOutcome({ bridge }) {
  const world = gullyWorld();
  const bf = new Battlefield({ seed: 77, world, params: { spawnFreq: 999 } });
  bf.invader = -1;
  if (bridge) { for (let x = 540; x <= 740; x += 16) bf.structures.push({ x0: x, x1: x + 16, y: 300 }); bf.navVer += 1; }
  // Destroy the right (red) tower → blue wins → blue horde charges the ruin.
  bf.onTowerDestroyed(1);
  bf.step(DT); // endSequence fires (loserOwner set, horde spawned)
  if (bf.loserOwner !== 1) throw new Error('endSequence did not resolve the round');
  if (bf.horde.length < 3 || bf.horde.length > 8) throw new Error(`horde size ${bf.horde.length} out of 3..8`);
  // Run until the round transitions (ruinT elapses → nextRound) or scored.
  let scored = false;
  for (let i = 0; i < 60 * 40; i += 1) {
    bf.step(DT);
    if (bf.roundScored) { scored = true; break; }
    if (bf.loserOwner < 0) break; // nextRound happened (round closed without scoring)
  }
  return scored;
}

run(() => {
  const success = roundOutcome({ bridge: true });
  log(success, '(c) round SUCCESS: a horde soldier reaches the ruin (bridge laid)');
});
run(() => {
  const fail = roundOutcome({ bridge: false });
  log(!fail, '(c) round FAILURE: no soldier reaches the ruin across the bare gully');
});

// --- (d) N frames without exception, through the real Simulation ------------
run(() => {
  const biome = { id: 'test', roughness: 1, heightVariance: 0, centralRise: 0, windScale: 1, distanceVariance: 0 };
  const seeded = (() => { let a = 0x1234567; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const sim = new Simulation({ names: ['A', 'B'], winsNeeded: 3, biome, maxHp: 3, livingBattlefield: true, random: seeded });
  sim.start();
  if (!sim.battlefield) throw new Error('battlefield not built when livingBattlefield=on');
  let frames = 0;
  // Drive the Intendant a bit (move + jump + dig intents) to exercise paths.
  sim.battlefield.setIntendantInput({ right: true, jump: true, dig: true });
  for (let i = 0; i < 60 * 30; i += 1) { sim.tick(DT); frames += 1; const snap = sim.snapshot(); if (!snap.battlefield) throw new Error('snapshot lost battlefield block'); }
  log(frames === 60 * 30, `(d) ${frames} frames through Simulation with no exception`);

  // Non-regression: the same biome/seed with livingBattlefield OFF carries no
  // battlefield block (legacy snapshot shape preserved).
  const seeded2 = (() => { let a = 0x1234567; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const plain = new Simulation({ names: ['A', 'B'], winsNeeded: 3, biome, maxHp: 3, random: seeded2 });
  plain.start();
  for (let i = 0; i < 120; i += 1) plain.tick(DT);
  log(plain.battlefield === null && plain.snapshot().battlefield === undefined, '(d) mode OFF by default: no battlefield in snapshot (non-regression)');
});

// --- (e) determinism: same seed → identical serialized state ----------------
function fingerprint(seed) {
  const world = gullyWorld();
  const bf = new Battlefield({ seed, world, params: {} });
  bf.invader = 1;
  for (let i = 0; i < 60 * 12; i += 1) { if (i % 90 === 0) bf.spawnPair(); bf.step(DT); }
  return JSON.stringify(bf.snapshot());
}
run(() => {
  const a = fingerprint(20260621);
  const b = fingerprint(20260621);
  const c = fingerprint(20260622);
  log(a === b, '(e) same seed → identical state');
  log(a !== c, '(e) different seed → different state');
});

// --- (f) sky entrance: a fresh arrival / hot-join glides down from the top;
// a reconnect within grace (present never toggled) must NOT re-launch him -----
run(() => {
  const world = gullyWorld();
  const bf = new Battlefield({ seed: 1, world, params: { spawnFreq: 999 } });

  // First appearance: the seat activates → he drops in from above the screen.
  bf.setPresent(true);
  log(bf.I.y === -30 && bf.I.onGround === false, '(f) first appearance enters from the sky');

  // Land him, then a no-op re-activation (within-grace reconnect) keeps him put.
  bf.I.y = 300; bf.I.onGround = true;
  bf.setPresent(true);
  log(bf.I.y === 300 && bf.I.onGround === true, '(f) re-activation while present does not re-launch him');

  // β: seat freed → absent (no soldiers). A later hot-join enters from the sky.
  bf.setPresent(false);
  log(bf.present === false && bf.I.playable === false, '(f) empty seat → absent (truce, no soldiers)');
  bf.setPresent(true);
  log(bf.I.y === -30 && bf.I.onGround === false, '(f) hot-join after the seat was freed re-enters from the sky');
});

// --- (g) the Intendant is vulnerable to the players' DUEL artillery, and his
// shield auto-parries it — independent of his alignment (neutral round 1) ----
run(() => {
  const world = gullyWorld();
  const bf = new Battlefield({ seed: 7, world, params: { maxHp: 5 } });
  bf.setPresent(true);
  bf.invader = -1;              // truce: no will to attack (round-1 neutral)
  bf.I.x = 600; bf.I.y = 300; bf.I.onGround = true; bf.I.iframe = 0;
  const hp0 = bf.I.hp;

  // A duel shell crossing the Intendant's dome: parried, costs a flat 1 HP and
  // opens a shield window. Returns true so the duel retires the shell.
  const parried = bf.duelShellHitsIntendant(600, 280, 600, 300, 1);
  log(parried === true, '(g) duel shell within the dome is parried (consumed)');
  log(bf.I.hp === hp0 - 1, '(g) parry costs a flat 1 HP even while neutral');
  log(bf.I.shieldT > 0, '(g) parry opens a shield window');

  // A second shell during the open window is blocked for free (no extra HP).
  const hp1 = bf.I.hp;
  bf.duelShellHitsIntendant(600, 280, 600, 300, 1);
  log(bf.I.hp === hp1, '(g) further shells within the window are free');

  // A shell nowhere near him does nothing.
  const miss = bf.duelShellHitsIntendant(100, 100, 120, 100, 1);
  log(miss === false && bf.I.hp === hp1, '(g) a distant shell never touches him');

  // Absent Intendant: immune (no seat to hit).
  bf.setPresent(false);
  log(bf.duelShellHitsIntendant(bf.I.x, bf.I.y - 10, bf.I.x, bf.I.y, 1) === false, '(g) absent Intendant is not hittable');
});

// --- (a) verdict ------------------------------------------------------------
Math.random = realRandom;
log(randomCalls === 0, `(a) zero Math.random calls during the run (count=${randomCalls})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
