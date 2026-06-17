import Phaser from 'phaser';

import { COLORS, AIM } from '../config/constants.js';

const BODY_WIDTH = 64;
const BODY_HEIGHT = 96;
const BARREL_LENGTH = 52;
const BARREL_WIDTH = 12;

// A player's tower plus its aimable cannon. The tower owns its aiming state
// (angle, power, ready) and exposes the muzzle position and a hit rectangle.
export default class Tower {
  // facing: +1 fires to the right (left tower), -1 fires to the left.
  constructor(scene, x, groundY, color, facing) {
    this.scene = scene;
    this.x = x;
    this.groundY = groundY;
    this.color = color;
    this.facing = facing;

    this.angle = 45;
    this.power = 55;
    this.ready = false;

    this.pivotX = x;
    this.pivotY = groundY - BODY_HEIGHT;

    this.gfx = scene.add.graphics();
    this.draw();
  }

  get angleRad() {
    return Phaser.Math.DegToRad(this.angle);
  }

  // Barrel direction as a unit vector (y axis points down in screen space).
  get aimVector() {
    return {
      x: this.facing * Math.cos(this.angleRad),
      y: -Math.sin(this.angleRad),
    };
  }

  get muzzle() {
    const v = this.aimVector;
    return {
      x: this.pivotX + v.x * BARREL_LENGTH,
      y: this.pivotY + v.y * BARREL_LENGTH,
    };
  }

  // Axis-aligned hit box for the tower body.
  get bounds() {
    return new Phaser.Geom.Rectangle(
      this.pivotX - BODY_WIDTH / 2,
      this.pivotY,
      BODY_WIDTH,
      BODY_HEIGHT,
    );
  }

  adjustAngle(delta) {
    this.angle = Phaser.Math.Clamp(this.angle + delta, AIM.minAngle, AIM.maxAngle);
  }

  adjustPower(delta) {
    this.power = Phaser.Math.Clamp(this.power + delta, AIM.minPower, AIM.maxPower);
  }

  reset() {
    this.ready = false;
  }

  draw() {
    const g = this.gfx;
    g.clear();

    const b = this.bounds;

    // Body.
    g.fillStyle(this.color, 1);
    g.fillRoundedRect(b.x, b.y, b.width, b.height, 8);
    // Battlements on top.
    g.fillStyle(this.color, 1);
    for (let i = 0; i < 3; i += 1) {
      g.fillRect(b.x + 4 + i * 22, b.y - 12, 14, 14);
    }
    // Darker base shadow.
    g.fillStyle(0x000000, 0.18);
    g.fillRect(b.x, b.y + b.height - 14, b.width, 14);

    // Barrel.
    const v = this.aimVector;
    const angle = Math.atan2(v.y, v.x);
    g.save();
    g.translateCanvas(this.pivotX, this.pivotY);
    g.rotateCanvas(angle);
    g.fillStyle(COLORS.barrel, 1);
    g.fillRoundedRect(0, -BARREL_WIDTH / 2, BARREL_LENGTH, BARREL_WIDTH, 4);
    g.restore();

    // Pivot hub.
    g.fillStyle(COLORS.barrel, 1);
    g.fillCircle(this.pivotX, this.pivotY, 11);
  }

  destroy() {
    this.gfx.destroy();
  }
}
