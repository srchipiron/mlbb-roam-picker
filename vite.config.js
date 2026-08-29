import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // La versión sale de package.json y la fecha del momento de compilar, así que
  // el pie de la app siempre dice qué build estás usando de verdad.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
        // 'any', no 'landscape': forzarla giraba la app instalada en un móvil
        // que se usa en vertical.
        orientation: 'any',
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
