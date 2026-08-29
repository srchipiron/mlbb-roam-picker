#!/usr/bin/env node
/**
 * Ingesta de datos meta de MLBB.
 *
 * La API de la comunidad (proyecto Rone Arena, antes OpenMLBB / api-mobilelegends)
 * ha cambiado de dominio y de prefijo de rutas más de una vez. En vez de fijar
 * una URL que caduca, este script PRUEBA las bases y los prefijos conocidos y se
 * queda con la primera combinación que responde. Lo que ha funcionado y lo que ha
 * fallado queda anotado en el JSON de salida, para poder diagnosticar desde la app.
 *
 *   node scripts/ingest.mjs
 *   node scripts/ingest.mjs --rank mythic --days 7
 *   node scripts/ingest.mjs --base https://otra.api/api
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/data/roam-meta.json');
const HEROES = resolve(ROOT, 'public/data/heroes.json');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const RANK = args.rank ?? 'mythic';
const DAYS = Number(args.days ?? 7);
const RANKS = (args.ranks ?? 'epic,legend,mythic,glory').split(',').map((r) => r.trim());

/** Bases conocidas, de la más actual a la más antigua. */
const BASES = [
  args.base,
  process.env.MLBB_API_BASE,
  'https://arena-hv.fastapicloud.dev/api',
  'https://arena.rone.dev/api',
  'https://openmlbb.fastapicloud.dev/api',
  'https://mlbb.rone.dev/api',
  'https://api-mobilelegends.vercel.app/api',
].filter(Boolean);

/** Prefijos de grupo de rutas que ha usado el proyecto en distintas versiones. */
const PREFIXES = ['/heroes', '/mlbb', ''];

const UA = 'mlbb-roam-picker (uso personal)';
const TIMEOUT_MS = 15000;

