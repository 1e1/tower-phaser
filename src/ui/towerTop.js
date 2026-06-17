import { barrelHeat, BARREL_COOL, pivotCharge, intToCss, computeWindsock, shade, towerPalette } from '../render/visuals.js';

// Draw the player's own tower top onto a 2D canvas: body, cannon oriented by the
// current aim and tinted by charge, an animated windsock, and a firing flash.
// Mirrors the look of the TV so the phone feels like a window onto the duel.
export function drawTowerTop(ctx, w, h, o) {
  ctx.clearRect(0, 0, w, h);

  const groundY = h * 0.9;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, groundY, w, h - groundY);

  const bw = Math.max(54, w * 0.17);
  const bh = h * 0.42;
  const bx = w / 2 - bw / 2;
  const by = groundY - bh;
  const bodyCss = intToCss(o.color);
  const pal = towerPalette(o.color);
  const mortarCss = intToCss(pal.mortar);
  const darkCss = intToCss(pal.dark);

  // Damage state — mirrors the battlefield tower (Tower.js): merlons crumble to
  // stubs, breaches open, rubble heaps at the foot, and a destroyed tower is a
  // ruin rather than a clean cannon.
  const maxHp = o.maxHp || 1;
  const hp = o.hp == null ? maxHp : o.hp;
  const dmg = maxHp > 1 ? 1 - hp / maxHp : 0;
  const dead = hp <= 0;

  // Spoils of the match, planted on the ground around the tower: a trophy for
  // every round won, lined up behind (same side as the windsock); a chunk of
  // rubble for every round lost, heaped chaotically in front (toward the enemy).
  // Drawn before the body so the tower slightly overlaps them and they read as
  // grounded props. Jitter is deterministic per index so nothing twitches frame
  // to frame.
  drawSpoils(ctx, w / 2, groundY, bw, h, o.facing, o.wins | 0, o.losses | 0);

  // A destroyed tower leaves a heap of stone — no body, no cannon.
  if (dead) { drawTowerRuin(ctx, w / 2, groundY, bw, o.color, mortarCss); return; }

  // Stone body.
  roundRect(ctx, bx, by, bw, bh, 6);
  ctx.fillStyle = bodyCss;
  ctx.fill();

  // Masonry joints, clipped to the body.
  ctx.save();
  roundRect(ctx, bx, by, bw, bh, 6);
  ctx.clip();
  ctx.strokeStyle = mortarCss;
  ctx.lineWidth = 2;
  const rowH = Math.max(13, bh / 5);
  const blockW = bw / 2.6;
  let row = 0;
  for (let y = by + rowH; y < by + bh; y += rowH, row += 1) {
    ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); ctx.stroke();
    const off = (row % 2) * (blockW / 2);
    for (let x = bx + off; x < bx + bw; x += blockW) {
      if (x <= bx) continue;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
    }
  }
  ctx.restore();

  // Crenellated top — a merlon knocked off by damage leaves a jagged stub.
  const knocked = Math.round(dmg * 3);
  const merlon = (bw - 10) / 5;
  for (let i = 0; i < 3; i += 1) {
    const mx = bx + 3 + i * merlon * 2;
    const mh = i < knocked ? 4 + hash(i * 7 + 1) * 4 : 11;
    ctx.fillStyle = darkCss;
    ctx.fillRect(mx, by - mh, merlon, mh);
    ctx.strokeStyle = mortarCss; ctx.lineWidth = 1.5;
    ctx.strokeRect(mx, by - mh, merlon, mh);
  }

  // Breaches punched into the body and rubble heaping at the foot, growing with
  // damage — so a hurt tower reads the same on the phone as on the battlefield.
  if (dmg > 0) {
    const breaches = Math.floor(dmg * 4);
    ctx.fillStyle = 'rgba(10,8,16,0.82)';
    for (let i = 0; i < breaches; i += 1) {
      const hx = bx + 6 + ((i * 27 + 6) % Math.max(1, bw - 18));
      const hy = by + 4 + hash(i * 5 + 2) * (bh * 0.4);
      ctx.fillRect(hx, hy, 12, 9);
    }
    const rubble = Math.round(dmg * 5);
    for (let i = 0; i < rubble; i += 1) {
      const dx = (hash(i * 5 + 3) - 0.5) * bw * (0.9 + dmg);
      const s = 5 + hash(i * 3 + 1) * 7;
      drawStone(ctx, w / 2 + dx, groundY - s * 0.3, s, (hash(i * 7) - 0.5) * 0.8, i + 40, o.color, mortarCss);
    }
  }

  const px = w / 2;
  const py = by;
  const rad = (o.angle * Math.PI) / 180;
  const dirx = o.facing * Math.cos(rad);
  const diry = -Math.sin(rad);

  // Slim barrel: cool iron at the muzzle, heat-glow toward the breech.
  const blen = h * 0.27;
  const bwid = Math.max(6, h * 0.024);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(diry, dirx));
  const grad = ctx.createLinearGradient(0, 0, blen, 0);
  grad.addColorStop(0, intToCss(barrelHeat(o.power))); // breech (hot)
  grad.addColorStop(1, intToCss(BARREL_COOL)); // muzzle (cool)
  ctx.fillStyle = grad;
  roundRect(ctx, 0, -bwid / 2, blen, bwid, 4);
  ctx.fill();
  ctx.restore();

  // Pivot = powder reserve: a relief hub + a gauge ring that fills with charge.
  const pc = pivotCharge(o.power);
  const hubR = Math.max(7, h * 0.022);
  // Breech heat glow.
  if (pc.fill > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(px, py, 0, px, py, hubR * 2.6);
    gr.addColorStop(0, `rgba(255,244,214,${0.5 * pc.fill})`);
    gr.addColorStop(0.5, `rgba(240,168,48,${0.35 * pc.fill})`);
    gr.addColorStop(1, 'rgba(240,168,48,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(px, py, hubR * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Relief hub: lit rim easing to a darker packed core.
  const hub = ctx.createRadialGradient(px - hubR * 0.3, py - hubR * 0.3, hubR * 0.2, px, py, hubR);
  hub.addColorStop(0, intToCss(pc.rim));
  hub.addColorStop(1, intToCss(pc.core));
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(px, py, hubR, 0, Math.PI * 2);
  ctx.fill();
  // Powder gauge ring, filling clockwise from the top.
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(px, py, hubR + 3.5, 0, Math.PI * 2);
  ctx.stroke();
  if (pc.fill > 0.01) {
    ctx.strokeStyle = intToCss(pc.gauge);
    const start = -Math.PI / 2;
    ctx.beginPath();
    ctx.arc(px, py, hubR + 3.5, start, start + pc.fill * Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // Fuse (wick) at the breech, sparking when the player is ready.
  const fx = px - o.facing * h * 0.05;
  const fy = py - h * 0.1;
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px - o.facing * h * 0.015, py - h * 0.025);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  if (o.ready) {
    const tw = 0.55 + 0.45 * Math.sin(o.time * 0.03);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // A big, bright halo so the "shot is armed and waiting" state reads clearly
    // on a phone (not just on the TV).
    const r = h * 0.085 * (0.85 + 0.25 * tw);
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 2.8);
    grad.addColorStop(0, 'rgba(255,245,205,1)');
    grad.addColorStop(0.4, 'rgba(255,210,110,0.9)');
    grad.addColorStop(1, 'rgba(255,140,42,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(fx, fy, r * 2.8, 0, Math.PI * 2); ctx.fill();
    // white-hot core
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(fx, fy, Math.max(2.5, h * 0.014), 0, Math.PI * 2); ctx.fill();
    // flickering sparks flying off the wick
    for (let i = 0; i < 8; i += 1) {
      const a = o.time * 0.02 + i * 0.9;
      const d = ((i % 4) + tw) * h * 0.02;
      ctx.fillStyle = i % 2 ? '#ffe680' : '#ffffff';
      const sz = 2 + (i % 3);
      ctx.fillRect(fx + Math.cos(a) * d, fy - Math.abs(Math.sin(a)) * d - h * 0.012, sz, sz);
    }
    ctx.restore();
  }

  // Muzzle flash on firing.
  if (o.flash > 0) {
    const mx = px + dirx * blen;
    const my = py + diry * blen;
    const r = 12 + o.flash * 34;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    grad.addColorStop(0, `rgba(255,240,180,${0.9 * o.flash})`);
    grad.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Windsock, set back from the tower and darkened to read as a distant prop.
  const wsBaseX = px - o.facing * (bw / 2 + h * 0.14 + 18);
  const ws = computeWindsock(wsBaseX, by + 10, o.wind, o.time, Math.max(24, h * 0.12));
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = '#54585f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ws.pole.x1, ws.pole.y1);
  ctx.lineTo(ws.pole.x2, ws.pole.y2);
  ctx.stroke();
  for (const seg of ws.segments) {
    ctx.fillStyle = intToCss(shade(seg.color, 0.62));
    ctx.beginPath();
    ctx.moveTo(seg.quad[0].x, seg.quad[0].y);
    for (let k = 1; k < seg.quad.length; k += 1) ctx.lineTo(seg.quad[k].x, seg.quad[k].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Deterministic [0,1) hash so jittered props stay put across frames.
function hash(n) {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

// Trophies behind, rubble in front. `facing` is +1 (tower aims right) or -1.
function drawSpoils(ctx, px, groundY, bw, h, facing, wins, losses) {
  const f = facing < 0 ? -1 : 1;

  // Rubble first, one chunk per loss, racked like billiard balls into a triangle
  // pyramid (widest row on the ground, each row up nestled in the gaps). Heaped
  // out to the side, clear of the tower foot — never piled onto the tower itself.
  const rs = h * 0.05;
  const gap = rs * 1.7;
  const innerX = px + f * (bw / 2 + rs * 1.3); // tower-side edge of the heap
  const baseY = groundY - rs * 0.2;
  let base = 1; // widest row: smallest triangle that holds every loss
  while ((base * (base + 1)) / 2 < losses) base += 1;
  let placed = 0;
  for (let row = 0; row < base && placed < losses; row += 1) {
    const count = base - row; // bottom row widest, one fewer each step up
    const rowY = baseY - row * gap * 0.85;
    for (let c = 0; c < count && placed < losses; c += 1) {
      const cx = innerX + f * (row * gap * 0.5 + c * gap) + (hash(placed * 7 + 1) - 0.5) * rs * 0.25;
      const cy = rowY + (hash(placed * 7 + 2) - 0.5) * rs * 0.2;
      const sz = rs * (0.85 + hash(placed * 5 + 3) * 0.3);
      drawRock(ctx, cx, cy, sz, (hash(placed * 7 + 4) - 0.5) * 0.5, placed);
      placed += 1;
    }
  }

  // Trophies next, a tidy row marching back from the tower with only a whisper
  // of jitter and a slight tilt so they read as displayed, not stamped.
  const ts = h * 0.075;
  const step = ts * 0.62;
  for (let i = 0; i < wins; i += 1) {
    const x = px - f * (bw / 2 + ts * 0.62 + i * step) + (hash(i * 5 + 2) - 0.5) * ts * 0.14;
    const y = groundY - hash(i * 5 + 4) * ts * 0.05;
    drawTrophy(ctx, x, y, ts, (hash(i * 5 + 6) - 0.5) * 0.22);
  }
}

// A small gold cup standing on `(x, baseY)`, tilted by `rot` radians about its foot.
function drawTrophy(ctx, x, baseY, s, rot = 0) {
  const gold = '#f5c451';
  const goldDark = '#c08f2c';
  ctx.save();
  ctx.translate(x, baseY);
  ctx.rotate(rot);
  ctx.translate(-x, -baseY);
  // plinth
  ctx.fillStyle = goldDark;
  ctx.fillRect(x - s * 0.22, baseY - s * 0.07, s * 0.44, s * 0.07);
  ctx.fillRect(x - s * 0.13, baseY - s * 0.15, s * 0.26, s * 0.09);
  // stem
  ctx.fillStyle = gold;
  ctx.fillRect(x - s * 0.05, baseY - s * 0.4, s * 0.1, s * 0.26);
  // bowl
  ctx.beginPath();
  ctx.moveTo(x - s * 0.28, baseY - s * 0.82);
  ctx.lineTo(x + s * 0.28, baseY - s * 0.82);
  ctx.lineTo(x + s * 0.15, baseY - s * 0.42);
  ctx.lineTo(x - s * 0.15, baseY - s * 0.42);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  // handles
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = gold;
  ctx.beginPath();
  ctx.arc(x - s * 0.28, baseY - s * 0.7, s * 0.13, -Math.PI * 0.45, Math.PI * 0.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + s * 0.28, baseY - s * 0.7, s * 0.13, Math.PI * 0.05, Math.PI * 1.45);
  ctx.stroke();
  // lit edge
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(x - s * 0.21, baseY - s * 0.78, s * 0.05, s * 0.3);
  ctx.restore();
}

// An irregular grey rock centred near `(x, y)`, rotated by `rot`.
function drawRock(ctx, x, y, s, rot, seed) {
  const greys = ['#7a8597', '#646e80', '#8b94a3', '#566072'];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = greys[seed % greys.length];
  ctx.beginPath();
  const n = 5;
  for (let k = 0; k < n; k += 1) {
    const ang = (k / n) * Math.PI * 2;
    const rr = s * (0.55 + hash(seed * 9 + k * 3.1) * 0.5);
    const ptx = Math.cos(ang) * rr;
    const pty = Math.sin(ang) * rr * 0.78;
    if (k === 0) ctx.moveTo(ptx, pty);
    else ctx.lineTo(ptx, pty);
  }
  ctx.closePath();
  ctx.fill();
  // a glint along the top facet
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(-s * 0.4, -s * 0.5, s * 0.8, s * 0.13);
  ctx.restore();
}

// A camp-tinted stone chunk (pentagon) outlined in mortar — matches the rubble
// of the battlefield tower (Tower.js · rock), as opposed to the grey spoils rocks.
function drawStone(ctx, x, y, s, rot, seed, color, mortarCss) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = intToCss(shade(color, 0.62 + hash(seed * 3) * 0.26));
  ctx.beginPath();
  for (let k = 0; k < 5; k += 1) {
    const ang = (k / 5) * Math.PI * 2;
    const rr = s * (0.55 + hash(seed * 9 + k * 3.1) * 0.5);
    const px = Math.cos(ang) * rr;
    const py = Math.sin(ang) * rr * 0.78;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = mortarCss;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// The destroyed tower: a low, irregular mound of stone heaped higher in the
// middle, sitting on the ground where the tower stood.
function drawTowerRuin(ctx, cx, groundY, bw, color, mortarCss) {
  const spread = bw * 1.5;
  for (let i = 0; i < 18; i += 1) {
    const dx = (hash(i * 5 + 1) - 0.5) * spread;
    const s = 6 + hash(i * 3 + 2) * 10;
    const heap = Math.max(0, 1 - Math.abs(dx) / (spread * 0.55));
    const y = groundY - heap * 24 * hash(i * 9 + 3) - s * 0.3;
    drawStone(ctx, cx + dx, y, s, (hash(i * 11) - 0.5) * 0.9, i, color, mortarCss);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}
