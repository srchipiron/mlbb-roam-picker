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
  'https://arena-hv.fastapicloud.dev/api',   // responde: /heroes/hero-rank/ existe
  'https://arena.rone.dev/api',
  'https://api-mobilelegends.vercel.app/api', // legado
].filter(Boolean);

/**
 * Descriptores de lo que necesitamos. La ruta real se busca en el esquema
 * OpenAPI por estos patrones, en vez de fijarla a mano: los nombres cambian
 * entre versiones pero el concepto no.
 */
const WANTED = {
  rank: [/hero[-_]?rank/i, /hero[-_]?rate/i, /\brank\b/i],
  position: [/hero[-_]?position/i, /hero[-_]?list/i, /\bheroes?\b\/?$/i],
  counter: [/hero[-_]?counter/i],
  compatibility: [/hero[-_]?compat/i],
};

/** Prefijos de grupo de rutas que ha usado el proyecto en distintas versiones. */
// '/heroes' confirmado: da 405 (existe, otro método) mientras '/mlbb' da 404.
const PREFIXES = ['/heroes', '', '/mlbb'];

const UA = 'mlbb-roam-picker (uso personal)';
const TIMEOUT_MS = 15000;

const diagnostics = { bases: BASES, ok: [], failed: [] };
let LOCKED = null; // { base, prefix, method } en cuanto algo responde

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Una petición. En el error incluye el cuerpo de la respuesta recortado: cuando
 * la API es FastAPI, un 422 dice exactamente qué campos esperaba, y eso vale más
 * que el código de estado a secas para saber qué corregir.
 */
async function request(url, method, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 240);
      } catch { /* sin cuerpo */ }
      const err = new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** GET primero; si contesta 405, el endpoint existe pero quiere POST. */
