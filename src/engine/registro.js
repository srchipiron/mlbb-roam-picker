import { normName } from './score.js';

/**
 * Registro de partidas.
 *
 * Existe para responder a la única pregunta que de verdad importa: ¿acertar el
 * roamer que recomienda la app hace ganar más? Hasta ahora no había forma de
 * saberlo, porque no se apuntaba nada.
 *
 * Se guarda lo mínimo: a quién cogiste, a quién recomendaba la app y si
 * ganaste. Con eso se puede comparar tu winrate cuando le haces caso y cuando
 * no, que es lo que decidiría si conviene tocar los pesos.
 */

/** Partidas mínimas de cada tipo antes de que los números signifiquen algo. */
export const MINIMO_PARA_CONCLUIR = 30;

/** Una partida nueva al principio de la lista. Se recorta para no crecer sin fin. */
export function apuntar(partidas, entrada, tope = 500) {
  // El instante ES la identidad de la partida: por ahí la quita y la corrige la
  // pantalla del historial, y por ahí se quitan las repetidas al fundir dos
  // perfiles. Dos partidas apuntadas en el mismo milisegundo compartirían
  // identidad, y borrar una se llevaría las dos. Pasa de verdad al meter varias
  // seguidas del historial del juego, que es a toques rápidos.
  const ocupados = new Set((partidas ?? []).map((p) => p.t));
  let t = entrada.t ?? Date.now();
  while (ocupados.has(t)) t += 1;

  const limpia = {
    t,
    pick: String(entrada.pick ?? '').trim(),
    recomendados: (entrada.recomendados ?? []).slice(0, 3),
    gane: !!entrada.gane,
    rango: entrada.rango ?? null,
    // La probabilidad que la app estimaba al apuntarla (0..1), si la había.
    // Es lo que permite calibrar el modelo contra lo que pasó de verdad.
    ...(typeof entrada.estimacion === 'number' && entrada.estimacion > 0 && entrada.estimacion < 1
      ? { estimacion: Math.round(entrada.estimacion * 1000) / 1000 } : {}),
    // Partida vieja, metida a mano del historial del juego. Cuenta para la
    // maestría y NO cuenta para comprobar si la app acierta: ver `esPrevia`.
    ...(entrada.previa ? { previa: true } : {}),
  };
  if (!limpia.pick) return partidas;
  return [limpia, ...partidas].sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, tope);
}

/** Partidas con estimación a partir de las cuales se dice algo de la calibración. */
export const MINIMO_PARA_CALIBRAR = 20;

/**
 * ¿La probabilidad estimada se parece a lo que pasa?
 *
 * Con cada partida apuntada se guarda la estimación que había delante. Aquí
 * se compara lo previsto con lo ocurrido: media prevista frente a winrate
 * real, y el Brier (error cuadrático medio; 0.25 es lo que saca una moneda,
 * y menos es mejor). Y discriminación: cuando la app daba ≥50%, ¿se ganó más
 * que cuando daba menos? Es lo mínimo que tiene que cumplir un modelo antes
 * de creerse su escala.
 *
 * Las previas quedan fuera: no tenían estimación delante.
 */
export function calibracion(partidas = []) {
  const con = partidas.filter((p) => !esPrevia(p) && typeof p.estimacion === 'number');
  const n = con.length;
  if (!n) return { n: 0, concluyente: false, faltan: MINIMO_PARA_CALIBRAR };
  const media = (lista, f) => lista.reduce((acc, p) => acc + f(p), 0) / lista.length;
  const ganada = (p) => (p.gane ? 1 : 0);
  const altas = con.filter((p) => p.estimacion >= 0.5);
  const bajas = con.filter((p) => p.estimacion < 0.5);
  return {
    n,
    prevista: media(con, (p) => p.estimacion),
    real: media(con, ganada),
    brier: media(con, (p) => (p.estimacion - ganada(p)) ** 2),
    brierMoneda: 0.25,
    altas: { n: altas.length, real: altas.length ? media(altas, ganada) : null },
    bajas: { n: bajas.length, real: bajas.length ? media(bajas, ganada) : null },
    concluyente: n >= MINIMO_PARA_CALIBRAR,
    faltan: Math.max(0, MINIMO_PARA_CALIBRAR - n),
  };
}

/** Quitar una partida apuntada por error. */
export function olvidar(partidas = [], t) {
  return partidas.filter((p) => p.t !== t);
}

