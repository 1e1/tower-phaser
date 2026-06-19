import Phaser from 'phaser';

import { GAME_WIDTH, COLORS } from '../config/constants.js';

// Living-battlefield spectator renderer (lot 3). It draws the *entities* layer
// of the third-player mode — soldiers, the horde, the Intendant avatar, his
// Lemmings-style works (planks + support bars), the battlefield projectiles and
// a compact Intendant strip — on top of the authoritative terrain/towers the
// TvScene already draws.
//
// Everything rides the transmitted authoritative `y`, so this view never needs
// `heightAt`: a soldier standing on a plank is sent at the plank's y, one on the
// ground at the ground's y. The terrain texture is the TvScene's concern.
//
// Depth plan (relative to TvScene's: terrain<1, towers=1, windsock=1, shield=3):
//   0.6  back plane  — deserters + background horde (the design's "second plan")
//   1.4  mid  plane  — works, live soldiers, the Intendant (in front of towers)
//   5.5  proj plane  — bullets / balls / grenades / bolts / Intendant arrows
const D_BACK = 0.6;
const D_MID = 1.4;
const D_PROJ = 5.5;

const SHIELD_R = 42; // dome render radius — mirrors DEFAULT_PARAMS.shieldR (battlefield.js)

const NEUTRAL = 0x9aa0b5;          // truce gonfalon / no-alignment grey
const WOOD = 0x9c6b3f;
const WOOD_DARK = 0x6e4a2b;
const BAR = 0x7d5638;

export default class BattlefieldView {
  constructor(scene) {
    this.scene = scene;
    this.gBack = scene.add.graphics().setDepth(D_BACK);
    this.gMid = scene.add.graphics().setDepth(D_MID);
    this.gProj = scene.add.graphics().setDepth(D_PROJ);
    this.visible = true;
    this._fires = []; // recent field-cannon shots → barrel recoil + muzzle flash
  }

  ownerColor(owner) { return owner === 0 ? COLORS.towerP1 : COLORS.towerP2; }

  // Called by TvScene on a `fieldFire` event. The wire carries only `st==='fight'`
  // for the cannon (no firing phase), so the recoil/flash is driven by this fire
  // pulse instead: matched back to the nearest same-owner cannon while it decays.
  cannonFired(x, owner) {
    this._fires.push({ x, owner, t0: this.scene.time.now });
    if (this._fires.length > 12) this._fires.shift();
  }

  // Recoil [0..1] for the cannon at (x, owner): 1 right after its last shot,
  // easing to 0 over RECOIL_MS. 0 when it hasn't fired recently.
  cannonRecoil(x, owner) {
    const RECOIL_MS = 450; const now = this.scene.time.now;
    let best = 0;
    for (const f of this._fires) {
      if (f.owner !== owner || Math.abs(f.x - x) > 18) continue;
      const r = 1 - (now - f.t0) / RECOIL_MS;
      if (r > best) best = r;
    }
    return Math.max(0, Math.min(1, best));
  }

  destroy() {
    this.gBack.destroy(); this.gMid.destroy(); this.gProj.destroy();
  }

  setVisible(on) {
    this.visible = on;
    this.gBack.setVisible(on); this.gMid.setVisible(on); this.gProj.setVisible(on);
  }

