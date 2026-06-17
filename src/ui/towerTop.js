import { barrelColor, intToCss, computeWindsock, shade } from '../render/visuals.js';

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
  const mortarCss = intToCss(shade(o.color, 0.6));
  const darkCss = intToCss(shade(o.color, 0.78));

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

  // Crenellated top.
  const merlon = (bw - 10) / 5;
  ctx.fillStyle = darkCss;
  for (let i = 0; i < 3; i += 1) ctx.fillRect(bx + 3 + i * merlon * 2, by - 11, merlon, 11);

  const px = w / 2;
  const py = by;
  const rad = (o.angle * Math.PI) / 180;
  const dirx = o.facing * Math.cos(rad);
  const diry = -Math.sin(rad);

  // Slim barrel (charge-tinted).
  const blen = h * 0.27;
  const bwid = Math.max(6, h * 0.024);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(diry, dirx));
  ctx.fillStyle = intToCss(barrelColor(o.power));
  roundRect(ctx, 0, -bwid / 2, blen, bwid, 4);
  ctx.fill();
  ctx.restore();

  // Hub.
  ctx.fillStyle = '#d7dde8';
  ctx.beginPath();
  ctx.arc(px, py, Math.max(7, h * 0.022), 0, Math.PI * 2);
  ctx.fill();

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
    const tw = 0.6 + 0.4 * Math.sin(o.time * 0.03);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = h * 0.05 * tw;
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 2.4);
    grad.addColorStop(0, 'rgba(255,230,128,0.95)');
    grad.addColorStop(1, 'rgba(255,140,42,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(fx, fy, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // a few flickering sparks
    for (let i = 0; i < 4; i += 1) {
      const a = o.time * 0.02 + i * 1.7;
      const d = (i + tw) * h * 0.012;
      ctx.fillStyle = '#ffe680';
      ctx.fillRect(fx + Math.cos(a) * d, fy - Math.abs(Math.sin(a)) * d - h * 0.01, 2, 2);
    }
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}