async function getUrl(url, params, forceMethod) {
  const methods = forceMethod ? [forceMethod] : ['GET', 'POST'];
  let lastErr;
  for (const method of methods) {
    try {
      const data = await request(url, method, method === 'POST' ? params : undefined);
      return { data, method };
    } catch (err) {
      lastErr = err;
      // Solo tiene sentido reintentar con POST si el fallo fue "método no permitido".
      if (err.status !== 405) throw err;
    }
  }
  throw lastErr;
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
        const { data, method } = await getUrl(url, params, combo.method);
        const rows = firstArray(data);
        if (!rows || !rows.length) throw new Error('respuesta sin filas');
        if (!LOCKED) {
          LOCKED = { ...combo, method };
          console.log(`  · base activa: ${method} ${combo.base}${combo.prefix}`);
        }
        diagnostics.ok.push(`${method} ${combo.base}${combo.prefix}${path}`);
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

/**
 * Lee el esquema OpenAPI y devuelve un mapa de lo que nos interesa:
 *   { rank: { url, method, params }, position: {...}, ... }
 * Esto sustituye a adivinar rutas: la API dice cuáles tiene y con qué método.
 */
async function discoverRoutes() {
  for (const base of BASES) {
    const origin = new URL(base).origin;
    for (const schemaUrl of [`${base}/openapi.json`, `${origin}/openapi.json`, `${origin}/api/openapi.json`]) {
      let schema;
      try {
        schema = await request(schemaUrl, 'GET');
      } catch (err) {
        diagnostics.failed.push(`${schemaUrl} → ${err.message}`);
        continue;
      }
      if (!schema?.paths) continue;

      const allPaths = Object.keys(schema.paths);
      diagnostics.schema = { url: schemaUrl, pathCount: allPaths.length, sample: allPaths.slice(0, 40) };
      console.log(`  · esquema leído: ${allPaths.length} rutas en ${schemaUrl}`);

      const routes = {};
      for (const [key, patterns] of Object.entries(WANTED)) {
        // Sin parámetros de ruta para las listas; con {id} para counter/compat.
        const wantsId = key === 'counter' || key === 'compatibility';
        const match = allPaths.find(
          (p) => patterns.some((re) => re.test(p)) && (wantsId ? /\{/.test(p) : !/\{/.test(p)),
        );
        if (!match) continue;
        const [method, op] = Object.entries(schema.paths[match])[0];
        routes[key] = {
          template: origin + match,
          method: method.toUpperCase(),
          params: (op?.parameters ?? []).map((prm) => prm.name),
        };
      }

      diagnostics.routes = Object.fromEntries(
        Object.entries(routes).map(([k, r]) => [k, `${r.method} ${r.template} (${r.params.join(', ') || 'sin params'})`]),
      );
      if (Object.keys(routes).length) return routes;
    }
  }
  return null;
}

/** Llama a una ruta ya descubierta, mandando solo los parámetros que acepta. */
async function callRoute(route, values, pathValue) {
  const url = new URL(route.template.replace(/\{[^}]+\}/, pathValue ?? ''));
  const accepted = route.params.length
    ? Object.fromEntries(Object.entries(values).filter(([k]) => route.params.includes(k)))
    : values;

  if (route.method === 'GET') {
    for (const [k, v] of Object.entries(accepted)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const data = await request(url.toString(), 'GET');
    return { data, rows: firstArray(data) ?? [] };
  }
  const data = await request(url.toString(), route.method, accepted);
  return { data, rows: firstArray(data) ?? [] };
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

/**
 * La API mezcla 0.52 y 52 para decir lo mismo. Con Math.abs, además, un delta
 * negativo (-2.5, o sea -2,5 puntos) se convierte bien: antes se quedaba en
 * -2.5 y acababa guardado como si fuera un winrate.
 */
const asRate = (n) => {
  if (n == null) return null;
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Math.abs(x) > 1 ? x / 100 : x;
};

const NAME_KEYS = ['name', 'hero_name', 'heroname', 'hero'];

let ROUTES = null;

async function fetchHeroList() {
  const values = { size: 300, index: 1, page_size: 300, page_index: 1, lang: 'en' };
  const { rows } = ROUTES?.position
    ? await callRoute(ROUTES.position, values)
    : await fetchResource(['/hero-position/', '/hero-position', '/hero-list/'], values);
  const heroes = [];
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    heroes.push({
      name: String(name).trim(),
      id: pick(row, ['hero_id', 'heroid', 'id']) ?? null,
      role: String(pick(row, ['role', 'hero_role', 'primary_role']) ?? '').toLowerCase(),
      lane: String(pick(row, ['lane', 'hero_lane', 'primary_lane']) ?? '').toLowerCase(),
    });
  }
  return heroes;
}

async function fetchStats(rank) {
  const values = {
    days: DAYS, past_days: DAYS,
    rank, rank_id: rank,
    size: 200, index: 1, page_size: 200, page_index: 1,
    sort_field: 'win_rate', sort_order: 'desc', order: 'desc', lang: 'en',
  };
  const { rows } = ROUTES?.rank
    ? await callRoute(ROUTES.rank, values)
    : await fetchResource(['/hero-rank/', '/hero-rank', '/hero-rate/'], values);

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

/**
 * Pares héroe→rival. Unos campos son winrate absoluto y otros un delta sobre la
 * media, y distinguirlos por su tamaño fallaba: un delta de +0.25 se tomaba por
 * un winrate del 25%. Ahora se mira QUÉ campo vino, que es lo que lo determina.
 */
const DELTA_KEYS = ['increase_win_rate', 'increase_winrate', 'win_rate_increase'];
const ABS_KEYS = ['win_rate', 'hero_win_rate', 'winRate'];

function relationMap(rows) {
  const map = {};
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;

    const delta = asRate(pick(row, DELTA_KEYS));
    const abs = asRate(pick(row, ABS_KEYS));
    const valor = delta != null ? 0.5 + delta : abs;

    // Un winrate de pareja fuera de 20%-80% es un dato mal leído, no un matchup.
    if (valor != null && valor > 0.2 && valor < 0.8) {
      map[String(name).trim()] = valor;
    }
  }
  return map;
}

async function fetchRelations(roamNames, stats, heroList) {
  const counters = {};
  const synergies = {};

  // El id puede venir en las estadísticas o en la lista de héroes. Si no está en
  // ninguna, la API acepta también el nombre como identificador, así que se usa
  // eso antes que rendirse: antes bastaba con que faltara el id para que TODOS
  // los counters se quedaran vacíos sin decir nada.
  const norm = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const idPorNombre = new Map();
  for (const [n, st] of Object.entries(stats)) if (st.heroId) idPorNombre.set(norm(n), st.heroId);
  for (const h of heroList ?? []) if (h.id) idPorNombre.set(norm(h.name), h.id);

  diagnostics.relations = {
    rutaCounter: ROUTES?.counter ? `${ROUTES.counter.method} ${ROUTES.counter.template}` : null,
    conId: 0, porNombre: 0, ok: 0, errores: [],
  };

  for (const name of roamNames) {
    const id = idPorNombre.get(norm(name)) ?? name;
    if (idPorNombre.has(norm(name))) diagnostics.relations.conId++;
    else diagnostics.relations.porNombre++;
    try {
      const values = { days: DAYS, past_days: DAYS, rank: RANK, rank_id: RANK, lang: 'en' };
      const [c, s] = await Promise.all([
        ROUTES?.counter
          ? callRoute(ROUTES.counter, values, id)
          : fetchResource([`/hero-counter/${id}/`], values),
        ROUTES?.compatibility
          ? callRoute(ROUTES.compatibility, values, id)
          : fetchResource([`/hero-compatibility/${id}/`], values),
      ]);
      counters[name] = relationMap(c.rows);
      synergies[name] = relationMap(s.rows);
      if (Object.keys(counters[name]).length) {
        diagnostics.relations.ok++;
      } else if (diagnostics.relations.errores.length < 4) {
        // Respondió pero no supimos leerlo: guardamos los campos que traía.
        diagnostics.relations.errores.push(
          `${name}: respuesta sin pares legibles · campos: ${Object.keys(c.rows?.[0] ?? {}).join(',') || 'vacío'}`,
        );
      }
    } catch (err) {
      if (diagnostics.relations.errores.length < 4) {
        diagnostics.relations.errores.push(`${name}: ${err.message}`);
      }
    }
    await sleep(250); // cortesía con una API gratuita
  }
  return { counters, synergies };
}

async function main() {
  console.log(`Ingesta MLBB · rangos=${RANKS.join(',')} · ventana=${DAYS}d`);

  ROUTES = await discoverRoutes();
  if (ROUTES) {
    for (const [k, r] of Object.entries(ROUTES)) console.log(`  · ${k}: ${r.method} ${r.template}`);
  } else {
    console.warn('  · no se pudo leer el esquema; pruebo rutas conocidas a ciegas');
  }

  const heroes = JSON.parse(await readFile(HEROES, 'utf8'));
  const roamNames = [...new Set(heroes.heroes.filter((h) => h.roam).map((h) => h.name))];

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* primera ejecución */
  }

  let heroList = previous?.heroes ?? [];
  try {
    const fresh = await fetchHeroList();
    if (fresh.length) heroList = fresh;
    console.log(`  · lista completa: ${heroList.length} héroes`);
  } catch (err) {
    console.warn(`  · lista de héroes: fallo (${err.message}); conservo la anterior`);
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

  let relations = { counters: previous?.counters ?? {}, synergies: previous?.synergies ?? {} };
  try {
    const fresh = await fetchRelations(roamNames, stats, heroList);
    if (Object.keys(fresh.counters).length) relations = fresh;
    console.log(`  · relaciones de ${Object.keys(relations.counters).length} roamers`);
  } catch (err) {
    console.warn(`  · relaciones: fallo (${err.message}); conservo las anteriores`);
  }

  const avgOf = (byName) => {
    const r = Object.values(byName).map((s) => s.winRate).filter((n) => n != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0.5;
  };

  // Misma normalización que usa la app, para que el aviso coincida con la realidad.
  const norm = (n) => String(n ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const statKeys = new Set(Object.keys(stats).map(norm));
  const sinDatos = roamNames.filter((n) => !statKeys.has(norm(n)));

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
    roamCoverage: { withData: roamNames.length - sinDatos.length, total: roamNames.length, missing: sinDatos },
    heroes: heroList,
    newHeroes,
    diagnostics: {
      base: LOCKED ? `${LOCKED.method} ${LOCKED.base}${LOCKED.prefix}` : null,
      schema: diagnostics.schema ?? null,
      routes: diagnostics.routes ?? null,
      relations: diagnostics.relations ?? null,
      ok: [...new Set(diagnostics.ok)].slice(0, 6),
      failed: Object.keys(statsByRank).length ? [] : [...new Set(diagnostics.failed)].slice(0, 12),
    },
    stats,
    statsByRank,
    counters: relations.counters,
    synergies: relations.synergies,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(`Escrito ${OUT}`);
  if (diagnostics.relations) {
    const r = diagnostics.relations;
    console.log(`Relaciones: ${r.ok} con datos · ${r.conId} por id · ${r.porNombre} por nombre`);
    for (const e of r.errores) console.warn(`  ${e}`);
  }
  if (!Object.keys(statsByRank).length) {
    console.warn('SIN ESTADÍSTICAS. Combinaciones probadas que fallaron:');
    for (const f of [...new Set(diagnostics.failed)].slice(0, 12)) console.warn(`  ${f}`);
  } else if (sinDatos.length) {
    console.warn(`Roamers sin estadísticas (${sinDatos.length}/${roamNames.length}): ${sinDatos.join(', ')}`);
    console.warn('Si son muchos, los nombres de la API no coinciden con heroes.json.');
  }
  if (newHeroes.length) {
    console.log(`Héroes sin tags propios (usan los de su rol): ${newHeroes.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Ingesta fallida:', err.message);
  process.exit(1);
});
