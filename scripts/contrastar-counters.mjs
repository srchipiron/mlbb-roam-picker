#!/usr/bin/env node
/**
 * ¿Coincide nuestra matriz de counters con lo que dicen los humanos?
 *
 * mlbb.gg publica, para cada héroe, una lista CURADA de cinco o seis counters:
 * sin números, elegidos por alguien que sabe del juego. Nosotros tenemos 132
 * cruces por héroe con winrates reales.
 *
 * No sirven para sustituir a los nuestros -serían seis opiniones en lugar de
 * 132 medidas-, pero sí para lo más difícil de conseguir: una comprobación
 * INDEPENDIENTE. Si a los héroes que ellos señalan les va sistemáticamente bien
 * en nuestros datos, las dos fuentes se apoyan. Si no, una de las dos miente.
 *
 *   node scripts/contrastar-counters.mjs            # una muestra de 25 héroes
 *   node scripts/contrastar-counters.mjs --todos    # los 133
 *
 * No escribe nada en `public/data`: esto se lee, no se aplica.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexByName, matchup, normName } from '../src/engine/score.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
const counters = indexByName(raw.counters ?? {}, 2);
const heroes = raw.heroes ?? [];
const TODOS = process.argv.includes('--todos');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Los rivales de un héroe, ordenados de mejor a peor cruce contra él. */
function ordenContra(nombre) {
  return heroes
    .map((h) => ({ nombre: h.name, v: matchup(counters, h.name, nombre) }))
    .filter((x) => x.v != null && x.nombre !== nombre)
    .sort((a, b) => b.v - a.v);
}

const traer = async (id) => {
  const res = await fetch(`https://back.mlbb.gg/api/v1/heroes/${id}/counters`, {
    headers: { 'User-Agent': 'mobile-legends-pick-assist (contraste, uso personal)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.data ?? []).map((x) => x.name).filter(Boolean);
};

const lista = TODOS ? heroes : heroes.filter((_, i) => i % Math.ceil(heroes.length / 25) === 0);
console.log(`Contrastando ${lista.length} héroes contra la lista curada de mlbb.gg\n`);

const puestos = [];
let sinDato = 0;
let fallos = 0;
for (const h of lista) {
  if (!h.id) continue;
  let suyos;
  try {
    suyos = await traer(h.id);
  } catch (err) {
    fallos++;
    continue;
  }
  const orden = ordenContra(h.name);
  if (!orden.length || !suyos.length) { sinDato++; continue; }

  const p = suyos.map((n) => {
    const i = orden.findIndex((x) => normName(x.nombre) === normName(n));
    return i < 0 ? null : i + 1;
  }).filter((x) => x != null);
  puestos.push(...p);

  const total = orden.length;
  console.log(`${h.name.padEnd(14)} ${suyos.map((n, i) => {
    const q = orden.findIndex((x) => normName(x.nombre) === normName(n));
    return `${n} ${q < 0 ? '(?)' : `#${q + 1}`}`;
  }).join(' · ')}   de ${total}`);
  await sleep(250);
}

if (!puestos.length) {
  console.log('\nNo se ha podido contrastar nada.');
  process.exit(fallos ? 1 : 0);
}

puestos.sort((a, b) => a - b);
const media = puestos.reduce((a, b) => a + b, 0) / puestos.length;
const mediana = puestos[Math.floor(puestos.length / 2)];
const enTop = (n) => puestos.filter((p) => p <= n).length / puestos.length;

console.log(`\n${puestos.length} counters curados contrastados${fallos ? ` (${fallos} héroes fallaron)` : ''}`);
console.log(`  puesto medio en NUESTRO orden: ${media.toFixed(1)} de ~132 · mediana ${mediana}`);
console.log(`  en nuestro top 10:  ${(enTop(10) * 100).toFixed(0)}%`);
console.log(`  en nuestro top 20:  ${(enTop(20) * 100).toFixed(0)}%`);
console.log(`  en nuestra mitad buena: ${(enTop(66) * 100).toFixed(0)}%`);
console.log('\nAl azar saldría 50% en la mitad buena y un puesto medio de ~66.');
console.log('Muy por encima = las dos fuentes se apoyan; alrededor del azar = una de las dos miente.');
