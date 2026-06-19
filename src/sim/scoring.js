// Living-battlefield end-of-match ranking (lot 7).
//
// Three roles are ranked on ONE integer scale: the two duelists by victory
// points (rounds won, first-to-N) and the Intendant by successful crossings
// (`battlefield.score`). Highest wins. A TIE GOES TO THE INTENDANT — the
// outsider is crowned on equality (this is what lets us drop the fractional
// half-point the spec once needed; see design/battlefield-regles.md §6bis).
//
// Returns { winner, draw } where winner is 0 (P1), 1 (P2), 2 (Intendant), or
// -1 on a pure duel draw that still beats the Intendant.
export function livingResult(scoreP1, scoreP2, scoreP3) {
  const top = Math.max(scoreP1, scoreP2, scoreP3);
  // Tie→P3: if the Intendant matches (or exceeds) the top score, he takes it.
  if (scoreP3 === top) return { winner: 2, draw: false };
  // Otherwise a duelist leads; equal duel scores above P3 are a duel draw.
  if (scoreP1 === scoreP2) return { winner: -1, draw: true };
  return { winner: scoreP1 > scoreP2 ? 0 : 1, draw: false };
}
