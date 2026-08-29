import {
  ROLE_DEFAULTS,
  COUNTER_RULES,
  DANGER_RULES,
  TEAM_NEEDS,
  MASTERY_CONFIDENCE_GAMES,
  DEFAULT_WEIGHTS,
} from './rules.js';

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Ventaja máxima que un roamer puede acumular contra un enemigo: 1.4 + 0.9/2. */
const SUB_MAX = 1.85;

/**
 * Clave normalizada de un nombre de héroe. La API y el catálogo escriben lo
 * mismo de formas distintas ("X.Borg" / "X Borg", "Yi Sun-shin" / "Yi Sun Shin",
 * "Chang'e" / "Change"), y un fallo aquí es invisible: el héroe simplemente se
 * queda sin datos y nadie se entera.
 */
export const normName = (name) =>
  String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')          // "Popol & Kupa" = "Popol and Kupa"
    .replace(/[^a-z0-9]/g, '');

/**
 * Reindexa {nombre: valor} por clave normalizada.
 * `depth` dice cuántos niveles de nombres hay: 1 para las estadísticas,
 * 2 para las matrices de counters y sinergias. Antes se adivinaba mirando si el
 * valor tenía winRate, y una estadística sin ese campo se rompía en silencio.
 */
export function indexByName(obj, depth = 1) {
  if (!obj) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[normName(k)] = depth > 1 ? indexByName(v, depth - 1) : v;
  }
  return out;
}

/**
 * Busca por clave normalizada y, si no, por el nombre tal cual. El respaldo
 * importa: si quien llama no normalizó el mapa, la versión anterior devolvía
 * "sin datos" en silencio y todos los héroes empataban a 0.50.
 */
const lookup = (map, name) => {
  if (!map) return undefined;
  return map[normName(name)] ?? map[name];
};

/**
 * Winrate crudo -> 0..1, encogido hacia 0.5 segun el tamaño de muestra.
 * Un heroe con 52% y 300 partidas vale mas que uno con 58% y 12 partidas.
 * Usa un shrink bayesiano simple (media a priori = winrate medio del parche).
 */
export function metaScore(stat, patchAvgWinRate = 0.5) {
  if (!stat || stat.winRate == null) return { value: 0.5, confident: false };

  // Muestra: partidas reales si la API las da. Muchas no las dan, y entonces
  // n=0 encogía TODOS los winrates a la media y el componente meta valía lo
  // mismo para todo el mundo. El pickrate sirve de proxy: un héroe con 3% de
  // presencia tiene mucha más muestra que uno con 0,2%.
  const n = stat.matches ?? (stat.pickRate != null ? stat.pickRate * 40000 : 1500);
  const prior = 400;
  const shrunk = (stat.winRate * n + patchAvgWinRate * prior) / (n + prior);

  // Centrado en la media del parche: ±6 puntos cubre casi todo el reparto.
  const value = clamp01((shrunk - (patchAvgWinRate - 0.06)) / 0.12);
  return { value, confident: n >= 200, shrunkWinRate: shrunk };
}

/**
 * Counter. Primero intenta el dato real de la API (winrate del heroe A contra B).
 * Si no existe para ese par, cae a las reglas por tags.
 */
