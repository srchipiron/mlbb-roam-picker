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

**Nunca subas nada sin pasar `npm test`.** Son cuatro comprobaciones y ~100
pruebas (orden de declaraciones, CSS, versión documentada y motor). El
despliegue corre esas cuatro más dos que no están en `npm test`: que la corrida
nueva no resuelva menos que la guardada (`comparar-ingesta.mjs`), y que los
datos con los que se va a publicar no pasen de 72 horas ni vengan sin matriz de
cruces. Si la API está caída se publica con los datos del repositorio: el
despliegue de código NO depende de que la API esté viva, y eso ya costó una
versión sin publicar. Si algo falla, el despliegue se detiene y la app se queda
con la versión anterior funcionando, que es lo correcto.

Desde 1.25.0 el despliegue **no descarga datos si los del repositorio tienen
menos de 24 horas**: el bot ya lo hace dos veces al día. Son 24 y no 12 porque
**GitHub ejecuta el cron con 3–5 horas de retraso** (medido en las seis
corridas del bot: cron a las 05:17 y 17:17 UTC, arranques reales entre las
10:05 y las 11:35 y entre las 19:50 y las 21:53), así que los datos del
repositorio tienen normalmente entre 12 y 17 horas. No es un fallo del bot; si
cambias el umbral, mide antes el retraso real. Cada push de código
costaba diez minutos de ingesta y, con `cancel-in-progress`, cada push
reiniciaba la del anterior: cinco commits seguidos dejaron lo publicado 25
minutos por detrás. Si ves que un despliegue tarda doce minutos, es que el bot
lleva medio día sin traer datos, y eso es lo que hay que mirar.

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

**Prefiere el dato a la regla escrita a mano.** Desde 1.5.0 la matriz de
counters está COMPLETA (17.556 cruces, el 100%), así que las reglas de
`rules.js` ya no deciden ningún counter: solo entran con un héroe tan nuevo que
la API no publica ni un cruce suyo. Y hay con qué medirlas:
`node scripts/medir-reglas.mjs` hace una t de Welch por HÉROE y controla la tasa
de falsos hallazgos con Benjamini-Hochberg.

Lo que dice hoy, y conviene leerlo entero antes de tocar `rules.js`:

- Siete de las once reglas medibles encuentran más héroes de los que daría el
  azar. El efecto existe.
- Pero el TAG los captura fatal. `anti_mobility` está puesto a 9 héroes: lo
  cumplen 4, y hay 17 sin la etiqueta que lo cumplen -Obsidia (+1,17pp, t=5,96),
  Hilda, Cyclops, Jawhead...-. La regla es cierta y la etiqueta está mal, que es
  otro problema y se arregla de otra manera.
- **Y sobre todo: las once reglas miden UN SOLO EJE.** La ventaja de un héroe
  contra `dash` y contra `dive` correlacionan a r=0,93; contra `mobile` e
  `immobile`, a −0,87. Los grupos de enemigos se solapan al 68%. No hay doce
  relaciones tácticas: hay una, "a quién te comes tú y quién te come a ti", con
  los asesinos en un extremo y los supports en el otro. Una regla nueva no añade
  información: repite esa misma.

Cada regla nueva es deuda, y ahora además está medido.

Desde 1.16.0 esto tiene consecuencia en pantalla: un motivo por etiqueta solo se
enseña **si el cruce real va en el mismo sentido**. La regla explica el porqué;
el dato dice si es verdad. Sin dato del cruce (héroe recién salido) la regla se
enseña igual, que es justo para lo que está. Y el umbral de «ganas el cruce»
salió de medir la distribución (p90/p10 = 0.5154/0.4846), no de suponer que un
53% es ventaja: 0.53 era el percentil 99 y por eso el motivo bien fundado casi
nunca salía. Medido en 2.000 tarjetas: motivos con dato del 14,5% al 50,4%.

## Qué son los datos, de verdad

Medido, no supuesto. Si cambias de fuente, vuelve a medir esto ANTES de tocar
ninguna constante.

- **`pickRate` es cuota de picks, no presencia.** Los 133 suman exactamente
  1,0000. La presencia real en una partida es diez veces eso (hay diez picks).
- **La matriz de counters está orientada como se espera**: `counters[A][B] > 0.5`
  significa que A va por delante. Comprobado con héroes de diseño público:
  Phoveus saca +1,66 puntos contra los que hacen dash y −0,22 contra Layla, que
  no tiene dash. Khufra +0,98, Minsitthar +0,49.
- **Los cruces NO llevan dentro la fuerza general de ninguno de los dos.** La
  media de los 132 cruces de cada héroe es 0,494 tanto si su winrate global es
  0,445 como si es 0,543, y la correlación dentro de cada fila con el winrate
  del rival es −0,003. Son índices de cruce ya centrados, así que `counter` NO
  duplica lo que mide `meta`.
- **Los cruces no son estimaciones ruidosas.** Dos comprobaciones: (1) si el
  ruido fuera de muestreo, el cuartil menos jugado tendría sus cruces 2,65 veces
  más dispersos que el más jugado, y lo que se mide es 1,16; (2) dos corridas de
  la ingesta separadas nueve minutos dan los mismos cruces con una diferencia
  mediana de 0,00003. Por eso `PICKRATE_FIABLE` bajó de 0,004 a 0,00041: el
  valor viejo encogía a los héroes raros diez veces más de lo que el dato
  justifica. El diagnóstico vigila las dos cosas y avisa si cambian.

Dos constantes que se midieron y se dejaron como estaban, para no volver a
medirlas: el umbral de «tu héroe está N puntos por encima» (`>= 0.02` en
`analisis.js`) lo supera el 63% de los pares y la σ del winrate global entre
héroes es ≈3 puntos, así que 2 puntos es una diferencia real y no ruido; y el
margen de empate (`empatados`, 0.015) declara empate en el 21% de los drafts
—p25 de la distancia nº1–nº2 es 0.017—, que es una decisión de cuántas veces
decir «está reñido», no una calibración contra una distribución.

