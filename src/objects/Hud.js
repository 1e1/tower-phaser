import QRCode from 'qrcode';

import { GAME_WIDTH, COLORS, MAX_WIND } from '../config/constants.js';

const D = 1000; // HUD renders above scenery, particles and explosions

// In-match header (variant ②): a central scoreboard card (names, scores, round,
// wind) plus a floating room module (code + mini QR) at the top-right, so late
// players can still scan to join. Locked above the scene so the camera pan does
// not move it.
export default class Hud {
  constructor(scene, names, colors, room = {}) {
    this.scene = scene;
    const cx = GAME_WIDTH / 2;

    // --- central scoreboard card ---
    const cardW = 560;
    const cardH = 70;
    const cardX = cx - cardW / 2;
    const card = scene.add.graphics().setDepth(D).setScrollFactor(0);
    card.fillStyle(0x0a1020, 0.74);
    card.fillRoundedRect(cardX, 8, cardW, cardH, 14);
    card.lineStyle(2, 0xffffff, 0.13);
    card.strokeRoundedRect(cardX, 8, cardW, cardH, 14);

    const nameStyle = (c) => ({
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '24px',
      fontStyle: 'bold',
      color: `#${c.toString(16).padStart(6, '0')}`,
    });
    const scoreStyle = {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '34px',
      fontStyle: 'bold',
      color: COLORS.hud,
    };

    // Content sits ABOVE the card panel (which is also depth D): give the texts
    // an explicit depth + fixed scroll factor, otherwise they fall to depth 0,
    // get covered by the dark card and read as muddy/unreadable.
    const top = (obj) => obj.setDepth(D + 1).setScrollFactor(0);
    const p1x = cx - 150;
    const p2x = cx + 150;
    this.nameP1 = top(scene.add.text(p1x, 16, names[0], nameStyle(colors[0])).setOrigin(0.5, 0));
    this.nameP2 = top(scene.add.text(p2x, 16, names[1], nameStyle(colors[1])).setOrigin(0.5, 0));
    this.scoreP1 = top(scene.add.text(p1x, 40, '0', scoreStyle).setOrigin(0.5, 0));
    this.scoreP2 = top(scene.add.text(p2x, 40, '0', scoreStyle).setOrigin(0.5, 0));

    this.roundText = top(scene.add
      .text(cx, 18, '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '17px', color: '#e7ecf6', fontStyle: 'bold' })
      .setOrigin(0.5, 0));
    this.windText = top(scene.add
      .text(cx, 44, '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold' })
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

  updateNames(names) {
    this.nameP1.setText(names[0]);
    this.nameP2.setText(names[1]);
  }

  updateScores(scores) {
    this.scoreP1.setText(String(scores[0]));
    this.scoreP2.setText(String(scores[1]));
  }

  updateRound(current, total) {
    this.roundText.setText(`ROUND ${current} / ${total}`);
  }

  updateWind(wind) {
    const strength = Math.round((Math.abs(wind.value) / MAX_WIND) * 100);
    const arrow = wind.value === 0 ? '·' : wind.value > 0 ? '→' : '←';
    this.windText.setText(`WIND ${strength}%  ${arrow}`);
  }

  showBanner(message, duration = 1200) {
    this.banner.setText(message).setAlpha(1).setScale(0.7);
    this.scene.tweens.add({ targets: this.banner, scale: 1, duration: 220, ease: 'Back.out' });
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: duration, duration: 300 });
  }
}