/** Cambiar el resultado de una partida mal apuntada. */
export function corregir(partidas = [], t, gane) {
  return partidas.map((p) => (p.t === t ? { ...p, gane: !!gane } : p));
}

/**
 * ¿Es una partida de antes de usar la app?
 *
 * Importa mucho separarlas. Una partida vieja no tiene `recomendados`, así que
 * `siguioConsejo` diría que no y acabaría contada como "por libre". Pero jugar
 * sin la app abierta NO es ignorar su consejo: es que no había consejo. Si se
 * mezclan, meter cien partidas del historial del juego llenaría la rama "por
 * libre" con el winrate de siempre y la comparación diría exactamente nada.
 */
export const esPrevia = (p) => !!p?.previa;

/**
 * ¿El pick estaba entre lo que la app recomendaba?
 *
 * Comparado por nombre normalizado, no crudo. Estas partidas viven en el móvil
 * durante meses y la API ya ha cambiado la grafía de algún héroe ("X.Borg" /
 * "X Borg"): con la comparación cruda, una partida vieja pasaría de pronto a
 * contar como "por libre" y se falsearía el único dato con el que se puede
 * comprobar si la app acierta.
 */
export function siguioConsejo(partida) {
  const pick = normName(partida?.pick);
  if (!pick) return false;
  return (partida.recomendados ?? []).some((n) => normName(n) === pick);
}

/**
 * Tu winrate de referencia, sacado de la maestría.
 *
 * Es el número contra el que de verdad se puede comparar. La rama "por libre"
 * del registro nunca va a llenarse: para juntar 30 partidas ignorando a la app
 * habría que ignorarla 30 veces a propósito, o sea jugar peor durante meses
 * para satisfacer un umbral. La maestría, en cambio, ya son miles de partidas
 * tuyas de antes de que la app existiera.
 *
 * Ponderado por partidas: un héroe con 3.800 pesa lo que debe frente a uno con
 * 20.
 */
export function winrateDeReferencia(maestria = {}) {
  let partidas = 0;
  let ganadas = 0;
  for (const m of Object.values(maestria ?? {})) {
    if (!(m?.games > 0) || m.winRate == null) continue;
    partidas += m.games;
    ganadas += m.winRate * m.games;
  }
  return partidas ? { winRate: ganadas / partidas, partidas } : null;
}

/**
 * Cuántas partidas harían falta en total para distinguir del azar una
 * diferencia como la que se está viendo. No es un umbral inventado: sale del
 * tamaño del efecto observado.
 *
 * Es una comparación de UNA muestra contra una referencia CONOCIDA: tu winrate
 * de siempre sale de miles de partidas, así que su propio error es
 * despreciable y no hay que pagarlo dos veces.
 *
 *   n = [z(α/2)·√(p0(1-p0)) + z(β)·√(p1(1-p1))]² / (p1-p0)²
 *
 * al 5% y 80% de potencia (z = 1.96 y 0.84).
 *
 * La primera versión usaba la fórmula de DOS muestras y encima con el
 * coeficiente doblado: pedía 189 partidas donde hacen falta 50, casi cuatro
 * veces más. Que en algo pensado para animarte a apuntar partidas es
 * justamente el error que peor sienta.
 */
const Z_ALFA = 1.96;
const Z_POTENCIA = 0.84;

function partidasNecesarias(p, base) {
  const dif = Math.abs(p - base);
  if (!(dif > 0)) return Infinity;
  const t = Z_ALFA * Math.sqrt(base * (1 - base)) + Z_POTENCIA * Math.sqrt(p * (1 - p));
  return Math.ceil((t * t) / (dif * dif));
}

/**
 * Resumen para el diagnóstico.
 *
 * Da las dos comparaciones, y son distintas:
 *
 *  - Siguiendo la app contra por libre. Es la comparación limpia en teoría y la
 *    inalcanzable en la práctica, porque la segunda rama no se llena. Además
 *    NO está aleatorizada: tú eliges cuándo hacer caso, y si haces caso cuando
 *    el draft está claro y vas por libre cuando está feo, la diferencia mide
 *    eso y no la app. Se sigue enseñando, pero sabiendo lo que es.
 *
 *  - Siguiendo la app contra tu winrate de siempre. Esta sí se puede llenar:
 *    solo hace falta jugar, sin ignorar a la app a propósito. Tiene su propio
 *    pero -tu winrate histórico es de otros parches y quizá de otro rango-,
 *    pero es una referencia de miles de partidas en vez de dos.
 */
