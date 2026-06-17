import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, MAX_WIND } from '../config/constants.js';

// Full-gale slant of the rain. Calm wind = vertical (0°); ±MAX_WIND tilts the
// whole curtain to ±RAIN_MAX_TILT. ~32° reads as a driving storm without going
// so flat it stops looking like falling rain.
const RAIN_MAX_TILT = 32 * (Math.PI / 180);
const RAIN_FALL_MEAN = 640; // mid-point of the drops' speedY range, for the tilt maths
const RAIN_SPREAD = 55;     // ± horizontal jitter so each drop keeps its own trajectory

const DEPTH = {
  sky: -100,
  glow: -96,
  celestial: -95,
  mountainFar: -90,
  mountainNear: -85,
  cloud: -80,
  // Lightning sits above the parallax scenery but below the foreground (terrain,
  // towers at depth >= 0), so a flash brightens the distant layers while the
  // foreground stays in silhouette — depth ordering gives the parallax for free.
  flash: -55,
  bolt: -54,
  ambient: 8,
};

// Scenery is drawn across this horizontal span (a few screens) so the
// inter-round camera pan reveals continuous parallax. Layers use scroll
// factors < 1 so they slide slower than the foreground during the pan.
const WIDE_MIN = -GAME_WIDTH;
const WIDE_MAX = 2 * GAME_WIDTH;

