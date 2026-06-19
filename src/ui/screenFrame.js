import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';

// Dressing for the FIT letterbox/pillarbox bands (Phaser.Scale.FIT keeps the
// 16:9 ratio, so any non-16:9 window leaves bands left/right or top/bottom).
//
// Validated rule — driven by screen ratio × match state:
//   • ~16:9 window (native TV)            → no bands; only the canvas bezel shows.
//   • non-native ratio, OUT of a match    → CRT snow on the bands + scanlines over
//                                            the whole screen (a "TV at rest" look).
//   • non-native ratio, match in progress → clean bands, no FX (nothing over the
//                                            living battlefield).
//
// The bezel itself is static CSS on the canvas (index.html); this module only
// owns the two dynamic layers and the ratio/state logic. A single instance lives
// in the Phaser registry ('screenFrame'); scenes flip setMatchActive() as they
// enter/leave the battlefield.

// Low internal resolution → chunky retro grain, cheap to repaint each frame.
const SNOW_W = 220;
const SNOW_H = 124;
// A couple of stray pixels of band are invisible; below this we treat the window
// as effectively native and show nothing.
const NATIVE_BAND_PX = 4;

export default class ScreenFrame {
  constructor() {
    this.parent = document.getElementById('game');
    this.canvas = this.parent ? this.parent.querySelector('canvas') : null;
    this.native = true;
    this.matchActive = false;
    this.running = false;
    this.rafId = 0;
    if (this.parent) this.build();
    this.onResize = () => this.measure();
    window.addEventListener('resize', this.onResize);
    this.measure();
  }

  build() {
    // #game must establish a stacking context so the band layers sit relative to
    // it; the canvas keeps z-index 2 between snow (behind) and scanlines (front).
    this.parent.style.position = 'relative';
    if (this.canvas) {
      this.canvas.style.position = 'relative';
      this.canvas.style.zIndex = '2';
    }

    // CRT snow — behind the (opaque) canvas, so it only shows on the bands.
    const snow = document.createElement('canvas');
    snow.width = SNOW_W;
    snow.height = SNOW_H;
    snow.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:1;'
      + 'image-rendering:pixelated;pointer-events:none;display:none;';
    this.parent.insertBefore(snow, this.canvas || null);
    this.snow = snow;
    this.sctx = snow.getContext('2d');
    this.img = this.sctx.createImageData(SNOW_W, SNOW_H);

    // Scanlines — above the canvas, so they pass over the game (here, the lobby).
    const scan = document.createElement('div');
    scan.style.cssText =
      'position:absolute;inset:0;z-index:3;pointer-events:none;display:none;'
      + 'background:repeating-linear-gradient(0deg,'
      + 'rgba(0,0,0,0.18) 0px,rgba(0,0,0,0.18) 1px,transparent 1px,transparent 3px);';
    this.parent.appendChild(scan);
    this.scan = scan;
  }

  measure() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(w / GAME_WIDTH, h / GAME_HEIGHT);
    const bandX = w - GAME_WIDTH * scale;
    const bandY = h - GAME_HEIGHT * scale;
    this.native = bandX < NATIVE_BAND_PX && bandY < NATIVE_BAND_PX;
    this.apply();
  }

  setMatchActive(on) {
    on = !!on;
    if (on === this.matchActive) return;
    this.matchActive = on;
    this.apply();
  }

  apply() {
    const showFx = !this.native && !this.matchActive;
    if (this.snow) this.snow.style.display = showFx ? 'block' : 'none';
    if (this.scan) this.scan.style.display = showFx ? 'block' : 'none';
    if (showFx) this.startSnow();
    else this.stopSnow();
  }

  startSnow() {
    if (this.running || !this.sctx) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      const d = this.img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      this.sctx.putImageData(this.img, 0, 0);
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  stopSnow() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}
