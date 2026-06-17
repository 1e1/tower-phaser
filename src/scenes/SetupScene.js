import Phaser from 'phaser';

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  COLORS,
  WIN_OPTIONS,
} from '../config/constants.js';
import { BIOMES } from '../config/biomes.js';

const MAX_NAME_LENGTH = 12;

// Pre-game configuration: player names and the number of rounds.
// Fully keyboard-driven to stay inside the Phaser canvas (no DOM overlay):
//   Up/Down  -> move between fields
//   Type     -> edit the selected name
//   Left/Right -> change the round count
//   Enter    -> start the match
export default class SetupScene extends Phaser.Scene {
  constructor() {
    super('Setup');
  }

  create() {
    this.sfx = this.registry.get('sfx');
    this.fields = [
      { type: 'name', label: 'Player 1', value: 'Player 1', color: COLORS.towerP1 },
      { type: 'name', label: 'Player 2', value: 'Player 2', color: COLORS.towerP2 },
      { type: 'rounds', label: 'Win rounds', index: 2 },
      { type: 'biome', label: 'Biome', index: 0 },
    ];
    this.selected = 0;

    const cx = GAME_WIDTH / 2;

    this.add
      .text(cx, 90, 'MATCH SETUP', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '64px',
        color: COLORS.hud,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.rowTexts = this.fields.map((field, i) => {
      const y = 240 + i * 90;
      const label = this.add
        .text(cx - 320, y, '', {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '34px',
          color: COLORS.hudDim,
        })
        .setOrigin(0, 0.5);
      const value = this.add
        .text(cx + 40, y, '', {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '34px',
          color: COLORS.hud,
        })
        .setOrigin(0, 0.5);
      return { label, value };
    });

    this.preview = this.add.graphics();

    this.add
      .text(
        cx,
        GAME_HEIGHT - 120,
        'Up / Down: select field      Left / Right: change value      Type: edit name',
        {
          fontFamily: 'Trebuchet MS, sans-serif',
          fontSize: '22px',
          color: COLORS.hudDim,
        },
      )
      .setOrigin(0.5);

    this.startHint = this.add
      .text(cx, GAME_HEIGHT - 70, 'Press ENTER to start', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '28px',
        color: COLORS.ready,
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: this.startHint,
      alpha: 0.3,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.input.keyboard.on('keydown', this.onKey, this);
    this.refresh();
  }

  onKey(event) {
    const field = this.fields[this.selected];

    switch (event.key) {
      case 'ArrowDown':
        this.selected = (this.selected + 1) % this.fields.length;
        this.sfx.blip(520);
        break;
      case 'ArrowUp':
        this.selected = (this.selected - 1 + this.fields.length) % this.fields.length;
        this.sfx.blip(520);
        break;
      case 'ArrowLeft':
        this.cycle(field, -1);
        break;
      case 'ArrowRight':
        this.cycle(field, 1);
        break;
      case 'Backspace':
        if (field.type === 'name') {
          field.value = field.value.slice(0, -1);
        }
        break;
      case 'Enter':
        this.sfx.blip(880);
        this.start();
        return;
      default:
        if (
          field.type === 'name' &&
          event.key.length === 1 &&
          field.value.length < MAX_NAME_LENGTH &&
          /[\w \-']/.test(event.key)
        ) {
          field.value += event.key;
        }
        break;
    }

    this.refresh();
  }

  cycle(field, dir) {
    if (field.type === 'rounds') {
      field.index = (field.index + dir + WIN_OPTIONS.length) % WIN_OPTIONS.length;
      this.sfx.blip(620);
      this.refresh();
    } else if (field.type === 'biome') {
      field.index = (field.index + dir + BIOMES.length) % BIOMES.length;
      this.sfx.blip(700);
      this.refresh();
    }
  }

  refresh() {
    this.fields.forEach((field, i) => {
      const row = this.rowTexts[i];
      const active = i === this.selected;
      row.label.setText(field.label);
      row.label.setColor(active ? COLORS.hud : COLORS.hudDim);

      if (field.type === 'name') {
        const caret = active ? '_' : '';
        row.value.setText(`${field.value || ''}${caret}`);
        row.value.setColor(`#${field.color.toString(16).padStart(6, '0')}`);
      } else if (field.type === 'rounds') {
        row.value.setText(`< First to ${WIN_OPTIONS[field.index]} >`);
        row.value.setColor(active ? COLORS.hud : COLORS.hudDim);
      } else {
        row.value.setText(`< ${BIOMES[field.index].name} >`);
        row.value.setColor(active ? COLORS.hud : COLORS.hudDim);
      }
    });

    this.drawBiomePreview();
  }

  drawBiomePreview() {
    const biome = BIOMES[this.fields[3].index];
    const g = this.preview;
    const x = GAME_WIDTH / 2 + 320;
    const y = 240;
    const w = 200;
    const h = 130;
    g.clear();
    g.fillStyle(biome.sky[0], 1);
    g.fillRect(x, y, w, h * 0.6);
    g.fillStyle(biome.sky[1], 1);
    g.fillRect(x, y + h * 0.6, w, h * 0.18);
    g.fillStyle(biome.terrain.fill, 1);
    g.fillRect(x, y + h * 0.78, w, h * 0.22);
    g.lineStyle(3, biome.terrain.edge, 1);
    g.strokeRect(x, y, w, h);
    g.fillStyle(biome.celestial.color, 1);
    g.fillCircle(x + w * 0.78, y + h * 0.28, 14);
  }

  start() {
    const [p1, p2, rounds, biome] = this.fields;
    this.input.keyboard.off('keydown', this.onKey, this);
    this.scene.start('Game', {
      names: [p1.value.trim() || 'Player 1', p2.value.trim() || 'Player 2'],
      colors: [p1.color, p2.color],
      winsNeeded: WIN_OPTIONS[rounds.index],
      biome: BIOMES[biome.index],
    });
  }
}
