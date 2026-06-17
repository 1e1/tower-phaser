// Static tutorial generator.
//
// Reads the authoring source in docs-src/ (one layout, one tokenised body per
// page, one JSON string catalog per page × language) and writes the fully
// static, per-language HTML the GitHub Pages site serves. The chrome — language
// switcher, level bar, breadcrumbs, footer — is generated from site.config.mjs
// so a change happens once, not 85 times.
//
//   node scripts/build-docs.mjs              → writes ./docs
//   node scripts/build-docs.mjs --out DIR    → writes elsewhere (e.g. preview)
//   node scripts/build-docs.mjs --strict     → exit 1 on any gap/missing token
//
// It always prints a coverage matrix (languages × pages) so missing
// translations are visible at a glance.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { langs, defaultLang, pages, levels, TOTAL_CHAPTERS, crumbSetFor } from '../docs-src/site.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'docs-src');
const pagesDir = join(srcDir, 'pages');
const i18nDir = join(srcDir, 'i18n');

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const outArg = argv.indexOf('--out');
const outDir = outArg !== -1 ? join(root, argv[outArg + 1]) : join(root, 'docs');

const layout = readFileSync(join(srcDir, 'layout', 'page.html'), 'utf8');

// ── helpers ────────────────────────────────────────────────────────────────
const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const hasStructure = (slug) => existsSync(join(pagesDir, `${slug}.html`));
const hasCatalog = (slug, lang) => existsSync(join(i18nDir, `${slug}.${lang}.json`));

// Replace every {{key}} from `dict`; report keys with no entry.
function render(tpl, dict) {
  const missing = new Set();
  const text = tpl.replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
    if (key in dict && dict[key] != null) return dict[key];
    missing.add(key);
    return `{{${key}}}`; // leave visible so it shows up in review, not silently blank
  });
  return { text, missing: [...missing] };
}

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

// ── generated chrome regions ─────────────────────────────────────────────────

// Hero hills, one silhouette per biome (geometry + the two fills). Single source
// of truth: each entry is the pair drawn by that biome's chapter, so chapters
// stay pixel-identical and annexes inherit their biome's hills automatically.
const HILLS = {
  meadow: [
    '<path d="M0,80 C220,20 420,110 680,70 C920,35 1120,110 1440,60 L1440,120 L0,120 Z" fill="#4f8f2f"/>',
    '<path d="M0,95 C260,55 520,120 760,90 C1020,58 1240,120 1440,90 L1440,120 L0,120 Z" fill="#3f7a25"/>',
  ],
  desert: [
    '<path d="M0,70 C260,30 520,100 760,70 C1000,40 1240,100 1440,70 L1440,120 L0,120 Z" fill="#d9a441"/>',
    '<path d="M0,95 C260,60 520,115 760,92 C1020,66 1240,116 1440,92 L1440,120 L0,120 Z" fill="#9c6f25"/>',
  ],
  tundra: [
    '<path d="M0,70 C260,30 520,100 760,70 C1000,40 1240,100 1440,70 L1440,120 L0,120 Z" fill="#e7eef6"/>',
    '<path d="M0,96 C260,62 520,116 760,92 C1020,66 1240,116 1440,92 L1440,120 L0,120 Z" fill="#c7d6e8"/>',
  ],
  volcano: [
    '<path d="M0,70 C260,30 520,100 760,70 C1000,40 1240,100 1440,70 L1440,120 L0,120 Z" fill="#46303f"/>',
    '<path d="M0,96 C260,62 520,116 760,92 C1020,66 1240,116 1440,92 L1440,120 L0,120 Z" fill="#ff6b35"/>',
  ],
  storm: [
    '<path d="M0,70 C260,30 520,100 760,70 C1000,40 1240,100 1440,70 L1440,120 L0,120 Z" fill="#2e3a5a"/>',
    '<path d="M0,96 C260,62 520,116 760,92 C1020,66 1240,116 1440,92 L1440,120 L0,120 Z" fill="#5b7fbf"/>',
  ],
};