  // bf: the (optionally interpolated) battlefield block from the snapshot.
  render(bf) {
    if (!bf) { this.setVisible(false); return; }
    if (!this.visible) this.setVisible(true);
    const gb = this.gBack; const gm = this.gMid; const gp = this.gProj;
    gb.clear(); gm.clear(); gp.clear();

    // --- works: planks + DERIVED support struts -----------------------------
    // The wire carries only the compact plank list (`structures`); the strut
    // lattice is decompressed here from each plank down to the terrain beneath.
    for (const p of bf.structures) this.drawStruts(gm, p);
    for (const p of bf.structures) {
      gm.fillStyle(WOOD, 1);
      gm.fillRect(p.x0, p.y - 3, Math.max(2, p.x1 - p.x0), 5);
      gm.fillStyle(WOOD_DARK, 1);
      gm.fillRect(p.x0, p.y + 1, Math.max(2, p.x1 - p.x0), 1.5);
    }
    // --- engineer ladders (inclined, foot→top) ------------------------------
    if (bf.ladders) for (const L of bf.ladders) this.drawLadder(gm, L);

    // --- soldiers (back plane for deserters/bg, mid for the rest) -----------
    for (const s of bf.soldiers) this.drawSoldier(s.deserter ? gb : gm, s, s.deserter ? 0.7 : 1);
    for (const h of bf.horde) this.drawSoldier(h.bg ? gb : gm, { ...h, kind: 'sword', hp: 1 }, h.bg ? 0.7 : 1, true);

    // --- defensive musketry alert on a warning tower -----------------------
    for (const t of bf.towers) {
      if (!t.warn) continue;
      const tx = this.scene.towers ? this.scene.towers[t.owner].x : (t.owner === 0 ? 72 : GAME_WIDTH - 72);
      const top = this.scene.towers ? this.scene.towers[t.owner].pivotY + 24 : 120;
      gm.lineStyle(2, 0xffd27a, 0.9);
      gm.strokeCircle(tx, top, 6 + Math.sin(this.scene.time.now / 90) * 1.5);
    }

    // --- Intendant avatar + magic shield ------------------------------------
    this.drawIntendant(gm, bf);
    this.drawShield(gm, bf);

    // --- projectiles --------------------------------------------------------
    // The wire carries no velocity, so a round's travel direction (ux,uy) is
    // estimated from its inter-frame delta (cached by id) — used to lay the
    // cannonball's hot trail / the grenade fuse behind it. (B11/#15)
    const prev = this._projPrev || new Map();
    const next = new Map();
    for (const a of bf.projectiles) {
      const p = a.id != null ? prev.get(a.id) : null;
      let ux = 0; let uy = 1;
      if (p) { const dx = a.x - p.x; const dy = a.y - p.y; const m = Math.hypot(dx, dy); if (m > 0.5) { ux = dx / m; uy = dy / m; } }
      if (a.id != null) next.set(a.id, { x: a.x, y: a.y });
      if (a.ball && !a.gren) {                   // cannonball: hot trail + dark body + bright glint (reads on dark terrain)
        gp.lineStyle(2.4, 0xffaa50, 0.4); gp.lineBetween(a.x - ux * 16, a.y - uy * 16, a.x, a.y);
        gp.fillStyle(0x2c2c30, 1); gp.fillCircle(a.x, a.y, 4.5);
        gp.fillStyle(0xcfc9bd, 1); gp.fillCircle(a.x - 4.5 * 0.32, a.y - 4.5 * 0.32, 4.5 * 0.42);
      } else if (a.gren) {                        // grenade: dark body + orange fuse trailing
        gp.fillStyle(0x1a1a1a, 1); gp.fillCircle(a.x, a.y, 3);
        gp.fillStyle(0xff8c2a, 1); gp.fillCircle(a.x - ux * 3, a.y - uy * 3, 1.5);
      } else if (a.fromI) { gp.lineStyle(1.5, 0xe7e0c8, 1); gp.lineBetween(a.x - 4, a.y, a.x + 4, a.y); }
      else { // bullets (bolt = tower musketry, musket = soldier musket)
        const c = a.owner === 0 ? COLORS.towerP1 : (a.owner === 1 ? COLORS.towerP2 : 0xffe680);
        gp.fillStyle(c, 1); gp.fillCircle(a.x, a.y, 2);
      }
    }
    this._projPrev = next;
  }

  // An inclined ladder (engineer work): two rails offset by the segment normal
  // + perpendicular rungs. Mirrors the lab's drawLadder verbatim. (#14)
  drawLadder(g, L) {
    const dx = L.xt - L.xb; const dy = L.yt - L.yb; const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * 3; const ny = dx / len * 3;
    g.lineStyle(1.6, 0x8a5a28, 1);
    g.lineBetween(L.xb + nx, L.yb + ny, L.xt + nx, L.yt + ny);
    g.lineBetween(L.xb - nx, L.yb - ny, L.xt - nx, L.yt - ny);
    g.lineStyle(1.2, 0x8a5a28, 1);
    const n = Math.max(2, Math.round(len / 5));
    for (let i = 1; i < n; i += 1) { const u = i / n; const rx = L.xb + dx * u; const ry = L.yb + dy * u; g.lineBetween(rx + nx, ry + ny, rx - nx, ry - ny); }
  }

