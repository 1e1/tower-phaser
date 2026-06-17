// Projectile types. Each shell trades range, wind sensitivity, blast size and
// damage. Pure data so the authoritative server, the controller UI and the
// renderers all agree.
//   windFactor : how much the wind pushes the shell
//   craterMul  : crater radius multiplier (terrain damage)
//   count/spread : cluster shells (a salvo)
//   dmg        : tower damage PER shell that connects (accumulates; a tower
//                falls when total damage reaches its HP)
//   svg        : inline icon markup (uses currentColor)
export const SHELLS = [
  {
    id: 'normal', name: 'Normal', windFactor: 1.0, craterMul: 1.0, count: 1, spread: 0, dmg: 1, tint: 0xffe066,
    svg: '<circle cx="12" cy="12" r="6"/>',
  },
  {
    id: 'heavy', name: 'Heavy', windFactor: 0.45, craterMul: 1.5, count: 1, spread: 0, dmg: 2, tint: 0xb0b6c2,
    svg: '<circle cx="12" cy="10.5" r="6"/><rect x="4.5" y="18" width="15" height="3.2" rx="1.6"/>',
  },
  {
    id: 'light', name: 'Light', windFactor: 1.85, craterMul: 0.8, count: 1, spread: 0, dmg: 1, tint: 0xbadff0,
    svg: '<circle cx="12" cy="15" r="5"/><path d="M7 8.5 L12 3.5 L17 8.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: 'salvo', name: 'Salvo', windFactor: 1.1, craterMul: 0.65, count: 3, spread: 6, dmg: 0.5, tint: 0xffb86b,
    svg: '<circle cx="6.5" cy="15.5" r="3.4"/><circle cx="17.5" cy="15.5" r="3.4"/><circle cx="12" cy="6.5" r="3.4"/>',
  },
  {
    id: 'explosive', name: 'Explosive', windFactor: 1.0, craterMul: 2.1, count: 1, spread: 0, dmg: 1.5, tint: 0xff5e5e,
    svg: '<path d="M12 1.5l2.4 6.4 6.7-.6-4.9 4.6 2.6 6.2-6.1-3.1-5.4 4 .9-6.8-5.6-3.9 6.7-1.2z"/>',
  },
];

export const SHELL_BY_ID = Object.fromEntries(SHELLS.map((s) => [s.id, s]));

export function getShell(id) {
  return SHELL_BY_ID[id] || SHELLS[0];
}
