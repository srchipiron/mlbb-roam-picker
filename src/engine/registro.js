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
  const limpia = {
    t: entrada.t ?? Date.now(),
    pick: String(entrada.pick ?? '').trim(),
    recomendados: (entrada.recomendados ?? []).slice(0, 3),
    gane: !!entrada.gane,
    rango: entrada.rango ?? null,
  };
  if (!limpia.pick) return partidas;
  return [limpia, ...partidas].slice(0, tope);
}

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
 * Cuántas partidas más harían falta para distinguir del azar una diferencia
 * como la que se está viendo. No es un umbral inventado: sale del tamaño del
 * efecto observado.
 */
function partidasNecesarias(p, base) {
  const dif = Math.abs(p - base);
  if (!(dif > 0)) return Infinity;
  // n por grupo para 80% de potencia al 5%, aproximación normal habitual.
  return Math.ceil(15.7 * (p * (1 - p) + base * (1 - base)) / (dif * dif));
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
  const con = partidas.filter(siguioConsejo);
  const sin = partidas.filter((p) => !siguioConsejo(p));
  const wr = (lista) => (lista.length ? lista.filter((p) => p.gane).length / lista.length : null);

  const wrSiguiendo = wr(con);
  const referencia = winrateDeReferencia(maestria);

  let contraReferencia = null;
  if (wrSiguiendo != null && referencia && con.length >= 5) {
    const se = Math.sqrt(wrSiguiendo * (1 - wrSiguiendo) / con.length);
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

/** Tus partidas por héroe, en el formato de "Tu maestría". */
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
