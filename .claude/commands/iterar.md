# Iteración de mejora del repositorio

Argumentos recibidos: `$ARGUMENTS`

Modo: **ejecutar**, salvo que en los argumentos ponga `analizar` (entonces te detienes al final de la fase 3 y me presentas el plan).

Actúas como ingeniero principal, arquitecto, revisor, QA y responsable de calidad del sistema. Este prompt se ejecuta muchas veces: en cada corrida analizas el estado ACTUAL del repositorio, incluidas las iteraciones anteriores, y decides qué merece mejorarse AHORA. No des por buenas las decisiones anteriores porque ya estén implementadas; tampoco cambies nada porque pueda escribirse de otra forma.

**`CLAUDE.md` es la fuente de verdad del proyecto.** Léelo entero antes de nada. Ahí están las reglas de trabajo, los invariantes, las decisiones medidas y los errores ya cometidos. Este prompt no los repite: si algo de aquí contradice a `CLAUDE.md`, manda `CLAUDE.md` y me lo dices.

---

## Fase 1 — Entender (sin tocar nada)

Antes de proponer un solo cambio, construye un modelo mental del sistema completo:

- arquitectura y flujo de datos, de la ingesta a la pantalla;
- motor de decisión y sus constantes: por qué existe cada una y qué prueba la protege;
- tests: qué cubren de verdad y qué solo parecen cubrir;
- todos los workflows de CI (no solo los principales): qué ejecutan, qué commitean, qué despliegan;
- persistencia local, caché, service worker y actualización;
- interfaz en móvil y autodiagnóstico;
- `git log` reciente y la sección **Candidatos descartados** de `CLAUDE.md`, para no volver a examinar lo ya medido.

Resultado de la fase: un resumen de diez líneas como máximo. No empieces por el primer fichero que te llame la atención.

## Fase 2 — Buscar

Clasifica cada hallazgo en una de estas categorías y prioriza en este orden:

- **A. Corrección** — evita un resultado incorrecto.
- **B. Robustez** — evita que una dependencia o condición inesperada rompa el comportamiento.
- **C. Calidad del modelo** — mejora la decisión con evidencia medible.
- **D. Validación** — hace detectable automáticamente un fallo que hoy es silencioso.
- **E. UX** — reduce errores o fricción real de uso en móvil.
- **F. Rendimiento** — reduce un coste relevante.
- **G. Mantenibilidad** — reduce deuda sin alterar comportamiento.

Mientras haya algo de A–D, no toques E–G.

**Los errores silenciosos son la prioridad máxima.** Busca a propósito situaciones donde el programa sigue funcionando pero:

- usa datos incorrectos, parciales o antiguos como si fueran buenos;
- una clave no coincide por diferencias de nombre, alias o profundidad de indexado;
- una normalización, clamp, umbral o encogimiento destruye información (o un factor global se anula al reescalar);
- un fallback oculta un fallo o hace que un test no pueda fallar;
- un dato derivado se trata como medido, o uno medido se descuenta como inferido;
- dos módulos representan la misma realidad con criterios distintos (dos normalizaciones, dos umbrales, dos definiciones de «disponible», dos formas de deducir lo mismo);
- una función admite contexto nuevo y algún consumidor no se lo pasa;
- una constante está calibrada contra una distribución o una fuente que ya no es la actual;
- una condición mira una cantidad cruda habiendo un estimado mejor de la misma cosa;
- un umbral duro sobre una cantidad que crece sola produce un salto al cruzarlo;
- la caché deja versión, datos y diagnóstico desincronizados;
- un workflow ejecuta código por una ruta que no pasa por los mismos guardarraíles.

**Trata los tests como sospechosos.** Para cada zona importante: ¿mide el comportamiento o un detalle de implementación? ¿Puede pasar con la funcionalidad rota? ¿Depende del orden de un fichero? ¿Espera de verdad lo asíncrono? ¿Hay alguna ruta de producción que no pase por él?

**Dependencias externas y CI.** La API externa no es fiable: busca respuestas parciales, cambios de esquema, rutas con menos datos que otras, pérdidas de cobertura, timeouts ausentes, bucles sin tope. Los workflows son código de producción: revisa `timeout-minutes`, `pipefail`, `continue-on-error`, temporales antes de sobrescribir, comparación contra lo guardado, `git pull --rebase`, propagación de errores, `workflow_run`, `cancel-in-progress`.

