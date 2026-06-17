import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config/constants.js';
import { generateTextures } from '../systems/textures.js';
import Sfx from '../systems/Sfx.js';
import Client from '../net/Client.js';
import { detectRole } from '../net/device.js';
import { runBenchmark } from '../systems/benchmark.js';

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
    if (!this.registry.get('client')) {
      const client = new Client();
      client.connect();
      this.registry.set('client', client);
    }
    // Probe rendering performance and pick a quality tier (helps weak TVs).
    // Defaults to full and may downgrade to lite once the sample completes.
    if (!this.registry.get('quality')) {
      this.registry.set('quality', 'full');
      runBenchmark(this);
    }

    const role = detectRole();

    // A TV is just a display: skip the title card entirely and host straight
    // away. (A one-shot listener still unlocks audio if anyone interacts.)
    if (role === 'tv') {
      const sfx = this.registry.get('sfx');
      window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
      window.addEventListener('keydown', () => sfx.unlock(), { once: true });
      this.scene.start('Lobby', { auto: 'host' });
      return;
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

    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      this.registry.get('sfx').unlock();
      // A phone is always a player: jump straight to the join form.
      this.scene.start('Lobby', { auto: role === 'phone' ? 'join' : null });
    };
    // Window-level listeners so a tap anywhere works even where the canvas is
    // letterboxed (e.g. a phone in portrait).
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }
}
