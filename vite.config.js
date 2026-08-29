import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // En GitHub Pages el workflow pasa BASE_PATH=/nombre-del-repo/.
  // En local ('npm run dev') no hace falta nada.
  base: process.env.BASE_PATH ?? './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Roam Picker',
        short_name: 'Roam',
        description: 'Qué roamer coger, según el draft y el meta actual',
        theme_color: '#0B0F14',
        background_color: '#0B0F14',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Los datos meta se sirven de caché al instante y se refrescan por detrás:
        // en el draft no hay tiempo de esperar a la red.
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'meta-data' },
          },
        ],
      },
    }),
  ],
});
