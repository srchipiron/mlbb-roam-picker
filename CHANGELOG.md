# Cambios

Sube la versión en `package.json` cuando cambies comportamiento y deja aquí una
línea explicando qué cambia **para quien usa la app**, no qué ficheros tocaste.
El despliegue falla si la versión que vas a publicar no tiene su entrada, así
que esto no se olvida.

Criterio: `0.X.0` cuando cambia cómo decide la app o qué hace; `0.0.X` para
correcciones.

## 1.28.0

- **Probabilidad estimada de ganar.** Debajo del análisis sale «55% con
  Marcel» con su barra y de dónde viene: héroes, cruces, parejas y tú (tu
  maestría con ese héroe). Es un modelo aditivo sobre los winrates públicos
  de tu rango, no una promesa, y la app lo dice al lado del número. Cada
  partida que apuntes guarda la estimación que tenía delante, y «Partidas»
  compara lo previsto con lo que pasó: con 20 apuntadas te dice si el modelo
  acierta más que una moneda.
- **Qué tiene y qué le falta a cada equipo.** Una tira bajo el draft con el
  daño de cada lado (físico / mágico / mixto) y si hay primera línea,
  control, inicio y peel, para los dos equipos. El análisis lo dice en
  palabras: «a tu equipo le faltaba primera línea: Marcel lo tapa», «ellos
  van sin primera línea», y avisa si llevaríais dos del mismo rol (dos magos
  pierden 4 puntos de sinergia: medido en las parejas, no supuesto).
- **Banear en la mitad de toques.** El selector de baneos ya no se cierra
  con cada héroe: tocas los que quieras, se marcan, y «Listo». Arriba salen
  los que merece la pena banear, la rejilla va ordenada por tasa de ban y
  cada héroe lleva su cara. Tocar un baneado lo quita. Y en todos los
  selectores, Intro coge el primero de la lista: tres letras y Intro.

## 1.27.1

- La simulación de «¿aguanta el pick?» ya respeta los baneos: un héroe
  baneado no puede salir por ninguna línea enemiga ni cuenta como candidato
  tuyo. Antes, con el líder baneado, la simulación le seguía dando sus votos
  y llamaba «depende de lo que saquen» a un pick que en realidad era seguro.
- Si tu línea aún no tiene rival visible, el que sale por ella en cada final
  simulado cuenta como tu rival (su cruce pesa doble, como en el ranking
  real). Medido: cuando la app dice «pick seguro», acierta más que antes.

## 1.27.0

**La app razona sobre los enemigos que todavía no han salido, y el diagnóstico
se compara con su propio pasado.**

- **«Pick seguro» o «depende de lo que saquen».** Con el draft a medias, la app
  sabe por qué líneas van a salir los que faltan (por eliminación) y quién se
  juega en cada una y cuánto. Simula 60 finales de draft plausibles y te dice en
  qué fracción de ellos tu nº1 sigue siéndolo. Está medido que eso predice: con
  dos enemigos vistos, si aguanta al menos la mitad de los finales sobrevive al
  draft completo el 58% de las veces; si no, el 27%. Con tres, 59% frente a 27%.
  Y con uno visto casi nada es seguro, que es la verdad: espera si puedes.
  **No cambia la recomendación** —medido, ordenar por la simulación solo ayuda
  con un enemigo visto y con dos o tres no aporta nada— la explica.
- **El diagnóstico te dice por qué gana el nº1 y no el nº2**: el margen en
  puntos y qué componente lo decide (contra Khufra, «lo decide counter +4,1,
  luego meta +1,2»). Es lo que hace falta para discutir una recomendación en vez
  de creérsela.
- **Detecta datos imposibles**: un winrate del 90%, cuotas de pick que no
  suman uno, tasas de ban por encima del 100%, filas de counters planas. La
  descarga conserva lo anterior cuando un endpoint falla, así que una API rota
  no se nota en la forma del fichero: se nota en los valores.
- **Y se compara con su propio historial**: las últimas corridas de la
  vigilancia viajan con la app, y el diagnóstico avisa si cruces, sinergias,
  objetos, builds o el pool de tu línea han caído respecto a la mediana de la
  serie. La holgura sale de la dispersión de la propia serie, no de un número
  puesto a mano.

## 1.26.0

**Cero rivales equivocados.** Al deducir quién es tu rival de línea, el peso de
«este rol es típico de esta línea» era la única de sus constantes que no estaba
en meseta al medirla: bajándolo, los rivales mal nombrados pasan de un 1,3–2,7%
a **0 en 1.600 drafts**, a cambio de callarse un punto más. Un rival mal
nombrado dobla su cruce y sale en el análisis como si fuera un hecho; callarse
no cuesta nada. Lo que decide ahora es casi solo en qué líneas dice la API que
se juega cada héroe, que es el dato.

## 1.25.0

**Publicar un cambio de código pasa de doce minutos a dos.** El despliegue
volvía a descargar todos los datos en cada push, y no hace falta: el bot ya lo
hace dos veces al día y los guarda en el repositorio, y un winrate de ventana
de siete días no se mueve en horas. Peor: como cada despliegue nuevo cancela al
anterior, cinco cambios seguidos dejaron la app publicada 25 minutos por detrás
de lo subido —cada uno reiniciaba desde cero la descarga del anterior—.

Ahora solo descarga si el repositorio lleva más de 24 horas sin datos nuevos, es
decir, si el bot lleva un día fallando. (Veinticuatro y no doce porque GitHub
ejecuta el cron del bot con tres a cinco horas de retraso, medido en todas sus
corridas: los datos del repositorio tienen normalmente entre 12 y 17 horas.) Y
cuando el propio bot trae datos frescos, el despliegue que dispara tampoco los
vuelve a pedir.

## 1.24.1

Corrección en el mantenimiento semanal: su descarga de datos se saltaba el
guardarraíl que ya tenían el despliegue y el bot de datos. No llegaba a
commitear nada malo, pero derivaba las tablas y pasaba las pruebas sobre lo que
saliera, y podía quedarse colgada. Ahora hace lo mismo que los otros dos:
descarga a un temporal, compara con lo guardado, usa lo nuevo solo si no
empeora, y tiene tope de 20 minutos. La prueba que vigila esto cubre ya los
tres workflows, no dos.

