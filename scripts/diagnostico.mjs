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
import { mergeCatalog, indexByName, poolDeLinea, LINEAS } from '../src/engine/score.js';
import { indiceDeLineas } from '../src/engine/rival-de-linea.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, def) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : def;
};
// En GitHub Actions, GITHUB_REPOSITORY viene como "duenno/repo", que es
// justo lo que hace falta para armar la URL de Pages. Asi el renombrado del
// repositorio no obliga a tocar este fichero.
const DEL_ENTORNO = process.env.GITHUB_REPOSITORY
  ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0]}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}`
  : 'https://srchipiron.github.io/mlbb-roam-picker';
const BASE = arg('--url', DEL_ENTORNO);
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
const indiceLineas = indiceDeLineas(meta.heroes);
const rango = meta.rank ?? 'glory';
const metaCtx = {
  stats: indexByName(meta.statsByRank?.[rango] ?? meta.stats),
  counters: indexByName(meta.counters, 2),
  synergies: indexByName(meta.synergies, 2),
  patchAvgWinRate: meta.avgByRank?.[rango] ?? meta.patchAvgWinRate ?? 0.5,
};

// Se comprueban LAS CINCO líneas, no solo roam: desde que la app sirve para
// todos los roles, que funcione en roam no dice nada de las otras cuatro.
let fallosTotales = 0;
const partes = [];

for (const linea of LINEAS) {
  const roamPool = poolDeLinea(allHeroes, indiceLineas, linea);

  // La maestría y las partidas viven en el móvil de Javi y no se pueden ver
  // desde aquí. Se apagan a propósito: si fueran avisos, todos los informes
  // vendrían con avisos y dejaríamos de leerlos.
  const r = runSelfTest({
    catalog, meta, metaCtx, allHeroes, roamPool,
    mastery: {},
    partidas: [],
    linea,
    env: {
      version: 'vigilancia', buildTime: null, rango,
      width: 412, height: 915, standalone: false, storage: true,
      sw: 'sin navegador', sinDatosPersonales: true,
    },
  });
  fallosTotales += r.fallos;
  partes.push(r);
}

// El informe entero de la primera línea, y de las demás solo lo que cambia:
// pegar cinco informes casi idénticos en una incidencia no lo lee nadie.
console.log(partes[0].texto);
for (let i = 1; i < partes.length; i++) {
  console.log('');
  console.log(`--- LÍNEA ${LINEAS[i].toUpperCase()} ---`);
  for (const l of partes[i].texto.split('\n')) {
    if (/^\[(FALLO|AVISO)\]/.test(l) || /pool|Winrates|Counters|propone|dashes|curación/.test(l)) {
      console.log(l);
    }
  }
}
console.log('');
console.log(`Fuente: ${LOCAL ? 'public/data (local)' : BASE}`);

if (fallosTotales) {
  console.error(`\n${fallosTotales} FALLOS repartidos por las cinco líneas.`);
  process.exit(1);
}