export function resumen(partidas = [], maestria = {}) {
  // Las partidas metidas del historial del juego no entran en ninguna de las
  // dos ramas: no hubo consejo que seguir ni que ignorar.
  const conApp = partidas.filter((p) => !esPrevia(p));
  const con = conApp.filter(siguioConsejo);
  const sin = conApp.filter((p) => !siguioConsejo(p));
  const wr = (lista) => (lista.length ? lista.filter((p) => p.gane).length / lista.length : null);

  const wrSiguiendo = wr(con);
  const referencia = winrateDeReferencia(maestria);

  let contraReferencia = null;
  if (wrSiguiendo != null && referencia && con.length >= 5) {
    // El error se calcula con la referencia, no con lo observado: es la prueba
    // de puntuación, que con pocas partidas se comporta mejor que la de Wald
    // -con 11 partidas al 100%, Wald daría un error de CERO y diría que se ve
    // clarísimo-.
    const p0 = referencia.winRate;
    const se = Math.sqrt(p0 * (1 - p0) / con.length);
    const dif = wrSiguiendo - referencia.winRate;
    contraReferencia = {
      base: referencia.winRate,
      partidasBase: referencia.partidas,
      dif,
      // Intervalo del 95% sobre TU winrate siguiendo la app. La referencia sale
      // de miles de partidas, así que su error propio es despreciable al lado.
      margen: 1.96 * se,
      seVe: se > 0 && Math.abs(dif) > 1.96 * se,
      faltan: Math.max(0, partidasNecesarias(wrSiguiendo, referencia.winRate) - con.length),
    };
  }

  return {
    total: partidas.length,
    previas: partidas.length - conApp.length,
    siguiendo: con.length,
    porLibre: sin.length,
    wrSiguiendo,
    wrPorLibre: wr(sin),
    referencia,
    contraReferencia,
    // Hace falta muestra en LAS DOS ramas: comparar 40 partidas contra 3 no
    // dice nada, y es justo el error que invita a tocar los pesos de más.
    concluyente: con.length >= MINIMO_PARA_CONCLUIR && sin.length >= MINIMO_PARA_CONCLUIR,
    faltan: Math.max(0, MINIMO_PARA_CONCLUIR - con.length) + Math.max(0, MINIMO_PARA_CONCLUIR - sin.length),
  };
}

/**
 * Tus partidas por héroe, en el formato de "Tu maestría".
 *
 * Aquí SÍ entran las previas: es justo para lo que sirven. Una partida vieja no
 * dice nada sobre si la app acierta, pero dice mucho sobre lo bien que llevas
 * a ese héroe, que es el 15% de la recomendación.
 */
export function maestriaDesdeRegistro(partidas = []) {
  const cuenta = new Map();
  for (const p of partidas) {
    const c = cuenta.get(p.pick) ?? { games: 0, wins: 0 };
    c.games++;
    if (p.gane) c.wins++;
    cuenta.set(p.pick, c);
  }
  return Object.fromEntries(
    [...cuenta.entries()].map(([name, c]) => [name, { games: c.games, winRate: c.wins / c.games }]),
  );
}

/**
 * La maestría que usa el motor: la escrita a mano MÁS la que sale de tus
 * partidas apuntadas.
 *
 * De cada héroe gana la fuente con más partidas, igual que al fundir perfiles.
 * No se suman: si escribiste "Diggie 3821" a mano, esas 3821 ya incluyen las
 * que estás apuntando ahora, y sumarlas sería contarlas dos veces.
 *
 * Lo que esto cambia de verdad: apuntar partidas deja de ser solo llevar la
 * cuenta y pasa a personalizar el motor. Antes el registro y la maestría eran
 * dos cosas que no se hablaban.
 */
export function maestriaEfectiva(maestria = {}, partidas = []) {
  const delRegistro = maestriaDesdeRegistro(partidas);
  const salida = { ...maestria };
  for (const [nombre, m] of Object.entries(delRegistro)) {
    const mano = salida[nombre];
    if (!mano || (m.games ?? 0) > (mano.games ?? 0)) salida[nombre] = m;
  }
  return salida;
}
