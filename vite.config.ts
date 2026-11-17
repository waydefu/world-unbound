import { defineConfig } from 'vitest/config';

// GitHub Pages serves this project under /world-unbound/. Asset, worker and
// wasm URLs must stay relative (new URL(..., import.meta.url)); never /assets/.
export default defineConfig({
  base: '/world-unbound/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
