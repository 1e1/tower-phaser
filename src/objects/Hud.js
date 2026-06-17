import QRCode from 'qrcode';

import { GAME_WIDTH, COLORS, MAX_WIND } from '../config/constants.js';
import { intToCss } from '../render/visuals.js';

const D = 1000; // HUD renders above scenery, particles and explosions

// Central scoreboard geometry (the "penalty shootout" layout).
const CARD_W = 560;
const CARD_H = 70;
const CARD_PAD = 24;
const NAME_MAX_W = 168; // names are clamped + ellipsised so they can never reach the centre
const WIND_HALF = 80; // half-width of the centre column reserved for the wind gauge
const PIP_R = 7;
const PIP_GAP = 22;
const WIND_TRACK_W = 120;

// In-match header (variant ③ — "penalty shootout"): one central scoreboard card
// laid out as two player columns (name + a row of win-pips, like the dots under
// each team in a shootout graphic) framing a central wind gauge. The round number
// is implicit (filled pips → wins, slots → first-to-N), so names own their whole
// side and can never collide with the centre. A floating room module (code + mini
// QR) sits top-right so late players can still scan to join. Locked above the
// scene so the camera pan does not move it.
export default class Hud {
  constructor(scene, names, colors, room = {}) {
    this.scene = scene;
    this.colors = colors;
    this._scores = [0, 0];
    this._wins = null; // pip-slot count; arrives via updateRound()
    const cx = GAME_WIDTH / 2;

    // --- central scoreboard card ---
    const cardX = cx - CARD_W / 2;
    const card = scene.add.graphics().setDepth(D).setScrollFactor(0);
    card.fillStyle(0x0a1020, 0.74);
    card.fillRoundedRect(cardX, 8, CARD_W, CARD_H, 14);
    card.lineStyle(2, 0xffffff, 0.13);
    card.strokeRoundedRect(cardX, 8, CARD_W, CARD_H, 14);

    const nameStyle = (c) => ({
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '24px',
      fontStyle: 'bold',
      color: intToCss(c),
    });

    // Content sits ABOVE the card panel (which is also depth D): give every piece
    // an explicit depth + fixed scroll factor, otherwise it falls to depth 0, gets
    // covered by the dark card and reads as muddy/unreadable.
    const top = (obj) => obj.setDepth(D + 1).setScrollFactor(0);
    this._leftX = cardX + CARD_PAD;
    this._rightX = cardX + CARD_W - CARD_PAD;
    this._cx = cx;

    // Names: P1 left-aligned to the left edge, P2 right-aligned to the right edge.
    this._fullNames = [names[0] || '', names[1] || ''];
    this.nameP1 = top(scene.add.text(this._leftX, 13, '', nameStyle(colors[0])).setOrigin(0, 0));
    this.nameP2 = top(scene.add.text(this._rightX, 13, '', nameStyle(colors[1])).setOrigin(1, 0));
    this._setName(this.nameP1, this._fullNames[0]);
    this._setName(this.nameP2, this._fullNames[1]);

    // Win-pips, drawn per player just under the name.
    this.pipsGfx = scene.add.graphics().setDepth(D + 1).setScrollFactor(0);

    // Central wind gauge: a centre-anchored bar filling toward the side the wind
    // blows, plus an arrow + strength readout. Amber sets it apart from both
    // player hues. The bar tracks live wind, so it eases continuously in Turbo.
    top(scene.add
      .text(cx, 11, 'WIND', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '11px', color: '#f0d79b', fontStyle: 'bold' })
      .setOrigin(0.5, 0));
    this.windGfx = scene.add.graphics().setDepth(D + 1).setScrollFactor(0);
    this.windText = top(scene.add
      .text(cx, 44, '0%  ·', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '18px', color: '#f5c451', fontStyle: 'bold' })
      .setOrigin(0.5, 0));

    // --- floating room module (top-right) ---
    const room2 = scene.add.graphics().setDepth(D).setScrollFactor(0);
    const rmW = 150;
    const rmX = GAME_WIDTH - rmW - 14;
    room2.fillStyle(0x0a1020, 0.74);
    room2.fillRoundedRect(rmX, 8, rmW, 64, 12);
    room2.lineStyle(2, 0xffffff, 0.13);
    room2.strokeRoundedRect(rmX, 8, rmW, 64, 12);
    top(scene.add
      .text(rmX + 70, 22, 'JOIN', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '13px', color: COLORS.hudDim })
      .setOrigin(0, 0));
    top(scene.add
      .text(rmX + 70, 36, room.code || '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '26px', fontStyle: 'bold', color: COLORS.hud })
      .setOrigin(0, 0));

    if (room.joinUrl) {
      const key = `hudqr-${room.code}`;
      const canvas = document.createElement('canvas');
      QRCode.toCanvas(canvas, room.joinUrl, { margin: 1, width: 50 }, (err) => {
        if (err) return;
        if (scene.textures.exists(key)) scene.textures.remove(key);
        scene.textures.addCanvas(key, canvas);
        top(scene.add.image(rmX + 12, 15, key).setOrigin(0, 0));
      });
    }

    this._drawWind(0);

    this.banner = scene.add
      .text(cx, 210, '', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '54px',
        color: COLORS.hud,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(D)
      .setScrollFactor(0);
  }

  // Set a name, clamping to NAME_MAX_W with an ellipsis so it stays on its side.
  _setName(textObj, str) {
    textObj.setText(str);
    if (textObj.width <= NAME_MAX_W) return;
    let s = str;
    while (s.length > 1 && textObj.width > NAME_MAX_W) {
      s = s.slice(0, -1);
      textObj.setText(`${s}…`);
    }
  }

  // Draw both players' win-pips: P1 grows rightward from the left edge, P2 grows
  // leftward from the right edge. Filled = rounds won, hollow = still to play.
  _drawPips() {
    const g = this.pipsGfx;
    g.clear();
    if (this._wins == null) return;
    const y = 53;
    const draw = (i, x, won, color) => {
      g.lineStyle(2, color, 1);
      if (won) {
        g.fillStyle(color, 1);
        g.fillCircle(x, y, PIP_R);
      }
      g.strokeCircle(x, y, PIP_R);
    };
    for (let i = 0; i < this._wins; i += 1) {
      draw(i, this._leftX + PIP_R + i * PIP_GAP, i < this._scores[0], this.colors[0]);
      draw(i, this._rightX - PIP_R - i * PIP_GAP, i < this._scores[1], this.colors[1]);
    }
  }

  _drawWind(value) {
    const g = this.windGfx;
    g.clear();
    const cx = this._cx;
    const y = 30;
    const h = 8;
    const halfTrack = WIND_TRACK_W / 2;
    // track
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(cx - halfTrack, y - h / 2, WIND_TRACK_W, h, h / 2);
    // fill from centre toward the wind direction
    const ratio = Math.min(Math.abs(value) / MAX_WIND, 1);
    const len = halfTrack * ratio;
    if (len > 0.5) {
      g.fillStyle(0xf5c451, 1);
      const x = value > 0 ? cx : cx - len;
      // Round only the outer end so the fill stays flush against the centre
      // tick; rounding the centre side would detach into a lens at low force.
      const r = Math.min(h / 2, len);
      const radius = value > 0
        ? { tl: 0, bl: 0, tr: r, br: r }
        : { tr: 0, br: 0, tl: r, bl: r };
      g.fillRoundedRect(x, y - h / 2, len, h, radius);
    }
    // centre tick
    g.fillStyle(0xffffff, 0.45);
    g.fillRect(cx - 1, y - h / 2, 2, h);
  }

  updateNames(names) {
    this._fullNames = [names[0] || '', names[1] || ''];
    this._setName(this.nameP1, this._fullNames[0]);
    this._setName(this.nameP2, this._fullNames[1]);
  }

  updateScores(scores) {
    this._scores = [scores[0], scores[1]];
    this._drawPips();
  }

  updateRound(current, winsNeeded) {
    this._wins = winsNeeded;
    this._drawPips();
  }

  updateWind(wind) {
    const strength = Math.round((Math.abs(wind.value) / MAX_WIND) * 100);
    const arrow = wind.value === 0 ? '·' : wind.value > 0 ? '→' : '←';
    this.windText.setText(`${strength}%  ${arrow}`);
    this._drawWind(wind.value);
  }

  showBanner(message, duration = 1200) {
    this.banner.setText(message).setAlpha(1).setScale(0.7);
    this.scene.tweens.add({ targets: this.banner, scale: 1, duration: 220, ease: 'Back.out' });
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: duration, duration: 300 });
  }
}
