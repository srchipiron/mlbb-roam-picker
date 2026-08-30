# Contexto del proyecto

**Mobile Legends Pick Assist**: qué héroe coger en tu línea, según el draft que
tienes delante. Nació como app personal de Javi (GitHub: `srchipiron`) solo para
roam, y desde 1.0.0 sirve para las cinco líneas. Javi está en **Gloria Mítica**,
así que el rango por defecto de los datos es `glory`, no `mythic`.

El pool de cada línea NO está escrito a mano: sale de `lanes`, que la API da
para los 133 héroes. Si añades una línea nueva, va en `LINEAS` (score.js) y el
resto sale solo.

Las claves de `localStorage` siguen diciendo `roam-picker:` aunque la app ya no
se llame así. NO las renombres: borrarías la maestría y las partidas de Javi.

Trabaja **solo desde el móvil**, con Termux. No tiene ordenador. Eso condiciona
todo: no hay consola de desarrollo en el navegador, no puede leer un JSON largo
cómodamente, y cada despliegue le cuesta minutos de espera. Por eso la app trae
su propio diagnóstico dentro (botón **Diagnóstico** → Copiar) y por eso las
comprobaciones automáticas importan más de lo normal.

## Reglas de trabajo

**Nunca subas nada sin pasar `npm test`.** Son cuatro comprobaciones y 42
pruebas (orden de declaraciones, CSS, versión documentada y motor). El
despliegue corre esas cuatro más una quinta que no está en `npm test`: que
`roam-meta.json` se haya regenerado hace menos de media hora. Si algo falla, el despliegue se detiene y la app se queda
con la versión anterior funcionando, que es lo correcto.

**Sube la versión en `package.json` y documéntala en `CHANGELOG.md`.** Criterio:
`0.X.0` cuando cambia cómo decide la app o qué hace; `0.0.X` para correcciones.
La versión sale en el pie de la app, así que sirve para saber desde el móvil si
lo que estás mirando es lo que acabas de subir. `check-version.mjs` falla si la
versión no tiene entrada en el CHANGELOG, y corre tanto en `npm test` como en el
despliegue. Escribe la entrada para quien USA la app, no para quien lee el diff.

**No ajustes los pesos por una partida.** Los winrates se mueven entre el 48% y
el 55%; una derrota no dice nada. Si hay que tocar el motor, mídelo antes con
drafts simulados (hay utilidades en las pruebas) y comprueba concentración y
sensatez táctica, no solo que "parezca mejor".

**Prefiere el dato a la regla escrita a mano.** Los pesos de `DEFAULT_WEIGHTS`
dan el 92% de la decisión a datos reales y el 8% a `rules.js`. El porcentaje que
de verdad manda es más bajo, porque donde no hay counter entran las reglas por
tags, y la matriz solo cubre el 7,5% de los cruces. El botón **Diagnóstico** lo
mide en vivo: fíate de ese número, no de este párrafo. Cada regla nueva que
añadas a `rules.js` es deuda: envejece cuando Moonton reequilibra.

## Errores ya cometidos, para no repetirlos

Todos estos llegaron a producción y costaron rondas enteras de ida y vuelta:

- **`ROUTES is not defined`** — la ingesta reventaba en la primera línea. Pasaba
  `node --check` porque la sintaxis era válida. Hay una prueba que la ejecuta de
  verdad; no la quites.
- **`continue-on-error` en el paso de ingesta** — publicaba la app nueva con los
  datos congelados del despliegue anterior, sin ninguna señal. Se quitó, y hay
  una comprobación de que el JSON se ha regenerado.
- **Uso antes de declarar en `App.jsx`** — dejó la pantalla en negro. De ahí
  salió `check-order.mjs`.
- **La × de quitar un pick, oculta en móvil por CSS** — de ahí salió
  `check-css.mjs`.
