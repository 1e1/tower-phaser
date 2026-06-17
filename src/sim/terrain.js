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

// `opts` carries the per-round arena shape (all optional, defaulting to a flat
// symmetric arena so legacy callers keep working):
//   leftY / rightY  — height of the left/right flat platform (the tower stands on
//                     it). When they differ the whole relief tilts between them.
//   centralRise     — height of a smooth central massif that can block low, flat
//                     shots and force high lobs.
export function generateHeights(seed, roughness = 1, opts = {}) {
  const r = rng(seed);
  const { width, platformWidth, platformY } = TERRAIN;
  const leftY = opts.leftY ?? platformY;
  const rightY = opts.rightY ?? platformY;
  const centralRise = opts.centralRise ?? 0;
  const heights = new Float32Array(width);
  // The base relief sits this far ABOVE the platform line; kept as an offset so
  // the hills keep their proportions when the platforms move up or down.
  const baseOffset = platformY - GAME_HEIGHT * 0.62;
  const TWO_PI = Math.PI * 2;

  const waves = [
    { amp: r.int(40, 90) * roughness, freq: r.float(1.2, 2.4), phase: r.float(0, TWO_PI) },
    { amp: r.int(20, 50) * roughness, freq: r.float(3.0, 5.5), phase: r.float(0, TWO_PI) },
    { amp: r.int(8, 22) * roughness, freq: r.float(6.0, 9.0), phase: r.float(0, TWO_PI) },
  ];

  for (let x = 0; x < width; x += 1) {
    if (x <= platformWidth) { heights[x] = leftY; continue; }
    if (x >= width - platformWidth) { heights[x] = rightY; continue; }
    const t = (x - platformWidth) / (width - 2 * platformWidth);
    // The platform line, linearly interpolated across the span: the relief and
    // the edge blend both ride on it, so the join to each (possibly different)
    // platform stays continuous.
    const plat = leftY + (rightY - leftY) * t;
    let y = plat - baseOffset;
    for (const w of waves) {
      y -= w.amp * Math.sin(w.freq * Math.PI * t + w.phase);
    }
    if (centralRise) {
      const d = (t - 0.5) / 0.2;
      y -= centralRise * Math.exp(-d * d); // smooth central hump (Gaussian)
    }
    const edgeBlend = Math.min(1, Math.min(t, 1 - t) * 6);
    heights[x] = plat + (y - plat) * edgeBlend;
  }

  return heights;
}

export function heightAt(heights, x) {
  const i = Math.max(0, Math.min(heights.length - 1, Math.round(x)));
  return heights[i];
}

// True when (x, y) sits inside any carved crater.
export function inCrater(craters, x, y) {
  for (const c of craters) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= c.r * c.r) return true;
  }
  return false;
}

// Worms-style solidity: ground exists below the surface, minus any craters.
// A crater fully below the surface leaves the material above it intact, so
// caverns and overhangs are possible.
export function pointSolid(heights, craters, x, y) {
  if (x < 0 || x >= heights.length) return false;
  if (y < heightAt(heights, x)) return false;
  return !inCrater(craters, x, y);
}
