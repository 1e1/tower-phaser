import Phaser from 'phaser';

import { generateTextures } from '../systems/textures.js';
import Sfx from '../systems/Sfx.js';
import Client from '../net/Client.js';
import { detectRole } from '../net/device.js';

// Boot scene. Prepares the shared systems (procedural textures, audio, network
// client) and routes straight to the right entry — no title/"press start"
// screen. The device decides:
//   TV      -> host automatically and show the battlefield
//   phone   -> jump to the "join as player" form (code + name)
//   else    -> show the host / join choice
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // The game emblem, shown on the home/lobby screens. Rasterised large so it
    // stays crisp on a TV; it is the only shipped image asset (text SVG).
    this.load.svg('logo', 'icon.svg', { width: 320, height: 320 });
  }

  create() {
    generateTextures(this);
    if (!this.registry.get('sfx')) this.registry.set('sfx', new Sfx());
    if (!this.registry.get('client')) {
      const client = new Client();
      client.connect();
      this.registry.set('client', client);
    }
    if (!this.registry.get('quality')) this.registry.set('quality', 'full');

    // Audio can only start after a gesture; unlock on the first interaction.
    const sfx = this.registry.get('sfx');
    window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
    window.addEventListener('keydown', () => sfx.unlock(), { once: true });

    const role = detectRole();
    const auto = role === 'tv' ? 'host' : role === 'phone' ? 'join' : null;
    this.scene.start('Lobby', { auto });
  }
}
