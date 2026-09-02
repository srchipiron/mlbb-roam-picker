#!/usr/bin/env node
/**
 * Deriva las tablas SPECIALITY_TAGS y ROLE_VETO de rules.js a partir del
 * catálogo escrito a mano.
 *
 * La idea: Moonton etiqueta cada héroe con una "speciality" (Guard, Initiator,
 * Regen…). Esas etiquetas no son nuestros tags, pero se puede APRENDER la
 * correspondencia mirando qué tags le puso Javi a los héroes que ya tienen
 * ambas cosas. Así los héroes que no están en el catálogo no dependen solo de
 * los tags genéricos de su rol.
 *
 * No es una regla escrita a ojo: sale de los datos y se mide. Medido con
 * validación dejando cada héroe fuera (los 126 del catálogo):
 *
 *   ROLE_DEFAULTS solo        precisión 66.8%  cobertura 39.6%  F1 49.2%
 *   + speciality              precisión 66.9%  cobertura 52.7%  F1 57.4%
 *   + speciality + veto       precisión 67.4%  cobertura 52.5%  F1 57.6%
 *
 * Reejecútalo cuando crezca el catálogo o Moonton cambie sus etiquetas:
 *   node scripts/derivar-tags.mjs                    (imprime las tablas)
 *   node scripts/derivar-tags.mjs --detalles f.json  (usa un volcado guardado)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Confianza mínima para aceptar speciality -> tag. */
const P_MIN = 0.6;
/** Cuántas veces más frecuente que la media tiene que ser el tag. */
const LIFT_MIN = 1.5;
/** Héroes mínimos con esa speciality para fiarse. */
const N_MIN = 10;
/** Héroes mínimos de un rol para afirmar que un tag NUNCA le corresponde. */
const ROL_MIN = 15;

export function derivar(catalogo, specialityDe, rolDe) {
  const conAmbos = catalogo.filter((h) => (specialityDe(h.name) ?? []).length);
  const tags = [...new Set(catalogo.flatMap((h) => h.tags))];

  const base = {};
  for (const t of tags) base[t] = catalogo.filter((h) => h.tags.includes(t)).length / catalogo.length;

  const mapa = {};
  const esps = [...new Set(conAmbos.flatMap((h) => specialityDe(h.name)))].filter(Boolean);
  for (const esp of esps) {
    const con = conAmbos.filter((h) => specialityDe(h.name).includes(esp));
    if (con.length < N_MIN) continue;
    for (const t of tags) {
      const p = con.filter((h) => h.tags.includes(t)).length / con.length;
      if (p >= P_MIN && p / (base[t] || 1e-9) >= LIFT_MIN) (mapa[esp] ??= []).push(t);
    }
  }

  // Veto: un tag que NUNCA aparece en ese rol dentro del catálogo. Evita que
  // una correlación se cuele como propiedad: casi todos los héroes de "Crowd
  // Control" son tanques, así que sin esto una maga con CC salía marcada como
  // primera línea y la composición se creía cubierta.
  const veto = {};
  for (const rol of [...new Set(catalogo.map((h) => rolDe(h.name)).filter(Boolean))]) {
    const del = catalogo.filter((h) => rolDe(h.name) === rol);
    if (del.length < ROL_MIN) continue;
    const nunca = tags.filter((t) => !del.some((h) => h.tags.includes(t)));
    if (nunca.length) veto[rol] = nunca.sort();
  }

  return { mapa, veto };
}

/** Descarga speciality de todos los héroes. Solo lo necesita este script. */
async function descargarDetalles(heroes, base) {
  const out = {};
  for (const h of heroes) {
    if (!h.id) continue;
    try {
      const r = await fetch(`${base}/api/heroes/${h.id}?lang=en`, { signal: AbortSignal.timeout(20000) });
      const d = (await r.json())?.data?.records?.[0]?.data?.hero?.data;
      if (d?.speciality) out[h.name] = d.speciality;
    } catch { /* un héroe suelto no invalida la tabla */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, def) => {
    const i = process.argv.indexOf(k);
    return i > -1 ? process.argv[i + 1] : def;
  };
  const cat = JSON.parse(readFileSync(resolve(ROOT, 'public/data/heroes.json'), 'utf8')).heroes;
  const meta = JSON.parse(readFileSync(arg('--meta', resolve(ROOT, 'public/data/roam-meta.json')), 'utf8'));
  const rol = new Map((meta.heroes ?? []).map((h) => [h.name, (h.role ?? '').toLowerCase()]));

  if (![...rol.values()].some(Boolean)) {
    console.error('Los datos no traen rol de héroe: sin eso no se puede derivar el veto.');
    console.error('Ejecuta la ingesta primero, o pasa --meta con un fichero que sí lo tenga.');
    process.exit(1);
  }

  const cache = arg('--detalles', null);
  // La base sale de lo que la ingesta descubrio, no de una URL escrita aqui.
  const baseDescubierta = String(meta.diagnostics?.base ?? '').replace(/^[A-Z]+ /, '') || 'https://arena-hv.fastapicloud.dev';
  const det = cache
    ? JSON.parse(readFileSync(cache, 'utf8'))
    : await descargarDetalles(meta.heroes ?? [], arg('--base', baseDescubierta));
  // Con la API caida `det` sale vacio y la tabla, vacia: mantenimiento.yml
  // proponia un pull request borrando SPECIALITY_TAGS entera.
  const minimo = Math.floor((meta.heroes ?? []).length / 2);
  if (Object.keys(det).length < minimo) {
    console.error(`Solo ${Object.keys(det).length} héroes con speciality (mínimo ${minimo}): la API no responde, no se deriva nada.`);
    process.exit(1);
  }
  const speciality = (n) => (Array.isArray(det[n]) ? det[n] : det[n]?.speciality) ?? [];

  const { mapa, veto } = derivar(cat, speciality, (n) => rol.get(n) ?? '');
  const pinta = (o) => Object.entries(o).map(([k, v]) => `  '${k}': [${v.map((x) => `'${x}'`).join(', ')}],`).join('\n');
  console.log('export const SPECIALITY_TAGS = {\n' + pinta(mapa) + '\n};\n');
  console.log('export const ROLE_VETO = {\n' + pinta(veto) + '\n};');
}