## 1.24.0

**El despliegue ya no puede quedarse colgado esperando a la API.** Se vio en
directo: una ingesta llevaba veinte minutos en un paso que normalmente tarda
nueve. La descarga hace unas 570 peticiones con 15 segundos de tope cada una,
así que con la API a medias puede tardar más de dos horas — y el despliegue se
quedaba ahí, aunque desde la 1.6.0 sabe publicar con los datos del repositorio
cuando la descarga falla. Ahora la ingesta tiene tope de 20 minutos en los dos
workflows, y pasarse cuenta como fallo: se publica con lo guardado y queda
avisado en el registro.

## 1.23.0

**El diagnóstico lleva ahora el draft que tienes delante, con nombres.** Desde
que los huecos del draft enseñan la cara y no el nombre, una captura de pantalla
ya no dice quién estaba enfrente: para investigar la derrota con Minotauro hubo
que reconstruir el draft a medias. Ahora, cuando algo salga raro, con pegar el
diagnóstico basta: línea, enemigos, tu equipo, baneos, quién es tu rival (y si lo
marcaste tú o lo dedujo la app), los tres primeros con su nota y sus motivos, y
lo que dijo el análisis.

## 1.22.0

**«Lo llevas al X%» se decide ahora con lo que la app cree de verdad, no con el
número bruto.** Tenía el criterio al revés: 20 partidas al 60% sacaban motivo —y
son 12 victorias contra 11 esperadas, o sea nada— mientras 300 partidas al 57%
no sacaban ninguno, siendo una señal real. La evidencia débil se enseñaba y la
fuerte no. Ahora decide el estimado encogido, que ya tiene en cuenta cuántas
partidas hay, y el corte fijo de 20 partidas desaparece. Lo que ves sigue siendo
lo que pasó: «60% en 20 partidas», y tú ya ves que son veinte.

De paso: comprobado que los datos viajan comprimidos al móvil (180 KB, no 786),
y CLAUDE.md dejaba pendientes 7 héroes sin tags que ya se escribieron hace
tiempo.

## 1.21.0

**Tu rival de línea se deduce mirando el draft entero, no a cada enemigo por
separado.** Es la primera vez que se mide cómo de bien lo hacía, y hacía falta:
su cruce pesa el doble y de él sale la frase principal del análisis.

Antes miraba a cada enemigo solo: «¿juega esta línea?». Ahora reparte a los
cinco entre las cinco líneas a la vez y se queda con el reparto que mejor
encaja, que es como lo lee cualquiera: si la jungla ya está cogida, el que juega
exp o jungla va a la exp.

Medido contra 2.000 drafts con la línea de cada enemigo conocida:

- **Draft completo**: acierta el rival de exp el **88%** (antes 60%), de jungla
  el **91%** (antes 69%), de roam el **94%** (antes 78%). Y con menos errores.
- **Draft a medias** (2-3 enemigos): antes **se equivocaba del 10% al 21%**,
  porque nombraba a un rival que todavía no había salido —te ponía al mid como
  si fuera tu exp— y le doblaba el cruce. Ahora del 4% al 6%, y en su lugar se
  calla, que es lo correcto cuando tu rival aún no está.

Cambia el número 1 en el **3%** de los drafts, casi todos a medias: son los
casos en que antes doblaba el cruce equivocado.

## 1.20.0

**Barrido de todas las constantes del motor, buscando las gemelas del fallo
anterior.** Aparecieron dos más, y ninguna cambia la recomendación —comprobado
en 400 drafts: mismo número 1, mismo top 8— pero las dos cambian lo que lees.

- **«Combina bien con X» casi nunca salía.** Mismo 0,53 escrito a mano, tercera
  vez, y en las parejas es el **percentil 99**: salía en el 1,3% de ellas. Las
  parejas tienen su propia distribución (p90 = 0,5100, no 0,5154 como los
  cruces), así que ahora tiene su propio número medido. Los motivos de sinergia
  pasan de 63 a 320 en 2.000 tarjetas.
- **«Lo llevas al X%» se medía contra un 55% fijo.** A ti, que ganas el 53,4%,
  un héroe al 55% te salía como si destacara siendo tu media exacta. Y a un
  jugador del 45% no se le reconocía **nunca** su mejor héroe, porque nunca
  llega al 55%. Ahora se mide contra tu nivel y con la dispersión que la app ya
  saca de tus propios datos. Es el mismo arreglo que ya se hizo en la *nota* de
  maestría y que se había quedado a medias en el *motivo*.

Y para que no vuelva a pasar: hay una prueba que **falla si aparece cualquier
umbral de cruce escrito a mano** en el motor. Los tres fallos de esta tanda eran
el mismo número copiado a tres sitios sin volver a medirlo.

## 1.19.0

**El análisis del draft estaba casi mudo, y era el mismo fallo de calibración.**
Lo destapó una partida perdida con Minotauro: la app sabía que ese pick perdía el
cruce contra Ixia —lo ponía en rojo en la tarjeta— pero el análisis de arriba,
que es lo primero que lees, no decía nada. Con un draft completo, cinco enemigos
y cuatro aliados, salía **una sola frase**.

La causa: para avisar de «cuidado con X» exigía un cruce por debajo del 47%, que
es el **percentil 1,6%** de los cruces reales. Prácticamente nunca se cumplía.
Ahora usa el mismo umbral calibrado que las tarjetas (el 10% de cruces más
marcados), así que el análisis y la tarjeta dicen lo mismo del mismo cruce.

Medido en 400 drafts con rival marcado:

- «Cuidado con X, es tu peor cruce» pasa de salir **5 veces a 35**.
- «Ganas el cruce contra tu rival» pasa de **68 a 205** — y desplaza a la frase
  que solo comparaba winrates globales, porque el cruce es mejor dato.
- Drafts sin ninguna frase: del **13% al 7%**.

## 1.18.0

