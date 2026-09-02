import { rankRoamers, normName, LINEAS } from './score.js';

/**
 * ¿Aguanta este pick lo que falta por salir?
 *
 * Con el draft a medias, la nota de cada héroe está calculada contra los
 * enemigos que SE VEN. Los que faltan van a salir por las líneas que quedan
 * abiertas, y de cada línea se sabe quién se juega y cuánto (pickrate). Así
 * que se simulan finales de draft plausibles -no al azar: por línea abierta y
 * ponderados por pickrate- y se cuenta en qué fracción de ellos cada héroe
 * sigue siendo el número uno.
 *
 * Lo que dice esa fracción está MEDIDO, no supuesto (200 drafts por caso,
 * verdad conocida): con dos enemigos vistos, si el nº1 mantiene al menos la
 * mitad de los finales, sobrevive al draft completo el 58%; si no, el 27%. Con
 * tres, 59% frente a 27%. Con cuatro, 72% frente a 39%. Con UNO visto casi
 * nada es robusto (4 de 200), que es la verdad: con un enemigo, espera.
 *
 * Lo que NO se hace con esto: cambiar el ranking. Medido, usar la simulación
 * para ordenar solo ayuda con un enemigo visto (+4-6 puntos) y no aporta nada
 * con dos o tres; cambiar de mecanismo en una sola fase sería un acantilado
 * entre el primer y el segundo enemigo. Se enseña como información: "es un
 * pick seguro" o "depende de lo que saquen".
 *
 * Se cuenta por VOTOS de nº1 y no por media de puntuaciones: la nota se
 * reescala dentro de cada draft, y promediar escalas distintas es justo el
 * fallo que ya se comió un encogimiento entero.
 */

/** Desde qué cuota el pick se llama "seguro". Es donde la medición separa. */
export const CUOTA_ROBUSTA = 0.5;

/** Finales simulados. Con 60 la cuota del líder se mueve ±6 puntos entre semillas. */
export const FINALES_POR_DEFECTO = 60;

/**
 * Generador determinista: mismas entradas, misma cuota. Sin esto el número
 * bailaría entre dos aperturas del diagnóstico y no se podría probar nada.
 */
function generador(semilla) {
  let s = semilla >>> 0 || 1;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function muestrear(pool, excluidos, pickRateDe, rnd) {
  const candidatos = pool.filter((h) => !excluidos.has(h.name));
  if (!candidatos.length) return null;
  const total = candidatos.reduce((acc, h) => acc + pickRateDe(h), 0);
  let x = rnd() * total;
  for (const h of candidatos) {
    x -= pickRateDe(h);
    if (x <= 0) return h;
  }
  return candidatos[candidatos.length - 1];
}

/**
 * @param pool            héroes de TU línea (los candidatos)
 * @param enemies         enemigos ya elegidos
 * @param allies          aliados ya elegidos
 * @param lineasAbiertas  líneas enemigas por las que aún falta alguien
 * @param poolsPorLinea   { linea: [héroes] } de dónde salen los que faltan
 * @param ctx             lo mismo que recibe rankRoamers (meta, mastery, enemyRoam...)
 * @returns { cuota: { nombre: 0..1 }, lider, cuotaLider, n, lineasAbiertas } o null
 */
export function simularFinales({
  pool, enemies = [], allies = [], lineasAbiertas = [], poolsPorLinea = {},
  ctx = {}, n = FINALES_POR_DEFECTO, semilla = 7,
}) {
  const abiertas = lineasAbiertas.filter((l) => LINEAS.includes(l) && poolsPorLinea[l]?.length);
  if (!pool?.length || !enemies.length || !abiertas.length) return null;

  const rnd = generador(semilla);
  const pickRateDe = (h) => ctx.meta?.stats?.[normName(h.name)]?.pickRate ?? 0.001;
  const fijos = new Set([...enemies, ...allies].map((h) => h.name));
  const votos = {};

  for (let k = 0; k < n; k++) {
    const excluidos = new Set(fijos);
    const completo = [...enemies];
    for (const l of abiertas) {
      const h = muestrear(poolsPorLinea[l], excluidos, pickRateDe, rnd);
      if (!h) continue;
      excluidos.add(h.name);
      completo.push(h);
    }
    const top = rankRoamers(pool, { ...ctx, enemies: completo, allies })[0];
    if (top) votos[top.hero.name] = (votos[top.hero.name] ?? 0) + 1;
  }

  const cuota = Object.fromEntries(Object.entries(votos).map(([k, v]) => [k, v / n]));
  const [lider, cuotaLider] = Object.entries(cuota).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { cuota, lider, cuotaLider, n, lineasAbiertas: abiertas };
}
