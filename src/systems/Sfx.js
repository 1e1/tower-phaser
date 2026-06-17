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

  // Impact explosion: louder, longer rumble. vol scales it (distance falloff).
  explosion(vol = 1) {
    if (!this.enabled || vol <= 0) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;

    const src = this.noise(0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, vol), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.55);
  }

  // Tower struck: a single rubble/collapse — a low rumble, a deep thud and a
  // scatter of debris clatter. The fatal blow (big) runs a little longer.
  rubble(big = false) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;
    const dur = big ? 0.95 : 0.62;

    // Low rumble of shifting stone.
    const src = this.noise(dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, now);
    lp.frequency.exponentialRampToValueAtTime(80, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(big ? 1.0 : 0.8, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + dur);

    // Deep thud.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, now);
    o.frequency.exponentialRampToValueAtTime(42, now + (big ? 0.4 : 0.3));
    const og = ctx.createGain();
    og.gain.setValueAtTime(big ? 0.85 : 0.7, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + (big ? 0.44 : 0.34));
    o.connect(og).connect(this.master);
    o.start(now);
    o.stop(now + (big ? 0.46 : 0.36));

    // Falling-debris clatter.
    const bursts = big ? 8 : 5;
    for (let i = 0; i < bursts; i += 1) {
      const t = now + 0.04 + Math.random() * dur * 0.85;
      const b = this.noise(0.07);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1700;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      b.connect(hp).connect(bg).connect(this.master);
      b.start(t);
      b.stop(t + 0.1);
    }
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

  // Falling whistle for a shell passing/approaching.
  whistle() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.62);
  }

  // Polyphonic "bullet whizz": each in-flight shell is its own band-passed voice,
  // keyed by projectile id, so a triple salvo whistles as three overlapping
  // tones. The caller passes the live set every frame as
  //   [{ id, intensity 0..1, freq }]
  // — volume + pitch rise with intensity (proximity to the listener's tower) and
  // a voice fades out the moment its shell leaves the set. Each voice stays well
  // under the boom/impact level. Works on iOS, unlike the Vibration API.
  whistles(list) {
    const ctx = this.ensure();
    if (!this.whz) this.whz = new Map(); // projectile id -> { osc, bp, g }
    const now = ctx.currentTime;
    const live = new Set();

    for (const s of list) {
      live.add(s.id);
      let v = this.whz.get(s.id);
      if (!v) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 6;
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(bp).connect(g).connect(this.master);
        osc.start();
        v = { osc, bp, g };
        this.whz.set(s.id, v);
      }
      const i = this.enabled ? Math.max(0, Math.min(1, s.intensity)) : 0;
      const base = s.freq || 1200;
      const f = base * (0.7 + i * 0.6); // pitch climbs as it nears
      v.g.gain.setTargetAtTime(i * 0.13, now, 0.04); // capped below boom/impact
      v.osc.frequency.setTargetAtTime(f, now, 0.04);
      v.bp.frequency.setTargetAtTime(f * 1.5, now, 0.04);
    }

    // Retire voices whose shell is gone (landed / off-screen): fade then stop.
    for (const [id, v] of this.whz) {
      if (live.has(id)) continue;
      v.g.gain.setTargetAtTime(0, now, 0.05);
      try { v.osc.stop(now + 0.2); } catch { /* already stopped */ }
      this.whz.delete(id);
    }
  }

  // A single brass note for the victory fanfare: a detuned sawtooth pair through
  // a lowpass with a punchy attack and a touch of vibrato on held notes — a
  // trumpet-ish voice built from the same primitives as everything else here.
  brassNote(freq, t0, dur, peak = 0.3) {
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator(); // detuned twin for body
    o2.type = 'sawtooth';
    o2.frequency.value = freq * 1.006;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(6500, freq * 2), t0);
    lp.frequency.linearRampToValueAtTime(Math.min(9000, freq * 5), t0 + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.025);
    g.gain.setValueAtTime(peak, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    o2.start(t0); o2.stop(t0 + dur + 0.02);
    if (dur > 0.25) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = freq * 0.006;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lg.connect(o2.frequency);
      lfo.start(t0 + 0.08); lfo.stop(t0 + dur);
    }
  }

  // Victory bugle — the cavalry "Charge!" call (G–C–E–G rising to a held top),
  // played on the WINNER's phone at the end of a match (the loser, meanwhile,
  // hears their own tower collapse).
  fanfare() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const t = ctx.currentTime + 0.05;
    const G4 = 392; const C5 = 523.25; const E5 = 659.25; const G5 = 783.99;
    const seq = [
      [G4, 0, 0.12], [C5, 0.12, 0.12], [E5, 0.24, 0.12],
      [G5, 0.36, 0.20], [E5, 0.60, 0.10], [G5, 0.72, 0.55, 0.34],
    ];
    seq.forEach((n) => this.brassNote(n[0], t + n[1], n[2], n[3] || 0.3));
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