**Arreglado un acantilado en «tu nivel».** Buscando por qué la app te había
recomendado Estes con Kadita enfrente salió esto: tu nivel se calculaba con un
corte en 100 partidas —por debajo, 50%; por encima, tu winrate entero—. Medido:
apuntar **una sola partida más** (de la 99 a la 100) cambiaba el héroe
recomendado en **54 de 200 drafts**. Nadie cambia de nivel entre la partida 99 y
la 100.

Ahora tu nivel se encoge hacia el 50% de forma continua, como todo lo demás en
la app. El salto máximo entre dos pasos baja de 54 a 7 de 200, y ya no está
concentrado en un punto.

Sobre Estes contra Kadita: **el dato no dice que sea mal pick**. Kadita es el
cruce número 31 de 132 más malos para Estes (49,0%); sus peores de verdad son
Ixia, Nolan y Beatrix. Y medí si los héroes inmóviles sufren de verdad contra
los que hacen dive: la diferencia media es de **menos de dos décimas de punto**,
y para Estes en concreto no se distingue del ruido. La app no lo pone arriba
contra Kadita sola —queda el 30 de 37—; si te salió, fue por el resto del draft
o por tu maestría.

## 1.17.0

**«¿Te está funcionando?»**, dentro de tus partidas. Es la única prueba que
significa algo, así que se enseña con las tres cosas que la hacen honesta:

- Tu winrate siguiendo la app, tu winrate de siempre, y **la diferencia con su
  margen al lado**. Hoy, con tus 11 partidas: +21,4 puntos ± 29,5.
- **Mientras el margen se coma la diferencia, la respuesta es «todavía no se
  sabe»**, no «parece que sí». Y te dice cuántas partidas faltan.
- Y la trampa, escrita: tú eliges cuándo hacer caso, así que esto no es un
  experimento controlado. Es la mejor señal que se puede sacar sin pedirte que
  ignores la app a propósito, pero no es una prueba.

Un 73% en once partidas es exactamente lo que parecería una racha normal. Si
algún día enseñas esto para convencer a alguien, enséñalo entero: el número sin
el margen es publicidad.

## 1.16.0

**Los motivos de cada tarjeta ahora están respaldados por el dato.** La
recomendación no cambia —comprobado en 400 drafts: mismo número 1, mismo top 8,
mismas puntuaciones—; lo que cambia es lo que la app te cuenta para
justificarla.

Había dos cosas mal:

- **«Ganas el cruce contra X» casi nunca salía.** El umbral estaba en el 53% de
  victorias, que suena razonable pero es el **percentil 99** de los cruces
  reales: solo lo alcanzaba el 1,6%. La distribución de verdad es mucho más
  estrecha (el 90% de los cruces está entre 48,5% y 51,5%). Ahora el umbral es
  esa cola, así que el motivo sale cuando el cruce destaca de verdad.
- **Los motivos por etiqueta se decían aunque el cruce los desmintiera.** Salía
  «bloquea los dashes de Fanny» aunque contra Fanny pierdas. Medido héroe a
  héroe, esas etiquetas casi nunca predicen lo que afirman: de los nueve héroes
  con «anti-movilidad» solo Phoveus estorba de verdad a los móviles. Ahora la
  etiqueta explica el porqué **solo cuando el cruce va en el mismo sentido**.

En 2.000 tarjetas simuladas: los motivos sacados de partidas reales pasan del
14,5% al 50,4%, los de etiqueta bajan del 46% al 24% —y los que quedan están
respaldados—, y las tarjetas sin ningún motivo bajan del 27% al 13%.

## 1.15.0

**La app se actualiza sola.** Antes el diagnóstico te decía «cierra la app y
vuelve a abrirla», que es pedirte a ti que hagas el trabajo. Ahora comprueba si
hay versión nueva al volver a la app y se recarga en cuanto está lista. No
pierdes nada al recargar: el draft, la maestría y las partidas se guardan en el
móvil en cada cambio.

El aviso de «estás usando una versión vieja» sigue ahí, porque si un día el
mecanismo falla hay que poder verlo — pero ya no debería salirte.

**Y el titular del diagnóstico ya no se contradice.** Decía «Todo correcto (1
avisos)»: afirmaba que estaba todo bien y a la vez que había algo que mirar, y
encima en plural. Ahora dice «Sin fallos, 1 aviso», o «2 FALLOS y 3 avisos», o
«Todo correcto» cuando de verdad lo está.

## 1.14.0

**Repaso a la pantalla. Y por el camino apareció por qué se había ido al garete:
todo el diseño de móvil llevaba tiempo sin aplicarse.**

Las reglas de móvil estaban escritas al principio de la hoja de estilos, y una
regla normal escrita después las pisa entera. Resultado: en el móvil estabas
viendo el diseño de escritorio —nombres a 24px, huecos de 84px— y nada fallaba.
Medido antes de moverlas: el hueco del draft pedía 0 de ancho mínimo y salía 84.
Ya están al final, donde tienen efecto, y hay una comprobación que impide que
vuelvan a colocarse mal.

Lo que se nota, medido en una pantalla de 844px de alto:

- **La primera recomendación pasa de empezar en el píxel 602 a empezar en el
  391**, y se ven **cuatro** en vez de dos. La tira del draft baja de 390px a
  289: los cinco huecos de enemigos caben ahora en una fila, porque desde que
  llevan la cara ya no necesitan sitio para el nombre.
- **Los ajustes se han ido dentro de «Baneos y ajustes»** (tu maestría, tus
  partidas, tu perfil). Fuera se quedan los dos que usas con una partida
  delante: nuevo draft y apuntar partida. Antes eran cinco botones en dos filas
  comiéndose la pantalla.
- **El botón «Tu perfil» ya no se sale de la pantalla.** La fila de botones no
  se envolvía y, en un móvil, ese botón quedaba fuera sin forma de llegar a él.
- **El empate se decía dos veces** seguidas, con otras palabras. Ahora una.
- **La barra de colores de cada tarjeta ya no ocupa toda la fila.** En pantalla
  ancha era lo más grande de la tarjeta y lo único que no se podía leer; ahora
  va acotada y al tocarla te dice de dónde sale la nota.
- **Los motivos de equipo se distinguen de los del héroe.** «No hay primera
  línea» le vale igual a media lista y salía repetido en cuatro tarjetas
  compitiendo con «bloquea los dashes de Kagura», que es el que decide.
