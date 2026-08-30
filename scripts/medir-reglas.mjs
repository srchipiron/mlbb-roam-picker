#!/usr/bin/env node
/**
 * ¿Las reglas escritas a mano las sostiene el dato?
 *
 * Desde que la matriz de counters viene completa (17.556 cruces reales, no los
 * 1.330 de antes) se puede preguntar por fin lo que CLAUDE.md lleva pidiendo
 * desde el principio: cada regla de `rules.js` dice que tener cierto tag te da
 * ventaja contra cierto otro. ¿Se nota en las partidas de verdad?
 *
 * Para cada regla compara la media de cruce de los héroes QUE tienen el tag
 * contra los enemigos con el tag enemigo, con la de los que NO lo tienen.
 *
 *   node scripts/medir-reglas.mjs
 *
 * Aviso importante sobre lo que este número puede y no puede decir: la API da
 * el winrate de A en las partidas donde estaba B, no el de su duelo de carril.
 * Ahí dentro van partidas en las que ni se cruzaron, así que un efecto real de
 * carril sale DILUIDO. Un "+0.02pp" no demuestra que la regla sea falsa;
 * demuestra que, medido así, no se ve. Sirve para ordenar las reglas de más a
 * menos sostenida, no para borrarlas.
 *
 * Solo se miran los héroes con tags escritos a mano: los deducidos meterían
 * su propio error dentro de la medida.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexByName, mergeCatalog, matchup } from '../src/engine/score.js';
import { COUNTER_RULES } from '../src/engine/rules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', f), 'utf8'));

const raw = leer('roam-meta.json');
const catalogo = leer('heroes.json').heroes;
const heroes = mergeCatalog(catalogo, raw.heroes ?? []);
const counters = indexByName(raw.counters ?? {}, 2);

const propios = new Set(catalogo.map((h) => h.name));
const conTags = heroes.filter((h) => propios.has(h.name));

/** A partir de aquí la diferencia deja de ser ruido, en puntos de winrate. */
const NOTABLE = 0.004;

const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const cruces = Object.keys(raw.counters ?? {})
  .reduce((n, k) => n + Object.keys(raw.counters[k] ?? {}).length, 0);

console.log(`Reglas de counter contra ${cruces} cruces reales · ${conTags.length} héroes con tags escritos a mano\n`);
console.log('regla                          n con/sin   con tag   sin tag   ventaja   peso');
console.log('-'.repeat(78));

const filas = [];
for (const regla of COUNTER_RULES) {
  const enemigos = conTags.filter((h) => h.tags.includes(regla.enemyTag));
  if (!enemigos.length) continue;

  const con = [];
  const sin = [];
  for (const yo of conTags) {
    const vals = enemigos
      .filter((e) => e.name !== yo.name)
      .map((e) => matchup(counters, yo.name, e.name))
      .filter((v) => v != null);
    if (!vals.length) continue;
    (yo.tags.includes(regla.roamTag) ? con : sin).push(media(vals));
  }
  if (con.length < 3 || !sin.length) continue;

  const dif = media(con) - media(sin);
  // La regla puede ser un castigo (peso negativo): entonces lo que la sostiene
  // es que los que tienen el tag vayan PEOR.
  const esperada = Math.sign(regla.weight) * dif;
  filas.push({ regla, con: con.length, sin: sin.length, mCon: media(con), mSin: media(sin), dif, esperada });
}

filas.sort((a, b) => b.esperada - a.esperada);
for (const f of filas) {
  const veredicto = f.esperada >= NOTABLE ? 'la sostiene'
    : f.esperada <= -NOTABLE ? 'LA CONTRADICE' : 'no se ve';
  console.log(
    `${f.regla.why.padEnd(28)} ${String(f.con).padStart(3)}/${String(f.sin).padEnd(4)} `
    + `${f.mCon.toFixed(4)}    ${f.mSin.toFixed(4)}   ${((f.dif >= 0 ? '+' : '') + (f.dif * 100).toFixed(2) + 'pp').padStart(8)}   `
    + `${String(f.regla.weight).padStart(5)}  ${veredicto}`,
  );
}

const sostenidas = filas.filter((f) => f.esperada >= NOTABLE);
console.log(`\n${sostenidas.length} de ${filas.length} reglas se ven en el dato.`);
console.log('Recuerda: "no se ve" no es "es falsa". El dato es de presencia en la');
console.log('partida, no del duelo de carril, y eso diluye los efectos reales.');
