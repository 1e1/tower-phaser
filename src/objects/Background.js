import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';

const DEPTH = {
  sky: -100,
  glow: -96,
  celestial: -95,
  mountainFar: -90,
  mountainNear: -85,
  cloud: -80,
  ambient: 8,
};

// Layered, animated scenery for a biome: sky gradient, sun/moon with glow,
// two parallax mountain ridges, drifting clouds and an ambient particle effect.
export default class Background {
  constructor(scene, biome) {
    this.scene = scene;
    this.biome = biome;
    this.clouds = [];

    this.drawSky();
    this.drawCelestial();
    this.drawMountains();
    this.spawnClouds();
    this.spawnAmbient();
  }

  drawSky() {
    const g = this.scene.add.graphics().setDepth(DEPTH.sky);
    const [topInt, bottomInt] = this.biome.sky;
    const top = Phaser.Display.Color.IntegerToColor(topInt);
    const bottom = Phaser.Display.Color.IntegerToColor(bottomInt);
    const bands = 48;
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, 1, t);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, (GAME_HEIGHT / bands) * i, GAME_WIDTH, GAME_HEIGHT / bands + 1);
    }
  }

  drawCelestial() {
    const { celestial } = this.biome;
    const x = GAME_WIDTH * celestial.x;
    const y = GAME_HEIGHT * celestial.y;

    const glow = this.scene.add
      .image(x, y, 'flash')
      .setDepth(DEPTH.glow)
      .setTint(celestial.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(celestial.radius / 10)
      .setAlpha(0.5);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0.8,
      scale: glow.scale * 1.08,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    const body = this.scene.add.graphics().setDepth(DEPTH.celestial);
    body.fillStyle(celestial.color, 1);
    body.fillCircle(x, y, celestial.radius);
  }

  ridge(color, baseY, amp, depth) {
    const g = this.scene.add.graphics().setDepth(depth);
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(0, GAME_HEIGHT);
    const seed = depth;
    for (let x = 0; x <= GAME_WIDTH; x += 8) {
      const t = x / GAME_WIDTH;
      const y =
        baseY -
        amp * Math.sin(t * 4 + seed) -
        amp * 0.5 * Math.sin(t * 9 + seed * 2);
      g.lineTo(x, y);
    }
    g.lineTo(GAME_WIDTH, GAME_HEIGHT);
    g.closePath();
    g.fillPath();
  }

  drawMountains() {
    const [far, near] = this.biome.mountains;
    this.ridge(far, GAME_HEIGHT * 0.62, 70, DEPTH.mountainFar);
    this.ridge(near, GAME_HEIGHT * 0.72, 50, DEPTH.mountainNear);
  }

  spawnClouds() {
    const { cloud } = this.biome;
    if (!cloud) return;
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const scale = Phaser.Math.FloatBetween(0.5, 1.1);
      const sprite = this.scene.add
        .image(
          Phaser.Math.Between(0, GAME_WIDTH),
          Phaser.Math.Between(40, GAME_HEIGHT * 0.32),
          'cloud',
        )
        .setDepth(DEPTH.cloud)
        .setTint(cloud.color)
        .setAlpha(cloud.alpha * Phaser.Math.FloatBetween(0.6, 1))
        .setScale(scale);
      sprite.driftSpeed = Phaser.Math.FloatBetween(4, 14) * (scale > 0.8 ? 1 : 0.6);
      this.clouds.push(sprite);
    }
  }

  spawnAmbient() {
    const { ambient, ambientColor } = this.biome;
    if (!ambient) return;

    const common = { tint: ambientColor, depth: DEPTH.ambient };
    let config;

    switch (ambient) {
      case 'snow':
        config = {
          x: { min: 0, max: GAME_WIDTH },
          y: -10,
          lifespan: 13000,
          speedY: { min: 35, max: 75 },
          speedX: { min: -20, max: 20 },
          scale: { min: 0.3, max: 0.8 },
          alpha: { min: 0.5, max: 0.95 },
          frequency: 120,
          quantity: 1,
        };
        break;
      case 'leaves':
        config = {
          x: { min: 0, max: GAME_WIDTH },
          y: -10,
          lifespan: 11000,
          speedY: { min: 25, max: 55 },
          speedX: { min: -35, max: 35 },
          rotate: { min: 0, max: 360 },
          scale: { min: 0.3, max: 0.7 },
          alpha: { min: 0.5, max: 0.9 },
          frequency: 220,
          quantity: 1,
        };
        break;
      case 'embers':
        config = {
          x: { min: 0, max: GAME_WIDTH },
          y: GAME_HEIGHT + 10,
          lifespan: 4200,
          speedY: { min: -110, max: -45 },
          speedX: { min: -25, max: 25 },
          scale: { start: 0.7, end: 0 },
          alpha: { start: 0.9, end: 0 },
          blendMode: 'ADD',
          frequency: 90,
          quantity: 1,
        };
        break;
      case 'sand':
      default:
        config = {
          x: -10,
          y: { min: 0, max: GAME_HEIGHT * 0.8 },
          lifespan: 8000,
          speedX: { min: 70, max: 150 },
          speedY: { min: -12, max: 12 },
          scale: { min: 0.2, max: 0.5 },
          alpha: { min: 0.2, max: 0.5 },
          frequency: 70,
          quantity: 1,
        };
        break;
    }

    this.emitter = this.scene.add
      .particles(0, 0, 'spark', { ...config, tint: common.tint })
      .setDepth(common.depth);
  }

  update(dt) {
    for (const cloud of this.clouds) {
      cloud.x += cloud.driftSpeed * dt;
      const halfWidth = (cloud.displayWidth || 220) / 2;
      if (cloud.x - halfWidth > GAME_WIDTH) {
        cloud.x = -halfWidth;
        cloud.y = Phaser.Math.Between(40, GAME_HEIGHT * 0.32);
      }
    }
  }
}
