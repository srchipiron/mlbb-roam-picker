import { matchup, sinergia, normName, tuNivel, priorDeMaestria } from './score.js';

/**
 * ¿Cuánto hay de ganar esta partida, con estos diez?
 *
 * Un modelo aditivo en log-odds, que es lo más sencillo que se sostiene con
 * los datos que hay, y cada término está MEDIDO antes de sumarse:
 *
 *  - Héroes: la fuerza general de cada uno, logit(winrate) de los tuyos menos
 *    el de los suyos. Con σ≈3 puntos de winrate, el ruido de los otros nueve
 *    encoge el término un 2,5%: se desprecia.
 *  - Cruces: logit(counter[a][e]) de cada uno de los tuyos contra cada uno de
 *    los suyos. La matriz es antisimétrica alrededor de 0.5 (c[a][b]+c[b][a] =
 *    1.0000 en los 8.778 pares) y NO lleva dentro la fuerza de ninguno (r=0,009
 *    con la diferencia de winrates), así que se suma sin descontar nada. Se
 *    centra en 0.5, no en la media de la fila: centrar en 0.494 metía +0.6
 *    log-odds a favor del primer equipo, medido.
 *  - Parejas: logit(sinergia) de cada par de un equipo, centrado en la media
 *    de la matriz (0.4954: no es 0.5 y no es antisimétrica). Tampoco lleva la
 *    fuerza de los dos (pendiente 0.000 sobre wrA+wrB, r=0.000, medido).
 *  - Tú: si es tu héroe y tienes maestría, tu winrate con él encogido hacia
 *    lo que cabe esperar de TI con ese héroe (su winrate público más tu
 *    ventaja sobre el 50%), con el mismo prior que la maestría. Sustituye al
 *    término de héroe de tu pick, así que no se cuenta dos veces.
 *
 * Con drafts completos al azar la estimación cae entre el 30% y el 70% (p05 y
 * p95); el término de héroes pesa el doble que el de cruces (σ 0.41 frente a
 * 0.24 en log-odds) y el de parejas algo menos (0.19).
 *
 * Lo que NO es: una probabilidad calibrada. No hay resultados de partidas con
 * los que ajustar la escala, así que se enseña como estimación y la app se
 * calibra sola con las partidas que apuntas (`calibracion` en registro.js):
 * cada partida guarda la estimación que tenía delante, y el diagnóstico
 * compara lo previsto con lo que pasó.
 */

/** 0.1 en log-odds son ≈2,5 puntos alrededor del 50%. Para enseñar el desglose. */
const PUNTOS_POR_LOGIT = 25;

const logit = (p) => Math.log(p / (1 - p));
const sigmoide = (x) => 1 / (1 + Math.exp(-x));

/** Solo valores con sentido: fuera de (0,1) no hay logit y un 0 o 1 sería un dato roto. */
const valido = (p) => typeof p === 'number' && p > 0.02 && p < 0.98;

const mediasDeSinergia = new WeakMap();

/** Media de la matriz de parejas, calculada una vez por matriz. */
export function mediaDeSinergia(synergies) {
  if (!synergies || typeof synergies !== 'object') return 0.5;
  const cache = mediasDeSinergia.get(synergies);
  if (cache != null) return cache;
  let suma = 0;
  let n = 0;
  for (const fila of Object.values(synergies)) {
    for (const v of Object.values(fila ?? {})) {
      if (valido(v)) { suma += v; n += 1; }
    }
  }
  const media = n ? suma / n : 0.5;
  mediasDeSinergia.set(synergies, media);
  return media;
}

function terminoDeParejas(equipo, synergies, centro) {
  let total = 0;
  for (let i = 0; i < equipo.length; i++) {
    for (let j = i + 1; j < equipo.length; j++) {
      const s = sinergia(synergies, equipo[i].name, equipo[j].name);
      if (valido(s)) total += logit(s) - logit(centro);
    }
  }
  return total;
}

/**
 * @param allies   tus compañeros ya elegidos (sin ti)
 * @param yo       tu héroe (el candidato), o null
 * @param enemies  los suyos
 * @param meta     { stats, counters, synergies } ya indexados
 * @param mastery  tu maestría, para el término "tú"
 * @returns { p, logOdds, terminos: { heroes, cruces, parejas, tu }, puntos: {...}, vistos, completo } o null
 */
export function estimarVictoria({ allies = [], yo = null, enemies = [], meta = {}, mastery = null, nivel, prior } = {}) {
  const mios = yo ? [yo, ...allies.filter((h) => h.name !== yo.name)] : [...allies];
  if (!mios.length && !enemies.length) return null;
  const stats = meta.stats ?? {};
  const wrDe = (h) => stats[normName(h.name)]?.winRate ?? stats[h.name]?.winRate;

  // Héroes: la fuerza general de cada lado.
  let heroes = 0;
  for (const h of mios) { const w = wrDe(h); if (valido(w)) heroes += logit(w); }
  for (const h of enemies) { const w = wrDe(h); if (valido(w)) heroes -= logit(w); }

  // Tú: sustituye el winrate público de tu héroe por lo que cabe esperar de ti
  // con él. Sin maestría el término es cero y no cambia nada.
  let tu = 0;
  if (yo && mastery && Object.keys(mastery).length) {
    const w = wrDe(yo);
    if (valido(w)) {
      const base = nivel ?? tuNivel(mastery);
      const k = prior ?? priorDeMaestria(mastery, base);
      const m = mastery[normName(yo.name)] ?? mastery[yo.name];
      const esperado = Math.min(0.95, Math.max(0.05, w + (base - 0.5)));
      const games = m?.games > 0 && m.winRate != null ? m.games : 0;
      const propio = games ? (m.winRate * games + esperado * k) / (games + k) : esperado;
      tu = logit(propio) - logit(w);
    }
  }

  // Cruces: cada uno de los tuyos contra cada uno de los suyos.
  let cruces = 0;
  for (const a of mios) {
    for (const e of enemies) {
      const c = matchup(meta.counters, a.name, e.name);
      if (valido(c)) cruces += logit(c);
    }
  }

  // Parejas: las tuyas suman, las suyas restan.
  const centro = mediaDeSinergia(meta.synergies);
  const parejas = terminoDeParejas(mios, meta.synergies, centro) - terminoDeParejas(enemies, meta.synergies, centro);

  const terminos = { heroes, cruces, parejas, tu };
  const logOdds = heroes + cruces + parejas + tu;
  const puntos = Object.fromEntries(Object.entries(terminos).map(([k, v]) => [k, Math.round(v * PUNTOS_POR_LOGIT)]));
  return {
    p: sigmoide(logOdds),
    logOdds,
    terminos,
    puntos,
    vistos: mios.length + enemies.length,
    completo: mios.length === 5 && enemies.length === 5,
  };
}
