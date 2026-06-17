// Central tuning values shared across scenes and game objects.

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

// Colour palette. Lot 2 will replace these flat values with per-biome themes.
export const COLORS = {
  skyTop: 0x1b2a4a,
  skyBottom: 0x395b8c,
  terrain: 0x4a7c3a,
  terrainEdge: 0x6aa84f,
  terrainDark: 0x33561f,
  towerP1: 0x4f8fff,
  towerP2: 0xff6b5e,
  barrel: 0xd7dde8,
  projectileP1: 0xbcd4ff,
  projectileP2: 0xffd0c0,
  hud: '#ffffff',
  hudDim: '#9fb0c8',
  ready: '#7CFC7C',
};

// Projectile ballistics, expressed in pixels and seconds.
export const PHYSICS = {
  gravity: 520, // downward acceleration (px/s^2)
  speedScale: 7, // initial speed = power * speedScale (px/s)
  maxFlightTime: 12, // safety cap for a single shot (s)
};

// Aiming ranges and adjustment speeds (per second while a key is held).
export const AIM = {
  minAngle: 5,
  maxAngle: 88,
  minPower: 15,
  maxPower: 100,
  angleRate: 38,
  powerRate: 46,
};

// Wind acceleration applied horizontally to projectiles (px/s^2).
export const MAX_WIND = 95;

// Radius (px) of the crater a (normal) shell carves out of the terrain.
export const CRATER_RADIUS = 38;

// Hidden jitter added to a shot at fire time (never shown to the player), so
// over-precise aiming is rewarded a little less and every shot has tension.
export const AIM_NOISE = { angle: 2.5, power: 3 };

// Round-count choices offered on the setup screen.
export const ROUND_OPTIONS = [1, 3, 5, 7];

// Hit-point choices per tower (a tower falls when its HP reaches 0).
export const HP_OPTIONS = [1, 2, 3];

// Game modes chosen at setup. Classic = strict turn-by-turn volleys. Turbo =
// a shot clock (once one player validates, the other has `cadence` seconds to
// validate, else it auto-fires) and shells fly continuously, so the next shot
// can be aimed and validated as soon as the previous one has left the barrel.
export const GAME_MODES = [
  { id: 'classic', label: 'Classic', turbo: false, cadence: 0 },
  { id: 'turbo3', label: 'Turbo · 3s', turbo: true, cadence: 3 },
  { id: 'turbo5', label: 'Turbo · 5s', turbo: true, cadence: 5 },
  { id: 'turbo8', label: 'Turbo · 8s', turbo: true, cadence: 8 },
];
