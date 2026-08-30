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
/**
 * Pickrate a partir del cual el matchup de una pareja se considera fiable.
 *
 * Sustituye a la mezcla fija que había antes (65% dato, 35% mis reglas). Ese
 * 35% era criterio mío escrito a mano, y envejece: cuando Moonton reequilibra
 * un héroe o saca uno nuevo, mis etiquetas siguen diciendo lo de siempre.
 *
 * Ahora la confianza en el dato la decide el propio dato: contra un héroe muy
 * jugado hay muestra de sobra y se usa tal cual; contra uno raro el matchup se
 * encoge hacia el empate, que es lo honesto. Mis reglas solo entran cuando NO
 * hay dato de la pareja, como red de seguridad para héroes recién salidos.
 */
const PICKRATE_FIABLE = 0.004;

/** Confianza en el matchup cuando no se sabe cuánto se juega al rival. */
const CONFIANZA_SIN_MUESTRA = 0.7;

/**
 * Ventaja de un roamer contra un enemigo según las reglas por tags, en 0..1.
 * Cuenta la ventaja más fuerte y media la segunda: sumarlas todas premiaba al
 * héroe con más etiquetas en el catálogo, no al que mejor le va de verdad.
 */
function ventajaPorTags(roamHero, enemy, reasons) {
  const positivas = [];
  let penalizacion = 0;

  for (const rule of COUNTER_RULES) {
    if (!enemy.tags.includes(rule.enemyTag) || !roamHero.tags.includes(rule.roamTag)) continue;
    reasons?.push({
      text: rule.why(enemy.name),
      good: rule.weight > 0,
      w: Math.abs(rule.weight),
      kind: `${rule.enemyTag}>${rule.roamTag}`,
    });
    if (rule.weight > 0) positivas.push(rule.weight);
    else penalizacion += rule.weight; // las desventajas sí suman: son avisos
  }

  positivas.sort((a, b) => b - a);
  const sub = (positivas[0] ?? 0) + (positivas[1] ?? 0) * 0.5 + penalizacion;
  // Escalado, no recortado: con un multiplicador fijo media plantilla marcaba
  // 1.00 y dejaba de distinguir a quien corta dashes de quien solo hace peel.
  return 0.5 + clamp01(sub / SUB_MAX) * 0.5;
}

/**
 * Matchup contra los picks enemigos.
 *
 * Cuando hay winrate real de la pareja se MEZCLA con las reglas por tags en vez
 * de sustituirlas. El dato real es mejor, pero sale de pocas partidas y es
 * ruidoso: dejándole todo el peso, contra tres asesinos de dash podía dejar de
 * recomendarse un anti-dash, que es justo lo que la app debe acertar.
 */
