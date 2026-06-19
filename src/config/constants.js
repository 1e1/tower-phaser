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
  // Shown before a side is claimed (and again at every rematch until a camp is
  // picked): a calm slate that belongs to neither player.
  towerNeutral: 0x6f7d96,
  // The third player (Intendant of the living world): a regal violet that is
  // neither camp's colour — he belongs to no army.
  intendant: 0xb483f0,
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
  // initial speed = power * speedScale (px/s). This is the difficulty knob for
  // "100% shouldn't be a gift": lowering it makes full power fall short on the
  // farther/uphill arenas, so power becomes a managed resource. Raised 7 → 7.7
  // (range ∝ v², so +10% speed ≈ +21% range) to restore headroom: at 7 full
  // charge only just reached the default spacing, leaving no margin against a
  // headwind (±MAX_WIND shaves ~170px at 45°), making some shots impossible.
  // 7.7 clears the default arena into a full headwind and the widest arena
  // (Volcano, ~1100px gap) with a moderate margin. Don't push past ~8 without
  // re-checking that close arenas don't turn floaty.
  speedScale: 7.7,
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

// Deployable defensive shield. It is a one-use munition (stock starts at 0; a
// player gains one each round they lose) placed IN PLACE of firing: the cannon
// angle sets its direction, the cannon power its distance from the tower (mapped
// minPower→maxPower onto minDist→maxDist). It has 1 HP — it absorbs a single
// incoming shell, then shatters. `plateHalf` is half the deflecting plate's
// length; `hitRadius` the shell/plate contact tolerance; `maxActive` caps how
// many plates a tower may keep standing at once (deploying past it is refused).
export const SHIELD = { minDist: 45, maxDist: 165, plateHalf: 39, hitRadius: 9, maxActive: 3 };

// The central windsock is an authoritative entity (not just TV decor): a 1-HP
// target standing on the mid-field terrain. `poleH` is its pole height (the
// flag sits at the top); `hitRadius` the contact tolerance around that top. A
// shell that downs it awards the firing player a shield (a mid-field bounty).
export const WINDSOCK = { poleH: 46, hitRadius: 14 };

// Hidden jitter added to a shot at fire time (never shown to the player), so
// over-precise aiming is rewarded a little less and every shot has tension.
export const AIM_NOISE = { angle: 2.5, power: 3 };

// "Winning rounds" choices offered on the setup screen: the match goes to the
// first player to win this many rounds (first to 1 = sudden death).
export const WIN_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

// Canonical label for the win target, so the wording lives in exactly one place.
export const winsLabel = (n) => `First to ${n}`;

// Hit-point choices per tower (a tower falls when its HP reaches 0).
export const HP_OPTIONS = [1, 2, 3];

// Game modes chosen at setup. Classic = strict turn-by-turn volleys. Turbo =
// a shot clock (once one player validates, the other has `cadence` seconds to
// validate, else it auto-fires) and shells fly continuously, so the next shot
// can be aimed and validated as soon as the previous one has left the barrel.
// Ordered from gentlest to fiercest turbo: a longer shot clock is easier, so it
// lights fewer "intensity" bars on the lobby gauge (8s → 1 bar, 5s → 2, 2s → 3).
export const GAME_MODES = [
  { id: 'classic', label: 'Classic', turbo: false, cadence: 0 },
  { id: 'turbo8', label: 'Turbo · 8s', turbo: true, cadence: 8 },
  { id: 'turbo5', label: 'Turbo · 5s', turbo: true, cadence: 5 },
  { id: 'turbo2', label: 'Turbo · 2s', turbo: true, cadence: 2 },
];

// How many "intensity" bars a turbo cadence lights on the lobby gauge.
// (classic lights none — it shows a turn-by-turn glyph instead.)
export function turboBars(cadence) {
  if (cadence <= 2) return 3;
  if (cadence <= 5) return 2;
  return 1;
}
