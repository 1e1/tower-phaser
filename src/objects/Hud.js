import { GAME_WIDTH, COLORS, MAX_WIND, AIM } from '../config/constants.js';

// Top status bar (names, scores, round counter, wind gauge) plus the per-player
// aiming readouts shown above each tower.
export default class Hud {
  constructor(scene, names, colors) {
    this.scene = scene;
    const cx = GAME_WIDTH / 2;
    const D = 1000; // HUD renders above scenery, particles and explosions

    this.bar = scene.add.graphics().setDepth(D);
    this.bar.fillStyle(0x000000, 0.32);
    this.bar.fillRect(0, 0, GAME_WIDTH, 74);

    const nameStyle = (color) => ({
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '28px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      fontStyle: 'bold',
    });
    const scoreStyle = {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '40px',
      color: COLORS.hud,
      fontStyle: 'bold',
    };

    scene.add.text(28, 14, names[0], nameStyle(colors[0])).setOrigin(0, 0).setDepth(D);
    scene.add
      .text(GAME_WIDTH - 28, 14, names[1], nameStyle(colors[1]))
      .setOrigin(1, 0)
      .setDepth(D);

    this.scoreP1 = scene.add.text(28, 40, '0', scoreStyle).setOrigin(0, 0).setDepth(D);
    this.scoreP2 = scene.add
      .text(GAME_WIDTH - 28, 40, '0', scoreStyle)
      .setOrigin(1, 0)
      .setDepth(D);

    this.roundText = scene.add
      .text(cx, 14, '', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '24px',
        color: COLORS.hudDim,
      })
      .setOrigin(0.5, 0)
      .setDepth(D);

    this.windText = scene.add
      .text(cx, 44, '', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '20px',
        color: COLORS.hud,
      })
      .setOrigin(0.5, 0)
      .setDepth(D);
    this.windArrow = scene.add.graphics().setDepth(D);

    // Per-tower aiming readouts.
    this.aimTexts = [
      scene.add.text(150, 96, '', this.aimStyle()).setOrigin(0.5, 0).setDepth(D),
      scene.add.text(GAME_WIDTH - 150, 96, '', this.aimStyle()).setOrigin(0.5, 0).setDepth(D),
    ];

    this.banner = scene.add
      .text(cx, 200, '', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '54px',
        color: COLORS.hud,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(D);
  }

  aimStyle() {
    return {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '22px',
      color: COLORS.hud,
      align: 'center',
    };
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
    const dir = wind.value === 0 ? 'CALM' : wind.value > 0 ? 'EAST' : 'WEST';
    this.windText.setText(`WIND  ${strength}%  ${dir}`);

    const g = this.windArrow;
    g.clear();
    if (wind.value === 0) return;
    const cx = GAME_WIDTH / 2;
    const y = 38;
    const len = 26 + (Math.abs(wind.value) / MAX_WIND) * 34;
    const sign = Math.sign(wind.value);
    const x0 = cx - sign * len - (sign > 0 ? 92 : -92);
    const x1 = x0 + sign * len;
    g.lineStyle(4, 0xffffff, 0.9);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.moveTo(x1, y);
    g.lineTo(x1 - sign * 10, y - 7);
    g.moveTo(x1, y);
    g.lineTo(x1 - sign * 10, y + 7);
    g.strokePath();
  }

  updateAim(towers) {
    towers.forEach((tower, i) => {
      const status = tower.ready ? 'READY' : 'aiming';
      const text = this.aimTexts[i];
      text.setText(
        `Angle ${Math.round(tower.angle)}°   Power ${Math.round(
          ((tower.power - AIM.minPower) / (AIM.maxPower - AIM.minPower)) * 100,
        )}%\n${status}`,
      );
      text.setColor(tower.ready ? COLORS.ready : COLORS.hud);
    });
  }

  // Spectator status: ready/aiming only, never the actual angle or power.
  updateStatus(towers) {
    towers.forEach((tower, i) => {
      const text = this.aimTexts[i];
      text.setText(tower.ready ? 'READY' : 'aiming…');
      text.setColor(tower.ready ? COLORS.ready : COLORS.hudDim);
    });
  }

  showBanner(message, duration = 1200) {
    this.banner.setText(message).setAlpha(1).setScale(0.7);
    this.scene.tweens.add({
      targets: this.banner,
      scale: 1,
      duration: 220,
      ease: 'Back.out',
    });
    this.scene.tweens.add({
      targets: this.banner,
      alpha: 0,
      delay: duration,
      duration: 300,
    });
  }
}
