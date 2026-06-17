import Phaser from 'phaser';

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  COLORS,
  AIM,
  PHYSICS,
} from '../config/constants.js';
import Terrain from '../objects/Terrain.js';
import Tower from '../objects/Tower.js';
import Projectile from '../objects/Projectile.js';
import Hud from '../objects/Hud.js';
import Wind from '../systems/Wind.js';

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
    this.scores = [0, 0];
    this.roundsPlayed = 0;
    this.currentRound = 1;
  }

  create() {
    this.drawSky();

    this.wind = new Wind();
    this.terrain = new Terrain(this);
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

    this.aimGfx = this.add.graphics();
    this.shotGfx = this.add.graphics();

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
  }

  drawSky() {
    // Simple vertical gradient via stacked bands. Lot 2 will replace this.
    const g = this.add.graphics();
    const bands = 32;
    const top = Phaser.Display.Color.IntegerToColor(COLORS.skyTop);
    const bottom = Phaser.Display.Color.IntegerToColor(COLORS.skyBottom);
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, 1, t);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, (GAME_HEIGHT / bands) * i, GAME_WIDTH, GAME_HEIGHT / bands + 1);
    }
  }

  update(_time, delta) {
    const dt = Math.min(delta / 1000, 0.05);

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
      return new Projectile(m.x, m.y, v.x * speed, v.y * speed, i);
    });
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
      this.spawnImpact(p.x, p.y, opponent.color);
      return;
    }

    // Ground hit (only once the shell is on screen, to avoid edge artefacts).
    if (p.y > 0 && this.terrain.collides(p.x, p.y)) {
      p.alive = false;
      this.spawnImpact(p.x, p.y, COLORS.terrainDark);
    }
  }

  spawnImpact(x, y, color) {
    const ring = this.add.circle(x, y, 6, color, 0.9);
    this.tweens.add({
      targets: ring,
      radius: 34,
      alpha: 0,
      duration: 320,
      onComplete: () => ring.destroy(),
    });
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