- **En pantalla ancha, las recomendaciones van en dos columnas**: se ven las ocho
  de un vistazo en vez de cuatro.
- **Los paneles ya no se transparentan.** Se veía el draft por detrás del texto.
- «37/37 con datos · 37 con counters» estaba escrito a mano en español y salía
  así con la app en inglés.

## 1.13.0

**El diagnóstico ahora te dice si estás usando una versión vieja.**

Pasó de verdad: el diagnóstico decía «todo correcto» con los datos de hoy y la
app de dos versiones antes. Y era cierto —todo lo que comprobaba estaba bien—,
solo que estaba comprobando una app que ya no era la publicada. Desde el móvil
no había forma de enterarse.

Es porque la app se guarda entera en el móvil para funcionar sin cobertura, y
los datos se refrescan por su cuenta: puedes acabar con los datos de hoy y la
app de ayer. Ahora el diagnóstico pregunta qué versión hay publicada y, si no
coincide con la que estás usando, lo dice como aviso y te pide que cierres y
vuelvas a abrir.

Si estás sin cobertura no puede preguntarlo, y entonces **no** avisa: no saberlo
no es un problema, y un diagnóstico que chilla sin motivo deja de leerse.

## 1.12.0

**Los objetos ahora se ven, y la build reacciona al draft entero.**

- **Cada objeto sale con su icono, y cada héroe recomendado con su cara.** Es la respuesta de verdad al problema del
  idioma: la API dice que acepta español pero devuelve todo en inglés —los
  nombres de objeto y hasta los de habilidad—, así que traducirlos habría sido
  escribirlos a mano, y un nombre mal puesto te manda a comprar otra cosa en
  mitad del draft. El dibujo lo reconoces juegues en el idioma que juegues. Los
  imágenes se sirven desde la propia app: no se piden al servidor de Moonton (tu
  IP no viaja a nadie) y funcionan sin cobertura. No se descargan al instalar
  —serían 4,6 MB de golpe—, sino cuando se ven, y luego se quedan guardadas.
- **La build ya no mira solo de qué pegan: mira qué traen.** Antes avisaba si el
  equipo enemigo era mágico o físico. Ahora también:
  - si **dos o más enemigos se curan** y tu build no lleva nada que corte la
    curación, te lo dice y te enseña los objetos que sí la cortan;
  - si **dos o más tienen control duro** y no llevas nada que lo acorte, igual.

  Y solo te propone objetos que **puedes comprar en tu línea**: nada de botas de
  jungla para un roam.
- **Y sigue callándose.** Como mucho salen dos avisos, el que más pesa primero,
  y ninguno aparece si la build ya lo cubre o si no hay ningún objeto que
  proponer. Contra un enemigo suelto no dice nada: uno no es una composición.

Lo que hace cada objeto no está escrito a mano en ningún sitio: se lee del texto
que el propio juego trae dentro del objeto («CC and Slow Duration reduced by
25%»). Por eso no envejece con los parches — y buena falta hacía: «Necklace of
Durance», que era EL objeto anti-curación, ya ni existe.

## 1.11.0

**Objetos.** Cada héroe de la lista tiene ahora un botón «Objetos» que abre lo
que compra la gente de tu rango con ese héroe **en tu línea**: los tres objetos
del núcleo, el emblema, el hechizo de batalla, cuánta gente la usa y cuántas
gana.

- **Ordenadas por uso, no por victorias, y se dice por qué.** Una build del 3%
  de uso sale con más victorias que la del 13%. Eso no significa que los
  objetos sean mejores: quien se sale de la build normal suele ser quien más
  domina al héroe, así que ese porcentaje lleva dentro al jugador. La app lo
  pone escrito debajo en vez de venderte la build "ganadora".
- **Y el ajuste que ninguna web de builds puede hacer: mirar tu draft.** Si
  cuatro de los cinco enemigos pegan mágico y la build no lleva defensa mágica,
  te lo dice y te propone los objetos que sí la dan. Sale de dos datos medidos
  —de qué pega cada enemigo, contado de sus habilidades, y cuánta defensa da
  cada objeto, leído del texto del juego— y va con su aviso: no es que se hayan
  medido builds contra este draft, ese dato no existe.
- Al lado de cada objeto sale la defensa que da, que es lo que conecta la build
  con lo que tienes enfrente. Los nombres van en inglés, como en el juego.

Si un día la descarga de builds falla, el botón simplemente no aparece y el
resto de la app funciona igual.

## 1.10.0

Repaso estadístico a "Tu maestría", que desde 1.9.0 pesa más porque las
partidas apuntadas también la alimentan. Dos cosas estaban mal.

- **Tu maestría se mide contra TU nivel, no contra el 50%.** Ganas el 53,4% de
  tus partidas. Un héroe jugado a esa media exacta no es mejor que uno que no
  has tocado nunca: es exactamente lo tuyo. Pues puntuaba 0,64 contra 0,50, o
  sea que la app **premiaba tener datos apuntados** en vez de ser bueno con el
  héroe. Y un héroe al 50%, que para ti es de los peores, salía neutro. Ahora
  por encima de lo tuyo sube, por debajo baja, y a tu media empata con un héroe
  desconocido.
- **Cuánto se fía de pocas partidas ya no es un número inventado.** Cinco
  partidas al 90% puntuaban 0,87, casi el tope: cualquier racha de dos tardes
  te reordenaba las recomendaciones. El valor que había equivalía a suponer que
  tu winrate varía ±11 puntos entre héroes — o sea, del 42% al 64%. Ahora se
  **mide de tus propios datos**: cuánto varía de verdad tu winrate de un héroe a
  otro, descontando lo que explica el azar. Con una maestría como la tuya sale
  ±4 puntos. Cinco partidas al 90% ahora puntúan 0,56, y cuatrocientas siguen
  puntuando alto.
- **La cuenta de "partidas que faltan" pedía casi cuatro veces de más.** Usaba
  la fórmula de comparar dos muestras, cuando lo que se compara es una muestra
  contra tu winrate de siempre — que sale de miles de partidas y no hay que
  pagarlo dos veces. Decía 178 donde son **39**.

