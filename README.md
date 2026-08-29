# Roam Picker

Qué roamer coger en MLBB, según el draft que tienes delante y el meta del parche actual.
PWA: se instala en la tablet desde el navegador y funciona sin conexión con los últimos datos descargados.

## Arrancar

```bash
npm install
npm run ingest      # descarga el meta actual -> public/data/roam-meta.json
npm run dev         # http://localhost:5173
```

Sin ejecutar `ingest` la app funciona igualmente, pero solo con composición y counters por rol.
En cuanto hay datos meta, entran los winrates reales.

## Publicar

```bash
npm run build       # -> dist/
```

Sube `dist/` a GitHub Pages, Netlify o Vercel. En GitHub Pages, descomenta `base` en `vite.config.js`
con el nombre del repo. Desde el navegador de la tablet: menú → "Añadir a pantalla de inicio".

Si quieres un APK, ver [APK.md](APK.md): se genera desde el móvil con PWABuilder, sin tocar el código.

## Cómo se mantiene solo al día

`.github/workflows/update-data.yml` corre `scripts/ingest.mjs` dos veces al día y commitea el JSON
si ha cambiado. El service worker sirve el fichero cacheado al instante y lo refresca por detrás,
así que en el draft nunca esperas a la red.

La ingesta también descarga la **lista completa de héroes** con su rol, así que el catálogo escrito a
mano nunca deja a nadie fuera: un héroe que exista en el juego y no esté en `heroes.json` entra igual,
con los tags por defecto de su rol (`ROLE_DEFAULTS` en `src/engine/rules.js`). El workflow avisa de
cuáles son. Escribirle sus tags propios lo hace mejor, pero es opcional, no un requisito.

## Fuente de datos

API pública de la comunidad (proyecto OpenMLBB / api-mobilelegends, licencia BSD-3): winrate, pickrate,
banrate por rango, además de counters y compatibilidad por héroe. No es oficial de Moonton.

`scripts/ingest.mjs` está escrito a la defensiva porque esa API ha cambiado de forma entre versiones:
busca los campos por varios nombres posibles y, si un endpoint falla, conserva los datos anteriores en
lugar de dejarte sin nada. **Comprueba las rutas contra el Swagger vivo** (`https://mlbb.rone.dev/api/docs`)
la primera vez; si alguna cambió, se ajusta en `fetchStats` y `fetchRelations`.

Para cruzar con una segunda fuente, añade un módulo en `scripts/sources/` que devuelva el mismo formato
`{ nombre: { winRate, pickRate, banRate, matches } }` y promedia en `main()`.

## Cómo puntúa

Cinco componentes, con pesos en `src/engine/rules.js`:

| Componente | Peso | Qué mide |
|---|---|---|
| Meta | 30% | winrate global, encogido según tamaño de muestra |
| Counter | 22% | matchup contra cada pick enemigo |
| Composición | 20% | huecos del equipo que rellena |
| Maestría | 15% | tu propio historial con el héroe |
| Sinergia | 13% | encaje con tus aliados ya elegidos |

Tres decisiones que conviene entender antes de tocar los pesos:

**El winrate se encoge hacia la media.** Un héroe con 58% y 40 partidas no vale lo que uno con 54% y
9.000. `metaScore` aplica un shrink bayesiano con un prior de 400 partidas equivalentes. Súbelo si
quieres ser más conservador.

**Los counters usan el dato real si existe, y reglas por tags si no.** Las reglas están en
`COUNTER_RULES` y son legibles: "si el enemigo tiene dashes, un roamer con anti-mobility sube". Esto
es lo que hace que la app siga siendo útil con un héroe recién salido del que no hay estadísticas.

**La composición pesa poco con el draft vacío.** Con cero aliados elegidos no sabemos nada, así que
el score se acerca a neutro. Sin esa corrección la app siempre recomendaría al mismo generalista.

Tu maestría se edita desde el botón **Tu maestría**: partidas y winrate de cada roamer, tal como
salen en tu perfil del juego. Se guarda en `localStorage` y no sale del móvil.

## Baneos

En "Baneos y ajustes" hay una lista de a quién conviene banear: mezcla lo fuerte que está el héroe,
cuánto lo banea el resto de la gente y lo mal que le va a los aliados que ya has elegido. Un toque en
"Banear" lo saca del pool y recalcula.

## Lo que esto no hace

- **El winrate global no es tu winrate.** Elige tu rango en "Baneos y ajustes": la ingesta descarga
  Epic, Legend, Mythic y Glory, y el meta cambia bastante entre ellos.
- **Los counters de estas webs son ruidosos.** Por eso pesan un 22% y no un 50%.
- **No lee la pantalla del juego.** Los picks enemigos los metes tú a mano. En 30 segundos de draft
  da tiempo a tres o cuatro toques, no a más: por eso la rejilla tiene botones grandes y buscador.

## Estructura

```
scripts/ingest.mjs        descarga y normaliza el meta
src/engine/rules.js       reglas de counter, necesidades de equipo, pesos
src/engine/score.js       el motor: cinco componentes -> un número y su desglose
src/components/ui.jsx     selector de héroes, slots, tarjeta de recomendación
public/data/heroes.json   catálogo de roles y tags escrito a mano (esto es el activo real)
```

Datos © Moonton. Proyecto personal, sin relación con Moonton ni con los mantenedores de la API.
