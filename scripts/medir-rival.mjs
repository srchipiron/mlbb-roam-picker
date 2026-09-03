#!/usr/bin/env node
/**
 * ¿Pesa de verdad el doble el cruce contra tu rival de línea?
 *
 * `counterScore` cuenta el cruce contra el rival de línea con peso 2 y los
 * demás con peso 1. Es una decisión de diseño que nunca se había medido
 * contra resultados. Las partidas profesionales (historial/pro-partidas.jsonl)
 * permiten hacerlo: se sabe quién ganó, y las líneas se pueden asignar con
 * el mismo mecanismo que la app (probabilidadDeLinea, mejor permutación).
 *
 *   node scripts/medir-rival.mjs               últimos 120 días
 *   node scripts/medir-rival.mjs --dias 400    toda la muestra (otro parche)
 *
 * MÉTODO. Para cada partida, por línea l, el par (a_l, e_l) es el cruce de
 * línea. R = Σ_l logit(c[a_l][e_l]) (cinco cruces), O = Σ del resto (veinte).
 * Se ajusta una logística gana ~ a + bR·R + bO·O: el motor supone bR/bO = 2.
 * Y se compara la verosimilitud de gana ~ a + b·(k·R + O) con k = 1, 2, 3:
 * si k=2 no mejora a k=1, el doble no aporta nada medible.
 *
 * Solo entran las partidas con las diez líneas claras (detectarRivalDeLinea
 * no dudó en ninguna): el resto se cuenta aparte, porque un cruce "de línea"
 * mal asignado es ruido puro.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCatalog, indexByName, normName, matchup, LINEAS } from '../src/engine/score.js';
import { indiceDeLineas, frecuenciaDeRoles, probabilidadDeLinea, detectarRivalDeLinea } from '../src/engine/rival-de-linea.js';
import { resolverHeroe } from './ingesta-pro.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const logit = (p) => Math.log(p / (1 - p));
const sigmoide = (x) => 1 / (1 + Math.exp(-x));

function permutaciones(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutaciones([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Mejor reparto de cinco héroes en las cinco líneas: { linea: héroe }. */
export function asignarLineas(equipo, info, frec) {
  const P = equipo.map((h) => Object.fromEntries(LINEAS.map((l) => [l, probabilidadDeLinea(h, info.get(normName(h.name)), l, frec)])));
  let mejor = null;
  for (const perm of permutaciones([...LINEAS])) {
    const total = perm.reduce((s, l, i) => s + P[i][l], 0);
    if (!mejor || total > mejor.total) mejor = { total, perm };
  }
  return Object.fromEntries(mejor.perm.map((l, i) => [l, equipo[i]]));
}

/** Regresión logística y ~ X·b por Newton-Raphson (X con columna de unos). */
export function logistica(X, y, iteraciones = 60) {
  const k = X[0].length;
  let b = new Array(k).fill(0);
  const resolver = (A, v) => {
    // Gauss con pivote parcial.
    const M = A.map((f, i) => [...f, v[i]]);
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < k; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((f, i) => f[k] / f[i]);
  };
  let H = null;
  for (let it = 0; it < iteraciones; it++) {
    const g = new Array(k).fill(0);
    H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let n = 0; n < X.length; n++) {
      const x = X[n]; const p = sigmoide(x.reduce((s, v, j) => s + v * b[j], 0)); const w = p * (1 - p); const e = p - y[n];
      for (let i = 0; i < k; i++) { g[i] += e * x[i]; for (let j = 0; j < k; j++) H[i][j] += w * x[i] * x[j]; }
    }
    const paso = resolver(H, g);
    if (!paso) break;
    b = b.map((v, i) => v - paso[i]);
    if (paso.reduce((s, v) => s + Math.abs(v), 0) < 1e-9) break;
  }
  // Errores típicos: raíz de la diagonal de la inversa de la hessiana.
  const inv = [];
  for (let i = 0; i < k; i++) { const e = new Array(k).fill(0); e[i] = 1; inv.push(resolver(H, e)); }
  const se = b.map((_, i) => (inv[i] ? Math.sqrt(Math.max(0, inv[i][i])) : null));
  const logL = X.reduce((s, x, n) => { const p = sigmoide(x.reduce((a, v, j) => a + v * b[j], 0)); return s + Math.log(y[n] ? p : 1 - p); }, 0);
  return { b, se, logL };
}

