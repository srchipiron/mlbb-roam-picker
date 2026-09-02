#!/usr/bin/env node
/**
 * ¿El motor se parece a lo que pasa en partidas de verdad?
 *
 * Con `historial/pro-partidas.jsonl` (ver ingesta-pro.mjs) se mide la
 * estimación de victoria (estimacion.js) contra el resultado real de cada
 * partida profesional, término a término.
 *
 *   node scripts/medir-pro.mjs                 partidas de los últimos 120 días
 *   node scripts/medir-pro.mjs --dias 400      más partidas, de otro parche
 *
 * QUÉ SE MIDE, y por qué cada cosa:
 *  - Acierto: el equipo con más de 50% ganó. Es lo que la gente entiende.
 *  - AUC: en cuántos pares (ganó, perdió) el modelo puso más alto al que
 *    ganó. Con 0.5 no hay señal; en drafts profesionales de MOBA los
 *    modelos que solo miran el draft rondan 0.55-0.60.
 *  - Brier: error cuadrático medio de la probabilidad. Una moneda: 0.250.
 *  - PENDIENTE de calibración: regresión logística de "ganó" sobre el
 *    log-odds del modelo. Con 1 la escala es la correcta; con 0 no hay
 *    señal; por encima de 1 el modelo se queda corto; por debajo, exagera.
 *    Va con su error típico: con 164 partidas el ± es 0.3, y no se puede
 *    concluir NADA sobre la escala. Se quiere miles.
 *
 * LO QUE YA SE VIO (MPL ID S16, 164 partidas de un año antes que los datos):
 * el modelo completo en el azar (AUC 0.54, pendiente 0.29 ± 0.31), los
 * cruces con la única señal (AUC 0.56, pendiente 1.05 ± 0.67), y el término
 * de héroes sin ninguna (0.09 ± 0.40): en pro los dos equipos eligen del
 * mismo meta, y un winrate de otra temporada no dice nada. Con datos de la
 * misma época esto se repite; hasta entonces, la escala no se toca.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCatalog, indexByName, normName } from '../src/engine/score.js';
import { estimarVictoria } from '../src/engine/estimacion.js';
import { resolverHeroe } from './ingesta-pro.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const logit = (p) => Math.log(p / (1 - p));
const sigmoide = (x) => 1 / (1 + Math.exp(-x));

/** Acierto, AUC, Brier y pendiente de calibración de una lista de { L, y }. */
export function evaluar(filas) {
  const n = filas.length;
  if (!n) return null;
  const acierto = filas.filter((r) => (r.L > 0) === (r.y === 1)).length / n;
  const brier = filas.reduce((a, r) => a + (sigmoide(r.L) - r.y) ** 2, 0) / n;
  const pos = filas.filter((r) => r.y === 1);
  const neg = filas.filter((r) => r.y === 0);
  let bien = 0;
  for (const p of pos) for (const q of neg) bien += p.L > q.L ? 1 : p.L === q.L ? 0.5 : 0;
  const auc = pos.length && neg.length ? bien / (pos.length * neg.length) : null;
  // Regresión logística y ~ a + b·L por Newton-Raphson.
  let a = 0;
  let b = 1;
  const hessiana = () => {
    let h00 = 0; let h01 = 0; let h11 = 0; let g0 = 0; let g1 = 0;
    for (const r of filas) {
      const p = sigmoide(a + b * r.L); const e = p - r.y; const w = p * (1 - p);
      g0 += e; g1 += e * r.L; h00 += w; h01 += w * r.L; h11 += w * r.L * r.L;
    }
    return { g0, g1, h00, h01, h11, det: h00 * h11 - h01 * h01 };
  };
  for (let it = 0; it < 50; it++) {
    const { g0, g1, h00, h01, h11, det } = hessiana();
    if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det; const db = (h00 * g1 - h01 * g0) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  const { h00, det } = hessiana();
  const errorPendiente = det > 0 ? Math.sqrt(h00 / det) : null;
  return { n, acierto, auc, brier, pendiente: b, errorPendiente };
}

export function cargarPartidas(lineas, heroes) {
  const indice = new Map(heroes.map((h) => [normName(h.name), h]));
  const usables = [];
  const sinMapear = {};
  for (const p of lineas) {
    const eq = p.picks.map((lado) => lado.map((s) => resolverHeroe(s, indice)));
    const faltan = eq.flat().some((h) => !h);
    if (faltan) {
      for (const [i, s] of p.picks.flat().entries()) if (!eq.flat()[i]) sinMapear[s] = (sinMapear[s] ?? 0) + 1;
      continue;
    }
    usables.push({ ...p, equipos: eq });
  }
  return { usables, sinMapear };
}

async function main() {
  const args = process.argv.slice(2);
  const dias = Number(args[args.indexOf('--dias') + 1] || 120);
  const desde = new Date(Date.now() - dias * 86400e3).toISOString().slice(0, 10);
  const lineas = (await readFile(resolve(ROOT, 'historial/pro-partidas.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cat = JSON.parse(await readFile(resolve(ROOT, 'public/data/heroes.json'), 'utf8'));
  const meta = JSON.parse(await readFile(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const heroes = mergeCatalog(cat.heroes, meta.heroes ?? []);
  const M = { stats: indexByName(meta.stats), counters: indexByName(meta.counters, 2), synergies: indexByName(meta.synergies, 2) };
  const recientes = lineas.filter((p) => p.fecha && p.fecha >= desde);
  const { usables, sinMapear } = cargarPartidas(recientes, heroes);
  console.log(`Partidas desde ${desde}: ${recientes.length} · usables ${usables.length} · datos del ${meta.generatedAt?.slice(0, 10)}`);
  if (Object.keys(sinMapear).length) console.log(`Sin mapear: ${Object.entries(sinMapear).map(([s, n]) => `${s} (${n})`).join(', ')}`);
  if (usables.length < 30) { console.log('Menos de 30 partidas: no hay nada que medir todavía.'); return; }

  const est = (p) => estimarVictoria({ allies: p.equipos[0].slice(1), yo: p.equipos[0][0], enemies: p.equipos[1], meta: M });
  const filas = usables.map((p) => ({ e: est(p), y: p.ganador === 1 ? 1 : 0 }));
  const linea = (nombre, f) => {
    const r = evaluar(filas.map((x) => ({ L: f(x.e), y: x.y })));
    console.log(`${nombre.padEnd(18)} acierto ${(r.acierto * 100).toFixed(1)}% · AUC ${r.auc?.toFixed(3)} · Brier ${r.brier.toFixed(4)} · pendiente ${r.pendiente.toFixed(2)} ± ${r.errorPendiente?.toFixed(2)}`);
  };
  linea('modelo completo', (e) => e.logOdds);
  linea('solo héroes', (e) => e.terminos.heroes);
  linea('solo cruces', (e) => e.terminos.cruces);
  linea('solo parejas', (e) => e.terminos.parejas);
  linea('cruces + parejas', (e) => e.terminos.cruces + e.terminos.parejas);
  const azul = usables.filter((p) => (p.lado1 === 'blue') === (p.ganador === 1)).length;
  console.log(`Gana el lado azul: ${(azul / usables.length * 100).toFixed(1)}% (n=${usables.length})`);
}

const ejecutadoDirectamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ejecutadoDirectamente) main().catch((e) => { console.error(e.message); process.exit(1); });
