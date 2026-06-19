// Server-room test for the living-battlefield third seat (lot 5).
//
//   node test/room.test.mjs
//
// Proves, with fake sockets (no real ws):
//   (a) with livingBattlefield ON, the 3rd participant becomes the Intendant
//       (slot 2) instead of queueing; with it OFF he queues as a spectator,
//   (b) starting the match builds a battlefield sim and marks the Intendant
//       present,
//   (c) `intendant` / `intendantBuild` intents route to the battlefield sim,
//   (d) the Intendant's disconnect reverts the world to a pure duel
//       (present=false) and a rejoin within grace reclaims the seat (present=true).
//
// Pure Node. Exit 0 = green.

import Room from '../server/Room.js';

let passed = 0; let failed = 0;
const log = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (ok) passed += 1; else failed += 1; };
const sock = () => ({ readyState: 1, sent: [], send(d) { this.sent.push(d); } });

// Drive a room up to a started living-battlefield match with P1, P2 + Intendant.
function startedRoom() {
  const room = new Room('TEST', () => {});
  const tv = sock(); room.addTv(tv);
  const p0 = sock(); const r0 = room.addParticipant(p0, 'P1');
  const p1 = sock(); const r1 = room.addParticipant(p1, 'P2');
  // P1 (config owner) turns the mode on, validates, and picks a camp.
  room.setConfig(p0, { livingBattlefield: true });
  return { room, tv, p0, p1, r0, r1 };
}

// --- (a) seat assignment toggles on the mode flag ---------------------------
{
  // OFF: third participant queues.
  const off = new Room('OFF', () => {});
  off.addTv(sock());
  off.addParticipant(sock(), 'P1');
  off.addParticipant(sock(), 'P2');
  const third = off.addParticipant(sock(), 'Third');
  log(third.role === 'spectator', '(a) mode OFF: 3rd participant queues as spectator');
  log(off.intendant === null, '(a) mode OFF: no Intendant seat');

  // ON: third participant becomes the Intendant at slot 2.
  const { room } = startedRoom();
  const it = room.addParticipant(sock(), 'Intendant');
  log(it.role === 'player' && it.slot === 2 && it.livingBattlefield === true, '(a) mode ON: 3rd participant is the Intendant (slot 2)');
  log(!!room.intendant && room.intendant.name === 'Intendant', '(a) mode ON: Intendant seat recorded');
  room.dispose();
}

// --- (b) start builds the sim + marks Intendant present ---------------------
{
  const { room, p0 } = startedRoom();
  const iSock = sock();
  const it = room.addParticipant(iSock, 'Int');
  room.markConfigDone(p0, true);
  room.chooseCamp(p0, 0); // first-tap camp → lobby complete → auto start
  log(!!room.sim, '(b) match started');
  log(!!room.sim && !!room.sim.battlefield, '(b) livingBattlefield sim built');
  log(!!room.sim && room.sim.battlefield.present === true, '(b) Intendant marked present');

  // --- (c) intents route to the battlefield sim ---------------------------
  room.handleIntendant(iSock, { right: true, dig: true });
  const bf = room.sim.battlefield;
  log(bf.input.right === true && bf.input.dig === true, '(c) intendant input routed to the sim');
  // a foreign socket must not be able to drive the Intendant
  room.handleIntendant(sock(), { left: true });
  log(bf.input.left === false, '(c) non-Intendant socket cannot drive the Intendant');
  let threw = false;
  try { room.handleIntendantBuild(iSock, 'bridge'); } catch { threw = true; }
  log(!threw, '(c) intendantBuild routes without throwing');

  // --- (d) disconnect: present during grace; dormant only on release ------
  room.removeSocket(iSock);
  log(room.intendant && room.intendant.disconnected === true, '(d) disconnect holds the seat (grace)');
  log(room.sim.battlefield.present === true, '(d) <10s grace: still present (auto-actions continue)');
  log(bf.input.right === false && bf.input.dig === false, '(d) held inputs frozen on disconnect (avatar stops moving)');
  const reSock = sock();
  log(room.rejoin(reSock, it.token, 'Int') === true, '(d) rejoin within grace reclaims the seat');
  log(room.sim.battlefield.present === true, '(d) present after reclaim');
  // grace expiry with no reconnect → seat released → world dormant
  room.removeSocket(reSock);
  room.dropIntendant(it.token);
  log(room.intendant === null, '(d) >10s: grace expiry releases the Intendant seat');
  log(room.sim.battlefield.present === false, '(d) world goes dormant once the seat is released');
  room.dispose();
}

