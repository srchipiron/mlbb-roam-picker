import { normName, matchup, perfilDeDano, tapaElHueco } from './score.js';
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

  // 1. Tu carril. Es lo primero que quieres saber.
  //
  //    Primero se busca el matchup DE LA PAREJA, que es el dato bueno. Desde
  //    1.5.0 lo hay SIEMPRE: la matriz viene completa. Aun así esta frase solo
  //    sale en el 4,9% de los drafts, y está bien que así sea: la mayoría de
  //    los cruces reales quedan a menos de tres puntos del empate, y decir
  //    "ganas tu carril al 51%" no es información, es ruido con formato.
  //
  //    Cuando el cruce está demasiado igualado -o el rival es un héroe recién
  //    salido, sin dato- se comparan los winrates sueltos de los dos. Es peor
  //    información -dice quién está fuerte este parche, no quién le gana a
  //    quién- y por eso se dice con otras palabras, para no vender una cosa por
  //    otra.
  if (rivalLinea) {
    const par = matchup(meta.counters, hero.name, rivalLinea);
    if (par != null && Math.abs(par - 0.5) >= MATCHUP_CLARO) {
      const pct = Math.round(par * 100);
      salida.push(par > 0.5
        ? { tono: 'bien', clave: 'analisis.ganasCruce', params: { yo: hero.name, pct, rival: rivalLinea } }
        : { tono: 'ojo', clave: 'analisis.pierdesCruce', params: { pct, rival: rivalLinea } });
    } else {
      const mio = lookup(meta.stats, hero.name)?.winRate;
      const suyo = lookup(meta.stats, rivalLinea)?.winRate;
      if (mio != null && suyo != null && Math.abs(mio - suyo) >= 0.02) {
        const dif = Math.round(Math.abs(mio - suyo) * 100);
        salida.push(mio > suyo
          ? { tono: 'bien', clave: 'analisis.tuWinrateMejor', params: { dif, rival: rivalLinea } }
          : { tono: 'ojo', clave: 'analisis.suWinrateMejor', params: { dif, rival: rivalLinea } });
      }
    }
  }

  // 2. Quién te va a hacer daño. El peor matchup entre los que YA están
  //    elegidos, no un enemigo hipotético.
  if (enemies.length) {
    // matchup() y no lookup(): mira las dos direcciones, igual que el resto
    // del motor. Con el lookup de una sola se perdía el 47% de los cruces que
    // la API sí tiene, solo que apuntados al revés.
    const peor = enemies
      .map((e) => ({ e, v: matchup(meta.counters, hero.name, e.name) }))
      .filter((x) => x.v != null && x.v < 0.5 - MATCHUP_CLARO)
      .sort((a, b) => a.v - b.v)[0];
    if (peor && peor.e.name !== rivalLinea) {
      salida.push({
        tono: 'ojo',
        clave: 'analisis.cuidadoCon',
        params: { e: peor.e.name, pct: Math.round(peor.v * 100) },
      });
    }
  }

  // 3. ¿Estás eligiendo a ciegas? El riesgo ya lo calcula el motor; aquí solo
  //    se traduce a algo accionable.
  const porVer = 5 - enemies.length;
  if (porVer > 0 && top.riesgo != null && top.riesgo > 0.6) {
    salida.push({
      tono: 'duda',
      clave: 'analisis.pickCiego',
      params: { n: porVer, yo: hero.name },
    });
  }

  // 3b. De qué pega vuestro equipo. Es el aviso de draft más repetido en MLBB:
  //     si los cinco pegáis físico, al rival le basta con comprar armadura.
  //     Sale del texto de habilidades de Moonton, no del rol.
  //
  //     Dos frases distintas a propósito: si el pick recomendado TAPA el hueco
  //     es una razón para cogerlo, y si NO lo tapa es un aviso. Decir lo mismo
  //     en los dos casos sería no decir nada.
  //
  //     Tres aliados, no dos, aunque el motor puntúe el hueco desde dos. La
  //     diferencia es a propósito: puntuar es un empujón, y ya va encogido por
  //     `confidence`; decir "tu equipo pega todo físico" es una AFIRMACIÓN, y
  //     dos héroes de cinco no la sostienen. Medido: con dos salía en el 35%
  //     de los drafts, con tres en el 11,6%.
  if (allies.length >= 3) {
    const { falta } = perfilDeDano(allies);
    if (falta) {
      const tapa = tapaElHueco(hero, falta);
      salida.push(tapa
        ? {
          tono: 'bien',
          clave: falta === 'magico' ? 'analisis.todoFisico' : 'analisis.todoMagico',
          params: { yo: hero.name },
        }
        : {
          tono: 'ojo',
          clave: falta === 'magico' ? 'analisis.faltaMagico' : 'analisis.faltaFisico',
          params: { yo: hero.name },
        });
    }
  }

  // 4. Cuánto le saca al siguiente. Esto SIEMPRE se puede decir y es lo que
  //    de verdad decide si merece la pena pensárselo o coger y tirar.
  const segundo = ranked.find((r) => r.hero.name !== hero.name);
  if (segundo) {
    const brecha = Math.round((top.score - segundo.score) * 100);
    if (brecha >= 8) {
      salida.push({ tono: 'bien', clave: 'analisis.pickClaro', params: { yo: hero.name, puntos: brecha } });
    } else if (empate.length > 1 && empate.some((x) => x.hero.name === hero.name)) {
      const otros = empate.map((x) => x.hero.name).filter((n) => n !== hero.name);
      if (otros.length) {
        salida.push({ tono: 'duda', clave: 'analisis.empatadoCon', params: { otros: otros.slice(0, 2).join(' / ') } });
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
    if (falta) salida.push({ tono: 'duda', clave: falta.why });
  }

  return salida.slice(0, 3);
}
