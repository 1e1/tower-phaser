#!/usr/bin/env node
// Apply a battlefield-lab.html export to the engine balance.
//
//   node scripts/apply-lab-params.mjs <lab-export.json>
//   node scripts/apply-lab-params.mjs --stdin   # pipe the JSON in
//   node scripts/apply-lab-params.mjs <file> --dry   # show the diff, write nothing
//
// The lab's "Exporter JSON" emits { seed, params, spawnMode, weapon }. This lifts
// `params` (or a bare params object) into src/config/balance.js, which battlefield.js
// merges over its DEFAULT_PARAMS. It prints a key-level diff (added / removed / changed)
// so balance updates are reviewable, and flags lab keys the engine does not yet read.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const BALANCE_PATH = resolve(ROOT, 'src/config/balance.js');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const useStdin = args.includes('--stdin');
const fileArg = args.find((a) => !a.startsWith('--'));

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// --- read the incoming export --------------------------------------------------
let raw;
if (useStdin) {
  raw = readFileSync(0, 'utf8');
} else {
  if (!fileArg) die('usage: node scripts/apply-lab-params.mjs <lab-export.json> [--dry]');
  const p = resolve(process.cwd(), fileArg);
  if (!existsSync(p)) die(`file not found: ${p}`);
  raw = readFileSync(p, 'utf8');
}

let parsed;
try { parsed = JSON.parse(raw); } catch (e) { die(`invalid JSON: ${e.message}`); }
// Accept either a full lab export ({ params: {...} }) or a bare params object.
const params = parsed && typeof parsed.params === 'object' ? parsed.params : parsed;
if (!params || typeof params !== 'object' || Array.isArray(params)) die('no `params` object found in the input');

const badVals = Object.entries(params).filter(([, v]) => typeof v !== 'number' || !Number.isFinite(v));
if (badVals.length) die(`non-numeric param value(s): ${badVals.map(([k]) => k).join(', ')}`);

// --- diff against the current balance -------------------------------------------
let current = {};
if (existsSync(BALANCE_PATH)) {
  try { current = (await import(`${BALANCE_PATH}?t=${Date.now()}`)).default || {}; }
  catch { /* unreadable/first run → treat as empty */ }
}

const added = [], removed = [], changed = [];
for (const k of Object.keys(params)) {
  if (!(k in current)) added.push(k);
  else if (current[k] !== params[k]) changed.push([k, current[k], params[k]]);
}
for (const k of Object.keys(current)) if (!(k in params)) removed.push(k);

// Keys the engine does not yet consume (kept in sync with battlefield.js DEFAULT_PARAMS +
// the lab-only additions). Informational only — they are harmless until the logic port.
const ENGINE_UNUSED = new Set([
  'fallHmin', 'fallHmax', 'repTime', 'slopeFx', 'ballSpeed', 'musSpeed', 'bowSpeed', 'boltSpeed',
  'grenTime', 'grenLob', 'mqSpdMul', 'mqFallMul', 'grSpdMul', 'grFallMul', 'caSpdMul', 'caFallMul',
  'enSpdMul', 'enFallMul', 'sJump', 'mqJumpMul', 'grJumpMul', 'caJumpMul', 'enJumpMul', 'cataHp',
  'engHp', 'engBridgeMax', 'engLadH', 'engLadRun', 'cataRange', 'towerDmg', 'towerBolts', 'digH',
  'ballCraterR', 'grenCraterR', 'bayoDmgVar', 'grenDmgVar', 'ballDmgVar', 'swDmgVar', 'bayoWind',
  'bayoRec', 'bayoDmg', 'musWind', 'musRec', 'grenWind', 'grenRec', 'cataWind', 'cataRec', 'engWind',
  'engRec', 'engDur', 'swWind', 'swRec', 'bowWind', 'bowRec', 'toolWind', 'toolRec', 'toolDur',
  'buildWind', 'buildRec', 'buildDur',
]);

console.log(`\n  balance ← ${useStdin ? '<stdin>' : fileArg}   (${Object.keys(params).length} keys)\n`);
if (added.length) console.log(`  + added   : ${added.join(', ')}`);
if (removed.length) console.log(`  − removed : ${removed.join(', ')}`);
if (changed.length) {
  console.log('  ~ changed :');
  for (const [k, a, b] of changed) console.log(`      ${k}: ${a} → ${b}`);
}
if (!added.length && !removed.length && !changed.length) console.log('  (no changes)');

const notYetLive = Object.keys(params).filter((k) => ENGINE_UNUSED.has(k));
if (notYetLive.length) console.log(`\n  ⚠ present but NOT yet read by the engine (await the logic port): ${notYetLive.length} keys`);

// --- write balance.js -----------------------------------------------------------
const header = `// Living-battlefield BALANCE — single source of truth for the soldier/Intendant
// simulation tuning, in the SAME key schema the lab (design/battlefield-lab.html) exports.
// Regenerate from a lab export with:
//
//     node scripts/apply-lab-params.mjs <lab-export.json>
//
// battlefield.js merges this OVER its built-in DEFAULT_PARAMS (keys here win; engine-only
// keys keep their default; not-yet-consumed lab keys are harmless). DO NOT hand-edit for
// balance — tune in the lab, export, run the script.
`;
const body = `\nexport default ${JSON.stringify(params, null, 2)};\n`;

if (dry) { console.log('\n  --dry: balance.js left unchanged.\n'); process.exit(0); }
writeFileSync(BALANCE_PATH, header + body);
console.log(`\n  ✓ wrote ${BALANCE_PATH}\n`);
