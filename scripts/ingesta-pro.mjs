#!/usr/bin/env node
/**
 * Partidas profesionales con resultado, desde Liquipedia.
 *
 * Es el único sitio público con lo que hace falta para MEDIR el motor contra
 * partidas de verdad: los cinco picks de cada equipo, los baneos, el lado y
 * quién ganó, partida a partida (170 en una sola fase regular de MPL ID). Ni
 * la API comunitaria (solo las partidas del propio usuario, tras el login que
 * no tocamos) ni Moonton publican eso.
 *
 *   node scripts/ingesta-pro.mjs --out /tmp/pro.json --out-partidas /tmp/pro.jsonl
 *   node scripts/ingesta-pro.mjs --desde 2026-01-01 --max-peticiones 80 --pausa 4000
 *
 * CÓMO SE HABLA CON LIQUIPEDIA, y no es negociable (api-terms-of-use):
 *  - Solo la API (api.php), nunca el HTML. Con `Accept-Encoding: gzip` (sin
 *    eso responde 406) y un User-Agent que diga quién eres y cómo contactar.
 *  - Ritmo: una petición cada 2 s como mucho, y nada de `action=parse`
 *    (una cada 30 s): se lee el wikitext con `prop=revisions`, que es la
 *    consulta normal, de 20 páginas por petición. Medido desde una IP compartida, Liquipedia corta MUCHO
 *    antes de lo que dicen sus condiciones (un 429 con Turnstile que dura
 *    minutos), así que cada 429 se espera con retroceso exponencial y se
 *    guarda lo que haya en vez de tirarlo.
 *  - Licencia CC-BY-SA 3.0: la app y el README dicen de dónde sale.
 *
 * QUÉ SE GUARDA. Dos ficheros:
 *  - `historial/pro-partidas.jsonl`: una línea por partida (torneo, fecha,
 *    parche, picks, baneos, lado, ganador). Es la MUESTRA, para medir con
 *    `scripts/medir-pro.mjs`. No la lee la app.
 *  - `public/data/pro.json`: lo pequeño que sí lee la app: cuántas partidas,
 *    de cuándo, y por héroe picks/victorias/baneos en la ventana reciente.
 *
 * Es incremental y monótona: funde con lo que ya hay por clave de partida y
 * nunca pierde una partida guardada. Si Liquipedia corta a mitad, lo que se
 * había leído se queda.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normName, mergeCatalog } from '../src/engine/score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const API = 'https://liquipedia.net/mobilelegends/api.php';
export const USER_AGENT = 'mobile-legends-pick-assist/ingesta-pro (https://github.com/srchipiron/mobile-legends-pick-assist; javier@aeroscan.es)';
/** Categorías de torneos que merece la pena leer. Las de abajo (B, C) son ligas menores con drafts raros. */
export const CATEGORIAS = ['Category:S-Tier_Tournaments', 'Category:A-Tier_Tournaments'];
/** Pausa mínima entre peticiones (ms). Las condiciones piden 2 s; se deja margen. */
export const PAUSA_MS = 5000;
/** Tras un 429: 2, 4, 8 minutos. Más de eso es que hoy no toca. */
export const RETROCESO_MS = [120_000, 240_000, 480_000];

/**
 * Nombres que Liquipedia escribe distinto que la API. Solo lo COMPROBADO en
 * wikitext real: un alias equivocado mete al héroe de al lado, y eso es peor
 * que descartar la partida (que es lo que pasa con un slug sin mapear, y el
 * fichero de salida lo lista para que se vea).
 */
