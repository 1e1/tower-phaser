// 3-way living-battlefield ranking (lot 7). Tie goes to the Intendant.
//
//   node test/scoring.test.mjs

import { livingResult } from '../src/sim/scoring.js';

let passed = 0; let failed = 0;
const log = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (ok) passed += 1; else failed += 1; };
const eq = (a, b) => a.winner === b.winner && a.draw === b.draw;

log(eq(livingResult(3, 1, 0), { winner: 0, draw: false }), 'P1 leads → P1 wins');
log(eq(livingResult(1, 3, 2), { winner: 1, draw: false }), 'P2 leads → P2 wins');
log(eq(livingResult(2, 1, 3), { winner: 2, draw: false }), 'Intendant leads → Intendant wins');
log(eq(livingResult(3, 1, 3), { winner: 2, draw: false }), 'tie P1=P3 → Intendant takes it');
log(eq(livingResult(1, 3, 3), { winner: 2, draw: false }), 'tie P2=P3 → Intendant takes it');
log(eq(livingResult(3, 3, 3), { winner: 2, draw: false }), 'three-way tie → Intendant');
log(eq(livingResult(3, 3, 1), { winner: -1, draw: true }), 'duelists tie above P3 → duel draw');
log(eq(livingResult(0, 0, 0), { winner: 2, draw: false }), 'all zero → Intendant (tie rule, edge)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
