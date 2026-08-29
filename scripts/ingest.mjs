#!/usr/bin/env node
/**
 * Ingesta de datos meta de MLBB.
 *
 * Consulta la API publica de la comunidad (proyecto OpenMLBB / api-mobilelegends,
 * BSD-3), normaliza winrate / pickrate / banrate, counters y sinergias, y escribe
 * public/data/roam-meta.json.
 *
 *   node scripts/ingest.mjs                # rango por defecto
 *   node scripts/ingest.mjs --rank mythic --days 7
 *
 * Si un endpoint cambia de forma, este script NO revienta: avisa por consola y
 * conserva el fichero anterior para la parte que no ha podido refrescar.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/data/roam-meta.json');
const HEROES = resolve(ROOT, 'public/data/heroes.json');

const BASE = process.env.MLBB_API_BASE ?? 'https://mlbb.rone.dev/api';
const UA = 'mlbb-roam-picker (personal use)';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const RANK = args.rank ?? 'mythic';
// Rangos que se descargan siempre: el meta de Glory no es el de Epic, y así
// puedes cambiar al tuyo desde la app sin volver a ejecutar la ingesta.
const RANKS = (args.ranks ?? 'epic,legend,mythic,glory').split(',').map((r) => r.trim());
const DAYS = Number(args.days ?? 7);

/** Traza de lo que ha funcionado y lo que no. Se guarda en el JSON de salida. */
const diagnostics = { base: BASE, tried: [], ok: [], failed: [] };

/**
 * La API ha movido rutas entre versiones y no puedo probarlas desde aquí, así que
 * en vez de fijar una, el script prueba las candidatas en orden y se queda con la
 * primera que responde. Lo que ha funcionado queda anotado en diagnostics.
 */
