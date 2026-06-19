import Phaser from 'phaser';

import { AIM } from '../config/constants.js';
import { TOWER } from '../sim/geometry.js';
import { barrelHeat, BARREL_COOL, pivotCharge, shade, towerPalette } from '../render/visuals.js';

// Deterministic [0,1) hash so rubble and broken stubs stay put across frames
// (the tower is redrawn every frame; jittered debris must not twitch).
function hash(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

// Body size mirrors the authoritative collision box so the drawing matches the
// hit test exactly (geometry.js is the single source — see TOWER there).
const BODY_WIDTH = TOWER.bodyWidth;
const BODY_HEIGHT = TOWER.bodyHeight;
const BARREL_LENGTH = TOWER.barrelLength;
const BARREL_WIDTH = 8; // slimmer cannon (render-only; collision ignores the barrel)
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
    const { mortar, lit, dark } = towerPalette(this.color);

    // A toppled tower reads as a heap of stone on the ground — no body, no
    // cannon. Drawn as a ruin so a destroyed tower leaves rubble behind instead
    // of sinking and fading out of existence.
    if (this.hp <= 0) { this.drawRuin(g, b, mortar); return; }

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

    // Sally-port at the foot — now ALWAYS present (was living-battlefield only),
    // fitted with an animated portcullis (herse) that slowly raises and lowers.
    {
      const dw = b.width * 0.34;
      const dh = Math.min(b.height * 0.4, dw * 1.3);
      const dx = b.x + (b.width - dw) / 2;
      const dy = b.y + b.height - dh;
      const rad = { tl: dw / 2, tr: dw / 2, bl: 0, br: 0 };
      g.fillStyle(0x120d0a, 0.92);
      g.fillRoundedRect(dx, dy, dw, dh, rad);
      // Portcullis: lowered (closed, 0) in classic duel, raised (open, 1) in
      // living battlefield. Eased toward the mode target so the grille only
      // ANIMATES when the mode toggles, and is otherwise still.
      const herseTarget = this.scene.cfgLivingBattlefield ? 1 : 0;
      if (this.herseOpen == null) this.herseOpen = herseTarget;
      else this.herseOpen += (herseTarget - this.herseOpen) * 0.12;
      const open = this.herseOpen;
      const gh = dh * (1 - open);
      if (gh > 2) {
        const inset = dw * 0.14;
        const gx0 = dx + inset; const gx1 = dx + dw - inset;
        const gTop = dy + dw * 0.32;            // start just below the arch
        const gBot = Math.min(dy + dh - 1, gTop + gh);
        g.lineStyle(Math.max(1, b.width * 0.018), 0x6b7180, 0.9);
        for (let i = 0; i <= 4; i += 1) { const gx = gx0 + (gx1 - gx0) * (i / 4); g.lineBetween(gx, gTop, gx, gBot); }
        for (let i = 0; i <= 3; i += 1) { const gy = gTop + (gBot - gTop) * (i / 3); g.lineBetween(gx0, gy, gx1, gy); }
      }
      g.lineStyle(Math.max(1.5, b.width * 0.03), mortar, 1);
      g.strokeRoundedRect(dx, dy, dw, dh, rad);
    }

    // Arrow-slit (meurtrière): a slim dark loophole on the body, offset toward
    // the tower's facing — the musketry port from the validated lab tower
    // (battlefield-lab.html:456, a 4×16 slit on a 56×96 body). Always drawn, like
    // the merlons; it's part of the tower silhouette, not a living-mode feature.
    const slitW = Math.max(3, b.width * (4 / 56));
    const slitH = b.height * (16 / 96);
    const slitX = b.x + b.width / 2 + this.facing * (b.width * (16 / 56)) - slitW / 2;
    const slitY = b.y + b.height * (20 / 96);
    g.fillStyle(0x08060c, 1);
    g.fillRect(slitX, slitY, slitW, slitH);

    // Damage fraction (only meaningful when maxHp > 1).
    const dmg = this.maxHp > 1 ? 1 - this.hp / this.maxHp : 0;

    // Crenellated top (merlons). Spaced like the controller view (a full merlon
    // width between each) so every merlon reads as distinct on the battlefield
    // instead of merging into one solid band. A merlon knocked off by damage
    // leaves a jagged broken stub rather than a clean gap, so the parapet
    // visibly crumbles from the very first hit.
    const knocked = Math.round(dmg * 3);
    const merlonW = (b.width - 10) / 5;
    for (let i = 0; i < 3; i += 1) {
      const mx = b.x + 5 + i * merlonW * 2;
      const mh = i < knocked ? 4 + hash(i * 7 + 1) * 4 : 16;
      g.fillStyle(dark, 1);
      g.fillRect(mx, b.y - mh, merlonW, mh + 2);
      g.lineStyle(2, mortar, 1);
      g.strokeRect(mx, b.y - mh, merlonW, mh + 2);
    }

    if (dmg > 0) {
      this.drawBreaches(g, b, dmg);
      this.drawBaseRubble(g, b, dmg, mortar);
      this.drawDamage(g, b, dmg, mortar);
    }

    // Slim barrel: cool iron at the muzzle easing to a heat-glow at the breech
    // (amber→white-hot at full charge). Camp-neutral — never red.
    const v = this.aimVector;
    const angle = Math.atan2(v.y, v.x);
    g.save();
    g.translateCanvas(this.pivotX, this.pivotY);
    g.rotateCanvas(angle);
    const breech = barrelHeat(this.power);
    // Horizontal gradient along the barrel: hot at x=0 (breech), cool at muzzle.
    g.fillGradientStyle(breech, BARREL_COOL, breech, BARREL_COOL, 1);
    g.fillRoundedRect(0, -BARREL_WIDTH / 2, BARREL_LENGTH, BARREL_WIDTH, 3);
    g.fillStyle(0x000000, 0.16); // muzzle opening (unchanged)
    g.fillCircle(BARREL_LENGTH, 0, BARREL_WIDTH / 2);
    g.restore();

    // Pivot = powder reserve: a relief hub whose core darkens as it packs with
    // powder, ringed by a gauge that fills (amber→white) with charge.
    const pc = pivotCharge(this.power);
    const px = this.pivotX;
    const py = this.pivotY;
    // Breech heat glow — soft alpha discs (Graphics has no radial gradient).
    if (pc.fill > 0.02) {
      g.fillStyle(pc.gauge, 0.22 * pc.fill);
      g.fillCircle(px, py, 9 + 8 * pc.fill);
      g.fillStyle(pc.gauge, 0.18 * pc.fill);
      g.fillCircle(px, py, 9 + 4 * pc.fill);
    }
    // Hub: lit rim then a darkening packed core for relief.
    g.fillStyle(pc.rim, 1);
    g.fillCircle(px, py, 9);
    g.fillStyle(pc.core, 1);
    g.fillCircle(px, py, 7.5);
    // Powder gauge ring, filling clockwise from the top.
    g.lineStyle(3, 0x000000, 0.35);
    g.beginPath();
    g.arc(px, py, 12, 0, Math.PI * 2);
    g.strokePath();
    if (pc.fill > 0.01) {
      g.lineStyle(3, pc.gauge, 1);
      g.beginPath();
      const start = -Math.PI / 2;
      g.arc(px, py, 12, start, start + pc.fill * Math.PI * 2);
      g.strokePath();
    }

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

  // Dark missing-block holes punched into the upper body, growing with damage.
  drawBreaches(g, b, dmg) {
    const n = Math.floor(dmg * 4);
    g.fillStyle(0x0a0810, 0.82);
    for (let i = 0; i < n; i += 1) {
      const hx = b.x + 8 + ((i * 27 + 6) % Math.max(1, b.width - 24));
      const hy = b.y + 4 + hash(i * 5 + 2) * (b.height * 0.4);
      g.fillRect(hx, hy, 16, 12);
    }
  }

  // Fallen stones heaping at the foot as the tower takes damage — the rubble
  // grows wider and denser the closer it is to collapse.
  drawBaseRubble(g, b, dmg, mortar) {
    const cx = b.x + b.width / 2;
    const baseY = b.y + b.height;
    const n = Math.round(dmg * 5);
    for (let i = 0; i < n; i += 1) {
      const dx = (hash(i * 5 + 3) - 0.5) * b.width * (0.9 + dmg);
      const s = 6 + hash(i * 3 + 1) * 8;
      this.rock(g, cx + dx, baseY - s * 0.3, s, (hash(i * 7) - 0.5) * 0.8, i + 40, mortar);
    }
  }

  // The destroyed tower: a low, irregular mound of stone across the foot, heaped
  // higher in the middle. Deterministic so the ruin sits still.
  drawRuin(g, b, mortar) {
    const cx = b.x + b.width / 2;
    const baseY = b.y + b.height;
    const spread = b.width * 1.5;
    for (let i = 0; i < 18; i += 1) {
      const dx = (hash(i * 5 + 1) - 0.5) * spread;
      const s = 8 + hash(i * 3 + 2) * 12;
      const heap = Math.max(0, 1 - Math.abs(dx) / (spread * 0.55));
      const y = baseY - heap * 30 * hash(i * 9 + 3) - s * 0.3;
      this.rock(g, cx + dx, y, s, (hash(i * 11) - 0.5) * 0.9, i, mortar);
    }
  }

  // An irregular stone chunk (pentagon), tinted from the camp colour and outlined
  // in mortar so it reads as masonry rubble.
  rock(g, x, y, s, rot, seed, mortar) {
    const pts = [];
    for (let k = 0; k < 5; k += 1) {
      const ang = (k / 5) * Math.PI * 2 + rot;
      const rr = s * (0.55 + hash(seed * 9 + k * 3.1) * 0.5);
      pts.push({ x: x + Math.cos(ang) * rr, y: y + Math.sin(ang) * rr * 0.78 });
    }
    g.fillStyle(shade(this.color, 0.62 + hash(seed * 3) * 0.26), 1);
    g.fillPoints(pts, true);
    g.lineStyle(1.5, mortar, 0.9);
    g.strokePoints(pts, true);
  }

  destroy() {
    this.gfx.destroy();
  }
}