- **Nombres de héroe** — la API y el catálogo escriben distinto ("X.Borg" /
  "X Borg"). Todo se busca con `normName`. La matriz de counters tiene DOS
  niveles y hay que indexar los dos: `indexByName(m, 2)`. Esto volvió en 0.4.0:
  `App.jsx` indexaba con profundidad 1, el segundo nivel se quedaba crudo y
  `riesgoContrapick` devolvía `null` para los 34 roamers sin que nada chillara.
  El motor no se enteró porque `counterScore` busca con `lookup` en los dos
  niveles y `lookup` prueba también la clave cruda. Dentro de una fila, usa
  siempre `lookup(fila, nombre)`, nunca `fila[normName(nombre)]`.
- **`main_hero_channel.id` (2678829) colándose por `main_heroid` (93)** — la API
  devolvía 422 en las 133 peticiones. Los ids de héroe se validan por rango.
- **Motivos que le salían a todo el pool** ("no hay primera línea" es cierto
  para los 34 roamers) — se filtran los que aparecen en más del 60%.
- **El peel recomendado hacia tanques aliados**, porque un tanque también está
  etiquetado como `immobile`.
- **Pruebas que medían el orden del fichero, no el motor** — dos invariantes
  (concentración y "responde al equipo enemigo") repartían winrates sintéticos
  recorriendo el array de héroes, así que ordenar `heroes.json` alfabéticamente
  las hacía fallar sin tocar una línea del código. Peor: pasaban en parte por
  suerte del orden. Ahora el winrate de cada héroe sale de SU NOMBRE. Si añades
  héroes, mételos al final igualmente: es el diff mínimo.
- **Pruebas asíncronas que no se contaban** — el arnés esperaba 60 ms fijos y
  luego llamaba a `process.exit`. En local llegaban; en GitHub, seis se
  quedaban fuera, así que un fallo suyo NO tumbaba el despliegue. Entre ellas la
  que vigila el fallo de `ROUTES`. Ahora se apuntan y se esperan con
  `Promise.all`. Si añades una prueba `async`, no le pongas plazos: ya se espera.
- **Tags deducidos tratados como certezas** (0.6.0, cazado antes de publicar).
  Al deducir los tags de Marcel desde su `speciality` le salían seis, disparaba
  más reglas que nadie y era nº1 en el 69% de 300 drafts simulados, contra el
  43% del líder anterior. Mismo sesgo por acumular etiquetas que el de Carmilla.
  Ahora todo lo que sale de tags deducidos (reglas de counter y composición) se
  encoge por `PRECISION_DEDUCIDA`. Si añades otro componente que lea `tags`,
  descuéntalo también.
- **El límite de profundidad de la ingesta, en 6** — la API envuelve el dato
  hondo: el título de la línea vive en el nivel 8. Los 133 héroes salían sin rol
  y sin línea y nada fallaba. Efecto invisible doble: los héroes que no están en
  `heroes.json` se quedaban con CERO tags (no con los de su rol, como decía este
  fichero), y `detectarRoamEnemigo` perdía su señal principal y nunca acertaba.
  Constante `HONDURA`, hoy en 12. Si la API vuelve a envolver más, súbela.
- **`diagnostics.relations.ejemplos` sin inicializar** — se leía su `.length` y
  saltaba un `TypeError` por cada roamer al que SÍ le llegaban los counters. Los
  datos se salvaban, así que solo se notaba en cuatro errores falsos dentro del
  diagnóstico… que además, al llenar el tope de errores, tapaban los de verdad.
  Hay una prueba que comprueba que todo campo leído esté inicializado.
- **Dos criterios distintos de "quién es roamer"** — la app usaba
  `mergeCatalog` (catálogo + rol de la API) y la ingesta miraba solo el catálogo,
  así que Marcel entraba en las recomendaciones sin que nadie le pidiera
  counters. Ahora la ingesta importa `mergeCatalog`. No vuelvas a duplicarlo.

## Los idiomas

Español e inglés, en `src/i18n.js`. Lo importante: **los motivos que salen en
las tarjetas NO son frases dentro del motor**. `rules.js` guarda una CLAVE en
`why`, el motor devuelve `{ clave, params }` y traduce la interfaz. Si añades
una regla, añade su clave a los DOS idiomas: hay una prueba que falla si un
idioma se queda a medias, y otra que comprueba que toda clave usada existe.