const diagnostics = { bases: BASES, ok: [], failed: [] };
let LOCKED = null; // { base, prefix } en cuanto algo responde

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getUrl(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(base, prefix, path, params) {
  const url = new URL(base + prefix + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Pide un recurso probando combinaciones de base y prefijo. Una vez que una
 * funciona se fija en LOCKED y las siguientes llamadas van directas.
 */
async function fetchResource(paths, params = {}) {
  const combos = LOCKED
    ? [LOCKED]
    : BASES.flatMap((base) => PREFIXES.map((prefix) => ({ base, prefix })));

  let lastErr;
  for (const combo of combos) {
    for (const path of paths) {
      const url = buildUrl(combo.base, combo.prefix, path, params);
      try {
        const data = await getUrl(url);
        const rows = firstArray(data);
        if (!rows || !rows.length) throw new Error('respuesta sin filas');
        if (!LOCKED) {
          LOCKED = combo;
          console.log(`  · base activa: ${combo.base}${combo.prefix}`);
        }
        diagnostics.ok.push(`${combo.base}${combo.prefix}${path}`);
        return { data, rows, url };
      } catch (err) {
        lastErr = err;
        if (diagnostics.failed.length < 40) {
          diagnostics.failed.push(`${combo.base}${combo.prefix}${path} → ${err.message}`);
        }
      }
    }
  }
  throw lastErr ?? new Error('ninguna combinación respondió');
}

/** Encuentra el primer array de objetos, a cualquier profundidad del envoltorio. */
function firstArray(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node) && node.length && typeof node[0] === 'object') return node;
  if (typeof node !== 'object') return null;
  for (const v of Object.values(node)) {
    const found = firstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Busca un valor por varios nombres de campo posibles, a cualquier profundidad. */
function pick(obj, keys, depth = 0) {
  if (depth > 5 || obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] != null && typeof obj[k] !== 'object') return obj[k];
  }
  for (const v of Object.values(obj)) {
    const found = pick(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const asRate = (n) => {
  if (n == null) return null;
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return x > 1 ? x / 100 : x; // la API mezcla 0.52 y 52
};

const NAME_KEYS = ['name', 'hero_name', 'heroname', 'hero'];

async function fetchHeroList() {
  const { rows } = await fetchResource(
    ['/hero-position/', '/hero-position', '/hero-list/', '/list/', '/'],
    { size: 300, index: 1 },
  );
  const heroes = [];
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    heroes.push({
      name: String(name).trim(),
      role: String(pick(row, ['role', 'hero_role', 'primary_role']) ?? '').toLowerCase(),
      lane: String(pick(row, ['lane', 'hero_lane', 'primary_lane']) ?? '').toLowerCase(),
    });
  }
  return heroes;
}

async function fetchStats(rank) {
  const { rows } = await fetchResource(
    ['/hero-rank/', '/hero-rank', '/rank/', '/hero-rate/'],
    { days: DAYS, rank, size: 200, index: 1, sort_field: 'win_rate', sort_order: 'desc' },
  );

  const stats = {};
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    stats[String(name).trim()] = {
      winRate: asRate(pick(row, ['win_rate', 'winRate', 'main_hero_win_rate'])),
      pickRate: asRate(pick(row, ['pick_rate', 'pickRate', 'main_hero_appearance_rate'])),
      banRate: asRate(pick(row, ['ban_rate', 'banRate', 'main_hero_ban_rate'])),
      matches: Number(pick(row, ['matches', 'match_count', 'total']) ?? 0) || null,
      heroId: pick(row, ['hero_id', 'heroid', 'id']) ?? null,
    };
  }
  return stats;
}

function relationMap(rows) {
  const map = {};
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    const rate = asRate(pick(row, ['increase_win_rate', 'win_rate', 'hero_win_rate']));
    if (name && rate != null) {
      // increase_win_rate viene como delta (+0.02); lo pasamos a winrate absoluto.
      map[String(name).trim()] = Math.abs(rate) < 0.2 ? 0.5 + rate : rate;
    }
  }
  return map;
}

async function fetchRelations(roamNames, stats) {
  const counters = {};
  const synergies = {};

  for (const name of roamNames) {
    const id = stats[name]?.heroId;
    if (!id) continue;
    try {
      const [c, s] = await Promise.all([
        fetchResource([`/hero-counter/${id}/`, `/hero-counter/${id}`], { days: DAYS, rank: RANK }),
        fetchResource([`/hero-compatibility/${id}/`, `/hero-compatibility/${id}`], { days: DAYS, rank: RANK }),
      ]);
      counters[name] = relationMap(c.rows);
      synergies[name] = relationMap(s.rows);
    } catch (err) {
      console.warn(`  · sin relaciones para ${name}: ${err.message}`);
    }
    await sleep(250); // cortesía con una API gratuita
  }
  return { counters, synergies };
}

async function main() {
  console.log(`Ingesta MLBB · rangos=${RANKS.join(',')} · ventana=${DAYS}d`);

  const heroes = JSON.parse(await readFile(HEROES, 'utf8'));
  const roamNames = [...new Set(heroes.heroes.filter((h) => h.roam).map((h) => h.name))];

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* primera ejecución */
  }

  const statsByRank = { ...(previous?.statsByRank ?? {}) };
  for (const rank of RANKS) {
    try {
      const s = await fetchStats(rank);
      if (Object.keys(s).length) statsByRank[rank] = s;
      console.log(`  · ${rank}: ${Object.keys(s).length} héroes`);
    } catch (err) {
      console.warn(`  · ${rank}: fallo (${err.message}); conservo lo anterior`);
    }
    await sleep(250);
  }
  const stats = statsByRank[RANK] ?? Object.values(statsByRank)[0] ?? previous?.stats ?? {};

  let heroList = previous?.heroes ?? [];
  try {
    const fresh = await fetchHeroList();
    if (fresh.length) heroList = fresh;
    console.log(`  · lista completa: ${heroList.length} héroes`);
  } catch (err) {
    console.warn(`  · lista de héroes: fallo (${err.message}); conservo la anterior`);
  }

  let relations = { counters: previous?.counters ?? {}, synergies: previous?.synergies ?? {} };
  try {
    const fresh = await fetchRelations(roamNames, stats);
    if (Object.keys(fresh.counters).length) relations = fresh;
    console.log(`  · relaciones de ${Object.keys(relations.counters).length} roamers`);
  } catch (err) {
    console.warn(`  · relaciones: fallo (${err.message}); conservo las anteriores`);
  }

  const avgOf = (byName) => {
    const r = Object.values(byName).map((s) => s.winRate).filter((n) => n != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0.5;
  };

  const known = new Set(heroes.heroes.map((h) => h.name));
  const seen = new Set([...Object.keys(stats), ...heroList.map((h) => h.name)]);
  const newHeroes = [...seen].filter((n) => !known.has(n));

  const out = {
    generatedAt: new Date().toISOString(),
    rank: RANK,
    ranks: Object.keys(statsByRank),
    days: DAYS,
    patchAvgWinRate: avgOf(stats),
    avgByRank: Object.fromEntries(Object.entries(statsByRank).map(([k, v]) => [k, avgOf(v)])),
    heroCount: Object.keys(stats).length,
    heroes: heroList,
    newHeroes,
    diagnostics: {
      base: LOCKED ? LOCKED.base + LOCKED.prefix : null,
      ok: [...new Set(diagnostics.ok)].slice(0, 6),
      failed: LOCKED ? [] : [...new Set(diagnostics.failed)].slice(0, 12),
    },
    stats,
    statsByRank,
    counters: relations.counters,
    synergies: relations.synergies,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(`Escrito ${OUT}`);
  if (!Object.keys(statsByRank).length) {
    console.warn('SIN ESTADÍSTICAS. Combinaciones probadas que fallaron:');
    for (const f of [...new Set(diagnostics.failed)].slice(0, 12)) console.warn(`  ${f}`);
  } else if (newHeroes.length) {
    console.log(`Héroes sin tags propios (usan los de su rol): ${newHeroes.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Ingesta fallida:', err.message);
  process.exit(1);
});
