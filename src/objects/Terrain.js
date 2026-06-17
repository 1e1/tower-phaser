import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';

const STEP = 2; // sampling step in pixels for drawing the surface polygon

// Procedural mid-screen landscape with flat edge platforms for the towers.
// Heights are stored per pixel column so collision queries stay simple and so
// Lot 4 can later carve craters into the same array. Colours come from the
// active biome theme.
export default class Terrain {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme; // { fill, edge, dark, roughness }
    this.width = GAME_WIDTH;
    this.heights = new Float32Array(GAME_WIDTH);
    this.platformWidth = 220;
    this.platformY = GAME_HEIGHT - 150;
    this.gfx = scene.add.graphics();
  }

  // Build a fresh landscape. Called once per round so each round looks new.
  generate() {
    const { platformWidth, platformY } = this;
    const baseY = GAME_HEIGHT * 0.62;
    const rough = this.theme.roughness ?? 1;

    // A few sine components plus jitter make rolling, varied hills. The biome
    // roughness scales the amplitudes so deserts/volcanoes feel craggier.
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
      const t = (x - platformWidth) / (this.width - 2 * platformWidth); // 0..1
      let y = baseY;
      for (const w of waves) {
        y -= w.amp * Math.sin(w.freq * Math.PI * t + w.phase);
      }
      // Blend smoothly into the platforms at both edges.
      const edgeBlend = Math.min(1, Math.min(t, 1 - t) * 6);
      this.heights[x] = Phaser.Math.Linear(platformY, y, edgeBlend);
    }

    this.draw();
  }

  // Surface height (top of the ground) at a given column.
  heightAt(x) {
    const clamped = Phaser.Math.Clamp(Math.round(x), 0, this.width - 1);
    return this.heights[clamped];
  }

  // True when a point sits at or below the ground surface.
  collides(x, y) {
    if (x < 0 || x >= this.width) return false;
    return y >= this.heightAt(x);
  }

  draw() {
    const g = this.gfx;
    g.clear();

    g.fillStyle(this.theme.fill, 1);
    g.beginPath();
    g.moveTo(0, GAME_HEIGHT);
    for (let x = 0; x < this.width; x += STEP) {
      g.lineTo(x, this.heights[x]);
    }
    g.lineTo(this.width - 1, this.heights[this.width - 1]);
    g.lineTo(this.width, GAME_HEIGHT);
    g.closePath();
    g.fillPath();

    // Darker band beneath the surface for a bit of depth.
    g.fillStyle(this.theme.dark, 0.35);
    g.fillRect(0, GAME_HEIGHT - 40, this.width, 40);

    // Bright surface line (grass/snow/sand crest).
    g.lineStyle(4, this.theme.edge, 1);
    g.beginPath();
    g.moveTo(0, this.heights[0]);
    for (let x = STEP; x < this.width; x += STEP) {
      g.lineTo(x, this.heights[x]);
    }
    g.strokePath();
  }

  destroy() {
    this.gfx.destroy();
  }
}
