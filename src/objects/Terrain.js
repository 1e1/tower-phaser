import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';
import { intToCss, craterRimColor } from '../render/visuals.js';

const STEP = 2; // sampling step in pixels for the surface polygon
let uid = 0;

// Deterministic 0..1 value from an integer, for stable decor placement.
function hash(n) {
  return ((Math.imul(n, 2654435761) >>> 0) % 100000) / 100000;
}

// Destructible landscape (Worms-style). The base surface plus baked-in surface
// decor is painted onto an offscreen 2D canvas (uploaded as a Phaser texture);
// impacts erase circular craters out of it with destination-out, removing both
// the relief and the decor. Collisions test "below the surface and outside
// every crater", so holes, caverns and overhangs appear.
export default class Terrain {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme; // { fill, edge, dark, roughness }
    this.width = GAME_WIDTH;
    this.heights = new Float32Array(GAME_WIDTH);
    this.platformWidth = 220;
    this.platformY = GAME_HEIGHT - 150;
    this.craters = [];
    this.appliedCraters = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.width = GAME_WIDTH;
    this.canvas.height = GAME_HEIGHT;
    this.ctx = this.canvas.getContext('2d');

    this.key = `terrain-${uid += 1}`;
    this.tex = scene.textures.addCanvas(this.key, this.canvas);
    this.image = scene.add.image(0, 0, this.key).setOrigin(0, 0);

    this.css = {
      fill: intToCss(theme.fill),
      edge: intToCss(theme.edge),
      dark: intToCss(theme.dark),
      rim: intToCss(craterRimColor(theme.edge)),
    };
  }

  // Local (lots 1-2) procedural generation.
  generate() {
    const { platformWidth, platformY } = this;
    const baseY = GAME_HEIGHT * 0.62;
    const rough = this.theme.roughness ?? 1;
    const waves = [
      { amp: Phaser.Math.Between(40, 90) * rough, freq: Phaser.Math.FloatBetween(1.2, 2.4), phase: Phaser.Math.FloatBetween(0, Math.PI * 2) },
      { amp: Phaser.Math.Between(20, 50) * rough, freq: Phaser.Math.FloatBetween(3.0, 5.5), phase: Phaser.Math.FloatBetween(0, Math.PI * 2) },
      { amp: Phaser.Math.Between(8, 22) * rough, freq: Phaser.Math.FloatBetween(6.0, 9.0), phase: Phaser.Math.FloatBetween(0, Math.PI * 2) },
    ];
    for (let x = 0; x < this.width; x += 1) {
      if (x <= platformWidth || x >= this.width - platformWidth) {
        this.heights[x] = platformY;
        continue;
      }
      const t = (x - platformWidth) / (this.width - 2 * platformWidth);
      let y = baseY;
      for (const w of waves) y -= w.amp * Math.sin(w.freq * Math.PI * t + w.phase);
      const edgeBlend = Math.min(1, Math.min(t, 1 - t) * 6);
      this.heights[x] = Phaser.Math.Linear(platformY, y, edgeBlend);
    }
    this.craters = [];
    this.appliedCraters = 0;
    this.drawBase();
  }

  // Spectator/TV: adopt the server's seeded heightfield and redraw.
  setHeights(heights) {
    this.heights.set(heights);
    this.craters = [];
    this.appliedCraters = 0;
    this.drawBase();
  }

  heightAt(x) {
    const i = Phaser.Math.Clamp(Math.round(x), 0, this.width - 1);
    return this.heights[i];
  }

  inCrater(x, y) {
    for (const c of this.craters) {
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy <= c.r * c.r) return true;
    }
    return false;
  }

  collides(x, y) {
    if (x < 0 || x >= this.width) return false;
    return y >= this.heightAt(x) && !this.inCrater(x, y);
  }

  // Carve a crater (local play: also feeds collision).
  carve(x, y, r) {
    this.craters.push({ x, y, r });
    this.appliedCraters = this.craters.length;
    this.eraseCrater(x, y, r);
    this.tex.refresh();
  }

  // TV: replay the authoritative crater list, erasing any not yet drawn.
  applyCraters(list) {
    if (!list || list.length === this.appliedCraters) return;
    for (let i = this.appliedCraters; i < list.length; i += 1) {
      this.craters.push(list[i]);
      this.eraseCrater(list[i].x, list[i].y, list[i].r);
    }
    this.appliedCraters = list.length;
    this.tex.refresh();
  }

  eraseCrater(x, y, r) {
    const ctx = this.ctx;
    // Darken the rim only where terrain already exists (source-atop), so the
    // scorched edge appears solely where the crater meets the ground — never as
    // a full ring floating in the open sky.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = this.css.rim;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Punch the hole through the terrain.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBase() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, GAME_HEIGHT);

    ctx.fillStyle = this.css.fill;
    ctx.beginPath();
    ctx.moveTo(0, GAME_HEIGHT);
    for (let x = 0; x < this.width; x += STEP) ctx.lineTo(x, this.heights[x]);
    ctx.lineTo(this.width, GAME_HEIGHT);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = this.css.dark;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, GAME_HEIGHT - 40, this.width, 40);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = this.css.edge;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, this.heights[0]);
    for (let x = STEP; x < this.width; x += STEP) ctx.lineTo(x, this.heights[x]);
    ctx.stroke();

    this.drawDecor();
    this.tex.refresh();
  }

  // Surface foliage/rocks, baked into the terrain so craters erase them too.
  drawDecor() {
    const ctx = this.ctx;
    const from = this.platformWidth + 12;
    const to = this.width - this.platformWidth - 12;
    for (let x = from; x < to; x += 26) {
      const h = hash(x);
      if (h < 0.45) continue;
      const sy = this.heights[x];
      const size = 5 + h * 9;
      ctx.strokeStyle = this.css.edge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let b = -1; b <= 1; b += 1) {
        ctx.moveTo(x + b * 3, sy);
        ctx.lineTo(x + b * 2, sy - size);
      }
      ctx.stroke();
      if (h > 0.82) {
        ctx.fillStyle = this.css.dark;
        ctx.beginPath();
        ctx.arc(x, sy - 3, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  destroy() {
    this.image.destroy();
    this.scene.textures.remove(this.key);
  }
}
