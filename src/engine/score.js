import {
  ROLE_DEFAULTS,
  COUNTER_RULES,
  TEAM_NEEDS,
  MASTERY_CONFIDENCE_GAMES,
  DEFAULT_WEIGHTS,
} from './rules.js';

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Winrate crudo -> 0..1, encogido hacia 0.5 segun el tamaño de muestra.
 * Un heroe con 52% y 300 partidas vale mas que uno con 58% y 12 partidas.
 * Usa un shrink bayesiano simple (media a priori = winrate medio del parche).
 */
export function metaScore(stat, patchAvgWinRate = 0.5) {
  if (!stat || stat.winRate == null) return { value: 0.5, confident: false };
  const n = stat.matches ?? 0;
  const prior = 400; // partidas equivalentes de la media; sube esto si quieres ser más conservador
  const shrunk = (stat.winRate * n + patchAvgWinRate * prior) / (n + prior);
  // Mapea 44%..56% a 0..1. Fuera de ese rango casi nunca hay nada.
  const value = clamp01((shrunk - 0.44) / 0.12);
  return { value, confident: n >= 200, shrunkWinRate: shrunk };
}

/**
 * Counter. Primero intenta el dato real de la API (winrate del heroe A contra B).
 * Si no existe para ese par, cae a las reglas por tags.
 */
export function counterScore(roamHero, enemies, counterMatrix) {
  if (!enemies.length) return { value: 0.5, reasons: [] };

  const reasons = [];
  let total = 0;

  for (const enemy of enemies) {
    const pair = counterMatrix?.[roamHero.name]?.[enemy.name];
    if (pair != null) {
      // pair = winrate de roamHero contra enemy (0..1). 0.50 es neutro.
      const delta = clamp01((pair - 0.44) / 0.12);
      total += delta;
      if (pair >= 0.53) reasons.push({ text: `gana el matchup contra ${enemy.name}`, good: true, w: 1.2 });
      if (pair <= 0.47) reasons.push({ text: `pierde contra ${enemy.name}`, good: false, w: 1.3 });
      continue;
    }

    // Fallback por tags
    let sub = 0;
    for (const rule of COUNTER_RULES) {
      if (enemy.tags.includes(rule.enemyTag) && roamHero.tags.includes(rule.roamTag)) {
        sub += rule.weight;
        reasons.push({ text: rule.why(enemy.name), good: rule.weight > 0, w: Math.abs(rule.weight), kind: `${rule.enemyTag}>${rule.roamTag}` });
      }
    }
    total += clamp01(0.5 + sub * 0.22);
  }

  return { value: total / enemies.length, reasons: dedupe(reasons) };
}

/** Sinergia con aliados ya elegidos. Mismo patron: dato real, si no, tags. */
export function synergyScore(roamHero, allies, synergyMatrix) {
  if (!allies.length) return { value: 0.5, reasons: [] };
  const reasons = [];
  let total = 0;

  for (const ally of allies) {
    const pair = synergyMatrix?.[roamHero.name]?.[ally.name];
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
    total += clamp01(0.5 + sub * 0.2);
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
 * Con pocos aliados elegidos sabemos poco, asi que el resultado se acerca a
 * neutro: sin esa correccion, un draft vacio premia al generalista y ya está.
 */
export function compScore(roamHero, allies) {
  const covered = new Set(allies.flatMap((a) => a.tags));
  let score = 0;
  let max = 0;
  const reasons = [];

  for (const need of TEAM_NEEDS) {
    max += need.weight;
    if (!has(roamHero, need.tag)) continue;
    if ((SATISFIES[need.tag] ?? [need.tag]).some((t) => covered.has(t))) {
      score += need.weight * 0.35; // ya cubierto: aporta redundancia, no solución
    } else {
      score += need.weight;
      reasons.push({ text: need.why, good: true, w: need.weight });
    }
  }

  const raw = max ? clamp01(score / max) : 0.5;
  const confidence = Math.min(1, allies.length / 3);
  return { value: 0.5 + (raw - 0.5) * (0.35 + 0.65 * confidence), reasons: allies.length ? reasons : [] };
}

/** Tu winrate personal, encogido con fuerza si llevas pocas partidas. */
export function masteryScore(roamHero, mastery) {
  const m = mastery?.[roamHero.name];
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
    meta: metaScore(meta.stats?.[roamHero.name], meta.patchAvgWinRate ?? 0.5),
    counter: counterScore(roamHero, enemies, meta.counters),
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
  const taken = new Set([
    ...(ctx.enemies ?? []).map((h) => h.name),
    ...(ctx.allies ?? []).map((h) => h.name),
    ...(ctx.bans ?? []).map((h) => h.name),
  ]);

  return pool
    .filter((h) => !taken.has(h.name))
    .map((h) => scoreHero(h, ctx))
    .sort((a, b) => b.score - a.score);
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

function dedupe(reasons) {
  const seen = new Set();
  return reasons.filter((r) => {
    if (seen.has(r.text)) return false;
    seen.add(r.text);
    return true;
  });
}
