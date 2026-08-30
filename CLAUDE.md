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

**Nunca subas nada sin pasar `npm test`.** Son tres comprobaciones y 28 pruebas
(orden de declaraciones, CSS y motor). El despliegue corre esas tres más una
cuarta que no está en `npm test`: que `roam-meta.json` se haya regenerado hace
menos de media hora. Si algo falla, el despliegue se detiene y la app se queda
con la versión anterior funcionando, que es lo correcto.

**Sube la versión en `package.json` cuando cambies comportamiento.** Criterio:
`0.X.0` cuando cambia cómo decide la app o qué hace; `0.0.X` para correcciones.
La versión sale en el pie de la app, así que sirve para saber desde el móvil si
lo que estás mirando es lo que acabas de subir. Hoy nada lo comprueba
automáticamente: no hay `CHANGELOG.md` ni un paso de despliegue que lo exija.

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
  niveles y hay que indexar los dos: `indexByName(m, 2)`.
- **`main_hero_channel.id` (2678829) colándose por `main_heroid` (93)** — la API
  devolvía 422 en las 133 peticiones. Los ids de héroe se validan por rango.
- **Motivos que le salían a todo el pool** ("no hay primera línea" es cierto
  para los 34 roamers) — se filtran los que aparecen en más del 60%.
- **El peel recomendado hacia tanques aliados**, porque un tanque también está
  etiquetado como `immobile`.

## La API

Proyecto comunitario (Rone Arena), retransmite los datos internos de Moonton.
No hay API oficial de desarrollador. Ha cambiado de dominio y de rutas más de
una vez, así que `ingest.mjs` **no fija ninguna URL**: lee el esquema OpenAPI y
descubre rutas, método y parámetros. Si algo falla, el diagnóstico lo enseña en
el móvil. No vuelvas a poner rutas a mano.

La ingesta se degrada en silencio y de forma legítima: si un endpoint falla,
conserva los datos anteriores y solo cambia `diagnostics`. Antes de commitear un
`roam-meta.json` que se haya regenerado en local, mira el diff: si los datos son
idénticos y lo único que cambia es `generatedAt` más un `diagnostics` peor
(menos rangos resueltos), esa corrida fue peor que la que ya está subida y toca
descartarla, no commitearla.

## Lo que queda pendiente

- 7 héroes usan los tags genéricos de su rol en vez de los suyos: Marcel,
  Hirara, Zetian, Sora, Obsidia, Cici y "Valir". El último no es un héroe nuevo
  sino un desajuste de nombre: el catálogo tiene "Vale" y "Valentina", así que
  hay que averiguar a cuál se refiere la API antes de darle tags.
- El registro de partidas necesita unas 30 de cada tipo antes de decir nada.
  Cuando las haya, mirar si conviene reajustar los pesos con datos reales.
- La cobertura de la matriz de counters es del 7,5%: la API devuelve unos 10
  matchups por héroe, no los 133. En los cruces sin dato mandan las reglas.
