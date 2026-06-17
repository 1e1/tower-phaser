import { GAME_WIDTH, GAME_HEIGHT, AIM, PHYSICS, MAX_WIND, CRATER_RADIUS, AIM_NOISE, SHIELD } from '../config/constants.js';
import { generateHeights, heightAt, pointSolid } from './terrain.js';
import { aimVector, muzzle, pivot, bounds, rectContains } from './geometry.js';
import { getShell } from '../config/shells.js';

// Authoritative, framework-free game simulation. It runs on the server (the
// single source of truth) and is driven purely by player intents and fixed
// time steps. Clients render the snapshots it produces; they never simulate.

export const PHASE = {
  LOBBY: 'lobby',
  AIMING: 'aiming',
  FIRING: 'firing',
  RESOLVING: 'resolving',
  MATCH_END: 'matchEnd',
};

const RESOLVE_MISS_DELAY = 1.1;
const RESOLVE_HIT_DELAY = 1.7;

// Turbo wind eases between a fresh random keypoint every this many seconds.
const WIND_KEY_SECONDS = 10;

// Special shells are rationed (normal is unlimited): one of each to start, +1
// of every special each round, and +1 of a type whenever it hits your tower.
const SPECIALS = ['heavy', 'light', 'salvo', 'explosive'];
// Shield is NOT a special shell: it is not resupplied per round and is not
// granted by being hit — it is earned only by LOSING a round (see decideRound),
// so it starts at 0 and lives alongside the shell stock.
const initAmmo = () => ({ heavy: 1, light: 1, salvo: 1, explosive: 1, shield: 0 });