// The hero header (badge/kicker/title/lead + biome hills). Returns a template
// still carrying {{hero.*}} tokens; the caller renders it through `render` so
// missing tokens surface in the coverage matrix like any other page region.
function heroTemplate(page) {
  const [p1, p2] = HILLS[page.biome] || HILLS.meadow;
  return `    <header class="hero">
      <span class="badge">{{hero.badge}}</span>
      <div class="kicker">{{hero.kicker}}</div>
      <h1>{{hero.title}}</h1>
      <p>{{hero.lead}}</p>
      <svg class="hills" viewBox="0 0 1440 120" preserveAspectRatio="none" height="90" xmlns="http://www.w3.org/2000/svg">
        ${p1}
        ${p2}
      </svg>
    </header>
`;
}

// Prev/next pager. Chapters derive it from the level chain (chapter-1 has no
// prev, chapter-N=last has no next); annexes opt in via a `nav: {prev, next}`
// entry in site.config. A side with no href renders disabled but keeps its
// label. Pages with neither get no pager. Labels stay in the per-page catalog.
function pagerTemplate(page) {
  let prev = null, next = null, show = false;
  if (page.kind === 'chapter') {
    show = true;
    const { suffix } = levels.find((l) => l.key === page.level);
    if (page.chapter > 1) prev = `chapter-${page.chapter - 1}${suffix}.html`;
    if (page.chapter < TOTAL_CHAPTERS) next = `chapter-${page.chapter + 1}${suffix}.html`;
  } else if (page.nav) {
    show = true;
    prev = page.nav.prev || null;
    next = page.nav.next || null;
  }
  if (!show) return '';
  const side = (href, key) =>
    href ? `<a href="${href}">{{${key}}}</a>` : `<a class="disabled">{{${key}}}</a>`;
  return `      <div class="pager wrap">\n        ${side(prev, 'pager.prev')}\n        ${side(next, 'pager.next')}\n      </div>`;
}
function crumbs(page, cat) {
  return crumbSetFor(page)
    .map(([href, key]) => `<a class="crumb" href="${href}">${cat[key]}</a>`)
    .join('\n      ');
}

// Optional <meta name="description">: rendered only when the catalog carries
// one (base chapters have none). Ends with newline + indent so the following
// <link> stays aligned; empty string when absent leaves the head untouched.
function metaTag(cat) {
  return cat['meta.desc'] ? `<meta name="description" content="${cat['meta.desc']}" />\n    ` : '';
}

// The home page appends a translated " le carnet" tag after the brand.
function brandExtra(page, cat) {
  if (page.kind !== 'home' || !cat['nav.brandExtra']) return '';
  return ` <span style="font-weight:400;color:var(--ink-soft)">${cat['nav.brandExtra']}</span>`;
}

// Only links languages that actually have this page → the switcher never points
// at a missing translation.
function langbar(slug, lang, available) {
  return langs
    .filter((l) => available.includes(l))
    .map((l) => {
      const cls = `${l === lang ? 'active ' : ''}lang-${l}`;
      return `<a href="../${l}/${slug}.html" class="${cls}">${l.toUpperCase()}</a>`;
    })
    .join('\n        ');
}

function levelbar(page, cat) {
  if (page.kind !== 'chapter') return '';
  const base = `chapter-${page.chapter}`;
  const rows = levels.map((lv) => {
    const active = lv.key === page.level ? ' class="active"' : '';
    return `      <a href="${base}${lv.suffix}.html"${active}>${cat[`level.${lv.key}.label`]}<small>${cat[`level.${lv.key}.sub`]}</small></a>`;
  });
  return `\n    <div class="levelbar">\n      <span class="ll">${cat['level.legend']}</span>\n${rows.join('\n')}\n    </div>`;
}

// Shared prefix (in _site) + a per-page translated suffix. The suffix may use
// {n}/{total} placeholders (chapters expand them to e.g. "chapitre 2/4").
function footer(page, cat) {
  const suffix = fill(cat['footer.suffix'] || '', { n: page.chapter, total: TOTAL_CHAPTERS });
  return `${cat['footer.prefix'] || ''}${suffix}`;
}

