// i18n sync + DeepL bulk translation for the tutorial catalogs.
//
// The FR catalog (docs-src/i18n/<slug>.fr.json) is the single source of truth.
// Every other language derives from it. This tool answers two questions the
// hand-maintained 5×N JSON files can't answer on their own:
//
//   1. What has drifted?  — keys missing in a locale, keys left over after a FR
//      rename, and keys whose FR source CHANGED since the translation was made.
//   2. Fill only the gap — push just those keys through DeepL (HTML tag mode,
//      so <b>…</b> & emojis survive), write them back, and leave everything
//      else byte-for-byte. The bulk goes to DeepL; the human review is targeted
//      at the handful of keys that actually moved.
//
//   node scripts/i18n-sync.mjs check                 → report drift, no writes
//   node scripts/i18n-sync.mjs check --strict        → exit 1 if anything drifts
//   node scripts/i18n-sync.mjs translate             → dry-run: list what WOULD be sent
//   node scripts/i18n-sync.mjs translate --apply     → call DeepL, write files, update lock
//   node scripts/i18n-sync.mjs init                  → baseline the lock to current FR
//
// Scope flags (any command): --page <slug>   --lang <en|de|es|it>
//
// Drift detection uses a lockfile (docs-src/i18n/.i18n-lock.json) that records,
// per slug+key, the hash of the FR source the translations correspond to. The
// first run auto-baselines it (existing translations are assumed current), so
// the very first `translate` only fills genuinely missing keys — it does not
// retranslate the corpus. After that, editing a FR value flags every locale's
// matching key as stale.
//
// Requires DEEPL_API_KEY in the environment for `translate --apply`. A free
// key (suffix ":fx") routes to api-free.deepl.com automatically.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { langs, defaultLang } from '../docs-src/site.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i18nDir = join(root, 'docs-src', 'i18n');
const lockPath = join(i18nDir, '.i18n-lock.json');

// DeepL target codes. EN-GB matches the doc's British spelling ("modernised").
const DEEPL_TARGET = { en: 'EN-GB', de: 'DE', es: 'ES', it: 'IT' };

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'check';
const has = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
const strict = has('--strict');
const apply = has('--apply');
const onlyPage = opt('--page');
const onlyLang = opt('--lang');

const targets = langs.filter((l) => l !== defaultLang && (!onlyLang || l === onlyLang));