export function counterScore(roamHero, enemies, counterMatrix, enemyRoamName = null) {
  if (!enemies.length) return { value: 0.5, reasons: [] };

  const reasons = [];
  let total = 0;
  let pesoTotal = 0;

  for (const enemy of enemies) {
    // El roamer rival es con quien más vas a chocar: su matchup pesa el doble.
    const peso = enemyRoamName && normName(enemy.name) === normName(enemyRoamName) ? 2 : 1;
    pesoTotal += peso;
    const pair = lookup(lookup(counterMatrix, roamHero.name), enemy.name);
    if (pair != null) {
      // pair = winrate de roamHero contra enemy (0..1). 0.50 es neutro.
      const delta = clamp01((pair - 0.44) / 0.12);
      total += delta * peso;
      if (pair >= 0.53) reasons.push({ text: `gana el matchup contra ${enemy.name}`, good: true, w: 1.2 });
      if (pair <= 0.47) reasons.push({ text: `pierde contra ${enemy.name}`, good: false, w: 1.3 });
      continue;
    }

    // Fallback por tags. Igual que en composición, contra un enemigo concreto
    // cuenta la ventaja más fuerte y media la segunda: sumarlas todas premiaba
    // al héroe con más etiquetas en el catálogo, no al que mejor le va.
    const positivas = [];
    let penalizacion = 0;
    for (const rule of COUNTER_RULES) {
      if (!enemy.tags.includes(rule.enemyTag) || !roamHero.tags.includes(rule.roamTag)) continue;
      const r = { text: rule.why(enemy.name), good: rule.weight > 0, w: Math.abs(rule.weight), kind: `${rule.enemyTag}>${rule.roamTag}` };
      reasons.push(r);
      if (rule.weight > 0) positivas.push(rule.weight);
      else penalizacion += rule.weight; // las desventajas sí suman: son avisos
    }
    positivas.sort((a, b) => b - a);
    const sub = (positivas[0] ?? 0) + (positivas[1] ?? 0) * 0.5 + penalizacion;
    // Escalado, no recortado. Con un multiplicador fijo la puntuación se pegaba
    // al tope: media plantilla marcaba 1.00 y dejaba de distinguir a quien corta
    // dashes de quien solo protege al carry. SUB_MAX es la ventaja máxima que
    // puede acumular un héroe (la mejor regla más media de la segunda).
    total += (0.5 + clamp01(sub / SUB_MAX) * 0.5) * peso;
  }

  return { value: total / pesoTotal, reasons: dedupe(reasons) };
}

/** Sinergia con aliados ya elegidos. Mismo patron: dato real, si no, tags. */
export function synergyScore(roamHero, allies, synergyMatrix) {
  if (!allies.length) return { value: 0.5, reasons: [] };
  const reasons = [];
  let total = 0;

  for (const ally of allies) {
    const pair = lookup(lookup(synergyMatrix, roamHero.name), ally.name);
    if (pair != null) {
      total += clamp01((pair - 0.46) / 0.10);
      if (pair >= 0.53) reasons.push({ text: `combina bien con ${ally.name}`, good: true, w: 0.7 });
      continue;
    }
    let sub = 0;
    // Un carry inmóvil pide peel; un dive aliado pide engage que lo acompañe.
    if (ally.tags.includes('immobile') && roamHero.tags.includes('peel')) {
      sub += 0.8;
      reasons.push({ text: `protege a ${ally.name}, que no tiene escape`, good: true, w: 0.8 });
    }
    if (ally.tags.includes('dive') && roamHero.tags.includes('engage')) {
      sub += 0.6;
      reasons.push({ text: `abre la pelea para ${ally.name}`, good: true, w: 0.6 });
    }
    if (ally.tags.includes('hypercarry') && roamHero.tags.includes('sustain')) {
      sub += 0.5;
      reasons.push({ text: `mantiene vivo a ${ally.name}`, good: true, w: 0.5 });
    }
    total += clamp01(0.5 + sub * 0.20);
  }

  return { value: total / allies.length, reasons: dedupe(reasons) };
}

/** Tags que cubren la misma necesidad: encadenar CC vale como control duro. */
const SATISFIES = {
  cc_hard: ['cc_hard', 'cc_chain'],
  peel: ['peel', 'shield', 'anti_dive'],
  sustain: ['sustain', 'heal'],
  engage: ['engage'],
  tanky: ['tanky'],
  vision: ['vision'],
};

const has = (hero, need) => (SATISFIES[need] ?? [need]).some((t) => hero.tags.includes(t));

/**
 * Huecos de composicion que rellena este roamer.
 *
 * Cuenta solo los DOS huecos más importantes que tapa, más medio punto por un
 * tercero. Sumar todos premiaba al héroe con más tags escritos en el catálogo:
 * Carmilla cubre cinco necesidades sobre el papel y salía primera en el 94% de
 * los drafts. Un roamer no arregla cinco agujeros él solo, así que la ventaja
 * por acumular etiquetas se corta aquí.
 *
 * Con pocos aliados elegidos, además, el resultado se acerca a neutro: sin eso,
 * un draft vacío premia al generalista y ya está.
 */