export function medirRival(partidas, { M, info, frec }) {
  const claras = []; const dudosas = [];
  for (const p of partidas) {
    const [A, E] = p.equipos;
    const la = asignarLineas(A, info, frec); const le = asignarLineas(E, info, frec);
    const seguras = LINEAS.every((l) => detectarRivalDeLinea(A, info, l, frec) === la[l].name && detectarRivalDeLinea(E, info, l, frec) === le[l].name);
    let R = 0; let O = 0; let rivalesGanados = 0;
    for (const a of A) for (const e of E) {
      const c = matchup(M.counters, a.name, e.name);
      if (c == null || c <= 0.02 || c >= 0.98) continue;
      const deLinea = LINEAS.some((l) => la[l] === a && le[l] === e);
      if (deLinea) { R += logit(c); if (c > 0.5) rivalesGanados += 1; } else O += logit(c);
    }
    (seguras ? claras : dudosas).push({ R, O, rivalesGanados, y: p.ganador === 1 ? 1 : 0 });
  }
  const resumen = (filas) => {
    if (filas.length < 30) return { n: filas.length };
    const y = filas.map((f) => f.y);
    const libre = logistica(filas.map((f) => [1, f.R, f.O]), y);
    const porK = Object.fromEntries([1, 2, 3].map((k) => [k, logistica(filas.map((f) => [1, k * f.R + f.O]), y)]));
    const soloR = logistica(filas.map((f) => [1, f.R]), y); const soloO = logistica(filas.map((f) => [1, f.O]), y);
    // Gana más cruces de línea que pierde → ¿gana la partida?
    const mas = filas.filter((f) => f.rivalesGanados >= 3); const menos = filas.filter((f) => f.rivalesGanados <= 2);
    return {
      n: filas.length,
      bR: libre.b[1], seR: libre.se[1], bO: libre.b[2], seO: libre.se[2],
      ratio: libre.b[2] ? libre.b[1] / libre.b[2] : null,
      logL: Object.fromEntries(Object.entries(porK).map(([k, v]) => [k, v.logL])),
      pendienteK: Object.fromEntries(Object.entries(porK).map(([k, v]) => [k, [v.b[1], v.se[1]]])),
      soloR: [soloR.b[1], soloR.se[1]], soloO: [soloO.b[1], soloO.se[1]],
      ganaConMasLineas: mas.length ? mas.filter((f) => f.y).length / mas.length : null, nMas: mas.length,
      ganaConMenosLineas: menos.length ? menos.filter((f) => f.y).length / menos.length : null, nMenos: menos.length,
    };
  };
  return { claras: resumen(claras), dudosas: resumen(dudosas), todas: resumen([...claras, ...dudosas]) };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dias'); const dias = i >= 0 ? Number(args[i + 1]) : 120;
  const desde = new Date(Date.now() - dias * 86400e3).toISOString().slice(0, 10);
  const lineas = (await readFile(resolve(ROOT, 'historial/pro-partidas.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cat = JSON.parse(await readFile(resolve(ROOT, 'public/data/heroes.json'), 'utf8'));
  const meta = JSON.parse(await readFile(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const heroes = mergeCatalog(cat.heroes, meta.heroes ?? []);
  const info = indiceDeLineas(meta.heroes ?? []); const frec = frecuenciaDeRoles(heroes);
  const M = { counters: indexByName(meta.counters, 2) };
  const indice = new Map(heroes.map((h) => [normName(h.name), h]));
  const usables = [];
  for (const p of lineas.filter((x) => x.fecha && x.fecha >= desde)) {
    const eq = p.picks.map((lado) => lado.map((s) => resolverHeroe(s, indice)));
    if (eq.flat().every(Boolean)) usables.push({ ...p, equipos: eq });
  }
  console.log(`Partidas desde ${desde}: ${usables.length} usables · datos del ${meta.generatedAt?.slice(0, 10)}`);
  const r = medirRival(usables, { M, info, frec });
  const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
  for (const [nombre, s] of Object.entries(r)) {
    console.log(`\n== ${nombre}: n=${s.n}`);
    if (!s.bR && s.n < 30) { console.log('  (menos de 30: no se mide)'); continue; }
    console.log(`  gana ~ a + bR·R + bO·O   bR ${f(s.bR)} ± ${f(s.seR)} · bO ${f(s.bO)} ± ${f(s.seO)} · ratio bR/bO ${f(s.ratio)}  (el motor supone 2)`);
    console.log(`  solo cruces de línea (R): pendiente ${f(s.soloR[0])} ± ${f(s.soloR[1])} · solo los otros veinte (O): ${f(s.soloO[0])} ± ${f(s.soloO[1])}`);
    console.log(`  log-verosimilitud con el rival a peso k: k=1 ${f(s.logL[1], 1)} · k=2 ${f(s.logL[2], 1)} · k=3 ${f(s.logL[3], 1)}  (más alto = mejor; una diferencia < 2 no distingue)`);
    console.log(`  gana ≥3 cruces de línea → gana la partida el ${f((s.ganaConMasLineas ?? 0) * 100, 1)}% (n=${s.nMas}) · ≤2 → ${f((s.ganaConMenosLineas ?? 0) * 100, 1)}% (n=${s.nMenos})`);
  }
}

const ejecutadoDirectamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ejecutadoDirectamente) main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
