import { PHYSICS } from '../config/constants.js';

const TRAIL_LENGTH = 22;

// A single shell in flight. Integration is done manually each frame so wind and
// gravity stay fully under the game's control (no physics engine needed).
export default class Projectile {
  constructor(x, y, vx, vy, owner) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.owner = owner; // index of the firing player (0 or 1)
    this.alive = true;
    this.elapsed = 0;
    this.trail = [];
  }

  // Advance one step. windAccel is the horizontal acceleration from the wind.
  update(dt, windAccel) {
    if (!this.alive) return;

    this.vx += windAccel * dt;
    this.vy += PHYSICS.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.elapsed += dt;

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > TRAIL_LENGTH) {
      this.trail.shift();
    }

    if (this.elapsed > PHYSICS.maxFlightTime) {
      this.alive = false;
    }
  }
}
