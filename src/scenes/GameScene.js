import Phaser from 'phaser';

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  COLORS,
  AIM,
  PHYSICS,
  CRATER_RADIUS,
} from '../config/constants.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Projectile from '../objects/Projectile.js';
import Hud from '../objects/Hud.js';
import Background from '../objects/Background.js';
import Wind from '../systems/Wind.js';
import { BIOMES } from '../config/biomes.js';

const STATE = {
  AIMING: 'aiming',
  FIRING: 'firing',
  RESOLVING: 'resolving',
};

// Core match scene: simultaneous aiming, synchronized volley, collision
// resolution, scoring, and round/match progression.
export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  init(data) {
    this.names = data.names;
    this.playerColors = data.colors;
    this.totalRounds = data.totalRounds;
    this.biome = data.biome || BIOMES[0];
    this.scores = [0, 0];
    this.roundsPlayed = 0;
    this.currentRound = 1;
  }

  create() {
    this.sfx = this.registry.get('sfx');
    this.background = new Background(this, this.biome);

    this.wind = new Wind();
    this.terrain = new Terrain(this, this.biome.terrain);
    this.terrain.generate();

    this.towers = [
      new Tower(this, 120, this.terrain.heightAt(120), this.playerColors[0], 1),
      new Tower(
        this,
        GAME_WIDTH - 120,
        this.terrain.heightAt(GAME_WIDTH - 120),
        this.playerColors[1],
        -1,
      ),
    ];
    this.towers.forEach((t) => t.gfx.setDepth(1));

    this.createEmitters();

    this.aimGfx = this.add.graphics().setDepth(4);
    this.shotGfx = this.add.graphics().setDepth(5);

    this.hud = new Hud(this, this.names, this.playerColors);
    this.hud.updateScores(this.scores);
    this.hud.updateRound(this.currentRound, this.totalRounds);
    this.hud.updateWind(this.wind);

    this.setupInput();

    this.projectiles = [];
    this.turnHits = [false, false];
    this.state = STATE.AIMING;
  }

  setupInput() {
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,W,A,S,D,ENTER');
    this.controls = [
      this.input.keyboard.addKeys({
        powerUp: 'W',
        powerDown: 'S',
        angleDown: 'A',
        angleUp: 'D',
        fire: 'SPACE',
      }),
      this.input.keyboard.addKeys({
        powerUp: 'UP',
        powerDown: 'DOWN',
        angleDown: 'LEFT',
        angleUp: 'RIGHT',
        fire: 'ENTER',
      }),
    ];

    this.input.keyboard.on('keydown-M', () => {
      const on = this.sfx.toggle();
      this.hud.showBanner(on ? 'Sound on' : 'Sound off', 700);
    });
  }

  // Persistent particle emitters, reused for muzzle flashes and explosions.
  createEmitters() {
    this.flashEmitter = this.add
      .particles(0, 0, 'flash', {
        lifespan: 220,
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(6);

    this.sparkEmitter = this.add
      .particles(0, 0, 'spark', {
        lifespan: { min: 250, max: 650 },
        speed: { min: 90, max: 340 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 420,
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(6);

    this.debrisEmitter = this.add
      .particles(0, 0, 'spark', {
        lifespan: { min: 400, max: 950 },
        speed: { min: 60, max: 280 },
        angle: { min: 190, max: 350 },
        scale: { start: 1.3, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 700,
        tint: this.biome.terrain.dark,
        emitting: false,
      })
      .setDepth(6);

    this.smokeEmitter = this.add
      .particles(0, 0, 'smoke', {
        lifespan: { min: 500, max: 1100 },
        speed: { min: 10, max: 60 },
        scale: { start: 0.6, end: 2.4 },
        alpha: { start: 0.45, end: 0 },
        emitting: false,
      })
      .setDepth(6);
  }

  update(_time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    this.background.update(dt);

    if (this.state === STATE.AIMING) {
      this.handleAiming(dt);
    } else if (this.state === STATE.FIRING) {
      this.handleFiring(dt);
    }
  }

  handleAiming(dt) {
    this.controls.forEach((keys, i) => {
      const tower = this.towers[i];
      if (tower.ready) return;

      if (keys.angleUp.isDown) tower.adjustAngle(AIM.angleRate * dt);
      if (keys.angleDown.isDown) tower.adjustAngle(-AIM.angleRate * dt);
      if (keys.powerUp.isDown) tower.adjustPower(AIM.powerRate * dt);
      if (keys.powerDown.isDown) tower.adjustPower(-AIM.powerRate * dt);

      if (Phaser.Input.Keyboard.JustDown(keys.fire)) {
        tower.ready = true;
      }
      tower.draw();
    });

    this.drawAimGuides();
    this.hud.updateAim(this.towers);

    if (this.towers[0].ready && this.towers[1].ready) {
      this.fire();
    }
  }

  drawAimGuides() {
    const g = this.aimGfx;
    g.clear();
    this.towers.forEach((tower) => {
      if (tower.ready) return;
      const v = tower.aimVector;
      const len = 50 + (tower.power / AIM.maxPower) * 70;
      const m = tower.muzzle;
      g.lineStyle(3, tower.color, 0.6);
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(m.x + v.x * len, m.y + v.y * len);
      g.strokePath();
    });
  }

  fire() {
    this.aimGfx.clear();
    this.projectiles = this.towers.map((tower, i) => {
      const v = tower.aimVector;
      const speed = tower.power * PHYSICS.speedScale;
      const m = tower.muzzle;
      this.flashEmitter.emitParticleAt(m.x, m.y, 1);
      this.sparkEmitter.emitParticleAt(m.x, m.y, 6);
      this.smokeEmitter.emitParticleAt(m.x, m.y, 2);
      return new Projectile(m.x, m.y, v.x * speed, v.y * speed, i);
    });
    this.sfx.boom();
    this.cameras.main.shake(110, 0.004);
    this.turnHits = [false, false];
    this.state = STATE.FIRING;
  }

  handleFiring(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.update(dt, this.wind.acceleration);
      this.checkCollision(p);
    }
    this.drawShots();

    if (this.projectiles.every((p) => !p.alive)) {
      this.shotGfx.clear();
      this.resolveTurn();
    }
  }

  checkCollision(p) {
    // Far out of bounds horizontally, or fallen below the screen: a miss.
    if (p.x < -60 || p.x > GAME_WIDTH + 60 || p.y > GAME_HEIGHT + 40) {
      p.alive = false;
      return;
    }

    // Opponent tower hit.
    const opponent = this.towers[p.owner === 0 ? 1 : 0];
    if (Phaser.Geom.Rectangle.Contains(opponent.bounds, p.x, p.y)) {
      p.alive = false;
      this.turnHits[p.owner] = true;
      this.explodeAt(p.x, p.y, opponent.color, true);
      return;
    }

    // Ground hit (only once the shell is on screen, to avoid edge artefacts).
    if (p.y > 0 && this.terrain.collides(p.x, p.y)) {
      p.alive = false;
      this.terrain.carve(p.x, p.y, CRATER_RADIUS);
      this.explodeAt(p.x, p.y, this.biome.terrain.edge, false);
    }
  }

  explodeAt(x, y, ringColor, isTowerHit) {
    // Expanding shockwave ring.
    const ring = this.add.circle(x, y, 6, ringColor, 0.9).setDepth(7);
    this.tweens.add({
      targets: ring,
      radius: isTowerHit ? 60 : 38,
      alpha: 0,
      duration: isTowerHit ? 420 : 320,
      onComplete: () => ring.destroy(),
    });

    this.flashEmitter.emitParticleAt(x, y, 1);
    this.smokeEmitter.emitParticleAt(x, y, isTowerHit ? 5 : 3);
    this.debrisEmitter.emitParticleAt(x, y, isTowerHit ? 16 : 10);

    if (isTowerHit) {
      this.sparkEmitter.emitParticleAt(x, y, 18);
      this.sfx.hit();
      this.cameras.main.shake(260, 0.012);
    } else {
      this.sparkEmitter.emitParticleAt(x, y, 8);
      this.sfx.explosion();
      this.cameras.main.shake(150, 0.006);
    }
  }

  drawShots() {
    const g = this.shotGfx;
    g.clear();
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const color = p.owner === 0 ? COLORS.projectileP1 : COLORS.projectileP2;
      // Fading trail.
      p.trail.forEach((pt, idx) => {
        const a = (idx / p.trail.length) * 0.5;
        g.fillStyle(color, a);
        g.fillCircle(pt.x, pt.y, 3);
      });
      // Head.
      g.fillStyle(color, 1);
      g.fillCircle(p.x, p.y, 5);
    }
  }

  resolveTurn() {
    this.state = STATE.RESOLVING;
    const [h1, h2] = this.turnHits;

    if (!h1 && !h2) {
      // Nobody connected: same round continues with fresh wind.
      this.hud.showBanner('Both missed!', 900);
      this.time.delayedCall(1100, () => this.nextTurn());
      return;
    }

    if (h1) this.scores[0] += 1;
    if (h2) this.scores[1] += 1;
    this.hud.updateScores(this.scores);
    this.roundsPlayed += 1;

    let message;
    if (h1 && h2) message = 'Double hit!';
    else if (h1) message = `${this.names[0]} scores!`;
    else message = `${this.names[1]} scores!`;
    this.hud.showBanner(message, 1300);

    this.time.delayedCall(1700, () => {
      if (this.roundsPlayed >= this.totalRounds) {
        this.endMatch();
      } else {
        this.nextRound();
      }
    });
  }

  nextTurn() {
    this.wind.randomize();
    this.hud.updateWind(this.wind);
    this.towers.forEach((t) => t.reset());
    this.projectiles = [];
    this.state = STATE.AIMING;
  }

  nextRound() {
    this.currentRound += 1;
    this.terrain.generate();
    this.hud.updateRound(this.currentRound, this.totalRounds);
    this.nextTurn();
  }

  endMatch() {
    this.scene.start('Result', {
      names: this.names,
      colors: this.playerColors,
      scores: this.scores,
    });
  }
}
