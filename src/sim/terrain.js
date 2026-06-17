import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';
import { rng } from './rng.js';

// Deterministic terrain heightfield. Given the same seed and roughness, the
// server and every client produce an identical surface, so collisions resolved
// on the server always match what the TV draws.

export const TERRAIN = {
  width: GAME_WIDTH,
  platformWidth: 220,
  platformY: GAME_HEIGHT - 150,
};

export function generateHeights(seed, roughness = 1) {
  const r = rng(seed);
  const { width, platformWidth, platformY } = TERRAIN;
  const heights = new Float32Array(width);
  const baseY = GAME_HEIGHT * 0.62;
  const TWO_PI = Math.PI * 2;

  const waves = [
    { amp: r.int(40, 90) * roughness, freq: r.float(1.2, 2.4), phase: r.float(0, TWO_PI) },
    { amp: r.int(20, 50) * roughness, freq: r.float(3.0, 5.5), phase: r.float(0, TWO_PI) },
    { amp: r.int(8, 22) * roughness, freq: r.float(6.0, 9.0), phase: r.float(0, TWO_PI) },
  ];

  for (let x = 0; x < width; x += 1) {
    if (x <= platformWidth || x >= width - platformWidth) {
      heights[x] = platformY;
      continue;
    }
    const t = (x - platformWidth) / (width - 2 * platformWidth);
    let y = baseY;
    for (const w of waves) {
      y -= w.amp * Math.sin(w.freq * Math.PI * t + w.phase);
    }
    const edgeBlend = Math.min(1, Math.min(t, 1 - t) * 6);
    heights[x] = platformY + (y - platformY) * edgeBlend;
  }

  return heights;
}

export function heightAt(heights, x) {
  const i = Math.max(0, Math.min(heights.length - 1, Math.round(x)));
  return heights[i];
}

export function collides(heights, x, y) {
  if (x < 0 || x >= heights.length) return false;
  return y >= heightAt(heights, x);
}
