import Phaser from 'phaser';

import { MAX_WIND } from '../config/constants.js';

// Horizontal wind that changes every turn. Positive blows to the right.
export default class Wind {
  constructor() {
    this.value = 0;
    this.randomize();
  }

  randomize() {
    // Bias slightly away from dead calm so the wind matters most turns.
    const magnitude = Phaser.Math.Between(0, MAX_WIND);
    const sign = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    this.value = magnitude * sign;
  }

  // Acceleration applied to projectiles (px/s^2).
  get acceleration() {
    return this.value;
  }
}
