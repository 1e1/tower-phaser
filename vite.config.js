import { execSync } from 'node:child_process';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// A unique stamp for this build: the short commit hash (falling back to the
// timestamp when git is unavailable, e.g. a tarball build). Baked into the
// bundle via `define` below, it (a) is shown on screen so you can confirm which
// build a device is actually running, and (b) guarantees the precached service
// worker changes on every distinct commit — even an --amend that touches no
// source line — so a stale PWA can never linger after a redeploy.
function buildId() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return `t${Math.floor(Date.now() / 1000).toString(36)}`;
  }
}
const BUILD_ID = buildId();

// Relative base keeps the build portable when served from any path (Docker/nginx).
export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
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
