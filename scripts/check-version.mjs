#!/usr/bin/env node
/**
 * La versión que se va a publicar tiene que estar documentada.
 *
 * No es burocracia: la versión sale en el pie de la app y es la única forma de
 * saber desde el móvil si lo que estás mirando es lo que acabas de subir. Si
 * subes comportamiento sin tocar la versión, el pie miente; y si tocas la
 * versión sin explicar qué cambia, dentro de un mes no hay manera de saber qué
 * pasó en cada una.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

let changelog;
try {
  changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
} catch {
  console.error('FALLO: no hay CHANGELOG.md');
  process.exit(1);
}

const titulos = [...changelog.matchAll(/^##\s+(\S+)/gm)].map((m) => m[1]);

if (!titulos.includes(version)) {
  console.error(`FALLO: la versión ${version} de package.json no tiene entrada en CHANGELOG.md`);
  console.error(`       versiones documentadas: ${titulos.slice(0, 5).join(', ') || 'ninguna'}`);
  console.error(`       añade una sección "## ${version}" contando qué cambia para quien usa la app`);
  process.exit(1);
}

// La entrada tiene que decir algo: un título suelto no documenta nada.
const cuerpo = changelog.split(new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\s*$`, 'm'))[1] ?? '';
const texto = cuerpo.split(/^## /m)[0].trim();
if (texto.length < 20) {
  console.error(`FALLO: la entrada de ${version} en CHANGELOG.md está vacía`);
  process.exit(1);
}

console.log(`Versión ${version} documentada en CHANGELOG.md.`);
