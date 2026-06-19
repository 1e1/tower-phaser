import { MAX_WIND } from '../config/constants.js';

// ── Per-biome music (OST) ───────────────────────────────────────────────────
// A small Web Audio step-sequencer: each track is generated from a key, a scale,
// a chord grid and an intensity — the voice families match this engine's SFX
// (pulse / saw / triangle / sine / FM / filtered noise). During a match the two
// ambiances of a biome alternate per manche; the final manche has its own track.
// A round transition crossfades BOTH volume and tempo (BPM) on a smoothstep
// curve. Compositions tuned in public/ost-lab.html.
const M_SCALE = {
  MAJ: [0, 2, 4, 5, 7, 9, 11], MIN: [0, 2, 3, 5, 7, 8, 10], DOR: [0, 2, 3, 5, 7, 9, 10],
  PHR: [0, 1, 3, 5, 7, 8, 10], PHRD: [0, 1, 4, 5, 7, 8, 10], DBL: [0, 1, 4, 5, 7, 8, 11],
  HMIN: [0, 2, 3, 5, 7, 8, 11],
};
const M_TRACKS = {
  1:  { bpm: 96,  root: 57, scale: M_SCALE.MAJ,  prog: [0, 4, 5, 3], lead: 'pulse',  arp: 2, bassMode: 'half',    drums: 2 },
  2:  { bpm: 112, root: 50, scale: M_SCALE.MAJ,  prog: [0, 3, 4, 0], lead: 'pulse',  arp: 1, bassMode: 'quarter', drums: 3 },
  3:  { bpm: 128, root: 57, scale: M_SCALE.MAJ,  prog: [0, 4, 5, 3], lead: 'pulse',  arp: 1, bassMode: 'eighth',  drums: 5 },
  4:  { bpm: 84,  root: 52, scale: M_SCALE.PHR,  prog: [0, 5, 0, 5], lead: 'saw',    arp: 4, bassMode: null, drone: true, drums: 0, fx: 'ember' },
  5:  { bpm: 100, root: 52, scale: M_SCALE.DBL,  prog: [0, 6, 0, 5], lead: 'saw',    arp: 2, bassMode: 'quarter', drums: 3 },
  6:  { bpm: 76,  root: 40, scale: M_SCALE.PHR,  prog: [0, 1, 0, 5], lead: 'saw',    arp: 4, leadOct: 0,  bassMode: 'quarter', drone: true, heavy: true, drums: 4, fx: ['ember'] },
  7:  { bpm: 132, root: 52, scale: M_SCALE.PHRD, prog: [0, 1, 0, 6], lead: 'saw',    arp: 1, bassMode: 'eighth',  drums: 5, fx: 'sweep' },
  8:  { bpm: 120, root: 40, scale: M_SCALE.PHRD, prog: [0, 1, 6, 1], lead: 'saw',    arp: 1, leadOct: 12, bassMode: 'eighth', drone: true, heavy: true, drums: 5, fx: ['sweep', 'blast'], stab: true },
  9:  { bpm: 72,  root: 57, scale: M_SCALE.MIN,  prog: [0, 5, 3, 4], lead: 'fmbell', arp: 4, bassMode: null, pad: true, drums: 0 },
  10: { bpm: 88,  root: 50, scale: M_SCALE.DOR,  prog: [0, 3, 5, 4], lead: 'pulse',  arp: 2, bassMode: null, pad: true, drums: 2, bell: true },
  11: { bpm: 124, root: 57, scale: M_SCALE.HMIN, prog: [0, 4, 5, 4], lead: 'fmbell', arp: 1, bassMode: 'quarter', drums: 4, fx: 'crack' },
  12: { bpm: 90,  root: 48, scale: M_SCALE.MIN,  prog: [0, 5, 0, 4], lead: 'saw',    arp: 4, bassMode: null, drone: true, drums: 1, fx: 'ember' },
  13: { bpm: 116, root: 48, scale: M_SCALE.PHR,  prog: [0, 6, 5, 0], lead: 'saw',    arp: 2, bassMode: 'eighth',  drums: 4 },
  14: { bpm: 144, root: 48, scale: M_SCALE.HMIN, prog: [0, 4, 1, 5], lead: 'saw',    arp: 1, bassMode: 'eighth',  drums: 5, fx: 'blast', stab: true },
  // Storm — epic/gothic: orcs & goblins, nightmare, Transylvania. Validated in ost-lab.
  15: { bpm: 82,  root: 45, scale: M_SCALE.HMIN, prog: [0, 5, 0, 4], lead: 'saw',    arp: 4, bassMode: 'quarter', drone: true, heavy: true, drums: 3, fx: ['ember'] },
  16: { bpm: 108, root: 40, scale: M_SCALE.PHRD, prog: [0, 1, 0, 6], lead: 'saw',    arp: 1, leadOct: 0,  bassMode: 'eighth', drone: true, heavy: true, drums: 5, fx: ['blast'], stab: true },
  17: { bpm: 150, root: 40, scale: M_SCALE.HMIN, prog: [0, 4, 1, 5], lead: 'saw',    arp: 1, leadOct: 12, bassMode: 'eighth', drone: true, heavy: true, drums: 5, fx: ['blast', 'crack'], stab: true },
  18: { bpm: 66,  root: 45, scale: M_SCALE.HMIN, prog: [0, 5, 3, 4], lead: 'fmbell', arp: 4, bassMode: null, drone: true, pad: true, drums: 0, bell: true, fx: ['ember'] },
  19: { bpm: 132, root: 38, scale: M_SCALE.PHR,  prog: [0, 6, 5, 0], lead: 'saw',    arp: 2, bassMode: 'eighth', drone: true, heavy: true, drums: 4, fx: ['sweep', 'blast'] },
};
// Biome → { two ambiances that alternate per manche, final-manche track }. The
// Desert playlist is validated: Mirage + Fournaise rotate, Simoun closes
// (Caravane/Tempête stay in the annex catalogue but out of the in-game rotation).
const M_BIOMES = {
  meadow:  { ambient: [1, 2],   final: 3 },
  desert:  { ambient: [4, 6],   final: 8 },
  tundra:  { ambient: [9, 10],  final: 11 },
  volcano: { ambient: [12, 13], final: 14 },
  storm:   { ambient: [15, 19], final: 17 }, // Sabbat + Maelström rotate, Walpurgis closes (Horde/Carpates stay in the lab catalogue)
};
const M_ARP = [0, 2, 4, 7, 4, 2];
const MUSIC_LEVEL = 0.30;     // music bus into master — discreet, under the SFX (validated in ost-lab)
const MUSIC_VOICE = 0.32;     // per-track crossfade-bus target
const MUSIC_WIND_DUCK = 0.2;  // wind-bed level while music plays (validated in ost-lab)

// Spatialisation defaults (validated — see audio-spatialization-convention):
// L/R via StereoPanner, front/back via "depth" volume, up/down via a shelf tilt.
const SPACE = { panMax: 0.85, depthMinVol: 0.40, tiltDb: 6, tiltHiHz: 2500, tiltLoHz: 250 };