En 2.500 drafts simulados esto cambia el héroe recomendado en el 21,8% de los
casos, y hace la app **menos** repetitiva: el héroe más frecuente baja del 15,8%
al 12,3%.

## 1.9.0

- **Botón "Partidas": ves todas las que llevas apuntadas.** Con su fecha, el
  héroe, si ganaste y si seguiste la recomendación. Si te equivocaste al
  apuntar, puedes **cambiar el resultado** (⇄) o **quitarla** (×).
- **Puedes meter partidas de tu historial del juego.** Es lo que hace que la app
  te conozca antes: cada partida que metas cuenta para tu maestría, y la
  maestría es el 15% de la recomendación.
- **Y esto es lo importante: apuntar partidas ahora personaliza de verdad.**
  Hasta ahora el registro y "Tu maestría" eran dos cosas que no se hablaban —
  podías llevar cincuenta partidas apuntadas y la recomendación no se enteraba.
  Ahora el motor usa las dos: de cada héroe, la que tenga más partidas. No se
  suman, se elige: si escribiste 3.821 partidas de Diggie a mano, esas ya
  incluyen las que apuntes ahora.
- Las partidas de tu historial **no** cuentan para comprobar si la app acierta,
  y es a propósito: cuando las jugaste no había ningún consejo que seguir ni que
  ignorar. Si contaran, meter cien partidas viejas llenaría la comparación con
  tu winrate de siempre y dejaría de decir nada.
- Dos partidas apuntadas en el mismo segundo compartían identificador, así que
  borrar una se llevaba las dos. Pasaba justo al meter varias del historial
  seguidas, que es a toques rápidos.

## 1.8.1

- La app no declaraba icono de pestaña, así que el navegador pedía
  `/favicon.ico` en cada carga y se llevaba un 404. Ahora usa el icono que ya
  existía para la app instalada.

## 1.8.0

- **Tu perfil, para llevarte tus datos a otro dispositivo.** Botón nuevo: te da
  un código, lo copias del móvil y lo pegas en el ordenador. Y ya tienes allí tu
  maestría y tus partidas.
  Sin cuenta, sin contraseña y sin servidor: tus datos caben en el propio código
  (unos 500 caracteres), así que viajan por donde tú los mandes — un WhatsApp a
  ti mismo, un correo, lo que sea. Siguen sin pasar por ningún sitio nuestro.
  **Al traerlos se juntan con lo que ya haya, nunca se sustituye.** Si juegas en
  los dos sitios, ninguna de las dos copias pierde nada: de cada héroe se queda
  la versión con más partidas, y las partidas se mezclan sin repetirse. Puedes
  importar las veces que quieras y en los dos sentidos.
  Si el código se pega a medias, lo detecta y no importa nada. Eso es a
  propósito: media importación podría llevarse por delante miles de partidas.
- **La app guarda un historial de su propia salud.** Cada revisión automática
  (dos al día y tras cada publicación) anota sus cifras: cobertura, ruido de los
  datos, cruces de la matriz, edad de los datos, héroes por línea. Un informe
  suelto dice si hoy está bien; cien informes dicen qué se está moviendo, que es
  lo que sirve para decidir qué va en la versión siguiente. No lleva nada tuyo:
  son corridas automáticas contra lo publicado, sin móvil.

## 1.7.0

- **El Diagnóstico compara tus partidas contra algo alcanzable.** Hasta ahora
  decía "faltan 47 para poder comparar", y esa cuenta no se iba a completar
  nunca: la rama "por libre" solo crece si ignoras a la app **a propósito**, y
  nadie va a jugar peor 28 veces para rellenar una muestra. Ahora compara
  también tu winrate siguiendo la app contra **tu winrate de siempre**, que sale
  de la maestría — miles de partidas tuyas que ya existen. Esa sí se llena
  jugando normal.
  Te dice la diferencia con su margen ("+19,3 puntos ± 26,3") y cuántas partidas
  más harían falta para que deje de poder ser casualidad. El número no es un
  umbral inventado: sale del tamaño de la diferencia que estás viendo.
  La comparación siguiendo/por libre sigue ahí, pero ahora dice claramente para
  qué sirve y para qué no: tú eliges cuándo hacer caso, así que no es un
  experimento limpio.
- La cobertura de la matriz decía 99,2% teniéndola completa. Contaba a cada
  héroe contra sí mismo como un cruce que faltaba. Ahora dice 100%.
- Datos frescos: la API volvió esta mañana tras la caída de anoche.

## 1.6.1

- **Un fallo de la API ya no impide publicar la app.** El despliegue descargaba
  los datos y, si la descarga fallaba, se paraba entero — aunque el cambio no
  tuviera nada que ver con los datos. Pasó de verdad: la 1.6.0 se quedó sin
  publicar porque la API estaba caída esa noche. Ahora, si la descarga falla o
  viene peor, se publica con los datos que ya hay guardados, que pasaron ese
  mismo filtro cuando se guardaron. Lo que sigue sin poder pasar es publicar
  datos rancios: por encima de 72 horas, o sin matriz de cruces, el despliegue
  se para igual.

## 1.6.0

Repaso a fondo de la estadística. Dos constantes del motor estaban puestas
contra una suposición que resultó ser falsa, y se han medido.

- **La app ya no castiga a los héroes poco jugados sin motivo.** Cuando miraba
  el cruce entre tu héroe y un enemigo, se fiaba menos si el enemigo se juega
  poco — la idea era que con menos partidas detrás el número es más tembloroso.
  Suena sensato y es falso: medido, los cruces de los héroes raros se mueven
  1,16 veces lo que los de los populares, y si de verdad fuera falta de muestra
  tendrían que moverse 2,65 veces. Además dos descargas separadas nueve minutos
  dan los mismos números con tres cienmilésimas de diferencia. La app estaba
  descontando diez veces más de lo que toca. Cambia el héroe recomendado en el
  14,5% de los drafts.
- **Las sinergias dejan de aplastarse.** El 5,3% de las parejas caía por debajo
  del mínimo de la escala, así que la peor combinación del juego (Chip con
  Lolita) y una mala del montón valían exactamente lo mismo. Ahora se recorta el
  1,1%, que son los cuatro casos extremos de verdad.
