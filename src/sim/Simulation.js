import { GAME_WIDTH, GAME_HEIGHT, AIM, PHYSICS, MAX_WIND, CRATER_RADIUS, AIM_NOISE, SHIELD, WINDSOCK } from '../config/constants.js';
import { generateHeights, heightAt, pointSolid, TERRAIN } from './terrain.js';
import { mulberry32 } from './rng.js';
import { aimVector, muzzle, pivot, bounds, rectContains } from './geometry.js';
import { getShell } from '../config/shells.js';
import Battlefield from './battlefield.js';

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
  constructor({ names, winsNeeded, biome, maxHp = 1, turbo = false, cadence = 5, seed = null, random = null, livingBattlefield = false }) {
    // A match seed makes the whole "B" layer replayable: terrain seed, free
    // platform heights, tower spread, wind and aim noise all draw from this one
    // deterministic stream (mulberry32) instead of Math.random. Same seed +
    // same inputs → same match. An explicit `random` (tests) overrides it; with
    // neither, we fall back to Math.random (legacy, non-reproducible).
    this.matchSeed = (seed != null) ? (seed >>> 0 || 1) : null;
    this.random = random ?? (this.matchSeed != null ? mulberry32(this.matchSeed) : Math.random);
    // Optional "living battlefield" mode (3rd-player Intendant + continuous
    // soldiers). OFF by default → the 2-player duel behaves exactly as before.
    // When on, a Phaser-free Battlefield sim advances the living world on top of
    // the turn-by-turn artillery (built in newTerrain, once heights exist).
    this.livingBattlefield = livingBattlefield;
    this.battlefield = null;
    this.names = names;
    this.winsNeeded = winsNeeded; // first player to win this many rounds takes the match
    this.biome = biome;
    this.maxHp = maxHp;
    this.turbo = turbo;
    this.cadence = cadence;
    this.shotClock = null; // turbo: seconds left for the not-yet-ready player
    this.roughness = biome.roughness ?? 1;

    this.scores = [0, 0];
    this.currentRound = 1;
    this.phase = PHASE.LOBBY;
    this.projectileSeq = 0;
    this.projectiles = [];
    this.craters = [];
    // Central windsock: a 1-HP mid-field target, repositioned/revived each round
    // (spawnWindsock). Downing it awards the firing player a shield.
    this.windsock = { x: Math.round(GAME_WIDTH / 2), y: 0, alive: true };
    this.volleyDamage = [0, 0]; // damage dealt BY each player this volley
    this.events = [];
    this.resolveTimer = 0;
    this.banner = '';

    this.towers = [
      { x: 120, facing: 1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo(), shields: [] },
      { x: GAME_WIDTH - 120, facing: -1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo(), shields: [] },
    ];

    this.seed = 0;
    this.heights = new Float32Array(GAME_WIDTH);
    this.wind = 0;

    // Inter-round arena continuity: the next arena's seam-side platform inherits
    // the height of the platform under the just-destroyed tower, so the camera
    // pan slides across a continuous ground line (no vertical step). seamY holds
    // that carried height; lastDestroyed which side the pan moves toward.
    this.seamY = null;
    this.lastDestroyed = null;

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
    const { platformY } = TERRAIN;
    const hv = this.biome.heightVariance ?? 0;
    const freeHeight = () => platformY + (this.random() * 2 - 1) * hv;

    // One platform is free; the seam-side one is carried from the previous arena
    // for a continuous pan (see seamY). We pan toward the destroyed tower, so the
    // new arena's seam side is the opposite index (1 - lastDestroyed):
    //   lastDestroyed 1 → pan right → new LEFT platform meets the old seam.
    //   lastDestroyed 0 → pan left  → new RIGHT platform meets the old seam.
    let leftY;
    let rightY;
    if (this.seamY == null || this.lastDestroyed == null) {
      leftY = freeHeight(); // first round (or no prior pan): both free
      rightY = freeHeight();
    } else if (this.lastDestroyed === 1) {
      leftY = this.seamY;
      rightY = freeHeight();
    } else {
      rightY = this.seamY;
      leftY = freeHeight();
    }

    const centralRise = this.biome.centralRise ?? 0;
    this.heights = generateHeights(this.seed, this.roughness, { leftY, rightY, centralRise });
    this.craters = [];

    // Slide each tower along its (flat) platform so the gap varies per round.
    // Clamped inside the flat platform zone so groundY stays exactly leftY/rightY.
    const jit = 60 * (this.biome.distanceVariance ?? 0);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    this.towers[0].x = Math.round(clamp(120 + (this.random() * 2 - 1) * jit, 90, 200));
    this.towers[1].x = Math.round(clamp((GAME_WIDTH - 120) + (this.random() * 2 - 1) * jit, GAME_WIDTH - 200, GAME_WIDTH - 90));

    for (const t of this.towers) {
      t.groundY = heightAt(this.heights, t.x);
      t.damage = 0; // full health each new round
      t.shields = []; // shields do not carry across rounds
    }
    this.spawnWindsock();

    if (this.livingBattlefield) this.buildBattlefield();
  }

  // World adapter handed to the Battlefield sim: it reads/writes THIS sim's
  // authoritative heightfield and craters, so the living world and the artillery
  // duel share one ground. The Battlefield never regenerates terrain itself.
  battlefieldWorld() {
    const self = this;
    return {
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      platformWidth: TERRAIN.platformWidth,
      towerX: [this.towers[0].x, this.towers[1].x],
      craterR: CRATER_RADIUS,
      heightAt: (x) => heightAt(self.heights, x),
      // Terraforming / impacts mutate the shared heightfield. We model the
      // surface as the heightfield's y (lab convention): raising heights[x]
      // lowers the surface on screen (digging), lowering it raises the ground.
      carveCrater(mx, my, r, vx, vy) { self.carveTerrain(mx, my, r, vx, vy); },
      dig(tx, ty, rr, amount, digH = 9) {
        // Pit floor referenced to the stable rim outside the hole (min of the two
        // shoulders) so digging bottoms out at rim + digH instead of forever.
        const ref = Math.min(self.heights[self.clampX(tx - rr - 6)], self.heights[self.clampX(tx + rr + 6)]);
        for (let d = -rr; d <= rr; d += 1) { const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / rr); const c = self.clampX(tx + d); const fy = ref + w * digH; if (self.heights[c] < fy) self.heights[c] = Math.min(GAME_HEIGHT - 2, self.heights[c] + amount * w); }
      },
      bash(ix, iy, dir, reach, amount) {
        for (let d = 0; d <= reach; d += 1) { const c = self.clampX(ix + dir * d); if (self.heights[c] < iy) self.heights[c] = Math.min(iy, self.heights[c] + amount); }
      },
      fill(tx, ty, rr, amount, digH = rr * 0.85) {
        for (let d = -rr; d <= rr; d += 1) { const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / rr); const c = self.clampX(tx + d); const tp = Math.max(0, ty - w * digH); if (self.heights[c] > tp) self.heights[c] = Math.max(tp, self.heights[c] - amount * w); }
      },
      flatten(tx, rr, k) {
        const xl = self.clampX(tx - rr); const xr = self.clampX(tx + rr); const yl = self.heights[xl]; const yr = self.heights[xr];
        for (let x = xl; x <= xr; x += 1) { const t = (x - xl) / Math.max(1, xr - xl); const target = yl + (yr - yl) * t; self.heights[x] += (target - self.heights[x]) * k; }
      },
      editColumn() {}, // presence enables terraform in Battlefield
    };
  }

  clampX(x) { return x < 0 ? 0 : (x > GAME_WIDTH - 1 ? GAME_WIDTH - 1 : x | 0); }

  buildBattlefield() {
    // Seed derived from the terrain seed → deterministic, no Math.random.
    this.battlefield = new Battlefield({ seed: this.seed ^ 0x9e3779b9, world: this.battlefieldWorld(), params: { maxHp: this.maxHp } });
    // Real artillery drives the escalade cannon's cadence (see onArtilleryFired).
    this.battlefield.syncCannon = true;
  }

  // Plant the central windsock on the fresh terrain: alive again, anchored to the
  // top of its pole at mid-field. y is the pole TOP (heightAt - poleH) so the
  // renderers and the collision test share one authoritative anchor.
  spawnWindsock() {
    const x = Math.round(GAME_WIDTH / 2);
    this.windsock = { x, y: Math.round(heightAt(this.heights, x) - WINDSOCK.poleH), alive: true };
  }

  randomizeWind() {
    const ws = this.biome.windScale ?? 1;
    const magnitude = this.randInt(0, MAX_WIND);
    const sign = this.random() < 0.5 ? -1 : 1;
    this.wind = Math.max(-MAX_WIND, Math.min(MAX_WIND, magnitude * sign * ws));
  }

  // --- turbo continuous wind ----------------------------------------------

  // A signed base-wind keypoint, kept under 80% of MAX so the gust wave has
  // headroom to add on top without slamming into the clamp.
  windKeypoint() {
    const ws = this.biome.windScale ?? 1;
    const magnitude = this.randInt(0, Math.round(MAX_WIND * 0.8));
    const sign = this.random() < 0.5 ? -1 : 1;
    return magnitude * sign * ws; // updateTurboWind clamps base+gust to ±MAX_WIND
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
      // It is refused (and the turn wasted on nothing) if out of stock or already
      // at the active-plate cap — at most SHIELD.maxActive may stand at once.
      if (tower.shell === 'shield') {
        if ((tower.ammo.shield || 0) > 0 && tower.shields.length < SHIELD.maxActive) {
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
      // The living world's escalade cannon may answer a real shot (lot 5 sync).
      if (this.battlefield) this.battlefield.onArtilleryFired(i);

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

      // We just fired through our own barriers: open them all so our shell
      // passes any of our own plates. They re-seal once that shell has cleared
      // the plate (updateShieldGates).
      for (const sh of tower.shields) { if (sh.alive) sh.open = true; }
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
    // let their own shell out (see fire + updateShieldGates). Plates stack: each
    // deploy adds another to the tower's array (capped in fire()).
    tower.shields.push({ x: cx, y: cy, ux: -d.y, uy: d.x, alive: true, open: false });
    this.pushEvent('shield', { owner: i, x: Math.round(cx), y: Math.round(cy) });
  }

  tick(dt) {
    // The living world (when enabled) advances every tick, independently of the
    // artillery phase (spec §5: artillery turn-by-turn, world in continuous
    // time). It rides on the same heightfield/craters via the world adapter.
    if (this.battlefield) { this.battlefield.step(dt); const bfe = this.battlefield.drainEvents(); for (let k = 0; k < bfe.length; k += 1) this.events.push(bfe[k]); }
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
      const piv = pivot(this.towers[i]);
      for (const sh of this.towers[i].shields) {
        if (!sh.alive || !sh.open) continue;
        const clear = Math.hypot(sh.x - piv.x, sh.y - piv.y) + SHIELD.plateHalf + SHIELD.hitRadius;
        const stillCrossing = this.projectiles.some(
          (p) => p.alive && p.owner === i && Math.hypot(p.x - piv.x, p.y - piv.y) <= clear,
        );
        if (!stillCrossing) sh.open = false;
      }
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
      const shields = this.towers[ti].shields;
      for (let si = 0; si < shields.length; si += 1) {
        const sh = shields[si];
        if (!sh.alive || sh.open) continue;
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
          shields.splice(si, 1); // 1 HP: this plate is spent (the others stand)
          this.pushEvent('shieldHit', { x: Math.round(p.x), y: Math.round(p.y), owner: ti });
          return;
        }
      }
    }

    // The central windsock is a 1-HP bounty: the shell that fells it is spent,
    // and its firing player banks a shield. Sampled along the path (like the
    // shield) so a fast shell can't tunnel the small target. Only hittable alive.
    if (this.windsock.alive) {
      let struck = false;
      for (let t = 0; t <= 1; t += 0.25) {
        const sx = x0 + (p.x - x0) * t;
        const sy = y0 + (p.y - y0) * t;
        if (Math.hypot(sx - this.windsock.x, sy - this.windsock.y) < WINDSOCK.hitRadius) { struck = true; break; }
      }
      if (struck) {
        p.alive = false;
        this.windsock.alive = false;
        this.towers[p.owner].ammo.shield += 1; // the bounty: a free shield
        this.pushEvent('windsockDown', { x: this.windsock.x, y: this.windsock.y, owner: p.owner });
        return;
      }
    }

    // The Intendant is vulnerable to the players' artillery too, not just the
    // living battlefield's own field cannon: his shield auto-parries the shell
    // (and a direct hit wounds him once it is depleted). Independent of his
    // alignment — in round 1 he is neutral, but still takes damage from anyone.
    if (this.battlefield && this.battlefield.duelShellHitsIntendant(x0, y0, p.x, p.y, p.dmg)) {
      p.alive = false;
      return;
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
          if (this.isDead(opponent)) this.decideRound();
        }
      } else {
        this.volleyDamage[p.owner] += p.dmg ?? 1;
      }
      return;
    }

    if (p.y > 0 && pointSolid(this.heights, this.craters, p.x, p.y)) {
      p.alive = false;
      const r = Math.round(p.crater ?? CRATER_RADIUS);
      // Carve the SHARED heightfield (not just a Worms crater record) so the hole
      // is real ground for the living battlefield: soldiers re-path around it and
      // the Intendant's radar crest reflects the damage. (Previously the duel only
      // pushed a crater record, leaving heights — and the pathfinder — untouched.)
      this.carveTerrain(p.x, p.y, r);
      this.pushEvent('impact', { x: p.x, y: p.y, r });
    }
  }

  // Blast a crater into the shared heightfield (lab convention: raising heights[x]
  // lowers the on-screen surface), record it, and make the living battlefield
  // soldiers replan around the new hole.
  carveTerrain(mx, my, r, vx, vy) {
    if (vx === undefined) {
      // Manual tool / duel shell: plain round bowl (unchanged).
      for (let d = -r; d <= r; d += 1) {
        const c = this.clampX(mx + d);
        const fy = my + Math.sqrt(Math.max(0, r * r - d * d));
        if (this.heights[c] < fy) this.heights[c] = Math.min(GAME_HEIGHT - 2, fy);
      }
    } else {
      // Realistic "saucer" (B10/#8): wider than deep, elongated & offset downrange
      // by the impact horizontality h=|vx|/speed (0 vertical→round, 1 grazing→ellipse),
      // with an asymmetric ejecta lip. Mirrors the lab's carveCrater.
      const sp = Math.hypot(vx, vy) || 1;
      const h = Math.min(1, Math.abs(vx) / sp);
      const sgn = Math.sign(vx) || 1;
      const depth = r * 0.6 * (1 - 0.3 * h);
      const rxF = r * (1 + 0.9 * h); const rxB = r * (1 + 0.2 * h);
      const cx = mx + sgn * r * 0.3 * h;
      const lipH = Math.min(6, depth * 0.22); const span = Math.max(3, r * 0.4);
      const x0 = Math.floor(cx - rxB - span); const x1 = Math.ceil(cx + rxF + span);
      for (let x = x0; x <= x1; x += 1) {
        const c = this.clampX(x); const dd = x - cx; const rxs = (dd * sgn >= 0) ? rxF : rxB;
        if (Math.abs(dd) <= rxs) {
          const fy = my + depth * Math.sqrt(Math.max(0, 1 - (dd / rxs) * (dd / rxs)));
          if (this.heights[c] < fy) this.heights[c] = Math.min(GAME_HEIGHT - 2, fy);
        } else {
          const over = Math.abs(dd) - rxs; const ll = (dd * sgn >= 0 ? lipH : lipH * 0.55);
          const raise = ll * Math.max(0, 1 - over / span);
          if (raise > 0.4) this.heights[c] = Math.max(2, this.heights[c] - raise);
        }
      }
    }
    this.craters.push({ x: Math.round(mx), y: Math.round(my), r });
    if (this.battlefield) this.battlefield.navVer += 1;
  }

  // A tower is out once its accumulated damage reaches the match HP.
  isDead(tower) { return tower.damage >= this.maxHp; }

  // The match is decided once a player reaches the agreed winning-round count.
  matchOver() { return Math.max(this.scores[0], this.scores[1]) >= this.winsNeeded; }

  // A player abandons mid-match (disconnect grace expired, no replacement). The
  // other duelist wins the match outright. In living-battlefield mode this also
  // razes the quitter's tower so the horde gets its final run at the ruin (the
  // Intendant's last chance to score a crossing) before the match freezes.
  forfeit(loserIdx) {
    if (this.phase === PHASE.MATCH_END) return;
    const winner = 1 - loserIdx;
    this.scores[winner] = Math.max(this.scores[winner], this.winsNeeded);
    if (this.battlefield) this.battlefield.onTowerDestroyed(loserIdx);
    this.projectiles = [];
    this.phase = PHASE.MATCH_END;
    this.pushEvent('destroyed', { tower: loserIdx });
    this.pushEvent('matchEnd', { scores: this.scores.slice() });
  }

  // Classic: settle a volley once all shells have landed.
  enterResolve() {
    const [d1, d2] = this.volleyDamage; // d1: damage dealt by player 0 to tower 1
    this.towers[1].damage += d1;
    this.towers[0].damage += d2;

    if (this.isDead(this.towers[0]) || this.isDead(this.towers[1])) {
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
    const dead0 = this.isDead(this.towers[0]);
    const dead1 = this.isDead(this.towers[1]);
    // Carry the seam height for the next arena's pan: the platform under the
    // tower that just fell. If both fell, match the TV pan, whose event order
    // ends on tower 1.
    this.lastDestroyed = dead1 ? 1 : 0;
    this.seamY = this.towers[this.lastDestroyed].groundY;
    if (dead1) this.scores[0] += 1;
    if (dead0) this.scores[1] += 1;
    // The loser of the round earns a shield (the underdog's consolation/clutch).
    if (dead0) this.towers[0].ammo.shield += 1;
    if (dead1) this.towers[1].ammo.shield += 1;
    if (dead0) this.pushEvent('destroyed', { tower: 0 });
    if (dead1) this.pushEvent('destroyed', { tower: 1 });
    // Living world: a destroyed tower resolves the round → the horde charges the
    // ruin (the Intendant scores if a soldier reaches it). The next round's
    // newTerrain rebuilds a fresh battlefield.
    if (this.battlefield) {
      if (dead0) this.battlefield.onTowerDestroyed(0);
      if (dead1) this.battlefield.onTowerDestroyed(1);
    }
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
    const decided = this.towers.some((t) => this.isDead(t));
    this.banner = '';

    if (!decided) {
      this.nextTurn();
      return;
    }

    if (this.matchOver()) {
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
    const snap = {
      phase: this.phase,
      round: { current: this.currentRound, total: this.winsNeeded }, // `total` carries the win target (first-to-N)
      wind: this.wind,
      scores: this.scores.slice(),
      seed: this.seed,
      biomeId: this.biome.id,
      banner: this.banner,
      craters: this.craters,
      windsock: { x: this.windsock.x, y: this.windsock.y, alive: this.windsock.alive },
      maxHp: this.maxHp,
      turbo: this.turbo,
      shotClock: this.shotClock == null ? null : Math.max(0, Math.round(this.shotClock * 10) / 10),
      names: this.names.slice(),
      // angle/power drive the live cannon orientation and charge tint on the
      // renderers; the exact numbers are never displayed on the TV.
      towers: this.towers.map((t) => ({
        ready: t.ready,
        x: Math.round(t.x),
        groundY: t.groundY,
        angle: t.angle,
        power: t.power,
        shell: t.shell,
        hp: Math.max(0, this.maxHp - t.damage),
        ammo: { ...t.ammo },
        shields: t.shields.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y), ux: s.ux, uy: s.uy, open: !!s.open })),
      })),
      projectiles: this.projectiles
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner, shell: p.shellId })),
    };
    // Living-world block is only present in the optional mode; legacy clients
    // never see it (so the 2-player snapshot shape is unchanged when off).
    if (this.battlefield) snap.battlefield = this.battlefield.snapshot();
    return snap;
  }
}