La identidad de un motivo ya no es su texto sino `idRazon()` (clave + a quién
señala). El filtro de motivos comunes y el dedupe dependen de eso.

El diagnóstico (`selftest.js`) sigue en español a propósito: es depuración.

## La vigilancia automática

Desde 0.9.0 la app no espera a que Javi note algo raro. `vigilancia.yml` corre
dos veces al día y tras cada despliegue: ejecuta `npm test` y
`scripts/diagnostico.mjs`, que es el MISMO `runSelfTest` del botón pero contra
**lo que la app sirve**, no contra el repositorio. Esa distinción es la clave:
dos veces en un mismo día el repo estaba impecable y lo publicado estaba roto.

Si falla, abre una incidencia con la etiqueta `vigilancia` y el informe dentro;
si ya hay una abierta, comenta en ella en vez de crear otra. Cuando vuelve a
pasar, la cierra sola.

En modo automático no hay móvil, así que la maestría y las partidas no se ven.
Esas comprobaciones se apagan con `env.sinDatosPersonales` en vez de convertirse
en avisos: si no, todos los informes vendrían con avisos y dejaríamos de leerlos.

`mantenimiento.yml` (lunes) regenera las tablas de deducción y propone el cambio
en un pull request, y avisa de héroes nuevos SIN inventarles tags.

## La API

Proyecto comunitario (Rone Arena), retransmite los datos internos de Moonton.
No hay API oficial de desarrollador. Ha cambiado de dominio y de rutas más de
una vez, así que `ingest.mjs` **no fija ninguna URL**: lee el esquema OpenAPI y
descubre rutas, método y parámetros. Si algo falla, el diagnóstico lo enseña en
el móvil. No vuelvas a poner rutas a mano.

La ingesta se degrada en silencio y de forma legítima: si un endpoint falla,
conserva los datos anteriores y solo cambia `diagnostics`. Eso hace que una
corrida mala se parezca mucho a una buena en el diff: mismos números, solo
`generatedAt` nuevo y menos rangos resueltos. Si ves ese diff, la corrida fue
peor que la que ya está subida y toca descartarla, no commitearla.

Por eso la prueba que ejecuta la ingesta de verdad escribe en un temporal
(`--out`) y nunca en `public/data`. En 0.3.1 esto era un fallo real: escribía en
su sitio, así que cada `npm test` ensuciaba el repo y, como en el workflow las
pruebas van antes de compilar, el diagnóstico degradado era el que se publicaba
y el botón Diagnóstico mentía sobre los rangos. No le quites el `--out`.

## Lo que queda pendiente

- 7 héroes siguen sin tags escritos a mano: Marcel, Hirara, Zetian, Sora,
  Obsidia, Cici y Valir. Desde 0.6.0 no dependen solo del rol: se les deduce de
  la `speciality` de Moonton, con una precisión medida del 67% y una cobertura
  del 52,5%. Escribirles tags propios en `heroes.json` sigue siendo mejor
  —quita el descuento por deducción—, pero ya no es urgente. Valir no es un
  desajuste de nombre: es un héroe real que falta en el catálogo.
- La deducción se apoya en `SPECIALITY_TAGS` y `ROLE_VETO`, que NO se editan a
  mano: las regenera `node scripts/derivar-tags.mjs` del propio catálogo.
  Reejecútalo cuando crezca `heroes.json` o Moonton cambie sus etiquetas.
- El registro de partidas existe desde 0.8.0 (botón "Apuntar partida"), pero
  empieza vacío. Necesita 30 partidas siguiendo la recomendación y 30 por libre
  antes de que comparar los dos winrates signifique algo; el diagnóstico dice
  cuántas faltan. Hasta entonces NO toques los pesos: es exactamente el error
  que la regla de arriba prohíbe, solo que con más pasos.
- La cobertura de la matriz de counters es del 7,5%: la API devuelve unos 10
  matchups por héroe, no los 133. En los cruces sin dato mandan las reglas.