- **El Diagnóstico vigila las dos cosas.** Si la fuente de datos cambia de
  comportamiento y los números pasan a ser temblorosos, avisa en vez de dejar
  las constantes mal calibradas en silencio.

Y una corrección de lo que dije en 1.5.0. Escribí que solo una de las doce
reglas tácticas se veía en las partidas. **Estaba mal medido**: promediaba todos
los héroes con una etiqueta contra todos los que no, y si la etiqueta está
puesta a nueve héroes y solo la cumplen cuatro, el promedio los diluye.
Midiendo héroe por héroe, siete reglas encuentran más héroes de los que daría el
azar. Lo que está mal no es la regla: es la etiqueta. `anti_mobility` se lo
pierde a Obsidia, Hilda, Cyclops y catorce más.

Pero el hallazgo de verdad es otro: **las once reglas miden lo mismo**. La
ventaja de un héroe contra los que hacen dash y contra los que se lanzan encima
correlacionan a 0,93. No hay doce relaciones tácticas en el juego: hay una — a
quién te comes y quién te come — con los asesinos en un extremo y los supports
en el otro.

## 1.5.2

- **El buscador de héroes ya no te deja tirado.** Si lo que escribes no encaja
  con ningún nombre, ahora prueba con las letras en el orden que las has puesto
  aunque no estén pegadas: "Lyla" encuentra a Layla, "Tigral" a Tigreal,
  "Lucard" a Alucard. Solo entra cuando la búsqueda normal no devuelve nada, así
  que buscar como siempre sigue dando exactamente lo mismo. Pide tres letras: con
  dos, las letras sueltas encajan en casi cualquier nombre.

## 1.5.1

- **El Diagnóstico vuelve a decir la verdad.** Con la matriz completa daba tres
  fallos que no lo eran: seguía exigiendo que contra tres asesinos de dash la
  app propusiera un anti-dash, que es justo la creencia que el dato nuevo no
  sostiene. Ahora comprueba dos cosas mejores: que ante equipos enemigos
  opuestos cambie la lista de recomendados (no solo el primer nombre — un héroe
  puede ser la mejor respuesta a los dos), y que la nota de counter ordene igual
  que los cruces reales.

## 1.5.0

**La app deja de adivinar.** Hasta ahora, de cada 100 cruces posibles entre tu
héroe y un enemigo, la app tenía el dato real de 11. En los otros 89 decidía con
reglas que escribí yo a mano. Ahora tiene los 100.

- **17.556 cruces reales en vez de 1.330**, y lo mismo en sinergias. El dato
  estaba ahí desde siempre: la API tiene dos rutas para lo mismo y la app estaba
  pidiendo por la que devuelve cinco rivales por héroe en vez de los 132. Ahora
  la ingesta prueba las rutas candidatas y se queda con la que más trae, así que
  si vuelven a mover las cosas de sitio se entera sola.
- **Se nota mucho en lo que te recomienda.** En 3.600 drafts simulados, el héroe
  más repetido pasa de salir nº1 el 12% de las veces al 7%, y los héroes
  distintos que llegan a ser nº1 pasan de 85 a 105. Es decir: la app responde al
  draft que tienes delante en vez de repetir sus favoritos.
- **El aviso de "estás eligiendo a ciegas y este pick es castigable" vuelve a
  salir.** Estaba calibrado sobre los cinco cruces más extremos de cada héroe,
  que era todo lo que había; con la matriz entera, ningún héroe llegaba al
  umbral y el aviso no habría vuelto a aparecer nunca sin que nada fallara.
  Ahora sale en el 23% de los drafts.
- **La sinergia se lee en los dos sentidos.** Llevar a A con B es lo mismo que
  llevar a B con A, pero la app solo miraba un lado y se dejaba el 37% de los
  datos. Cambia el héroe recomendado en 1 de cada 10 drafts.
- **Ya no propone banear a quien salta encima de tu tanque.** Un tanque está
  etiquetado como "inmóvil", así que la app lo trataba como si hubiera que
  protegerlo. Era el 12% de los avisos de peligro. Al tanque le saltan encima a
  propósito: para eso está.
- El registro de partidas no se descuadra si la API cambia cómo escribe el
  nombre de un héroe. Tus partidas viven meses en el móvil y una partida vieja
  no puede cambiar de bando.
- El fichero de datos ocupa la mitad de lo que ocuparía y su diff se lee: una
  línea por héroe en vez de una por número.

Una cosa que descubrí de camino y te interesa saber: ahora que hay dato de
todos los cruces se pueden **medir las doce reglas tácticas** que llevo escritas
a mano. Solo una se ve en las partidas — la de cortar dashes, y por cuatro
décimas de punto. Las otras once no se distinguen del ruido. No las he borrado,
porque el dato de la API es de "estar en la misma partida" y no del duelo de
carril, así que diluye los efectos reales; pero deja claro que el motor no
debería apoyarse en ellas, y ya no lo hace: solo entran cuando se trata de un
héroe tan nuevo que la API aún no publica ni un cruce suyo.

## 1.4.0

- **Eligiendo pronto, te propone héroes que no te puedan castigar.** Ya lo hacía
  un poco; ahora el doble. Con un solo enemigo en pantalla, lo castigable que es
  el héroe recomendado baja de 0,48 a 0,38 en la escala de la app: una quinta
  parte menos de exposición. Y con los cinco enemigos ya elegidos esto no
  interviene para nada — ahí ya no te puede contrapickear nadie, así que la app
  va al counter y punto. Medido en 1.200 drafts por fase, sin que la app se
  cierre en unos pocos héroes (el líder sale en el 10,4% con un enemigo, igual
  que antes).

Lo que probé y NO subí, por si te lo preguntas: bajar el peso del counter
cuando se ve poco del equipo rival. Suena razonable y es falso — los enemigos
que faltan son desconocidos para todos los héroes por igual, así que no
favorecen a ninguno. Al medirlo, no hacía a los picks más seguros y reducía los
héroes distintos que la app llega a recomendar de 85 a 65. Lo que de verdad
cambia entre elegir pronto y tarde es que los que faltan te eligen a ti en
contra, y eso es justo lo que sí se ha reforzado.