  // Decompress a plank's support lattice: thin struts dropped at intervals from
  // the plank down to the terrain beneath it (the terrain the TvScene already
  // holds — kept exact by the coarse-terrain stream). Cheap, render-only.
  drawStruts(g, p) {
    const terr = this.scene.terrain;
    g.lineStyle(2, BAR, 0.8);
    const step = 12;
    for (let x = p.x0; x <= p.x1; x += step) {
      const ground = terr ? terr.heightAt(x) : p.y + 30;
      if (ground > p.y + 2) { g.beginPath(); g.moveTo(x, p.y); g.lineTo(x, ground); g.strokePath(); }
    }
  }

  // A small soldier figure — transcribed from the validated lab (drawSoldier,
  // battlefield-lab.html:469). owner colours it; kind picks the silhouette; the
  // 'down' state lays it prone. Drawn in a local frame translated to (x, y) so
  // the offsets match the lab verbatim. (Soldiers have NO animated legs in the
  // lab — only a torso rect + a round head; the leg-cycle belongs to the
  // Intendant.) Deserters / background horde are dimmed and shrunk like the lab.
  drawSoldier(g, s, alpha, isHorde = false) {
    if (s.hp <= 0) return;
    const col = this.ownerColor(s.owner);
    const small = s.deserter || s.bg;
    const A = small ? alpha * 0.5 : alpha;

    g.save();
    g.translateCanvas(s.x, s.y);
    if (small) g.scaleCanvas(0.85, 0.85);

    if (s.st === 'down') {                       // prone: recovering from a fall
      g.fillStyle(col, A); g.fillRect(-6, -3, 12, 3);
      g.fillCircle(s.dir > 0 ? -6 : 6, -2, 2.6);
      g.restore(); return;
    }

    if (s.kind === 'cata') {                     // small wheeled field cannon
      const recoil = this.cannonRecoil(s.x, s.owner);   // 1 just after firing → eases to 0
      g.fillStyle(col, A); g.fillRect(-7, -8, 14, 5);   // carriage
      g.fillStyle(0x222222, A); g.fillCircle(-4, -1, 3); g.fillCircle(4, -1, 3);   // wheels
      g.save(); g.translateCanvas(0, -7); g.rotateCanvas(Math.atan2(-1, s.dir));   // barrel frame (+x = muzzle), aligned ON the fire angle (atan2(-335, ±335) = ±45°)
      g.save(); g.translateCanvas(-recoil * 4, 0);      // RECOIL: barrel kicks back on the shot, returns as it decays
      g.fillStyle(0x6b7280, A); g.fillRect(0, -2.5, 15, 5);   // barrel
      g.fillStyle(0x4b525c, A); g.fillCircle(0, 0, 3);        // breech
      if (recoil > 0.55) {                              // MUZZLE FLASH: round powder blast + radial sparks (NOT a forward dart)
        const f = (recoil - 0.55) / 0.45;
        g.fillStyle(0xff9628, A * 0.7 * f); g.fillCircle(15, 0, 5.5 * f);   // diffuse orange halo
        g.fillStyle(0xffd25a, A * f); g.fillCircle(15, 0, 3.5 * f);         // bright yellow core
        g.lineStyle(1.4 * f, 0xffc850, A * f);                              // spark spray in several directions
        for (let k = 0; k < 6; k++) {
          const ang = -Math.PI / 2 + k * (Math.PI / 5), len = 6 + (k % 2) * 4;
          g.lineBetween(15 + 3 * f * Math.cos(ang), 3 * f * Math.sin(ang), 15 + (3 + len * f) * Math.cos(ang), (3 + len * f) * Math.sin(ang));
        }
        g.fillStyle(0xffffff, A * f); g.fillCircle(15, 0, 2.2 * f);         // white-hot nucleus
      }
      g.restore();
      g.restore(); g.restore(); return;
    }

    if (s.kind === 'engineer') {                 // sapper: helmet + carried plank + animated hammer
      g.fillStyle(col, A); g.fillRect(-2.5, -12, 5, 9);                          // body
      g.fillStyle(0xf2c14e, A);                                                  // hard hat (dome + brim)
      g.beginPath(); g.arc(0, -13, 3.3, Math.PI, 0); g.fillPath();
      g.fillRect(-3.3, -13, 6.6, 1.4);
      const t = this.scene.time.now / 1000;
      const build = s.st === 'build';
      const tap = build ? Math.abs(Math.sin(t * 16)) : 0;       // hammer raises then strikes in cadence
      const swing = build ? (-1.0 + tap * 1.6) : 0.2;
      g.save(); g.scaleCanvas(s.dir > 0 ? 1 : -1, 1);                            // forward-facing frame
      g.fillStyle(WOOD, A); g.save(); g.translateCanvas(-2, -11); g.rotateCanvas(-0.5); g.fillRect(0, -1, 9, 2); g.restore();   // plank carried on the shoulder
      g.save(); g.translateCanvas(2, -8); g.rotateCanvas(swing);
      g.lineStyle(1.6, 0x7a5630, A); g.lineBetween(0, 0, 7, 0);                  // handle
      g.fillStyle(0x9aa0a6, A); g.fillRect(6, -2.4, 4, 4.8); g.fillStyle(0xc7ccd1, A); g.fillRect(9, -2.4, 1.4, 4.8);   // head + glint
      g.restore();
      if (build && tap > 0.82) {                                                // spark on impact
        g.fillStyle(0xffd86b, A); g.fillCircle(9, -3, 1.8);
        g.lineStyle(0.8, 0xffd86b, A * 0.7);
        for (let k = 0; k < 3; k += 1) { const a = -0.7 + k * 0.7; g.lineBetween(9, -3, 9 + Math.cos(a) * 3, -3 + Math.sin(a) * 3); }
      }
      g.restore();
      g.restore(); return;
    }

    // torso (filled rect) + round head — the lab's base silhouette
    g.fillStyle(col, A);
    g.fillRect(-2.5, -12, 5, 9);
    g.fillCircle(0, -14, 3);

    const acc = s.owner === 0 ? 0xcfe6fb : 0xfbd2cd;
    if (s.deserter) {                            // white flag of surrender
      g.lineStyle(1.4, 0xcfd6e0, A);
      g.lineBetween(s.dir > 0 ? 2 : -2, -11, s.dir > 0 ? 2 : -2, -21);
      g.fillStyle(0xffffff, A); g.fillRect(s.dir > 0 ? 2 : -8, -21, 6, 4);
      g.restore(); return;
    }
    if (!isHorde) {
      if (s.kind === 'bow') {                    // grenadier: fused grenade
        g.fillStyle(0x2a2a2a, A); g.fillCircle(s.dir > 0 ? 4 : -4, -10, 2.4);
        g.fillStyle(0xff8c2a, A); g.fillRect((s.dir > 0 ? 4 : -4) - 0.5, -13.5, 1, 2);
      } else {                                   // musketeer: aimed or shouldered
        g.lineStyle(1.6, acc, A);
        if (s.st === 'fight') {                  // (s.aim is not on the wire → point forward)
          g.save(); g.translateCanvas(0, -10); g.rotateCanvas(s.dir > 0 ? 0 : Math.PI);
          g.lineBetween(-3, 0, 10, 0); g.restore();
        } else {
          g.lineBetween(s.dir > 0 ? -1 : 1, -8, s.dir > 0 ? 8 : -8, -12);
        }
      }
    }
    g.restore();

    if (s.st === 'fight' && !isHorde) {          // muzzle flash, in absolute coords
      g.fillStyle(0xffd86b, A); g.fillCircle(s.x, s.y - 7, 2.5);
    }
  }

