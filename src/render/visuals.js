import { AIM, MAX_WIND } from '../config/constants.js';

// Shared, renderer-agnostic visual helpers used by both the Phaser views (TV)
// and the plain-canvas controller mini-view, so the cannon, charge tint and
// windsock look identical everywhere.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function intToCss(c) {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

// Multiply an RGB colour's brightness (factor < 1 darkens, > 1 lightens).
export function shade(color, factor) {
  const r = clamp(Math.round(((color >> 16) & 0xff) * factor), 0, 255);
  const g = clamp(Math.round(((color >> 8) & 0xff) * factor), 0, 255);
  const b = clamp(Math.round((color & 0xff) * factor), 0, 255);
  return (r << 16) | (g << 8) | b;
}

// Tower stone palette derived from the side colour — mortar (dark fill), lit
// (highlit course) and dark (shadow). Centralised so the battlefield tower, the
// controller glyph and the shared tower-top renderer all read identically.
export function towerPalette(color) {
  return { mortar: shade(color, 0.6), lit: shade(color, 1.16), dark: shade(color, 0.78) };
}

export function powerRatio(power) {
  return clamp((power - AIM.minPower) / (AIM.maxPower - AIM.minPower), 0, 1);
}

// Crater edge colour: the biome's relief line shifted toward dark brown, so the
// scorched rim reads as disturbed earth rather than a hard black ring.
const DARK_BROWN = { r: 0x3a, g: 0x29, b: 0x18 };
export function craterRimColor(edge) {
  const t = 0.6;
  const r = Math.round(lerp((edge >> 16) & 0xff, DARK_BROWN.r, t));
  const g = Math.round(lerp((edge >> 8) & 0xff, DARK_BROWN.g, t));
  const b = Math.round(lerp(edge & 0xff, DARK_BROWN.b, t));
  return (r << 16) | (g << 8) | b;
}

// --- Forge cannon model -----------------------------------------------------
// The cannon shows charge without ever going red (red is the red camp's colour,
// so a hot red barrel falsely reads as "this is the red side's gun"). Instead
// the barrel is cool iron at the muzzle and glows amber→white-hot toward the
// breech as power rises, and the pivot doubles as a visible "powder reserve".

const FORGE_IRON = 0x8d97a8; // aged neutral barrel metal (muzzle / rest colour)
const FORGE_AMBER = 0xf0a830;
const FORGE_WHITE = 0xfff4d6;

// Linear blend of two packed RGB ints.
export function mixColor(a, b, t) {
  const r = Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, t));
  const g = Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, t));
  const bl = Math.round(lerp(a & 0xff, b & 0xff, t));
  return (r << 16) | (g << 8) | bl;
}

// The barrel's cool end (muzzle / rest) — constant, so the heat gradient is
// always weighted toward the breech.
export const BARREL_COOL = FORGE_IRON;

// Hot colour at the breech for a given power: iron → amber → white-hot.
export function barrelHeat(power) {
  const t = powerRatio(power);
  return t < 0.5
    ? mixColor(FORGE_IRON, FORGE_AMBER, t * 2)
    : mixColor(FORGE_AMBER, FORGE_WHITE, (t - 0.5) * 2);
}

// Pivot "powder reserve": a relief hub whose core darkens as it packs with
// powder, plus a gauge ring that fills (amber→white) with charge. `fill` is the
// 0..1 charge fraction so the Phaser (TV) and canvas (controller) renderers draw
// the ring identically.
export function pivotCharge(power) {
  const t = powerRatio(power);
  return {
    fill: t,
    core: shade(FORGE_IRON, 1 - 0.4 * t), // darker = more tightly packed
    rim: shade(FORGE_IRON, 1.3), // lit edge for relief
    gauge: mixColor(FORGE_AMBER, FORGE_WHITE, t),
  };
}

export const WINDSOCK_COOL = 0xf4f7ff;
export const WINDSOCK_WARM = 0xff6b35;

// Geometry for an animated windsock anchored at a pole base. Returns the pole
// endpoints and a list of coloured quad segments (alternating stripes) that
// taper toward the tip, point downwind, lift with strength and flutter in time.
export function computeWindsock(baseX, baseY, wind, time, poleH = 32) {
  const topX = baseX;
  const topY = baseY - poleH;
  const k = clamp(Math.abs(wind) / MAX_WIND, 0, 1);
  const dir = wind === 0 ? 0 : Math.sign(wind);

  const length = 16 + 50 * k;
  const droop = lerp(1.2, 0.14, k); // radians below horizontal; flatter when windy
  const vx = dir * Math.cos(droop);
  const vy = Math.sin(droop);

  const segs = 5;
  const w0 = 14;
  const w1 = 4;
  const centre = [];
  for (let i = 0; i <= segs; i += 1) {
    const f = i / segs;
    const dist = length * f;
    const flutter = Math.sin(time * 0.006 + f * 6.2) * 7 * k * f;
    centre.push({ x: topX + vx * dist, y: topY + vy * dist + flutter });
  }

  const segments = [];
  for (let i = 0; i < segs; i += 1) {
    const hwA = lerp(w0, w1, i / segs) / 2;
    const hwB = lerp(w0, w1, (i + 1) / segs) / 2;
    const a = centre[i];
    const b = centre[i + 1];
    segments.push({
      quad: [
        { x: a.x, y: a.y - hwA },
        { x: b.x, y: b.y - hwB },
        { x: b.x, y: b.y + hwB },
        { x: a.x, y: a.y + hwA },
      ],
      color: i % 2 === 0 ? WINDSOCK_WARM : WINDSOCK_COOL,
    });
  }

  return { pole: { x1: baseX, y1: baseY, x2: topX, y2: topY }, segments };
}
