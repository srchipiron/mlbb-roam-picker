# Cambios

Sube la versión en `package.json` cuando cambies comportamiento y deja aquí una
línea explicando qué cambia **para quien usa la app**, no qué ficheros tocaste.
El despliegue falla si la versión que vas a publicar no tiene su entrada, así
que esto no se olvida.

Criterio: `0.X.0` cuando cambia cómo decide la app o qué hace; `0.0.X` para
correcciones.

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
