/**
 * El CHANGELOG.md, leído para la app.
 *
 * Desde 1.30.0 el número de versión del pie abre las novedades. No se
 * escriben dos veces: se leen del mismo CHANGELOG.md que exige
 * `check-version.mjs`, en la compilación (`vite.config.js` lo mete en
 * `__CHANGELOG__`), así que están en el móvil sin red y no pueden
 * desincronizarse de la versión.
 *
 * Formato que se espera, y que es el que hay: `## X.Y.Z` por versión y
 * viñetas `- ` que pueden continuar en líneas indentadas.
 */

/** @returns [{ version, cambios: [texto] }] en el orden del fichero (la más nueva primero). */
export function parsearChangelog(md, maximo = 12) {
  const entradas = [];
  let actual = null;
  // Una vineta sigue en las lineas indentadas; un parrafo (las versiones
  // antiguas van en parrafos, uno por cambio) sigue hasta la linea en blanco.
  let abierto = false;
  for (const linea of (md ?? '').split('\n')) {
    const v = linea.match(/^## (\d+\.\d+\.\d+)\s*$/);
    if (v) {
      actual = { version: v[1], cambios: [] };
      entradas.push(actual);
      abierto = false;
      continue;
    }
    if (!actual) continue;
    if (!linea.trim()) { abierto = false; continue; }
    if (/^[-*] /.test(linea)) { actual.cambios.push(linea.slice(2).trim()); abierto = true; continue; }
    if (/^#/.test(linea)) { abierto = false; continue; }
    if (abierto && actual.cambios.length) actual.cambios[actual.cambios.length - 1] += ` ${linea.trim()}`;
    else { actual.cambios.push(linea.trim()); abierto = true; }
  }
  return entradas.slice(0, maximo).map((e) => ({ ...e, cambios: e.cambios.map(sinMarkdown) }));
}

/** Quita negritas y código: en la app no se renderiza markdown. */
export function sinMarkdown(texto) {
  return texto.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * La primera frase de un cambio, que es el resumen. Una viñeta del changelog
 * empieza por lo que cambia y sigue con el porqué; en el móvil se quiere lo
 * primero y el porqué a un toque.
 */
export function resumen(texto) {
  const m = texto.match(/^(.{20,}?[.:;])\s/);
  return m ? m[1].replace(/[:;]$/, '.') : texto;
}