export function counterScore(roamHero, enemies, counterMatrix, enemyRoamName = null, stats = null) {
  if (!enemies.length) return { value: 0.5, reasons: [] };

  const reasons = [];
  let total = 0;
  let pesoTotal = 0;

  for (const enemy of enemies) {
    // El roamer rival es con quien más vas a chocar: su matchup pesa el doble.
    const peso = enemyRoamName && normName(enemy.name) === normName(enemyRoamName) ? 2 : 1;
    pesoTotal += peso;

    const porTags = ventajaPorTags(roamHero, enemy, reasons);
    const pair = lookup(lookup(counterMatrix, roamHero.name), enemy.name);

    if (pair == null) {
      total += porTags * peso;
      continue;
    }

    // pair = winrate de roamHero contra enemy (0..1). 0.50 es neutro.
    // Se encoge hacia el empate según lo jugado que esté el rival: con poca
    // muestra, un 57% de matchup es ruido y no una ventaja.
    // Sin pickrate no se puede medir la muestra, pero descartar el dato por eso
    // sería peor: se confía de forma moderada en vez de tirarlo.
    const pr = lookup(stats, enemy.name)?.pickRate;
    const confianza = pr > 0 ? pr / (pr + PICKRATE_FIABLE) : CONFIANZA_SIN_MUESTRA;
    const encogido = 0.5 + (pair - 0.5) * confianza;

    const porDato = clamp01((encogido - 0.44) / 0.12);
    total += porDato * peso;

    if (pair >= 0.53) reasons.push({ text: `gana el matchup contra ${enemy.name}`, good: true, w: 1.2 });
    if (pair <= 0.47) reasons.push({ text: `pierde contra ${enemy.name}`, good: false, w: 1.3 });
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
    counter: counterScore(roamHero, enemies, meta.counters, ctx.enemyRoam, meta.stats),
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

/** Cuánto puede descontar como máximo el riesgo de contrapick. */
const RIESGO_MAX = 0.10;

/** Umbral por debajo del cual se considera que un componente no aporta señal. */
const SENAL_MINIMA = 0.02;

/**
 * Reescala un componente al rango 0..1 dentro del pool.
 *
 * Sin esto los pesos no significaban lo que decían: con datos reales el winrate
 * se repartía por un rango de 0.55 y la composición por 0.19, así que meta
 * decidía el triple de lo que marcaba su peso y el draft apenas movía la
 * recomendación. Medido en la app: influencia real meta 0.121 frente a comp
 * 0.028, teniendo pesos 0.22 y 0.15.
 *
 * Si un componente casi no varía (draft vacío, sin counters, sin maestría) se
 * deja plano en 0.5: no tiene información y no debe inventarse diferencias.
 */
function normalizarComponente(valores) {
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  if (max - min < SENAL_MINIMA) return valores.map(() => 0.5);
  return valores.map((v) => (v - min) / (max - min));
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

  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const claves = Object.keys(weights);

  const resultados = pool
    .filter((h) => !taken.has(normName(h.name)))
    .map((h) => scoreHero(h, ctx));

  if (!resultados.length) return resultados;

  // Cada componente se reescala dentro del pool ANTES de aplicar su peso, para
  // que un peso de 0.36 sea de verdad el 36% de la decisión.
  const normalizados = {};
  for (const k of claves) {
    normalizados[k] = normalizarComponente(resultados.map((r) => r.parts[k]?.value ?? 0.5));
  }

  // Con el equipo enemigo a medias, un pick muy castigable es una apuesta: se
  // marca para que lo sepas, y se penaliza en proporción a lo que falta por ver.
  const porVer = Math.max(0, 5 - (ctx.enemies?.length ?? 0));
  const cegera = porVer / 5;

  // Un motivo que le sale a casi todo el pool no informa de nada: "no hay
  // primera línea" es cierto para los 34 roamers a la vez, porque la primera
  // línea la pones TÚ. Ocupaba las tres etiquetas de cada tarjeta y tapaba lo
  // que de verdad distingue a un pick de otro.
  const frecuencia = new Map();
  for (const r of resultados) {
    for (const razon of new Set(r.reasons.map((x) => x.text))) {
      frecuencia.set(razon, (frecuencia.get(razon) ?? 0) + 1);
    }
  }
  const comunes = new Set(
    [...frecuencia.entries()]
      .filter(([, n]) => n > resultados.length * 0.6)
      .map(([texto]) => texto),
  );

  resultados.forEach((r, i) => {
    const propios = r.reasons.filter((x) => !comunes.has(x.text));
    // Si al quitar los comunes no queda nada, mejor decir eso que mentir.
    r.reasons = propios.length ? propios : [];
    r.contributions = Object.fromEntries(claves.map((k) => [k, normalizados[k][i] * weights[k]]));
    r.score = claves.reduce((acc, k) => acc + r.contributions[k], 0);

    r.riesgo = riesgoContrapick(r.hero, ctx.meta?.counters, ctx.candidatos ?? []);
    if (r.riesgo != null && cegera > 0) {
      r.score -= r.riesgo * cegera * RIESGO_MAX;
      if (r.riesgo > 0.6 && cegera > 0.4) {
        r.reasons = [{ text: 'arriesgado como pick ciego', good: false, w: 1.5 }, ...r.reasons].slice(0, 3);
      }
    }
  });

  return resultados.sort((a, b) =>
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

/**
 * Riesgo de contrapick: cuánto puede hundirse este roamer si el enemigo aún no
 * ha elegido y luego te saca su peor matchup.
 *
 * Idea tomada de las herramientas de draft de LoL, y especialmente pertinente en
 * roam porque sueles elegir pronto, a ciegas. En ese momento no quieres el mejor
 * pick sobre el papel, quieres el que menos te pueden castigar después.
 *
 * Devuelve 0..1, donde 1 es muy castigable. Se mide con el percentil 10 de sus
 * matchups (el mal día típico), no con el mínimo absoluto, que sería un dato
 * suelto con poca muestra.
 */
export function riesgoContrapick(roamHero, counterMatrix, candidatos) {
  const fila = lookup(counterMatrix, roamHero.name);
  if (!fila) return null;

  const valores = candidatos
    .map((h) => fila[normName(h.name)])
    .filter((v) => v != null)
    .sort((a, b) => a - b);

  if (valores.length < 10) return null;

  const p10 = valores[Math.floor(valores.length * 0.1)];
  // 0.42 sería un matchup desastroso; 0.50, ninguno malo.
  return clamp01((0.50 - p10) / 0.08);
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
