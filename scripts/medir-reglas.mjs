#!/usr/bin/env node
/**
 * ¿Las reglas escritas a mano las sostiene el dato? Y sobre todo: ¿a QUIÉN?
 *
 * Desde 1.5.0 la matriz de counters viene completa (17.556 cruces reales), así
 * que por fin se puede comprobar lo que CLAUDE.md lleva pidiendo desde el
 * principio. Cada regla de `rules.js` dice que tener cierto tag te da ventaja
 * contra los enemigos que tienen otro. Aquí se mide.
 *
 *   node scripts/medir-reglas.mjs           resumen por regla
 *   node scripts/medir-reglas.mjs --tags    además, qué tags habría que tocar
 *
 * MÉTODO. Para cada héroe se comparan sus cruces contra los enemigos CON el tag
 * enemigo y contra los demás, con una t de Welch (dos grupos, varianzas
 * distintas). Y como se hacen cientos de comparaciones a la vez, se controla la
 * tasa de falsos hallazgos con Benjamini-Hochberg al 5%: sin eso, con 133
 * héroes saldrían ~3 "hallazgos" por regla solo por azar.
 *
 * QUÉ MIDE ESA t, exactamente. La API no dice de cuántas partidas sale cada
 * cruce, así que no es un error de muestreo: es la variación del héroe ENTRE
 * rivales. La pregunta que responde es "¿este héroe va mejor contra ese
 * arquetipo de lo que varía normalmente de un rival a otro?". Que es justo la
 * pregunta de la regla.
 *
 * POR QUÉ POR HÉROE Y NO EN BLOQUE. La primera versión de este script promediaba
 * todos los héroes con el tag contra todos los que no, y le salía que once de
 * las doce reglas "no se ven". Estaba mal planteado: si el tag está puesto a
 * nueve héroes y solo seis lo cumplen, el promedio diluye a los seis con los
 * tres que no. La regla puede ser cierta y el TAG estar mal, que es cosa
 * distinta y se arregla de otra manera.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexByName, matchup } from '../src/engine/score.js';
import { COUNTER_RULES } from '../src/engine/rules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', f), 'utf8'));
const raw = leer('roam-meta.json');
const catalogo = leer('heroes.json').heroes;
const counters = indexByName(raw.counters ?? {}, 2);

/** Tasa de falsos hallazgos que se acepta. */
const FDR = 0.05;
/** Mínimo de rivales en cada grupo para que la comparación signifique algo. */
const MINIMO = 20;