// Distance of a small point from a segment AB — used for shell↔shield contact.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default class Simulation {
  constructor({ names, winsNeeded, biome, maxHp = 1, turbo = false, cadence = 5, random = Math.random }) {
    this.random = random;
    this.names = names;
    this.winsNeeded = winsNeeded; // first player to win this many rounds takes the match
    this.biome = biome;
    this.maxHp = maxHp;
    this.turbo = turbo;
    this.cadence = cadence;
    this.shotClock = null; // turbo: seconds left for the not-yet-ready player
    this.roughness = biome.roughness ?? 1;

    this.scores = [0, 0];
    this.roundsPlayed = 0;
    this.currentRound = 1;
    this.phase = PHASE.LOBBY;
    this.projectileSeq = 0;
    this.projectiles = [];
    this.craters = [];
    this.volleyDamage = [0, 0]; // damage dealt BY each player this volley
    this.events = [];
    this.resolveTimer = 0;
    this.banner = '';

    this.towers = [
      { x: 120, facing: 1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo(), shield: null },
      { x: GAME_WIDTH - 120, facing: -1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo(), shield: null },
    ];

    this.seed = 0;
    this.heights = new Float32Array(GAME_WIDTH);
    this.wind = 0;

    // Turbo wind is *continuous*: instead of snapping to a fresh value each
    // turn, it eases between random keypoints generated every WIND_KEY_SECONDS,
    // with a lighter "gust" wave layered on top. `gustiness` is the match's wind
    // personality (0 = steady, 1 = squally), rolled once at the start.
    this.windFrom = 0;
    this.windTo = 0;
    this.windClock = 0;
    this.gustPhase = 0;
    this.gustiness = 0;
  }

  randInt(min, max) {
    return Math.floor(min + this.random() * (max - min + 1));
  }

  // --- lifecycle -----------------------------------------------------------

  start() {
    this.phase = PHASE.AIMING;
    this.newTerrain();
    if (this.turbo) this.initTurboWind();
    else this.randomizeWind();
    this.resetReady();
    this.pushEvent('roundStart', { round: this.currentRound });
  }

  newTerrain() {
    this.seed = this.randInt(1, 2 ** 31 - 1);
    this.heights = generateHeights(this.seed, this.roughness);
    this.craters = [];
    for (const t of this.towers) {
      t.groundY = heightAt(this.heights, t.x);
      t.damage = 0; // full health each new round
      t.shield = null; // shields do not carry across rounds
    }
  }

  randomizeWind() {
    const magnitude = this.randInt(0, MAX_WIND);
    const sign = this.random() < 0.5 ? -1 : 1;
    this.wind = magnitude * sign;
  }

  // --- turbo continuous wind ----------------------------------------------

  // A signed base-wind keypoint, kept under 80% of MAX so the gust wave has
  // headroom to add on top without slamming into the clamp.
  windKeypoint() {
    const magnitude = this.randInt(0, Math.round(MAX_WIND * 0.8));
    const sign = this.random() < 0.5 ? -1 : 1;
    return magnitude * sign;
  }

  initTurboWind() {
    this.gustiness = this.random(); // this match's wind personality
    this.gustPhase = this.random() * Math.PI * 2;
    this.windClock = 0;
    this.windFrom = this.windKeypoint();
    this.windTo = this.windKeypoint();
    this.wind = this.windFrom;
  }

  // Ease the applied wind toward the next keypoint (smoothstep), regenerating a
  // fresh target every WIND_KEY_SECONDS, and overlay a light gust wave so the
  // breeze breathes instead of gliding mechanically.
  updateTurboWind(dt) {
    this.windClock += dt;
    if (this.windClock >= WIND_KEY_SECONDS) {
      this.windClock -= WIND_KEY_SECONDS; // carry the overshoot, no snap
      this.windFrom = this.windTo;
      this.windTo = this.windKeypoint();
    }
    const t = this.windClock / WIND_KEY_SECONDS;
    const s = t * t * (3 - 2 * t); // smoothstep easing between keypoints
    const base = this.windFrom + (this.windTo - this.windFrom) * s;

    this.gustPhase += dt;
    const gustAmp = this.gustiness * MAX_WIND * 0.22;
    const gust = gustAmp * (Math.sin(this.gustPhase * 1.7) * 0.6
      + Math.sin(this.gustPhase * 0.9 + 1.3) * 0.4);

    this.wind = Math.max(-MAX_WIND, Math.min(MAX_WIND, base + gust));
  }

  resetReady() {
    this.towers.forEach((t) => {
      t.ready = false;
    });
  }

  // --- intents from controllers -------------------------------------------

  setAim(player, angle, power) {
    if (this.phase !== PHASE.AIMING) return;
    const tower = this.towers[player];
    if (!tower || tower.ready) return;
    if (Number.isFinite(angle)) {
      tower.angle = Math.max(AIM.minAngle, Math.min(AIM.maxAngle, angle));
    }
    if (Number.isFinite(power)) {
      tower.power = Math.max(AIM.minPower, Math.min(AIM.maxPower, power));
    }
  }

  setShell(player, id) {
    if (this.phase !== PHASE.AIMING) return;
    const tower = this.towers[player];
    if (!tower || tower.ready) return;
    // The shield is a pseudo-shell: selecting it arms a deploy instead of a shot.
    if (id === 'shield') {
      if ((tower.ammo.shield || 0) > 0) tower.shell = 'shield';
      return;
    }
    if (getShell(id).id !== id) return;
    if (id !== 'normal' && (tower.ammo[id] || 0) <= 0) return; // out of stock
    tower.shell = id;
  }

  setReady(player, ready = true) {
    if (this.phase !== PHASE.AIMING) return;
    const tower = this.towers[player];
    if (!tower) return;
    tower.ready = ready;
    if (this.towers[0].ready && this.towers[1].ready) {
      this.fire();
      return;
    }
    if (this.turbo) {
      const onlyOne = this.towers[0].ready !== this.towers[1].ready;
      if (ready && onlyOne) {
        if (this.shotClock == null) this.shotClock = this.cadence; // the other must commit
      } else if (!this.towers[0].ready && !this.towers[1].ready) {
        this.shotClock = null;
      }
    }
  }

  // --- combat --------------------------------------------------------------

  fire() {
    // Classic fires a fresh volley; turbo lets shells pile up in flight.
    if (!this.turbo) this.projectiles = [];
    this.towers.forEach((tower, i) => {
      // Shield deploy takes the place of this tower's shot: no projectile leaves.
      if (tower.shell === 'shield') {
        if ((tower.ammo.shield || 0) > 0) {
          tower.ammo.shield -= 1;
          this.deployShield(i);
        }
        tower.shell = 'normal'; // back to a real shell next volley
        return;
      }
      let shell = getShell(tower.shell);
      // Special shells consume stock; fall back to the unlimited normal shell.
      if (shell.id !== 'normal') {
        if ((tower.ammo[shell.id] || 0) > 0) tower.ammo[shell.id] -= 1;
        else shell = getShell('normal');
      }
      const m = muzzle(tower); // spawn from the validated barrel pose
      this.pushEvent('fire', { owner: i, x: m.x, y: m.y, angle: tower.angle, shell: shell.id });

      for (let k = 0; k < shell.count; k += 1) {
        // Cluster spread + the hidden per-shot jitter (#4). Neither is sent to
        // the clients, so the deviation stays invisible to the players.
        const spreadOffset = shell.count > 1 ? (k - (shell.count - 1) / 2) * shell.spread : 0;
        const jitterA = (this.random() * 2 - 1) * AIM_NOISE.angle;
        const jitterP = (this.random() * 2 - 1) * AIM_NOISE.power;
        const angle = Math.max(AIM.minAngle, Math.min(AIM.maxAngle, tower.angle + spreadOffset + jitterA));
        const power = Math.max(AIM.minPower, Math.min(AIM.maxPower, tower.power + jitterP));
        const v = aimVector(angle, tower.facing);
        // Muzzle velocity scales with the shell's weight (fixed-energy cannon):
        // heavier shells leave slower (shorter reach), lighter ones faster.
        const speed = power * PHYSICS.speedScale * (shell.speedFactor ?? 1);
        this.projectileSeq += 1;
        this.projectiles.push({
          id: this.projectileSeq,
          x: m.x,
          y: m.y,
          vx: v.x * speed,
          vy: v.y * speed,
          owner: i,
          alive: true,
          elapsed: 0,
          windFactor: shell.windFactor,
          crater: CRATER_RADIUS * shell.craterMul,
          dmg: shell.dmg,
          shellId: shell.id,
        });
      }

      // If the chosen special just ran out, fall the selection back to normal.
      if (tower.shell !== 'normal' && (tower.ammo[tower.shell] || 0) <= 0) {
        tower.shell = 'normal';
      }

      // We just fired through our own barrier: open it so our shell passes. It
      // re-seals once that shell has cleared the plate (updateShieldGates).
      if (tower.shield && tower.shield.alive) tower.shield.open = true;
    });
    this.volleyDamage = [0, 0];
    if (this.turbo) {
      // Stay live: reset readiness so both can immediately aim the next shot
      // while these shells are still in the air.
      this.resetReady();
      this.shotClock = null;
      this.phase = PHASE.AIMING;
    } else {
      this.phase = PHASE.FIRING;
    }
  }

  // Place this tower's shield: the aim angle sets its direction, the power its
  // distance from the tower; the plate sits perpendicular to that line so it
  // presents a broad face to incoming shells.
  deployShield(i) {
    const tower = this.towers[i];
    const p = pivot(tower);
    const d = aimVector(tower.angle, tower.facing);
    const ratio = (tower.power - AIM.minPower) / (AIM.maxPower - AIM.minPower);
    const dst = SHIELD.minDist + Math.max(0, Math.min(1, ratio)) * (SHIELD.maxDist - SHIELD.minDist);
    const cx = p.x + d.x * dst;
    const cy = p.y + d.y * dst;
    // open=false: a freshly raised shield is solid. It is a physical barrier that
    // stops ANY shell crossing it — so it briefly opens when its OWNER fires, to
    // let their own shell out (see fire + updateShieldGates).
    tower.shield = { x: cx, y: cy, ux: -d.y, uy: d.x, alive: true, open: false };
    this.pushEvent('shield', { owner: i, x: Math.round(cx), y: Math.round(cy) });
  }

  tick(dt) {
    // Turbo keeps the wind flowing continuously across aiming and the brief
    // between-round pauses (classic randomizes once per turn instead).
    if (this.turbo && (this.phase === PHASE.AIMING || this.phase === PHASE.RESOLVING)) {
      this.updateTurboWind(dt);
    }
    if (this.phase === PHASE.FIRING) {
      this.stepProjectiles(dt);
      if (this.projectiles.every((p) => !p.alive)) {
        this.enterResolve();
      }
    } else if (this.phase === PHASE.RESOLVING) {
      this.resolveTimer -= dt;
      if (this.resolveTimer <= 0) {
        this.applyResolution();
      }
    } else if (this.phase === PHASE.AIMING && this.turbo) {
      // Turbo: shells fly during aiming; damage resolves on impact.
      if (this.projectiles.length) {
        this.stepProjectiles(dt);
        if (this.phase === PHASE.AIMING) this.projectiles = this.projectiles.filter((p) => p.alive);
      }
      this.tickShotClock(dt);
    }
  }

  tickShotClock(dt) {
    if (this.shotClock == null) return;
    this.shotClock -= dt;
    if (this.shotClock <= 0) {
      this.shotClock = null;
      const laggard = this.towers.findIndex((t) => !t.ready);
      if (laggard !== -1) this.setReady(laggard, true); // auto-fire the slow player
    }
  }

  stepProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.px = p.x; // path start this tick (so a fast shell can't tunnel the shield)
      p.py = p.y;
      p.vx += this.wind * (p.windFactor ?? 1) * dt;
      p.vy += PHYSICS.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.elapsed += dt;
      this.checkCollision(p);
    }
    this.updateShieldGates();
  }

  // Re-seal an opened shield once its owner's own shells have cleared the plate
  // (flown past `deployDistance + plateHalf + shellRadius` from the tower). Until
  // then the barrier stays open so it never blocks the shot that opened it.
  updateShieldGates() {
    for (let i = 0; i < 2; i += 1) {
      const sh = this.towers[i].shield;
      if (!sh || !sh.alive || !sh.open) continue;
      const piv = pivot(this.towers[i]);
      const clear = Math.hypot(sh.x - piv.x, sh.y - piv.y) + SHIELD.plateHalf + SHIELD.hitRadius;
      const stillCrossing = this.projectiles.some(
        (p) => p.alive && p.owner === i && Math.hypot(p.x - piv.x, p.y - piv.y) <= clear,
      );
      if (!stillCrossing) sh.open = false;
    }
  }

  checkCollision(p) {
    if (
      p.x < -60 ||
      p.x > GAME_WIDTH + 60 ||
      p.y > GAME_HEIGHT + 40 ||
      p.elapsed > PHYSICS.maxFlightTime
    ) {
      p.alive = false;
      return;
    }

    const targetIdx = p.owner === 0 ? 1 : 0;
    const opponent = this.towers[targetIdx];

    // A shield is a physical barrier: it absorbs the first shell to cross it (1
    // HP), then shatters — whoever fired it. It is skipped only while OPEN (its
    // owner is firing through it). Both towers' shields are tested, but the
    // owner's own shell sails out because we open that shield on fire. We sample
    // along the shell's path so a fast shell can't tunnel the thin plate.
    const x0 = p.px ?? p.x;
    const y0 = p.py ?? p.y;
    for (let ti = 0; ti < 2; ti += 1) {
      const sh = this.towers[ti].shield;
      if (!sh || !sh.alive || sh.open) continue;
      const a1x = sh.x + sh.ux * SHIELD.plateHalf;
      const a1y = sh.y + sh.uy * SHIELD.plateHalf;
      const a2x = sh.x - sh.ux * SHIELD.plateHalf;
      const a2y = sh.y - sh.uy * SHIELD.plateHalf;
      let blocked = false;
      for (let t = 0; t <= 1; t += 0.25) {
        const sx = x0 + (p.x - x0) * t;
        const sy = y0 + (p.y - y0) * t;
        if (segDist(sx, sy, a1x, a1y, a2x, a2y) < SHIELD.hitRadius) { blocked = true; break; }
      }
      if (blocked) {
        p.alive = false;
        this.towers[ti].shield = null; // 1 HP: the plate is spent
        this.pushEvent('shieldHit', { x: Math.round(p.x), y: Math.round(p.y), owner: ti });
        return;
      }
    }

    if (rectContains(bounds(opponent), p.x, p.y)) {
      p.alive = false;
      // The struck player gains a round of the shell that just hit them.
      if (p.shellId && p.shellId !== 'normal') {
        opponent.ammo[p.shellId] = (opponent.ammo[p.shellId] || 0) + 1;
      }
      this.pushEvent('hit', { x: p.x, y: p.y, owner: p.owner, target: targetIdx, shell: p.shellId });
      if (this.turbo) {
        // Damage resolves immediately on impact; the round ends the instant a
        // tower's HP is depleted, even mid-flight of other shells.
        if (this.phase === PHASE.AIMING) {
          opponent.damage += p.dmg ?? 1;
          if (opponent.damage >= this.maxHp) this.decideRound();
        }
      } else {
        this.volleyDamage[p.owner] += p.dmg ?? 1;
      }
      return;
    }

    if (p.y > 0 && pointSolid(this.heights, this.craters, p.x, p.y)) {
      p.alive = false;
      const r = Math.round(p.crater ?? CRATER_RADIUS);
      this.craters.push({ x: Math.round(p.x), y: Math.round(p.y), r });
      this.pushEvent('impact', { x: p.x, y: p.y, r });
    }
  }

  // Classic: settle a volley once all shells have landed.
  enterResolve() {
    const [d1, d2] = this.volleyDamage; // d1: damage dealt by player 0 to tower 1
    this.towers[1].damage += d1;
    this.towers[0].damage += d2;

    if (this.towers[0].damage >= this.maxHp || this.towers[1].damage >= this.maxHp) {
      this.decideRound();
      return;
    }
    // Round continues: a hit only chipped some HP, or both missed.
    this.phase = PHASE.RESOLVING;
    this.banner = d1 || d2 ? 'Direct hit!' : 'Both missed!';
    this.resolveTimer = RESOLVE_MISS_DELAY;
    this.pushEvent('turnEnd', { decided: false });
  }

  // A tower has fallen: award the round and pause before the next one. Shared
  // by classic (at volley resolve) and turbo (the instant a tower's HP hits 0).
  decideRound() {
    const dead0 = this.towers[0].damage >= this.maxHp;
    const dead1 = this.towers[1].damage >= this.maxHp;
    if (dead1) this.scores[0] += 1;
    if (dead0) this.scores[1] += 1;
    // The loser of the round earns a shield (the underdog's consolation/clutch).
    if (dead0) this.towers[0].ammo.shield += 1;
    if (dead1) this.towers[1].ammo.shield += 1;
    this.roundsPlayed += 1;
    if (dead0) this.pushEvent('destroyed', { tower: 0 });
    if (dead1) this.pushEvent('destroyed', { tower: 1 });
    if (dead0 && dead1) this.banner = 'Both towers fall!';
    else if (dead1) this.banner = `${this.names[0]} scores!`;
    else this.banner = `${this.names[1]} scores!`;
    this.projectiles = [];
    this.resetReady();
    this.shotClock = null;
    this.resolveTimer = RESOLVE_HIT_DELAY;
    this.phase = PHASE.RESOLVING;
    this.pushEvent('turnEnd', { decided: true, scores: this.scores.slice() });
  }

  applyResolution() {
    const decided = this.towers.some((t) => t.damage >= this.maxHp);
    this.banner = '';

    if (!decided) {
      this.nextTurn();
      return;
    }

    if (Math.max(this.scores[0], this.scores[1]) >= this.winsNeeded) {
      this.phase = PHASE.MATCH_END;
      this.projectiles = [];
      this.pushEvent('matchEnd', { scores: this.scores.slice() });
      return;
    }

    this.currentRound += 1;
    // Each player is resupplied with one of every special shell per round.
    this.towers.forEach((t) => SPECIALS.forEach((s) => { t.ammo[s] += 1; }));
    this.newTerrain();
    this.pushEvent('roundStart', { round: this.currentRound });
    this.nextTurn();
  }

  nextTurn() {
    if (!this.turbo) this.randomizeWind(); // turbo wind flows on, uninterrupted
    this.resetReady();
    this.projectiles = [];
    this.volleyDamage = [0, 0];
    this.shotClock = null;
    this.phase = PHASE.AIMING;
  }

  // Index of the losing player, or -1 on a draw.
  loser() {
    if (this.scores[0] < this.scores[1]) return 0;
    if (this.scores[1] < this.scores[0]) return 1;
    return -1;
  }

  // --- events --------------------------------------------------------------

  pushEvent(type, data) {
    this.events.push({ type, ...data });
  }

  // Drain queued one-shot events (consumed by the server each broadcast).
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Compact snapshot for clients. Aim angle/power are deliberately omitted so
  // the spectator TV never reveals what the players are setting; only the
  // ready flags and, once fired, the resulting projectiles are shared.
  snapshot() {
    return {
      phase: this.phase,
      round: { current: this.currentRound, total: this.winsNeeded }, // `total` carries the win target (first-to-N)
      wind: this.wind,
      scores: this.scores.slice(),
      seed: this.seed,
      biomeId: this.biome.id,
      banner: this.banner,
      craters: this.craters,
      maxHp: this.maxHp,
      turbo: this.turbo,
      shotClock: this.shotClock == null ? null : Math.max(0, Math.round(this.shotClock * 10) / 10),
      names: this.names.slice(),
      // angle/power drive the live cannon orientation and charge tint on the
      // renderers; the exact numbers are never displayed on the TV.
      towers: this.towers.map((t) => ({
        ready: t.ready,
        groundY: t.groundY,
        angle: t.angle,
        power: t.power,
        shell: t.shell,
        hp: Math.max(0, this.maxHp - t.damage),
        ammo: { ...t.ammo },
        shield: t.shield
          ? { x: Math.round(t.shield.x), y: Math.round(t.shield.y), ux: t.shield.ux, uy: t.shield.uy, open: !!t.shield.open }
          : null,
      })),
      projectiles: this.projectiles
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner, shell: p.shellId })),
    };
  }
}
