# Cambios

Sube la versión en `package.json` cuando cambies comportamiento y deja aquí una
línea explicando qué cambia **para quien usa la app**, no qué ficheros tocaste.
El despliegue falla si la versión que vas a publicar no tiene su entrada, así
que esto no se olvida.

Criterio: `0.X.0` cuando cambia cómo decide la app o qué hace; `0.0.X` para
correcciones.

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
