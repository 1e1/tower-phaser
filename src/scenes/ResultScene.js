import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config/constants.js';

// End-of-match summary with the final score and a restart prompt.
export default class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  init(data) {
    this.names = data.names;
    this.playerColors = data.colors;
    this.scores = data.scores;
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const [s1, s2] = this.scores;

    let title;
    if (s1 > s2) title = `${this.names[0]} wins!`;
    else if (s2 > s1) title = `${this.names[1]} wins!`;
    else title = "It's a draw!";

    this.add
      .text(cx, GAME_HEIGHT * 0.3, title, {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '80px',
        color: COLORS.hud,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        cx,
        GAME_HEIGHT * 0.5,
        `${this.names[0]}  ${s1}   —   ${s2}  ${this.names[1]}`,
        {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '40px',
          color: COLORS.hud,
        },
      )
      .setOrigin(0.5);

    const prompt = this.add
      .text(cx, GAME_HEIGHT * 0.74, 'Press ENTER for a new match', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '28px',
        color: COLORS.ready,
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: prompt,
      alpha: 0.3,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.input.keyboard.once('keydown-ENTER', () => this.scene.start('Setup'));
    this.input.once('pointerdown', () => this.scene.start('Setup'));
  }
}