  // The Intendant avatar — transcribed from the lab (drawIntendant + the BODY
  // registry, battlefield-lab.html:486-589): glider, one of 4 animated body
  // styles, sword/bow/tools/hammer. step/walking aren't on the wire, so the
  // spectator derives them from the position delta + a local clock.
  drawIntendant(g, bf) {
    const I = bf.intendant;
    if (I.dead) {
      g.fillStyle(0x555a6b, 0.5); g.fillCircle(I.x, I.y - 8, 5);
      this._prevIx = null;
      return;
    }
    const ICOL = bf.invader < 0 ? NEUTRAL : (bf.invader === 0 ? COLORS.towerP2 : COLORS.towerP1);
    const t = this.scene.time.now / 1000;
    const moved = this._prevIx != null && Math.abs(I.x - this._prevIx) > 0.25;
    this._prevIx = I.x;
    const air = !!I.glide;
    const walking = moved && !air;
    const step = t * 9;

    g.save();
    g.translateCanvas(I.x, I.y);

    // PLANEUR: curved sail + ribs + risers, gentle float (camp tint)
    if (air) {
      const fl = Math.sin(t * 6) * 1.6;
      g.fillStyle(0xb483f0, 0.22); g.lineStyle(1.6, ICOL, 1);
      g.beginPath(); g.moveTo(-14, -29 + fl); g.lineTo(0, -39); g.lineTo(14, -29 - fl);
      g.lineTo(0, -34); g.closePath(); g.fillPath(); g.strokePath();
      g.lineStyle(1, ICOL, 1);
      g.lineBetween(-7, -32, -7, -29); g.lineBetween(7, -32, 7, -29);
      g.lineBetween(-9, -29 + fl, -2, -18); g.lineBetween(9, -29 - fl, 2, -18);
    }

    // BODY (mirrored by facing)
    g.save(); g.scaleCanvas(I.facing, 1);
    this.drawIntBody(g, I.style, step, walking, air);
    g.restore();

    // ÉPÉE: blade + guard + strike arc
    if (I.attacking && I.weapon === 'sword') {
      const sw = Math.sin(t * 18) * 0.5;
      g.save(); g.scaleCanvas(I.facing, 1);
      g.lineStyle(2, 0xffffff, 0.85);
      g.beginPath(); g.arc(0, -10, 30, -1 + sw, 1 + sw); g.strokePath();
      g.save(); g.translateCanvas(4, -12); g.rotateCanvas(sw);
      g.fillStyle(0x8a6a3a, 1); g.fillRect(-1, -1.5, 3, 3);
      g.fillStyle(0xdfe6ee, 1); g.fillRect(2, -1, 12, 2);
      g.fillStyle(0xffffff, 1); g.fillRect(12, -0.7, 3, 1.4);
      g.restore(); g.restore();
    }

    // ARC: limb + string + nocked arrow when firing (oriented to the aim)
    if (I.weapon === 'bow') {
      const ang = I.aimAng != null ? I.aimAng : (I.facing > 0 ? 0 : Math.PI);
      g.save(); g.translateCanvas(0, -12); g.rotateCanvas(ang);
      g.lineStyle(2, ICOL, 1);
      g.beginPath(); g.arc(0, 0, 7, -1.25, 1.25); g.strokePath();
      const bx = Math.cos(1.25) * 7; const by = Math.sin(1.25) * 7;
      g.lineStyle(1, ICOL, 1);
      g.beginPath(); g.moveTo(bx, -by); g.lineTo(I.attacking ? -2 : 0, 0); g.lineTo(bx, by); g.strokePath();
      if (I.attacking) { g.lineStyle(1.6, ICOL, 1); g.lineBetween(-2, 0, 10, 0); }
      g.restore();
    }

    // OUTILS: shovel (dig) / trowel (fill) / rake (flatten), facing-forward swing
    if (I.act) {
      const k = I.act;
      const swing = Math.sin(t * 16) * 0.35;
      const ang = (I.facing > 0 ? 0.5 : Math.PI - 0.5) + swing;
      g.save(); g.translateCanvas(0, -10); g.rotateCanvas(ang);
      g.lineStyle(2, 0x8a6a3a, 1); g.lineBetween(0, 0, 11, 0);
      g.fillStyle(ICOL, 1);
      if (k === 'dig') { g.fillTriangle(11, -3.5, 18, 0, 11, 3.5); }
      else if (k === 'fill') { g.fillRect(11, -3.5, 6, 7); }
      else { g.fillRect(9, -1.5, 10, 3); }
      g.restore();
    }

    // BUILD: tapping hammer
    if (I.building) {
      const tap = Math.abs(Math.sin(t * 16)) * 3;
      g.save(); g.translateCanvas(I.facing * 5, -15 - tap);
      g.fillStyle(0x8a6a3a, 1); g.fillRect(-1, -1, 2, 7);
      g.fillStyle(0x9aa0a6, 1); g.fillRect(-3, -3, 7, 3);
      g.restore();
    }

    g.restore();
  }

