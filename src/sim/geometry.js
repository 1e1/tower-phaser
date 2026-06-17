// Tower geometry shared by the authoritative server (collision) and the TV
// renderer (drawing), kept free of Phaser so it can run under plain Node.

export const TOWER = {
  bodyWidth: 64,
  bodyHeight: 96,
  barrelLength: 52,
  barrelWidth: 12,
};

// Unit aim vector. Screen space, so the y axis points down.
export function aimVector(angleDeg, facing) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: facing * Math.cos(rad), y: -Math.sin(rad) };
}

export function pivot(tower) {
  return { x: tower.x, y: tower.groundY - TOWER.bodyHeight };
}

export function muzzle(tower) {
  const p = pivot(tower);
  const v = aimVector(tower.angle, tower.facing);
  return {
    x: p.x + v.x * TOWER.barrelLength,
    y: p.y + v.y * TOWER.barrelLength,
  };
}

// Axis-aligned body rectangle used for hit tests.
export function bounds(tower) {
  const p = pivot(tower);
  return {
    x: p.x - TOWER.bodyWidth / 2,
    y: p.y,
    w: TOWER.bodyWidth,
    h: TOWER.bodyHeight,
  };
}

export function rectContains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
