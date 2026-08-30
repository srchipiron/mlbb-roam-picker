#!/usr/bin/env node
/**
 * El mismo diagnóstico que enseña el botón, pero sin móvil y sin dedo.
 *
 * Corre contra lo que la app SIRVE DE VERDAD, no contra el repositorio: si un
 * despliegue publica datos degradados, el repo puede estar impecable y la app
 * mentir igual. Ya pasó dos veces en un solo día.
 *
 *   node scripts/diagnostico.mjs                 # contra lo publicado
 *   node scripts/diagnostico.mjs --local         # contra public/data
 *   node scripts/diagnostico.mjs --url https://…
 *
 * Sale con código 1 si hay FALLOS. Los avisos no tumban nada: son avisos.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfTest } from '../src/engine/selftest.js';
import { mergeCatalog, indexByName } from '../src/engine/score.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, def) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : def;
};
const BASE = arg('--url', 'https://srchipiron.github.io/mlbb-roam-picker');
const LOCAL = process.argv.includes('--local');

async function traer(nombre) {
  if (LOCAL) return JSON.parse(readFileSync(resolve(ROOT, 'public/data', nombre), 'utf8'));
  const res = await fetch(`${BASE}/data/${nombre}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${nombre}: HTTP ${res.status}`);
  return res.json();
}

const catalog = await traer('heroes.json');
const meta = await traer('roam-meta.json');

const allHeroes = mergeCatalog(catalog.heroes, meta.heroes);
const roamPool = allHeroes.filter((h) => h.roam);
const rango = meta.rank ?? 'glory';
const metaCtx = {
  stats: indexByName(meta.statsByRank?.[rango] ?? meta.stats),
  counters: indexByName(meta.counters, 2),
  synergies: indexByName(meta.synergies, 2),
  patchAvgWinRate: meta.avgByRank?.[rango] ?? meta.patchAvgWinRate ?? 0.5,
};

// La maestría y las partidas viven en el móvil de Javi y no se pueden ver desde
// aquí. Se dejan vacías a propósito: las comprobaciones que dependen de ellas
// son avisos, no fallos, así que no tumban la vigilancia por no tenerlas.
const resultado = runSelfTest({
  catalog, meta, metaCtx, allHeroes, roamPool,
  mastery: {},
  partidas: [],
  env: {
    version: 'vigilancia', buildTime: null, rango,
    width: 412, height: 915, standalone: false, storage: true,
    sw: 'sin navegador',
    sinDatosPersonales: true,
  },
});

console.log(resultado.texto);
console.log('');
console.log(`Fuente: ${LOCAL ? 'public/data (local)' : BASE}`);

if (resultado.fallos) {
  console.error(`\n${resultado.fallos} FALLOS en lo que la app está sirviendo.`);
  process.exit(1);
}