  // The 4 body styles from the lab's BODY registry, drawn in a local frame
  // already mirrored by facing. `w` = walking, `air` = airborne (glide/jump).
  drawIntBody(g, style, t, w, air) {
    const legA = (amp) => (air ? amp * 0.6 : (w ? Math.sin(t) * amp : 0));
    if (style === 2) {                           // worker (helmet)
      const ls = legA(3); const rs = -ls;
      g.lineStyle(2, 0x7a5b2a, 1);
      g.lineBetween(-1, -7, -1 + ls, 0); g.lineBetween(1, -7, 1 + rs, 0);
      g.fillStyle(0xf2c14e, 1); g.fillRect(-3, -15, 6, 9);
      const as = air ? -3 : Math.sin(t + Math.PI) * 2.5;
      g.lineStyle(1.5, 0xd9a93f, 1); g.lineBetween(2, -13, 4 + as, -8);
      g.fillStyle(0xffe0a0, 1); g.fillCircle(0, -18, 3.5);
      g.fillStyle(0xe6685a, 1);
      g.beginPath(); g.arc(0, -19, 4.3, Math.PI, 0); g.fillPath();
      g.fillRect(-4.3, -19, 8.6, 1.5);
    } else if (style === 3) {                    // scout (cape)
      const flap = w ? Math.sin(t * 1.4) * 2 : 0;
      g.fillStyle(0x7ee0c0, 1);
      g.fillTriangle(-1, -15, -7, -9 + flap, -1, -5);
      const ls = legA(4); const rs = -ls;
      g.lineStyle(2, 0xcaa14a, 1);
      g.lineBetween(0, -7, ls, 0); g.lineBetween(0, -7, rs, 0);
      g.fillStyle(0xf2c14e, 1); g.fillRect(-2.5, -16, 5, 10);
      g.fillStyle(0xffe0a0, 1); g.fillCircle(0, -19, 3.6);
      g.fillStyle(0xcaa14a, 1); g.fillTriangle(-2, -20, -5, -22, -2, -17);
    } else if (style === 4) {                    // mascot (squash)
      const sq = air ? 1.18 : (w ? 1 + Math.sin(t * 2) * 0.09 : 1);
      g.save(); g.scaleCanvas(1 / sq, sq);
      g.fillStyle(0xf2c14e, 1); g.fillCircle(0, -9, 7.5);
      g.restore();
      g.fillStyle(0xffffff, 1); g.fillCircle(2, -12, 1.8); g.fillCircle(-1.5, -12, 1.8);
      g.fillStyle(0x1a1300, 1); g.fillCircle(2.4, -12, 0.9); g.fillCircle(-1.1, -12, 0.9);
      const ls = legA(2);
      g.lineStyle(2.5, 0xcaa14a, 1);
      g.lineBetween(-2, -1.5, -2 + ls, 0); g.lineBetween(2, -1.5, 2 - ls, 0);
    } else {                                     // 1: robe & hood (default)
      const bob = w ? Math.abs(Math.sin(t)) * 1.4 : 0;
      g.save(); g.translateCanvas(0, -bob);
      g.fillStyle(0xc2922f, 1);
      g.fillTriangle(-2.5, -15, 2.5, -15, 6, 0);          // robe (upper)
      g.fillTriangle(-2.5, -15, 6, 0, -6, 0);             // robe (lower) — rect split into tris
      const sway = w ? Math.sin(t) * 2 : 0;
      g.fillStyle(0xa87c28, 1);
      g.fillTriangle(-6, 0, 6, 0, 6 + sway, 3);
      g.fillTriangle(-6, 0, 6 + sway, 3, -6 + sway, 3);   // animated hem
      g.fillStyle(0xf2c14e, 1); g.fillCircle(0, -18, 4.3);
      g.fillStyle(0xa87c28, 1);
      g.beginPath(); g.arc(0, -19, 5.4, Math.PI * 1.02, Math.PI * 1.98); g.fillPath(); // hood
      g.restore();
    }
  }