export const ALIAS = {
  yss: 'Yi Sun-shin',
  gatot: 'Gatotkaca',
  lance: 'Lancelot',
  esme: 'Esmeralda',
  arlot: 'Arlott',
  ceci: 'Cici',
  haya: 'Hayabusa',
  valen: 'Valentina',
  'lapu-lapu': 'Lapu-Lapu',
  lapulapu: 'Lapu-Lapu',
  'luo yi': 'Luo Yi',
  luoyi: 'Luo Yi',
  yuzhong: 'Yu Zhong',
  xborg: 'X.Borg',
  change: "Chang'e",
  'chang e': "Chang'e",
  popol: 'Popol and Kupa',
  'popol and kupa': 'Popol and Kupa',
  ysm: 'Yi Sun-shin',
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lee un campo `|clave=valor` de un bloque de plantilla. */
const campo = (bloque, clave) => {
  const m = bloque.match(new RegExp(`\\|${clave}=([^|\\n}]*)`));
  return m ? m[1].trim() : null;
};

/** "August 22, 2025 - 15:15{{abbr/ICT}}" → "2025-08-22". */
export function fechaISO(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/\{\{.*?\}\}/g, '').trim();
  const t = Date.parse(limpio.split(' - ')[0]);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Las partidas de una página de wikitext: cada `{{Map ...}}` con cinco picks
 * por lado y ganador. La fecha y los equipos viven en el `{{Match}}` que la
 * envuelve, así que se lee linealmente y se recuerda lo último visto.
 */
export function parsearPartidas(wikitext, torneo = null) {
  const partidas = [];
  let fecha = null;
  let equipos = [null, null];
  let indice = 0;
  // Se corta por plantilla de apertura; el orden del texto es el del torneo.
  const trozos = wikitext.split(/(?=\{\{(?:Match|Map)\b)/);
  for (const trozo of trozos) {
    if (trozo.startsWith('{{Match')) {
      const f = trozo.match(/\|date=([^|\n]+)/);
      if (f) fecha = fechaISO(f[1]);
      const op = [...trozo.matchAll(/\|opponent(\d)=\{\{TeamOpponent\|([^}|]+)/g)];
      for (const [, n, nombre] of op) equipos[Number(n) - 1] = nombre.trim();
      continue;
    }
    if (!trozo.startsWith('{{Map')) continue;
    const fin = trozo.indexOf('}}');
    const bloque = fin > 0 ? trozo.slice(0, fin) : trozo;
    const t1 = [1, 2, 3, 4, 5].map((i) => campo(bloque, `t1h${i}`)).filter(Boolean);
    const t2 = [1, 2, 3, 4, 5].map((i) => campo(bloque, `t2h${i}`)).filter(Boolean);
    const ganador = campo(bloque, 'winner');
    indice += 1;
    if (t1.length !== 5 || t2.length !== 5 || !['1', '2'].includes(ganador)) continue;
    partidas.push({
      torneo,
      indice,
      fecha,
      equipos: [...equipos],
      lado1: campo(bloque, 'team1side'),
      duracion: campo(bloque, 'length'),
      picks: [t1.map((s) => s.toLowerCase()), t2.map((s) => s.toLowerCase())],
      bans: [
        [1, 2, 3, 4, 5].map((i) => campo(bloque, `t1b${i}`)).filter(Boolean).map((s) => s.toLowerCase()),
        [1, 2, 3, 4, 5].map((i) => campo(bloque, `t2b${i}`)).filter(Boolean).map((s) => s.toLowerCase()),
      ],
      ganador: Number(ganador),
    });
  }
  return partidas;
}

/** La clave por la que se funden dos corridas: torneo + página + nº de mapa + picks. */
export const claveDe = (p) => `${p.torneo}#${p.pagina ?? ''}#${p.indice}#${p.picks[0].join(',')}|${p.picks[1].join(',')}`;

/** Slug de Liquipedia → héroe del catálogo, o null. */
export function resolverHeroe(slug, indice) {
  const alias = ALIAS[slug.toLowerCase()] ?? slug;
  return indice.get(normName(alias)) ?? indice.get(normName(slug)) ?? null;
}

/**
 * Lo pequeño que lee la app: por héroe, en la ventana reciente, cuántas veces
 * se eligió, cuántas ganó y cuántas se baneó. Y qué slugs no se reconocen,
 * para que se vea en vez de perderse.
 */
export function resumirPro(partidas, heroes, { desde = null } = {}) {
  const indice = new Map(heroes.map((h) => [normName(h.name), h]));
  const porHeroe = {};
  const sinMapear = {};
  const cuenta = (nombre) => (porHeroe[nombre] ??= { picks: 0, ganadas: 0, bans: 0 });
  let usadas = 0;
  let primera = null;
  let ultima = null;
  const torneos = new Set();
  for (const p of partidas) {
    if (desde && p.fecha && p.fecha < desde) continue;
    usadas += 1;
    torneos.add(p.torneo);
    if (p.fecha) {
      if (!primera || p.fecha < primera) primera = p.fecha;
      if (!ultima || p.fecha > ultima) ultima = p.fecha;
    }
    for (const lado of [0, 1]) {
      for (const slug of p.picks[lado]) {
        const h = resolverHeroe(slug, indice);
        if (!h) { sinMapear[slug] = (sinMapear[slug] ?? 0) + 1; continue; }
        const c = cuenta(h.name);
        c.picks += 1;
        if (p.ganador === lado + 1) c.ganadas += 1;
      }
      for (const slug of p.bans[lado]) {
        const h = resolverHeroe(slug, indice);
        if (!h) { sinMapear[slug] = (sinMapear[slug] ?? 0) + 1; continue; }
        cuenta(h.name).bans += 1;
      }
    }
  }
  return {
    fuente: 'Liquipedia Mobile Legends: Bang Bang Wiki (CC-BY-SA 3.0)',
    desde,
    partidas: usadas,
    torneos: torneos.size,
    primera,
    ultima,
    heroes: porHeroe,
    sinMapear,
  };
}

/** Cliente con ritmo y retroceso. `peticiones` cuenta para el tope. */
export function crearCliente({ pausa = PAUSA_MS, maxPeticiones = 200, fetchImpl = fetch, log = () => {} } = {}) {
  let hechas = 0;
  let ultima = 0;
  return {
    get hechas() { return hechas; },
    async consultar(params) {
      if (hechas >= maxPeticiones) throw new Error(`tope de ${maxPeticiones} peticiones`);
      const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
      for (let intento = 0; ; intento++) {
        const espera = Math.max(0, ultima + pausa - Date.now());
        if (espera) await dormir(espera);
        ultima = Date.now();
        hechas += 1;
        const res = await fetchImpl(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip', Accept: 'application/json' },
        });
        if (res.status === 429 || res.status === 503) {
          if (intento >= RETROCESO_MS.length) throw new Error(`Liquipedia sigue limitando tras ${intento} esperas`);
          log(`429: espero ${RETROCESO_MS[intento] / 1000} s`);
          await dormir(RETROCESO_MS[intento]);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} en ${params.action}`);
        return res.json();
      }
    },
  };
}

/**
 * Miembros de una categoría, los incorporados más recientemente primero, y
 * solo los `limite` primeros. Con 354 torneos S/A en total, bajar todas las
 * portadas para leer sus fechas eran ocho peticiones antes de empezar, y
 * desde una IP compartida Liquipedia cortaba ahí. Los recientes se
 * incorporan a la categoría cuando se crean, así que el orden por marca de
 * tiempo es el orden que se quiere.
 */
export async function torneosDe(cliente, categoria, limite = 60) {
  const d = await cliente.consultar({
    action: 'query', list: 'categorymembers', cmtitle: categoria, cmlimit: String(limite), cmsort: 'timestamp', cmdir: 'desc',
  });
  return (d.query?.categorymembers ?? []).map((m) => m.title);
}

/** Wikitext de varias páginas por petición (de 20 en 20: las de 50 pesan). */
export async function wikitextDe(cliente, titulos) {
  const salida = {};
  for (let i = 0; i < titulos.length; i += 20) {
    const d = await cliente.consultar({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titulos.slice(i, i + 20).join('|'),
    });
    for (const pg of Object.values(d.query?.pages ?? {})) {
      const w = pg.revisions?.[0]?.slots?.main?.['*'] ?? pg.revisions?.[0]?.['*'];
      if (w) salida[pg.title] = w;
    }
  }
  return salida;
}

/** Subpáginas de un torneo (Regular Season, Playoffs, Group Stage...). */
export async function subpaginasDe(cliente, torneo) {
  const d = await cliente.consultar({ action: 'query', list: 'allpages', apprefix: `${torneo}/`, aplimit: '100' });
  return (d.query?.allpages ?? []).map((p) => p.title)
    // Las de estadísticas, equipos y jugadores no traen partidas.
    .filter((t) => !/\/(Statistics|Team Rosters|Participants|Transfers|Broadcast Talent|Prize Pool|Talent)$/i.test(t));
}

/** Fechas del torneo, de su infobox. */
export function fechasDe(wikitext) {
  const m = (k) => wikitext.match(new RegExp(`\\|${k}=(\\d{4}-\\d{2}-\\d{2})`))?.[1] ?? null;
  return { sdate: m('sdate'), edate: m('edate'), patch: wikitext.match(/\|patch=([^\n|]+)/)?.[1]?.trim() ?? null };
}

async function leerJsonl(ruta) {
  try {
    return (await readFile(ruta, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
  const out = opt('--out', resolve(ROOT, 'public/data/pro.json'));
  const outPartidas = opt('--out-partidas', resolve(ROOT, 'historial/pro-partidas.jsonl'));
  const desde = opt('--desde', new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10));
  const ventana = opt('--ventana', new Date(Date.now() - 120 * 86400e3).toISOString().slice(0, 10));
  const maxPeticiones = Number(opt('--max-peticiones', 150));
  const pausa = Number(opt('--pausa', PAUSA_MS));
  const maxTorneos = Number(opt('--max-torneos', 25));
  const log = (m) => console.error(`[pro] ${m}`);

  const cat = JSON.parse(await readFile(resolve(ROOT, 'public/data/heroes.json'), 'utf8'));
  let meta = { heroes: [] };
  try { meta = JSON.parse(await readFile(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8')); } catch { /* sin meta también vale */ }
  const heroes = mergeCatalog(cat.heroes, meta.heroes ?? []);

  const previas = await leerJsonl(resolve(ROOT, 'historial/pro-partidas.jsonl'));
  const porClave = new Map(previas.map((p) => [claveDe(p), p]));
  const torneosLeidos = new Set(previas.map((p) => p.torneo));
  log(`${previas.length} partidas guardadas de ${torneosLeidos.size} torneos`);

  const cliente = crearCliente({ pausa, maxPeticiones, log });
  const errores = [];
  try {
    const titulos = new Set();
    for (const c of CATEGORIAS) for (const t of await torneosDe(cliente, c, maxTorneos * 2)) titulos.add(t);
    log(`${titulos.size} torneos recientes en las categorías`);
    // Primero las portadas, en lotes: la infobox dice si el torneo es reciente.
    const portadas = await wikitextDe(cliente, [...titulos]);
    const recientes = Object.entries(portadas)
      .map(([t, w]) => ({ titulo: t, ...fechasDe(w) }))
      .filter((t) => t.edate && t.edate >= desde)
      // Un torneo ya leído y terminado hace más de un mes no cambia.
      .filter((t) => !(torneosLeidos.has(t.titulo) && t.edate < new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)))
      .sort((a, b) => (b.edate ?? '').localeCompare(a.edate ?? ''))
      .slice(0, maxTorneos);
    log(`${recientes.length} torneos por leer`);
    for (const t of recientes) {
      try {
        const paginas = [t.titulo, ...(await subpaginasDe(cliente, t.titulo))];
        const textos = await wikitextDe(cliente, paginas);
        let nuevas = 0;
        for (const [pagina, w] of Object.entries(textos)) {
          for (const p of parsearPartidas(w, t.titulo)) {
            const fila = { ...p, pagina: pagina.replace(`${t.titulo}/`, ''), parche: t.patch };
            const k = claveDe(fila);
            if (!porClave.has(k)) nuevas += 1;
            porClave.set(k, fila);
          }
        }
        log(`${t.titulo}: ${paginas.length} páginas, ${nuevas} partidas nuevas`);
      } catch (e) {
        errores.push(`${t.titulo}: ${e.message}`);
        if (/tope de|sigue limitando/.test(e.message)) break;
      }
    }
  } catch (e) {
    errores.push(e.message);
  }

  const todas = [...porClave.values()].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || a.indice - b.indice);
  if (todas.length < previas.length) throw new Error(`se perderían partidas: ${todas.length} < ${previas.length}`);
  await mkdir(dirname(outPartidas), { recursive: true });
  await writeFile(outPartidas, todas.map((p) => JSON.stringify(p)).join('\n') + (todas.length ? '\n' : ''));

  const resumen = {
    generatedAt: new Date().toISOString(),
    ...resumirPro(todas, heroes, { desde: ventana }),
    total: todas.length,
    peticiones: cliente.hechas,
    errores,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(resumen));
  log(`${todas.length} partidas en total · ${resumen.partidas} en la ventana desde ${ventana} · ${cliente.hechas} peticiones · ${errores.length} errores`);
  for (const e of errores) log(`  ${e}`);
}

const ejecutadoDirectamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ejecutadoDirectamente) {
  main().catch((e) => { console.error(`[pro] ${e.message}`); process.exit(1); });
}