const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varianza = (a) => {
  const m = media(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};

/** Aproximación normal a la cola de la t. Con n>40 por grupo se parecen. */
const pValor = (t) => {
  const z = Math.abs(t);
  // Zelen & Severo: error < 7.5e-8, de sobra para ordenar hallazgos.
  const d = 1 / (1 + 0.2316419 * z);
  const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const cola = phi * d * (0.319381530 + d * (-0.356563782 + d * (1.781477937
    + d * (-1.821255978 + d * 1.330274429))));
  return 2 * cola;
};

/** Benjamini-Hochberg: devuelve el p por debajo del cual se acepta el hallazgo. */
const corteBH = (ps) => {
  const orden = [...ps].sort((a, b) => a - b);
  let corte = 0;
  orden.forEach((p, i) => { if (p <= FDR * (i + 1) / orden.length) corte = p; });
  return corte;
};

/** Compara los cruces de `heroe` contra dos grupos de rivales. */
function comparar(heroe, conTag, sinTag) {
  const vals = (ns) => ns.filter((n) => n !== heroe)
    .map((n) => matchup(counters, heroe, n)).filter((v) => v != null);
  const a = vals(conTag);
  const b = vals(sinTag);
  if (a.length < MINIMO || b.length < MINIMO) return null;
  const dif = media(a) - media(b);
  const se = Math.sqrt(varianza(a) / a.length + varianza(b) / b.length);
  if (!(se > 0)) return null;
  return { dif, se, t: dif / se, n: a.length };
}

const propios = new Set(catalogo.map((h) => h.name));
const conTags = catalogo.filter((h) => propios.has(h.name));

const informe = [];
for (const regla of COUNTER_RULES) {
  const enemigos = conTags.filter((h) => h.tags.includes(regla.enemyTag)).map((h) => h.name);
  const otros = conTags.filter((h) => !h.tags.includes(regla.enemyTag)).map((h) => h.name);
  if (enemigos.length < MINIMO || otros.length < MINIMO) continue;

  const medidas = [];
  for (const h of conTags) {
    const m = comparar(h.name, enemigos, otros);
    if (m) medidas.push({ ...m, hero: h.name, tag: h.tags.includes(regla.roamTag), p: pValor(m.t) });
  }
  if (!medidas.length) continue;

  const corte = corteBH(medidas.map((m) => m.p));
  // El signo esperado lo marca el peso: una regla de peso negativo es un castigo.
  const signo = Math.sign(regla.weight) || 1;
  for (const m of medidas) m.destaca = m.p <= corte && Math.sign(m.dif) === signo;

  const conTag = medidas.filter((m) => m.tag);
  const sinTag = medidas.filter((m) => !m.tag);
  informe.push({
    regla,
    medidas,
    conTag,
    sinTag,
    cumplen: conTag.filter((m) => m.destaca),
    faltan: sinTag.filter((m) => m.destaca).sort((a, b) => b.t - a.t),
    esperadosPorAzar: medidas.length * FDR,
  });
}

const cruces = Object.values(raw.counters ?? {}).reduce((n, f) => n + Object.keys(f).length, 0);
console.log(`Reglas de counter contra ${cruces} cruces reales · ${conTags.length} héroes con tags escritos a mano`);
console.log(`Welch por héroe · Benjamini-Hochberg al ${FDR * 100}%\n`);
console.log('regla                        etiquetados  lo cumplen   sin etiquetar y lo cumplen   veredicto');
console.log('-'.repeat(96));

for (const f of informe.sort((a, b) => (b.cumplen.length / (b.conTag.length || 1)) - (a.cumplen.length / (a.conTag.length || 1)))) {
  const total = f.cumplen.length + f.faltan.length;
  const veredicto = total <= f.esperadosPorAzar ? 'no se distingue del azar'
    : f.conTag.length && f.cumplen.length / f.conTag.length >= 0.5 ? 'la regla y el tag valen'
      : f.cumplen.length ? 'la regla vale, el tag flojea'
        : 'el efecto existe pero el tag no lo captura';
  console.log(
    `${f.regla.why.padEnd(26)} ${String(f.conTag.length).padStart(8)} ${String(f.cumplen.length).padStart(11)} `
    + `${String(f.faltan.length).padStart(20)}        ${veredicto}`,
  );
}

console.log('\nDetalle por regla:\n');
for (const f of informe) {
  const total = f.cumplen.length + f.faltan.length;
  if (total <= f.esperadosPorAzar) continue;
  console.log(`${f.regla.why}  (${f.regla.roamTag} contra ${f.regla.enemyTag}, peso ${f.regla.weight})`);
  const linea = (m) => `${m.hero.padEnd(13)} ${(m.dif >= 0 ? '+' : '') + (m.dif * 100).toFixed(2)}pp  t=${m.t.toFixed(2)}`;
  if (f.cumplen.length) console.log('   lo cumplen:      ' + f.cumplen.sort((a, b) => b.t - a.t).map((m) => m.hero).join(', '));
  const fallan = f.conTag.filter((m) => !m.destaca);
  if (fallan.length) console.log('   NO lo cumplen:   ' + fallan.map((m) => `${m.hero} (${(m.dif * 100).toFixed(2)}pp)`).join(', '));
  if (f.faltan.length) console.log('   sin el tag pero lo cumplen: ' + f.faltan.slice(0, 10).map((m) => linea(m).trim()).join(' · '));
  console.log(`   (por azar cabrian ~${f.esperadosPorAzar.toFixed(1)} hallazgos; hay ${total})\n`);
}
