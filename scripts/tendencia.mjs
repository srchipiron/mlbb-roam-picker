#!/usr/bin/env node
/**
 * Qué se está moviendo en la salud de la app, según el historial.
 *
 * Un umbral solo salta cuando ya es tarde. Una serie enseña la pendiente: la
 * cobertura que baja poco a poco, el ruido que sube, los datos que envejecen
 * porque la actualización lleva días fallando. Eso es lo que hay que mirar
 * antes de decidir qué va en la versión siguiente.
 *
 *   node scripts/tendencia.mjs          lo que ha cambiado
 *   node scripts/tendencia.mjs --todo   todas las filas
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = resolve(ROOT, 'historial/salud.jsonl');

let filas;
try {
  filas = readFileSync(RUTA, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch {
  console.log('Todavía no hay historial. Lo va llenando la vigilancia, dos veces al día.');
  process.exit(0);
}

if (!filas.length) {
  console.log('El historial está vacío.');
  process.exit(0);
}

const fecha = (f) => new Date(f.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

if (process.argv.includes('--todo')) {
  for (const f of filas) {
    console.log(`${fecha(f)}  fallos=${f.fallos} avisos=${f.avisos} cruces=${f.cruces} `
      + `cobertura=${((f.cobertura ?? 0) * 100).toFixed(1)}% ruido=${f.ruido ?? '—'} edad=${f.edadHoras}h`);
  }
  process.exit(0);
}

const primera = filas[0];
const ultima = filas[filas.length - 1];
console.log(`${filas.length} corridas · de ${fecha(primera)} a ${fecha(ultima)}\n`);

/** Campos que importan y cuánto tiene que moverse uno para merecer una línea. */
const VIGILADOS = [
  ['cruces', 'cruces de la matriz', 100, (v) => v],
  ['sinergias', 'sinergias', 100, (v) => v],
  ['cobertura', 'cobertura de counters', 0.01, (v) => `${(v * 100).toFixed(1)}%`],
  ['ruido', 'ruido de los héroes raros', 0.1, (v) => `${v}x`],
  ['recorteCounters', 'recorte de counters', 0.01, (v) => `${(v * 100).toFixed(1)}%`],
  ['recorteSinergias', 'recorte de sinergias', 0.01, (v) => `${(v * 100).toFixed(1)}%`],
  ['conDano', 'héroes con tipo de daño', 1, (v) => v],
  ['conLinea', 'héroes con línea', 1, (v) => v],
];

const cambios = [];
for (const [campo, nombre, minimo, fmt] of VIGILADOS) {
  const a = primera[campo];
  const b = ultima[campo];
  if (a == null || b == null) continue;
  if (Math.abs(b - a) >= minimo) {
    cambios.push(`  ${nombre}: ${fmt(a)} → ${fmt(b)}`);
  }
}

if (cambios.length) {
  console.log('Ha cambiado:');
  console.log(cambios.join('\n'));
} else {
  console.log('Nada de lo vigilado se ha movido de forma apreciable.');
}

const conFallos = filas.filter((f) => f.fallos > 0);
console.log(`\nCorridas con fallos: ${conFallos.length} de ${filas.length}`);
if (conFallos.length) {
  for (const f of conFallos.slice(-5)) console.log(`  ${fecha(f)} · ${f.fallos} fallos`);
}

const viejos = filas.filter((f) => (f.edadHoras ?? 0) > 24);
if (viejos.length) {
  console.log(`\nCorridas con datos de más de 24 h: ${viejos.length}`
    + ` (la peor, ${Math.max(...viejos.map((f) => f.edadHoras)).toFixed(0)} h)`);
}

// Los pools por linea: si uno se vacia, esa linea deja de servir y no lo dice
// ningun umbral suelto.
if (ultima.pools) {
  const bajadas = Object.entries(ultima.pools)
    .filter(([l, n]) => primera.pools?.[l] != null && n < primera.pools[l] - 2)
    .map(([l, n]) => `${l} ${primera.pools[l]} → ${n}`);
  if (bajadas.length) console.log(`\nLíneas que han perdido héroes: ${bajadas.join(', ')}`);
}
