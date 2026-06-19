// Tutorial site description — the single source of truth the generator walks.
//
// `langs` is the column order of the language switcher and the coverage matrix.
// `defaultLang` is the reference language (FR): the matrix flags any page that
// exists in FR but is missing a translation elsewhere.
//
// Each page lists its slug + kind. Chapters also carry their chapter number,
// level ('d' discovery / 'i' intermediate / 'e' expert) and biome (drives the
// <body data-biome> hook + hero hills). Annexes and the home page have no
// level bar.

export const langs = ['en', 'fr', 'de', 'es', 'it'];
export const defaultLang = 'fr';

export const pages = [
  { slug: 'index', kind: 'home', biome: 'meadow' },

  { slug: 'chapter-1', kind: 'chapter', chapter: 1, level: 'd', biome: 'meadow' },
  { slug: 'chapter-1-i', kind: 'chapter', chapter: 1, level: 'i', biome: 'meadow' },
  { slug: 'chapter-1-e', kind: 'chapter', chapter: 1, level: 'e', biome: 'meadow' },

  { slug: 'chapter-2', kind: 'chapter', chapter: 2, level: 'd', biome: 'desert' },
  { slug: 'chapter-2-i', kind: 'chapter', chapter: 2, level: 'i', biome: 'desert' },
  { slug: 'chapter-2-e', kind: 'chapter', chapter: 2, level: 'e', biome: 'desert' },

  { slug: 'chapter-3', kind: 'chapter', chapter: 3, level: 'd', biome: 'tundra' },
  { slug: 'chapter-3-i', kind: 'chapter', chapter: 3, level: 'i', biome: 'tundra' },
  { slug: 'chapter-3-e', kind: 'chapter', chapter: 3, level: 'e', biome: 'tundra' },

  { slug: 'chapter-4', kind: 'chapter', chapter: 4, level: 'd', biome: 'volcano' },
  { slug: 'chapter-4-i', kind: 'chapter', chapter: 4, level: 'i', biome: 'volcano' },
  { slug: 'chapter-4-e', kind: 'chapter', chapter: 4, level: 'e', biome: 'volcano' },

  { slug: 'chapter-5', kind: 'chapter', chapter: 5, level: 'd', biome: 'storm' },
  { slug: 'chapter-5-i', kind: 'chapter', chapter: 5, level: 'i', biome: 'storm' },
  { slug: 'chapter-5-e', kind: 'chapter', chapter: 5, level: 'e', biome: 'storm' },

  // Annexes opt into a prev/next pager via `nav` (chapters derive theirs). A
  // side with no href renders disabled but keeps its label; omit `nav` entirely
  // for no pager at all (annex-lobby, annex-math).
  { slug: 'annex', kind: 'annex', biome: 'meadow', nav: { prev: 'index.html' } },
  { slug: 'annex-lobby', kind: 'annex', biome: 'meadow' },
  { slug: 'annex-math', kind: 'annex', biome: 'volcano' },
  { slug: 'annex-pathfinding', kind: 'annex', biome: 'tundra', nav: { prev: 'annex.html' } },
  { slug: 'annex-deploy', kind: 'annex', biome: 'tundra', nav: { prev: 'chapter-4.html' } },
  { slug: 'annex-brief', kind: 'annex', biome: 'desert', nav: { prev: 'annex.html' } },
];

// The three levels of a chapter, in display order, with the alternate slug
// suffix. Labels/sublabels are translated via the _site catalog (level.*).
export const levels = [
  { key: 'd', suffix: '' },
  { key: 'i', suffix: '-i' },
  { key: 'e', suffix: '-e' },
];

export const TOTAL_CHAPTERS = 5;

// Breadcrumb sets, picked per page by kind (see build-docs.mjs). Each entry is
// [href, labelKey] — the label is translated via the _site catalog.
export const crumbSets = {
  home: [['#chapters', 'nav.chapters'], ['annex.html', 'nav.annex']],
  chapter: [['index.html', 'nav.home'], ['annex.html', 'nav.annex']],
  annexHub: [['index.html', 'nav.home']],
  annexSub: [['index.html', 'nav.home'], ['annex.html', 'nav.annex']],
};

// Which crumb set a page uses. Default by kind; the annex hub differs from its
// sub-pages, and the home page is its own set.
export function crumbSetFor(page) {
  if (page.kind === 'home') return crumbSets.home;
  if (page.kind === 'chapter') return crumbSets.chapter;
  return page.slug === 'annex' ? crumbSets.annexHub : crumbSets.annexSub;
}