## Errores ya cometidos, para no repetirlos

Todos estos llegaron a producción y costaron rondas enteras de ida y vuelta:

- **`ROUTES is not defined`** — la ingesta reventaba en la primera línea. Pasaba
  `node --check` porque la sintaxis era válida. Hay una prueba que la ejecuta de
  verdad; no la quites.
- **El tercer workflow fuera del guardarraíl** — `mantenimiento.yml` ejecutaba
  la ingesta sin `--out`, directa sobre `public/data`, sin comparar y sin tope;
  la prueba del guardarraíl solo listaba los otros dos. No commiteaba el
  fichero, pero derivaba las tablas y pasaba `npm test` sobre lo que saliera.
  Hoy los tres hacen lo mismo y la prueba recorre los tres. Si añades un
  workflow que llame a la ingesta, va en esa lista o no está protegido.
- **La ingesta sin tope de tiempo** — `continue-on-error` cubre que falle, no
  que se cuelgue: ~570 peticiones con 15 s de timeout son 140 minutos con la
  API a medias, y el despliegue se quedaba ahí sabiendo publicar con los datos
  del repositorio. Se vio en directo (20 minutos en un paso de 9). Hoy los dos
  workflows llevan `timeout-minutes: 20` en la ingesta y hay prueba. Si un paso
  llama a un servicio externo, tiene tope de tiempo; si no, no está protegido.
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
- **Un encogimiento que la normalización se comía entero** — `compScore`
  multiplica por `confidence` (aliados/3) para pesar menos con el draft a
  medias, y ese factor NO llega al ranking: `normalizarComponente` reescala
  cada componente dentro del pool, así que un factor igual para todos los
  héroes desaparece en la reescala. Medido: el rango de la contribución de
  `comp` es 0.0800 con uno, dos o tres aliados, o sea el peso entero. Lo mismo
  le pasaría a cualquier otro encogimiento global que añadas. Si hay que pesar
  menos un componente por el estado del draft, el ÚNICO sitio donde se nota es
  el peso. Lo que sí sobrevive es lo que varía entre héroes, como
  `PRECISION_DEDUCIDA`.
