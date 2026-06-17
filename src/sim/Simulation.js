import { GAME_WIDTH, GAME_HEIGHT, AIM, PHYSICS, MAX_WIND, CRATER_RADIUS, AIM_NOISE } from '../config/constants.js';
import { generateHeights, heightAt, pointSolid } from './terrain.js';
import { aimVector, muzzle, bounds, rectContains } from './geometry.js';
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

// Special shells are rationed (normal is unlimited): one of each to start, +1
// of every special each round, and +1 of a type whenever it hits your tower.
const SPECIALS = ['heavy', 'light', 'salvo', 'explosive'];
const initAmmo = () => ({ heavy: 1, light: 1, salvo: 1, explosive: 1 });

export default class Simulation {
  constructor({ names, totalRounds, biome, maxHp = 1, random = Math.random }) {
    this.random = random;
    this.names = names;
    this.totalRounds = totalRounds;
    this.biome = biome;
    this.maxHp = maxHp;
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
      { x: 120, facing: 1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo() },
      { x: GAME_WIDTH - 120, facing: -1, groundY: 0, angle: 45, power: 55, ready: false, shell: 'normal', damage: 0, ammo: initAmmo() },
    ];

    this.seed = 0;
    this.heights = new Float32Array(GAME_WIDTH);
    this.wind = 0;
  }

  randInt(min, max) {
    return Math.floor(min + this.random() * (max - min + 1));
  }

  // --- lifecycle -----------------------------------------------------------

  start() {
    this.phase = PHASE.AIMING;
    this.newTerrain();
    this.randomizeWind();
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
    }
  }

  randomizeWind() {
    const magnitude = this.randInt(0, MAX_WIND);
    const sign = this.random() < 0.5 ? -1 : 1;
    this.wind = magnitude * sign;
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
    }
  }

  // --- combat --------------------------------------------------------------

  fire() {
    this.projectiles = [];
    this.towers.forEach((tower, i) => {
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
        const speed = power * PHYSICS.speedScale;
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
    });
    this.volleyDamage = [0, 0];
    this.phase = PHASE.FIRING;
  }

  tick(dt) {
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
    }
  }

  stepProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.vx += this.wind * (p.windFactor ?? 1) * dt;
      p.vy += PHYSICS.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.elapsed += dt;
      this.checkCollision(p);
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
    if (rectContains(bounds(opponent), p.x, p.y)) {
      p.alive = false;
      this.volleyDamage[p.owner] += p.dmg ?? 1;
      // The struck player gains a round of the shell that just hit them.
      if (p.shellId && p.shellId !== 'normal') {
        opponent.ammo[p.shellId] = (opponent.ammo[p.shellId] || 0) + 1;
      }
      this.pushEvent('hit', { x: p.x, y: p.y, owner: p.owner, target: targetIdx, shell: p.shellId });
      return;
    }

    if (p.y > 0 && pointSolid(this.heights, this.craters, p.x, p.y)) {
      p.alive = false;
      const r = Math.round(p.crater ?? CRATER_RADIUS);
      this.craters.push({ x: Math.round(p.x), y: Math.round(p.y), r });
      this.pushEvent('impact', { x: p.x, y: p.y, r });
    }
  }

  enterResolve() {
    const [d1, d2] = this.volleyDamage; // d1: damage dealt by player 0 to tower 1
    this.phase = PHASE.RESOLVING;

    // Accumulate this volley's damage (fractional, e.g. salvo = 0.5/shell).
    this.towers[1].damage += d1;
    this.towers[0].damage += d2;
    const dead0 = this.towers[0].damage >= this.maxHp;
    const dead1 = this.towers[1].damage >= this.maxHp;

    if (dead0 || dead1) {
      if (dead1) this.scores[0] += 1;
      if (dead0) this.scores[1] += 1;
      this.roundsPlayed += 1;
      if (dead0) this.pushEvent('destroyed', { tower: 0 });
      if (dead1) this.pushEvent('destroyed', { tower: 1 });
      if (dead0 && dead1) this.banner = 'Both towers fall!';
      else if (dead1) this.banner = `${this.names[0]} scores!`;
      else this.banner = `${this.names[1]} scores!`;
      this.resolveTimer = RESOLVE_HIT_DELAY;
      this.pushEvent('turnEnd', { decided: true, scores: this.scores.slice() });
      return;
    }

    // Round continues: a hit only chipped some HP, or both missed.
    this.banner = d1 || d2 ? 'Direct hit!' : 'Both missed!';
    this.resolveTimer = RESOLVE_MISS_DELAY;
    this.pushEvent('turnEnd', { decided: false });
  }

  applyResolution() {
    const decided = this.towers.some((t) => t.damage >= this.maxHp);
    this.banner = '';

    if (!decided) {
      this.nextTurn();
      return;
    }

    if (this.roundsPlayed >= this.totalRounds) {
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
    this.randomizeWind();
    this.resetReady();
    this.projectiles = [];
    this.volleyDamage = [0, 0];
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
      round: { current: this.currentRound, total: this.totalRounds },
      wind: this.wind,
      scores: this.scores.slice(),
      seed: this.seed,
      biomeId: this.biome.id,
      banner: this.banner,
      craters: this.craters,
      maxHp: this.maxHp,
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
      })),
      projectiles: this.projectiles
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner })),
    };
  }
}
