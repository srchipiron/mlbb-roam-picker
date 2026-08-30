#!/usr/bin/env node
/**
 * ¿La corrida nueva es peor que la que ya está guardada?
 *
 * La ingesta se degrada EN SILENCIO y de forma legítima: si un endpoint falla,
 * conserva los datos anteriores y solo cambia `diagnostics`. Eso hace que una
 * corrida mala se parezca a una buena en el diff, y el bot de datos la
 * commitea igual. Ya pasó: el fichero guardado se quedó con 0 líneas, 0 roles
 * y counters de 34 héroes en vez de 133, y nada chilló.
 *
 * Este script compara las dos y sale con 1 si la nueva resuelve MENOS. Se usa
 * en `update-data.yml` antes del commit, y en el despliegue.
 *
 *   node scripts/comparar-ingesta.mjs <nueva.json> <guardada.json>
 *
 * Si no existe la guardada, la nueva pasa: no hay con qué comparar.
 */

import { readFile } from 'node:fs/promises';

/** Las cuatro cosas que la app necesita, contadas. Nada de porcentajes. */
export function medir(datos) {
  const heroes = datos?.heroes ?? [];
  return {
    heroes: heroes.length,
    conLinea: heroes.filter((h) => Array.isArray(h?.lanes) && h.lanes.length).length,
    conRol: heroes.filter((h) => h?.role).length,
    stats: Object.keys(datos?.stats ?? {}).length,
    counters: Object.keys(datos?.counters ?? {}).length,
  };
}

/**
 * Un margen del 10% para el ruido normal de la API (un héroe que ese día no
 * devuelve counters no es una regresión). Por debajo de eso, sí lo es.
 */
export const MARGEN = 0.9;

export function comparar(nueva, guardada) {
  const a = medir(nueva);
  const b = medir(guardada);
  const peores = [];
  for (const clave of Object.keys(b)) {
    if (b[clave] > 0 && a[clave] < b[clave] * MARGEN) {
      peores.push({ clave, antes: b[clave], ahora: a[clave] });
    }
  }
  return { nueva: a, guardada: b, peores };
}

const leer = async (ruta) => {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    return null;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rutaNueva, rutaGuardada] = process.argv.slice(2);
  if (!rutaNueva) {
    console.error('uso: node scripts/comparar-ingesta.mjs <nueva.json> [guardada.json]');
    process.exit(2);
  }
  const nueva = await leer(rutaNueva);
  if (!nueva) {
    console.error(`No se ha podido leer la corrida nueva: ${rutaNueva}`);
    process.exit(2);
  }
  const guardada = rutaGuardada ? await leer(rutaGuardada) : null;
  if (!guardada) {
    console.log('No hay corrida anterior con la que comparar: se acepta.');
    process.exit(0);
  }

  const { nueva: a, guardada: b, peores } = comparar(nueva, guardada);
  const linea = (m) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join('  ');
  console.log(`guardada: ${linea(b)}`);
  console.log(`nueva:    ${linea(a)}`);

  if (peores.length) {
    console.error('\nLa corrida nueva resuelve MENOS que la guardada:');
    for (const p of peores) console.error(`  ${p.clave}: ${p.antes} → ${p.ahora}`);
    console.error('\nNo se commitea: los datos de antes son mejores.');
    process.exit(1);
  }
  console.log('\nLa corrida nueva no empeora nada.');
}
