import Phaser from 'phaser';

import { COLORS, AIM } from '../config/constants.js';
import { barrelColor, shade } from '../render/visuals.js';

const BODY_WIDTH = 64;
const BODY_HEIGHT = 96;
const BARREL_LENGTH = 52;
const BARREL_WIDTH = 8; // slimmer cannon
const ROW_H = 16; // stone course height
const BLOCK_W = 22; // stone block width

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
    this.hp = 1;
    this.maxHp = 1;

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

  // Tip of the fuse at the breech (where the ready spark sits).
  get fuseTip() {
    return { x: this.pivotX - this.facing * 9, y: this.pivotY - 17 };
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
    const mortar = shade(this.color, 0.6);
    const lit = shade(this.color, 1.16);
    const dark = shade(this.color, 0.78);

    // Stone body.
    g.fillStyle(this.color, 1);
    g.fillRoundedRect(b.x, b.y, b.width, b.height, 6);

    // Masonry: courses of offset blocks (running bond) drawn as mortar joints.
    g.lineStyle(2, mortar, 1);
    const rows = Math.ceil(b.height / ROW_H);
    for (let r = 0; r < rows; r += 1) {
      const y = b.y + r * ROW_H;
      if (r > 0) {
        g.beginPath();
        g.moveTo(b.x, y);
        g.lineTo(b.x + b.width, y);
        g.strokePath();
      }
      const offset = (r % 2) * (BLOCK_W / 2);
      for (let x = b.x + offset; x < b.x + b.width - 1; x += BLOCK_W) {
        if (x <= b.x) continue;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, Math.min(y + ROW_H, b.y + b.height));
        g.strokePath();
      }
    }
    // Soft top highlight and base shadow for relief.
    g.fillStyle(lit, 0.5);
    g.fillRect(b.x, b.y, b.width, 4);
    g.fillStyle(0x000000, 0.18);
    g.fillRect(b.x, b.y + b.height - 12, b.width, 12);

    // Damage fraction (only meaningful when maxHp > 1).
    const dmg = this.maxHp > 1 ? 1 - this.hp / this.maxHp : 0;

    // Crenellated top (merlons) — knocked off as damage rises.
    const knocked = Math.round(dmg * 3);
    for (let i = 0; i < 3; i += 1) {
      if (i < knocked) continue; // this merlon is rubble
      g.fillStyle(dark, 1);
      g.fillRect(b.x + 3 + i * 22, b.y - 13, 15, 15);
      g.lineStyle(2, mortar, 1);
      g.strokeRect(b.x + 3 + i * 22, b.y - 13, 15, 15);
    }

    if (dmg > 0) this.drawDamage(g, b, dmg, mortar);

    // Slim barrel.
    const v = this.aimVector;
    const angle = Math.atan2(v.y, v.x);
    g.save();
    g.translateCanvas(this.pivotX, this.pivotY);
    g.rotateCanvas(angle);
    g.fillStyle(barrelColor(this.power), 1);
    g.fillRoundedRect(0, -BARREL_WIDTH / 2, BARREL_LENGTH, BARREL_WIDTH, 3);
    g.fillStyle(0x000000, 0.16); // muzzle opening
    g.fillCircle(BARREL_LENGTH, 0, BARREL_WIDTH / 2);
    g.restore();

    // Pivot hub (a darker stone mount).
    g.fillStyle(shade(COLORS.barrel, 0.9), 1);
    g.fillCircle(this.pivotX, this.pivotY, 9);

    // Fuse (wick) at the breech, lit when the player is ready.
    const ft = this.fuseTip;
    g.lineStyle(3, 0x3a2a1a, 1);
    g.beginPath();
    g.moveTo(this.pivotX - this.facing * 3, this.pivotY - 5);
    g.lineTo(this.pivotX - this.facing * 9, this.pivotY - 9);
    g.lineTo(ft.x, ft.y);
    g.strokePath();
    if (this.ready) {
      g.fillStyle(0xff8c2a, 1);
      g.fillCircle(ft.x, ft.y, 4);
      g.fillStyle(0xffe680, 1);
      g.fillCircle(ft.x, ft.y, 2);
    }
  }

  // Cracks and edge chips that grow with the damage fraction (0..1).
  drawDamage(g, b, dmg, mortar) {
    const cracks = Math.ceil(dmg * 3);
    g.lineStyle(2, 0x1a1320, 0.8);
    for (let i = 0; i < cracks; i += 1) {
      // Deterministic positions so the same damage always looks the same.
      const sx = b.x + ((i * 23 + 12) % b.width);
      let x = sx;
      let y = b.y + 2;
      g.beginPath();
      g.moveTo(x, y);
      const segs = 4;
      for (let s = 0; s < segs; s += 1) {
        x += ((i + s) % 2 ? 7 : -6);
        y += (b.height - 6) / segs;
        g.lineTo(x, y);
      }
      g.strokePath();
    }
    // A chipped corner when badly hurt.
    if (dmg > 0.5) {
      g.fillStyle(0x000000, 0.22);
      const cx = this.facing > 0 ? b.x + b.width - 12 : b.x;
      g.fillTriangle(cx, b.y, cx + 12, b.y, cx + (this.facing > 0 ? 12 : 0), b.y + 14);
    }
  }

  destroy() {
    this.gfx.destroy();
  }
}
