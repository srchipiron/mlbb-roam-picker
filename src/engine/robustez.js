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
 * verdad conocida, con el rival de línea contando doble como en la app): en
 * roam, con dos enemigos vistos, si el nº1 mantiene al menos la mitad de los
 * finales sobrevive al draft completo el 71%; si no, el 28%. Con tres, 62%
 * frente a 26%. Con cuatro, 71% frente a 31%. Con UNO visto casi nada es
 * robusto (14 de 200), que es la verdad: con un enemigo, espera. En la exp,
 * parecido (68/25 con dos vistos).
 *
 * Dos cosas que hacen falta para que el final simulado se parezca al real:
 * los BANEADOS no salen por ninguna línea ni son candidatos tuyos (la app ya
 * los quita del ranking; sin quitarlos aquí la simulación votaba a un héroe
 * que no se enseña y llamaba "frágil" al nº1 de verdad), y si tu línea está
 * abierta, el que sale por ella en ese final es tu RIVAL y su cruce pesa
 * doble. Medido: con el rival dentro, "pick seguro" acierta más (roam con tres
 * vistos 55%→62%, exp con dos vistos 61%→68%) a cambio de decirlo menos.
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
 *
 * mulberry32, no un congruencial: el de antes (s·1103515245+12345 mod 2³¹)
 * tiene correlación serial (−0,011 a un paso) y, medido con datos
 * sintéticos, desplazaba de forma sistemática lo que se estima con él
 * (+0,034 en un intercepto conocido, 8 semillas × 20.000 puntos). Aquí
 * cada final se muestrea con varias extracciones seguidas, así que la
 * correlación entre extracciones consecutivas sesga los finales.
 */
export function generador(semilla) {
  let a = (semilla >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
 * @param ctx             lo mismo que recibe rankRoamers (meta, mastery, bans, enemyRoam...)
 * @param linea           tu línea: si está abierta, el que salga por ella es tu rival
 * @returns { cuota: { nombre: 0..1 }, lider, cuotaLider, n, lineasAbiertas } o null
 */
export function simularFinales({
  pool, enemies = [], allies = [], lineasAbiertas = [], poolsPorLinea = {},
  ctx = {}, linea = null, n = FINALES_POR_DEFECTO, semilla = 7,
}) {
  const abiertas = lineasAbiertas.filter((l) => LINEAS.includes(l) && poolsPorLinea[l]?.length);
  if (!pool?.length || !enemies.length || !abiertas.length) return null;

  const rnd = generador(semilla);
  const pickRateDe = (h) => ctx.meta?.stats?.[normName(h.name)]?.pickRate ?? 0.001;
  // Un baneado no puede salir por ninguna línea, y tampoco es candidato tuyo:
  // el ranking de verdad ya lo quita (rankRoamers lee ctx.bans), y sin
  // quitarlo aquí la simulación votaba a un héroe que la app no enseña.
  const fijos = new Set([...enemies, ...allies, ...(ctx.bans ?? [])].map((h) => h.name));
  const votos = {};

  for (let k = 0; k < n; k++) {
    const excluidos = new Set(fijos);
    const completo = [...enemies];
    let rival = ctx.enemyRoam ?? null;
    for (const l of abiertas) {
      const h = muestrear(poolsPorLinea[l], excluidos, pickRateDe, rnd);
      if (!h) continue;
      excluidos.add(h.name);
      completo.push(h);
      // Si tu rival aún no se ve, en este final es el que sale por tu línea:
      // su cruce pesa doble en el ranking real, y sin esto la simulación lo
      // contaba como a uno más.
      if (!rival && l === linea) rival = h.name;
    }
    const top = rankRoamers(pool, { ...ctx, enemies: completo, allies, enemyRoam: rival })[0];
    if (top) votos[top.hero.name] = (votos[top.hero.name] ?? 0) + 1;
  }

  const cuota = Object.fromEntries(Object.entries(votos).map(([k, v]) => [k, v / n]));
  const [lider, cuotaLider] = Object.entries(cuota).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { cuota, lider, cuotaLider, n, lineasAbiertas: abiertas };
}
