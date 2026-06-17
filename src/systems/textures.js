// Generate the small reusable textures used by particle emitters and parallax
// scenery. Drawing them once at boot keeps the project asset-free while still
// allowing tinted, blended particles.
export function generateTextures(scene) {
  if (scene.textures.exists('spark')) return;

  const make = () => scene.make.graphics({ x: 0, y: 0, add: false });

  // Hard little dot for sparks, debris, snow and embers (tinted at runtime).
  let g = make();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(5, 5, 5);
  g.generateTexture('spark', 10, 10);
  g.destroy();

  // Soft puff built from stacked translucent circles, used for smoke.
  g = make();
  for (let r = 16; r > 0; r -= 2) {
    g.fillStyle(0xffffff, 0.06);
    g.fillCircle(16, 16, r);
  }
  g.generateTexture('smoke', 32, 32);
  g.destroy();

  // Bright additive flash for muzzle and impact cores.
  g = make();
  for (let r = 24; r > 0; r -= 3) {
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(24, 24, r);
  }
  g.fillStyle(0xffffff, 1);
  g.fillCircle(24, 24, 7);
  g.generateTexture('flash', 48, 48);
  g.destroy();

  // Soft cloud blob composed from several overlapping circles.
  g = make();
  const blobs = [
    [60, 50, 40],
    [110, 40, 50],
    [160, 50, 42],
    [90, 58, 38],
    [135, 58, 38],
  ];
  for (const [x, y, r] of blobs) {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y, r);
  }
  g.generateTexture('cloud', 220, 100);
  g.destroy();
}
