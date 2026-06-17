import { GAME_WIDTH, GAME_HEIGHT, AIM, PHYSICS, MAX_WIND } from '../config/constants.js';
import { generateHeights, heightAt, collides } from './terrain.js';
import { aimVector, muzzle, bounds, rectContains } from './geometry.js';

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

export default class Simulation {
  constructor({ names, totalRounds, biome, random = Math.random }) {
    this.random = random;
    this.names = names;
    this.totalRounds = totalRounds;
    this.biome = biome;
    this.roughness = biome.roughness ?? 1;

    this.scores = [0, 0];
    this.roundsPlayed = 0;
    this.currentRound = 1;
    this.phase = PHASE.LOBBY;
    this.projectileSeq = 0;
    this.projectiles = [];
    this.turnHits = [false, false];
    this.events = [];
    this.resolveTimer = 0;
    this.banner = '';

    this.towers = [
      { x: 120, facing: 1, groundY: 0, angle: 45, power: 55, ready: false },
      { x: GAME_WIDTH - 120, facing: -1, groundY: 0, angle: 45, power: 55, ready: false },
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
    for (const t of this.towers) {
      t.groundY = heightAt(this.heights, t.x);
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
    this.projectiles = this.towers.map((tower, i) => {
      const v = aimVector(tower.angle, tower.facing);
      const speed = tower.power * PHYSICS.speedScale;
      const m = muzzle(tower);
      this.pushEvent('fire', { owner: i, x: m.x, y: m.y, angle: tower.angle });
      this.projectileSeq += 1;
      return {
        id: this.projectileSeq,
        x: m.x,
        y: m.y,
        vx: v.x * speed,
        vy: v.y * speed,
        owner: i,
        alive: true,
        elapsed: 0,
      };
    });
    this.turnHits = [false, false];
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
      p.vx += this.wind * dt;
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

    const opponent = this.towers[p.owner === 0 ? 1 : 0];
    if (rectContains(bounds(opponent), p.x, p.y)) {
      p.alive = false;
      this.turnHits[p.owner] = true;
      this.pushEvent('hit', { x: p.x, y: p.y, owner: p.owner, target: p.owner === 0 ? 1 : 0 });
      return;
    }

    if (p.y > 0 && collides(this.heights, p.x, p.y)) {
      p.alive = false;
      this.pushEvent('impact', { x: p.x, y: p.y });
    }
  }

  enterResolve() {
    const [h1, h2] = this.turnHits;
    this.phase = PHASE.RESOLVING;

    if (!h1 && !h2) {
      this.banner = 'Both missed!';
      this.resolveTimer = RESOLVE_MISS_DELAY;
      this.pushEvent('turnEnd', { miss: true });
      return;
    }

    if (h1) this.scores[0] += 1;
    if (h2) this.scores[1] += 1;
    this.roundsPlayed += 1;

    if (h1 && h2) this.banner = 'Double hit!';
    else if (h1) this.banner = `${this.names[0]} scores!`;
    else this.banner = `${this.names[1]} scores!`;

    this.resolveTimer = RESOLVE_HIT_DELAY;
    this.pushEvent('turnEnd', { miss: false, scores: this.scores.slice() });
  }

  applyResolution() {
    const decided = this.turnHits.some(Boolean);
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
    this.newTerrain();
    this.pushEvent('roundStart', { round: this.currentRound });
    this.nextTurn();
  }

  nextTurn() {
    this.randomizeWind();
    this.resetReady();
    this.projectiles = [];
    this.turnHits = [false, false];
    this.phase = PHASE.AIMING;
  }

  // End the match immediately, awarding it to the given player (used when an
  // opponent leaves mid-match with nobody waiting to take over).
  forceEnd(winner) {
    if (winner === 0) this.scores[0] = Math.max(this.scores[0], this.scores[1] + 1);
    else if (winner === 1) this.scores[1] = Math.max(this.scores[1], this.scores[0] + 1);
    this.projectiles = [];
    this.phase = PHASE.MATCH_END;
    this.pushEvent('matchEnd', { scores: this.scores.slice() });
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
      names: this.names.slice(),
      // angle/power drive the live cannon orientation and charge tint on the
      // renderers; the exact numbers are never displayed on the TV.
      towers: this.towers.map((t) => ({
        ready: t.ready,
        groundY: t.groundY,
        angle: t.angle,
        power: t.power,
      })),
      projectiles: this.projectiles
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), owner: p.owner })),
    };
  }
}
