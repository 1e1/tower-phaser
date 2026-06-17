// Biome themes selected on the setup screen. Each theme drives the sky
// gradient, terrain palette, celestial body, parallax scenery and the ambient
// particle effect, so every biome reads as a distinct place.

export const BIOMES = [
  {
    id: 'meadow',
    name: 'Meadow',
    sky: [0x6fb7ff, 0xcfeeff],
    terrain: { fill: 0x4a9b3a, edge: 0x7ed957, dark: 0x2f5d24 },
    celestial: { color: 0xfff3b0, glow: 0xffe066, x: 0.78, y: 0.22, radius: 46 },
    mountains: [0x9fc6e8, 0x7fb0dd],
    cloud: { color: 0xffffff, alpha: 0.9 },
    ambient: 'leaves',
    ambientColor: 0x9be36b,
    roughness: 1,
  },
  {
    id: 'desert',
    name: 'Desert',
    sky: [0xf6b66b, 0xfde9c8],
    terrain: { fill: 0xd9a441, edge: 0xf0cd7a, dark: 0x9c6f25 },
    celestial: { color: 0xfff0c0, glow: 0xffd27a, x: 0.5, y: 0.18, radius: 54 },
    mountains: [0xd8a566, 0xc28a4a],
    cloud: { color: 0xfff4e0, alpha: 0.5 },
    ambient: 'sand',
    ambientColor: 0xe9cf9a,
    roughness: 1.25,
  },
  {
    id: 'tundra',
    name: 'Tundra',
    sky: [0x9fb8d6, 0xeaf2fb],
    terrain: { fill: 0xe7eef6, edge: 0xffffff, dark: 0xa9bdd4 },
    celestial: { color: 0xfdfdff, glow: 0xdbe7ff, x: 0.7, y: 0.2, radius: 40 },
    mountains: [0xc7d6e8, 0xaebfd6],
    cloud: { color: 0xffffff, alpha: 0.8 },
    ambient: 'snow',
    ambientColor: 0xffffff,
    roughness: 0.85,
  },
  {
    id: 'volcano',
    name: 'Volcano',
    sky: [0x2a1430, 0x6e2535],
    terrain: { fill: 0x3a2f3a, edge: 0xff6b35, dark: 0x1d171d },
    celestial: { color: 0xfff0c0, glow: 0xff8c42, x: 0.24, y: 0.2, radius: 34 },
    mountains: [0x46303f, 0x32222f],
    cloud: { color: 0x5a3340, alpha: 0.55 },
    ambient: 'embers',
    ambientColor: 0xff7a33,
    roughness: 1.4,
  },
];
