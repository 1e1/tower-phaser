import { defineConfig } from 'vite';

// Relative base keeps the build portable when served from any path (Docker/nginx).
export default defineConfig({
  base: './',
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
