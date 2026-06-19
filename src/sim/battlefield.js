import { mulberry32 } from './rng.js';

// ---------------------------------------------------------------------------
// Champ de bataille vivant — pure simulation layer (Phaser-free, Node-safe).
//
// Ported from the validated prototype `design/battlefield-lab.html` (v22). It
// simulates the *living world* that sits on top of the turn-by-turn artillery
// duel: continuous soldiers (3 types), a third player (the Intendant) who
// reshapes the terrain and builds Lemmings-style works, an A* pathfinder over
// surfaces (ground + planks), the round loop, the per-colour economy, tower
// defence and projectiles.
//
// Hard constraints honoured here:
//   * NO Math.random — every random draw comes from a seed (mulberry32). The
//     instance owns its own generator (`this._rnd`); the spec calls this `rnd`.
//   * Deterministic fixed-step `step(dt)`: same seed + same inputs → same run.
//   * No DOM / no Phaser / no Date.now(): it composes with the existing
//     terrain by receiving a `world` adapter instead of regenerating terrain.
//
// The module does NOT regenerate terrain. `Simulation` already owns
// `terrain.js`; it passes a `world` adapter (heightAt, tower xs, bounds,
// craters) so the living world rides on the same authoritative ground.
// ---------------------------------------------------------------------------

// Default tuning. These are the lab's `C` constants verbatim (kept as the
// reference feel); they will be re-tuned to the real 1280×720 scale during
// playtest (see design/integration-plan.md, "Écarts assumés").
export const DEFAULT_PARAMS = {
  // slopeFx (B5/#2): speed factor vs slope — clamp(1 − |slope|·slopeFx, 0.4, 1.4).
  // (Replaces the dead slopeK; the Intendant keeps its own 0.45 coefficient.)
  // Fall model (B1/#6): during a descent we accumulate descAcc; on landing the
  // tumble probability is LINEAR — 0% at fallHmin, 100% at fallHmax. (Replaces
  // the old steepDown/fallProb threshold model.)
  v0: 70, slopeFx: 0.25, fallHmin: 7, fallHmax: 26, fallDmg: 3, engage: 14,
  sHp: 4, spacing: 18, spawnFreq: 6, doorT: 0.25,
  archerPct: 0.1, arHp: 2, arDmg: 1, arRange: 140, desertT: 4,
  // End-of-round horde verdict (living mode). After a tower falls the winner's
  // horde charges the ruin and the round HOLDS on the outcome before the arena
  // pans. ruinCap: hard backstop (s) so a stuck horde can never hang the match.
  // ruinHold: beat held once a soldier reaches the ruin (victory). ruinWipeHold:
  // brief beat once the horde is wiped out. ruinStall: seconds of zero forward
  // progress that trip a surrender. ruinRetreat: px the white-flag survivors fall
  // back (rebroussement) before the transition fires.
  ruinCap: 14, ruinHold: 1.6, ruinWipeHold: 0.5, ruinStall: 3.5, ruinRetreat: 22,
  // ruinJam (#2): seconds with the WHOLE living horde non-advancing (all wedged /
  // waiting) before an early surrender — a faster verdict than ruinStall for a
  // horde blocked at an impassable edge, so it never holds the match to ruinCap.
  ruinJam: 1.2,
  // Timed-action FSM (B6/#9): every attack/work is Wind → effect → Rec via
  // actTick (the unit is engaged/immobile while its action lives). Replaces the
  // old continuous cadences (sDps/arRate/musReload/bowRate/effort/buildInterval).
  bayoWind: 0.15, bayoRec: 0.45, bayoDmg: 2,   // soldier bayonet: single hit per cycle
  musWind: 0.6, musRec: 1.6,                   // soldier musket: aim → shot → reload
  grenWind: 1.35, grenRec: 0.15,                // grenadier: arm → throw → after-burst
  cataWind: 2, cataRec: 1.6,                   // field cannon: lay → fire → reload
  swWind: 0.2, swRec: 0.3,                     // Intendant sword (swDmg per hit)
  bowWind: 0.25, bowRec: 0.3,                  // Intendant bow
  toolWind: 0.18, toolDur: 0.12, toolRec: 0.18, // Intendant dig/fill/flatten
  buildWind: 0.25, buildDur: 0.26, buildRec: 0.3, // Intendant stair/bridge
  // Sterile-combat repositioning (B4): a unit firing without resolving for its
  // OWN repTime pushes forward repPush seconds and replans, to seek a better
  // angle. repTime is per-unit, drawn in [repTimeMin, repTimeMax) deterministically
  // from the seed + spawn order (via the unit's jseed — no Math.random).
  repTimeMin: 1, repTimeMax: 4, repPush: 0.7,
  musRange: 160, musDmg: 3, chargeRange: 70,
  // Per-soldier range jitter (±rangeJit px): a fixed offset drawn once at spawn
  // from the unit's jseed (no rng, no per-tick cost). Breaks the dead-on tie
  // where two facing soldiers share the same reach and freeze at the same spot —
  // one slightly out-ranges the other, so the opening shot varies. Purely
  // cosmetic-feel, not a balance lever (the two camps average out over the seed).
  rangeJit: 8,
  // Explosions (cannonball + grenade) vs living units: full damage if the round
  // touches the body (9px soldier / 12px Intendant), else ×splashFactor within
  // the blast radius (the crater). ballDmg is the cannonball's direct HP damage.
  // Grenades still drain an Intendant resource (no HP) — that economy is kept.
  ballDmg: 2, splashFactor: 0.5,
  // Musketry: shots aren't perfect. `musAcc` is the chance a shot is "on aim"
  // (tight `musSpread` angular error); otherwise it flies wide (`musMissSpread`).
  // Damage on hit is jittered ±musDmgVar/2 around musDmg (±50%). All seeded (rnd()).
  musAcc: 0.78, musSpread: 0.045, musMissSpread: 0.22, musDmgVar: 1.0,
  // Projectile speeds (B7/#1) + grenade flight, exposed (were hardcoded).
  // grenLob: default lob reach when a grenadier has no precise target.
  ballSpeed: 470, musSpeed: 480, bowSpeed: 440, boltSpeed: 380, grenTime: 0.6, grenLob: 120,
  // Damage variances (A/#4): dmg × (1 + (rnd()−0.5)·var), always seeded. musDmgVar
  // & bowDmgVar already applied; ballDmgVar (cannonball), grenDmgVar (grenade),
  // swDmgVar (Intendant sword) now applied. bayoDmgVar stays dormant until the
  // bayonet becomes per-hit (FSM, #9) — soldier melee is still continuous DPS.
  ballDmgVar: 0.5, grenDmgVar: 1.5, swDmgVar: 0.45, bayoDmgVar: 0.3,
  intSpeed: 150, jumpV: 280, glide: 55, climbSpeed: 15,
  swordR: 30, swDmg: 5, bowDmg: 3, bowRange: 240,
  // Intendant archery: same model as musketry — aim chance + damage jitter.
  bowAcc: 0.85, bowSpread: 0.035, bowMissSpread: 0.18, bowDmgVar: 0.35,
  // Pathfinding decongestion: routes are penalised by local soldier density
  // (pathCongestion, per body in a column) and broken up by a tiny per-soldier
  // seeded jitter (pathJitter) so a horde fans out across alternatives instead
  // of all queuing through the same chokepoint.
  pathCongestion: 3.5, pathJitter: 0.18,
  // Per-type movement (B2/#5): global base (v0 / fallDmg / sJump) × a per-type
  // multiplier. Tables SPD_MUL/FALL_MUL/JUMP_MUL map kind→key; helpers default
  // to 1 (the horde, kind-less, inherits the base). The cannon carries its old
  // hardcoded factors (×0.4 speed, ×2.5 fall, ×0 jump = no jump).
  sJump: 10,
  mqSpdMul: 1, grSpdMul: 1.15, caSpdMul: 0.4, enSpdMul: 0.9,
  mqFallMul: 1, grFallMul: 0.9, caFallMul: 2.5, enFallMul: 1.5,
  mqJumpMul: 1, grJumpMul: 1, caJumpMul: 0, enJumpMul: 1,
  // Engineer (ingénieur, #14): a non-combatant who lays ONE free work then deserts.
  // engBridgeMax planks (PW wide) over a hole; an engLadH×engLadRun inclined
  // ladder up a steep wall. engWind/engDur/engRec pace the build (no actTick).
  engHp: 3, engBridgeMax: 6, engLadH: 40, engLadRun: 24,
  engWind: 0.3, engRec: 0.3, engDur: 0.22,
  // digH (B9/#12): real depth/height (px) of one dig/fill stroke. Digging
  // references a STABLE rim (outside the pit) so the Intendant can sink in
  // without digging to infinity; filling mounds digH above his feet.
  digSpeed: 40, digH: 4, buildSteps: 4,
  grav: 900, climbSlope: 1.35, maxHp: 3,
  // Field cannon (B8/#13): HP + activation range exposed (were hp=8 / <240 figés).
  cataHp: 5, cataRange: 240,
  // Per-munition crater radii (B10/#7): cannonball (× pw slope handicap) and
  // grenade, independent of craterR (now the manual-tool/default radius only).
  ballCraterR: 24, grenCraterR: 9,
  towerWarn: 150, towerFire: 95, towerRate: 1.6, craterR: 34,
  // Tower musketry (B/#3): towerDmg per bolt (99 ≈ one-shot by default; lower it
  // and soldiers can survive a hit), towerBolts = max bolts per volley (1..N).
  towerDmg: 99, towerBolts: 4,
  // Magic shield: an incoming artillery ball within shieldR of the Intendant is
  // intercepted (bursts on the dome, not the avatar). Auto while HP remain; each
  // activation costs 1 HP and lasts shieldDur, during which further balls are
  // blocked for free. The *visual style* is per-biome (biome.intendantShield),
  // never branched on a biome name. Radius mirrored render-side in BattlefieldView.
  shieldR: 42, shieldDur: 1.5,
};

// Intendant body theme (biome.intendantBody) → the BODY-registry index used by
// the renderer (BattlefieldView.drawIntBody). Data-driven: the sim carries the
// resolved style on the wire, so there is never a biome-name branch render-side.
const BODY_STYLE = { robe: 1, worker: 2, scout: 3, mascot: 4 };

const SU = 14;        // max step a soldier can climb between adjacent columns
const PATH_STEP = 8;  // pathfinder column spacing (lab STEP)
const PW = 16;        // bridge plank width
const SW = 11;        // stair step width
const SH = 5;         // stair step height (fine → soldiers cross freely)
const BUILD_COST = 5; // per work: 5 blue + 5 red
const TERRAIN_SAMPLE = 8; // px between coarse heightfield samples sent to the TV
const STROKE = 0.32;  // amount of one terraform stroke (oneshot)

// Per-type movement (B2/#5): soldier kind → multiplier key in C. The helpers
// (spdMul/fallMul/jumpMul/climbStep) default to 1, so the horde (no kind) and
// any future type inherit the global base.
const SPD_MUL = { sword: 'mqSpdMul', bow: 'grSpdMul', cata: 'caSpdMul', engineer: 'enSpdMul' };
const FALL_MUL = { sword: 'mqFallMul', bow: 'grFallMul', cata: 'caFallMul', engineer: 'enFallMul' };
const JUMP_MUL = { sword: 'mqJumpMul', bow: 'grJumpMul', cata: 'caJumpMul', engineer: 'enJumpMul' };