## 1.3.0

- **La app ya mira de qué pega tu equipo.** Es el aviso de draft más repetido en
  MLBB y no lo tenía: si los cinco pegáis físico, al rival le basta con comprar
  armadura y os apaga a todos. Ahora, cuando llevas tres aliados elegidos y
  todos pegan del mismo lado, te lo dice — y si el héroe que te recomienda mete
  el daño que falta, te lo dice también, que es una razón para cogerlo.
  Además cuenta a la hora de recomendar: entre dos héroes parecidos, gana el
  que tapa el hueco. Medido en 3.000 drafts: el nº1 tapa el hueco el 64% de las
  veces, antes el 57%, y sin que la app se cierre en unos pocos héroes.
- **De qué pega cada héroe no lo decide su rol, lo dice el juego.** Sale del
  texto de las habilidades que publica Moonton, así que acierta los raros: Gusion
  es asesino y pega mágico, Hylos es tanque y pega mágico, Natan y Kimmy son
  tiradores y pegan mágico, Esmeralda pega de las dos cosas. Por el rol, los
  cuatro estarían mal. Los 133 tienen el dato.
- **Buscar "Cíclope" ya encuentra a Cyclops.** El juego en español traduce
  algunos nombres y el buscador solo miraba el inglés. Ahora acepta los dos, con
  tilde o sin ella. Van Cíclope, Minotauro, Urano, Maya, Silvana, Popol y Kupa,
  Ángela y Yi Sun Shin. Lo que se ve en pantalla sigue en inglés a propósito: es
  la clave de todos los datos, y cambiarla escondería fallos. Si te encuentras
  otro nombre que no aparece al buscarlo, dilo y se añade.

## 1.2.1

- **La app ya no puede publicarse con los datos a medias.** La descarga de datos
  se rompe en silencio a propósito: si la API falla, conserva lo anterior y
  sigue. El problema es que nadie comprobaba si lo nuevo era peor que lo
  guardado, y ya había pasado: una corrida dejó a los 133 héroes sin línea y sin
  rol, y los cruces de 133 héroes a 34. Con esos datos, cuatro de las cinco
  líneas se quedan sin héroes que recomendar y la app no tiene de qué quejarse.
  Ahora una corrida que resuelva menos que la anterior se descarta y el
  despliegue se para, que es lo correcto: te quedas con la app de antes
  funcionando.
- El aviso de "cuidado con" lee los cruces en las dos direcciones, como el resto
  del motor. Ve un tercio más de datos, aunque en la práctica el aviso sale casi
  las mismas veces: lo que se ganaba estaba casi todo del lado bueno.
- En inglés ya no se cuelan seis textos en español (el "Ver por qué" del
  diagnóstico y las etiquetas de accesibilidad de los botones).

## 1.2.0

La app se abre al público.

- **Español e inglés.** Coge el idioma del móvil y se puede cambiar abajo. Sin
  inglés la app no le sirve a la mayoría de la gente que juega a esto.
- **Aviso de no afiliación**: es un proyecto de aficionado, sin relación con
  Moonton, y ahora lo dice.
- **Nota de privacidad**: tus datos no salen de tu móvil. No hay cuentas, ni
  servidor, ni seguimiento. Es verdad desde el primer día, pero convenía
  decirlo.
- Hueco para un enlace de donación, vacío hasta que haya uno de verdad.
- El diagnóstico sigue en español: es una herramienta de depuración, y
  traducirlo era menos urgente que traducir lo que se ve al usar la app.

## 1.1.0

- **Dos o tres frases sobre tu draft**, arriba del todo: si ganas tu cruce,
  quién te va a doler de verdad, si estás eligiendo a ciegas y si al equipo le
  falta algo. Habla de la línea que juegues.
- Cuando hay matchup de la pareja lo usa, que es el dato bueno. Cuando no lo
  hay —y no lo hay casi nunca: la API cubre el 11% de los cruces— compara los
  winrates sueltos, y lo dice con otras palabras para no vender una cosa por
  otra.
- **Un 47% más de matchups reales.** La API da los cruces en un sentido o en
  otro, y cuando da los dos suman exactamente 1. Usar la vuelta cuando falta la
  ida sube la cobertura del 7,6% al 11,2%, sin inventar nada. Ahora el riesgo
  de contrapick se puede calcular para el 100% de los héroes de las cinco
  líneas.

## 1.0.0

La app deja de ser solo para roam. Ahora se llama **Mobile Legends Pick Assist**
y sirve para las cinco líneas.

- **Eliges tu línea al abrirla** y la app recomienda para ESA: roam, jungla,
  mid, gold o exp. Se pregunta una vez y se recuerda; se cambia desde «Baneos y
  ajustes».
- **Los pools no están escritos a mano**: salen de en qué línea se juega de
  verdad cada héroe, según la API. Roam 37, jungla 37, mid 29, gold 21, exp 40.
  Un héroe que se juega en dos líneas sale en las dos, que es lo correcto.
- **«El roamer enemigo pesa el doble» pasa a ser «tu rival de línea pesa el
  doble»**. Si juegas mid, el que te importa es su mediocarril. Con el mismo
  draft enemigo la app ya señala a un rival distinto para cada línea.
- **Counters de los 133 héroes**, no solo de los 35 roamers. Cobertura del 100%
  en las cinco líneas. Eso alarga la descarga de datos de 1 a 3 minutos y engorda
  el fichero de 139 a 199 KB, que es el precio de que sirva para cualquier rol.
- El diagnóstico comprueba **las cinco líneas**. Y es honesto con lo que no
  aplica: en gold no hay ni un anti-dash, así que ahí no lo exige en vez de
  fallar para siempre.
- Tu maestría y tus partidas **no se pierden**: siguen guardadas donde estaban.

## 0.9.0

- **La app se vigila sola.** Dos veces al día, y después de cada despliegue, una
  comprobación automática ejecuta el mismo diagnóstico del botón contra lo que
  la app está sirviendo de verdad. Si algo falla, abre una incidencia en GitHub
  con el informe entero dentro. Si vuelve a estar sano, la cierra.
