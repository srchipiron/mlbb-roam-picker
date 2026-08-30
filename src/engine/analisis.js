import { normName, matchup } from './score.js';
import { TEAM_NEEDS } from './rules.js';

/**
 * Cuatro frases sobre el draft que tienes delante.
 *
 * No es un resumen de lo que ya se ve en las tarjetas: es lo que NO se ve.
 * Si tu matchup de carril lo ganas o lo pierdes, quién te va a hacer daño de
 * verdad, si estás eligiendo a ciegas y si al equipo le falta algo que tú no
 * aportas.
 *
 * Todo sale de datos que el motor ya ha calculado. Cuando no hay dato, se
 * calla: una frase inventada en 30 segundos de draft es peor que ninguna.
 */

/** Umbral a partir del cual un matchup deja de ser ruido y merece mencionarse. */
const MATCHUP_CLARO = 0.03;

const lookup = (map, name) => (map ? map[normName(name)] ?? map[name] : undefined);

/**
 * @returns [{ tono: 'bien'|'ojo'|'duda', texto }]
 */
export function analizarDraft({
  eleccion, ranked = [], enemies = [], allies = [], meta = {},
  rivalLinea = null, linea = 'roam', empate = [],
}) {
  const salida = [];
  const top = eleccion ?? ranked[0];
  if (!top) return salida;

  const hero = top.hero ?? top;
  const fila = lookup(meta.counters, hero.name);

  // 1. Tu carril. Es lo primero que quieres saber.
  //
  //    Primero se busca el matchup DE LA PAREJA, que es el dato bueno. Pero la
  //    API solo cubre un 11% de los cruces, así que casi nunca lo hay: medido,
  //    esta frase salía en el 2% de los drafts.
  //
  //    Cuando falta, se comparan los winrates sueltos de los dos héroes. Es
  //    peor información -dice quién está fuerte este parche, no quién le gana a
  //    quién- y por eso se dice con otras palabras, para no vender una cosa por
  //    otra.
  if (rivalLinea) {
    const par = matchup(meta.counters, hero.name, rivalLinea);
    if (par != null && Math.abs(par - 0.5) >= MATCHUP_CLARO) {
      const pct = Math.round(par * 100);
      salida.push(par > 0.5
        ? { tono: 'bien', texto: `Ganas el cruce: ${hero.name} va al ${pct}% contra ${rivalLinea}.` }
        : { tono: 'ojo', texto: `Pierdes el cruce: ${pct}% contra ${rivalLinea}. Juega a no morir pronto.` });
    } else {
      const mio = lookup(meta.stats, hero.name)?.winRate;
      const suyo = lookup(meta.stats, rivalLinea)?.winRate;
      if (mio != null && suyo != null && Math.abs(mio - suyo) >= 0.02) {
        const dif = Math.round(Math.abs(mio - suyo) * 100);
        salida.push(mio > suyo
          ? { tono: 'bien', texto: `Tu héroe está ${dif} puntos por encima de ${rivalLinea} este parche.` }
          : { tono: 'ojo', texto: `${rivalLinea} está ${dif} puntos por encima este parche. No le regales el carril.` });
      }
    }
  }

  // 2. Quién te va a hacer daño. El peor matchup entre los que YA están
  //    elegidos, no un enemigo hipotético.
  if (fila && enemies.length) {
    const peor = enemies
      .map((e) => ({ e, v: lookup(fila, e.name) }))
      .filter((x) => x.v != null && x.v < 0.5 - MATCHUP_CLARO)
      .sort((a, b) => a.v - b.v)[0];
    if (peor && peor.e.name !== rivalLinea) {
      salida.push({
        tono: 'ojo',
        texto: `Cuidado con ${peor.e.name}: es tu peor cruce del draft (${Math.round(peor.v * 100)}%).`,
      });
    }
  }

  // 3. ¿Estás eligiendo a ciegas? El riesgo ya lo calcula el motor; aquí solo
  //    se traduce a algo accionable.
  const porVer = 5 - enemies.length;
  if (porVer > 0 && top.riesgo != null && top.riesgo > 0.6) {
    salida.push({
      tono: 'duda',
      texto: `Les faltan ${porVer} picks y ${hero.name} es de los castigables. Si puedes, espera.`,
    });
  }

  // 4. Cuánto le saca al siguiente. Esto SIEMPRE se puede decir y es lo que
  //    de verdad decide si merece la pena pensárselo o coger y tirar.
  const segundo = ranked.find((r) => r.hero.name !== hero.name);
  if (segundo) {
    const brecha = Math.round((top.score - segundo.score) * 100);
    if (brecha >= 8) {
      salida.push({ tono: 'bien', texto: `${hero.name} le saca ${brecha} puntos al siguiente. Pick claro.` });
    } else if (empate.length > 1 && empate.some((x) => x.hero.name === hero.name)) {
      const otros = empate.map((x) => x.hero.name).filter((n) => n !== hero.name);
      if (otros.length) {
        salida.push({ tono: 'duda', texto: `Empatado con ${otros.slice(0, 2).join(' y ')}. Coge el que mejor lleves.` });
      }
    }
  }

  // 5. Un hueco que tú NO tapas. Con el filtro MUY apretado a propósito: sin
  //    él salía en el 98% de los drafts, y una frase que aparece siempre no
  //    informa de nada. Es el mismo error que ya costó filtrar los motivos que
  //    le salían a todo el pool.
  //    Solo con el equipo casi completo, y solo si falta algo de lo caro.
  if (allies.length >= 3) {
    const cubierto = new Set([...allies, hero].flatMap((h) => h.tags ?? []));
    const caros = [...TEAM_NEEDS].sort((a, b) => b.weight - a.weight).slice(0, 3);
    const falta = caros.find((n) => !cubierto.has(n.tag));
    if (falta) salida.push({ tono: 'duda', texto: `${falta.why[0].toUpperCase()}${falta.why.slice(1)}.` });
  }

  return salida.slice(0, 3);
}