  // Magic shield dome around the Intendant. The visual STYLE is per-biome DATA
  // (biome.intendantShield) resolved here — never a `biome.id === 'x'` branch.
  // Styles: 'vortex' (ember swirl, hue derived from the biome's ambient colour)
  // and 'egide' (heraldic ring of spectral heater-shields, the default).
  drawShield(g, bf) {
    const I = bf.intendant;
    const sh = I && I.shield;
    if (!I || I.dead || !sh || sh.t <= 0) return;
    const R = SHIELD_R;
    const x = I.x; const cy = I.y - 12;        // dome centred on the buste
    const life = Math.min(1, sh.t / 0.5);      // fade out over the last 0.5s
    const pulse = Math.max(0, Math.min(1, sh.hit));
    const t = this.scene.time.now / 1000;
    const biome = this.scene.biome;
    const style = (biome && biome.intendantShield) || 'egide';
    let sparkColor;

    if (style === 'vortex') {
      // Ember swirl: particle hue comes from the biome's ambient colour (ember
      // on volcano) — zero hardcoded tint, mirrors the lab's data-driven choice.
      const amb = (biome && biome.ambientColor) || 0x96dcff;
      sparkColor = amb;
      g.lineStyle(1, amb, 0.18 * life + 0.2 * pulse); g.strokeCircle(x, cy, R);
      const N = 18;
      for (let k = 0; k < N; k += 1) {
        const a = (k / N) * Math.PI * 2 + t * 2.4;
        const rr = R * (0.55 + 0.45 * ((k * 0.137) % 1));
        const px = x + Math.cos(a) * rr; const py = cy + Math.sin(a) * rr * 0.92;
        const al = Math.max(0, (0.4 * life + 0.5 * pulse) * (0.45 + 0.55 * Math.sin(a * 2 + t * 6)));
        g.fillStyle(amb, al); g.fillCircle(px, py, 1.8);
        g.lineStyle(1, amb, al * 0.5); g.lineBetween(px, py, x + Math.cos(a - 0.3) * rr, cy + Math.sin(a - 0.3) * rr * 0.92);
      }
    } else {
      // Égide: a ring of spectral heater-shields facing outward (bronze ward).
      sparkColor = 0xf0d29a;
      g.fillStyle(0xc8a878, 0.12 * life + 0.16 * pulse); g.fillCircle(x, cy, R);
      const N = 10; const baseA = 0.5 * life + 0.4 * pulse;
      for (let k = 0; k < N; k += 1) {
        const ang = (k / N) * Math.PI * 2 + t * 0.3;
        const pts = heaterShield(x + Math.cos(ang) * R, cy + Math.sin(ang) * R, ang, R * 0.46);
        g.fillStyle(0xc8a878, 0.16 * life + 0.2 * pulse); g.fillPoints(pts, true);
        g.lineStyle(1.4, 0xf0d29a, baseA); g.strokePoints(pts, true);
      }
    }

    // Impact sparks (both styles): a bright flash at the burst point + a rim arc.
    for (const f of sh.fx) {
      const fa = Math.max(0, Math.min(1, f.t / 0.45));
      const ix = x + Math.cos(f.a) * R; const iy = cy + Math.sin(f.a) * R;
      g.fillStyle(0xfff0c8, fa); g.fillCircle(ix, iy, 3 + 6 * (1 - fa));
      g.lineStyle(2.5, sparkColor, fa);
      g.beginPath(); g.arc(x, cy, R, f.a - 0.35 - 0.4 * (1 - fa), f.a + 0.35 + 0.4 * (1 - fa)); g.strokePath();
    }
  }
}

