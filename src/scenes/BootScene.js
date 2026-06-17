import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config/constants.js';
import { generateTextures } from '../systems/textures.js';
import Sfx from '../systems/Sfx.js';

// Boot scene. Everything is drawn procedurally, so instead of loading assets it
// generates the reusable particle textures and prepares the shared audio
// system, then shows a title card and hands over to the setup screen.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    generateTextures(this);
    if (!this.registry.get('sfx')) {
      this.registry.set('sfx', new Sfx());
    }

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

    const go = () => {
      this.registry.get('sfx').unlock();
      this.scene.start('Setup');
    };
    this.input.keyboard.once('keydown', go);
    this.input.once('pointerdown', go);
  }
}
