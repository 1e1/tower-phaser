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

// Scenery is drawn across this horizontal span (a few screens) so the
// inter-round camera pan reveals continuous parallax. Layers use scroll
// factors < 1 so they slide slower than the foreground during the pan.
const WIDE_MIN = -GAME_WIDTH;
const WIDE_MAX = 2 * GAME_WIDTH;

// Layered, animated scenery for a biome: sky gradient, sun/moon with glow,
// two parallax mountain ridges, drifting clouds and an ambient particle effect.
export default class Background {
  constructor(scene, biome, quality = 'full') {
    this.scene = scene;
    this.biome = biome;
    this.quality = quality;
    this.clouds = [];
    this.ridges = [];
    this.windValue = 0;
    this.windTarget = 0;
    this.gustTime = 0;
    // Accumulated parallax distance (in foreground px) baked into the scenery so
    // the inter-round camera pan never snaps back: when the pan ends and the
    // camera scroll resets, each layer is re-placed where the pan left it, then
    // the world keeps scrolling continuously across rounds (see shiftWorld).
    this.bakedScroll = 0;

    this.drawSky();
    this.drawCelestial();
    this.drawMountains();
    this.spawnClouds();
    // The ambient particle layer is the cheapest thing to drop on weak devices.
    if (quality !== 'lite') this.spawnAmbient();
  }

  drawSky() {
    const g = this.scene.add.graphics().setDepth(DEPTH.sky).setScrollFactor(0);
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
    this.celestialFactor = 0.12;
    this.celestialBaseX = GAME_WIDTH * celestial.x;
    const x = this.celestialBaseX;
    const y = GAME_HEIGHT * celestial.y;

    this.celestialGlow = this.scene.add
      .image(x, y, 'flash')
      .setDepth(DEPTH.glow)
      .setScrollFactor(this.celestialFactor)
      .setTint(celestial.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(celestial.radius / 10)
      .setAlpha(0.5);
    this.scene.tweens.add({
      targets: this.celestialGlow,
      alpha: 0.8,
      scale: this.celestialGlow.scale * 1.08,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // The body draws its disc at the base position; cross-round drift is applied
    // by translating the graphics object in shiftWorld.
    this.celestialBody = this.scene.add.graphics().setDepth(DEPTH.celestial).setScrollFactor(this.celestialFactor);
    this.celestialBody.fillStyle(celestial.color, 1);
    this.celestialBody.fillCircle(x, y, celestial.radius);
  }

  // (Re)draw one mountain ridge. The pattern is phase-shifted by the layer's
  // share of the baked parallax, so the silhouette always fills the wide span
  // (no edge ever scrolls into view) while the mountains slide across rounds.
  drawRidge(r) {
    const g = r.gfx;
    g.clear();
    g.fillStyle(r.color, 1);
    g.beginPath();
    g.moveTo(WIDE_MIN, GAME_HEIGHT);
    const seed = r.depth;
    const shift = r.factor * this.bakedScroll;
    for (let x = WIDE_MIN; x <= WIDE_MAX; x += 8) {
      const t = (x + shift) / GAME_WIDTH;
      const y =
        r.baseY -
        r.amp * Math.sin(t * 4 + seed) -
        r.amp * 0.5 * Math.sin(t * 9 + seed * 2);
      g.lineTo(x, y);
    }
    g.lineTo(WIDE_MAX, GAME_HEIGHT);
    g.closePath();
    g.fillPath();
  }

  drawMountains() {
    const [far, near] = this.biome.mountains;
    this.ridges = [
      { color: far, baseY: GAME_HEIGHT * 0.62, amp: 70, depth: DEPTH.mountainFar, factor: 0.25,
        gfx: this.scene.add.graphics().setDepth(DEPTH.mountainFar).setScrollFactor(0.25) },
      { color: near, baseY: GAME_HEIGHT * 0.72, amp: 50, depth: DEPTH.mountainNear, factor: 0.45,
        gfx: this.scene.add.graphics().setDepth(DEPTH.mountainNear).setScrollFactor(0.45) },
    ];
    this.ridges.forEach((r) => this.drawRidge(r));
  }

  // Bake an inter-round camera pan into the scenery: called right after the pan
  // ends and the camera scroll is reset to 0, so every parallax layer keeps the
  // position the pan left it at — no snap — and the world scrolls on continuously
  // for the next round. `camDelta` is the foreground distance just panned.
  shiftWorld(camDelta) {
    this.bakedScroll += camDelta;
    this.ridges.forEach((r) => this.drawRidge(r));
    if (this.celestialBody) this.celestialBody.x = -this.celestialFactor * this.bakedScroll;
    if (this.celestialGlow) this.celestialGlow.x = this.celestialBaseX - this.celestialFactor * this.bakedScroll;
    for (const cloud of this.clouds) cloud.x -= 0.5 * camDelta; // cloud scrollFactor
    if (this.emitter) this.emitter.x -= 0.8 * camDelta; // ambient scrollFactor
  }

  spawnClouds() {
    const { cloud } = this.biome;
    if (!cloud) return;
    const count = this.quality === 'lite' ? 2 : 5;
    for (let i = 0; i < count; i += 1) {
      const scale = Phaser.Math.FloatBetween(0.5, 1.1);
      const sprite = this.scene.add
        .image(
          Phaser.Math.Between(WIDE_MIN, WIDE_MAX),
          Phaser.Math.Between(40, GAME_HEIGHT * 0.32),
          'cloud',
        )
        .setDepth(DEPTH.cloud)
        .setScrollFactor(0.5)
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
          x: { min: WIDE_MIN, max: WIDE_MAX },
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
          x: { min: WIDE_MIN, max: WIDE_MAX },
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
          x: { min: WIDE_MIN, max: WIDE_MAX },
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
          x: WIDE_MIN,
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
      .setDepth(common.depth)
      .setScrollFactor(0.8);
  }

  // Target wind (px/s^2, positive blows right). The applied value eases toward
  // it (#7) so a wind change between turns transitions smoothly — no snap.
  setWind(value) {
    this.windTarget = value;
  }

  update(dt) {
    this.gustTime += dt;
    this.windValue += (this.windTarget - this.windValue) * Math.min(1, dt * 1.6);

    // Gusty multiplier oscillating between lulls and stronger blows.
    const gust = 0.8 + 0.5 * Math.sin(this.gustTime * 1.6) + 0.3 * Math.sin(this.gustTime * 0.7 + 1);
    const windFx = this.windValue * gust;

    for (const cloud of this.clouds) {
      cloud.x += (cloud.driftSpeed + this.windValue * 0.16) * dt;
      const halfWidth = (cloud.displayWidth || 220) / 2;
      if (cloud.x - halfWidth > WIDE_MAX) cloud.x = WIDE_MIN - halfWidth;
      else if (cloud.x + halfWidth < WIDE_MIN) cloud.x = WIDE_MAX + halfWidth;
    }

    if (this.emitter) {
      this.emitter.gravityX = Phaser.Math.Clamp(windFx, -220, 220);
    }
  }
}
