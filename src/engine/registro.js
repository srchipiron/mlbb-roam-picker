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
 * Resumen para el diagnóstico. Devuelve winrate cuando sigues la recomendación
 * y cuando no, con el aviso de si hay muestra suficiente para creérselo.
 */
export function resumen(partidas = []) {
  const con = partidas.filter(siguioConsejo);
  const sin = partidas.filter((p) => !siguioConsejo(p));
  const wr = (lista) => (lista.length ? lista.filter((p) => p.gane).length / lista.length : null);

  return {
    total: partidas.length,
    siguiendo: con.length,
    porLibre: sin.length,
    wrSiguiendo: wr(con),
    wrPorLibre: wr(sin),
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
