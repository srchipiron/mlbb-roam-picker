# Contexto del proyecto

App personal de Javi (usuario de GitHub: `srchipiron`) para elegir roamer en
Mobile Legends. Está en **Gloria Mítica**, así que el rango por defecto de los
datos es `glory`, no `mythic`.

Trabaja **solo desde el móvil**, con Termux. No tiene ordenador. Eso condiciona
todo: no hay consola de desarrollo en el navegador, no puede leer un JSON largo
cómodamente, y cada despliegue le cuesta minutos de espera. Por eso la app trae
su propio diagnóstico dentro (botón **Diagnóstico** → Copiar) y por eso las
comprobaciones automáticas importan más de lo normal.

## Reglas de trabajo

**Nunca subas nada sin pasar `npm test`.** Son cuatro comprobaciones y 33
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

- 7 héroes usan los tags genéricos de su rol en vez de los suyos: Marcel,
  Hirara, Zetian, Sora, Obsidia, Cici y Valir. Desde 0.5.0 esto ya es lo que
  dice la frase —antes se quedaban sin ningún tag—, así que es una mejora, no
  una avería: escribirles tags propios en `heroes.json` afina, pero el rol de la
  API ya los hace utilizables. Valir no es un desajuste de nombre: es un héroe
  real que falta en el catálogo escrito a mano.
- El registro de partidas necesita unas 30 de cada tipo antes de decir nada.
  Cuando las haya, mirar si conviene reajustar los pesos con datos reales.
- La cobertura de la matriz de counters es del 7,5%: la API devuelve unos 10
  matchups por héroe, no los 133. En los cruces sin dato mandan las reglas.