// ── helpers ──────────────────────────────────────────────────────────────────
const hash = (s) => createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12);
const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m`, grn: (s) => `\x1b[32m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

// Every slug that has a FR catalog — covers _site and any future page for free.
const slugs = readdirSync(i18nDir)
  .filter((f) => f.endsWith(`.${defaultLang}.json`))
  .map((f) => f.slice(0, -`.${defaultLang}.json`.length))
  .filter((s) => !onlyPage || s === onlyPage)
  .sort();

const catalogPath = (slug, lang) => join(i18nDir, `${slug}.${lang}.json`);

// Parse a FR catalog into ordered lines, tagging the ones that are a string
// entry ("key": "value"). We mirror this exact line structure when we write a
// locale back, so grouping/order stay identical to FR and only values change.
const ENTRY = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"(\s*,?)\s*$/;
function parseFR(slug) {
  const text = readFileSync(catalogPath(slug, defaultLang), 'utf8');
  return text.split('\n').map((raw) => {
    const m = ENTRY.exec(raw);
    if (!m) return { raw, entry: false };
    const key = JSON.parse(`"${m[2]}"`);
    const value = JSON.parse(`"${m[3]}"`);
    return { raw, entry: true, indent: m[1], keyEsc: m[2], key, value, comma: m[4] };
  });
}

// ── drift analysis ─────────────────────────────────────────────────────────
// For one slug: which keys each target locale needs, and which keys it carries
// that FR no longer has. Stale = FR source hash differs from the lock.
function analyze(slug, lock) {
  const fr = parseFR(slug);
  const frEntries = fr.filter((l) => l.entry);
  const frKeys = new Set(frEntries.map((l) => l.key));
  const lk = lock[slug] || {};

  const stale = frEntries.filter((l) => lk[l.key] && lk[l.key] !== hash(l.value)).map((l) => l.key);
  const staleSet = new Set(stale);

  const perLang = {};
  for (const lang of targets) {
    const loc = readJSON(catalogPath(slug, lang));
    const missing = frEntries.filter((l) => !(l.key in loc)).map((l) => l.key);
    const extra = Object.keys(loc).filter((k) => !frKeys.has(k));
    // Keys to (re)translate for this locale: missing + stale (drifted FR).
    const need = frEntries.filter((l) => !(l.key in loc) || staleSet.has(l.key)).map((l) => l.key);
    perLang[lang] = { missing, extra, need, loc };
  }
  return { fr, frEntries, stale, perLang };
}

// ── DeepL ──────────────────────────────────────────────────────────────────
async function deepl(texts, target) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DEEPL_API_KEY is not set (a free key works; it ends with ":fx").');
  const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const out = [];
  for (let i = 0; i < texts.length; i += 50) { // DeepL caps at 50 texts/request
    const chunk = texts.slice(i, i + 50);
    const body = new URLSearchParams();
    body.set('source_lang', defaultLang.toUpperCase());
    body.set('target_lang', target);
    body.set('tag_handling', 'html');     // keep <b>/<strong>/<em>… intact
    body.set('split_sentences', 'nonewlines');
    for (const t of chunk) body.append('text', t);
    const res = await fetch(`${base}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    out.push(...data.translations.map((t) => t.text));
  }
  return out;
}

// Rebuild a locale file from the FR template: structural lines copied verbatim,
// each entry's value taken from `values` (translated) or the existing locale
// value. Keys FR dropped are dropped here too. Returns the file text.
function renderLocale(fr, values, existing) {
  return fr.map((l) => {
    if (!l.entry) return l.raw;
    const val = l.key in values ? values[l.key] : (l.key in existing ? existing[l.key] : l.value);
    return `${l.indent}"${l.keyEsc}": ${JSON.stringify(val)}${l.comma}`;
  }).join('\n');
}

// ── commands ─────────────────────────────────────────────────────────────────
function loadLock() {
  if (existsSync(lockPath)) return readJSON(lockPath);
  // Auto-baseline: assume current translations are in sync with current FR.
  console.log(c.dim('No lockfile — baselining to current FR (run "init" to do this explicitly).'));
  const lock = {};
  for (const slug of slugs) { lock[slug] = {}; for (const l of parseFR(slug).filter((x) => x.entry)) lock[slug][l.key] = hash(l.value); }
  return lock;
}

function saveLock(lock) {
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

function cmdInit() {
  const lock = {};
  for (const slug of slugs) { lock[slug] = {}; for (const l of parseFR(slug).filter((x) => x.entry)) lock[slug][l.key] = hash(l.value); }
  saveLock(lock);
  console.log(c.grn(`Baselined lock for ${slugs.length} catalogs → ${lockPath.replace(root + '/', '')}`));
}

function cmdCheck() {
  const lock = existsSync(lockPath) ? readJSON(lockPath) : {};
  let drift = 0;
  for (const slug of slugs) {
    const { stale, perLang } = analyze(slug, lock);
    const lines = [];
    if (stale.length) lines.push(`  ${c.yel('stale (FR changed)')}: ${stale.join(', ')}`);
    for (const lang of targets) {
      const { missing, extra } = perLang[lang];
      if (missing.length) lines.push(`  ${c.red(lang + ' missing')}: ${missing.join(', ')}`);
      if (extra.length) lines.push(`  ${c.dim(lang + ' extra')}: ${extra.join(', ')}`);
    }
    if (lines.length) { drift += lines.length; console.log(c.bold(slug)); console.log(lines.join('\n')); }
  }
  if (!drift) console.log(c.grn('✓ all catalogs in sync with FR'));
  else console.log(c.dim(`\n${drift} drift item(s). Run "translate --apply" to fill, then review the touched keys.`));
  if (strict && drift) process.exit(1);
}

async function cmdTranslate() {
  const lock = loadLock();
  const review = []; // {slug, lang, key} list for targeted review afterwards

  for (const slug of slugs) {
    const { fr, perLang } = analyze(slug, lock);
    const frByKey = Object.fromEntries(fr.filter((l) => l.entry).map((l) => [l.key, l.value]));

    for (const lang of targets) {
      const { need, loc } = perLang[lang];
      if (!need.length) continue;
      console.log(`${c.bold(slug)} → ${lang}: ${need.length} key(s) [${need.join(', ')}]`);
      review.push(...need.map((key) => ({ slug, lang, key })));
      if (!apply) continue;

      const translated = await deepl(need.map((k) => frByKey[k]), DEEPL_TARGET[lang]);
      const values = Object.fromEntries(need.map((k, i) => [k, translated[i]]));
      writeFileSync(catalogPath(slug, lang), renderLocale(fr, values, loc) + '\n');
    }

    // Re-baseline this slug's FR hashes (stale keys are now retranslated).
    if (apply) { lock[slug] = {}; for (const l of fr.filter((x) => x.entry)) lock[slug][l.key] = hash(l.value); }
  }

  if (!review.length) { console.log(c.grn('✓ nothing to translate — all locales already cover FR')); return; }
  if (!apply) { console.log(c.dim(`\nDry run: ${review.length} key(s) would be sent to DeepL. Add --apply to do it.`)); return; }

  saveLock(lock);
  console.log(c.grn(`\n✓ wrote ${review.length} translated key(s) and updated the lock.`));
  console.log(c.bold('\nReview these (targeted, not the whole corpus):'));
  for (const r of review) console.log(`  ${r.slug} · ${r.lang} · ${r.key}`);
}

// ── dispatch ─────────────────────────────────────────────────────────────────
if (cmd === 'init') cmdInit();
else if (cmd === 'check') cmdCheck();
else if (cmd === 'translate') await cmdTranslate();
else { console.error(`Unknown command "${cmd}". Use: check | translate | init`); process.exit(2); }
