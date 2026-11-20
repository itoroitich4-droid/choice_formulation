import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Choice Nutrition Feed Workspace',
        short_name: 'Choice Feed',
        description: 'Internal feed and premix formulation workspace for Choice Nutrition staff',
        theme_color: '#163f36',
        background_color: '#f5f6f0',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The app shell works offline; API data always comes from the server and is never cached by the service worker.
      workbox: { navigateFallbackDenylist: [/^\/api\//], globPatterns: ['**/*.{js,css,html,svg,png,ico}'] },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
});