- Botón **"A GitHub"** en el diagnóstico: abre el formulario de incidencia ya
  relleno con el informe. Un toque para confirmar, y sin ninguna credencial
  dentro de la app.
- **Mantenimiento los lunes**: si Moonton saca héroes nuevos, avisa; si las
  tablas de deducción se han quedado viejas, las regenera, pasa las pruebas y
  deja un pull request. Lo que necesita criterio —escribirle los tags a un
  héroe mirando sus habilidades— no lo toca nadie automáticamente.
- `npm run diagnostico` hace lo mismo desde Termux, contra lo publicado o con
  `--local` contra tus datos.

## 0.8.0

- **Botón "Apuntar partida"**: dos toques al acabar —con quién jugaste y si
  ganaste— y la app lo guarda. Se marca cuáles eran sus recomendaciones, así
  que con el tiempo podrá responder a la única pregunta que importa: ¿ganas más
  cuando le haces caso?
- El diagnóstico trae una sección **TUS PARTIDAS** con tu winrate siguiendo la
  recomendación y por libre, y cuántas faltan para que esa comparación
  signifique algo. No es un aviso: no hay nada que arreglar, solo que aún no
  has jugado bastante.
- Hasta ahora esto no existía. La nota de "cuando tengas unas 30 partidas de
  cada tipo" llevaba tiempo dando por hecho que se estaban apuntando, y no se
  apuntaba ninguna.

## 0.7.0

- Los 7 héroes que quedaban sin tags propios ya los tienen escritos: Marcel,
  Hirara, Sora, Zetian, Obsidia, Cici y Valir. **El catálogo cubre los 133**.
- No están puestos a ojo: salen de la descripción de sus habilidades, que la
  propia API publica. Un par de correcciones que el rol por defecto no podía
  ver: Marcel no cura nada (le sobraba `sustain`) y Obsidia no es inmóvil
  (tiene un tirón y un parpadeo).
- Al tener tags escritos, esos siete dejan de arrastrar el descuento por
  deducción. Medido sobre 300 drafts con datos reales, la recomendación apenas
  se mueve: el líder pasa del 41% al 39%.
- Tablas de deducción regeneradas con el catálogo ampliado. Ya no se aplican a
  nadie —los 133 tienen tags propios— pero quedan listas para el héroe que
  salga mañana.

## 0.6.0

- Los héroes que no están en el catálogo escrito a mano ya no dependen solo de
  los tags genéricos de su rol: la app traduce la etiqueta que Moonton le pone a
  cada héroe ("Guard", "Initiator", "Regen"…) a sus propios tags. Medido sobre
  los 126 héroes que sí tienes etiquetados, acierta el 52,5% de sus tags reales
  en vez del 39,6%, sin perder precisión.
- La traducción no está escrita a ojo: la deriva `scripts/derivar-tags.mjs`
  del propio catálogo, y se puede reejecutar cuando Moonton cambie sus
  etiquetas.
- Un filtro impide que una correlación se cuele como propiedad: casi todos los
  héroes con "Crowd Control" son tanques, así que sin él una maga con control
  salía marcada como primera línea y la composición se creía cubierta.
- Lo que sale de tags deducidos pesa menos que lo escrito a mano, en la misma
  proporción en que acierta. Sin eso, Marcel salía nº1 en el 69% de 300 drafts
  simulados —frente al 43% del líder anterior— solo por tener seis tags
  adivinados: el mismo sesgo por acumular etiquetas que ya costó una corrección
  con Carmilla. Con el descuento, la concentración se queda en el 42% de
  siempre y la recomendación solo cambia en el 7% de los drafts.
- Las dependencias quedan fijadas con lockfile: el despliegue instala versiones
  exactas y no puede colarse sola una versión nueva rota.
- La prueba de la ingesta ya corre de verdad sin red. Decía hacerlo, pero
  `--base` no se respetaba al descubrir rutas y acababa haciendo una ingesta
  completa contra la API real: más de un minuto y cuarenta peticiones en cada
  despliegue. Ahora tarda nueve segundos.

## 0.5.1

- Las recomendaciones avisan con un "tags de su rol" cuando el héroe no está en
  el catálogo escrito a mano y juega con los tags genéricos de su rol. Hoy le
  toca a Marcel, que acaba de entrar al pool.

## 0.5.0

- La ingesta ya lee el **rol y la línea** de los 133 héroes. Antes salían vacíos
  para todos, y eso tenía dos efectos invisibles: los héroes que no están en el
  catálogo escrito a mano se quedaban sin ningún tag (no con los de su rol, como
  se creía), y la detección del roamer enemigo perdía su señal principal.
- **Marcel entra al pool de roam**: es support de roam según la API y la app no
  lo ofrecía nunca. El pool pasa de 34 a 35.
- La ingesta pide counters a los mismos roamers que la app recomienda. Antes
  usaba solo el catálogo escrito a mano, así que un roamer nuevo entraba en las
  recomendaciones sin datos de matchup.
- Arreglado un fallo que llenaba el diagnóstico de cuatro errores falsos
  (`Cannot read properties of undefined`) y, al llegar al tope de errores,
  ocultaba los de verdad.
- El aviso de cobertura de counters ya no salta siempre. Exigía un 25% cuando el
  techo real de la API es el 7,5%: ahora avisa si la descarga se queda corta.

## 0.4.0

- Vuelve a funcionar el **riesgo de contrapick**, que llevaba muerto desde que se
  añadió: devolvía `null` para los 34 roamers porque las matrices de counters se
  indexaban solo en su primer nivel.
- El diagnóstico ya no anuncia un 0% de cobertura de cruces: era el mismo fallo.

## 0.3.1

- La prueba que ejecuta la ingesta de verdad ya no sobrescribe los datos
  publicados. Como las pruebas corren antes de compilar, su diagnóstico
  degradado era el que acababa en la app: decía que solo se había resuelto un
  rango cuando se resolvían los cuatro.

## 0.3.0

- Pie con la versión y la antigüedad de los datos, para saber desde el móvil si
  lo que estás viendo es lo que acabas de subir.