**Móvil real.** Evalúa la interfaz a 360–430 px: tamaños táctiles, desbordes, nombres largos, teclado abierto, dependencia de hover, CSS base pisando `@media`. No hay DevTools: todo fallo debe ser detectable por tests o por el autodiagnóstico.

## Fase 3 — Elegir

Elige **como máximo tres mejoras** que formen un conjunto coherente y quepan en un solo commit. Para cada una responde por escrito:

1. qué problema real resuelve;
2. qué evidencia hay de que existe y de que merece la pena (medida, test que falla, incidente, dato);
3. categoría A–G;
4. riesgo y qué invariante de `CLAUDE.md` roza;
5. cómo se verificará antes y después.

Si no puedes responder las cinco, no es un cambio: es un candidato descartado (va a la fase 5).

**Un resultado válido de esta iteración es no tocar código** y explicar qué se examinó y por qué nada superaba el listón.

**Semáforo.** Puedes hacer solo, sin consultar: tests de regresión, validaciones nuevas, arreglos de corrección con prueba, i18n, documentación. **Debes proponer y esperar mi confirmación** antes de: tocar pesos, constantes, umbrales o reglas del motor; cualquier cambio en persistencia, migraciones o claves guardadas; workflows que commiteen, hagan push o desplieguen; añadir dependencias; borrar código o compatibilidad histórica. En modo `analizar`, te detienes aquí siempre.

## Fase 4 — Ejecutar

1. Implementa el conjunto mínimo. Sin refactors ni renombrados no relacionados.
2. Para cada bug o riesgo arreglado, añade una prueba de regresión que **fallara antes** y pase después. Prueba propiedades e invariantes, no cómo está implementado ahora.
3. Si tocas el motor: mide antes y después con los scripts y simuladores existentes; comprueba concentración, estabilidad, sensibilidad, drafts parciales y completos. Sin evidencia de mejora, no se toca. No optimices para un ejemplo.
4. Toda constante nueva pertenece a una de estas categorías y lo dices en el código: definida por el dominio; derivada de una distribución medida; justificada experimentalmente; decisión explícita de producto. Si es calibrable con datos, calíbrala y busca sus gemelas en otros módulos.
5. Si cambias una función importante, recorre TODOS sus consumidores: motor, simulaciones, diagnóstico, interfaz, tests, scripts, workflows, importación/exportación.
6. Todo texto visible pasa por i18n, en los dos idiomas.
7. Ejecuta `npm test` completo más las comprobaciones específicas de lo tocado (scripts de medición, validación de ingesta, build, diagnóstico, workflows). Revisa `git diff` buscando cambios accidentales. Vuelve a pasar los tests tras cualquier corrección final.
8. Sube versión en `package.json` y escribe la entrada de `CHANGELOG.md` con el criterio del proyecto, pensada para quien USA la app: la primera frase dice QUÉ mejora.
9. Un commit, un push. Cada despliegue me cuesta minutos: no subas a medias. **Nunca subas con `npm test` en rojo.**

## Fase 5 — Cerrar

1. Añade a `CLAUDE.md`, en la sección **Candidatos descartados** (créala si no existe), una línea por cada cosa que examinaste y decidiste no tocar, con el motivo y la medida si la hay. Es lo que evita que la siguiente iteración repita el análisis.
2. Si el cambio corrige algo que llegó a producción, añádelo a la lista de errores ya cometidos de `CLAUDE.md`, con la lección en una frase.
3. Informe final, en español, legible en un móvil (25 líneas como máximo):
   - **Modelo del sistema**: qué entendiste que no estaba escrito.
   - **Hecho**: cada cambio con categoría, evidencia y cómo se verificó (números antes/después).
   - **No tocado y por qué**: candidatos descartados.
   - **Pendiente de tu decisión**: lo que el semáforo te impidió hacer.
   - **Siguiente iteración**: dónde mirarías primero.

---

## Específico de este proyecto (bórralo al reutilizar en otro repo)

- Las claves de `localStorage` que empiezan por `roam-picker:` no se renombran. `glory` es el rango por defecto.
- Yo trabajo solo desde el móvil con Termux: cualquier fallo que exija DevTools para verse es un fallo de validación.
- Para medir el motor existen `scripts/medir-reglas.mjs`, `medir-rival.mjs`, `medir-pro.mjs`, `comparar-ingesta.mjs` y los arneses de drafts en las pruebas. Úsalos antes de proponer un cambio del motor.
- Cualquier workflow que llame a la ingesta va en la lista del guardarraíl o no está protegido; cualquier bot que commitee va en `workflow_run` de `deploy.yml`.
