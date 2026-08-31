// Comprobaciones sobre el CSS que no requieren navegador.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'src/styles.css'),'utf8');
const fallos = [];

// 1) nada esencial oculto en movil
for (const sel of ['.slot .x', '.pie', '.reset', '.hero-grid']) {
  const re = new RegExp(`\\${sel.replace(/\./g,'\\.')}[^{]*\\{[^}]*display:\\s*none`);
  if (re.test(css)) fallos.push(`${sel} se oculta en algún sitio`);
}
// 2) toda variable var(--x) usada debe estar declarada
const usadas = [...css.matchAll(/var\((--[\w-]+)\)/g)].map(m=>m[1]);
const declaradas = new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map(m=>m[1]));
const huerfanas = [...new Set(usadas)].filter(v=>!declaradas.has(v));
if (huerfanas.length) fallos.push('variables sin declarar: '+huerfanas.join(', '));
// 3) llaves balanceadas
if ((css.match(/{/g)||[]).length !== (css.match(/}/g)||[]).length) fallos.push('llaves desbalanceadas');
// 4) clases usadas en los JSX que no existen en el CSS
const jsx = ['src/App.jsx','src/components/ui.jsx','src/main.jsx']
  .map(f=>readFileSync(resolve(ROOT, f),'utf8')).join('\n');
// Se miran los TEXTOS, no los identificadores. Con className={x === y ? 'a' : ''}
// la version anterior se quedaba con `x` y lo daba por una clase: funcionaba
// solo porque las variables se llamaban como clases que existian (`pick`,
// `mastery`). En cuanto una se llamo `heroe`, falso positivo.
const clases = new Set();
for (const m of jsx.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
  const literal = m[1];
  if (literal != null) {
    for (const c of literal.split(/\s+/)) if (c) clases.add(c);
    continue;
  }
  // Dentro de una expresion, solo lo que va entre comillas es un nombre de clase.
  for (const t of m[2].matchAll(/['"`]([^'"`]*)['"`]/g)) {
    for (const c of t[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) clases.add(c);
  }
}
// Se comprueba contra el CSS SIN los bloques @media. Una clase que solo tiene
// estilo dentro de una consulta de medios funciona en un tamano de pantalla y
// en los demas no, que es peor que no tener estilo porque parece que va bien.
// Paso de verdad: `.slot-cara` acabo dentro del bloque de movil por descuido y
// la cara del heroe tapaba el nombre solo en el movil.
const cssBase = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
const sinEstilo = [...clases].filter(c=>!cssBase.includes('.'+c));
if (sinEstilo.length) fallos.push('clases sin estilo fuera de un @media: '+sinEstilo.join(', '));

console.log(fallos.length ? 'FALLOS:\n  '+fallos.join('\n  ') : 'CSS correcto: sin ocultaciones, variables declaradas, clases con estilo.');

process.exit(fallos.length ? 1 : 0);
