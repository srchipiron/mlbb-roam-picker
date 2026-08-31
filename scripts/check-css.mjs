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
// 3) las consultas de medios, al final del fichero
//
// Una @media NO anade especificidad: si una regla base con el mismo selector se
// escribe DESPUES, la pisa entera y la consulta no hace nada. Los tres bloques
// de movil estaban al principio y por eso NO se aplicaba ninguno: el movil
// llevaba ensenando el diseno de escritorio -nombres a 24px, huecos de 84px-
// sin que nada fallara. Medido: `.slot` pedia min-width 0 y salia 84px.
//
// La regla es simple y basta: ninguna regla normal despues del primer @media.
{
  const bloques = [];
  let i = 0;
  while (i < css.length) {
    const j = css.indexOf('@media', i);
    if (j < 0) break;
    const abre = css.lastIndexOf('/*', j);   // un @media citado en un comentario
    const cierra = css.lastIndexOf('*/', j); // no es un bloque
    if (abre > cierra) { i = j + 6; continue; }
    const k = css.indexOf('{', j);
    let nivel = 0;
    let m = k;
    for (; m < css.length; m++) {
      if (css[m] === '{') nivel++;
      else if (css[m] === '}' && --nivel === 0) break;
    }
    bloques.push([j, m]);
    i = m + 1;
  }
  if (bloques.length) {
    const primero = bloques[0][0];
    // Lo que hay tras el primer @media quitando los propios bloques.
    let resto = '';
    let desde = bloques[0][1] + 1;
    for (const [a, b] of bloques.slice(1)) { resto += css.slice(desde, a); desde = b + 1; }
    resto += css.slice(desde);
    const tardias = [...resto.matchAll(/(^|\n)\s*([^{}@\n/][^{}\n]*?)\s*\{/g)].map((x) => x[2].trim());
    if (tardias.length) {
      fallos.push(`reglas escritas DESPUES del primer @media (que va en la posicion ${primero}): `
        + `${tardias.slice(0, 6).join(', ')}. Las consultas de medios van al FINAL o no se aplican.`);
    }
  }
}

// 4) llaves balanceadas
if ((css.match(/{/g)||[]).length !== (css.match(/}/g)||[]).length) fallos.push('llaves desbalanceadas');
// 4) clases usadas en los JSX que no existen en el CSS
const jsx = ['src/App.jsx','src/components/ui.jsx','src/main.jsx']
  .map(f=>readFileSync(resolve(ROOT, f),'utf8')).join('\n');
// Se miran los TEXTOS, no los identificadores. Con className={x === y ? 'a' : ''}
// la version anterior se quedaba con `x` y lo daba por una clase: funcionaba
// solo porque las variables se llamaban como clases que existian (`pick`,
// `mastery`). En cuanto una se llamo `heroe`, falso positivo.
const clases = new Set();

// La expresion de className puede tener llaves DENTRO (un ternario en una
// plantilla, por ejemplo), asi que se recorre balanceando en vez de cortar en
// la primera `}`. Con el corte, `className={`${a ? 'x' : 'y'} ${b ? 'z' : ''}`}`
// se leia hasta la primera llave y la clase `z` no se comprobaba nunca: paso
// de verdad con `de-equipo`, que quedo sin estilo pasando el control.
function expresionDeClassName(texto, desde) {
  let nivel = 0;
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) return texto.slice(desde + 1, i);
  }
  return '';
}

for (const m of jsx.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
  const literal = m[1];
  if (literal != null) {
    for (const c of literal.split(/\s+/)) if (c) clases.add(c);
    continue;
  }
  // Dentro de una expresion, solo lo que va entre comillas es un nombre de
  // clase. Se recorre con un lector de verdad en vez de con una expresion
  // regular: emparejando comillas a ojo, una plantilla como
  // `slot ${a === b ? 'marked' : ''}` casaba la comilla de apertura con la
  // primera simple y colaba `autoName` como si fuera una clase.
  for (const cadena of cadenasDe(expresionDeClassName(jsx, m.index + m[0].length - 1))) {
    for (const c of cadena.split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) clases.add(c);
  }
}

/** Los textos literales de una expresion: comillas simples, dobles y los trozos
 *  fijos de una plantilla, entrando en sus `${...}` para leer los de dentro. */
function cadenasDe(expr) {
  const fuera = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'" || c === '"') {
      const fin = expr.indexOf(c, i + 1);
      if (fin < 0) break;
      fuera.push(expr.slice(i + 1, fin));
      i = fin + 1;
    } else if (c === '`') {
      let j = i + 1;
      let trozo = '';
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '$' && expr[j + 1] === '{') {
          fuera.push(trozo); trozo = '';
          let nivel = 1; j += 2;
          const desde = j;
          while (j < expr.length && nivel) {
            if (expr[j] === '{') nivel++;
            else if (expr[j] === '}') nivel--;
            j++;
          }
          fuera.push(...cadenasDe(expr.slice(desde, j - 1)));
        } else { trozo += expr[j]; j++; }
      }
      fuera.push(trozo);
      i = j + 1;
    } else i++;
  }
  return fuera;
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
