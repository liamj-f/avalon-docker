import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// For local (non-Docker) dev: `npm run dev` in frontend/ with the backend
// running separately on :4000. In Docker, nginx handles this proxying
// instead (see nginx.conf.template) and this block is unused.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Never auto-reload a live client out from under a game in progress
      // -- src/PwaUpdatePrompt.jsx surfaces a dismissible "update
      // available" toast instead and only reloads when the player asks
      // for it. injectRegister: false pairs with that -- registration
      // happens through the `virtual:pwa-register/react` hook there
      // instead of the plugin's own auto-injected script, so it isn't
      // registered twice.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Avalon · The Resistance',
        short_name: 'Avalon',
        description: 'Self-hosted multiplayer Avalon: The Resistance.',
        theme_color: '#0f1420',
        background_color: '#0f1420',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The game is fundamentally live -- there's no meaningful "play
        // offline" mode -- so this precaches the app shell (hashed JS/CSS,
        // index.html) for instant, reliable loads, but explicitly never
        // touches live traffic. Socket.IO's handshake/polling fallback and
        // every /api/ call must always hit the network directly; letting
        // the service worker anywhere near them risks serving stale game
        // state or, worse, a stale room/vote response.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4000',
      },
    },
  },
});
