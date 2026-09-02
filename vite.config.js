import { parsearChangelog } from './scripts/changelog.mjs';
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
    // Las novedades, del mismo CHANGELOG.md que exige check-version.mjs.
    __CHANGELOG__: JSON.stringify(parsearChangelog(readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8'))),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // En GitHub Pages el workflow pasa BASE_PATH=/nombre-del-repo/.
  // En local ('npm run dev') no hace falta nada.
  base: process.env.BASE_PATH ?? './',
  plugins: [
    react(),
    // Un fichero diminuto con la version compilada, SIN cachear.
    //
    // Existe porque Javi no puede mirar nada desde el movil: el service worker
    // guarda la app entera, asi que puede estar usando la de ayer mientras los
    // datos si se han refrescado -pasa, y el diagnostico decia "todo correcto"
    // enseñando una version vieja sin poder saberlo-. Con esto el diagnostico
    // compara lo que esta ejecutando contra lo que hay publicado y lo dice.
    {
      name: 'version-publicada',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version, buildTime: new Date().toISOString() }),
        });
      },
    },
    // Las ultimas corridas de la vigilancia, para que el diagnostico del movil
    // compare la app con SU propio pasado. Van fuera de /data y sin cachear
    // por el mismo motivo que version.json: de cache dirian siempre lo mismo.
    {
      name: 'historial-de-salud',
      generateBundle() {
        let filas = [];
        try {
          filas = readFileSync(new URL('./historial/salud.jsonl', import.meta.url), 'utf8')
            .split('\n').filter(Boolean).slice(-40).map((l) => JSON.parse(l));
        } catch { /* sin historial todavia: el diagnostico lo dice */ }
        this.emitFile({ type: 'asset', fileName: 'historial.json', source: JSON.stringify(filas) });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Mobile Legends Pick Assist',
        short_name: 'Pick Assist',
        description: 'Qué héroe coger en tu línea, según el draft y el meta actual',
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
        // Las imágenes NO entran en la precarga: 71 iconos de objeto (1,7 MB) y
        // 133 caras de héroe (~2,9 MB). Meterlas ahí multiplicaría por cinco lo
        // que la app descarga al instalarse, y de todas ellas un draft usa tres
        // objetos y ocho caras. Se quedan fuera y se guardan en cuanto se ven,
        // con la regla de abajo.
        globPatterns: ['**/*.{js,css,html,svg}', 'icon-*.png'],
        runtimeCaching: [
          {
            // Un icono o una cara no cambian salvo que Moonton los rediseñe: se
            // sirven de caché sin preguntar, y así funcionan sin cobertura.
            urlPattern: /\/(objetos|heroes)\/\d+\.(png|jpg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imagenes',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
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