// Per-biome ambient particle emitters (the wind-driven curtain / drift). `texture`
// defaults to 'spark'; the rest is the Phaser emitter config. `sand` doubles as
// the fallback for any unknown ambient id.
const AMBIENT = {
  // Fast vertical streaks; the wind drives the tilt (see update) so the whole
  // curtain leans the way the wind blows.
  rain: {
    texture: 'raindrop',
    x: { min: WIDE_MIN, max: WIDE_MAX }, y: -20, lifespan: 2400,
    speedY: { min: 520, max: 760 }, speedX: { min: -10, max: 10 },
    scale: { min: 0.6, max: 1.1 }, alpha: { min: 0.25, max: 0.6 },
    frequency: 14, quantity: 2,
  },
  snow: {
    x: { min: WIDE_MIN, max: WIDE_MAX }, y: -10, lifespan: 13000,
    speedY: { min: 35, max: 75 }, speedX: { min: -20, max: 20 },
    scale: { min: 0.3, max: 0.8 }, alpha: { min: 0.5, max: 0.95 },
    frequency: 120, quantity: 1,
  },
  leaves: {
    x: { min: WIDE_MIN, max: WIDE_MAX }, y: -10, lifespan: 11000,
    speedY: { min: 25, max: 55 }, speedX: { min: -35, max: 35 },
    rotate: { min: 0, max: 360 }, scale: { min: 0.3, max: 0.7 },
    alpha: { min: 0.5, max: 0.9 }, frequency: 220, quantity: 1,
  },
  embers: {
    x: { min: WIDE_MIN, max: WIDE_MAX }, y: GAME_HEIGHT + 10, lifespan: 4200,
    speedY: { min: -110, max: -45 }, speedX: { min: -25, max: 25 },
    scale: { start: 0.7, end: 0 }, alpha: { start: 0.9, end: 0 },
    blendMode: 'ADD', frequency: 90, quantity: 1,
  },
  sand: {
    x: WIDE_MIN, y: { min: 0, max: GAME_HEIGHT * 0.8 }, lifespan: 8000,
    speedX: { min: 70, max: 150 }, speedY: { min: -12, max: 12 },
    scale: { min: 0.2, max: 0.5 }, alpha: { min: 0.2, max: 0.5 },
    frequency: 70, quantity: 1,
  },
};

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
    if (quality !== 'lite') this.spawnLightning();
  }

  drawSky() {
    const g = this.scene.add.graphics().setDepth(DEPTH.sky).setScrollFactor(0);
    this.skyGfx = g;
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

    const { texture = 'spark', ...config } = AMBIENT[ambient] || AMBIENT.sand;
    this.emitter = this.scene.add
      .particles(0, 0, texture, { ...config, tint: ambientColor })
      .setDepth(DEPTH.ambient)
      .setScrollFactor(0.8);
  }

  // Parallax lightning for the storm biome: a full-screen additive flash (behind
  // the foreground) plus a jagged bolt in the distant layer, on a random cadence.
  spawnLightning() {
    const cfg = this.biome.lightning;
    if (!cfg) return;
    const flash = this.scene.add
      .graphics()
      .setDepth(DEPTH.flash)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    flash.fillStyle(0xbcd0ff, 1);
    flash.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    flash.setAlpha(0);
    const bolt = this.scene.add.graphics().setDepth(DEPTH.bolt).setScrollFactor(0.25).setAlpha(0);
    this.lightning = {
      cfg,
      flash,
      bolt,
      energy: 0,
      peak: 0.45,
      next: Phaser.Math.FloatBetween(cfg.every[0], cfg.every[1]),
    };
  }

  // Jagged bolt via midpoint displacement, returned as a point list.
  makeBolt(x0, y0, x1, y1, disp) {
    let pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    for (let it = 0; it < 5; it += 1) {
      const next = [];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        next.push(a);
        next.push({ x: (a.x + b.x) / 2 + Phaser.Math.FloatBetween(-disp, disp), y: (a.y + b.y) / 2 });
      }
      next.push(pts[pts.length - 1]);
      pts = next;
      disp *= 0.55;
    }
    return pts;
  }

  strikeLightning() {
    const L = this.lightning;
    const cfg = L.cfg;
    const dist = Math.random();               // 0 = close (bright, loud), 1 = far (faint)
    const near = 1 - dist;
    L.energy = 1 - dist * 0.5;
    L.peak = 0.5 * (cfg.farResponse ?? 0.9);
    const x0 = Phaser.Math.Between(GAME_WIDTH * 0.2, GAME_WIDTH * 0.8);
    const pts = this.makeBolt(x0, GAME_HEIGHT * 0.05, x0 + Phaser.Math.Between(-80, 80), GAME_HEIGHT * 0.55, GAME_WIDTH * 0.16);
    L.bolt.clear();
    L.bolt.lineStyle(1 + 2.5 * near, 0xeaf0ff, 1);
    L.bolt.beginPath();
    pts.forEach((p, i) => (i ? L.bolt.lineTo(p.x, p.y) : L.bolt.moveTo(p.x, p.y)));
    L.bolt.strokePath();
    if (this.scene.sfx) this.scene.sfx.thunder((cfg.thunderDelay ?? 1.1) * (0.4 + dist * 1.6));
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
      if (this.biome.ambient === 'rain') {
        // Rain falls too fast for gravity (an acceleration) to bend it visibly over
        // such a short drop, so the wind sets the drops' horizontal launch VELOCITY
        // instead: the whole curtain tilts by a real angle, 0° when calm up to
        // ±RAIN_MAX_TILT at full wind. The ± spread keeps every drop on its own
        // slightly different slant rather than a rigid sheet. (speedX is a min/max
        // op, so its range must be reloaded — assigning a number is clamped away.)
        const tilt = Phaser.Math.Clamp(this.windValue / MAX_WIND, -1, 1) * RAIN_MAX_TILT;
        const vx = Math.tan(tilt) * RAIN_FALL_MEAN;
        this.emitter.gravityX = 0;
        this.emitter.ops.speedX.loadConfig({ speedX: { min: vx - RAIN_SPREAD, max: vx + RAIN_SPREAD } });
      } else {
        this.emitter.gravityX = Phaser.Math.Clamp(windFx, -220, 220);
      }
    }

    if (this.lightning) {
      const L = this.lightning;
      L.next -= dt;
      if (L.next <= 0) {
        this.strikeLightning();
        L.next = Phaser.Math.FloatBetween(L.cfg.every[0], L.cfg.every[1]);
      }
      L.energy = Math.max(0, L.energy - dt * 3.0);
      L.flash.setAlpha(L.energy * L.peak);
      L.bolt.setAlpha(Math.min(1, L.energy * 2.2));
    }
  }

  // Every display object this background owns, for bulk show/hide/teardown.
  objects() {
    const objs = [this.skyGfx, this.celestialGlow, this.celestialBody, ...this.ridges.map((r) => r.gfx), ...this.clouds];
    if (this.emitter) objs.push(this.emitter);
    if (this.lightning) objs.push(this.lightning.flash, this.lightning.bolt);
    return objs.filter(Boolean);
  }

  // Hide the whole scenery while it is pre-built in the lobby, then reveal it on
  // match entry (see TvScene/LocalScene lobby prewarm).
  setVisible(v) {
    this.objects().forEach((o) => o.setVisible(v));
    return this;
  }

  destroy() {
    this.objects().forEach((o) => o.destroy());
    this.clouds = [];
    this.ridges = [];
    this.emitter = null;
    this.lightning = null;
  }
}
