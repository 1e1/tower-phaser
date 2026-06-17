import Phaser from 'phaser';

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  COLORS,
  ROUND_OPTIONS,
} from '../config/constants.js';

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
    this.fields = [
      { type: 'name', label: 'Player 1', value: 'Player 1', color: COLORS.towerP1 },
      { type: 'name', label: 'Player 2', value: 'Player 2', color: COLORS.towerP2 },
      { type: 'rounds', label: 'Rounds', index: 1 },
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

    this.add
      .text(
        cx,
        GAME_HEIGHT - 120,
        'Up / Down: select field      Left / Right: change rounds      Type: edit name',
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
        break;
      case 'ArrowUp':
        this.selected = (this.selected - 1 + this.fields.length) % this.fields.length;
        break;
      case 'ArrowLeft':
        if (field.type === 'rounds') {
          field.index = (field.index - 1 + ROUND_OPTIONS.length) % ROUND_OPTIONS.length;
        }
        break;
      case 'ArrowRight':
        if (field.type === 'rounds') {
          field.index = (field.index + 1) % ROUND_OPTIONS.length;
        }
        break;
      case 'Backspace':
        if (field.type === 'name') {
          field.value = field.value.slice(0, -1);
        }
        break;
      case 'Enter':
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
      } else {
        row.value.setText(`< ${ROUND_OPTIONS[field.index]} >`);
        row.value.setColor(active ? COLORS.hud : COLORS.hudDim);
      }
    });
  }

  start() {
    const [p1, p2, rounds] = this.fields;
    this.input.keyboard.off('keydown', this.onKey, this);
    this.scene.start('Game', {
      names: [p1.value.trim() || 'Player 1', p2.value.trim() || 'Player 2'],
      colors: [p1.color, p2.color],
      totalRounds: ROUND_OPTIONS[rounds.index],
    });
  }
}