export function compScore(roamHero, allies) {
  const covered = new Set(allies.flatMap((a) => a.tags));
  const cubiertos = [];

  for (const need of TEAM_NEEDS) {
    if (!has(roamHero, need.tag)) continue;
    // Si un aliado ya lo cubre, no cuenta NADA. Antes daba un 35% y eso convertía
    // la composición en una nota fija de "lo completo que es el héroe", que apenas
    // cambiaba con el draft y duplicaba lo que ya mide el winrate.
    if ((SATISFIES[need.tag] ?? [need.tag]).some((t) => covered.has(t))) continue;
    cubiertos.push({ ...need, valor: need.weight });
  }

  cubiertos.sort((a, b) => b.valor - a.valor);
  const contados = cubiertos.slice(0, 3);
  const score = contados.reduce((acc, n, i) => acc + n.valor * (i < 2 ? 1 : 0.5), 0);

  // Techo: los dos huecos más valiosos del juego, más medio del tercero.
  const techo = [...TEAM_NEEDS].sort((a, b) => b.weight - a.weight)
    .slice(0, 3).reduce((acc, n, i) => acc + n.weight * (i < 2 ? 1 : 0.5), 0);

  const raw = clamp01(score / techo);
  const confidence = Math.min(1, allies.length / 3);
  return {
    value: 0.5 + (raw - 0.5) * (0.35 + 0.65 * confidence),
    reasons: allies.length
      ? contados.map((n) => ({ text: n.why, good: true, w: n.weight }))
      : [],
  };
}

/** Tu winrate personal, encogido con fuerza si llevas pocas partidas. */
export function masteryScore(roamHero, mastery) {
  const m = lookup(mastery, roamHero.name) ?? mastery?.[roamHero.name];
  if (!m || !m.games) return { value: 0.5, reasons: [] };
  const shrunk = (m.winRate * m.games + 0.5 * MASTERY_CONFIDENCE_GAMES) / (m.games + MASTERY_CONFIDENCE_GAMES);
  const value = clamp01((shrunk - 0.40) / 0.20);
  const reasons = [];
  if (m.games >= MASTERY_CONFIDENCE_GAMES && m.winRate >= 0.55) {
    reasons.push({ text: `lo llevas al ${Math.round(m.winRate * 100)}% en ${m.games} partidas`, good: true, w: 1.4 });
  }
  if (m.games >= MASTERY_CONFIDENCE_GAMES && m.winRate <= 0.45) {
    reasons.push({ text: `solo ${Math.round(m.winRate * 100)}% en ${m.games} partidas`, good: false, w: 1.4 });
  }
  return { value, reasons };
}

/**
 * Score final de un roamer para un estado de draft concreto.
 * Devuelve el desglose completo para poder pintar la barra del "por qué".
 */
export function scoreHero(roamHero, ctx) {
  const { enemies = [], allies = [], meta = {}, mastery = {}, weights = DEFAULT_WEIGHTS } = ctx;

  const parts = {
    meta: metaScore(lookup(meta.stats, roamHero.name), meta.patchAvgWinRate ?? 0.5),
    counter: counterScore(roamHero, enemies, meta.counters, ctx.enemyRoam),
    synergy: synergyScore(roamHero, allies, meta.synergies),
    comp: compScore(roamHero, allies),
    mastery: masteryScore(roamHero, mastery),
  };

  const total = Object.entries(weights).reduce(
    (acc, [key, w]) => acc + (parts[key]?.value ?? 0.5) * w,
    0,
  );

  // Ordena los motivos por relevancia y evita repetir tres veces al mismo enemigo:
  // en 30 segundos de draft solo se leen dos o tres etiquetas.
  const reasons = spread(
    dedupe([
      ...parts.mastery.reasons,
      ...parts.counter.reasons,
      ...parts.comp.reasons,
      ...parts.synergy.reasons,
    ]).sort((a, b) => (b.w ?? 0) - (a.w ?? 0)),
  );

  return {
    hero: roamHero,
    score: total,
    parts,
    contributions: Object.fromEntries(
      Object.entries(weights).map(([k, w]) => [k, (parts[k]?.value ?? 0.5) * w]),
    ),
    reasons: reasons.slice(0, 3),
    banned: false,
  };
}