// --- (e) lot 6: a waiting spectator is promoted into a freed Intendant seat ---
{
  const { room, p0 } = startedRoom();
  const iSock = sock();
  const it = room.addParticipant(iSock, 'Int');
  // a 4th participant queues (both duel seats + Intendant taken)
  const wSock = sock();
  const w = room.addParticipant(wSock, 'Waiter');
  log(w.role === 'spectator', '(e) 4th participant queues while all 3 seats are full');
  // Intendant leaves → the waiting spectator is promoted into seat 2
  room.exit(iSock);
  log(room.intendant && room.intendant.name === 'Waiter' && room.intendant.socket === wSock, '(e) waiting spectator promoted into the freed Intendant seat');
  const promoted = wSock.sent.map((s) => JSON.parse(s)).find((m) => m.t === 'promote');
  log(!!promoted && promoted.player === 2, '(e) promote message targets slot 2');
  room.markConfigDone(p0, true); room.chooseCamp(p0, 0);
  room.dispose();
}

// --- (f) lot 6: a duel player abandoning a 3-player match forfeits ----------
{
  const { room, p0, p1 } = startedRoom();
  const iSock = sock();
  room.addParticipant(iSock, 'Int');
  room.markConfigDone(p0, true); room.chooseCamp(p0, 0);
  if (!room.sim) throw new Error('match did not start');
  // P2 (slot 1) leaves for good with the Intendant present, no one waiting →
  // P2's tower is razed and the match ends with P1 (slot 0) the duel winner.
  room.exit(p1);
  log(room.sim && room.sim.phase === 'matchEnd', '(f) P2 abandoning a 3-player match ends the match (forfeit)');
  log(room.sim && room.sim.scores[0] >= room.sim.winsNeeded, '(f) the remaining duelist (P1) is the duel winner');
  room.dispose();
}

// --- (g) lot 6: voluntary step-back — cede my seat to a waiting player -------
{
  const room = new Room('STEP', () => {});
  room.addTv(sock());
  const p0sock = sock(); room.addParticipant(p0sock, 'P1'); // config owner (slot 0)
  const p1sock = sock(); room.addParticipant(p1sock, 'P2'); // slot 1, not owner
  const specSock = sock(); const sres = room.addParticipant(specSock, 'Spec'); // queues (mode off)
  log(sres.role === 'spectator', '(g) 3rd participant queues as spectator (mode off)');

  // The config owner cannot step back (a promoted player never inherits ownership).
  room.stepBack(p0sock);
  log(room.players[0] && room.players[0].name === 'P1', '(g) config owner cannot step back (no-op)');

  // P2 (non-owner) steps back → Spec is promoted into slot 1, P2 re-queues last.
  room.stepBack(p1sock);
  log(room.players[1] && room.players[1].name === 'Spec', '(g) waiting player promoted into the freed seat');
  log(room.waiting.length === 1 && room.waiting[0].name === 'P2', '(g) stepper re-queued at the back of the list');
  log(p1sock.role === 'spectator', '(g) stepper becomes a spectator');
  const toSpec = p1sock.sent.map((s) => JSON.parse(s)).find((m) => m.t === 'joined' && m.role === 'spectator');
  log(!!toSpec, '(g) stepper told to spectate (joined/role:spectator)');
  room.dispose();

  // No-op when nobody is waiting to take over.
  const solo = new Room('SOLO', () => {});
  solo.addTv(sock());
  solo.addParticipant(sock(), 'A');
  const bSock = sock(); solo.addParticipant(bSock, 'B');
  solo.stepBack(bSock);
  log(solo.players[1] && solo.players[1].name === 'B' && solo.waiting.length === 0, '(g) step-back is a no-op with an empty queue');
  solo.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
