// Procedural sound effects synthesized with the Web Audio API. No binary audio
// assets are shipped; every effect is generated at runtime from oscillators and
// filtered noise. A single shared instance lives on the Phaser game registry.
export default class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // Resume the context after a user gesture (browsers start it suspended).
  unlock() {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  noise(duration) {
    const ctx = this.ensure();
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  // Cannon shot: short filtered noise crack plus a descending low thump.
  boom() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;

    const src = this.noise(0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, now);
    lp.frequency.exponentialRampToValueAtTime(280, now + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.35);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // Impact explosion: louder, longer rumble.
  explosion() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;

    const src = this.noise(0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.55);
  }

  // Direct tower hit: bright metallic ring on top of an explosion.
  hit() {
    if (!this.enabled) return;
    this.explosion();
    const ctx = this.ensure();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, now + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4 + i * 0.04);
      osc.connect(g).connect(this.master);
      osc.start(now + i * 0.04);
      osc.stop(now + 0.45 + i * 0.04);
    });
  }

  // Short UI tone for menu navigation and confirmation.
  blip(freq = 660) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.13);
  }
}