// A small heater-shield (escutcheon) polygon centred at (cx,cy), its tip pointing
// radially outward along `ang`, scaled by s. Used by the égide shield style.
function heaterShield(cx, cy, ang, s) {
  const th = ang - Math.PI / 2; const ca = Math.cos(th); const sa = Math.sin(th);
  const local = [[-0.45, -0.5], [0.45, -0.5], [0.5, 0.1], [0, 0.85], [-0.5, 0.1]];
  return local.map(([lx, ly]) => ({ x: cx + (lx * ca - ly * sa) * s, y: cy + (lx * sa + ly * ca) * s }));
}

// Interpolate two battlefield snapshots by entity id at fraction f∈[0,1], so
// soldiers/horde/Intendant glide between the ~30 Hz network ticks instead of
// stepping. Lists that have no stable identity (works, bars, projectiles) and
// the scalar blocks are taken from the newer snapshot.
export function lerpBattlefield(a, b, f) {
  if (!a) return b;
  if (!b) return a;
  const byId = (arr) => new Map(arr.map((e) => [e.id, e]));
  const ai = byId(a.soldiers); const ah = byId(a.horde);
  const mix = (oldE, newE) => (oldE
    ? { ...newE, x: oldE.x + (newE.x - oldE.x) * f, y: oldE.y + (newE.y - oldE.y) * f }
    : newE);
  const soldiers = b.soldiers.map((s) => mix(ai.get(s.id), s));
  const horde = b.horde.map((s) => mix(ah.get(s.id), s));
  const I = (a.intendant && b.intendant)
    ? { ...b.intendant, x: a.intendant.x + (b.intendant.x - a.intendant.x) * f, y: a.intendant.y + (b.intendant.y - a.intendant.y) * f }
    : b.intendant;
  return { ...b, soldiers, horde, intendant: I };
}