// Deterministic per-(soldier, column) noise in [0,1) for pathfinding jitter.
// Pure integer hash → no Math.random, stable for a given (seed, column).
function hash2(a, b) {
  let h = (Math.imul(a >>> 0, 73856093) ^ Math.imul(b >>> 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export default class Battlefield {
  // world: {
  //   width, height,
  //   heightAt(x)           -> terrain surface y at x (lower y = higher up),
  //   towerX: [xLeft,xRight],
  //   platformWidth,        -> PLAT (edge no-go width)
  //   carveCrater(x,y,r)    -> optional: punch terrain on the shared heightfield,
  //   craterR               -> default crater radius (px).
  // }
  constructor({ seed = 12345, world, params = {}, intendantBody = 'robe' } = {}) {
    this.seed = (seed >>> 0) || 1;
    this._rnd = mulberry32(this.seed);
    this.C = { ...DEFAULT_PARAMS, ...params };
    // Avatar style is a per-biome DATA choice (biome.intendantBody), resolved to
    // the renderer's BODY-registry index here and carried on the wire.
    this.bodyStyle = BODY_STYLE[intendantBody] ?? 1;

    this.world = world;
    this.W = world.width;
    this.H = world.height;
    this.PLAT = world.platformWidth ?? 130;
    this.TLX = world.towerX ? world.towerX[0] : 72;
    this.TRX = world.towerX ? world.towerX[1] : this.W - 72;
    if (world.craterR != null) this.C.craterR = world.craterR;

    // platLine: the flat platform line each tower stands on, indexed by owner.
    // Variable arenas give the left and right platforms independent heights
    // (Simulation draws leftY/rightY separately), so a single shared line would
    // spawn one camp's soldiers buried in (or floating above) their own ground.
    // Cached per round: the flat platform doesn't move unless a crater carves it
    // (handled separately by the sapper logic).
    this.platLine = [world.heightAt(this.TLX), world.heightAt(this.TRX)];
    this.platY = this.platLine[0]; // left reference, kept for tower-top geometry
    this.top = this.platY - 96; // tower top (body height 96, as geometry.js)

    // entity state (lab globals → instance fields)
    this.structures = [];   // {x0,x1,y} planks (bridge/stair)
    this.ladders = [];      // {xb,yb,xt,yt} inclined ladders laid by the engineer
    this.bars = [];         // consolidation bars {x,y}
    this.soldiers = [];
    this.horde = [];
    this.arrows = [];        // projectiles (bullets, bolts, balls, grenades, I-arrows)
    this.nextId = 1;
    this.navVer = 1;         // bumped when terrain/structures change → replan
    this.ruinT = 0;
    this.ruinSide = -1;
    this.loserOwner = -1;    // camp whose tower is destroyed (round resolved)
    this.lastWinner = -1;
    this.roundScored = false; // did the Intendant score this round (horde arrived)
    // Round-end horde verdict. The host (Simulation) holds the arena pan until
    // endDone latches, so the charge actually resolves on screen (see step).
    this.endSeq = false;      // a tower fell → the horde is deciding the round
    this.endVerdict = null;   // 'victory' | 'wipe' | 'surrender' once decided
    this.endDone = false;     // verdict fully rendered (beat/retreat over) → may pan
    this.endHold = 0;         // closing-beat timer (victory/wipe) / retreat backstop
    this.hordeBest = 0;       // furthest progress toward the ruin (px) — stall watch
    this.hordeStall = 0;      // seconds with no forward progress (→ surrender)
    this.externalRounds = false; // host rebuilds each round; standalone self-advances
    this.roundShots = 0;     // real artillery shots fired so far this round — a
                             // late-joining Intendant is staked +1/+1 per shot
                             // he missed (symmetric "late bonus"; asymmetry is
                             // earned in-play). Reset each round.
    this.invader = -1;       // -1 truce, 0 blue, 1 red
    this.pendingCata = [false, false];
    this.present = true;     // Intendant present (else >10s disconnect: truce)
    this.enteredWorld = false; // has made his sky entrance yet (gates the descent)
    this.spawnMode = 'auto';
    this.spawnTimer = 0;
    // Field-cannon firing is synced to the real artillery when driven by the
    // game (Simulation sets syncCannon=true): a camp's escalade cannon may fire
    // only after that camp's tower really fired. Standalone (lab) keeps the
    // prototype's fixed cadence. cannonArmed counts the pending permissions.
    this.syncCannon = false;
    this.cannonArmed = [0, 0];
    this.animClock = 0;
    this.banner = '';
    this.bannerT = 0;
    this.score = 0;          // Intendant: rounds where a soldier crossed

    this.towers = [
      { x: this.TLX, facing: 1, owner: 0, warn: false, warnA: 0, aim: null, t: 0, hp: this.C.maxHp, flash: 0 },
      { x: this.TRX, facing: -1, owner: 1, warn: false, warnA: 0, aim: null, t: 0, hp: this.C.maxHp, flash: 0 },
    ];

    // Intendant avatar. bp = per-colour resources [blue, red].
    this.I = {
      x: this.W / 2, y: -30, vy: 0, facing: 1, onGround: false, hp: this.C.maxHp,
      weapon: 'bow', glide: false, dead: false, playable: true, job: null, act: null,
      bowT: 0, iframe: 1.2, hurt: 0, dropT: 0, attacking: false, aimAng: null,
      style: this.bodyStyle, step: 0, walking: false, jumpY: -9999, bp: [0, 0],
      // shieldT: remaining shield-window (s); shieldHit: impact flash 0..1;
      // shieldFx: live impact sparks {a: angle, t: remaining}.
      shieldT: 0, shieldHit: 0, shieldFx: [],
    };

    // Intendant input intents (set by setIntendantInput; the controller persona
    // will drive these over the wire in a later lot). Keyboard-equivalent flags.
    this.input = { left: false, right: false, up: false, down: false, jump: false, dig: false, fill: false, flat: false };

    this.events = []; // one-shot audio/vfx events drained by Simulation each tick (lot C)
  }

  rnd() { return this._rnd(); }

  // One-shot events (tir, impacts, mort, bouclier, build…) → Simulation forwards
  // them into the snapshot each tick, where TV/controllers play the matching SFX.
  _ev(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // --- world helpers (terrain + structures) --------------------------------

  cX(x) { return x < 0 ? 0 : (x > this.W - 1 ? this.W - 1 : x | 0); }
  terrAt(x) { return this.world.heightAt(Math.round(x)); }
  doorX(T) { return T.x + T.facing * 14; }
  slitOf(T) { return { x: T.x + T.facing * 16, y: this.top + 28 }; }

  // Per-type movement multipliers (B2/#5) — default 1 (horde / unknown kind).
  spdMul(k) { return this.C[SPD_MUL[k]] ?? 1; }
  fallMul(k) { return this.C[FALL_MUL[k]] ?? 1; }
  jumpMul(k) { return this.C[JUMP_MUL[k]] ?? 1; }
  // Step a kind can climb-jump onto: SU + sJump × its jump mult (px).
  climbStep(k) { return SU + this.C.sJump * this.jumpMul(k); }

  // Timed-action FSM (B6/#9): u[field] = {ph,t}. Phase 0 = Wind (onStart captures
  // the target at launch), onFire runs ONCE at the end of Wind, phase 1 = Rec,
  // then the slot frees. The unit stays engaged (immobile) while u[field] lives.
  actTick(u, field, dt, wind, rec, onStart, onFire) {
    let a = u[field];
    if (!a) { a = u[field] = { ph: 0, t: wind }; if (onStart) onStart(a); }
    a.t -= dt;
    if (a.ph === 0) { if (a.t <= 0) { onFire(a); a.ph = 1; a.t = rec; } }
    else if (a.t <= 0) { u[field] = null; }
  }

  // highest solid surface at x at/above yRef (terrain or any plank above it)
  supportAt(x) {
    let y = this.terrAt(x);
    for (const p of this.structures) { if (x >= p.x0 && x <= p.x1 && p.y < y) y = p.y; }
    return y;
  }

  // surface CLOSEST to yRef and reachable (no vertical jump to a far platform)
  groundY(x, yRef) {
    const t = this.terrAt(x);
    let best = t;
    let bd = (t < yRef - SU) ? 1e9 : Math.abs(t - yRef);
    for (const p of this.structures) {
      if (x < p.x0 || x > p.x1 || p.y < yRef - SU) continue;
      const d = Math.abs(p.y - yRef);
      if (d < bd) { bd = d; best = p.y; }
    }
    return best;
  }

  // line of sight: target visible if the segment stays above the terrain
  inSight(x0, y0, x1, y1) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let i = 1; i < n; i += 1) {
      const u = i / n;
      const x = x0 + (x1 - x0) * u;
      const y = y0 + (y1 - y0) * u;
      if (y >= this.terrAt(x) + 1) return false;
    }
    return true;
  }

  // practicable surfaces at x (ground + planks above it) — pathfinder nodes
  surfacesAt(x) {
    const t = this.terrAt(x);
    const out = [t];
    for (const p of this.structures) { if (x >= p.x0 && x <= p.x1 && p.y <= t + 2) out.push(p.y); }
    return out;
  }

  // --- A* pathfinder over surfaces (ground + works) ------------------------

  // Returns an array of {x,y} waypoints from (sx,sy) to goalX, or null.
  // opts (soldier routing only — the crossing feasibility test passes none):
  //   density  : per-column occupancy array (this._density) → congestion cost,
  //   congW    : weight per occupant,
  //   jseed    : the soldier's stable seed → per-column jitter,
  //   jitter   : jitter amount (× STEP). Both keep the cost monotone-positive,
  //   so feasibility never changes — only which of several routes wins.
  findPath(sx, sy, goalX, opts = {}) {
    const { density = null, congW = 0, jseed = 0, jitter = 0, climb = SU } = opts;
    const STEP = PATH_STEP;
    const N = Math.floor((this.W - 6) / STEP);
    const gi = Math.max(0, Math.min(N, Math.round(goalX / STEP)));
    const si = Math.max(0, Math.min(N, Math.round(sx / STEP)));
    let startY = this.terrAt(si * STEP);
    let bd = 1e9;
    for (const y of this.surfacesAt(si * STEP)) { const d = Math.abs(y - sy); if (d < bd) { bd = d; startY = y; } }
    const key = (i, y) => `${i}_${Math.round(y)}`;
    const dist = new Map();
    const prev = new Map();
    const nyMap = new Map();
    const done = new Set();
    const sk = key(si, startY);
    dist.set(sk, 0); prev.set(sk, null); nyMap.set(sk, startY);
    let guard = 0;
    while (guard < 6000) {
      guard += 1;
      let cur = null;
      let cd = 1e9;
      for (const [k, v] of dist) { if (!done.has(k) && v < cd) { cd = v; cur = k; } }
      if (cur == null) break;
      done.add(cur);
      const ci = parseInt(cur, 10);
      const cy = nyMap.get(cur);
      if (ci === gi) {
        const path = [];
        let k = cur;
        while (k) { path.push({ x: parseInt(k, 10) * STEP, y: nyMap.get(k) }); k = prev.get(k); }
        return path.reverse();
      }
      for (const i2 of [ci - 1, ci + 1]) {
        if (i2 < 0 || i2 > N) continue;
        const x2 = i2 * STEP;
        for (const y2 of this.surfacesAt(x2)) {
          const up = cy - y2;
          if (up > climb + 1) continue; // step too high for this kind (SU + jump) → impassable
          const drop = y2 - cy;
          let cost = STEP + (drop > SU ? drop * 0.6 : 0) + (up > 0 ? up * 0.25 : 0) + (up > SU ? (up - SU) * 0.8 : 0); // a real jump (beyond SU) costs extra
          if (density) cost += (density[i2] || 0) * congW;
          if (jitter) cost += hash2(jseed, i2) * jitter * STEP;
          const k2 = key(i2, y2);
          const nd = cd + cost;
          if (!dist.has(k2) || nd < dist.get(k2)) { dist.set(k2, nd); prev.set(k2, cur); nyMap.set(k2, y2); }
        }
      }
      // Inclined ladders (ingénieur, #14): foot↔top edge (above the SU cap).
      for (const L of this.ladders) {
        const ib = Math.round(L.xb / STEP); const it = Math.round(L.xt / STEP);
        const cost0 = cd + STEP + Math.abs(L.yt - L.yb) * 0.5;
        if (Math.abs(ib - ci) <= 1 && Math.abs(cy - L.yb) <= SU) { const k2 = key(it, L.yt); if (!dist.has(k2) || cost0 < dist.get(k2)) { dist.set(k2, cost0); prev.set(k2, cur); nyMap.set(k2, L.yt); } }
        if (Math.abs(it - ci) <= 1 && Math.abs(cy - L.yt) <= SU) { const k2 = key(ib, L.yb); if (!dist.has(k2) || cost0 < dist.get(k2)) { dist.set(k2, cost0); prev.set(k2, cur); nyMap.set(k2, L.yb); } }
      }
    }
    return null;
  }

  // navigation surface for soldiers: terrain by default; a structure only acts
  // as a bridge/ramp where the terrain is a wall (steep climb) or a hole.
  navY(x, yRef) {
    const tA = this.terrAt(x);
    const tUp = (yRef - tA) / 4;
    const drop = tA - yRef;
    if (tUp > this.C.climbSlope || drop > 8) {
      const sA = this.groundY(x, yRef);
      if (sA !== tA && (yRef - sA) / 4 <= this.C.climbSlope && Math.abs(sA - yRef) < Math.abs(tA - yRef)) return sA;
    }
    return tA;
  }

  // Inclined ladder within reach of (x,y) — for soldiers and the Intendant (#14).
  ladderAt(x, y) {
    for (const L of this.ladders) {
      const x0 = Math.min(L.xb, L.xt) - 5; const x1 = Math.max(L.xb, L.xt) + 5;
      const y0 = Math.min(L.yb, L.yt) - 6; const y1 = Math.max(L.yb, L.yt) + 6;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return L;
    }
    return null;
  }

  // --- soldiers & spawning -------------------------------------------------

  newSoldier(owner) {
    const dir = owner === 0 ? 1 : -1;
    const xd = this.doorX(this.towers[owner]);
    let kind;
    let hp;
    let plan = null;
    if (this.pendingCata[owner]) { this.pendingCata[owner] = false; kind = 'cata'; hp = this.C.cataHp; }
    // A work would extend reach → an engineer sorties instead of a fighter, then
    // deserts. hasEngineer blocks a duplicate. planEngineer consumes no rng, so
    // the spawn stream stays deterministic. (#14)
    else if (!this.hasEngineer(owner) && (plan = this.planEngineer(owner))) { kind = 'engineer'; hp = this.C.engHp; }
    else if (this.rnd() < this.C.archerPct) { kind = 'bow'; hp = this.C.arHp; }
    else { kind = 'sword'; hp = this.C.sHp; }
    const jseed = (this.rnd() * 0x100000000) >>> 0;
    // Per-unit reposition timeout ∈ [repTimeMin, repTimeMax), deterministic from
    // the seed + spawn order (jseed already encodes both) — no rng consumed. (B4)
    const repTime = this.C.repTimeMin + (this.C.repTimeMax - this.C.repTimeMin) * hash2(jseed, 0x5e9d);
    // rj: fixed range offset ∈ [-rangeJit, +rangeJit) px, seeded from jseed (no rng
    // draw). Added to musket/archer reach so facing soldiers don't freeze in a
    // perfect tie — one out-ranges the other and fires first. (See rangeJit.)
    const rj = (hash2(jseed, 0x9a17) - 0.5) * 2 * this.C.rangeJit;
    const s = { id: this.nextId++, owner, x: xd, y: this.platLine[owner], dir, kind, hp, hp0: hp, ft: 0, stuck: 0, deserter: false, st: 'emerge', t: this.C.doorT, age: 0, fall: false, jseed, repTime, rj };
    if (plan) s.plan = plan;
    return s;
  }

  spawnPair() {
    if (!this.present || this.loserOwner >= 0) return; // a destroyed tower → no production
    this.soldiers.push(this.newSoldier(0), this.newSoldier(1));
  }

  showMsg(t) { this.banner = t; this.bannerT = 1.8; }

  // A tower fell: the duel is resolved; the horde TRIES to cross to the ruin.
  endSequence(loserO) {
    if (this.loserOwner >= 0) return;
    this.loserOwner = loserO;
    this.lastWinner = 1 - loserO;
    this.invader = -1;
    this.I.playable = false;
    this.ruinSide = loserO;
    this.ruinT = this.C.ruinCap;
    this.roundScored = false;
    this.endSeq = true; this.endVerdict = null; this.endDone = false;
    this.endHold = 0; this.hordeBest = 0; this.hordeStall = 0; this.hordeJam = 0;
    for (const s of this.soldiers) {
      if (s.owner === loserO && !s.gone && s.hp > 0 && s.st !== 'emerge' && s.st !== 'enter') s.deserter = true;
    }
    const xd = this.doorX(this.towers[this.lastWinner]);
    const dir = this.lastWinner === 0 ? 1 : -1;
    const cnt = 3 + Math.floor(this.rnd() * 6); // horde 3-8
    for (let i = 0; i < cnt; i += 1) {
      this.horde.push({ id: this.nextId++, owner: this.lastWinner, x: xd, y: this.platLine[this.lastWinner], dir, hp: 999, st: 'emerge', t: this.C.doorT, age: 10, fall: false, horde: true, bg: i % 2 === 0, delay: i * 0.1 + this.rnd() * 0.25, jseed: (this.rnd() * 0x100000000) >>> 0 });
    }
    this._ev('horde', { x: Math.round(xd), y: Math.round(this.platLine[this.lastWinner]), owner: this.lastWinner });
    this.showMsg('Round over — the horde tries to reach the ruin…');
  }

  // The round HOLDS on the horde's verdict before the arena pans (the host gates
  // the transition on endDone; standalone self-advances). Three terminal verdicts:
  //   victory  — a soldier reached the ruin; hold ruinHold on it, then go.
  //   wipe     — every member died; a brief ruinWipeHold beat, then go.
  //   surrender— stalled (no progress for ruinStall, or the ruinCap lapsed): the
  //              survivors raise the white flag (deserter) and fall back ruinRetreat
  //              px (rebroussement) before the transition fires.
  stepEndSequence(dt) {
    if (this.ruinT > 0) this.ruinT -= dt;
    const living = this.horde.filter((h) => h.hp > 0 && !h.gone);

    if (!this.endVerdict) {
      if (this.horde.some((h) => h.st === 'arrived')) {
        if (!this.roundScored) { this.roundScored = true; this.score += 1; }
        this.endVerdict = 'victory'; this.endHold = this.C.ruinHold;
        this.showMsg('✓ Intendant succeeds — a soldier reached the ruin');
      } else if (living.length === 0) {
        this.endVerdict = 'wipe'; this.endHold = this.C.ruinWipeHold;
        this.showMsg('✗ Intendant fails — the horde was wiped out');
      } else {
        // Stall watchdog: track the furthest progress toward the ruin (in the
        // charge direction). No gain for ruinStall seconds → the horde gives up.
        const dir = this.lastWinner === 0 ? 1 : -1;
        const home = this.doorX(this.towers[this.lastWinner]);
        const best = Math.max(...living.map((h) => dir * (h.x - home)));
        // Only a REAL gain (≥8px past the furthest point reached) rearms the watch;
        // sub-cell jitter at a chokepoint must not keep resetting it, or a horde
        // milling at an impassable edge would never surrender.
        if (best > this.hordeBest + 8) { this.hordeBest = best; this.hordeStall = 0; } else this.hordeStall += dt;
        // Hard early jam: the stall ratchet tracks only the FURTHEST member, so with
        // 3-8 fanned-out soldiers one of them inching forward keeps rearming it and
        // the round grinds to ruinCap. ruinJam is a faster verdict when NO living
        // member is advancing (all wedged/waiting at an impassable edge) — a horde
        // blocked early gives up promptly instead of holding the match. (#2)
        const advancing = living.some((h) => h.st === 'march' || h.st === 'climb' || h.st === 'jump' || h.st === 'arrived');
        if (advancing) this.hordeJam = 0; else this.hordeJam = (this.hordeJam || 0) + dt;
        if (this.hordeStall >= this.C.ruinStall || this.hordeJam >= this.C.ruinJam || this.ruinT <= 0) {
          this.endVerdict = 'surrender';
          for (const h of living) { h.deserter = true; h.flagX = h.x; } // raise flags, mark turn-back origin
          this.showMsg('✗ Intendant fails — the horde gives up');
        }
      }
      return;
    }

    // Verdict reached — play the closing beat, then latch endDone.
    if (this.endVerdict === 'surrender') {
      const back = living.length ? Math.max(...living.map((h) => Math.abs(h.x - (h.flagX != null ? h.flagX : h.x)))) : this.C.ruinRetreat;
      this.endHold += dt; // backstop if pinned and unable to fall back
      if (back >= this.C.ruinRetreat || living.length === 0 || this.endHold >= 1.5) this.endDone = true;
    } else {
      this.endHold -= dt;
      if (this.endHold <= 0) this.endDone = true;
    }

    if (this.endDone && !this.externalRounds) this.nextRound(); // standalone advances itself
  }

  // Transition to the next round: fresh world, Intendant already in place.
  nextRound() {
    this.soldiers = []; this.horde = []; this.arrows = []; this.bars = []; this.structures = []; this.ladders = [];
    this.navVer += 1;
    this.loserOwner = -1; this.ruinSide = -1; this.ruinT = 0; this.pendingCata = [false, false];
    this.endSeq = false; this.endVerdict = null; this.endDone = false; this.endHold = 0; this.hordeBest = 0; this.hordeStall = 0; this.hordeJam = 0;
    this.roundShots = 0;
    this.towers[0].hp = this.towers[1].hp = this.C.maxHp;
    this.towers[0].flash = this.towers[1].flash = 0;
    this.platLine = [this.world.heightAt(this.TLX), this.world.heightAt(this.TRX)];
    this.platY = this.platLine[0];
    this.top = this.platY - 96;
    Object.assign(this.I, { x: this.W / 2, y: this.terrAt(this.W / 2), vy: 0, onGround: true, playable: true, dead: false, hp: this.C.maxHp, iframe: 0, job: null, act: null, shieldT: 0, shieldHit: 0, shieldFx: [] });
    this.invader = this.lastWinner >= 0 ? this.lastWinner : -1;
  }

  // --- public intents ------------------------------------------------------

  // Called by Simulation when a tower's HP reaches 0 (artillery duel resolved).
  onTowerDestroyed(owner) { this.towers[owner].hp = 0; }

  // Called by Simulation when tower `owner` actually fires an artillery shot:
  // arms that camp's escalade cannon for one shot (capped, so idle towers firing
  // at nothing don't bank an unbounded reserve). No-op unless syncCannon is on.
  onArtilleryFired(owner) {
    this.roundShots += 1; // counts real shots regardless of syncCannon (late-bonus stake)
    if (!this.syncCannon) return;
    this.cannonArmed[owner] = Math.min(2, (this.cannonArmed[owner] || 0) + 1);
  }

  // A players' DUEL artillery shell (from a tower, not the field cannon) testing
  // against the Intendant. The Intendant is vulnerable to ALL incoming fire — his
  // magic shield auto-parries a shell (flat −1 HP, opening a shieldDur window),
  // and once depleted a direct hit wounds him at player scale (dmg). This is
  // deliberately INDEPENDENT of his alignment (`invader`): in round 1 he is
  // neutral and has no will to attack, but he still takes damage from everyone.
  // Sampled along the shell's path (x0,y0 → x1,y1) so a fast shell can't tunnel
  // the dome. Returns true if the shell was consumed (parry or body hit) so the
  // duel can retire it; events are drained on the next step() like all the rest.
  duelShellHitsIntendant(x0, y0, x1, y1, dmg) {
    const C = this.C; const I = this.I;
    if (!this.present || I.dead) return false;
    let best = Infinity; let bx = x1; let by = y1;
    for (let t = 0; t <= 1; t += 0.25) {
      const sx = x0 + (x1 - x0) * t; const sy = y0 + (y1 - y0) * t;
      const d = Math.hypot(sx - I.x, sy - I.y);
      if (d < best) { best = d; bx = sx; by = sy; }
    }
    if (best < C.shieldR && (I.shieldT > 0 || I.hp > 0)) {
      // MAGIC SHIELD: parry. Opening the window costs 1 HP; further hits within
      // it are free. Mirrors the field-cannon ball path in stepArrows.
      if (I.shieldT <= 0) { I.hp -= 1; I.shieldT = C.shieldDur; if (I.hp <= 0) { I.dead = true; I.hp = 0; } }
      I.shieldHit = 1;
      I.shieldFx.push({ a: Math.atan2(by - I.y, bx - I.x), t: 0.45 });
      if (I.shieldFx.length > 6) I.shieldFx.shift();
      this._ev(I.dead ? 'intFatal' : 'intParry', { x: Math.round(I.x), y: Math.round(I.y) });
      return true;
    }
    if (best < 12) { // shield depleted → direct body hit, player-scale HP
      I.hp -= (dmg != null ? dmg : C.ballDmg); I.hurt = 0.4;
      if (I.hp <= 0) { I.dead = true; I.hp = 0; this._ev('intFatal', { x: Math.round(I.x), y: Math.round(I.y) }); }
      else this._ev('intHurt', { x: Math.round(I.x), y: Math.round(I.y - 8) });
      return true;
    }
    return false;
  }

  // Set the alignment (who the Intendant attacks). -1 truce, 0 blue, 1 red.
  setInvader(side) { this.invader = side; }

  // Mark the Intendant present/absent (disconnect > 10s → truce + soldiers desert).
  setPresent(on) {
    // A fresh arrival ENTERS FROM THE SKY: his first ever appearance (§4.1) and
    // every later hot-join after the seat was freed — he glides down from the
    // top rather than popping in. A reconnect within the grace window never
    // toggles `present` (so it doesn't re-launch him), and nextRound() places
    // him on the hill itself (subsequent rounds, no descent). `present` keeps a
    // `true` default so headless sims/tests run the world without a seat call —
    // hence the explicit `enteredWorld` flag rather than a !present test.
    const entering = on && (!this.present || !this.enteredWorld);
    if (on) this.enteredWorld = true;
    this.present = on;
    if (!on) { this.invader = -1; this.I.playable = false; return; }
    this.I.playable = true;
    if (entering || this.I.dead) { this.I.dead = false; this.I.hp = this.C.maxHp; this.I.x = this.W / 2; this.I.y = -30; this.I.vy = 0; this.I.onGround = false; this.I.iframe = 1.2; this.I.shieldT = 0; this.I.shieldHit = 0; this.I.shieldFx = []; this._ev('apparition', { x: Math.round(this.I.x), y: 0 }); }
    // Late bonus: a genuine arrival is staked +1/+1 per artillery shot already
    // fired this round (symmetric; asymmetry is earned in-play). A within-grace
    // reconnect or a death-revival keeps the accumulated reserve untouched.
    if (entering) this.I.bp = [this.roundShots, this.roundShots];
  }

  // Controller intent (booleans). Build is edge-triggered via buildStair/Bridge.
  setIntendantInput(partial) { Object.assign(this.input, partial); }

  buildStair() { this.startBuild('stair'); }
  buildBridge() { this.startBuild('bridge'); }

  // --- build & terraform ---------------------------------------------------

  hasPoints() { return this.I.bp[0] >= BUILD_COST && this.I.bp[1] >= BUILD_COST; }

  startBuild(type) {
    const k = this.input;
    if (this.I.job || this.I.dead || !this.I.onGround || k.dig || k.fill) return;
    if (!this.hasPoints()) { this.showMsg(`✗ needs ${BUILD_COST} blue + ${BUILD_COST} red`); return; }
    this.I.bp[0] -= BUILD_COST; this.I.bp[1] -= BUILD_COST; // paid up front
    this.I.job = { type, i: 0, max: this.C.buildSteps, t: 0, x0: this.I.x, y0: this.I.y, f: this.I.facing };
    this._ev('intBuild', { x: Math.round(this.I.x), y: Math.round(this.I.y), kind: type === 'bridge' ? 1 : 0 });
  }

  finishBuild(j) { if (j.i < 1) return; if (j.type === 'bridge') this.addBridgeSupports(j); else this.addStairSupports(j); }

  stepBuild(dt) {
    const C = this.C;
    const j = this.I.job;
    if (!j) return;
    if (j.ph == null) j.ph = 0;
    j.t += dt;
    if (j.ph === 0) { if (j.t < C.buildWind) return; j.t = 0; j.ph = 1; }   // wind-up before the work
    if (j.ph === 2) { if (j.t < C.buildRec) return; this.I.job = null; return; }   // after-work recovery → free
    if (j.t < C.buildDur) return; // one element every buildDur
    j.t -= C.buildDur;
    let sx; let sy; let x0; let x1;
    if (j.type === 'stair') { sx = j.x0 + j.f * (j.i * SW); sy = j.y0 - j.i * SH; x0 = Math.min(sx, sx + j.f * SW); x1 = Math.max(sx, sx + j.f * SW); }
    else { sx = j.x0 + j.f * (j.i * PW); sy = j.y0; x0 = Math.min(sx, sx + j.f * PW); x1 = Math.max(sx, sx + j.f * PW); }
    if (sx < 6 || sx > this.W - 6 || sy < 12 || sy > this.terrAt(sx) + 3) { this.finishBuild(j); j.ph = 2; j.t = 0; return; }
    this.structures.push({ x0, x1, y: sy }); this.navVer += 1;
    if (j.type === 'stair' && j.i > 0) this.pushBar(sx, sy, sx, sy + SH);
    this.I.x = sx; this.I.y = sy; this.I.vy = 0; this.I.onGround = true; j.i += 1;
    if (j.i >= j.max) { this.finishBuild(j); j.ph = 2; j.t = 0; }
  }

  addStairSupports(j) {
    const i = j.i;
    const topSx = j.x0 + j.f * ((i - 1) * SW);
    const ax = topSx + j.f * (SW / 2);
    const topY = j.y0 - (i - 1) * SH;
    const connected = (this.terrAt(ax) - topY) < 8;
    const groundB = Math.max(this.terrAt(ax), topY + 10);
    if (connected) { const len = Math.max(12, groundB - topY); this.pushBar(ax, topY, ax + j.f * len, topY + len); }
    else this.pushBar(ax, topY, ax, groundB);
  }

  pushBar(x1, y1, x2, y2) {
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 4));
    for (let i = 0; i <= n; i += 1) { const u = i / n; this.bars.push({ x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u }); }
  }

  addBridgeSupports(j) {
    const by = j.y0;
    const ends = [j.x0, j.x0 + j.f * j.i * PW];
    const Lx = Math.min(...ends);
    const Rx = Math.max(...ends);
    for (const [ex, sgn] of [[Lx, -1], [Rx, 1]]) {
      const ax = ex - sgn * PW;
      const connected = (this.terrAt(ex) - by) < 8;
      const groundB = Math.max(this.terrAt(ax), by + 10);
      if (connected) { const len = Math.max(12, groundB - by); this.pushBar(ax, by, ax + sgn * len, by + len); }
      else this.pushBar(ax, by, ax, groundB);
    }
  }

  // --- engineer (ingénieur): a free range-extending work, then deserts (#14) ---

  // Reach: max progress (px, toward the enemy tower) attainable from the door,
  // within the warning span. Grid DFS (STEP): climb at most SU, fall freely; an
  // inclined LADDER links foot↔top at near-constant x. exP/exL inject a candidate
  // bridge span / ladder to test what a planned work would unlock.
  navReach(owner, exP, exL) {
    const dir = owner === 0 ? 1 : -1; const xd = this.doorX(this.towers[owner]); const span = this.C.towerWarn; const STEP = PATH_STEP;
    const planks = (exP && exP.length) ? this.structures.concat(exP) : this.structures;
    const lads = (exL && exL.length) ? this.ladders.concat(exL) : this.ladders;
    const surfAt = (x) => { const t = this.terrAt(x); const o = [t]; for (const p of planks) { if (x >= p.x0 && x <= p.x1 && p.y <= t + 2) o.push(p.y); } return o; };
    const platY = this.platLine[owner];
    let sY = platY; let bd = 1e9; for (const y of surfAt(xd)) { const d = Math.abs(y - platY); if (d < bd) { bd = d; sY = y; } }
    const key = (x, y) => `${x}_${Math.round(y)}`; const seen = new Set([key(xd, sY)]); const stack = [[xd, sY]];
    let prog = 0; let guard = 0;
    while (stack.length && guard++ < 6000) {
      const [cx, cy] = stack.pop(); const p = dir * (cx - xd); if (p > prog) prog = p;
      for (const nx of [cx + STEP, cx - STEP]) { const np = dir * (nx - xd); if (np < 0 || np > span || nx < 6 || nx > this.W - 6) continue;
        for (const ny of surfAt(nx)) { if (cy - ny > SU + 1) continue; const k = key(nx, ny); if (seen.has(k)) continue; seen.add(k); stack.push([nx, ny]); } }
      for (const L of lads) { const cb = Math.round(L.xb / STEP) * STEP; const ct = Math.round(L.xt / STEP) * STEP;
        if (Math.abs(L.xb - cx) <= STEP * 1.5 && Math.abs(cy - L.yb) <= SU) { const k = key(ct, L.yt); if (!seen.has(k)) { seen.add(k); stack.push([ct, L.yt]); } }
        if (Math.abs(L.xt - cx) <= STEP * 1.5 && Math.abs(cy - L.yt) <= SU) { const k = key(cb, L.yb); if (!seen.has(k)) { seen.add(k); stack.push([cb, L.yb]); } } }
    }
    return prog;
  }

  // First clean edge along the real ground (terrain or planks) from the door:
  // a drop>SU → bridge (near bank); a rise>SU → ladder (foot→plateau top).
  buildPlan(owner) {
    const dir = owner === 0 ? 1 : -1; const xd = this.doorX(this.towers[owner]); const STEP = PATH_STEP;
    let x = xd; let y = this.groundY(x, this.platLine[owner]);
    for (let k = 0; k < this.C.towerWarn / STEP; k += 1) {
      const nx = x + dir * STEP; const ny = this.groundY(nx, y);
      if (ny - y > SU) return { type: 'bridge', x0: x, y0: y, dir, max: this.C.engBridgeMax };
      if (y - ny > SU) { let yt = y; let xt = x; for (let d = 4; d <= this.C.engLadRun; d += 4) { const tx = x + dir * d; const ty = this.terrAt(tx); if (ty < yt) { yt = ty; xt = tx; } } return { type: 'ladder', xb: x, yb: y, xt, yt: Math.max(yt, y - this.C.engLadH), dir }; }
      x = nx; y = ny;
    }
    return null;
  }

  // Reach (px) gained if plan p is built right now, vs the camp's current best
  // reach. ≤8 means the work is redundant: the obstacle is already crossable —
  // a crater, the Intendant filling/digging, or a structure laid since the plan
  // was drawn. Shared by the spawn-time guard and the build-time revalidation.
  planGain(owner, p) {
    const dir = p.dir; const base = this.navReach(owner);
    let rT;
    if (p.type === 'bridge') { const span = []; for (let i = 0; i < this.C.engBridgeMax; i += 1) { const sx = p.x0 + dir * (i * PW); span.push({ x0: Math.min(sx, sx + dir * PW), x1: Math.max(sx, sx + dir * PW), y: p.y0 }); } rT = this.navReach(owner, span, null); }
    else rT = this.navReach(owner, null, [{ xb: p.xb, yb: p.yb, xt: p.xt, yt: p.yt }]);
    return rT - base;
  }

  // Does the candidate work extend reach by more than one cell? Else no engineer
  // (never for nothing — an already-crossed obstacle yields zero gain).
  planEngineer(owner) {
    const p = this.buildPlan(owner); if (!p) return null;
    return this.planGain(owner, p) > 8 ? p : null;
  }

  // Re-check a carried plan against the LIVE terrain just before laying the first
  // piece: between sortie and arrival the Intendant (dig/fill/bridge) or a crater
  // can erase the obstacle. If the work is now pointless, drop the plan so next
  // tick the no-plan branch marches him out and he deserts — rather than miming a
  // build over solid ground. Returns true if it's still worth building.
  engCheck(s, p) {
    if (this.planGain(s.owner, p) > 8) return true;
    s.plan = null; s.eng = null;
    return false;
  }

  hasEngineer(owner) { return this.soldiers.some((s) => s.kind === 'engineer' && s.owner === owner && s.hp > 0 && !s.deserter); }

  // Execute the precomputed plan: walk to the start, lay the free work (engWind →
  // engDur per element → engRec), then desert. engineerBuild fires once at the build
  // start (model A): kind 1=bridge, 0=ladder. Without a plan: march & desert.
  stepEngineer(s, dt, active) {
    if (!active) { s.deserter = true; return; }
    const dir = s.owner === 0 ? 1 : -1; s.dir = dir; const p = s.plan;
    const C = this.C;
    if (!p) { s.st = 'march'; s.y = this.groundY(s.x, s.y); s.x += dir * C.v0 * 0.8 * dt; if ((dir > 0 && s.x >= this.TRX - 14) || (dir < 0 && s.x <= this.TLX + 14)) s.deserter = true; return; }
    if (!s.eng) s.eng = { i: 0, t: 0, top: 0, ph: 0 };
    const e = s.eng;
    if (p.type === 'ladder') {
      const foot = p.xb - dir * 6; const steps = Math.max(2, Math.round(Math.hypot(p.xt - p.xb, p.yt - p.yb) / 8));
      if ((foot - s.x) * dir > 1) { s.st = 'march'; s.y = this.groundY(s.x, s.y); s.x += dir * Math.min(Math.abs(foot - s.x), C.v0 * 0.8 * dt); return; }
      s.st = 'build'; s.x = p.xb; s.y = p.yb;
      if (e.ph === 0 && e.t === 0 && !this.engCheck(s, p)) return;
      if (e.ph === 0) { e.t += dt; if (e.t < C.engWind) return; e.t = 0; e.ph = 1; this._ev('engineerBuild', { x: Math.round(p.xb), y: Math.round(p.yb), kind: 0 }); }
      if (e.ph === 2) { e.t += dt; if (e.t < C.engRec) return; this.ladders.push({ xb: p.xb, yb: p.yb, xt: p.xt, yt: p.yt }); this.navVer += 1; s.deserter = true; s.eng = null; s.plan = null; return; }
      e.t += dt; if (e.t >= C.engDur) { e.t -= C.engDur; e.i += 1; }
      e.f = Math.min(1, e.i / steps);
      if (e.f >= 1) { e.ph = 2; e.t = 0; }
      return;
    }
    s.st = 'build'; const w = PW; const baseX = p.x0 + dir * (e.i * w);
    if ((baseX - s.x) * dir > 1) { s.y = this.groundY(s.x, s.y); s.x += dir * Math.min(Math.abs(baseX - s.x), C.v0 * 0.8 * dt); return; }
    s.y = p.y0;
    if (e.ph === 0 && e.i === 0 && e.t === 0 && !this.engCheck(s, p)) return;
    if (e.ph === 0) { e.t += dt; if (e.t < C.engWind) return; e.t = 0; e.ph = 1; this._ev('engineerBuild', { x: Math.round(p.x0), y: Math.round(p.y0), kind: 1 }); }
    if (e.ph === 2) { e.t += dt; if (e.t < C.engRec) return; if (e.i > 0) this.addBridgeSupports({ x0: p.x0, y0: p.y0, f: dir, i: e.i }); this.navVer += 1; s.deserter = true; s.eng = null; s.plan = null; return; }
    e.t += dt; if (e.t < C.engDur) return; e.t -= C.engDur;
    const sx = p.x0 + dir * (e.i * w); const sy = p.y0;
    if (e.i >= p.max || sx < 6 || sx > this.W - 6 || (e.i > 0 && this.terrAt(sx) <= sy + SU)) { e.ph = 2; e.t = 0; return; }
    this.structures.push({ x0: Math.min(sx, sx + dir * w), x1: Math.max(sx, sx + dir * w), y: sy }); this.navVer += 1; e.i += 1;
  }

  toolAim(defY) {
    const k = this.input;
    let dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (!dx && !dy) { dx = 0; dy = defY; }
    const m = Math.hypot(dx, dy) || 1;
    return { ox: dx / m, oy: dy / m };
  }

  // Terraforming edits the SHARED heightfield through the world adapter. If the
  // adapter exposes a writable editor we use it; otherwise terraform is a no-op
  // (the duel terrain stays read-only). Crater/dig/fill/flatten all funnel here.
  editTerrain(x, y, raise, r) {
    if (this.world.editColumn) this.world.editColumn(x, y, raise, r);
    this.navVer += 1;
  }

  digDir(dt) {
    if (!this.world.editColumn) return;
    const { ox, oy } = this.toolAim(1);
    if (Math.abs(ox) > Math.abs(oy) * 1.2) {
      const dir = Math.sign(ox) || this.I.facing;
      const reach = 16;
      this.world.bash(this.I.x, this.I.y, dir, reach, this.C.digSpeed * dt * 2.4);
      this.I.x = Math.max(8, Math.min(this.W - 8, this.I.x + dir * Math.min(this.C.digSpeed, 38) * dt));
      this.I.facing = dir; this.I.y = this.groundY(this.I.x, this.I.y);
    } else {
      const tx = this.I.x + ox * 12; const ty = this.I.y - 2 + Math.max(0, oy) * 16;
      this.world.dig(tx, ty, 11, this.C.digSpeed * dt, this.C.digH);
    }
    this.navVer += 1;
  }

  fillDir(dt) {
    if (!this.world.editColumn) return;
    const { ox, oy } = this.toolAim(-1);
    const tx = this.I.x + ox * 16; const ty = this.I.y - 10 + oy * 16;
    this.world.fill(tx, ty, 13, this.C.digSpeed * dt, this.C.digH);
    this.navVer += 1;
  }

  flattenStep(dt) {
    if (!this.world.flatten) return;
    const { ox } = this.toolAim(0);
    const tx = this.I.x + ox * 16;
    this.world.flatten(tx, 20, Math.min(1, this.C.digSpeed * 0.06 * dt));
    this.navVer += 1;
  }

  doStroke(kind) {
    if (kind === 'dig') this.digDir(STROKE);
    else if (kind === 'fill') this.fillDir(STROKE);
    else this.flattenStep(STROKE);
    this.I.y = this.terrAt(this.I.x); this.I.onGround = true;
  }

  // A shell impact (from artillery): cut planks/bars and punch terrain.
  carveCrater(mx, my, r, vx, vy) {
    r = r || this.C.craterR;
    // vx/vy = the round's velocity at impact → a "saucer" bowl elongated/offset
    // downrange (B10/#8). Omitted (manual tool / duel) → a plain round bowl.
    if (this.world.carveCrater) this.world.carveCrater(mx, my, r, vx, vy);
    this.craterStructures(mx, my, r);
    this.navVer += 1;
  }

  // Detonation (cannonball or grenade) — TWO HP scales:
  //   • DIRECT projectile hit (arg `hit`): cannonball → PLAYER scale (Intendant HP;
  //     a soldier has ~0.01 player-HP → ONE-SHOT); grenade → SOLDIER scale (soldier
  //     HP; Intendant → resource drain).
  //   • BLAST (within blastR): always SOLDIER scale (soldier HP; Intendant → resource,
  //     never HP). Bullets have no blast. Deterministic — no rng here.
  explodeBall(a, ix, iy, blastR, baseDmg, active, hit) {
    const C = this.C; const I = this.I;
    this.carveCrater(ix, iy, blastR, a.vx, a.vy);
    if (hit && hit.type === 'soldier') { if (a.gren) hit.s.hp -= baseDmg; else hit.s.hp = 0; hit.s.combat = true; } // cannonball = player scale → annihilate the soldier
    else if (hit && hit.type === 'int' && active && !I.dead) {
      if (a.gren) { I.hurt = 0.4; I.bp[a.owner] = Math.max(0, I.bp[a.owner] - 1); }
      else { I.hp -= C.ballDmg; I.hurt = 0.4; if (I.hp <= 0) { I.dead = true; I.hp = 0; this._ev('intFatal', { x: Math.round(I.x), y: Math.round(I.y) }); } else this._ev('intHurt', { x: Math.round(I.x), y: Math.round(I.y - 8) }); }
    }
    const splash = baseDmg * C.splashFactor; // BLAST: soldier scale for everyone
    for (const s of this.soldiers) { if (s.hp <= 0 || s.owner === a.owner || (hit && hit.s === s)) continue; if (Math.hypot(s.x - ix, s.y - iy) < blastR) { s.hp -= splash; s.combat = true; } }
    if (active && !I.dead && !(hit && hit.type === 'int')) { if (Math.hypot(I.x - ix, I.y - iy) < blastR) { I.hurt = 0.3; I.bp[a.owner] = Math.max(0, I.bp[a.owner] - 1); } } // blast on Intendant = resource (never HP)
  }

  craterStructures(mx, my, r) {
    const out = [];
    for (const p of this.structures) {
      const dy = Math.abs(p.y - my);
      if (dy >= r) { out.push(p); continue; }
      const dx = Math.sqrt(r * r - dy * dy);
      const cl = mx - dx;
      const cr = mx + dx;
      if (cr <= p.x0 || cl >= p.x1) { out.push(p); continue; }
      if (cl > p.x0) out.push({ x0: p.x0, x1: Math.min(p.x1, cl), y: p.y });
      if (cr < p.x1) out.push({ x0: Math.max(p.x0, cr), x1: p.x1, y: p.y });
    }
    this.structures = out.filter((p) => p.x1 - p.x0 > 1);
    this.bars = this.bars.filter((b) => Math.hypot(b.x - mx, b.y - my) >= r);
    // A ladder caught in the crater is destroyed (#14).
    this.ladders = this.ladders.filter((L) => {
      const x0 = Math.min(L.xb, L.xt); const x1 = Math.max(L.xb, L.xt); const y0 = Math.min(L.yb, L.yt); const y1 = Math.max(L.yb, L.yt);
      return mx + r < x0 || mx - r > x1 || my + r < y0 || my - r > y1;
    });
  }

  // --- crossing / horde test -----------------------------------------------

  crossPath(dir) {
    const sx = dir > 0 ? this.TLX + 14 : this.TRX - 14;
    const gx = dir > 0 ? this.TRX - 14 : this.TLX + 14;
    return this.findPath(sx, this.terrAt(sx), gx);
  }

  canCross(dir) { return this.crossPath(dir) != null; }

  // Per-column occupancy of the pathfinder grid (every marching body counts,
  // both camps + the horde — congestion is physical, not allegiance). Each body
  // bleeds half-weight into its neighbours so a chokepoint reads as a ridge, not
  // a spike. Rebuilt once per step(); read by findPath via this._density.
  buildDensity() {
    const STEP = PATH_STEP;
    const N = Math.floor((this.W - 6) / STEP);
    const d = new Array(N + 1).fill(0);
    const add = (x) => {
      const i = Math.max(0, Math.min(N, Math.round(x / STEP)));
      d[i] += 1;
      if (i > 0) d[i - 1] += 0.5;
      if (i < N) d[i + 1] += 0.5;
    };
    for (const s of this.soldiers) { if (s.hp <= 0 || s.gone || s.deserter || s.st === 'emerge' || s.st === 'enter') continue; add(s.x); }
    for (const s of this.horde) { if (s.hp <= 0 || s.gone || s.st === 'emerge' || s.st === 'enter') continue; add(s.x); }
    return d;
  }

  // --- main step -----------------------------------------------------------

  step(dt) {
    this.animClock += dt;
    // Shield window + impact sparks decay always (even dead/absent) so the burst
    // fades cleanly. shieldHit fades ~2.5×, sparks live 0.45s (set on impact).
    if (this.I.shieldT > 0) this.I.shieldT -= dt;
    if (this.I.shieldHit > 0) this.I.shieldHit -= dt * 2.5;
    if (this.I.shieldFx.length) { for (const f of this.I.shieldFx) f.t -= dt; this.I.shieldFx = this.I.shieldFx.filter((f) => f.t > 0); }
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.I.hp > this.C.maxHp) this.I.hp = this.C.maxHp;
    const active = this.present && !this.I.dead;
    if (active && this.spawnMode === 'auto') { this.spawnTimer += dt; if (this.spawnTimer >= this.C.spawnFreq) { this.spawnTimer -= this.C.spawnFreq; this.spawnPair(); } }

    this.stepIntendant(dt, active);

    for (const T of this.towers) {
      if (T.hp <= 0) {
        if (this.loserOwner < 0) this.endSequence(T.owner);
        for (const s of this.soldiers) { if (s.owner === T.owner && !s.deserter && !s.gone && s.hp > 0 && s.st !== 'emerge' && s.st !== 'enter') s.deserter = true; }
      }
    }
    this._density = this.buildDensity();
    this.stepSoldiers(this.soldiers, dt, active, true);
    this.stepSoldiers(this.horde, dt, true, false);
    if (this.endSeq && !this.endDone) this.stepEndSequence(dt);

    this.stepTowers(dt, active);
    this.stepArrows(dt, active);

    // economy: a combat death (enemy/Intendant fire) → +1 resource of its colour;
    // Intendant kill → +6; fall/suicide/friendly fire → 0.
    for (const s of this.soldiers) { if (s.hp <= 0 && !s.gone && !s.counted) { s.counted = true; this.I.bp[s.owner] += (s.byInt ? 6 : (s.combat ? 1 : 0)); this._ev(s.kind === 'cata' ? 'cannonWreck' : 'soldierDeath', { x: Math.round(s.x), y: Math.round(s.y), owner: s.owner }); } }
    this.soldiers = this.soldiers.filter((s) => s.hp > 0 && s.x > 2 && s.x < this.W - 2);
    this.horde = this.horde.filter((s) => s.hp > 0 && s.x > 2 && s.x < this.W - 2);
    this.arrows = this.arrows.filter((a) => a.life > 0 && a.x > -10 && a.x < this.W + 10 && a.y < this.H + 10);
  }

  stepIntendant(dt, active) {
    const I = this.I;
    const k = this.input;
    const C = this.C;
    const L = k.left; const R = k.right; const DN = k.down; const UP = k.up; const JUMP = k.up || k.jump;
    if (I.dead) return;
    const ctrl = this.present && I.playable;
    const wasGlide = I.glide;
    I.glide = !I.onGround && I.vy > 0 && I.y > (I.jumpY != null ? I.jumpY : I.y) + 4; // auto glider
    if (I.glide && !wasGlide) this._ev('glide', { x: Math.round(I.x), y: Math.round(I.y) });
    let climbing = false;
    let busy = false;
    if (ctrl) {
      this.stepBuild(dt);
      const wantKind = (!I.job && !I.glide) ? (k.dig ? 'dig' : k.fill ? 'fill' : k.flat ? 'flat' : null) : null;
      if (!I.act && wantKind) I.act = { kind: wantKind, ph: 0, t: C.toolWind };
      if (I.act) {
        I.act.t -= dt;
        // Wind → effect (held toolDur) → Rec, then repeat if the key is still held.
        if (I.act.ph === 0 && I.act.t <= 0) { this.doStroke(I.act.kind); this._ev('intDig', { x: Math.round(I.x), y: Math.round(I.y), kind: I.act.kind === 'dig' ? 0 : I.act.kind === 'fill' ? 1 : 2 }); I.act.ph = 1; I.act.t = C.toolDur; }
        else if (I.act.ph === 1 && I.act.t <= 0) { I.act.ph = 2; I.act.t = C.toolRec; }
        else if (I.act.ph === 2 && I.act.t <= 0) {
          const held = (I.act.kind === 'dig' && k.dig) || (I.act.kind === 'fill' && k.fill) || (I.act.kind === 'flat' && k.flat);
          I.act = (held && !I.job && !I.glide) ? { kind: I.act.kind, ph: 0, t: C.toolWind } : null;
        }
      }
      busy = !!I.act;
      if (!I.job && !busy) {
        const mv = (R ? 1 : 0) - (L ? 1 : 0);
        if (mv) I.facing = mv;
        const lad = this.ladderAt(I.x, I.y);
        if (lad && (UP || DN)) { // LADDER: ↑ to the top, ↓ to the foot (gravity suspended) (#14)
          climbing = true; const tx = UP ? lad.xt : lad.xb; const ty = UP ? lad.yt : lad.yb;
          const gx = tx - I.x; const gy = ty - I.y; const m = Math.hypot(gx, gy) || 1; const sp = C.climbSpeed * 1.8 * dt;
          I.x += gx / m * Math.min(m, sp); I.y += gy / m * Math.min(m, sp); I.vy = 0; I.onGround = false; I.facing = Math.sign(lad.xt - lad.xb) || I.facing;
        } else {
          if (DN && I.onGround && this.supportAt(I.x) < this.terrAt(I.x) - 1) { I.onGround = false; I.dropT = 0.28; I.y += 2; }
          if (mv) {
            if (I.onGround) {
              const ahead = this.groundY(I.x + mv * 4, I.y);
              const rise = (I.y - ahead) / 4;
              if (rise > C.climbSlope) { climbing = true; I.x += mv * C.climbSpeed * dt; I.y = this.groundY(I.x, I.y); }
              else { const sf = Math.max(0.3, 1 - Math.abs(rise) * 0.45); I.x += mv * C.intSpeed * sf * dt; }
            } else I.x += mv * C.intSpeed * dt;
          }
          I.x = Math.max(8, Math.min(this.W - 8, I.x));
          if (JUMP && I.onGround) { I.vy = -C.jumpV; I.onGround = false; I.jumpY = I.y; }
        }
      }
    } else I.act = null;
    // gravity + ground + glide: ALWAYS (even idle/unplayable/busy), except climbing
    if (!climbing) {
      if (I.dropT > 0) I.dropT -= dt;
      I.vy += C.grav * dt;
      if (I.glide) I.vy = Math.min(I.vy, C.glide);
      I.y += I.vy * dt;
      const g = I.dropT > 0 ? this.terrAt(I.x) : this.groundY(I.x, I.y);
      if (I.y >= g) { I.y = g; I.vy = 0; I.onGround = true; } else I.onGround = false;
      if (I.onGround) I.jumpY = I.y;
      if (I.onGround && !JUMP) { const gg = I.dropT > 0 ? this.terrAt(I.x) : this.groundY(I.x, I.y); if (gg < I.y && I.y - gg <= SU) I.y = gg; }
    }
    if (this.terrAt(I.x) < I.y - 0.5) { I.y = this.terrAt(I.x); if (I.vy > 0) I.vy = 0; I.onGround = true; }
    if (ctrl && !I.job && !busy && !I.glide) this.autoAttack(dt); else { I.attacking = false; I.atk = null; }
    if (I.iframe > 0) I.iframe -= dt;
    if (I.hurt > 0) I.hurt -= dt;
    if (ctrl && I.iframe <= 0 && this.invader >= 0) {
      for (const s of this.soldiers) {
        if (s.hp <= 0 || s.deserter || s.st === 'emerge' || s.st === 'enter' || s.owner !== this.invader) continue;
        if (Math.hypot(s.x - I.x, s.y - I.y) < 14) { I.bp[this.invader] = Math.max(0, I.bp[this.invader] - 1); I.iframe = 0.6; I.hurt = 0.4; break; }
      }
    }
    // Safety-net death: every HP-draining path above already emits `intFatal` on
    // the killing blow, but guard the transition here too so a future damage source
    // can't kill him silently (the event drives both the SFX and the TV death anim).
    if (I.hp <= 0 && !I.dead) { I.dead = true; I.hp = 0; this._ev('intFatal', { x: Math.round(I.x), y: Math.round(I.y) }); }
    else if (I.hp <= 0) { I.hp = 0; }
    I.walking = ctrl && I.onGround && !I.job && (((R ? 1 : 0) - (L ? 1 : 0)) !== 0);
    if (I.walking) I.step += dt * 11;
  }

  autoAttack(dt) {
    const I = this.I;
    const C = this.C;
    const hostile = (s) => (s.x - I.x) * I.facing > 0 && s.st !== 'emerge' && s.st !== 'enter' && !s.deserter && this.invader >= 0 && s.owner === this.invader;
    // SWORD: nearest invader in reach → Wind → hit (swDmg per cycle) → Rec. The
    // combat lives on I.atk (separate from the tools' I.act). (#9)
    let mfoe = null; let md = C.swordR;
    for (const s of this.soldiers) { if (s.hp <= 0 || !hostile(s)) continue; const d = Math.hypot(s.x - I.x, s.y - I.y); if (d < md) { md = d; mfoe = s; } }
    if (mfoe || I.atk?.type === 'sw') {
      I.weapon = 'sword'; I.attacking = true; I.aimAng = null;
      this.actTick(I, 'atk', dt, C.swWind, C.swRec, (a) => { a.type = 'sw'; a.foe = mfoe; }, (a) => {
        const f = a.foe;
        if (f && f.hp > 0 && Math.hypot(f.x - I.x, f.y - I.y) < C.swordR + 4) { f.hp -= C.swDmg * (1 + (this.rnd() - 0.5) * C.swDmgVar); if (f.hp <= 0) f.byInt = true; }
        this._ev('intSword', { x: Math.round(I.x), y: Math.round(I.y - 8) });
      });
      return;
    }
    // BOW: aim (bowWind) → shot → Rec.
    let tgt = null; let bd = C.bowRange;
    for (const s of this.soldiers) { if (s.hp <= 0 || !hostile(s)) continue; const dx = (s.x - I.x) * I.facing; if (dx > 0 && dx < bd && Math.abs(s.y - I.y) < 90 && this.inSight(I.x, I.y - 12, s.x, s.y - 6)) { bd = dx; tgt = s; } }
    if (tgt || I.atk?.type === 'bow') {
      I.weapon = 'bow'; I.attacking = true; if (tgt) I.aimAng = Math.atan2(tgt.y - (I.y - 12), tgt.x - I.x);
      this.actTick(I, 'atk', dt, C.bowWind, C.bowRec, (a) => { a.aim = I.aimAng; a.type = 'bow'; }, (a) => {
        const err = (this.rnd() > C.bowAcc ? (this.rnd() - 0.5) * C.bowMissSpread : (this.rnd() - 0.5) * C.bowSpread);
        const fa = (a.aim != null ? a.aim : (I.facing > 0 ? 0 : Math.PI)) + err; const dmg = C.bowDmg * (1 + (this.rnd() - 0.5) * C.bowDmgVar);
        this.arrows.push({ x: I.x, y: I.y - 12, vx: Math.cos(fa) * C.bowSpeed, vy: Math.sin(fa) * C.bowSpeed, life: 1.2, fromI: true, dmg });
        this._ev('intBow', { x: Math.round(I.x), y: Math.round(I.y - 12) });
      });
      return;
    }
    I.atk = null; I.attacking = false; I.aimAng = null;
  }

  stepTowers(dt, active) {
    const C = this.C;
    const I = this.I;
    for (const T of this.towers) {
      T.warn = false; T.aim = null;
      if (T.flash > 0) T.flash -= dt;
      const ruined = this.ruinT > 0 && ((this.ruinSide === 1 && T.owner === 1) || (this.ruinSide === 0 && T.owner === 0));
      if (!ruined && this.ruinT <= 0 && T.hp > 0) {
        const sl = this.slitOf(T);
        let tgt = null;
        let bd = C.towerWarn + 1;
        if (active) { const d = Math.hypot(I.x - sl.x, I.y - sl.y); if (d < bd) { bd = d; tgt = { x: I.x, y: I.y }; } }
        for (const s of this.soldiers) { if (s.owner === T.owner || s.hp <= 0 || s.deserter || s.st === 'emerge' || s.st === 'enter') continue; const d = Math.hypot(s.x - sl.x, s.y - sl.y); if (d < bd) { bd = d; tgt = { x: s.x, y: s.y }; } }
        if (tgt) {
          T.warn = true; T.aim = tgt;
          if (bd < C.towerFire) {
            T.t += dt;
            if (T.t >= 1 / C.towerRate) {
              T.t = 0; T.flash = 0.12;
              const base = Math.atan2(tgt.y - sl.y, tgt.x - sl.x);
              const n = 1 + Math.floor(this.rnd() * C.towerBolts); // volley 1..towerBolts, seeded
              for (let kk = 0; kk < n; kk += 1) { const off = (kk - (n - 1) / 2) * 0.12; this.arrows.push({ x: sl.x, y: sl.y, vx: Math.cos(base + off) * C.boltSpeed, vy: Math.sin(base + off) * C.boltSpeed, life: 1.4, owner: T.owner, bolt: true }); }
              this._ev('towerVolley', { x: Math.round(sl.x), y: Math.round(sl.y), owner: T.owner, n });
            }
          } else T.t = 0;
        } else T.t = 0;
      }
      T.warnA += ((T.warn ? 1 : 0) - T.warnA) * Math.min(1, dt * 9);
    }
  }

  stepArrows(dt, active) {
    const C = this.C;
    const I = this.I;
    for (const a of this.arrows) {
      if (a.ball) a.vy += C.grav * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.life -= dt;
      if (a.ball) {
        const cr0 = a.cr || C.craterR;
        const baseDmg = a.dmg != null ? a.dmg : (a.gren ? C.arDmg : C.ballDmg);
        if (!a.gren && active && !I.dead) {
          const d = Math.hypot(a.x - I.x, a.y - I.y);
          // MAGIC SHIELD: ball within shieldR → intercepted (bursts on the dome).
          // Activation auto while HP remain: −1 HP, opens a shieldDur window; during
          // it, further balls are blocked for free. No crater (it detonates midair).
          if (d < C.shieldR && (I.shieldT > 0 || I.hp > 0)) {
            if (I.shieldT <= 0) { I.hp -= 1; I.shieldT = C.shieldDur; if (I.hp <= 0) { I.dead = true; I.hp = 0; } }
            I.shieldHit = 1;
            I.shieldFx.push({ a: Math.atan2(a.y - I.y, a.x - I.x), t: 0.45 });
            if (I.shieldFx.length > 6) I.shieldFx.shift();
            this._ev(I.dead ? 'intFatal' : 'intParry', { x: Math.round(I.x), y: Math.round(I.y) });
            a.life = 0; continue;
          }
          if (d < 12) { // no shield (depleted) → direct body hit on the Intendant → player-scale HP
            const iy = Math.min(a.y, this.terrAt(a.x)); this.explodeBall(a, a.x, iy, cr0, baseDmg, active, { type: 'int' }); this._ev('projGround', { x: Math.round(a.x), y: Math.round(iy), kind: 0 }); a.life = 0; continue;
          }
        }
        if (a.gren) { for (const s of this.soldiers) { if (s.hp <= 0 || s.owner === a.owner) continue; if (Math.hypot(a.x - s.x, a.y - s.y) < 9) { this.explodeBall(a, a.x, a.y, cr0, baseDmg, active, { type: 'soldier', s }); this._ev('grenadeBurst', { x: Math.round(a.x), y: Math.round(a.y) }); a.life = 0; break; } } if (a.life <= 0) continue; } // grenade detonates on a soldier
        else { for (const s of this.soldiers) { if (s.hp <= 0 || s.owner === a.owner) continue; if (Math.hypot(a.x - s.x, a.y - s.y) < 9) { s.hp = 0; s.combat = true; } } } // CANNONBALL: vaporises soldiers it passes through (player scale), does NOT detonate → keeps flying (death event emitted centrally)
        for (const T of this.towers) { const pY = this.platLine[T.owner]; if (T.hp > 0 && Math.abs(a.x - T.x) < 30 && a.y > pY - 96 - 6 && a.y < pY) { if (!a.gren) T.hp -= (a.pw != null ? a.pw : 1); const iy = Math.min(a.y, pY); this.explodeBall(a, a.x, iy, cr0, baseDmg, active, null); this._ev(a.gren ? 'grenadeBurst' : 'projGround', { x: Math.round(a.x), y: Math.round(iy), kind: 0 }); a.life = 0; break; } } // tower: HP only from cannonball (grenade = soldier scale → ~0)
        if (a.life <= 0) continue;
      }
      {
        const surf = a.ball ? this.supportAt(a.x) : this.terrAt(a.x); // ball/grenade detonate on decor = ground OR bridge/stairs; bullets/arrows on terrain only
        if (a.y >= surf || a.x < 5 || a.x > this.W - 5) {
          if (a.ball) {
            const ix = a.x; const iy = Math.min(a.y, surf);
            this.explodeBall(a, ix, iy, a.cr || C.craterR, a.dmg != null ? a.dmg : (a.gren ? C.arDmg : C.ballDmg), active, null);
            this._ev(a.gren ? 'grenadeBurst' : 'projGround', { x: Math.round(ix), y: Math.round(iy), kind: 0 });
          } else this._ev('projGround', { x: Math.round(a.x), y: Math.round(Math.min(a.y, this.terrAt(a.x))), kind: a.musket ? 0 : 1 });
          a.life = 0; continue;
        }
      }
      if (a.ball) continue; // ball/grenade only hit on ground
      if (a.fromI) {
        for (const s of this.soldiers) { if (s.hp <= 0) continue; if (Math.hypot(a.x - s.x, a.y - s.y) < 9) { s.hp -= (a.dmg != null ? a.dmg : C.bowDmg); if (s.hp <= 0) s.byInt = true; this._ev('projFlesh', { x: Math.round(a.x), y: Math.round(a.y), kind: 1 }); a.life = 0; break; } }
      } else {
        if (active && !I.dead && Math.hypot(a.x - I.x, a.y - I.y) < 11) { I.hurt = 0.3; this._ev('intHurt', { x: Math.round(I.x), y: Math.round(I.y - 8) }); a.life = 0; if (a.owner != null) I.bp[a.owner] = Math.max(0, I.bp[a.owner] - 1); }
        for (const s of this.soldiers) { if (s.owner === a.owner || s.hp <= 0) continue; if (Math.hypot(a.x - s.x, a.y - s.y) < 9) { if (a.soldier) s.hp -= a.dmg; else { s.hp -= C.towerDmg; if (s.hp <= 0) this.pendingCata[s.owner] = true; } s.combat = true; this._ev('projFlesh', { x: Math.round(a.x), y: Math.round(a.y), kind: a.musket ? 0 : 1 }); a.life = 0; break; } }
      }
    }
  }

  stepSoldiers(arr, dt, active, interact) {
    const C = this.C;
    const I = this.I;
    const TLX = this.TLX;
    const TRX = this.TRX;
    for (const s of arr) {
      if (s.jvy != null) { // ballistic jump in flight (B3/#10) → gravity arc until it lands on the ledge
        s.x += s.jdir * C.v0 * 0.7 * dt; s.jvy += C.grav * dt; s.y += s.jvy * dt; s.st = 'jump';
        const g = this.groundY(s.x, s.y); if (s.jvy > 0 && s.y >= g) { s.y = g; s.jvy = null; s.stuck = 0; }
        continue;
      }
      const xd = this.doorX(this.towers[s.owner]);
      if (s.st === 'arrived') { if (s.ax != null) { const d = s.ax - s.x; if (Math.abs(d) > 1) { s.x += Math.sign(d) * Math.min(Math.abs(d), C.v0 * dt); s.y = this.groundY(s.x, s.y); } } continue; }
      const platY = this.platLine[s.owner];
      if (s.delay > 0) { s.delay -= dt; s.x = xd; s.y = platY; continue; }
      if (s.st === 'emerge') { s.t -= dt; const p = Math.max(0, s.t) / C.doorT; s.x = xd - s.dir * p * 9; s.y = platY; if (s.t <= 0) { s.st = 'march'; if (!s.horde) s.age = 0; } continue; }
      if (s.st === 'enter') { s.t -= dt; s.x += s.dir * 16 * dt; s.y = platY; if (s.t <= 0) { s.gone = true; s.hp = 0; } continue; }
      if (s.deserter) {
        const home = this.doorX(this.towers[s.owner]);
        if (this.towers[s.owner].hp > 0) { s.dir = (home - s.x) >= 0 ? 1 : -1; s.x += s.dir * C.v0 * dt; s.y = this.groundY(s.x, s.y); if (Math.abs(s.x - home) < 8) { s.gone = true; s.hp = 0; } }
        else { if (s.rdir == null) s.rdir = this.rnd() < 0.5 ? -1 : 1; s.dir = s.rdir; s.x += s.dir * C.v0 * dt; s.y = this.groundY(s.x, s.y); if (s.x < 5 || s.x > this.W - 5) { s.gone = true; s.hp = 0; } }
        continue;
      }
      if (s.recover > 0) { s.recover -= dt; s.st = 'down'; s.y = this.groundY(s.x, s.y); continue; }
      if (s.fall) s.fall = false; // recovery over → back on his feet
      if (s.kind === 'engineer') { this.stepEngineer(s, dt, active); continue; } // non-combatant: lays its work, then deserts (#14)
      // REPOSITIONING (B4): a fight that drags on past this unit's repTime → push
      // forward briefly and replan, to break the stalemate and seek a better angle.
      if (s.st === 'fight') s.fightT = (s.fightT || 0) + dt; else s.fightT = 0;
      if (s.repTime && s.fightT > s.repTime) { s.fightT = 0; s.pushT = C.repPush; s.path = null; }
      const pushing = s.pushT > 0; if (pushing) s.pushT -= dt;
      if (interact && !pushing) {
        if (!active) { s.deserter = true; continue; }
        if (s.kind === 'cata') {
          const ex = s.owner === 0 ? TRX : TLX;
          const cdir = s.owner === 0 ? 1 : -1;
          const slope = (this.navY(s.x + 6, s.y) - this.navY(s.x - 6, s.y)) / 12;
          const pw = Math.max(0.3, 1 - Math.abs(slope) * 0.7);
          if (s.cstuck) { const slA = (this.terrAt(s.x + cdir * 4) - s.y) / 4; if (-slA <= C.climbSlope * 0.5) s.cstuck = false; }
          if (Math.abs(s.x - ex) < C.cataRange || s.cstuck || s.act) {
            s.st = 'fight'; s.stuck = 0;
            // Lay (cataWind) → fire → reload (cataRec) via the FSM. Synced to real
            // artillery (in game): a shot is armed only after the OWNER's tower
            // really fired (anti-hack). The arming is committed when aiming starts.
            const canStart = this.syncCannon ? (this.cannonArmed[s.owner] > 0) : true;
            if (s.act || canStart) {
              if (!s.act && this.syncCannon) this.cannonArmed[s.owner] -= 1;
              this.actTick(s, 'act', dt, C.cataWind, C.cataRec, null, () => {
                const jit = (this.rnd() - 0.5) * (0.10 + Math.abs(slope) * 0.45); const a0 = Math.atan2(-335, s.dir * 335) + jit; const sp = C.ballSpeed;
                this.arrows.push({ x: s.x, y: s.y - 12, vx: Math.cos(a0) * sp, vy: Math.sin(a0) * sp, life: 5, ball: true, owner: s.owner, cr: C.ballCraterR * pw, pw, dmg: C.ballDmg * (1 + (this.rnd() - 0.5) * C.ballDmgVar) });
                this._ev('fieldFire', { x: Math.round(s.x), y: Math.round(s.y - 10), owner: s.owner });
              });
            }
            continue;
          }
        } else if (s.kind === 'bow') {
          let tx = null; let ty = 0; let bd = C.arRange + (s.rj || 0);
          for (const o of this.soldiers) { if (o.owner === s.owner || o.hp <= 0 || o.deserter || o.st === 'emerge' || o.st === 'enter') continue; const dx = (o.x - s.x) * s.dir; if (dx > 0 && dx < bd && Math.abs(o.y - s.y) < 70) { bd = dx; tx = o.x; ty = o.y - 6; } }
          if (active && !I.dead && s.owner === this.invader) { const dxI = (I.x - s.x) * s.dir; if (dxI > 0 && dxI < bd && Math.abs(I.y - s.y) < 70) { bd = dxI; tx = I.x; ty = I.y - 8; } }
          if (tx != null || s.act) {
            s.st = 'fight'; s.stuck = 0; s.fall = false;
            this.actTick(s, 'act', dt, C.grenWind, C.grenRec, (a) => { a.tx = tx; a.ty = ty; }, (a) => {
              if (a.tx == null) return;
              const t = C.grenTime; const dx = a.tx - s.x; const dy = a.ty - (s.y - 12);
              this.arrows.push({ x: s.x, y: s.y - 12, vx: dx / t, vy: dy / t - 0.5 * C.grav * t, life: 2, ball: true, gren: true, owner: s.owner, cr: C.grenCraterR, dmg: C.arDmg * (1 + (this.rnd() - 0.5) * C.grenDmgVar) });
              this._ev('grenadeLob', { x: Math.round(s.x), y: Math.round(s.y - 12), owner: s.owner });
            });
            continue;
          }
        } else {
          let foe = null; let fd = 1e9;
          for (const o of this.soldiers) { if (o.owner === s.owner || o.hp <= 0 || o.deserter || o.st === 'retreat' || o.st === 'emerge' || o.st === 'enter') continue; const d = Math.abs(o.x - s.x); if (d < C.engage && Math.abs(o.y - s.y) < 22 && d < fd) { fd = d; foe = o; } }
          // BAYONET: a single hit per cycle on the foe (Wind → strike → Rec), not
          // continuous mutual DPS. (B6/#9 — feel change vs the old sDps model.)
          if (foe || s.act?.type === 'bayo') {
            s.st = 'fight'; s.stuck = 0; s.fall = false; s.combat = true;
            this.actTick(s, 'act', dt, C.bayoWind, C.bayoRec, (a) => { a.type = 'bayo'; a.foe = foe; }, (a) => {
              const f = a.foe;
              if (f && f.hp > 0 && Math.abs(f.x - s.x) < C.engage + 6 && Math.abs(f.y - s.y) < 24) { f.hp -= C.bayoDmg * (1 + (this.rnd() - 0.5) * C.bayoDmgVar); f.combat = true; }
              if (s.owner === 0) this._ev('melee', { x: Math.round(s.x + s.dir * 6), y: Math.round(s.y - 8) });
            });
            continue;
          }
          let tx = null; let ty = 0; let bd = C.musRange + (s.rj || 0);
          for (const o of this.soldiers) { if (o.owner === s.owner || o.hp <= 0 || o.deserter || o.st === 'emerge' || o.st === 'enter') continue; const dx = (o.x - s.x) * s.dir; if (dx > C.engage && dx < bd && Math.abs(o.y - s.y) < 50 && this.inSight(s.x, s.y - 10, o.x, o.y - 6)) { bd = dx; tx = o.x; ty = o.y - 6; } }
          if (active && !I.dead && s.owner === this.invader) { const dxI = (I.x - s.x) * s.dir; if (dxI > C.engage && dxI < bd && Math.abs(I.y - s.y) < 60 && this.inSight(s.x, s.y - 10, I.x, I.y - 8)) { bd = dxI; tx = I.x; ty = I.y - 8; } }
          // MUSKET: aim (musWind) → shot → reload (musRec).
          if (tx != null || s.act?.type === 'mus') {
            s.st = 'fight'; s.stuck = 0; s.fall = false;
            this.actTick(s, 'act', dt, C.musWind, C.musRec, (a) => { a.type = 'mus'; a.aim = Math.atan2(ty - (s.y - 10), tx - s.x); }, (a) => {
              const err = (this.rnd() > C.musAcc ? (this.rnd() - 0.5) * C.musMissSpread : (this.rnd() - 0.5) * C.musSpread);
              const fa = a.aim + err; const dmg = C.musDmg * (1 + (this.rnd() - 0.5) * C.musDmgVar);
              this.arrows.push({ x: s.x, y: s.y - 10, vx: Math.cos(fa) * C.musSpeed, vy: Math.sin(fa) * C.musSpeed, life: 1, owner: s.owner, soldier: true, musket: true, dmg });
              this._ev('musket', { x: Math.round(s.x), y: Math.round(s.y - 10), owner: s.owner });
            });
            if (s.act) s.aim = s.act.aim;
            continue;
          }
        }
      }
      // ENEMY BODY BLOCK (#3): a living enemy directly ahead is solid — a soldier
      // must never phase through one. Combat above already HOLDS any soldier that
      // can strike (those branches `continue`), so reaching here in contact means
      // we can't resolve it this tick (reload gap, a B4 repositioning push, or the
      // foe is just outside this weapon's arc). Hold ground — a fight must NEVER
      // trip desertion (s.stuck stays 0) — and, if already wounded, drop the path
      // so A* replans: the congestion cost biases the new route away from the
      // press, giving a best-effort detour around the enemy when one exists.
      if (interact) {
        let efoe = null;
        for (const o of arr) { if (o.owner === s.owner || o.hp <= 0 || o.deserter || o.st === 'emerge' || o.st === 'enter') continue; if ((o.x - s.x) * s.dir > 0 && Math.abs(o.x - s.x) < 11 && Math.abs(o.y - s.y) < 16) { efoe = o; break; } }
        if (efoe) {
          if (s.st !== 'fight') s.st = 'face';
          s.stuck = 0;
          if (s.hp < (s.hp0 || s.hp) && (s.reT = (s.reT || 0) + dt) > 0.6) { s.reT = 0; s.path = null; }
          continue;
        }
      }
      const sp = (s.horde || this.loserOwner >= 0) ? 0 : C.spacing;
      let blk = false;
      for (const o of arr) { if (o === s || o.owner !== s.owner || o.kind !== s.kind || o.hp <= 0 || o.deserter) continue; const a = (o.x - s.x) * s.dir; if (a > 0 && a < sp) { blk = true; break; } }
      if (blk) { if (s.st !== 'fight') s.st = 'wait'; s.stuck = (s.stuck || 0) + dt; if (s.stuck > C.desertT) s.deserter = true; continue; }
      // PATHFINDING A*
      const cata = s.kind === 'cata';
      if (cata) { s.path = null; }
      else if (!s.path || s.navVer !== this.navVer || s.pi >= s.path.length || (s.rep = (s.rep || 0) + dt) > 0.7) {
        s.rep = 0; s.navVer = this.navVer;
        const goalX = s.horde ? (this.ruinSide === 1 ? TRX : TLX) : (s.owner === 0 ? TRX : TLX);
        s.path = this.findPath(s.x, s.y, goalX, { density: this._density, congW: C.pathCongestion, jseed: s.jseed || 0, jitter: C.pathJitter, climb: this.climbStep(s.kind) }); s.pi = 1; s.goalX = goalX;
      }
      if (!s.path) {
        const goalX = cata ? (s.owner === 0 ? TRX : TLX) : (s.goalX != null ? s.goalX : (s.owner === 0 ? TRX : TLX));
        const dir = Math.sign(goalX - s.x) || s.dir; s.dir = dir;
        const surfY = (x) => (cata ? this.terrAt(x) : this.groundY(x, s.y));
        const sl = (surfY(s.x + dir * 4) - s.y) / 4;
        const lim = cata ? C.climbSlope * 0.5 : C.climbSlope;
        if (-sl > lim) { if (cata) { s.cstuck = true; s.st = 'blocked'; continue; } s.st = 'blocked'; s.stuck = (s.stuck || 0) + dt; if (s.stuck > C.desertT) s.deserter = true; continue; }
        const f2 = Math.max(0.4, Math.min(1.4, 1 - Math.abs(sl) * C.slopeFx)) * this.spdMul(s.kind);
        s.x += dir * C.v0 * f2 * dt; s.y = surfY(s.x); s.st = 'march'; s.stuck = 0; if (cata) s.cstuck = false;
        if ((s.dir > 0 && s.x >= TRX) || (s.dir < 0 && s.x <= TLX)) { if (!cata) { s.gone = true; s.hp = 0; } }
        continue;
      }
      const prev = s.path[Math.max(0, s.pi - 1)];
      const wp = s.path[Math.min(s.pi, s.path.length - 1)];
      const dir = Math.sign(wp.x - s.x) || s.dir; s.dir = dir;
      // Is this path segment a LADDER (foot↔top)? Then climb it (gravity suspended,
      // no fall) instead of treating the height delta as a drop. (#14)
      // A path node sits ON a ladder end if it's within a grid step in X and a
      // climbable step (SU) in Y. The old `< 2px` Y tolerance almost never held:
      // the path's foot/top nodes ride the grid surface (rounded to PATH_STEP),
      // which can differ from the exact ladder y by several px — so the segment
      // wasn't recognised as a ladder, the soldier read the rise as a wall (stuck)
      // or walked off the top and tumbled. The pathfinder only links these two
      // nodes via the ladder, so the looser match can't false-positive. (#1)
      const onLad = (n, lx, ly) => Math.abs(n.x - lx) <= PATH_STEP && Math.abs(n.y - ly) <= SU;
      const ladSeg = this.ladders.length ? this.ladders.find((L) => (onLad(prev, L.xb, L.yb) && onLad(wp, L.xt, L.yt)) || (onLad(prev, L.xt, L.yt) && onLad(wp, L.xb, L.yb))) : null;
      if (ladSeg) {
        s.st = 'climb'; s.dir = Math.sign(wp.x - prev.x) || s.dir; const csp = C.v0 * 0.7 * dt;
        s.x += Math.sign(wp.x - s.x) * Math.min(Math.abs(wp.x - s.x), csp);
        s.y += Math.sign(wp.y - s.y) * Math.min(Math.abs(wp.y - s.y), csp);
        if (Math.abs(wp.x - s.x) < 1.5 && Math.abs(wp.y - s.y) < 2) s.pi += 1;
        continue;
      }
      // A rising ledge just ahead, too tall to walk but within jump reach → leap (B3/#10).
      const aheadSurf = this.groundY(s.x + dir * 5, s.y); const rise = s.y - aheadSurf;
      if (!cata && this.jumpMul(s.kind) > 0 && rise > SU && rise <= this.climbStep(s.kind) + 2) {
        s.jvy = -Math.sqrt(2 * C.grav * (rise + 8)); s.jdir = dir; s.st = 'jump'; s.stuck = 0; s.descAcc = 0;
        continue;
      }
      const segSlope = (wp.y - prev.y) / Math.max(8, Math.abs(wp.x - prev.x));
      const ramp = Math.min(1, (s.age || 0) / Math.max(0.001, C.doorT)); s.age = (s.age || 0) + dt;
      const vmul = this.spdMul(s.kind) * (s.horde ? 1.8 : 1);
      const f = Math.max(0.4, Math.min(1.4, 1 - Math.abs(segSlope) * C.slopeFx)) * ramp * vmul;
      s.x += dir * C.v0 * f * dt;
      const tt = (wp.x !== prev.x) ? Math.max(0, Math.min(1, (s.x - prev.x) / (wp.x - prev.x))) : 1;
      const plannedY = prev.y + (wp.y - prev.y) * tt;
      let ny = plannedY; let bd = 1e9;
      for (const yy of this.surfacesAt(s.x)) { const d = Math.abs(yy - plannedY); if (d < bd) { bd = d; ny = yy; } }
      const drop = ny - s.y;
      if (drop > 1.5) s.descAcc = (s.descAcc || 0) + drop; // accumulate the fast descent
      else if (s.descAcc > 0) { // descent just ended → landing
        // LINEAR tumble probability: 0% at fallHmin, 100% at fallHmax (seeded).
        // An unlucky roll → damage ∝ height × per-type fallMul + recovery; else a
        // controlled climb-down (no damage). A fall is a suicide (no resource).
        const prob = Math.max(0, Math.min(1, (s.descAcc - C.fallHmin) / Math.max(1, C.fallHmax - C.fallHmin)));
        if (this.rnd() < prob) {
          s.hp -= C.fallDmg * s.descAcc * 0.1 * this.fallMul(s.kind); s.recover = Math.min(2.2, s.descAcc * 0.03); s.fall = true;
        }
        s.descAcc = 0;
      }
      s.y = ny; s.st = 'march'; s.stuck = 0;
      if (Math.abs(wp.x - s.x) < 6) s.pi += 1;
      if ((s.dir > 0 && s.x >= TRX) || (s.dir < 0 && s.x <= TLX)) {
        if (s.horde || (this.loserOwner >= 0 && s.owner !== this.loserOwner)) {
          if (s.st !== 'arrived') { const rx = s.horde ? (this.ruinSide === 1 ? TRX : TLX) : (this.loserOwner >= 0 ? this.towers[this.loserOwner].x : (s.owner === 0 ? TRX : TLX)); s.ax = rx + (this.rnd() - 0.5) * 72; }
          s.st = 'arrived';
        } else if (s.kind !== 'cata') { s.gone = true; s.hp = 0; }
      }
    }
  }

  // Coarse heightfield for the TV: the live (terraformed) surface sampled every
  // TERRAIN_SAMPLE px, last column included so the right edge is exact. The TV
  // linearly interpolates back to full resolution.
  coarseTerrain() {
    const out = [];
    for (let x = 0; x < this.W; x += TERRAIN_SAMPLE) out.push(Math.round(this.terrAt(x)));
    out.push(Math.round(this.terrAt(this.W - 1)));
    return out;
  }

  // --- snapshot ------------------------------------------------------------

  // Compact authoritative state for clients (the TV reconstructs y=heightAt(x)
  // locally where it can). Kept JSON-clean and Phaser-free.
  snapshot() {
    return {
      round: { loserOwner: this.loserOwner, ruinSide: this.ruinSide, ruinT: Math.round(this.ruinT * 10) / 10, lastWinner: this.lastWinner, scored: this.roundScored },
      invader: this.invader,
      present: this.present,
      score: this.score,
      banner: this.bannerT > 0 ? this.banner : '',
      intendant: {
        x: Math.round(this.I.x), y: Math.round(this.I.y), facing: this.I.facing,
        hp: Math.max(0, this.I.hp), dead: this.I.dead, playable: this.I.playable,
        weapon: this.I.weapon, attacking: this.I.attacking, glide: this.I.glide,
        aimAng: this.I.aimAng, act: this.I.act ? this.I.act.kind : null, building: !!this.I.job,
        style: this.I.style, bp: this.I.bp.slice(),
        // Magic shield: remaining window, impact pulse, live sparks (angles). The
        // dome's visual STYLE is resolved render-side from the biome, not sent.
        shield: { t: Math.round(this.I.shieldT * 100) / 100, hit: Math.round(this.I.shieldHit * 100) / 100, fx: this.I.shieldFx.map((f) => ({ a: Math.round(f.a * 1000) / 1000, t: f.t })) },
      },
      // Towers contribute ONLY the musketry-alert flag here; position + HP come
      // from the artillery towers (state.towers) the renderers already have.
      towers: this.towers.map((t) => ({ owner: t.owner, warn: t.warn })),
      structures: this.structures.map((p) => ({ x0: Math.round(p.x0), x1: Math.round(p.x1), y: Math.round(p.y) })),
      ladders: this.ladders.map((L) => ({ xb: Math.round(L.xb), yb: Math.round(L.yb), xt: Math.round(L.xt), yt: Math.round(L.yt) })),
      // Coarse heightfield (every TERRAIN_SAMPLE px) so the TV can rebuild the
      // terrain the Intendant has terraformed (dig/fill/flatten don't emit
      // craters). Support bars are NOT sent — the renderer derives the strut
      // lattice from `structures` + this terrain (a light spec, decompressed at
      // render). See design/integration-plan.md.
      terrain: this.coarseTerrain(),
      soldiers: this.soldiers.map((s) => ({ id: s.id, owner: s.owner, x: Math.round(s.x), y: Math.round(s.y), hp: Math.max(0, Math.round(s.hp)), kind: s.kind, st: s.st, deserter: !!s.deserter, dir: s.dir })),
      horde: this.horde.map((s) => ({ id: s.id, owner: s.owner, x: Math.round(s.x), y: Math.round(s.y), st: s.st, bg: !!s.bg, dir: s.dir, deserter: !!s.deserter })),
      projectiles: this.arrows.map((a) => ({ id: (a.id != null ? a.id : (a.id = this.nextId++)), x: Math.round(a.x), y: Math.round(a.y), ball: !!a.ball, gren: !!a.gren, bolt: !!a.bolt, musket: !!a.musket, fromI: !!a.fromI, owner: a.owner ?? null })),
    };
  }
}