async function tryPaths(paths, params = {}) {
  let lastErr;
  for (const path of paths) {
    diagnostics.tried.push(path);
    try {
      const data = await get(path, params);
      const rows = firstArray(data);
      if (!rows || !rows.length) throw new Error('respuesta sin filas');
      diagnostics.ok.push(path);
      return { path, data, rows };
    } catch (err) {
      diagnostics.failed.push(`${path}: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('ninguna ruta candidata respondió');
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${url.pathname}`);
  return res.json();
}

/**
 * Los wrappers de esta API han cambiado de forma entre versiones (a veces
 * { data: { records: [...] } }, a veces { records: [...] }, a veces array pelado).
 * Esto encuentra el primer array de objetos que haya dentro, a cualquier profundidad.
 */
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

/**
 * Lista completa de heroes con su rol. Es lo que evita que el catalogo escrito
 * a mano se quede corto: cualquier heroe que exista en el juego aparece aqui.
 */
async function fetchHeroList() {
  const { rows } = await tryPaths(
    ['/mlbb/hero-position/', '/mlbb/hero-position', '/hero-position/', '/mlbb/heroes/', '/mlbb/heroes'],
    { size: 300, index: 1 },
  );
  const heroes = [];
  for (const row of rows) {
    const name = pick(row, ['name', 'hero_name', 'heroname']);
    if (!name) continue;
    heroes.push({
      name: String(name).trim(),
      role: String(pick(row, ['role', 'sort_id', 'hero_role']) ?? '').toLowerCase(),
      lane: String(pick(row, ['lane', 'hero_lane']) ?? '').toLowerCase(),
    });
  }
  return heroes;
}

async function fetchStats(rank = RANK) {
  const { rows } = await tryPaths(
    ['/mlbb/hero-rank/', '/mlbb/hero-rank', '/hero-rank/', '/mlbb/hero-rate/'],
    { days: DAYS, rank, size: 200, index: 1, sort_field: 'win_rate', sort_order: 'desc' },
  );

  const stats = {};
  for (const row of rows) {
    const name = pick(row, ['name', 'hero_name', 'heroname']);
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

/** Counters y sinergias, hero a hero. Solo para el pool de roam: son ~30 llamadas. */
async function fetchRelations(roamNames, stats) {
  const counters = {};
  const synergies = {};

  for (const name of roamNames) {
    const id = stats[name]?.heroId;
    if (!id) continue;
    try {
      const [c, s] = await Promise.all([
        tryPaths([`/mlbb/hero-counter/${id}/`, `/mlbb/hero-counter/${id}`, `/hero-counter/${id}/`], { days: DAYS, rank: RANK }),
        tryPaths([`/mlbb/hero-compatibility/${id}/`, `/mlbb/hero-compatibility/${id}`, `/hero-compatibility/${id}/`], { days: DAYS, rank: RANK }),
      ]);
      counters[name] = relationMap(c.data);
      synergies[name] = relationMap(s.data);
    } catch (err) {
      console.warn(`  · sin relaciones para ${name}: ${err.message}`);
    }
    await sleep(250); // cortesía con una API gratuita
  }
  return { counters, synergies };
}

function relationMap(raw) {
  const rows = firstArray(raw) ?? [];
  const map = {};
  for (const row of rows) {
    const name = pick(row, ['name', 'hero_name', 'heroname']);
    const rate = asRate(pick(row, ['increase_win_rate', 'win_rate', 'hero_win_rate']));
    if (name && rate != null) {
      // increase_win_rate viene como delta (+0.02). Lo convertimos a winrate absoluto.
      map[String(name).trim()] = Math.abs(rate) < 0.2 ? 0.5 + rate : rate;
    }
  }
  return map;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Ingesta MLBB · rango=${RANK} · ventana=${DAYS}d · base=${BASE}`);

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
      console.warn(`  · ${rank}: fallo (${err.message}); conservo los datos anteriores`);
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
    console.warn(`  · fallo al leer la lista de héroes (${err.message}); conservo la anterior`);
  }

  let relations = { counters: previous?.counters ?? {}, synergies: previous?.synergies ?? {} };
  try {
    const fresh = await fetchRelations(roamNames, stats);
    if (Object.keys(fresh.counters).length) relations = fresh;
    console.log(`  · relaciones de ${Object.keys(relations.counters).length} roamers`);
  } catch (err) {
    console.warn(`  · fallo al leer relaciones (${err.message}); conservo las anteriores`);
  }

  const avgOf = (byName) => {
    const r = Object.values(byName).map((s) => s.winRate).filter((n) => n != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0.5;
  };
  const avgByRank = Object.fromEntries(Object.entries(statsByRank).map(([k, v]) => [k, avgOf(v)]));
  const patchAvgWinRate = avgOf(stats);

  // Héroes que la API conoce y nuestro catálogo no: normalmente, recién salidos.
  const known = new Set(heroes.heroes.map((h) => h.name));
  const seen = new Set([...Object.keys(stats), ...heroList.map((h) => h.name)]);
  const newHeroes = [...seen].filter((n) => !known.has(n));

  const out = {
    generatedAt: new Date().toISOString(),
    rank: RANK,
    days: DAYS,
    ranks: Object.keys(statsByRank),
    diagnostics: {
      base: diagnostics.base,
      ok: [...new Set(diagnostics.ok)],
      failed: [...new Set(diagnostics.failed)].slice(0, 12),
    },
    patchAvgWinRate,
    avgByRank,
    heroCount: Object.keys(stats).length,
    heroes: heroList,
    newHeroes,
    stats,
    statsByRank,
    counters: relations.counters,
    synergies: relations.synergies,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Escrito ${OUT}`);
  console.log(`Rutas que respondieron: ${[...new Set(diagnostics.ok)].join(', ') || 'ninguna'}`);
  if (!Object.keys(statsByRank).length) {
    console.warn('SIN ESTADÍSTICAS. Fallos:');
    for (const f of [...new Set(diagnostics.failed)].slice(0, 10)) console.warn(`  ${f}`);
  }
  if (newHeroes.length) {
    console.log(`Héroes sin tags propios (usan los de su rol): ${newHeroes.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Ingesta fallida:', err.message);
  process.exit(1);
});
