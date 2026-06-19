import { execSync } from 'node:child_process';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// A unique stamp for this build: the short commit hash (falling back to the
// timestamp when git is unavailable, e.g. a tarball build). Baked into the
// bundle via `define` below, it (a) is shown on screen so you can confirm which
// build a device is actually running, and (b) guarantees the precached service
// worker changes on every distinct commit — even an --amend that touches no
// source line — so a stale PWA can never linger after a redeploy.
const git = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

// The short commit hash, used as the build id. Docker strips .git from its build
// context, so honour an explicit BUILD_SHA build-arg first; fall back to git, then
// to a timestamp (a bare tarball build).
function buildId() {
  const env = (process.env.BUILD_SHA || '').trim();
  if (env) return env;
  try {
    return git('git rev-parse --short HEAD');
  } catch {
    return `t${Math.floor(Date.now() / 1000).toString(36)}`;
  }
}
const BUILD_ID = buildId();

// Trim redundant trailing ".0" groups from a version's numeric core, keeping the
// major and preserving a leading "v" plus any pre-release suffix:
//   v2.0.0 → v2 · v2.0.1 → v2.0.1 · v2.1.0 → v2.1 · v2.3.4 → v2.3.4 · v2.0.0-rc → v2-rc
function cleanVersion(tag) {
  return tag.replace(/^(v?)(\d+(?:\.\d+)*)/, (_, v, nums) => {
    const parts = nums.split('.');
    while (parts.length > 1 && parts[parts.length - 1] === '0') parts.pop();
    return v + parts.join('.');
  });
}

// Turn a `git describe --tags` string into the on-screen label. Handles both an
// exact tag and the "<tag>-<N>-g<hash>" form git emits when HEAD is past a tag:
//   "v2.0.0"            → "v2"
//   "v2.0.0-3-g5c4a4e4" → "v2 · 5c4a4e4"
//   "" (no tags)        → the bare build id
function describeToLabel(desc, hash) {
  if (!desc) return hash;
  const past = desc.match(/^(.*)-\d+-g[0-9a-f]+$/); // tag, commits-since, hash
  return past ? `${cleanVersion(past[1])} · ${hash}` : cleanVersion(desc);
}

// A human-friendly version label for on-screen display (the build stamp). Prefer
// an explicit BUILD_TAG build-arg (Docker has no .git); otherwise derive it from
// git. BUILD_ID stays the raw commit hash — it drives PWA cache-busting and the
// `?v=` freshness check, which must change on every distinct commit.
function buildLabel(hash) {
  const env = (process.env.BUILD_TAG || '').trim();
  if (env) return describeToLabel(env, hash); // host passes `git describe --tags --always`
  try {
    return cleanVersion(git('git describe --tags --exact-match')); // HEAD is exactly a tag
  } catch { /* not on a tag */ }
  try {
    return `${cleanVersion(git('git describe --tags --abbrev=0'))} · ${hash}`; // last tag · hash
  } catch { /* no tags reachable */ }
  return hash;
}
const BUILD_LABEL = buildLabel(BUILD_ID);

// Relative base keeps the build portable when served from any path (Docker/nginx).
export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_LABEL__: JSON.stringify(BUILD_LABEL),
  },
  plugins: [
    // PWA: a service worker precaches the built bundle so repeat visits (the TV
    // and the phones, reused across many matches) load instantly and survive a
    // flaky connection, plus a web app manifest for "add to home screen" and a
    // chromeless fullscreen launch on phones. autoUpdate swaps in a new build
    // silently on the next visit after a redeploy.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Tower Duel',
        short_name: 'Tower Duel',
        description: 'Two-player artillery duel — phones aim, the TV is the battlefield.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'fullscreen',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
        navigateFallback: 'index.html',
        // The realtime channel and the health probe must never be answered from
        // the precache: the SPA navigateFallback would otherwise let the service
        // worker shadow the WebSocket upgrade (/ws) on some browsers — seen as
        // "Connect does nothing" because the socket never reaches the backend.
        navigateFallbackDenylist: [/^\/ws/, /^\/healthz/],
        // Take control of open pages as soon as a new build activates, so a
        // redeploy can't leave a phone running a stale, half-broken bundle.
        clientsClaim: true,
        skipWaiting: true,
        // The Phaser bundle is ~1.7 MB; lift the default 2 MB precache ceiling.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // Forward the realtime channel to the Node server during development
    // (run `npm run dev` and `npm run dev:server` together).
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
