import { AIM, MAX_WIND } from '../config/constants.js';

// Shared, renderer-agnostic visual helpers used by both the Phaser views (TV)
// and the plain-canvas controller mini-view, so the cannon, charge tint and
// windsock look identical everywhere.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function intToCss(c) {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
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

// Barrel colour: cool steel at low power, glowing red at full charge.
export function barrelColor(power) {
  const t = powerRatio(power);
  const base = { r: 0xd7, g: 0xdd, b: 0xe8 };
  const hot = { r: 0xff, g: 0x3b, b: 0x2f };
  const r = Math.round(lerp(base.r, hot.r, t));
  const g = Math.round(lerp(base.g, hot.g, t));
  const b = Math.round(lerp(base.b, hot.b, t));
  return (r << 16) | (g << 8) | b;
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
