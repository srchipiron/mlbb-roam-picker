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

**Nunca subas nada sin pasar `npm test`.** Son cuatro comprobaciones y 60
pruebas (orden de declaraciones, CSS, versión documentada y motor). El
despliegue corre esas cuatro más dos que no están en `npm test`: que la corrida
nueva no resuelva menos que la guardada (`comparar-ingesta.mjs`), y que los
datos con los que se va a publicar no pasen de 72 horas ni vengan sin matriz de
cruces. Si la API está caída se publica con los datos del repositorio: el
despliegue de código NO depende de que la API esté viva, y eso ya costó una
versión sin publicar. Si algo falla, el despliegue se detiene y la app se queda
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

Cada corrida deja además una fila en `historial/salud.jsonl` con sus cifras
(cobertura, ruido, cruces, edad de los datos, pools por línea). Un umbral solo
salta cuando ya es tarde; una serie enseña la pendiente. `node
scripts/tendencia.mjs` la resume. No lleva nada personal: son corridas
automáticas contra lo publicado.

`mantenimiento.yml` (lunes) regenera las tablas de deducción y propone el cambio
en un pull request, y avisa de héroes nuevos SIN inventarles tags.

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

- 7 héroes siguen sin tags escritos a mano: Marcel, Hirara, Zetian, Sora,
  Obsidia, Cici y Valir. Desde 0.6.0 no dependen solo del rol: se les deduce de
  la `speciality` de Moonton, con una precisión medida del 67% y una cobertura
  del 52,5%. Escribirles tags propios en `heroes.json` sigue siendo mejor
  —quita el descuento por deducción—, pero ya no es urgente. Valir no es un
  desajuste de nombre: es un héroe real que falta en el catálogo.
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