// ── build ────────────────────────────────────────────────────────────────────
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(srcDir, 'assets'), join(outDir, 'assets'), { recursive: true });
// The root language-routing landing page is static — copied verbatim.
const rootIndex = join(srcDir, 'root-index.html');
if (existsSync(rootIndex)) cpSync(rootIndex, join(outDir, 'index.html'));

const matrix = {}; // slug -> lang -> '✓' | '⚠' | '✗' | '·'
let written = 0;
const problems = [];

for (const page of pages) {
  matrix[page.slug] = {};
  const structured = hasStructure(page.slug);
  const available = langs.filter((l) => hasCatalog(page.slug, l));

  for (const lang of langs) {
    if (!structured) { matrix[page.slug][lang] = '·'; continue; }
    if (!hasCatalog(page.slug, lang)) {
      matrix[page.slug][lang] = '✗';
      problems.push(`gap: ${page.slug} has no ${lang} catalog`);
      continue;
    }

    const cat = { ...(readJSON(join(i18nDir, `_site.${lang}.json`)) || {}), ...readJSON(join(i18nDir, `${page.slug}.${lang}.json`)) };
    const body = render(readFileSync(join(pagesDir, `${page.slug}.html`), 'utf8'), cat);
    const hero = render(heroTemplate(page), cat);
    const pager = render(pagerTemplate(page), cat);
    const scriptPath = join(pagesDir, `${page.slug}.script.html`);
    const script = existsSync(scriptPath) ? render(readFileSync(scriptPath, 'utf8'), cat) : { text: '', missing: [] };
    // Optional per-page <head> extras (e.g. a page-specific <style> block).
    const headPath = join(pagesDir, `${page.slug}.head.html`);
    const headExtra = existsSync(headPath) ? render(readFileSync(headPath, 'utf8'), cat) : { text: '', missing: [] };

    const out = render(layout, {
      lang,
      biome: page.biome || '',
      title: cat['title'] || '',
      meta: metaTag(cat),
      headExtra: headExtra.text,
      brandExtra: brandExtra(page, cat),
      crumbs: crumbs(page, cat),
      langbar: langbar(page.slug, lang, available),
      levelbar: levelbar(page, cat),
      hero: hero.text,
      pager: pager.text,
      footer: footer(page, cat),
      body: body.text,
      script: script.text,
    });

    const missing = [...new Set([...body.missing, ...hero.missing, ...pager.missing, ...script.missing, ...headExtra.missing, ...out.missing])];
    mkdirSync(join(outDir, lang), { recursive: true });
    writeFileSync(join(outDir, lang, `${page.slug}.html`), out.text);
    written++;

    if (missing.length) {
      matrix[page.slug][lang] = '⚠';
      problems.push(`${page.slug}.${lang}: missing tokens → ${missing.join(', ')}`);
    } else {
      matrix[page.slug][lang] = '✓';
    }
  }
}

// ── coverage matrix ───────────────────────────────────────────────────────────
const slugW = Math.max(...pages.map((p) => p.slug.length), 'page'.length);
const head = ['page'.padEnd(slugW), ...langs.map((l) => l.toUpperCase().padStart(3))].join('  ');
console.log('\nCoverage matrix  (✓ ok · ⚠ missing token · ✗ gap · · not migrated)\n');
console.log(head);
console.log('-'.repeat(head.length));
for (const page of pages) {
  const ref = matrix[page.slug][defaultLang];
  const row = [page.slug.padEnd(slugW), ...langs.map((l) => matrix[page.slug][l].padStart(3))].join('  ');
  console.log(ref === '·' ? row : row);
}

console.log(`\n${written} file(s) written to ${outDir}`);
if (problems.length) {
  console.log(`\n${problems.length} issue(s):`);
  for (const p of problems) console.log(`  • ${p}`);
}

if (strict && problems.length) {
  console.error('\n✗ --strict: build has gaps or missing tokens.');
  process.exit(1);
}
