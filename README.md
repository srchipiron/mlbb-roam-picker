# Mobile Legends Pick Assist

Qué héroe coger en tu línea, según el draft que tienes delante y el meta del parche actual.
Eliges tu línea (roam, jungla, mid, gold o exp) y la app recomienda para esa, con los
datos de partidas reales de tu rango. En español e inglés.

Proyecto de aficionado, sin relación con Moonton. Mobile Legends: Bang Bang y sus
héroes son marcas de sus propietarios. Tus datos no salen de tu móvil: no hay
cuentas, ni servidor, ni seguimiento.
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

Sube `dist/` a GitHub Pages, Netlify o Vercel. En GitHub Pages la ruta base la pone el despliegue con la
variable `BASE_PATH` (ver `deploy.yml` y `vite.config.js`). Desde el navegador de la tablet: menú → "Añadir a pantalla de inicio".

Si quieres un APK, ver [APK.md](APK.md): se genera desde el móvil con PWABuilder, sin tocar el código.

## Cómo se mantiene solo al día

`.github/workflows/update-data.yml` corre `scripts/ingest.mjs` dos veces al día a un fichero temporal,
`scripts/comparar-ingesta.mjs` comprueba que la corrida nueva no resuelva menos que la guardada, y solo
entonces se commitea el JSON con los iconos y retratos nuevos. El service worker sirve el fichero cacheado al instante y lo refresca por detrás,
así que en el draft nunca esperas a la red.

La ingesta también descarga la **lista completa de héroes** con su rol, así que el catálogo escrito a
mano nunca deja a nadie fuera: un héroe que exista en el juego y no esté en `heroes.json` entra igual,
con los tags por defecto de su rol (`ROLE_DEFAULTS` en `src/engine/rules.js`). El workflow avisa de
cuáles son. Escribirle sus tags propios lo hace mejor, pero es opcional, no un requisito.

## Fuente de datos

