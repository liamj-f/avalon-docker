import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deliberately separate from vite.config.js rather than adding a `test`
// block there -- that config's VitePWA plugin does real work at build time
// (manifest generation, workbox precache list) that has no meaning for a
// jsdom test run and just slows collection down for nothing.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
