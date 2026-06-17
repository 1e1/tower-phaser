import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config/constants.js';

// Minimal boot scene. Lot 1 draws everything procedurally, so no external
// assets are loaded yet; the scene simply shows a title card and hands over
// to the setup screen on a key press.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    const cx = GAME_WIDTH / 2;

    this.add
      .text(cx, GAME_HEIGHT * 0.32, 'TOWER DUEL', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '96px',
        color: COLORS.hud,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.46, 'A two-player artillery duel', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '30px',
        color: COLORS.hudDim,
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(cx, GAME_HEIGHT * 0.7, 'Press any key to start', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '28px',
        color: COLORS.hud,
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: prompt,
      alpha: 0.2,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.input.keyboard.once('keydown', () => this.scene.start('Setup'));
    this.input.once('pointerdown', () => this.scene.start('Setup'));
  }
}
