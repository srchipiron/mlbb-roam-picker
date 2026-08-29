#!/usr/bin/env node
/**
 * Detecta consts usadas antes de declararse DENTRO DE LA MISMA función.
 * Ese fallo no da error al compilar: la app arranca, revienta y deja la pantalla
 * en negro. Sin herramientas de desarrollo en el móvil cuesta mucho localizarlo,
 * así que se comprueba aquí antes de subir nada.
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
let fallos = 0;

/** Trocea el fichero en funciones de primer nivel. */
function bloques(lines) {
  const inicios = [];
  lines.forEach((line, i) => {
    if (/^(export\s+)?(default\s+)?function\s+\w+/.test(line)) inicios.push(i);
  });
  return inicios.map((start, idx) => ({
    start,
    end: idx + 1 < inicios.length ? inicios[idx + 1] : lines.length,
  }));
}

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');

  for (const { start, end } of bloques(lines)) {
    // Solo las declaraciones del cuerpo principal (dos espacios de sangría):
    // las anidadas viven en su propio ámbito y no aplican.
    const declared = new Map();
    for (let i = start; i < end; i++) {
      const m = lines[i].match(/^ {2}const\s+([A-Za-z_$][\w$]*)\s*=/);
      if (m && !declared.has(m[1])) declared.set(m[1], i);
    }

    for (const [name, declLine] of declared) {
      const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
      for (let i = start; i < declLine; i++) {
        // Fuera los accesos a propiedad (.enemies), las claves de objeto
        // (enemies:) y las cadenas: no son usos de la variable.
        const line = lines[i]
          .replace(/\.\s*[A-Za-z_$][\w$]*/g, '')
          .replace(/([A-Za-z_$][\w$]*)\s*:/g, '')
          .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '');
        if (!re.test(line) || /^\s*(\/\/|\*|import)/.test(lines[i])) continue;
        console.error(`${file}:${i + 1} usa "${name}", declarada en la línea ${declLine + 1}`);
        fallos++;
        break;
      }
    }
  }
}

if (fallos) {
  console.error(`\n${fallos} uso(s) antes de declarar: la app no arrancaría.`);
  process.exit(1);
}
console.log('Orden de declaraciones correcto.');