- **Elegir la ruta de la API por su nombre en vez de por lo que devuelve** — el
  descubrimiento descartaba a propósito las rutas de `/academy` ("son material
  didáctico"). Era falso: `/academy/heroes/{id}/counters` devuelve los 132
  cruces de cada héroe y la que se prefería, CINCO. La app decidía el 89% de los
  counters con reglas escritas a mano teniendo el dato disponible, y nada
  fallaba. Ahora `elegirRutaConMasDatos` llama a cada candidata y se queda con
  la que más pares trae. Si añades un objetivo a `WANTED`, recoge TODOS los
  candidatos de todos los patrones, no solo los del primero que acierte: por
  cortar ahí, la ruta de `teammates` no llegaba a compararse nunca.
- **La maestría medida contra el 50% en vez de contra TU nivel** — `masteryScore`
  encogía hacia 0.50 y centraba la escala en 0.50. Para un jugador del 53,4%,
  un héroe jugado a su media exacta puntuaba 0.64 y uno sin tocar, 0.50: la app
  premiaba TENER DATOS, no ser bueno con el héroe. Hoy `tuNivel` saca su media
  ponderada y todo va centrado ahí. Si añades algo que compare winrates
  personales, compáralo contra su nivel, nunca contra 0.50.
- **Las constantes del rival de línea, sin medir** — con el arnés de drafts de
  línea conocida se midieron las cuatro (`base`, `alt`, `rol`, `veto`); tres en
  meseta, y `rol` monótono: a 0.10 cero rivales equivocados en 1.600 drafts
  frente al 1,3–2,7% a 0.30, por 1–1,5 puntos de cobertura. Ver `ROL_TIPICO`.
  La prueba de precisión mide ahora también drafts a medias, que es donde se
  distingue.
- **El rival de línea, deducido enemigo a enemigo** — nunca se había medido y
  con draft a medias se equivocaba del 10% al 21%: nombraba a un rival que aún
  no estaba en el draft y le doblaba el cruce. Desde 1.21.0 reparte a todos los
  enemigos entre las líneas a la vez (eliminación) y hay una prueba de
  precisión sobre drafts con la línea conocida: exp ≥80% acierto, ≤5% error. El
  margen para nombrar a alguien (`MARGEN_PARA_HABLAR`) está medido, no puesto.
- **El mismo 0.53 escrito a mano en TRES sitios** — counters, análisis del draft
  y sinergias. En los tres es el percentil 99 de su distribución, o sea «casi
  nunca». Y las parejas ni siquiera comparten distribución con los cruces
  (p90 0.5100 frente a 0.5154), así que copiar el número de un sitio a otro es
  doblemente erróneo. Hay una prueba que falla si vuelve a aparecer un umbral de
  cruce suelto en `score.js` o `analisis.js`.
- **El motivo de maestría decidido con el winrate bruto y un corte de 20
  partidas** — 20 partidas al 60% sacaban «lo llevas al 60%» (encogido: 54%,
  nada) y 300 al 57% no sacaban nada (encogido: 55,7%, señal real). La
  evidencia débil se enseñaba y la fuerte no. Hoy decide el estimado encogido,
  que ya lleva dentro el tamaño de muestra, y el corte de partidas desapareció
  con `MASTERY_CONFIDENCE_GAMES`. Si una condición mira una cantidad cruda
  habiendo un estimado encogido de la misma cosa, está mirando la equivocada.
- **El umbral del motivo de maestría, absoluto** — la NOTA se arregló para
  medirse contra tu nivel y el MOTIVO se quedó en `>= 0.55`. A un jugador del
  53,4% le decía «lo llevas bien» de un héroe en su media exacta, y a uno del
  45% no le reconocía nunca su mejor héroe. Si arreglas un sesgo, mira si el
  mismo componente lo tiene en otro sitio.
- **El mismo umbral mal calibrado, en dos sitios** — al arreglar el de las
  tarjetas (0.53/0.47, percentil 99) se quedó vivo el gemelo de `analisis.js`
  (`MATCHUP_CLARO = 0.03`), y por eso el análisis del draft enmudecía justo con
  la información delante: un draft completo daba UNA frase. Hoy los dos salen de
  `CRUCE_MALO`, y hay una prueba de que `analisis.js` no tiene umbral propio. Si
  calibras una constante contra la distribución, busca sus gemelas.
- **Un corte donde debía haber un encogimiento** — `tuNivel` usaba el 50% por
  debajo de 100 partidas y tu winrate entero por encima. Apuntar UNA partida más
  (de la 99 a la 100) cambiaba el nº1 en 54 de 200 drafts. Hoy encoge de forma
  continua con `PRIOR_DE_TU_NIVEL`, y hay una prueba de que ningún par de
  valores consecutivos salta. Si añades otro umbral duro sobre una cantidad que
  crece sola, pregúntate primero qué pasa justo al cruzarlo.
- **Un prior de encogimiento puesto a ojo** — `MASTERY_CONFIDENCE_GAMES = 20`
  equivalía a suponer que su winrate varía ±11 puntos entre héroes (del 42% al
  64%). En un encogimiento bayesiano el prior NO es libre: `k = 0.25/σ²`, con σ
  la dispersión real. Hoy `priorDeMaestria` la mide de sus propios datos
  descontando la varianza de muestreo; sale ±4 puntos, o sea k≈156. Con 20,
  cinco partidas al 90% puntuaban 0.87.
- **Una cuenta de potencia con la fórmula equivocada** — "faltan N partidas"
  usaba la de dos muestras y con el coeficiente doblado, y pedía 178 donde son
  39. Se compara UNA muestra contra una referencia conocida (miles de partidas),
  así que su error no se paga dos veces. Y el error tipico va con la referencia,
  no con lo observado: con 11 partidas ganadas todas, Wald da error CERO.
- **Constantes calibradas contra una suposición, no contra el dato** — la
  confianza en un cruce se encogía con `pickRate/(pickRate+0.004)`, y ese 0.004
  salía de dar por hecho que el dato venía de unos pocos miles de partidas.
  Nunca se comprobó. Medido, el ruido no crece con lo raro que sea el héroe ni
  de lejos como supone esa fórmula: la constante castigaba a los héroes poco
  jugados el doble de lo que toca, y cambiaba el nº1 en el 14,5% de los drafts.
  Antes de encoger nada por muestra, MIDE que la muestra sea el problema.
- **Un `clamp01` comiéndose el 5% de los datos** — la sinergia se mapeaba con
  `(x-0.46)/0.10`, y el 5,3% de las parejas caía por debajo de 0.46: la peor
  sinergia del juego (0.20) y una mala del montón (0.45) salían las dos a cero.
  Hoy el rango es (0.42, 0.16) y recorta el 1,1%. El diagnóstico lo vigila.
- **Constantes calibradas sobre una muestra sesgada** — `riesgoContrapick`
  dividía por 0.08 porque el p10 de los cruces parecía 0.467. Ese p10 salía de
  los cinco cruces MÁS EXTREMOS de cada héroe, que era todo lo que daba la ruta
  corta. Con la matriz entera el p10 real es 0.485, ningún héroe pasaba de 0.43
  y el aviso de "pick castigable a ciegas" no habría vuelto a salir jamás. Hoy
  la constante es `PEOR_CRUCE_REAL`. Si cambias de fuente de datos, revisa
  TODAS las constantes calibradas contra la anterior.
- **La sensatez táctica apoyada en un agujero** — la prueba "contra tres
  asesinos de dash el nº1 corta dashes" solo pasaba porque el 89% de los cruces
  no tenía dato y mandaban las reglas por tags. Con dato para todo, deja de
  cumplirse, y medir dice por qué: los anti-dash promedian 0.5042 contra los
  dashers y el resto 0.4999. La prueba se cambió por dos que sí se sostienen
  (que la recomendación cambia con el equipo enemigo, y que el componente de
  counter ordena igual que el dato real), más otra que vigila las reglas donde
  siguen mandando: los héroes sin dato.
- **Dos criterios distintos de "quién es roamer"** — la app usaba
  `mergeCatalog` (catálogo + rol de la API) y la ingesta miraba solo el catálogo,
  así que Marcel entraba en las recomendaciones sin que nadie le pidiera
  counters. Ahora la ingesta importa `mergeCatalog`. No vuelvas a duplicarlo.
- **Quedarse con UNA ruta de objetos habiendo dos** — el descubrimiento elegía
  `/academy/equipment/expanded` (152 objetos, con `equiptips`) y descartaba
  `/academy/equipment` (184, sin tips). Tres builds enseñaban `#10001` en vez de
  «Lantern of Hope». Hoy `fetchEquipo` lee la ruta elegida Y sus alternativas y
  funde campo a campo: la primera que da cada dato manda. Mismo error de forma
  que el de `/academy` en los counters, y por eso `alternativas` ya se guarda
  para todas las claves, no solo para las que llevan `{id}`.
- **Toda la hoja de estilos de móvil, muerta** — los tres bloques `@media`
  estaban al PRINCIPIO del fichero, y una consulta de medios no añade
  especificidad: cualquier regla base escrita después la pisa entera. El móvil
  llevaba quién sabe cuánto enseñando el diseño de escritorio y nada fallaba.
  Medido: `.slot` pedía `min-width: 0` y salía 84px; `.pick-name` pedía 16px y
  salía 24px. Hoy los bloques van AL FINAL y `check-css.mjs` falla si vuelve a
  aparecer una regla normal después del primer `@media`. Si añades una consulta
  de medios, va al final del fichero, siempre.
- **La fase de baneos a un héroe por apertura** — el selector se cerraba con
  cada toque, y diez baneos en medio minuto no daban tiempo. Desde 1.28.0
  el selector de baneos es multi-toque (`multi` en `HeroSheet`), con los
  sugeridos arriba y ordenado por tasa de ban. Si añades otro selector con
  varios toques seguidos, reutiliza ese modo en vez de cerrar y reabrir.
- **El «conservo lo anterior» de la ingesta, leyendo del temporal** — cada
  endpoint que falla conserva los datos previos, pero `previous` se leía de
  la ruta de SALIDA (`--out /tmp/nueva.json`, que no existe) y conservaba
  la nada: un fallo suelto tiraba la corrida entera. Hoy se lee de
  `public/data/roam-meta.json`. Si cambias dónde se escribe, mira de dónde
  se lee.
- **Los datos de ayer con la fecha de hoy** — al arreglar lo anterior, una
  corrida con la API caída conservaba TODO (también `statsByRank`) y salía
  con `generatedAt` nuevo: idéntica a la guardada, el comparador la
  aceptaba, el bot la commiteaba y la puerta de frescura (72 h) no habría
  saltado jamás. Hoy la fecha solo avanza si se descargó el rango pedido
  (`diagnostics.frescos`, `conservado`) y `comparar-ingesta` cuenta
  `rangoFresco`. Cada vez que un fallback conserve algo, pregúntate qué
  METADATO deja de ser verdad.
- **Un bot haciendo push sin rebase** — la vigilancia commitea su fila de
  salud varias veces al día; la ingesta tarda diez minutos; el push se
  rechazaba y la corrida se perdía en silencio (pasó con `pro.yml` en su
  primera corrida). Todo bot que commitea hace `git pull --rebase` antes,
  y hay prueba.
- **`npm test | tee` sin pipefail en la vigilancia** — el paso devolvía el
  código de `tee` y un motor roto nunca abría incidencia. `shell: bash`.
- **Motivos cortados a tres ANTES de quitar los comunes** — el 12% de las
  tarjetas se quedaba con menos de tres teniendo un cuarto válido.
  `scoreHero` devuelve todos y `rankRoamers` corta después de filtrar.
- **La composición con el equipo vacío** — sin aliados no hay hueco que
  tapar, pero `comp` premiaba acumular etiquetas con el peso entero (el
  sesgo de Marcel otra vez) y sin motivo en la tarjeta. Se deja plana hasta
  que hay alguien: cambia el nº1 en el 22% de los drafts vacíos (medido,
  300 drafts). Un factor global se lo come la normalización; PONER A 0.5
  todos los valores no, porque los iguala.
- **Maestría con la clave cruda** — «X.Borg» escrito a mano y «X Borg» en el
  catálogo: 400 partidas fuera del ranking sin aviso. `maestriaEfectiva`
  devuelve claves normalizadas y todo se lee con `lookup`.
- **Fundir perfiles por instante+pick+resultado** — una partida corregida
  aquí y reimportada de un código viejo salía dos veces. La clave es `t`, y
  gana la copia local.
- **Texto escrito a mano en la interfaz** — «37/37 con datos · 37 con counters»
  estaba en español dentro de App.jsx y salía tal cual con la app en inglés.
  Todo lo que se ve pasa por `t()`; la única excepción a propósito es el
  diagnóstico, que es depuración.
- **Una corrida degradada commiteada por el bot de datos** — `update-data.yml`
  ejecutaba la ingesta encima de `public/data` y commiteaba lo que saliera. Salió
  una corrida con los 133 héroes SIN `lanes` y SIN `role`, y con counters de 34
  héroes en vez de 133. Cuatro de las cinco líneas se quedaban con el pool vacío.
  El diff no chillaba porque la ingesta conserva los datos anteriores cuando un
  endpoint falla: parecía una corrida normal con `generatedAt` nuevo. El
  despliegue tampoco lo habría parado: comprobaba la frescura y que hubiera
  estadísticas, no que se hubiera resuelto tanto como antes. Ahora las dos
  ingestas escriben a un temporal (`--out`), `scripts/comparar-ingesta.mjs`
  compara con lo guardado y solo se copia encima si no empeora. Hay una prueba
  que falla si alguien vuelve a apuntar la ingesta directa a `public/data`.

## Simular lo que falta por salir

Desde 1.27.0, `src/engine/robustez.js`. Con el draft a medias se simulan
finales plausibles —por las líneas enemigas abiertas (`lineasOcupadas`, el
mismo reparto que el rival) y ponderando cada línea por pickrate— y se cuenta
en qué fracción tu nº1 sigue siéndolo. Dos cosas medidas que no conviene volver
a suponer:

- **La cuota predice**: en roam con 2 enemigos vistos, cuota ≥ 0.5 → el nº1
  aguanta el 71% del draft completo; < 0.5 → 28%. Con 3: 62/26. Con 4: 71/31.
  Con 1 visto casi nada es robusto (14 de 200). `CUOTA_ROBUSTA = 0.5` es donde
  separa. Medido con el rival de línea contando doble, como en la app.
- **El final simulado tiene que parecerse al real** (1.27.1): los baneados no
  salen por ninguna línea ni son candidatos (la primera versión votaba a un
  héroe baneado que la app no enseñaba, y llamaba «frágil» al nº1 real con
  una cuota falsa), y el que sale por TU línea es tu rival, con su cruce a
  peso doble. Con el rival dentro «pick seguro» acierta más (roam, 3 vistos:
  55%→62%) y se dice menos. Si `rankRoamers` gana otra entrada de contexto que
  cambie el ranking, pásala también a la simulación.
- **No se usa para ordenar.** Medido con 120 simulaciones y dos semillas:
  ordenar por la simulación solo mejora con un enemigo visto (+4–6 puntos de
  acierto del nº1) y con dos o tres no aporta nada; cambiar de mecanismo en una
  sola fase sería un acantilado. Se enseña como información.
- Se cuenta por **votos** de nº1, no por media de puntuaciones: la nota se
  reescala dentro de cada draft y promediar escalas distintas es el fallo del
  encogimiento que se comía la normalización.
- Es determinista (semilla fija): sin eso el número bailaría entre dos
  aperturas del diagnóstico.

## Las partidas profesionales (Liquipedia)

Desde 1.29.0, `scripts/ingesta-pro.mjs` y `pro.yml` (lunes). Es la ÚNICA
fuente pública con drafts completos y resultado partida a partida; la API
comunitaria solo tiene las del propio usuario, tras el login que no se toca
(la cuenta de Javi vale dinero). Se buscaron otras APIs y no hay: la de
`sixthmelb` está muerta, `mlbb.rone.dev` no resuelve, mlbb.io bloquea
robots, mlbb.gg es una web. Antes de añadir una fuente, compruébala como
aquí: pidiéndole datos, no leyendo su README.

- **Se lee por la API y como piden sus condiciones**: `Accept-Encoding:
  gzip` (sin eso, 406), User-Agent con contacto, una petición cada 5 s, y
  NUNCA `action=parse` (una cada 30 s): el wikitext se lee con
  `prop=revisions`. Desde una IP compartida Liquipedia corta mucho antes de
  lo que dice (429 con Turnstile durante minutos): por eso hay retroceso de
  2/4/8 minutos, tope de peticiones, y se guarda lo leído en vez de tirarlo.
  Los picks van en `{{Map}}` (`t1h1..t2b5`, `winner`, `team1side`) dentro de
  `{{Match}}` (`date`, `opponentN`) en las SUBPÁGINAS del torneo (Regular
  Season, Playoffs...), no en la portada. La portada trae `sdate`/`edate`/
  `patch` en la infobox.
- **Los nombres son slugs y abreviaturas** (`yss`, `lance`, `esme`, `gatot`,
  `luo yi`). `ALIAS` en el script solo lleva lo visto en wikitext real, y un
  slug sin mapear descarta la partida y aparece en `pro.json` y en el
  diagnóstico. Un alias adivinado mete al héroe de al lado: peor que perder
  la partida.
- **Lo medido con 164 partidas de MPL ID S16 (agosto–octubre 2025, un año
  antes que los datos)**: modelo completo AUC 0.54, pendiente 0.29 ± 0.31;
  solo cruces AUC 0.56, pendiente 1.05 ± 0.67; solo héroes 0.09 ± 0.40; lado
  azul 50%. Con ese ± no se concluye nada de la escala. En pro los dos
  equipos eligen del mismo meta, así que el término de héroes discrimina
  poco ahí; en solo queue de Javi no tiene por qué ser igual. **No toques la
  escala de `estimacion.js` por esto**: hacen falta miles de partidas de la
  misma época (`--dias 120`) y `medir-pro.mjs` corre en cada corrida del bot.
- **Lo medido con 233 partidas de 2026 (misma época que los datos), primera
  corrida del bot**: modelo completo acierto 57,5%, AUC 0.61, Brier 0.244,
  pendiente 0.62 ± 0.23; solo héroes AUC 0.60 (pendiente 0.75 ± 0.28); solo
  cruces AUC 0.51; parejas 0.54; lado azul 52%. O sea: CON datos de la
  misma época el modelo sí distingue (0.61 es lo que consiguen los
  predictores de draft en MOBA), el término de héroes es el que manda y la
  escala parece algo optimista (habría que multiplicar el log-odds por
  ~0.6), pero con ±0.23 no se toca todavía: la medida se guarda en
  `pro.json.medicion` en cada corrida y el diagnóstico la enseña. Cuando el
  ± baje de 0.1 y la pendiente siga por debajo de 0.8, se calibra con ese
  factor y se documenta aquí. Y ojo con lo contrario: con 164 partidas de
  un año antes salía lo opuesto (cruces con señal, héroes sin ella), así
  que la época de la muestra decide, no el tamaño.
- Es incremental y monótona: funde por `claveDe` y `pro.yml` rechaza una
  corrida con menos partidas que las guardadas. `claveDe` es el CONTENIDO
  (fecha, equipos, picks, duración), no la página: la categoría de torneos
  lista también algunas subpáginas (`.../Season 11/Qualifier`) y con la
  página en la clave sus partidas entraban dos veces (20 de 304, 1.31.2).
  `sinSubpaginas` quita esas portadas antes de pedirlas, y hay una prueba de
  que el corpus guardado no tiene repetidas. `pro.json` es un EXTRA para
  la app (la línea «Pro» de las tarjetas): sin él, la app funciona igual.

## La probabilidad estimada de ganar

Desde 1.28.0, `src/engine/estimacion.js`. Modelo aditivo en log-odds con
cuatro términos, y cada uno está medido antes de sumarse. Lo que NO conviene
volver a suponer:

- **Las tres matrices están centradas.** Los cruces son antisimétricos
  (c[a][b]+c[b][a] = 1.0000 en los 8.778 pares) y no llevan la fuerza de
  nadie (r=0,009 con wrA−wrB). Las parejas TAMPOCO llevan la fuerza de los
  dos (pendiente 0.000 sobre wrA+wrB, r=0.000), aunque su media no sea 0.5
  (0.4954) y no sean antisimétricas: se centran en su propia media, que se
  calcula de la matriz, no se escribe.
- **Centrar los cruces en la media de la fila (0.494) es un error**, aunque
  el CLAUDE.md diga que esa es la media: metía +0.6 log-odds a favor del
  primer equipo y la mediana de drafts al azar salía al 64%. Se centran en
  0.5. Hay una prueba de que la mediana en 200 drafts al azar queda en 50±6.
- **La escala no está calibrada** y no hay con qué: no existen resultados de
  partidas. Con drafts completos al azar da entre el 30% y el 70% (p05/p95),
  con el término de héroes pesando el doble que el de cruces. Por eso se
  enseña con su aviso y por eso cada partida apuntada guarda `estimacion`:
  `calibracion()` en registro.js compara previsto con ocurrido (Brier contra
  0.25, y winrate real con ≥50% frente a <50%). Cuando haya 20 partidas,
  ESO es lo que dice si el número vale; si el Brier sale por encima de
  0.25, el diagnóstico avisa. No toques la escala a ojo: espera al dato.
- **Tu maestría sustituye al término de tu héroe, no se suma encima.** Tu
  winrate con él se encoge (mismo prior que la maestría) hacia lo que cabe
  esperar de ti con ese héroe: su winrate público más tu ventaja sobre el
  50%. Hay una prueba de que el término de héroes no cambia con la maestría.

La composición (`composicion.js`) separa dos cosas que no valen lo mismo: lo
medido en las parejas (dos del mismo daño rinden 0,54 puntos peor; dos magos
−4,0pp, dos asesinos −2,6, dos tanques −1,95, dos tiradores −1,26, en
`ROL_DOBLE_PP`) y los huecos por etiqueta (`TEAM_NEEDS`), que son regla
escrita a mano y se enseñan como tal. Solo se dicen en voz alta con tres
aliados, como el daño: es una afirmación sobre el equipo. Las listas de
claves en los params de un motivo (`lista: ['comp.tanky']`) las traduce `t()`
elemento a elemento.

## Las builds de objetos

Desde 1.11.0. `src/engine/builds.js`, y conviene tener clara la diferencia entre
sus dos mitades porque NO valen lo mismo:

- `buildsDe` es DATO: las tres builds más jugadas de ese héroe en esa línea, de
  la API, con su winrate y su cuota de uso.
- `ajusteDefensivo` es un CONSEJO. No sale de medir builds contra este draft
  —ese dato no existe en ninguna parte—, sale de dos hechos medidos (de qué pega
  cada enemigo, contado de sus habilidades; cuánta defensa da cada objeto, leído
  de `equiptips`) más una regla evidente del juego. La app lo enseña con su
  aviso. Si algún día se junta con lo otro sin decirlo, se está mintiendo.

Lo que hay medido y no conviene volver a suponer:

- **El winrate de una build no es causal.** Las builds del 3% de uso salen por
  encima de las del 13%, y el héroe entero por debajo de las tres. Quien se sale
  de la build por defecto suele ser quien más domina el héroe: ese porcentaje
  lleva dentro al jugador. Por eso se ordena **por uso**, nunca por winrate, y el
  aviso va escrito junto al dato, no en un tooltip.
- **57 de las 492 builds son indistinguibles en pantalla** (mismos objetos,
  mismo emblema, mismo hechizo): la API las separa por un talento de emblema que
  no descargamos. `fundirIguales` las junta, sumando el uso y **ponderando el
  winrate por uso** (el uso es proporcional a la muestra; promediar a pelo le
  daría a una del 0,4% el mismo peso que a una del 13%). No se juntan por
  objetos a secas: 115 pares comparten los tres objetos y cambian el hechizo, y
  ahí sí hay dos builds distintas.
- **La defensa de un objeto se lee del texto del juego, no de su categoría.**
  Tough Boots está catalogado como «Movement» y da 18 de defensa mágica. Mismo
  criterio que el tipo de daño de los héroes.
- `equipid` trae **tres objetos, el núcleo**, no los seis del inventario. No se
  completa lo que la API no da.
- **Lo que hace un objeto se lee de su texto**, igual que la defensa: la ingesta
  guarda `efectos` (`antiCuracion`, `cortaControl`) buscando lo que el juego
  escribe en el propio objeto. Nada de listas a mano: «Necklace of Durance» era
  EL objeto anti-curación y hoy ni existe en la API. NO se apunta «castiga los
  ataques básicos» aunque el texto lo diga, porque para usarlo haría falta saber
  quién pega con ataque básico y eso no lo sabemos: nuestro `damage` se cuenta
  de las habilidades, así que a un tirador le falta justo su ataque básico.
- **Solo se proponen objetos que ese jugador puede comprar.** El tipo lo trae la
  API (`equiptypename`): `Jungle` y `Roam` son de una línea, el resto valen para
  todos. Sin ese filtro, a un roamer con tres enemigos de control duro se le
  proponían las tres botas de JUNGLA. Salió probando el sitio PUBLICADO, no en
  las pruebas del motor. Y el objeto universal va delante del de línea aunque dé
  menos: dice lo mismo y no ata la build a una bendición.
- `ajustesDeBuild` da como mucho **dos** avisos, ordenados por peso, y solo si
  la build no lo cubre ya y hay algún objeto que proponer. Un enemigo suelto no
  cuenta como composición, y un enemigo con tags DEDUCIDOS cuenta 0,67: es el
  mismo descuento que el motor, y evita el sesgo que ya costó una versión con
  Marcel.
- Cuidado con los nombres, que se parecen a propósito: el DAÑO va en masculino
  (`fisico`/`magico`) y la DEFENSA de un objeto en femenino (`fisica`/`magica`).
  Leer un campo de defensa en un perfil de daño da `undefined` sin que falle nada.
- Se piden 164 builds, no 665: solo las líneas que cada héroe juega de verdad.
- El despliegue NO se para por quedarse sin builds -es un extra, y el botón
  simplemente no aparece-, pero `comparar-ingesta.mjs` sí rechaza una corrida que
  pierda builds u objetos respecto a la guardada.

## Las imágenes

Iconos de objeto (`public/objetos/{id}.png`, 71) y caras de héroe
(`public/heroes/{id}.jpg`, 133). Unos 4,6 MB en el repositorio.

- **Se sirven desde la app, no desde el CDN de Moonton.** Enlazar la imagen le
  cuenta tu IP a un tercero, y la app promete que tus datos no salen del móvil.
  Además, sin cobertura una imagen enlazada no llega, que es justo cuando estás
  en un draft.
- **Pero NO entran en la precarga del instalador** (`globPatterns` en
  `vite.config.js` excluye los png que no sean los de la app). Instalar seguiría
  costando 241 KB y no 5 MB; cada imagen se guarda en cuanto se ve, con una
  regla `CacheFirst`. Hay una prueba que falla si vuelven a colarse.
- Los retratos salen de la ficha que la ingesta YA pide para los 133 héroes: no
  cuestan ni una petición más. Se coge `head` (210x220, 22 KB), nunca
  `smallmap`, que es el dibujo de cuerpo entero: 165 KB por héroe, 22 MB.
- Los ficheros van **por id**, no por nombre: un id no cambia aunque Moonton
  reescriba el nombre. Por eso `mergeCatalog` añade ahora el `id` de la API a
  cada héroe del catálogo, y hay una prueba de que no se queda ninguno sin él.
- Si la imagen falta, el componente `Imagen` se quita solo y queda el texto. En
  el hueco del draft es al revés: manda la cara y el nombre se retira con
  `:has(.slot-cara)`, porque a 390px no caben los dos (medido: 0 píxeles para el
  nombre). Si no hay cara, el nombre recupera su sitio.
- **El prop se llama `className`, no `clase`.** `check-css.mjs` busca
  literalmente `className=` para saber qué clases usa la interfaz; con otro
  nombre, una clase sin estilo pasa el control sin que nadie se entere.

## Los idiomas

Español e inglés, en `src/i18n.js`. Lo importante: **los motivos que salen en
las tarjetas NO son frases dentro del motor**. `rules.js` guarda una CLAVE en
`why`, el motor devuelve `{ clave, params }` y traduce la interfaz. Si añades
una regla, añade su clave a los DOS idiomas: hay una prueba que falla si un
idioma se queda a medias, y otra que comprueba que toda clave usada existe.

La identidad de un motivo ya no es su texto sino `idRazon()` (clave + a quién
señala). El filtro de motivos comunes y el dedupe dependen de eso.

**La API dice que acepta 17 idiomas y devuelve inglés en todos.** Comprobado
sobre los 152 objetos (`lang=es` da 0 nombres distintos de `lang=en`) y sobre
las habilidades de un héroe. Traducir los nombres de objeto significaría
escribirlos a mano, y ahí un error no es cosmético: te manda a comprar otra cosa
en mitad del draft. Por eso los objetos llevan icono, que es lo que se reconoce
en cualquier idioma. Si algún día se escriben, que sea con nombres confirmados
por quien juega en español, no adivinados.

Los NOMBRES de héroe no se traducen en pantalla: son la clave de todos los
datos, y enseñar "Cíclope" mientras el motor busca "Cyclops" es justo el fallo
invisible que ya costó una corrección. Lo que sí acepta los dos idiomas es la
BÚSQUEDA, con `src/engine/alias.js`. Javi juega con el móvil en español y
escribía "Cíclope" sin encontrar nada. Un alias no envejece con los
reequilibrios, pero solo se apunta lo comprobado: uno equivocado saca el héroe
de al lado, que es peor que no tenerlo. Hay una prueba que comprueba que cada
alias apunta a un héroe real, que ninguno pisa el nombre de otro y que el
buscador de verdad los usa.

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

Desde 1.27.0 el diagnóstico del móvil también se compara con ese historial:
`vite.config.js` embebe las últimas 40 filas en `historial.json` (fuera de la
precarga y de `/data/`, como `version.json`) y `selftest.js` avisa si cruces,
sinergias, objetos, builds o el pool de la línea caen por debajo de la mediana
de la serie más 3 MAD. Y detecta datos imposibles (winrate fuera de 35–65%,
cuotas de pick que no suman 1, filas de counters planas): la ingesta conserva lo
anterior cuando un endpoint falla, así que una API rota se nota en los VALORES.

Cada corrida deja además una fila en `historial/salud.jsonl` con sus cifras
(cobertura, ruido, cruces, edad de los datos, pools por línea). Un umbral solo
salta cuando ya es tarde; una serie enseña la pendiente. `node
scripts/tendencia.mjs` la resume. No lleva nada personal: son corridas
automáticas contra lo publicado.

`mantenimiento.yml` (lunes) regenera las tablas de deducción y propone el cambio
en un pull request, y avisa de héroes nuevos SIN inventarles tags.

## Las novedades en la app

Desde 1.30.0 la versión del pie abre el CHANGELOG (`scripts/changelog.mjs`,
metido en `__CHANGELOG__` al compilar). Es el MISMO fichero que exige
`check-version.mjs`: no hay que escribir las novedades dos veces ni pueden
desincronizarse. Formato: `## X.Y.Z` y viñetas `- ` con continuación
indentada; el resumen es la primera frase de cada viñeta, así que escribe
primero QUÉ cambia y después el porqué. Hay una prueba de que la primera
entrada es la versión de `package.json`.

Y un detalle de los bots: un push hecho con `GITHUB_TOKEN` NO dispara
`on: push`. Por eso `deploy.yml` escucha por `workflow_run` a los bots
que commitean datos; si añades otro bot que commitee, ponlo en esa lista o
lo suyo no se publica hasta el siguiente push de código (pasó con
`pro.json`: 304 partidas en el repositorio y cero en la app).

## Saber qué versión estás usando

Desde 1.13.0. El service worker guarda la app ENTERA y los datos se refrescan
por su cuenta (`StaleWhileRevalidate`), así que se puede acabar con los datos de
hoy y la app de hace dos versiones. Pasó, y el diagnóstico decía «todo correcto»
porque todo lo que comprobaba estaba bien: solo que comprobaba una app que ya no
era la publicada.

`vite.config.js` emite un `version.json` diminuto en cada compilación, la app lo
pide con `cache: 'no-store'` antes del diagnóstico y `selftest.js` compara. Si no
hay red no avisa: no poder preguntarlo no es un problema. NO lo metas en la
precarga ni bajo `/data/`, o se serviría de caché y diría siempre que estás al
día, que es peor que no comprobarlo.

Desde 1.15.0 además se actualiza sola: la app pregunta al volver a primer plano
y **se recarga cuando el worker nuevo toma el control** (`controllerchange`).
Ese es el mecanismo imprescindible —comprobado en un navegador de verdad,
publicando una versión nueva con la pestaña abierta: quitándolo, no se
actualiza—. El `visibilitychange` es el refuerzo para cuando la pestaña lleva
horas dormida y el navegador no comprueba por su cuenta; en la prueba no se
distingue, porque ahí el navegador ya revalida solo. La recarga lleva pestillo:
sin él, un navegador que reinstale el worker podría dejarla en bucle.

Recargar es seguro porque el draft, la maestría y las partidas se guardan en
`localStorage` en cada cambio. Si algún día se añade estado que NO se guarde,
esto hay que revisarlo antes.

## Llevarse los datos a otro dispositivo

`src/engine/perfil.js`. El almacenamiento del navegador va por dispositivo, así
que la maestría no viaja sola. NO se ha montado una base de datos con códigos
por persona: haría falta un servidor -la app es estática en GitHub Pages-,
alguien pagándolo, y convertiría a Javi en responsable de datos de otras
personas. Todo eso para mover kilobyte y medio.

En su lugar, los datos van DENTRO del código: JSON, gzip si el navegador sabe, y
base64url, con marca de versión delante y suma de control detrás. Unos 500
caracteres. La promesa de "tus datos no salen de tu móvil" sigue siendo cierta:
salen porque los saca él.

Al importar se FUNDE, nunca se reemplaza (`fundirPerfil`): de cada héroe gana la
copia con más partidas y las partidas se juntan sin duplicar. Sin eso, pegar un
código viejo en el dispositivo bueno borraría la maestría de verdad. Hay una
prueba que lo comprueba EN LAS DOS DIRECCIONES: la primera versión solo miraba
la fácil y pasaba aunque se quitara el mecanismo entero.

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

- Ya no queda ningún héroe con tags deducidos: los 7 que faltaban (Marcel,
  Hirara, Zetian, Sora, Obsidia, Cici, Valir) se escribieron a mano en
  `2917b2d`. El mecanismo de deducción (`tagsDeducidos`, `PRECISION_DEDUCIDA`)
  sigue vivo para el próximo héroe que saque Moonton antes de que alguien le
  escriba los tags, y `mantenimiento.yml` avisa cuando eso pase.
- La deducción se apoya en `SPECIALITY_TAGS` y `ROLE_VETO`, que NO se editan a
  mano: las regenera `node scripts/derivar-tags.mjs` del propio catálogo.
  Reejecútalo cuando crezca `heroes.json` o Moonton cambie sus etiquetas.
- Desde 1.9.0 el registro SÍ personaliza: `maestriaEfectiva` junta la maestría
  escrita a mano con la que sale de las partidas apuntadas, quedándose con la
  fuente que tenga más partidas de cada héroe (no se suman: la escrita a mano ya
  las incluye). Antes eran dos cosas que no se hablaban y apuntar partidas no
  movía la recomendación.
- Las partidas metidas del historial del juego llevan `previa: true` y quedan
  FUERA de las dos ramas de la comparación (`esPrevia`). Sin eso irían todas a
  "por libre" -no tienen `recomendados`- y meter cien partidas viejas llenaría
  esa rama con el winrate de siempre. Cuentan para la maestría, que es para lo
  que se meten.
- El instante (`t`) ES la identidad de una partida: por ahí se quita, se corrige
  y se deduplica al fundir perfiles. `apuntar` desempata los instantes repetidos
  porque dos toques rápidos caían en el mismo milisegundo y borrar una se
  llevaba las dos.
- Desde 1.17.0 la comparación tiene pantalla propia (`Veredicto`, dentro de
  «Partidas»). Tres reglas que NO son negociables y tienen prueba: el margen va
  en la misma frase que la diferencia, no se afirma nada mientras la diferencia
  quepa en el margen, y se dice que no está aleatorizado. Si alguna vez se saca
  de la app para enseñársela a alguien, se saca entera: el número sin el margen
  es publicidad, y con 11 partidas el margen es ±29 puntos.
- El registro de partidas existe desde 0.8.0 (botón "Apuntar partida"). La
  comparación "siguiendo la app contra por libre" es la limpia en teoría y la
  inalcanzable en la práctica: la segunda rama solo crece si Javi ignora la app
  a propósito, y además no está aleatorizada -él elige cuándo hacer caso-. Por
  eso desde 1.7.0 el diagnóstico da también la comparación contra su winrate
  histórico (`winrateDeReferencia`, ponderado por partidas), que sí se llena
  jugando. Las partidas que faltan salen del tamaño del efecto observado, no de
  un umbral escrito a mano. Hasta que una de las dos se distinga del azar, NO
  toques los pesos.
- El tipo de daño de cada héroe (`damage`, en `roam-meta.json`) se cuenta en los
  textos de habilidad de Moonton, no se deduce del rol: el rol se equivoca con
  Gusion, Hylos, Natan y Kimmy. Por eso NO lo encoge `PRECISION_DEDUCIDA`: es un
  dato medido, no una etiqueta adivinada, y encogerlo sería descontar dos veces.
  Cuenta habilidades, no daño real, así que a un tirador le falta su ataque
  básico: Melissa sale "mixto" cuando es física. Sale barato porque la ingesta ya
  pedía esa ficha; ahora la pide para los 133 en vez de para 7.
- La cobertura de la matriz de counters es del 100% desde 1.5.0: 132 rivales
  por héroe. `matchup()` y `sinergia()` siguen mirando los dos sentidos, que
  ahora solo hace falta para héroes recién salidos.
