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
 *   node scripts/diagnostico.mjs --historial historial/salud.jsonl
 *
 * Sale con código 1 si hay FALLOS. Los avisos no tumban nada: son avisos.
 *
 * Con `--historial` añade una línea con las cifras de esta corrida. Eso es lo
 * que convierte el diagnóstico en algo acumulativo: un informe suelto dice si
 * hoy está bien; cien informes dicen QUÉ SE ESTÁ MOVIENDO. La cobertura que
 * baja poco a poco, el ruido que sube, los datos que envejecen porque la
 * actualización lleva días fallando... nada de eso se ve en una foto.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile, mkdir } from 'node:fs/promises';
import { runSelfTest } from '../src/engine/selftest.js';
import { mergeCatalog, indexByName, poolDeLinea, LINEAS, matchup, sinergia, densidadCounters } from '../src/engine/score.js';
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

// ---------- historial ----------
const rutaHistorial = arg('--historial', null);
if (rutaHistorial) {
  const pares = (m) => Object.values(m ?? {}).reduce((n, f) => n + Object.keys(f ?? {}).length, 0);
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const desv = (a) => Math.sqrt(a.reduce((s, x) => s + (x - media(a)) ** 2, 0) / (a.length - 1));

  const nombres = Object.keys(meta.stats ?? {});
  const recorte = (leer, lo, ancho) => {
    let n = 0; let fuera = 0;
    for (const a of nombres) {
      for (const b of nombres) {
        if (a === b) continue;
        const v = leer(a, b);
        if (v == null) continue;
        n++;
        const x = (v - lo) / ancho;
        if (x <= 0 || x >= 1) fuera++;
      }
    }
    return n ? Number((fuera / n).toFixed(4)) : null;
  };

  // La misma medida de ruido que vigila el diagnóstico, guardada para poder
  // ver la tendencia: una subida lenta no la caza un umbral, la caza una serie.
  let ruido = null;
  const filas = [];
  for (const n of nombres) {
    const pr = meta.stats[n]?.pickRate;
    if (!(pr > 0)) continue;
    const v = nombres.filter((o) => o !== n)
      .map((o) => matchup(metaCtx.counters, n, o)).filter((x) => x != null);
    if (v.length > 50) filas.push({ pr, sd: desv(v) });
  }
  if (filas.length >= 100) {
    filas.sort((a, b) => a.pr - b.pr);
    const c = Math.floor(filas.length / 4);
    ruido = Number((media(filas.slice(0, c).map((f) => f.sd))
      / media(filas.slice(-c).map((f) => f.sd))).toFixed(3));
  }

  const pools = Object.fromEntries(LINEAS.map((l, i) => [l, partes[i]
    ? poolDeLinea(allHeroes, indiceDeLineas(meta.heroes ?? []), l).length : null]));

  const fila = {
    fecha: new Date().toISOString(),
    fuente: LOCAL ? 'local' : BASE,
    version: partes[0]?.texto.match(/Versión: ([^\n·]+)/)?.[1]?.trim() ?? null,
    fallos: fallosTotales,
    avisos: partes.reduce((n, p) => n + p.avisos, 0),
    datosDe: meta.generatedAt ?? null,
    edadHoras: meta.generatedAt
      ? Number(((Date.now() - new Date(meta.generatedAt)) / 3.6e6).toFixed(1)) : null,
    heroes: (meta.heroes ?? []).length,
    conLinea: (meta.heroes ?? []).filter((h) => h.lanes?.length).length,
    conDano: (meta.heroes ?? []).filter((h) => h.damage).length,
    cruces: pares(meta.counters),
    sinergias: pares(meta.synergies),
    cobertura: Number(densidadCounters(
      poolDeLinea(allHeroes, indiceDeLineas(meta.heroes ?? []), 'roam'),
      metaCtx.counters, allHeroes,
    ).cobertura.toFixed(4)),
    recorteCounters: recorte((a, b) => matchup(metaCtx.counters, a, b), 0.44, 0.12),
    recorteSinergias: recorte((a, b) => sinergia(metaCtx.synergies, a, b), 0.42, 0.16),
    ruido,
    pools,
  };

  await mkdir(dirname(resolve(ROOT, rutaHistorial)), { recursive: true });
  await appendFile(resolve(ROOT, rutaHistorial), `${JSON.stringify(fila)}\n`);
  console.log(`Anotado en ${rutaHistorial}`);
}

if (fallosTotales) {
  console.error(`\n${fallosTotales} FALLOS repartidos por las cinco líneas.`);
  process.exit(1);
}