// Voice policy (lot E): per-category budgets over a short window; over budget we
// keep the LOUDEST (post-attenuation) and drop the rest. `floor` = never dropped;
// `ducks` = briefly dips the SFX bus so the big hit cuts through. `whistle` is
// managed per-id inside whistles(), so it is not gated here.
const VOICE = {
  impact: { budget: 3, ducks: true },
  smallarm: { budget: 4 },
  voice: { budget: 2 },
  shield: { floor: true, ducks: true },
  meta: { floor: true },
};
const VOICE_WINDOW = 0.05; const DUCK_TO = 0.55; const DUCK_MS = 160;

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
      this.sfxBus = this.ctx.createGain(); // duckable bus for living-world SFX (lot E)
      this.sfxBus.connect(this.master);
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

  // ── Spatialisation (lot A) ──────────────────────────────────────────────────
  // Per-emitter placement WITHOUT HRTF: left/right via StereoPanner (x),
  // front/back via a "depth" volume, up/down via a slight high/low shelf tilt.
  // Two listener modes set by the scene each frame:
  //   { mode: 'tv', width }            → spatialise across the arena width
  //   { mode: 'mic', x, y, range }     → a point mic (own tower for P1/P2, the
  //                                       MOBILE Intendant avatar for P3)
  // Existing duel SFX still go straight to master; battlefield SFX (lot B/D)
  // will route through spatial() instead.
  setListener(l) { this.listener = l; }

  // Shared synthetic reverb send (impulse generated at runtime — no asset). Lazy.
  reverb() {
    if (!this._rev) {
      const ctx = this.ensure();
      const dur = 1.8, decay = 2.6;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch += 1) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * ((1 - i / n) ** decay);
      }
      this._rev = ctx.createConvolver();
      this._rev.buffer = buf;
      const out = ctx.createGain(); out.gain.value = 0.9;
      this._rev.connect(out).connect(this.sfxBus);
    }
    return this._rev;
  }

  // Soft-clip curve for the "modern" heavy hits (lot B uses it for crunch).
  shaper(k) {
    const ctx = this.ensure();
    const ws = ctx.createWaveShaper();
    const n = 1024; const cv = new Float32Array(n);
    for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * 2 - 1; cv[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    ws.curve = cv;
    return ws;
  }

  // Build a per-emitter spatial input node wired to master (+ optional reverb
  // send `revAmt`). Connect your voice(s) to the returned GainNode instead of
  // this.master. pos = { x, y, depth?, yn? }. Returns null when out of a mic
  // listener's range → caller skips synthesis (free culling).
  spatial(pos = {}, revAmt = 0) {
    const ctx = this.ensure();
    const l = this.listener || { mode: 'tv', width: 960 };
    let pan = 0, depthVol = 1, tilt = 0;
    if (l.mode === 'mic') {
      const range = l.range || 1;
      const dx = (pos.x ?? l.x) - l.x;
      const dy = (pos.y ?? l.y) - l.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= range) return null; // out of mic range → cull
      const prox = 1 - dist / range; // 1 at the mic, 0 at the edge
      depthVol = SPACE.depthMinVol + prox * (1 - SPACE.depthMinVol);
      pan = Math.max(-1, Math.min(1, dx / range)) * SPACE.panMax;
      tilt = Math.max(-1, Math.min(1, -dy / range)) * SPACE.tiltDb; // above mic → brighter
    } else { // 'tv' — no listener POINT, so no distance/éloignement notion: the
      // TV just prioritises (the gate) and places the source left/right across the
      // panel for a stereo image. Full volume, no depth attenuation, no tilt.
      const W = l.width || 960;
      pan = Math.max(-1, Math.min(1, ((pos.x ?? W / 2) / W) * 2 - 1)) * SPACE.panMax;
      depthVol = 1;
      tilt = 0;
    }
    const inp = ctx.createGain(); inp.gain.value = depthVol;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = SPACE.tiltHiHz; hi.gain.value = tilt;
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = SPACE.tiltLoHz; lo.gain.value = -tilt;
    const sp = ctx.createStereoPanner(); sp.pan.value = pan;
    inp.connect(hi).connect(lo).connect(sp).connect(this.sfxBus);
    if (revAmt > 0) { const rs = ctx.createGain(); rs.gain.value = revAmt; sp.connect(rs); rs.connect(this.reverb()); }
    return inp;
  }

  // ── Voice policy & ducking (lot E) ───────────────────────────────────────────
  // Briefly dip the SFX bus so a big hit cuts through (sidechain-lite). Duel SFX
  // go straight to master and are untouched; only the living-world bus ducks.
  duck(to = DUCK_TO, ms = DUCK_MS) {
    if (!this.sfxBus) return;
    const now = this.ensure().currentTime; const g = this.sfxBus.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + 0.02);
    g.linearRampToValueAtTime(1, now + ms / 1000);
  }

  // Admit or drop a voice in `cat`, ranking by post-attenuation `loudness`. Over
  // budget within the window, a louder voice evicts the quietest; else it drops.
  gate(cat, loudness = 1) {
    const c = VOICE[cat] || { budget: 4 };
    let admit = true;
    if (!c.floor) {
      const now = this.ensure().currentTime;
      if (!this._vq) this._vq = {};
      const q = this._vq[cat] || (this._vq[cat] = []);
      while (q.length && now - q[0].t > VOICE_WINDOW) q.shift();
      const budget = c.budget || 4;
      if (q.length < budget) { q.push({ t: now, l: loudness }); }
      else {
        let mi = 0; for (let i = 1; i < q.length; i += 1) if (q[i].l < q[mi].l) mi = i;
        if (loudness > q[mi].l) q[mi] = { t: now, l: loudness }; else admit = false;
      }
    }
    if (admit && c.ducks) this.duck();
    return admit;
  }

  // Central living-world event → SFX, applying the voice policy. `out` is the
  // spatial() node (its gain = post-attenuation loudness) or null when culled.
  playEvent(e, out, opts = {}) {
    if (out === null) return; // culled by a mic listener
    const loud = (out && out.gain) ? out.gain.value : 1;
    const vx = !!opts.skinVortex;
    switch (e.type) {
      case 'musket': if (this.gate('smallarm', loud)) this.musketCrack({}, out); break;
      case 'grenadeLob': if (this.gate('smallarm', loud)) this.grenadePin({}, out); break;
      case 'melee': if (this.gate('smallarm', loud)) this.melee({}, out); break;
      case 'intBuild': if (this.gate('smallarm', loud)) (e.kind === 1 ? this.bridge : this.stairs).call(this, {}, out); break;
      case 'engineerBuild': if (this.gate('smallarm', loud)) (e.kind === 1 ? this.engineerBridge : this.engineerLadder).call(this, {}, out); break;
      case 'intDig': if (this.gate('smallarm', loud)) (e.kind === 0 ? this.dig : e.kind === 1 ? this.fill : this.flatten).call(this, {}, out); break;
      case 'grenadeBurst': if (this.gate('impact', loud)) { this.grenadeBurst({}, out); this.grenadeShrapnel({}, out); } break;
      case 'fieldFire': if (this.gate('impact', loud)) this.fieldCannon({}, out); break;
      case 'horde': if (this.gate('impact', loud)) { this.stampede({}, out); this.hordeCry({}, out); } break;
      case 'soldierDeath': if (this.gate('voice', loud)) this.soldierDeath({}, out); break;
      case 'cannonWreck': if (this.gate('impact', loud)) this.woodSmash({}, out); break;
      case 'intParry': if (this.gate('shield', loud)) (vx ? this.shieldParryVortex : this.shieldParryHex).call(this, {}, out); break;
      case 'intFatal': if (this.gate('shield', loud)) { (vx ? this.shieldFatalVortex : this.shieldFatalHex).call(this, {}, out); this.cry({}, out); } break;
      // newly wired battlefield timbres (events emitted by sim/battlefield.js)
      case 'projGround': if (this.gate('impact', loud)) (e.kind === 1 ? this.arrowGround : this.ballGround).call(this, {}, out); break;
      case 'projFlesh': if (this.gate('smallarm', loud)) (e.kind === 1 ? this.arrowFlesh : this.flesh).call(this, {}, out); break;
      case 'intBow': if (this.gate('smallarm', loud)) this.bowTwang({}, out); break;
      case 'intSword': if (this.gate('smallarm', loud)) { this.swordSwing({}, out); this.swordHit({}, out); } break;
      case 'intHurt': if (this.gate('voice', loud)) this.grunt({}, out); break;
      case 'towerVolley': if (this.gate('smallarm', loud)) this.towerVolley({ n: e.n || 2 }, out); break;
      case 'apparition': if (this.gate('impact', loud)) this.apparition({}, out); break;
      case 'glide': if (this.gate('smallarm', loud)) this.gliderDeploy({}, out); break;
      default: break;
    }
  }

  // ── Battlefield SFX (lot B — ported from design/battlefield-sfx-lab.html) ────
  // One-shot, event-driven voices with the lab's validated default params. Each
  // takes an optional `out` node (default master) so lot D can route them through
  // spatial(). Projectile *whizz* stays on whistles() (sustained), not here.
  _g(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _bq(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  _send(node, amt) { if (amt > 0) { const s = this._g(amt); node.connect(s); s.connect(this.reverb()); } }

  // -- modern heavy hits (sub + transient + soft-clip + reverb) --
  boomModern({ vol = 0.9, sub = 55, rev = 0.3 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(sub, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = this._g(vol); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7); o.connect(og).connect(dst); this._send(og, rev); o.start(t); o.stop(t + 0.72);
    const s = this.noise(0.02), hp = this._bq('highpass', 3000); const g = this._g(vol * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); s.connect(hp).connect(g).connect(dst); s.start(t); s.stop(t + 0.03);
    const s2 = this.noise(0.28), lp = this._bq('lowpass', 1000), ws = this.shaper(6); const g2 = this._g(vol * 0.7); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.28); s2.connect(lp).connect(ws).connect(g2).connect(dst); this._send(g2, rev); s2.start(t); s2.stop(t + 0.3);
  }
  explosionModern({ vol = 1, rev = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const og = this._g(vol); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8); o.connect(og).connect(dst); this._send(og, rev); o.start(t); o.stop(t + 0.82);
    const s = this.noise(0.45), lp = this._bq('lowpass', 1500), ws = this.shaper(8); const g = this._g(vol * 0.9); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); s.connect(lp).connect(ws).connect(g).connect(dst); this._send(g, rev); s.start(t); s.stop(t + 0.47);
    const s2 = this.noise(0.12), hp = this._bq('highpass', 2200); const g2 = this._g(vol * 0.5); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12); s2.connect(hp).connect(g2).connect(dst); s2.start(t); s2.stop(t + 0.13);
  }
  rubbleModern({ vol = 1, rev = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime; const dur = 0.9;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = this._g(vol); og.gain.exponentialRampToValueAtTime(0.001, t + 0.55); o.connect(og).connect(dst); this._send(og, rev); o.start(t); o.stop(t + 0.57);
    const s = this.noise(dur), lp = this._bq('lowpass', 500); lp.frequency.exponentialRampToValueAtTime(60, t + dur); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(lp).connect(g).connect(dst); this._send(g, rev); s.start(t); s.stop(t + dur);
    for (let i = 0; i < 10; i += 1) { const tt = t + 0.04 + Math.random() * dur * 0.85; const b = this.noise(0.08), bp = this._bq('bandpass', 900 + Math.random() * 1400, 2); const bg = this._g(0.0001); bg.gain.exponentialRampToValueAtTime(0.28, tt + 0.005); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.1); b.connect(bp).connect(bg).connect(dst); this._send(bg, rev * 0.6); b.start(tt); b.stop(tt + 0.11); }
  }
  fieldCannon({ vol = 0.85, sub = 65, rev = 0.25, wheel = 1 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(sub, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.42);
    const og = this._g(vol); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.connect(og).connect(dst); this._send(og, rev); o.start(t); o.stop(t + 0.52);
    const s = this.noise(0.02), hp = this._bq('highpass', 3200); const g = this._g(vol * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); s.connect(hp).connect(g).connect(dst); s.start(t); s.stop(t + 0.03);
    const s2 = this.noise(0.2), lp = this._bq('lowpass', 1200), ws = this.shaper(5); const g2 = this._g(vol * 0.7); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2); s2.connect(lp).connect(ws).connect(g2).connect(dst); this._send(g2, rev); s2.start(t); s2.stop(t + 0.22);
    if (wheel) for (let i = 0; i < 5; i += 1) { const tt = t + 0.02 + Math.random() * 0.22; const b = this.noise(0.05), bp = this._bq('bandpass', 900 + Math.random() * 900, 3); const bg = this._g(0.0001); bg.gain.exponentialRampToValueAtTime(vol * 0.18, tt + 0.004); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.06); b.connect(bp).connect(bg).connect(dst); b.start(tt); b.stop(tt + 0.07); }
  }

  // -- flesh & voices --
  flesh({ thud = 120, dur = 0.16, wet = 320, vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(dur), lp = this._bq('lowpass', 420, 0.8); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + dur + 0.02);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(thud, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, thud * 0.5), t + dur); const og = this._g(vol * 0.9); og.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(og).connect(dst); o.start(t); o.stop(t + dur + 0.02);
    const s2 = this.noise(0.08), bp = this._bq('bandpass', wet, 3); const g2 = this._g(0.0001); g2.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); s2.connect(bp).connect(g2).connect(dst); s2.start(t); s2.stop(t + 0.1);
  }
  voice({ pitch = 180, dur = 0.3, drop = 0.6, vol = 0.4, vib = 0 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(pitch, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, pitch * drop), t + dur);
    const env = this._g(0.0001); env.connect(dst);
    [[700, 8], [1100, 10], [2500, 12]].forEach(([f, q]) => { const bp = this._bq('bandpass', f, q); const fg = this._g(0.5); o.connect(bp).connect(fg).connect(env); });
    env.gain.exponentialRampToValueAtTime(vol, t + 0.02); env.gain.setValueAtTime(vol, t + dur * 0.5); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05);
    if (vib) { const lfo = ctx.createOscillator(); lfo.frequency.value = 6; const lg = this._g(pitch * 0.035); lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur); }
    const br = this.noise(dur), hp = this._bq('highpass', 1200); const bg = this._g(0.0001); bg.gain.exponentialRampToValueAtTime(vol * 0.12, t + 0.03); bg.gain.exponentialRampToValueAtTime(0.0001, t + dur); br.connect(hp).connect(bg).connect(dst); br.start(t); br.stop(t + dur + 0.02);
  }
  grunt(p = {}, out) { this.voice({ pitch: 184, dur: 0.18, drop: 0.57, vol: 0.26, ...p }, out); }
  cry(p = {}, out) { this.voice({ pitch: 230, dur: 0.7, drop: 0.55, vol: 0.5, vib: 1, ...p }, out); }
  soldierDeath({ pitch = 150, vol = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    this.voice({ pitch, dur: 0.26, drop: 0.5, vol }, out);
    const s = this.noise(0.18), lp = this._bq('lowpass', 300); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.18); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28); s.connect(lp).connect(g).connect(dst); s.start(t + 0.1); s.stop(t + 0.3);
  }

  // -- Intendant melee/ranged --
  swordSwing({ dur = 0.22, f0 = 280, f1 = 2600, q = 6, vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(dur), bp = this._bq('bandpass', f0, q); bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this._g(0.0001); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(bp).connect(g).connect(dst); s.start(t); s.stop(t + dur + 0.02);
  }
  swordHit({ thud = 150, dur = 0.15, clink = 0.25, vol = 0.55 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    this.flesh({ thud, dur, wet: 400, vol }, out);
    [2200, 3100].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); const g = this._g(clink / (i + 1)); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g).connect(dst); o.start(t); o.stop(t + 0.2); });
  }
  bowTwang({ freq = 240, decay = 0.2, drop = 0.85, vol = 0.06 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * drop, t + decay);
    const lp = this._bq('lowpass', 1800); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); o.connect(lp).connect(g).connect(dst); o.start(t); o.stop(t + decay + 0.02);
    const s = this.noise(0.02), hp = this._bq('highpass', 3000); const ng = this._g(vol * 0.5); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02); s.connect(hp).connect(ng).connect(dst); s.start(t); s.stop(t + 0.03);
  }
  arrowGround({ vol = 0.4, tick = 0.3 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.1), lp = this._bq('lowpass', 600); const g = this._g(vol); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + 0.11);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08); const og = this._g(tick); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.1);
  }
  arrowFlesh(p = {}, out) { this.flesh({ thud: 130, dur: 0.13, wet: 300, vol: 0.28, ...p }, out); }

  // -- soldiers: muskets, grenades, field cannon wreck, melee, volley --
  musketCrack({ bright = 5000, body = 90, dur = 0.09, vol = 0.6 } = {}, out, at) {
    const ctx = this.ensure(); const dst = out || this.master; const t = at ?? ctx.currentTime;
    const s = this.noise(dur), hp = this._bq('highpass', bright); const g = this._g(vol); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(hp).connect(g).connect(dst); s.start(t); s.stop(t + dur + 0.02);
    const s2 = this.noise(0.05), bp = this._bq('bandpass', 1500, 1); const g2 = this._g(vol * 0.7); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s2.connect(bp).connect(g2).connect(dst); s2.start(t); s2.stop(t + 0.06);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(body, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, body * 0.5), t + 0.06); const og = this._g(vol * 0.6); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.08);
  }
  ballGround({ vol = 0.3, ric = 1400 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.04), hp = this._bq('highpass', 2600); const g = this._g(vol); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); s.connect(hp).connect(g).connect(dst); s.start(t); s.stop(t + 0.05);
    if (ric > 50) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(ric, t); o.frequency.exponentialRampToValueAtTime(ric * 0.5, t + 0.12); const og = this._g(0.12); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.16); }
  }
  grenadePin({ scrape = 4200, ping = 2600, vol = 0.45, throw: th = 0.2 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.06), bp = this._bq('bandpass', scrape, 2); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); s.connect(bp).connect(g).connect(dst); s.start(t); s.stop(t + 0.07);
    [ping, ping * 1.32].forEach((f, i) => { const tt = t + i * 0.05; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, tt); const og = this._g(vol * 0.6 / (i + 1)); og.gain.exponentialRampToValueAtTime(0.001, tt + 0.22); o.connect(og).connect(dst); o.start(tt); o.stop(tt + 0.24); });
    if (th > 0) { const tt = t + 0.12; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, tt); o.frequency.exponentialRampToValueAtTime(80, tt + 0.1); const og = this._g(th); og.gain.exponentialRampToValueAtTime(0.001, tt + 0.11); o.connect(og).connect(dst); o.start(tt); o.stop(tt + 0.13); }
  }
  grenadeBurst({ vol = 0.55 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.5), lp = this._bq('lowpass', 1200); lp.frequency.exponentialRampToValueAtTime(120, t + 0.45); const g = this._g(Math.max(0.001, vol)); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + 0.5);
    const s2 = this.noise(0.05), hp = this._bq('highpass', 4000); const g2 = this._g(vol * 0.6); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s2.connect(hp).connect(g2).connect(dst); s2.start(t); s2.stop(t + 0.06);
  }
  grenadeShrapnel({ thud = 120, vol = 0.5, tings = 4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    this.flesh({ thud, dur: 0.15, wet: 320, vol }, out);
    for (let i = 0; i < (tings | 0); i += 1) { const tt = t + Math.random() * 0.12; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(2600 + Math.random() * 2500, tt); const g = this._g(0.08); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.1); o.connect(g).connect(dst); o.start(tt); o.stop(tt + 0.12); }
  }
  woodSmash({ vol = 0.6, n = 6, bright = 1400 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18); const og = this._g(vol * 0.7); og.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.22);
    for (let i = 0; i < (n | 0); i += 1) { const tt = t + Math.random() * 0.28; const b = this.noise(0.06), bp = this._bq('bandpass', 600 + Math.random() * bright, 3); const bg = this._g(0.0001); bg.gain.exponentialRampToValueAtTime(vol * (0.3 + Math.random() * 0.4), tt + 0.003); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.07); b.connect(bp).connect(bg).connect(dst); b.start(tt); b.stop(tt + 0.08); }
  }
  _shotgun({ body = 90, bright = 4000, dur = 0.22, vol = 0.55 } = {}, at, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = at ?? ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(body, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, body * 0.4), t + 0.14); const og = this._g(vol * 0.9); og.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.18);
    const s = this.noise(dur), lp = this._bq('lowpass', 2200); lp.frequency.exponentialRampToValueAtTime(500, t + dur); const g = this._g(vol); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + dur + 0.02);
    const s2 = this.noise(0.04), hp = this._bq('highpass', bright); const g2 = this._g(vol * 0.7); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.04); s2.connect(hp).connect(g2).connect(dst); s2.start(t); s2.stop(t + 0.05);
  }
  towerVolley({ n = 2, spread = 0.1, body = 90, bright = 4000, dur = 0.22, vol = 0.55 } = {}, out) {
    const ctx = this.ensure(); const t0 = ctx.currentTime;
    for (let i = 0; i < (n | 0); i += 1) this._shotgun({ body, bright, dur, vol }, t0 + i * spread + Math.random() * spread * 0.3, out);
  }
  melee({ clink = 2600, wet = 340, vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    [clink, clink * 1.5, clink * 0.8].forEach((f, i) => { const tt = t + i * 0.02; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 0.85, tt + 0.12); const g = this._g(vol * 0.5 / (i + 1)); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.14); o.connect(g).connect(dst); o.start(tt); o.stop(tt + 0.16); });
    const s = this.noise(0.05), bp = this._bq('bandpass', clink * 1.2, 3); const sg = this._g(vol * 0.3); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(bp).connect(sg).connect(dst); s.start(t); s.stop(t + 0.06);
    this.flesh({ thud: 120, dur: 0.1, wet, vol: vol * 0.5 }, out);
  }

  // -- Intendant actions --
  dig({ vol = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.12), lp = this._bq('lowpass', 700); const g = this._g(vol); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + 0.13);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.1); const og = this._g(vol * 0.6); og.gain.exponentialRampToValueAtTime(0.001, t + 0.11); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.12);
  }
  fill({ vol = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.16), lp = this._bq('lowpass', 500); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.7, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + 0.17);
    for (let i = 0; i < 6; i += 1) { const tt = t + Math.random() * 0.14; const b = this.noise(0.02), hp = this._bq('highpass', 2000); const bg = this._g(vol * 0.12); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.02); b.connect(hp).connect(bg).connect(dst); b.start(tt); b.stop(tt + 0.03); }
  }
  flatten({ vol = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.25), bp = this._bq('bandpass', 800, 0.8); bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1400, t + 0.12); bp.frequency.linearRampToValueAtTime(400, t + 0.25); const g = this._g(0.0001); g.gain.linearRampToValueAtTime(vol * 0.6, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); s.connect(bp).connect(g).connect(dst); s.start(t); s.stop(t + 0.26);
  }
  stairs({ vol = 0.45 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    [0, 0.07].forEach((dt, i) => { const tt = t + dt; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220 - i * 40, tt); o.frequency.exponentialRampToValueAtTime(90, tt + 0.1); const g = this._g(vol * 0.7); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12); o.connect(g).connect(dst); o.start(tt); o.stop(tt + 0.13); const s = this.noise(0.03), hp = this._bq('highpass', 1500); const sg = this._g(vol * 0.2); sg.gain.exponentialRampToValueAtTime(0.001, tt + 0.03); s.connect(hp).connect(sg).connect(dst); s.start(tt); s.stop(tt + 0.04); });
  }
  bridge({ vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18); const g = this._g(vol * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(dst); o.start(t); o.stop(t + 0.22);
    const s = this.noise(0.3), bp = this._bq('bandpass', 600, 8); bp.frequency.setValueAtTime(500, t + 0.05); bp.frequency.linearRampToValueAtTime(900, t + 0.3); const sg = this._g(0.0001); sg.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.08); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.32); s.connect(bp).connect(sg).connect(dst); s.start(t + 0.05); s.stop(t + 0.36);
  }
  // Engineer (sapper) works — dry small-wood timbres (little tonal tail → little
  // resonance). The composite plays the whole sequence on one engineerBuild event
  // (model A), mirroring the SFX lab. PONT nails planks; ÉCHELLE is pure wood
  // assembly (no hammer), rising in pitch rung by rung.
  _woodClack({ tone = 160, vol = 0.5 } = {}, at, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = at == null ? ctx.currentTime : at;
    const s = this.noise(0.03), bp = this._bq('bandpass', Math.min(8000, tone * 5), 1.1); const g = this._g(vol * 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03); s.connect(bp).connect(g).connect(dst); s.start(t); s.stop(t + 0.04);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(tone, t); o.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.03); const og = this._g(vol * 0.28); og.gain.exponentialRampToValueAtTime(0.001, t + 0.035); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.045);
  }
  _nailTap({ tone = 200, vol = 0.5 } = {}, at, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = at == null ? ctx.currentTime : at;
    const s = this.noise(0.015), hp = this._bq('highpass', 2800); const g = this._g(vol * 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + 0.018); s.connect(hp).connect(g).connect(dst); s.start(t); s.stop(t + 0.02);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(tone, t); o.frequency.exponentialRampToValueAtTime(tone * 0.5, t + 0.025); const og = this._g(vol * 0.32); og.gain.exponentialRampToValueAtTime(0.001, t + 0.03); o.connect(og).connect(dst); o.start(t); o.stop(t + 0.035);
  }
  engineerBridge({ n = 6, tap = 200, wood = 140, gap = 0.15, vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); let k = ctx.currentTime;
    for (let i = 0; i < n; i += 1) { this._nailTap({ tone: tap, vol: vol * 0.7 }, k + Math.random() * 0.01, out); this._woodClack({ tone: wood, vol }, k + 0.05, out); k += gap; }
  }
  engineerLadder({ n = 5, wood = 150, rise = 14, gap = 0.13, vol = 0.5 } = {}, out) {
    const ctx = this.ensure(); let k = ctx.currentTime;
    for (let i = 0; i < n; i += 1) { const tone = wood + i * rise; this._woodClack({ tone: tone * 1.4, vol: vol * 0.5 }, k + Math.random() * 0.01, out); this._woodClack({ tone, vol: vol * 0.8 }, k + 0.05, out); k += gap; }
  }
  gliderDeploy({ vol = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.35), lp = this._bq('lowpass', 900); lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(1200, t + 0.12); lp.frequency.exponentialRampToValueAtTime(500, t + 0.35); const g = this._g(0.0001); g.gain.linearRampToValueAtTime(vol * 0.6, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + 0.36);
    for (let i = 0; i < 2; i += 1) { const tt = t + 0.15 + i * 0.12; const b = this.noise(0.06), bp = this._bq('bandpass', 400, 1); const bg = this._g(vol * 0.3); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.06); b.connect(bp).connect(bg).connect(dst); b.start(tt); b.stop(tt + 0.07); }
  }
  apparition({ vol = 0.5, rev = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => { const tt = t + i * 0.05; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, tt); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.3 / (i * 0.5 + 1), tt + 0.02); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.5); o.connect(g).connect(dst); this._send(g, rev); o.start(tt); o.stop(tt + 0.52); });
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(120, t + 0.35); o2.frequency.exponentialRampToValueAtTime(60, t + 0.5); const g2 = this._g(vol * 0.5); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.52); o2.connect(g2).connect(dst); o2.start(t + 0.35); o2.stop(t + 0.54);
  }

  // -- end of round --
  stampede({ dur = 1.4, bpm = 300, vol = 0.6 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(dur), lp = this._bq('lowpass', 400); const g = this._g(0.0001); g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.15); g.gain.setValueAtTime(vol * 0.5, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(lp).connect(g).connect(dst); s.start(t); s.stop(t + dur + 0.02);
    const step = 60 / bpm / 2; for (let tt = t; tt < t + dur; tt += step * (0.85 + Math.random() * 0.3)) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, tt); o.frequency.exponentialRampToValueAtTime(45, tt + 0.08); const og = this._g(vol * 0.4); og.gain.exponentialRampToValueAtTime(0.001, tt + 0.09); o.connect(og).connect(dst); o.start(tt); o.stop(tt + 0.1); const b = this.noise(0.03), hp = this._bq('highpass', 3000); const bg = this._g(vol * 0.1); bg.gain.exponentialRampToValueAtTime(0.001, tt + 0.03); b.connect(hp).connect(bg).connect(dst); b.start(tt); b.stop(tt + 0.04); }
  }
  hordeCry({ pitch = 170, dur = 0.9, vol = 0.7, rev = 0.3 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    for (let v = 0; v < 5; v += 1) { const o = ctx.createOscillator(); o.type = 'sawtooth'; const base = pitch * (0.92 + v * 0.04); o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.12, t + 0.4); const env = this._g(0.0001); env.connect(dst); this._send(env, rev); [[650, 7], [1080, 9]].forEach(([f, q]) => { const bp = this._bq('bandpass', f, q); const fg = this._g(0.4); o.connect(bp).connect(fg).connect(env); }); env.gain.linearRampToValueAtTime(vol * 0.22, t + 0.25); env.gain.setValueAtTime(vol * 0.22, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05); }
  }
  flag({ vol = 0.25 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.18), bp = this._bq('bandpass', 700, 1); bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1100, t + 0.08); bp.frequency.linearRampToValueAtTime(600, t + 0.18); const g = this._g(0.0001); g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); s.connect(bp).connect(g).connect(dst); s.start(t); s.stop(t + 0.19);
  }

  // -- Intendant magic shield (égide / vortex), parry + fatal --
  shieldParryHex({ vol = 0.8, shimmer = 1200, rev = 0.35 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const s = this.noise(0.3), lp = this._bq('lowpass', 1300); lp.frequency.exponentialRampToValueAtTime(200, t + 0.28); const g = this._g(vol * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); s.connect(lp).connect(g).connect(dst); this._send(g, rev); s.start(t); s.stop(t + 0.31);
    [1, 1.5, 2.02, 2.67].forEach((m, i) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(shimmer * m, t); o.frequency.linearRampToValueAtTime(shimmer * m * 1.5, t + 0.4); const og = this._g(0.0001); og.gain.exponentialRampToValueAtTime(vol * 0.3 / (i + 1), t + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5); const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 14 + i * 3; const lg = this._g(vol * 0.1 / (i + 1)); lfo.connect(lg).connect(og.gain); lfo.start(t); lfo.stop(t + 0.5); o.connect(og).connect(dst); this._send(og, rev); o.start(t); o.stop(t + 0.52); });
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(110, t); o2.frequency.exponentialRampToValueAtTime(55, t + 0.2); const g2 = this._g(vol * 0.5); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o2.connect(g2).connect(dst); o2.start(t); o2.stop(t + 0.24);
  }
  shieldParryVortex({ vol = 0.8, swirl = 1400, spin = 7, drone = 90, rev = 0.4 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const pan = ctx.createStereoPanner(); const panOut = this._g(1); pan.connect(panOut).connect(dst); this._send(panOut, rev);
    const plfo = ctx.createOscillator(); plfo.type = 'sine'; plfo.frequency.value = spin; const pg = this._g(0.9); plfo.connect(pg).connect(pan.pan); plfo.start(t); plfo.stop(t + 0.7);
    const s = this.noise(0.6), bp = this._bq('bandpass', swirl, 6); const flfo = ctx.createOscillator(); flfo.type = 'sine'; flfo.frequency.value = spin * 1.5; const fg = this._g(swirl * 0.6); flfo.connect(fg).connect(bp.frequency); flfo.start(t); flfo.stop(t + 0.6); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); s.connect(bp).connect(g).connect(pan); s.start(t); s.stop(t + 0.62);
    const s2 = this.noise(0.4), bp2 = this._bq('bandpass', 400, 1.2); bp2.frequency.setValueAtTime(300, t); bp2.frequency.exponentialRampToValueAtTime(3500, t + 0.4); const g2 = this._g(0.0001); g2.gain.exponentialRampToValueAtTime(vol * 0.4, t + 0.1); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4); s2.connect(bp2).connect(g2).connect(pan); s2.start(t); s2.stop(t + 0.42);
    const s3 = this.noise(0.28), lp = this._bq('lowpass', 1100); const g3 = this._g(0.0001); g3.gain.linearRampToValueAtTime(vol * 0.5, t + 0.16); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.26); s3.connect(lp).connect(g3).connect(pan); s3.start(t); s3.stop(t + 0.28);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(drone, t); const olfo = ctx.createOscillator(); olfo.type = 'sine'; olfo.frequency.value = spin; const od = this._g(drone * 0.06); olfo.connect(od).connect(o.frequency); olfo.start(t); olfo.stop(t + 0.6); const lp2 = this._bq('lowpass', 600); const og = this._g(0.0001); og.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.05); og.gain.exponentialRampToValueAtTime(0.001, t + 0.6); o.connect(lp2).connect(og).connect(pan); o.start(t); o.stop(t + 0.62);
  }
  shieldFatalHex({ vol = 0.9, pitch = 210, rev = 0.45 } = {}, out) { this.explosionModern({ vol, rev }, out); this.voice({ pitch, dur: 0.6, drop: 0.55, vol: 0.5, vib: 1 }, out); }
  shieldFatalVortex({ vol = 0.9, spin = 9, pitch = 210, rev = 0.45 } = {}, out) {
    const ctx = this.ensure(); const dst = out || this.master; const t = ctx.currentTime;
    const pan = ctx.createStereoPanner(); const panOut = this._g(1); pan.connect(panOut).connect(dst); this._send(panOut, rev);
    const s = this.noise(0.4), bp = this._bq('bandpass', 2600, 5); bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(280, t + 0.35); const plfo = ctx.createOscillator(); plfo.type = 'sine'; plfo.frequency.setValueAtTime(spin * 1.6, t); plfo.frequency.exponentialRampToValueAtTime(1, t + 0.35); const pg = this._g(0.9); plfo.connect(pg).connect(pan.pan); plfo.start(t); plfo.stop(t + 0.4); const g = this._g(0.0001); g.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.37); s.connect(bp).connect(g).connect(pan); s.start(t); s.stop(t + 0.39);
    setTimeout(() => { this.explosionModern({ vol, rev }, out); this.voice({ pitch, dur: 0.6, drop: 0.5, vol: 0.5, vib: 1 }, out); }, 170);
  }

  // Cannon shot: short filtered noise crack plus a descending low thump.
  // DEPRECATED (§3bis): superseded by boomModern at all call sites; kept for reference.
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
  // DEPRECATED (§3bis) for the obus-impact event (→ explosionModern), but still
  // the base layer of the RETAINED hit() (metallic tower-touch), so kept.
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

  // Distant thunder for the storm biome: a delayed, low-passed noise rumble whose
  // lag stands in for the strike's distance. Paired with Background's lightning flash.
  thunder(distance = 0.6) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime + Math.max(0, distance);
    const dur = 2.4;
    const src = this.noise(dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + dur);
  }

  // Tower struck: a single rubble/collapse — a low rumble, a deep thud and a
  // scatter of debris clatter. The fatal blow (big) runs a little longer.
  // DEPRECATED (§3bis): superseded by rubbleModern; the big/small distinction is
  // now carried at the call site via vol (collapse vol 1, a hit vol 0.7). Unused.
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

  // Shield raised: a short metallic "clank" (two bright rings) as the plate locks.
  shieldUp() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;
    [620, 880].forEach((f, i) => {
      const t = now + i * 0.06;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.5;
      bp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.24);
    });
  }

  // Shield deflect: a bright metallic CLANG — a high ring over a short noise tick.
  shieldBlock() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const now = ctx.currentTime;
    const src = this.noise(0.12);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(hp).connect(ng).connect(this.master);
    src.start(now); src.stop(now + 0.13);
    [1320, 1980, 2640].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28 / (i + 1), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      o.connect(g).connect(this.master);
      o.start(now); o.stop(now + 0.52);
    });
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

  // ── Ambient wind ──────────────────────────────────────────────────────────
  // A continuous bed of wind that adapts to the live wind value. Four synthesis
  // characters cycle at random — each plays for a spell, then a *different* one
  // crossfades in (1.4 s) at a natural lull, so a gust is never cut mid-swell.
  // Timbre, loudness and gustiness scale with strength; a gentle stereo lean
  // toward the wind's heading lets you hear which way it blows. Tuned and
  // chosen in public/wind-sound-lab.html. Drive it with windUpdate() each frame.

  // Looping pink-noise bed (reads as "wind", not white hiss). Cached once.
  windNoise(seconds) {
    const ctx = this.ensure();
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  // Build one wind character. Returns { out, setStrength(k 0..1), fadeIn, stop }.
  // `out` is the crossfade gain that feeds the wind panner.
  windVoice(id) {
    const ctx = this.ctx;
    const buf = this.w.noise;
    const out = ctx.createGain(); out.gain.value = 0;
    const nodes = [];
    const src = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); nodes.push(s); return s; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };
    let setStrength;

    if (id === 'whoosh') {
      const s = src(), lp = filt('lowpass', 300, 0.7), g = gain(0);
      s.connect(lp).connect(g).connect(out);
      setStrength = (k) => {
        const t = ctx.currentTime;
        lp.frequency.setTargetAtTime(180 + k * 2400, t, 0.08);
        g.gain.setTargetAtTime(0.04 + k * 0.95, t, 0.08);
      };
    } else if (id === 'howl') {
      const s = src();
      const lp = filt('lowpass', 200, 0.7), gb = gain(0);
      const bp = filt('bandpass', 300, 9), gh = gain(0);
      s.connect(lp).connect(gb).connect(out);
      s.connect(bp).connect(gh).connect(out);
      setStrength = (k) => {
        const t = ctx.currentTime;
        lp.frequency.setTargetAtTime(120 + k * 500, t, 0.08);
        gb.gain.setTargetAtTime(0.05 + k * 0.45, t, 0.08);
        bp.frequency.setTargetAtTime(260 + k * 820, t, 0.08);
        gh.gain.setTargetAtTime(k * k * 0.8, t, 0.08); // howl blooms faster than it starts
      };
    } else if (id === 'gusty') {
      const s = src();
      const lp = filt('lowpass', 300, 0.7), gb = gain(0);
      const bp = filt('bandpass', 350, 7), gh = gain(0);
      const gust = gain(0.55);
      lp.connect(gb).connect(gust);
      bp.connect(gh).connect(gust);
      s.connect(lp); s.connect(bp);
      gust.connect(out);
      const lfo1 = ctx.createOscillator(); lfo1.type = 'sine'; lfo1.frequency.value = 0.21;
      const lfo2 = ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 0.13;
      const d1 = gain(0), d2 = gain(0);
      lfo1.connect(d1).connect(gust.gain);
      lfo2.connect(d2).connect(gust.gain);
      const bpMod = ctx.createOscillator(); bpMod.type = 'sine'; bpMod.frequency.value = 0.21;
      const bpDepth = gain(0); bpMod.connect(bpDepth).connect(bp.frequency);
      lfo1.start(); lfo2.start(); bpMod.start();
      nodes.push(lfo1, lfo2, bpMod);
      setStrength = (k) => {
        const t = ctx.currentTime;
        lp.frequency.setTargetAtTime(200 + k * 1600, t, 0.1);
        gb.gain.setTargetAtTime(0.06 + k * 0.55, t, 0.1);
        bp.frequency.setTargetAtTime(300 + k * 700, t, 0.1);
        gh.gain.setTargetAtTime(k * 0.45, t, 0.1);
        gust.gain.setTargetAtTime(0.5 + 0.1 * k, t, 0.15);
        const depth = 0.18 + 0.42 * k;
        d1.gain.setTargetAtTime(depth, t, 0.2);
        d2.gain.setTargetAtTime(depth * 0.7, t, 0.2);
        bpDepth.gain.setTargetAtTime(220 * k, t, 0.2);
      };
    } else { // aeolian — singing wind through wires
      const s = src();
      const voices = [405, 612, 835].map((f, i) => {
        const bp = filt('bandpass', f, 24), g = gain(0);
        s.connect(bp).connect(g).connect(out);
        const amp = ctx.createOscillator(); amp.type = 'sine'; amp.frequency.value = 0.3 + i * 0.17;
        const ad = gain(0); amp.connect(ad).connect(g.gain); amp.start();
        nodes.push(amp);
        return { bp, g, ad, f };
      });
      setStrength = (k) => {
        const t = ctx.currentTime;
        const scale = 0.8 + 0.6 * k;
        voices.forEach((v, i) => {
          v.bp.frequency.setTargetAtTime(v.f * scale, t, 0.1);
          const lvl = Math.max(0, k - 0.12) * (0.55 - i * 0.12); // near-silent until it picks up
          v.g.gain.setTargetAtTime(lvl, t, 0.12);
          v.ad.gain.setTargetAtTime(lvl * 0.5, t, 0.2);
        });
      };
    }

    return {
      out, setStrength,
      fadeIn(dur) {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(1, t + dur);
      },
      stop(dur) {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + dur); // ease out, never cut
        setTimeout(() => {
          nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
          try { out.disconnect(); } catch (e) { /* already gone */ }
        }, dur * 1000 + 200);
      },
    };
  }

  // Start the ambient wind bed (idempotent — safe to call on each match start).
  windStart() {
    const ctx = this.ensure();
    if (this.w && this.w.running) return;
    const panner = ctx.createStereoPanner();
    const level = ctx.createGain(); level.gain.value = 0.0001;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    panner.connect(analyser);          // tap pre-level for lull detection
    panner.connect(level).connect(this.master);
    this.w = {
      running: true, panner, level, analyser,
      noise: this.windNoise(4), voice: null,
      id: 'gusty', cycleAt: 0, swapPending: false, pendingSince: 0,
      buf: new Uint8Array(analyser.fftSize),
    };
    this._windSwap('gusty', 0.3);
    this.w.cycleAt = ctx.currentTime + 8 + Math.random() * 5;
    level.gain.setTargetAtTime(this._windLevel ?? 0.5, ctx.currentTime, 0.6); // ease the bed in (music ducks this)
  }

  _windSwap(id, fade) {
    if (this.w.voice) this.w.voice.stop(fade);
    this.w.id = id;
    this.w.voice = this.windVoice(id);
    this.w.voice.out.connect(this.w.panner);
    this.w.voice.fadeIn(fade);
  }

  _windRms() {
    const an = this.w.analyser;
    an.getByteTimeDomainData(this.w.buf);
    let s = 0;
    for (let i = 0; i < this.w.buf.length; i += 1) { const x = (this.w.buf[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / this.w.buf.length);
  }

  // Feed the live signed wind value (px/s², −MAX_WIND..MAX_WIND) every frame.
  windUpdate(wind) {
    const w = this.w;
    if (!w || !w.running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = Math.min(1, Math.abs(wind) / MAX_WIND);
    const dir = wind < 0 ? -1 : 1;

    w.voice.setStrength(this.enabled ? k : 0);
    w.panner.pan.setTargetAtTime(dir * k * 0.6, now, 0.08);   // lean toward the heading
    w.level.gain.setTargetAtTime(this.enabled ? (this._windLevel ?? 0.5) : 0.0001, now, 0.1); // live mute on M + music duck

    // Random character cycle: once the spell elapses, wait for a lull (or a 2.5 s
    // cap) so the crossfade lands between gusts rather than across one.
    if (!w.swapPending) {
      if (now >= w.cycleAt) { w.swapPending = true; w.pendingSince = now; }
    } else if (this._windRms() < 0.05 || now - w.pendingSince > 2.5) {
      const others = ['whoosh', 'howl', 'gusty', 'aeolian'].filter((v) => v !== w.id);
      this._windSwap(others[Math.floor(Math.random() * others.length)], 1.4);
      w.swapPending = false;
      w.cycleAt = now + 8 + Math.random() * 5;
    }
  }

  // Fade the wind bed out and tear it down (call at match end / scene shutdown).
  windStop() {
    const w = this.w;
    if (!w || !w.running) return;
    w.running = false;
    const ctx = this.ctx;
    w.level.gain.cancelScheduledValues(ctx.currentTime);
    w.level.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    if (w.voice) w.voice.stop(0.8);
    setTimeout(() => { try { w.panner.disconnect(); w.level.disconnect(); } catch (e) { /* gone */ } }, 1200);
    this.w = null;
  }

  // ── Per-biome music ─────────────────────────────────────────────────────────
  // Public API: musicStart() on match enter, musicTransition() on the inter-round
  // camera pan (crossfades volume + tempo), musicStop() at match end. Mute (M)
  // and the wind duck are honoured continuously from the scheduler.

  // Start the music bed for a biome at a given manche (idempotent — restarts clean).
  musicStart(biomeId, round, decider) {
    const ctx = this.ensure();
    this._musTeardown();
    this.m = {
      level: ctx.createGain(), players: [], noiseBuf: this._musNoise(2),
      tempoBpm: 120, glide: null, route: null, currentId: 0,
    };
    this.m.level.gain.value = this.enabled ? MUSIC_LEVEL : 0.0001;
    this.m.level.connect(this.master);
    this._windLevel = MUSIC_WIND_DUCK;             // duck the wind bed under the music
    this._musCrossfade(this._musTrackForRound(biomeId, round, decider), 0);
  }

  // Crossfade (volume + BPM glide) to the new manche's track, over `durSec`,
  // matched to the inter-round camera slide. Falls back to a fresh start.
  musicTransition(biomeId, round, decider, durSec) {
    if (!this.m) { this.musicStart(biomeId, round, decider); return; }
    this._musCrossfade(this._musTrackForRound(biomeId, round, decider), durSec || 1.1);
  }

  // Fade the music out and tear it down; restore the wind bed.
  musicStop() {
    const m = this.m;
    if (!m) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    m.level.gain.cancelScheduledValues(t);
    m.level.gain.setValueAtTime(m.level.gain.value, t);
    m.level.gain.linearRampToValueAtTime(0.0001, t + 0.8);
    m.players.forEach((p) => {
      p.bus.gain.cancelScheduledValues(t);
      p.bus.gain.setValueAtTime(p.bus.gain.value, t);
      p.bus.gain.linearRampToValueAtTime(0, t + 0.8);
    });
    setTimeout(() => {
      m.players.slice().forEach((p) => this._musKill(p));
      try { m.level.disconnect(); } catch (e) { /* gone */ }
    }, 1000);
    this.m = null;              // detach now; the timeout finishes the teardown
    this._windLevel = 0.5;      // restore the wind bed
  }

  _musTeardown() {
    if (!this.m) return;
    this.m.players.slice().forEach((p) => this._musKill(p));
    try { this.m.level.disconnect(); } catch (e) { /* gone */ }
    this.m = null;
  }

  _musTrackForRound(biomeId, round, decider) {
    const b = M_BIOMES[biomeId] || M_BIOMES.meadow;
    // The "final" track is the tension theme: it plays on any round that can decide
    // the match (a player one win away), not just a fixed last round.
    if (decider) return b.final;
    return (round % 2 === 1) ? b.ambient[0] : b.ambient[1];
  }

  // Tempo at an audio time — interpolates (smoothstep) during a manche transition.
  _musBpmAt(t) {
    const g = this.m.glide;
    if (g) {
      const k = (t - g.start) / g.dur;
      if (k <= 0) return g.from;
      if (k >= 1) return g.to;
      const e = k * k * (3 - 2 * k);
      return g.from + (g.to - g.from) * e;
    }
    return this.m.tempoBpm;
  }
  _musStepDur(t) { return (60 / this._musBpmAt(t)) / 4; }

  _musCrossfade(id, dur) {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const toBpm = M_TRACKS[id].bpm;
    const fromBpm = this._musBpmAt(t);
    if (this.m.players.length > 0 && dur > 0.05) {
      const g = { from: fromBpm, to: toBpm, start: t, dur };
      this.m.glide = g;
      setTimeout(() => { if (this.m && this.m.glide === g) this.m.glide = null; }, dur * 1000 + 60);
    } else {
      this.m.glide = null;
    }
    this.m.tempoBpm = toBpm;
    this.m.players.forEach((p) => {
      p.bus.gain.cancelScheduledValues(t);
      p.bus.gain.setValueAtTime(p.bus.gain.value, t);
      p.bus.gain.linearRampToValueAtTime(0, t + dur);
      setTimeout(() => this._musKill(p), dur * 1000 + 250);
    });
    const np = this._musMakePlayer(id);
    np.bus.gain.setValueAtTime(0, t);
    np.bus.gain.linearRampToValueAtTime(MUSIC_VOICE, t + Math.max(0.02, dur));
    this.m.players.push(np);
    this.m.currentId = id;
  }

  _musMakePlayer(id) {
    const ctx = this.ctx;
    const p = { id, tr: M_TRACKS[id], bus: ctx.createGain(), step: 0, nextTime: ctx.currentTime + 0.08, timer: null };
    p.bus.gain.value = 0;
    p.bus.connect(this.m.level);
    p.timer = setInterval(() => this._musPump(p), 25);
    this._musPump(p);
    return p;
  }
  _musPump(p) {
    if (!this.m) return;
    const ctx = this.ctx;
    this.m.level.gain.setTargetAtTime(this.enabled ? MUSIC_LEVEL : 0.0001, ctx.currentTime, 0.05); // live mute on M
    while (p.nextTime < ctx.currentTime + 0.20) { // ~200ms lookahead: survives a main-thread stall up to that long without a gap
      const sd = this._musStepDur(p.nextTime); // shared, possibly-gliding tempo
      this._musStep(p.tr, p.step, p.nextTime, sd, p.bus);
      p.nextTime += sd; p.step += 1;
    }
  }
  _musKill(p) {
    if (p.timer) { clearInterval(p.timer); p.timer = null; }
    try { p.bus.disconnect(); } catch (e) { /* gone */ }
    if (this.m) { const i = this.m.players.indexOf(p); if (i >= 0) this.m.players.splice(i, 1); }
  }

  // ── music voices (connect to this.m.route, the active crossfade bus) ──
  _musMtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  _musChord(tr, deg, k) { const idx = deg + k; const oct = Math.floor(idx / 7); const note = ((idx % 7) + 7) % 7; return tr.root + tr.scale[note] + 12 * oct; }
  _musHasFx(tr, name) { return tr.fx === name || (Array.isArray(tr.fx) && tr.fx.indexOf(name) >= 0); }
  _musNoise(seconds) { const ctx = this.ctx; const len = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1; return buf; }
  _musNoiseSrc() { const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.m.noiseBuf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; return s; }

  _musTone(type, t, freq, dur, vol, cutoff) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(11000, cutoff || freq * 7), t);
    if (type === 'sawtooth') lp.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 3), t + dur);
    const g = ctx.createGain();
    const a = 0.006, r = Math.min(0.12, dur * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, dur - r));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(this.m.route);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _musPad(t, freq, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    const a = dur * 0.35, r = dur * 0.4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, dur - r));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.m.route);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _musBell(t, freq, dur, vol) {
    const ctx = this.ctx;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * 2.0;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 3, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.4 + 1, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    car.connect(g).connect(this.m.route);
    mod.start(t); car.start(t); mod.stop(t + dur + 0.02); car.stop(t + dur + 0.02);
  }
  _musLead(tr, t, freq, dur, vol) {
    if (tr.lead === 'fmbell') return this._musBell(t, freq, dur, vol * 1.1);
    if (tr.lead === 'saw') return this._musTone('sawtooth', t, freq, dur, vol);
    return this._musTone('square', t, freq, dur, vol);
  }
  _musKick(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.m.route);
    o.start(t); o.stop(t + 0.22);
  }
  _musNoiseHit(t, opts) {
    const ctx = this.ctx;
    const s = this._musNoiseSrc();
    const f = ctx.createBiquadFilter(); f.type = opts.filter; f.frequency.value = opts.freq; f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    s.connect(f).connect(g).connect(this.m.route);
    s.start(t); s.stop(t + opts.dur + 0.02);
    return { f, g };
  }
  _musHat(t, v) { this._musNoiseHit(t, { filter: 'highpass', freq: 7000, vol: v, dur: 0.04 }); }
  _musSnare(t, v) { this._musNoiseHit(t, { filter: 'bandpass', freq: 1800, q: 0.8, vol: v, dur: 0.13 }); }
  _musCrack(t, v) { this._musNoiseHit(t, { filter: 'highpass', freq: 4200, vol: v, dur: 0.05 }); }
  _musEmber(t) { this._musNoiseHit(t, { filter: 'lowpass', freq: 700, vol: 0.05 + Math.random() * 0.05, dur: 0.05 + Math.random() * 0.05 }); }
  _musBlast(t, v) { this._musNoiseHit(t, { filter: 'lowpass', freq: 1400, vol: v, dur: 0.32 }); }
  _musSweep(t, dur) { const n = this._musNoiseHit(t, { filter: 'bandpass', freq: 600, q: 1.2, vol: 0.12, dur }); n.f.frequency.setValueAtTime(500, t); n.f.frequency.exponentialRampToValueAtTime(6000, t + dur); }

  // One 1/16 step of a track at audio time `t`, routed to crossfade bus `bus`.
  _musStep(tr, s, t, stepDur, bus) {
    this.m.route = bus;
    const bar = Math.floor(s / 16) % tr.prog.length;
    const b = s % 16;
    const deg = tr.prog[bar];
    const beat = stepDur * 4;
    const barDur = stepDur * 16;

    if (b === 0) {
      if (tr.drone) {
        this._musTone('sawtooth', t, this._musMtof(this._musChord(tr, deg, 0) - 12), barDur, 0.12, 600);
        this._musTone('sawtooth', t, this._musMtof(this._musChord(tr, deg, 4) - 12) * 1.004, barDur, 0.08, 700);
        if (tr.heavy) this._musTone('sawtooth', t, this._musMtof(this._musChord(tr, deg, 0)) * 0.997, barDur, 0.09, 1500);
      }
      if (tr.pad) {
        this._musPad(t, this._musMtof(this._musChord(tr, deg, 0)), barDur, 0.05);
        this._musPad(t, this._musMtof(this._musChord(tr, deg, 2)), barDur, 0.04);
        this._musPad(t, this._musMtof(this._musChord(tr, deg, 4)), barDur, 0.04);
      }
      if (this._musHasFx(tr, 'sweep') && bar % 2 === 1) this._musSweep(t, barDur);
    }

    if (tr.bassMode) {
      let hit = false, dur = beat;
      if (tr.bassMode === 'half') { hit = (b === 0 || b === 8); dur = beat * 2; }
      else if (tr.bassMode === 'quarter') { hit = (b % 4 === 0); dur = beat * 0.9; }
      else if (tr.bassMode === 'eighth') { hit = (b % 2 === 0); dur = beat * 0.5; }
      if (hit) {
        const bf = this._musMtof(this._musChord(tr, deg, 0) - 12);
        if (tr.lead === 'saw' || tr.bassMode === 'eighth') this._musTone('sawtooth', t, bf, dur, 0.16, bf * 4);
        else this._musTone('triangle', t, bf, dur, 0.22, bf * 5);
      }
    }

    if (tr.lead && tr.arp && (s % tr.arp === 0)) {
      const ai = Math.floor(s / tr.arp) % M_ARP.length;
      const note = this._musChord(tr, deg, M_ARP[ai]) + (tr.leadOct != null ? tr.leadOct : 12);
      const ldur = stepDur * tr.arp * 0.9;
      const lvol = tr.lead === 'fmbell' ? 0.16 : 0.14;
      this._musLead(tr, t, this._musMtof(note), ldur, lvol);
      if (tr.bell && b % 8 === 0) this._musBell(t, this._musMtof(note + 12), beat, 0.1);
      if (tr.stab && b % 4 === 0) this._musTone('square', t, this._musMtof(this._musChord(tr, deg, 2) + 12), beat * 0.4, 0.1, 5000);
    }

    const dl = tr.drums;
    if (dl >= 1 && b === 0) this._musKick(t, 0.5);
    if (dl >= 3 && b === 8) this._musKick(t, 0.5);
    if (dl >= 4 && (b === 4 || b === 12)) this._musKick(t, 0.42);
    if (dl >= 3 && (b === 4 || b === 12)) this._musSnare(t, 0.13);
    if (dl >= 2) { if (dl >= 4 ? (b % 2 === 0) : (b % 4 === 2)) this._musHat(t, 0.07); }

    if (this._musHasFx(tr, 'ember') && Math.random() < 0.25) this._musEmber(t + Math.random() * stepDur);
    if (this._musHasFx(tr, 'crack') && (b === 6 || b === 14) && Math.random() < 0.6) this._musCrack(t, 0.12);
    if (this._musHasFx(tr, 'blast') && (b === 0 || b === 8)) this._musBlast(t, 0.26);
  }
}
