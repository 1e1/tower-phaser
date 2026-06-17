import { defineConfig } from 'vite';

// Relative base keeps the build portable when served from any path (Docker/nginx).
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