/** Ordena todo el pool de roam para el estado actual del draft. */
export function rankRoamers(pool, ctx) {
  // Normalizado: un pick guardado con otra grafía seguiría apareciendo como
  // recomendación disponible aunque ya esté cogido.
  const taken = new Set([
    ...(ctx.enemies ?? []),
    ...(ctx.allies ?? []),
    ...(ctx.bans ?? []),
  ].map((h) => normName(h.name)));

  const resultados = pool
    .filter((h) => !taken.has(normName(h.name)))
    .map((h) => scoreHero(h, ctx));

  return resultados
    .sort((a, b) =>
      // Empate exacto: primero lo que mejor lleves, luego el winrate, y por
      // último el nombre. Sin esto el orden dependía del orden del catálogo.
      b.score - a.score ||
      b.parts.mastery.value - a.parts.mastery.value ||
      b.parts.meta.value - a.parts.meta.value ||
      a.hero.name.localeCompare(b.hero.name));
}

/** Un motivo por tipo de razón: repetir "bloquea los dashes de X" tres veces no informa. */
function spread(reasons) {
  const mentioned = new Set();
  const out = [];
  for (const r of reasons) {
    const key = r.kind ?? r.text;
    if (mentioned.has(key)) continue;
    mentioned.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Completa el catalogo con los heroes que solo conoce la API.
 * Marca los rellenados con `inferred` para poder avisarlo en la interfaz.
 */
export function mergeCatalog(catalogHeroes, apiHeroes = []) {
  const byName = new Map(catalogHeroes.map((h) => [h.name, h]));
  for (const api of apiHeroes) {
    if (byName.has(api.name)) continue;
    const role = (api.role ?? '').toLowerCase();
    byName.set(api.name, {
      name: api.name,
      role,
      tags: ROLE_DEFAULTS[role] ?? [],
      roam: role === 'tank' || role === 'support',
      inferred: true,
    });
  }
  return [...byName.values()];
}

/**
 * A quién banear. No es "el héroe con más winrate": es el que más te duele a ti,
 * así que pesa el banrate global (lo que la gente ya considera peligroso) junto
 * con lo mal que le va a tu composición ya elegida.
 */
export function suggestBans(allHeroes, ctx) {
  const { allies = [], enemies = [], bans = [], meta = {} } = ctx;
  const taken = new Set([...allies, ...enemies, ...bans].map((h) => h.name));

  return allHeroes
    .filter((h) => !taken.has(h.name) && lookup(meta.stats, h.name))
    .map((hero) => {
      const stat = lookup(meta.stats, hero.name);
      const power = metaScore(stat, meta.patchAvgWinRate ?? 0.5).value;
      const consensus = stat.banRate ?? 0;

      // Cuánto castiga a los aliados que ya has elegido. Con la tabla propia de
      // peligro, no con la de counters puesta del revés.
      const positivas = [];
      const reasons = [];
      for (const ally of allies) {
        for (const rule of DANGER_RULES) {
          if (!ally.tags.includes(rule.allyTag) || !hero.tags.includes(rule.enemyTag)) continue;
          positivas.push(rule.weight);
          reasons.push({ text: rule.why(ally.name), good: false, w: rule.weight });
        }
      }
      // La amenaza más fuerte y media la segunda, como en el resto del motor.
      positivas.sort((a, b) => b - a);
      const danger = (positivas[0] ?? 0) + (positivas[1] ?? 0) * 0.5;
      const dangerNorm = Math.min(1, danger / 1.5);

      return {
        hero,
        stat,
        score: power * 0.40 + consensus * 0.35 + dangerNorm * 0.25,
        reasons: dedupe(reasons).sort((a, b) => b.w - a.w).slice(0, 1),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Cuántos roamers tienen datos reales. Si baja, algo se ha roto en silencio. */
export function coverage(pool, stats, counters) {
  const missing = stats ? pool.filter((h) => !lookup(stats, h.name)).map((h) => h.name) : pool.map((h) => h.name);
  const conCounters = counters
    ? pool.filter((h) => Object.keys(lookup(counters, h.name) ?? {}).length).length
    : 0;
  return { withData: pool.length - missing.length, total: pool.length, missing, conCounters };
}

/**
 * Agrupa los primeros puestos que están dentro del margen de ruido.
 * Fingir que el nº1 es mejor que el nº2 cuando les separan 3 milésimas es
 * precisión falsa: si están empatados, hay que decirlo.
 */
export function empatados(ranked, margen = 0.015) {
  if (!ranked.length) return [];
  return ranked.filter((r) => ranked[0].score - r.score <= margen).slice(0, 4);
}

function dedupe(reasons) {
  const seen = new Set();
  return reasons.filter((r) => {
    if (seen.has(r.text)) return false;
    seen.add(r.text);
    return true;
  });
}
