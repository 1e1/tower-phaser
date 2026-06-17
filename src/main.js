import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from './config/constants.js';
import BootScene from './scenes/BootScene.js';
import SetupScene from './scenes/SetupScene.js';
import GameScene from './scenes/GameScene.js';
import ResultScene from './scenes/ResultScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: COLORS.skyTop,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, SetupScene, GameScene, ResultScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