Las **partidas profesionales** (picks, baneos y resultado de cada partida de MPL, MSC, M-Series y
demás torneos S/A) salen de [Liquipedia](https://liquipedia.net/mobilelegends), bajo licencia
[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Se leen por su API (nunca el HTML),
con un User-Agent identificado y una petición cada 5 segundos, como piden sus condiciones de uso.
`scripts/ingesta-pro.mjs` las guarda en `historial/pro-partidas.jsonl` (la muestra, para
`scripts/medir-pro.mjs`) y en `public/data/pro.json` (lo poco que lee la app).

API pública de la comunidad (Rone Arena, `api-mobilelegends` de ridwaanhall): winrate, pickrate y
banrate por rango, además de counters y compatibilidad por héroe. No es oficial de Moonton.

El proyecto ha cambiado de dominio y de prefijo de rutas más de una vez (`mlbb.rone.dev`, `arena.rone.dev`,
hoy `arena-hv.fastapicloud.dev`), así que `scripts/ingest.mjs` **no fija ninguna URL**: prueba las
bases conocidas, se queda con la primera que responde y lo anota en `diagnostics` dentro del JSON. Los campos también se buscan por varios nombres posibles, y si un endpoint falla se conservan los
datos anteriores en vez de dejarte sin nada.

Más aún: antes de pedir nada, la ingesta **lee el esquema OpenAPI de la API** y saca de ahí las rutas
reales, su método (unas son GET y otras POST) y qué parámetros acepta cada una. Los nombres se buscan
por patrón (`WANTED` en el script), no por ruta literal, así que un cambio de nombre no la rompe. Solo
si no hay esquema cae a probar rutas conocidas a ciegas.

Si algún día deja de funcionar del todo, la app lo dice y el JSON lleva el esquema y lo que se probó.
Se añade la nueva base a `BASES` en `scripts/ingest.mjs`, o se pasa con `--base https://loquesea/api`.

No hay una segunda fuente de estadísticas viva: se buscaron (ver CLAUDE.md) y las que había están muertas
o bloquean robots. Antes de añadir una, pídele datos; no te fíes de su README.

## De dónde sale cada decisión

El objetivo es que la app siga siendo correcta dentro de un año, cuando haya
héroes nuevos y reequilibrados. Para eso, cuanto menos criterio humano fijo
lleve dentro, mejor: las reglas escritas a mano envejecen, los datos no.

| Componente | Peso | Origen |
|---|---|---|
| Counter | 40% | winrate real de cada pareja, de partidas ranked |
| Meta | 22% | winrate global del héroe en tu rango |
| Sinergia | 15% | winrate real junto a cada aliado |
| Tu maestría | 15% | tus propias partidas |
| Composición | 8% | reglas escritas a mano (lo único que envejece) |

Los pesos dan el 92% a datos reales y el 8% a reglas escritas a mano. Medido en
un draft de verdad sale prácticamente igual desde 1.5.0, porque la matriz de
counters cubre el 100% de los cruces (17.556) y las reglas por tags solo entran
con un héroe tan nuevo que la API no publica ni un cruce suyo. El botón
**Diagnóstico** lo mide en vivo, así que fíate de él y no de esta tabla: si ese
porcentaje baja, los datos han dejado de llegar y las reglas están tapando el
hueco.

La confianza en cada matchup **también la decide el dato**: se encoge hacia el
empate según lo jugado que esté el rival, porque contra un héroe raro un 57% es
ruido y no una ventaja. Antes había una mezcla fija de 65/35 entre dato y reglas
que era criterio mío y no se ajustaba a nada.

## Cómo puntúa

Cinco componentes, con los pesos de la tabla de arriba (`DEFAULT_WEIGHTS` en `src/engine/rules.js`).

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
salen en tu perfil del juego. El winrate va en porcentaje (`50,6` o `50.6`, las dos formas valen) y
la conversión a fracción se hace al guardar. Los héroes que ya tienen datos suben arriba de la lista.
Se guarda en `localStorage` y no sale del móvil.

## Roamer enemigo

Es con quien más vas a chocar, así que su matchup pesa el doble. La app lo
deduce sola de las líneas en las que se juega cada héroe (dato de la API), lo
marca con un círculo punteado y puedes corregirlo tocando otro.

**Se calla cuando hay duda.** Con dos tanques o dos supports enfrente podría ser
cualquiera, y equivocarse es peor que no decir nada: duplicaría el peso del
matchup equivocado. Exige un margen mínimo sobre el segundo candidato.

## Riesgo de contrapick

Como roam sueles elegir pronto, sin ver el equipo enemigo entero. Ahí no interesa
el mejor pick sobre el papel, sino el que menos te pueden castigar después.

Con la matriz de counters, cada roamer tiene un riesgo 0..1 medido por el
percentil 10 de sus matchups (el mal día típico, no el mínimo absoluto, que sería
un dato suelto con poca muestra). Ese riesgo descuenta puntos **en proporción a
cuántos enemigos faltan por ver**: pesa entero en el primer pick y desaparece
cuando ya están los cinco. Los muy castigables se marcan como "arriesgado como
pick ciego".

La idea viene de las herramientas de draft de League of Legends, que llevan más
recorrido en esto. De ahí salen también dos confirmaciones útiles: el shrinkage
bayesiano sobre los matchups y priorizar tu propio pool, que ya hacíamos.

Y una advertencia que conviene tener presente: en el paper de Kim et al.
(Universidad de Washington), los modelos entrenados para predecir el resultado a
partir de las composiciones no pasaron del 53% de acierto. Los personajes están
demasiado equilibrados como para que el draft decida solo. Esto inclina la
balanza, no gana partidas.

## Baneos

En "Baneos y ajustes" hay una lista de a quién conviene banear: mezcla lo fuerte que está el héroe,
cuánto lo banea el resto de la gente y lo mal que le va a los aliados que ya has elegido. Un toque en
"Banear" lo saca del pool y recalcula.

## Lo que esto no hace

- **El winrate global no es tu winrate.** Elige tu rango en "Baneos y ajustes": la ingesta descarga
  Epic, Legend, Mythic y Glory, y el meta cambia bastante entre ellos.
- **Los counters pesan un 40%, no más.** Están medidos como índices de cruce ya centrados, sin ruido de
  muestreo apreciable, pero un cruce no decide una partida: la fuerza general del héroe y las parejas
  también cuentan.
- **No lee la pantalla del juego.** Los picks enemigos los metes tú a mano. En 30 segundos de draft
  da tiempo a tres o cuatro toques, no a más: por eso la rejilla tiene botones grandes y buscador.

## Diagnóstico desde el móvil

Botón **Diagnóstico** en "Baneos y ajustes". Ejecuta las comprobaciones contra
los datos que la app tiene cargados en ese momento y deja un texto para copiar
o compartir: entorno, frescura de los datos, cobertura de winrates y counters,
nombres que no casan, sensatez táctica del motor y si tu maestría se aplica.

Es distinto de `npm test`: aquellas pruebas corren en GitHub contra datos
sintéticos y comprueban que el motor es correcto. Esta comprueba que la descarga
de hoy salió bien y que tu móvil está mostrando lo que debe.

## Comprobaciones

```bash
npm test    # orden de declaraciones + estilos + versión documentada + ~100 pruebas del motor
```

Las cuatro corren en GitHub **antes** de compilar, así que un cambio que rompa la
lógica no llega a publicarse: te quedas con la versión anterior funcionando.

- `check-order.mjs` — consts usadas antes de declararse. Ese fallo no da error al
  compilar: deja la pantalla en negro al arrancar, y en el móvil no hay consola.
- `check-css.mjs` — que nada esencial quede oculto en móvil (la × de quitar un
  pick llegó a estarlo), variables sin declarar y clases sin estilo.
- `test-engine.mjs` — desde el encogido del winrate hasta que ningún roamer
  acapare las recomendaciones. Varias son regresiones de fallos ya publicados.

## Estructura

```
scripts/ingest.mjs        descarga y normaliza el meta
src/engine/rules.js       reglas de counter, necesidades de equipo, pesos
src/engine/score.js       el motor: cinco componentes -> un número y su desglose
src/components/ui.jsx     selector de héroes, slots, tarjeta, pie de versión
scripts/test-engine.mjs   pruebas del motor
scripts/check-order.mjs   uso antes de declarar
scripts/check-css.mjs     estilos y clases
public/data/heroes.json   catálogo de roles y tags escrito a mano (esto es el activo real)
```

Datos © Moonton. Proyecto personal, sin relación con Moonton ni con los mantenedores de la API.
