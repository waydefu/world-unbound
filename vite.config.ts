import { defineConfig } from 'vitest/config';

// GitHub Pages serves this project under /world-unbound/. Asset, worker and
// wasm URLs must stay relative (new URL(..., import.meta.url)); never /assets/.
export default defineConfig({
  base: '/world-unbound/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // The engine spike (ADR-0002 §8) ships as a second page; it is not linked from the game.
      input: { main: 'index.html', spike: 'spike/engines.html' },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
