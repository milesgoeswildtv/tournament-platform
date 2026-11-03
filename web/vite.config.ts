import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Used in CI (npm install has network). Local offline builds use scripts/build-web.mjs.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, target: ['es2020', 'safari15'] },
});
