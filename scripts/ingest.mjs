#!/usr/bin/env node
/**
 * Ingesta de datos meta de MLBB.
 *
 * La API de la comunidad (proyecto Rone Arena, antes OpenMLBB / api-mobilelegends)
 * ha cambiado de dominio y de prefijo de rutas más de una vez. En vez de fijar
 * una URL que caduca, este script PRUEBA las bases y los prefijos conocidos y se
 * queda con la primera combinación que responde. Lo que ha funcionado y lo que ha
 * fallado queda anotado en el JSON de salida, para poder diagnosticar desde la app.
 *
 *   node scripts/ingest.mjs
 *   node scripts/ingest.mjs --rank mythic --days 7
 *   node scripts/ingest.mjs --base https://otra.api/api
 */

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAME_KEYS, ID_KEYS, asRate, pick, recogerPares, relationMap, esIdDeHeroe, idPrincipal,
} from './parse-relations.mjs';
// La MISMA funcion que usa la app para decidir quien entra al pool de roam.
// Duplicar el criterio aqui ya costo un fallo: la app metia a Marcel (support
// segun la API) y la ingesta no le pedia counters, porque miraba solo el
// catalogo escrito a mano.
import { mergeCatalog } from '../src/engine/score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

// --out escribe en otro sitio. Lo usa la prueba que ejecuta esta ingesta de
// verdad: sin ello sobrescribia public/data con una corrida contra una base
// inalcanzable, y como las pruebas corren antes de compilar, ese diagnostico
// degradado era el que se publicaba.
const OUT = resolve(ROOT, args.out ?? 'public/data/roam-meta.json');
const HEROES = resolve(ROOT, 'public/data/heroes.json');

// Donde se guardan los iconos de los objetos. Mismo motivo que --out: la prueba
// que ejecuta la ingesta de verdad le pasa un temporal, para no ensuciar el
// repositorio ni dejarlo a medias si la corrida sale mal.
const ICONOS = resolve(ROOT, args.iconos ?? 'public/objetos');
const RETRATOS = resolve(ROOT, args.retratos ?? 'public/heroes');

// Gloria Mitica por defecto: es el rango del usuario y donde el draft se juega
// en serio, asi que sus counters son los mas informativos.
const RANK = args.rank ?? 'glory';
const DAYS = Number(args.days ?? 7);
const RANKS = (args.ranks ?? 'epic,legend,mythic,glory').split(',').map((r) => r.trim());

/**
 * Bases conocidas, de la más actual a la más antigua.
 *
 * Si se pasa una a mano (--base o MLBB_API_BASE) se usa ESA Y SOLO ESA. Antes
 * se ponía la primera y se seguía cayendo a las demás, así que la prueba que
 * dice correr "contra una base inalcanzable" hacía en realidad una ingesta
 * completa contra la API de verdad: tardaba más de un minuto, dependía de la
 * red y disparaba cuarenta peticiones en cada despliegue.
 */
const BASE_FIJADA = args.base ?? process.env.MLBB_API_BASE;
const BASES = BASE_FIJADA ? [BASE_FIJADA] : [
  'https://arena-hv.fastapicloud.dev/api',   // responde: /heroes/hero-rank/ existe
  'https://arena.rone.dev/api',
  'https://api-mobilelegends.vercel.app/api', // legado
];

/**
 * Descriptores de lo que necesitamos. La ruta real se busca en el esquema
 * OpenAPI por estos patrones, en vez de fijarla a mano: los nombres cambian
 * entre versiones pero el concepto no.
 */
const WANTED = {
  rank: [/hero[-_]?rank/i, /hero[-_]?rate/i, /\brank\b/i],
  position: [/positions?\/?$/i, /hero[-_]?position/i, /hero[-_]?list/i, /\bheroes?\/?$/i],
  // La API llamó a esto "Hero Relation" en versiones anteriores, y puede volver
  // a cambiarle el nombre. Se buscan todas las variantes plausibles.
  // El orden importa: se prueba patrón por patrón y gana el primero que exista.
  // /relations devuelve una estructura distinta, así que va detrás de las rutas
  // dedicadas, que son las que traen los pares legibles.
  counter: [/counters?\/?$/i, /counter/i, /matchup/i, /relations?\/?$/i, /relation/i],
  compatibility: [/compatibilit/i, /compat/i, /synerg/i, /teammates?\/?$/i, /partner/i, /relations?\/?$/i, /relation/i],
  // Ficha de un heroe. Solo se usa para su "speciality", y solo de los heroes
  // que no tienen tags escritos a mano: son 7, no 133, asi que el despliegue no
  // paga la diferencia. El patron exige que la ruta ACABE en el parametro, para
  // no coger /{id}/stats ni /{id}/trends.
  detail: [/heroes?\/\{[^}]+\}\/?$/i],
  // Objetos del juego. La variante /expanded trae `equiptips`, que es donde el
  // propio juego escribe cuanta defensa da cada objeto. Sin ella solo hay
  // nombre e icono, que no sirve para decidir nada.
  equipment: [/equipment\/expanded\/?$/i, /equipments?\/?$/i, /items?\/?$/i],
  // Builds de un heroe EN UNA LINEA. El parametro `lane` es obligatorio: sin
  // el la API devuelve 422.
  builds: [/builds?\/?$/i, /equip[-_]?recommend/i],
};

/** Rutas que llevan el heroe (o el recurso) dentro del camino, no como parametro. */
const CON_ID = new Set(['counter', 'compatibility', 'detail', 'builds']);

/** Prefijos de grupo de rutas que ha usado el proyecto en distintas versiones. */
// '/heroes' confirmado: da 405 (existe, otro método) mientras '/mlbb' da 404.
const PREFIXES = ['/heroes', '', '/mlbb'];

const UA = 'mobile-legends-pick-assist (uso personal)';
const TIMEOUT_MS = 15000;

const diagnostics = { bases: BASES, ok: [], failed: [] };
let LOCKED = null; // { base, prefix, method } en cuanto algo responde

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Una petición. En el error incluye el cuerpo de la respuesta recortado: cuando
 * la API es FastAPI, un 422 dice exactamente qué campos esperaba, y eso vale más
 * que el código de estado a secas para saber qué corregir.
 */
async function request(url, method, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const texto = await res.text();
        // En un 422 lo único que importa es `details`: dice qué parámetro falla.
        // El resto del cuerpo (soporte, timestamps) ocupaba todo el hueco y
        // dejaba el dato útil fuera del recorte.
        try {
          const j = JSON.parse(texto);
          detail = j.details ? JSON.stringify(j.details).slice(0, 400) : texto.slice(0, 300);
        } catch {
          detail = texto.replace(/\s+/g, ' ').slice(0, 300);
        }
      } catch { /* sin cuerpo */ }
      const err = new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** GET primero; si contesta 405, el endpoint existe pero quiere POST. */
async function getUrl(url, params, forceMethod) {
  const methods = forceMethod ? [forceMethod] : ['GET', 'POST'];
  let lastErr;
  for (const method of methods) {
    try {
      const data = await request(url, method, method === 'POST' ? params : undefined);
      return { data, method };
    } catch (err) {
      lastErr = err;
      // Solo tiene sentido reintentar con POST si el fallo fue "método no permitido".
      if (err.status !== 405) throw err;
    }
  }
  throw lastErr;
}

function buildUrl(base, prefix, path, params) {
  const url = new URL(base + prefix + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Pide un recurso probando combinaciones de base y prefijo. Una vez que una
 * funciona se fija en LOCKED y las siguientes llamadas van directas.
 */
async function fetchResource(paths, params = {}) {
  const combos = LOCKED
    ? [LOCKED]
    : BASES.flatMap((base) => PREFIXES.map((prefix) => ({ base, prefix })));

  let lastErr;
  for (const combo of combos) {
    for (const path of paths) {
      const url = buildUrl(combo.base, combo.prefix, path, params);
      try {
        const { data, method } = await getUrl(url, params, combo.method);
        const rows = firstArray(data);
        if (!rows || !rows.length) throw new Error('respuesta sin filas');
        if (!LOCKED) {
          LOCKED = { ...combo, method };
          console.log(`  · base activa: ${method} ${combo.base}${combo.prefix}`);
        }
        diagnostics.ok.push(`${method} ${combo.base}${combo.prefix}${path}`);
        return { data, rows, url };
      } catch (err) {
        lastErr = err;
        if (diagnostics.failed.length < 40) {
          diagnostics.failed.push(`${combo.base}${combo.prefix}${path} → ${err.message}`);
        }
      }
    }
  }
  throw lastErr ?? new Error('ninguna combinación respondió');
}

/**
 * Lee el esquema OpenAPI y devuelve un mapa de lo que nos interesa:
 *   { rank: { url, method, params }, position: {...}, ... }
 * Esto sustituye a adivinar rutas: la API dice cuáles tiene y con qué método.
 */
async function discoverRoutes() {
  for (const base of BASES) {
    const origin = new URL(base).origin;
    for (const schemaUrl of [`${base}/openapi.json`, `${origin}/openapi.json`, `${origin}/api/openapi.json`]) {
      let schema;
      try {
        schema = await request(schemaUrl, 'GET');
      } catch (err) {
        diagnostics.failed.push(`${schemaUrl} → ${err.message}`);
        continue;
      }
      if (!schema?.paths) continue;

      const allPaths = Object.keys(schema.paths);
      diagnostics.schema = {
        url: schemaUrl,
        pathCount: allPaths.length,
        // Solo las de héroes: son las candidatas y caben en pantalla.
        heroPaths: allPaths.filter((p) => /hero|counter|relation|compat/i.test(p)).slice(0, 30),
      };
      console.log(`  · esquema leído: ${allPaths.length} rutas en ${schemaUrl}`);

      const routes = {};
      for (const [key, patterns] of Object.entries(WANTED)) {
        const wantsId = CON_ID.has(key);
        // Por patrón, en orden de preferencia: manda el primero que exista,
        // pero se guardan TODOS los que encajan con cualquier patrón. Antes se
        // cortaba en el primer patrón con resultados, y por eso la ruta de
        // teammates -que encaja con un patrón posterior- no llegaba nunca a
        // compararse con la de compatibility.
        const candidatos = [];
        for (const re of patterns) {
          for (const p of allPaths) {
            if (re.test(p) && !candidatos.includes(p)) candidatos.push(p);
          }
        }
        // Para counter y compatibilidad se prefiere la ruta con {id}, pero si la
        // API pide el héroe como parámetro normal, también sirve: exigir {id}
        // dejaba la ruta sin encontrar y tiraba todos los counters.
        const conId = candidatos.filter((p) => /\{/.test(p));
        const orden = wantsId ? [...conId, ...candidatos] : candidatos.filter((p) => !/\{/.test(p));
        const match = orden[0];
        if (!match) continue;

        const describir = (ruta) => {
          const [method, op] = Object.entries(schema.paths[ruta])[0];
          return {
            template: origin + ruta,
            method: method.toUpperCase(),
            params: (op?.parameters ?? []).map((prm) => prm.name),
          };
        };
        routes[key] = describir(match);
        // Los candidatos que quedan, para poder ELEGIR midiendo en vez de
        // suponiendo. Aquí antes se descartaban las rutas de /academy dando por
        // hecho que eran material didáctico. Era falso y caro: /academy da los
        // 132 cruces de cada héroe y la que se prefería, cinco.
        const otras = [...new Set(orden)].filter((p) => p !== match);
        if (otras.length) routes[key].alternativas = otras.map(describir);
      }

      diagnostics.routes = Object.fromEntries(
        Object.entries(routes).map(([k, r]) => [k, `${r.method} ${r.template} (${r.params.join(', ') || 'sin params'})`]),
      );
      if (Object.keys(routes).length) return routes;
    }
  }
  return null;
}

/** Llama a una ruta ya descubierta, mandando solo los parámetros que acepta. */
export async function callRoute(route, values, pathValue) {
  const base = route.template.replace(/\{[^}]+\}/, encodeURIComponent(pathValue ?? ''));
  const declarados = route.params.length
    ? Object.fromEntries(Object.entries(values).filter(([k]) => route.params.includes(k)))
    : values;

  // Intentos en orden decreciente de exigencia. Un 422 significa que algún
  // parámetro no le vale, y los valores por defecto del endpoint suelen
  // funcionar: antes bastaba un parámetro mal para perder TODOS los counters.
  const intentos = [
    declarados,
    Object.fromEntries(Object.entries(declarados).filter(([k]) => k === 'rank')),
    {},
  ];

  let ultimoError;
  for (const params of intentos) {
    const url = new URL(base);
    try {
      if (route.method === 'GET') {
        for (const [k, v] of Object.entries(params)) {
          if (v != null) url.searchParams.set(k, String(v));
        }
        const data = await request(url.toString(), 'GET');
        return { data, rows: firstArray(data) ?? [] };
      }
      const data = await request(url.toString(), route.method, params);
      return { data, rows: firstArray(data) ?? [] };
    } catch (err) {
      ultimoError = err;
      if (err.status !== 422) throw err; // solo tiene sentido aflojar ante validación
    }
  }
  throw ultimoError;
}

/** Encuentra el primer array de objetos, a cualquier profundidad del envoltorio. */
function firstArray(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node) && node.length && typeof node[0] === 'object') return node;
  if (typeof node !== 'object') return null;
  for (const v of Object.values(node)) {
    const found = firstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Rutas descubiertas en el esquema OpenAPI. La rellena discoverRoutes(). */
let ROUTES = null;

/**
 * Líneas en las que se juega un héroe. La API las devuelve de formas distintas
 * (una cadena, una lista, objetos con nombre), así que se recogen todas las
 * cadenas que parezcan una línea conocida.
 */
const LINEAS = ['roam', 'jungle', 'mid', 'gold', 'exp', 'support', 'farm'];

/**
 * Profundidad maxima al bajar por la respuesta. La API envuelve el dato util
 * muy hondo: el titulo de la linea vive en
 * data.hero.data.roadsort[].data.road_sort_title, o sea nivel 8. Con el limite
 * de 6 que habia antes NUNCA se llegaba, y los 133 heroes salian sin linea y
 * sin rol sin que nada fallara.
 */
const HONDURA = 12;

function extraerLineas(node, out = new Set(), depth = 0, dentro = false) {
  if (depth > HONDURA || node == null) return [...out];

  // Solo se leen las cadenas que estén DENTRO de una clave de línea. Sin ese
  // contexto, el nombre del héroe o la URL de su icono podían colar palabras
  // como "gold" o "mid" y darle líneas que no juega.
  if (typeof node === 'string') {
    if (dentro) for (const l of LINEAS) if (node.toLowerCase().includes(l)) out.add(l);
    return [...out];
  }
  if (typeof node !== 'object') return [...out];

  if (Array.isArray(node)) {
    for (const v of node) extraerLineas(v, out, depth + 1, dentro);
    return [...out];
  }

  for (const [k, v] of Object.entries(node)) {
    extraerLineas(v, out, depth + 1, dentro || /lane|position|road/i.test(k));
  }
  return [...out];
}

/**
 * Roles que usa la API. Se reconocen por igualdad exacta, no por subcadena:
 * asi una URL o un nombre de heroe no puede colar un rol que no es.
 */
const ROLES = ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'];

/**
 * Rol del heroe. Igual que las lineas, viene hondo y con otro nombre segun la
 * version de la API (sortid[].data.sort_title hoy), asi que se busca por
 * contexto de clave en vez de por ruta fija.
 */
function extraerRol(node, depth = 0, dentro = false) {
  if (depth > HONDURA || node == null) return '';

  if (typeof node === 'string') {
    if (!dentro) return '';
    const s = node.trim().toLowerCase();
    return ROLES.includes(s) ? s : '';
  }
  if (typeof node !== 'object') return '';

  const entradas = Array.isArray(node) ? node.map((v) => [null, v]) : Object.entries(node);
  for (const [k, v] of entradas) {
    // 'road' se excluye a proposito: roadsort lleva la LINEA, no el rol.
    const aqui = dentro || (k != null && /sort|role|class/i.test(k) && !/road/i.test(k));
    const r = extraerRol(v, depth + 1, aqui);
    if (r) return r;
  }
  return '';
}

/**
 * Etiquetas de Moonton ("Guard", "Initiator", "Regen"...). Igual que el rol,
 * vienen hondas y pueden cambiar de sitio, asi que se buscan por contexto de
 * clave. Se recogen tal cual: traducirlas a nuestros tags es cosa de
 * SPECIALITY_TAGS, que se deriva del catalogo y se mide.
 */
function extraerSpeciality(node, out = new Set(), depth = 0, dentro = false) {
  if (depth > HONDURA || node == null) return [...out];

  if (typeof node === 'string') {
    const s = node.trim();
    if (dentro && s && s.length < 30) out.add(s);
    return [...out];
  }
  if (typeof node !== 'object') return [...out];

  const entradas = Array.isArray(node) ? node.map((v) => [null, v]) : Object.entries(node);
  for (const [k, v] of entradas) {
    extraerSpeciality(v, out, depth + 1, dentro || (k != null && /special/i.test(k)));
  }
  return [...out];
}

/**
 * Tipo de dano de un heroe, contado en los textos de habilidad que da Moonton.
 *
 * No es una regla escrita a mano ni una deduccion del rol: el propio juego
 * escribe "Physical Damage" / "Magic Damage" / "True Damage" en cada
 * habilidad, y eso es lo que se cuenta. El rol se equivocaria: Gusion es
 * asesino y pega magico, Hylos es tanque y pega magico.
 *
 * Devuelve las cuentas crudas. Quien decide la etiqueta es el motor, con
 * `perfilDeDano`, para poder cambiar el criterio sin reingerir.
 */
function extraerDano(node, out = { fisico: 0, magico: 0, verdadero: 0 }, depth = 0) {
  if (depth > HONDURA || node == null) return out;

  if (typeof node === 'string') {
    // El texto viene con etiquetas de color por medio ("<font ...>Physical
    // Damage</font>"), asi que se limpian antes de contar.
    const t = node.replace(/<[^>]*>/g, ' ');
    out.fisico += (t.match(/Physical Damage/gi) ?? []).length;
    out.magico += (t.match(/Magic Damage/gi) ?? []).length;
    out.verdadero += (t.match(/True Damage/gi) ?? []).length;
    return out;
  }
  if (typeof node !== 'object') return out;

  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    extraerDano(v, out, depth + 1);
  }
  return out;
}

/**
 * El retrato de un heroe, de la ficha que ya se descarga.
 *
 * Se busca por FORMA, no por una ruta fija -la API ya ha movido sus campos de
 * sitio mas de una vez-: la imagen mas pequena que parezca un retrato. Y se
 * descarta `smallmap`, que es el dibujo de cuerpo entero: 240x390 y 165 KB por
 * heroe, veintidos megas para los 133.
 *
 * Cero peticiones extra: `fetchFichas` ya pide los 133 para el tipo de dano.
 */
function extraerRetrato(node) {
  const urls = [];
  const rec = (n, clave = '', depth = 0) => {
    if (depth > HONDURA || n == null) return;
    if (typeof n === 'string') {
      if (/^https?:\/\/\S+\.(png|jpe?g|webp)(\?|$)/i.test(n)) urls.push({ clave, url: n });
      return;
    }
    if (typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) rec(v, Array.isArray(n) ? clave : k, depth + 1);
  };
  rec(node);
  // `head` es el retrato cuadrado. Se prefiere el pequeno, que es el que cabe
  // en una lista: el grande pesa el doble y se ve igual a 34 pixeles.
  const cabezas = urls.filter((u) => /^head$/i.test(u.clave));
  return (cabezas[0] ?? urls.find((u) => /head/i.test(u.clave) && !/big/i.test(u.clave)))?.url ?? null;
}

/**
 * La ficha de cada heroe: speciality y tipo de dano, de UNA sola peticion.
 *
 * Antes se pedia solo para los 7 heroes sin tags a mano. Ahora se pide para
 * todos, porque el tipo de dano hace falta para los 133 y sale de la misma
 * respuesta: 133 peticiones en vez de 7, unos 35 segundos mas en una corrida
 * que ya dura minutos.
 *
 * Si la ruta no esta en el esquema o un heroe falla, se devuelve lo que haya y
 * quien llama conserva lo anterior. Quedarse sin un dato es peor que tenerlo,
 * pero no es una averia.
 */
async function fetchFichas(heroes) {
  const out = {};
  if (!ROUTES?.detail || !heroes.length) return out;
  for (const h of heroes) {
    try {
      const { data } = await callRoute(ROUTES.detail, { lang: 'en' }, h.id ?? h.name);
      const esp = extraerSpeciality(data);
      const dano = extraerDano(data);
      const ficha = {};
      if (esp.length) ficha.speciality = esp;
      if (dano.fisico || dano.magico || dano.verdadero) ficha.damage = dano;
      const retrato = extraerRetrato(data);
      if (retrato) ficha.retrato = retrato;
      if (Object.keys(ficha).length) out[h.name] = ficha;
    } catch (err) {
      if (diagnostics.speciality.errores.length < 4) {
        diagnostics.speciality.errores.push(`${h.name}: ${err.message}`);
      }
    }
    await sleep(250);
  }
  return out;
}

/**
 * Cuanta defensa da un objeto, leida del texto del propio juego.
 *
 * Mismo criterio que `extraerDano` con las habilidades: no se deduce del tipo
 * de objeto ni de una lista escrita a mano, se cuenta lo que Moonton escribe
 * en `equiptips` ("+18 Extra Magic Defense"). El tipo mentiria: las botas
 * Tough Boots estan catalogadas como "Movement" y dan 18 de defensa magica.
 *
 * Devuelve numeros, no etiquetas: quien decide es el motor.
 */
function extraerDefensa(tips) {
  const t = String(tips ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
  const suma = (re) => [...t.matchAll(re)].reduce((a, m) => a + Number(m[1]), 0);
  const magica = suma(/\+\s*(\d+(?:\.\d+)?)\s*(?:Extra\s+)?Magic(?:al)?\s+Defen[cs]e/gi);
  const fisica = suma(/\+\s*(\d+(?:\.\d+)?)\s*(?:Extra\s+)?Physical\s+Defen[cs]e/gi);
  return { magica, fisica };
}

/**
 * Que hace un objeto, leido del texto que el propio juego escribe en sus
 * habilidades. NO es una lista escrita a mano de "objetos anti-curacion": es
 * lo que pone el objeto.
 *
 * Mismo criterio que `extraerDano` con los heroes y que `extraerDefensa` con
 * las estadisticas. Y sirve para lo mismo: que la app pueda decir "el equipo
 * enemigo cura, esta build no corta curacion" sin que nadie mantenga a mano
 * una tabla que envejece con cada parche. Ya paso: "Necklace of Durance" era
 * EL objeto anti-curacion y hoy no existe en la API.
 *
 * Solo se apuntan efectos que el texto dice explicitamente:
 *
 * - `antiCuracion`: "reduce the Shield and HP Regen effects" (Sea Halberd,
 *   Dominance Ice, Glowing Wand...).
 * - `cortaControl`: "CC and Slow Duration reduced" o inmunidad (Tough Boots,
 *   Winter Crown, Wind of Nature...).
 *
 * NO se apunta "castiga al que pega con ataque basico" (Blade Armor, Antique
 * Cuirass) aunque el texto tambien lo diga: para usarlo haria falta saber
 * quien pega con ataque basico, y eso NO lo sabemos. Nuestro `damage` se
 * cuenta de las HABILIDADES, asi que a un tirador le falta justo su ataque
 * basico -Melissa sale "mixto" siendo fisica-, y el rol se equivoca con
 * Gusion, Hylos, Natan y Kimmy. Un dato que no se puede usar es dato muerto.
 */
const EFECTOS = {
  antiCuracion: /reduc\w*[^.]{0,60}(HP Regen|Regen|healing|Heal)\b/i,
  cortaControl: /(CC and Slow Duration reduced|immune to all damage and effects|reduc\w*[^.]{0,30}\b(CC|Crowd Control)\b)/i,
};

function extraerEfectos(d) {
  const texto = Object.keys(d)
    .filter((k) => /^equipskill/.test(k))
    .map((k) => d[k])
    .join(' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return Object.entries(EFECTOS).filter(([, re]) => re.test(texto)).map(([k]) => k);
}

/**
 * Los iconos de los objetos, guardados en NUESTRO sitio.
 *
 * No se enlazan desde el CDN de Moonton por dos motivos: la app promete que
 * tus datos no salen de tu movil -y cada imagen enlazada le cuenta tu IP a un
 * tercero-, y en mitad de un draft una imagen que tarda es una imagen que no
 * esta. Sirviendolos nosotros funcionan tambien sin cobertura.
 *
 * Solo se baja lo que falta: son 100x100 y no cambian salvo que Moonton
 * rediseñe el objeto, asi que la segunda corrida no descarga nada.
 */
async function bajarImagenes(urlPorClave, dir, ext, clave) {
  let bajados = 0;
  let fallos = 0;
  let existentes = new Set();
  try {
    existentes = new Set((await readdir(dir)).filter((f) => f.endsWith(ext)));
  } catch {
    await mkdir(dir, { recursive: true });
  }

  for (const [id, url] of Object.entries(urlPorClave)) {
    if (!url || existentes.has(`${id}${ext}`)) continue;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!esImagen(buf)) throw new Error('no es una imagen');
      await writeFile(resolve(dir, `${id}${ext}`), buf);
      bajados += 1;
    } catch (err) {
      fallos += 1;
      if (fallos <= 3) console.warn(`  · imagen ${id}: ${err.message}`);
    }
    await sleep(80);
  }
  (diagnostics.imagenes ??= {})[clave] = { bajados, fallos, yaEstaban: existentes.size };
  return { bajados, fallos };
}

/**
 * Que lo bajado sea de verdad una imagen. Guardar una pagina de error con
 * extension .png dejaria un hueco roto en pantalla sin que nada fallara: es
 * justo la clase de fallo invisible que mas caro sale aqui.
 *
 * Se miran las cabeceras, no la extension del enlace: la API sirve JPEG con
 * nombre .png, asi que fiarse del nombre habria colado basura.
 */
function esImagen(buf) {
  if (buf.length < 200) return false;
  const png = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const webp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  return png || jpeg || webp;
}

/**
 * El catalogo de objetos: id -> nombre, tipo y defensa medida.
 *
 * Una sola peticion para los 152 objetos. Los nombres van en ingles a
 * proposito, como los de heroe: son la clave del dato, y ensenar un nombre
 * traducido mientras el motor busca otro es el fallo invisible de siempre.
 */
async function fetchEquipo() {
  const out = {};
  if (!ROUTES?.equipment) return out;

  // Se leen TODAS las rutas de objetos que haya, no solo la mejor. La ruta
  // /expanded trae `equiptips` -de donde sale la defensa- pero 152 objetos; la
  // corta trae 184 sin tips. Con solo la primera, tres builds ensenaban
  // "#10001" en vez de "Lantern of Hope". Gana la primera que dé cada campo,
  // asi que la que va delante (la del esquema) manda donde tiene dato.
  const rutas = [ROUTES.equipment, ...(ROUTES.equipment.alternativas ?? [])];
  for (const ruta of rutas) {
    let rows = [];
    try {
      ({ rows } = await callRoute(ruta, { size: 300, index: 1, lang: 'en' }));
    } catch {
      continue; // una ruta caida no puede costarnos las que si responden
    }
    for (const row of rows) {
      const d = row?.data ?? row;
      const id = Number(d?.equipid ?? d?.id);
      const nombre = d?.equipname ?? d?.name;
      if (!Number.isFinite(id) || !nombre) continue;
      const { magica, fisica } = extraerDefensa(d.equiptips);
      const obj = out[id] ?? {};
      obj.nombre ??= String(nombre).trim();
      obj.tipo ??= d.equiptypename ?? null;
      if (d.equipicon && !obj.icono) obj.icono = String(d.equipicon);
      if (magica && !obj.magica) obj.magica = magica;
      if (fisica && !obj.fisica) obj.fisica = fisica;
      const efectos = extraerEfectos(d);
      if (efectos.length && !obj.efectos) obj.efectos = efectos;
      out[id] = obj;
    }
    await sleep(200);
  }
  return out;
}

/**
 * Builds por heroe y linea, tal como las juega la gente en el rango pedido.
 *
 * Se pide SOLO para las lineas que cada heroe juega de verdad (164 peticiones,
 * no 665): pedir la build de jungla de un support devuelve ruido o nada.
 *
 * Lo que viene son las tres builds mas frecuentes, con su winrate y su cuota
 * de uso, y TRES objetos: son los del nucleo, no los seis del inventario. Se
 * guarda tal cual, sin completar lo que la API no da.
 *
 * OJO con el winrate de una build: no es causal. Quien elige una build rara
 * suele ser quien mas juega ese heroe, asi que parte de la ventaja es del
 * jugador y no del objeto. La app lo dice en pantalla; aqui solo se recoge.
 */
async function fetchBuilds(heroList) {
  const out = {};
  if (!ROUTES?.builds) return out;
  const lineasValidas = new Set(['roam', 'jungle', 'mid', 'gold', 'exp']);
  const errores = [];
  let pedidas = 0;

  for (const h of heroList) {
    const suyas = (h.lanes ?? []).filter((l) => lineasValidas.has(l));
    for (const lane of suyas) {
      pedidas += 1;
      try {
        const { data } = await callRoute(
          ROUTES.builds,
          { lane, rank: RANK, lang: 'en', size: 20, index: 1 },
          h.id ?? h.name,
        );
        const lista = recogerBuilds(data);
        if (lista.length) (out[h.name] ??= {})[lane] = lista;
      } catch (err) {
        if (errores.length < 4) errores.push(`${h.name}/${lane}: ${err.message}`);
      }
      await sleep(200);
    }
  }
  diagnostics.builds = {
    pedidas,
    heroes: Object.keys(out).length,
    builds: Object.values(out).reduce((a, porLinea) => a + Object.values(porLinea).reduce((b, l) => b + l.length, 0), 0),
    errores,
  };
  return out;
}

/**
 * Saca las builds de la respuesta sin fijar la forma del envoltorio: se busca
 * el primer array cuyos elementos tengan `equipid`, este donde este.
 */
function recogerBuilds(node, depth = 0) {
  if (depth > HONDURA || node == null || typeof node !== 'object') return [];
  if (Array.isArray(node) && node.some((x) => x && typeof x === 'object' && Array.isArray(x.equipid))) {
    return node
      .filter((b) => Array.isArray(b?.equipid) && b.equipid.length)
      .map((b) => {
        const out = { objetos: b.equipid.map(Number).filter(Number.isFinite) };
        const wr = Number(b.build_win_rate ?? b.win_rate);
        const pr = Number(b.build_pick_rate ?? b.pick_rate);
        if (Number.isFinite(wr)) out.winRate = wr;
        if (Number.isFinite(pr)) out.pickRate = pr;
        const emblema = b?.emblem?.data?.emblemname ?? b?.emblem?.emblemname;
        const hechizo = b?.battleskill?.data?.__data?.skillname ?? b?.battleskill?.data?.skillname;
        if (emblema) out.emblema = String(emblema);
        if (hechizo) out.hechizo = String(hechizo);
        return out;
      })
      .filter((b) => b.objetos.length);
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const found = recogerBuilds(v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

async function fetchHeroList() {
  const values = { size: 300, index: 1, page_size: 300, page_index: 1, lang: 'en' };
  const { rows } = ROUTES?.position
    ? await callRoute(ROUTES.position, values)
    : await fetchResource(['/hero-position/', '/hero-position', '/hero-list/'], values);
  const heroes = [];
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    heroes.push({
      name: String(name).trim(),
      id: idPrincipal(row),
      // pick() primero por si la API vuelve a una forma plana; si no, se busca.
      role: String(pick(row, ['role', 'hero_role', 'primary_role']) ?? '').toLowerCase() || extraerRol(row),
      lane: String(pick(row, ['lane', 'hero_lane', 'primary_lane']) ?? '').toLowerCase(),
      // Varias líneas por héroe: es lo que permite adivinar quién es su roam.
      lanes: extraerLineas(row),
    });
  }
  return heroes;
}

async function fetchStats(rank) {
  const values = {
    days: DAYS, past_days: DAYS,
    rank, rank_id: rank,
    size: 200, index: 1, page_size: 200, page_index: 1,
    sort_field: 'win_rate', sort_order: 'desc', order: 'desc', lang: 'en',
  };
  const { rows } = ROUTES?.rank
    ? await callRoute(ROUTES.rank, values)
    : await fetchResource(['/hero-rank/', '/hero-rank', '/hero-rate/'], values);

  const stats = {};
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    stats[String(name).trim()] = {
      winRate: asRate(pick(row, ['win_rate', 'winRate', 'main_hero_win_rate'])),
      pickRate: asRate(pick(row, ['pick_rate', 'pickRate', 'main_hero_appearance_rate'])),
      banRate: asRate(pick(row, ['ban_rate', 'banRate', 'main_hero_ban_rate'])),
      matches: Number(pick(row, ['matches', 'match_count', 'total']) ?? 0) || null,
      heroId: idPrincipal(row),
    };
  }
  return stats;
}

/**
 * Pares héroe→rival. Unos campos son winrate absoluto y otros un delta sobre la
 * media, y distinguirlos por su tamaño fallaba: un delta de +0.25 se tomaba por
 * un winrate del 25%. Ahora se mira QUÉ campo vino, que es lo que lo determina.
 */
/**
 * Entre las rutas candidatas, la que MAS cruces devuelve de verdad.
 *
 * El esquema dice que varias rutas hablan de counters; no dice cual trae el
 * dato entero. Antes se elegia por el nombre -y se descartaban las de
 * /academy dando por hecho que eran material didactico-. Era falso y salia
 * caro: la ruta preferida devolvia CINCO cruces por heroe y la descartada los
 * 132, o sea la matriz completa. La cobertura de la app pasaba del 11% al 100%
 * por elegir mal una ruta.
 *
 * Ahora se llama a cada candidata con un heroe de prueba y gana la que mas
 * pares legibles trae. Si la API vuelve a mover las rutas de sitio, esto se
 * entera solo, que es la regla de toda la ingesta.
 */
async function elegirRutaConMasDatos(clave, heroeDePrueba) {
  const ruta = ROUTES?.[clave];
  if (!ruta?.alternativas?.length) return;

  const values = { days: DAYS, past_days: DAYS, rank: RANK, rank_id: RANK, lang: 'en', size: 200, index: 1 };
  const medir = async (r) => {
    try {
      const { data } = await callRoute(r, { ...values, hero_id: heroeDePrueba, id: heroeDePrueba }, heroeDePrueba);
      return Object.keys(relationMap(recogerPares(data), new Map())).length || recogerPares(data).length;
    } catch {
      return -1;
    }
  };

  let mejor = { ruta, pares: await medir(ruta) };
  for (const alt of ruta.alternativas) {
    const pares = await medir(alt);
    await sleep(200);
    if (pares > mejor.pares) mejor = { ruta: alt, pares };
  }

  (diagnostics.rutasMedidas ??= {})[clave] = `${mejor.pares} pares · ${mejor.ruta.template}`;
  if (mejor.ruta !== ruta) {
    console.log(`  · ${clave}: gana ${mejor.ruta.template} con ${mejor.pares} pares`);
    ROUTES[clave] = { ...mejor.ruta, alternativas: ruta.alternativas };
  } else {
    console.log(`  · ${clave}: se queda ${ruta.template} con ${mejor.pares} pares`);
  }
}

/**
 * El JSON de salida, con las dos matrices en UNA LINEA POR HEROE.
 *
 * Desde que los counters vienen completos son 17.556 numeros. Con la
 * indentacion normal eso son 17.556 lineas: el fichero pasa de 377 KB a 623 KB
 * y el diff se vuelve ilegible, justo lo que Javi no puede permitirse
 * revisando desde el movil. Con una linea por heroe, el diff dice "cambiaron
 * estos 12 heroes" en vez de doce mil lineas sueltas.
 *
 * Los winrates se redondean a cuatro decimales. La quinta cifra de un winrate
 * es ruido: la API la da, pero no significa nada y ocupa.
 */
export function serializar(out) {
  // Marca de texto normal, no un caracter de control: JSON.stringify escapa
  // \u0000 como la secuencia literal "\u0000", asi que la marca no volvia a
  // encontrarse y el fichero salia con basura donde iban los datos.
  const MARCA = '@@fila';
  const filas = [];
  const compactar = (m) => Object.fromEntries(Object.entries(m ?? {}).map(([k, fila]) => {
    const redondeada = Object.fromEntries(
      Object.entries(fila ?? {}).map(([n, v]) => [n, typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v]),
    );
    filas.push(JSON.stringify(redondeada));
    return [k, `${MARCA}:${filas.length - 1}:${MARCA}`];
  }));

  // Las builds tambien van a una linea por heroe: son tres builds por linea y
  // con la indentacion normal se comen 3.000 lineas de diff por nada.
  const compactarBuilds = (m) => Object.fromEntries(Object.entries(m ?? {}).map(([k, porLinea]) => {
    filas.push(JSON.stringify(porLinea));
    return [k, `${MARCA}:${filas.length - 1}:${MARCA}`];
  }));

  const texto = JSON.stringify(
    {
      ...out,
      counters: compactar(out.counters),
      synergies: compactar(out.synergies),
      builds: compactarBuilds(out.builds),
    },
    null,
    2,
  );
  return texto.replace(
    new RegExp(`"${MARCA}:(\\d+):${MARCA}"`, 'g'),
    (_, i) => filas[Number(i)],
  );
}

async function fetchRelations(roamNames, stats, heroList) {
  const counters = {};
  const synergies = {};

  // El id puede venir en las estadísticas o en la lista de héroes. Si no está en
  // ninguna, la API acepta también el nombre como identificador, así que se usa
  // eso antes que rendirse: antes bastaba con que faltara el id para que TODOS
  // los counters se quedaran vacíos sin decir nada.
  const norm = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const idPorNombre = new Map();
  const idToName = new Map();
  for (const [n, st] of Object.entries(stats)) {
    if (st.heroId) { idPorNombre.set(norm(n), st.heroId); idToName.set(Number(st.heroId), n); }
  }
  for (const h of heroList ?? []) {
    if (h.id) { idPorNombre.set(norm(h.name), h.id); idToName.set(Number(h.id), h.name); }
  }
  console.log(`  · ${idToName.size} héroes con id conocido`);
  if (!idToName.size) {
    console.warn('  · SIN IDS: los counters se pedirán por nombre');
  }

  diagnostics.relations = {
    rutaCounter: ROUTES?.counter ? `${ROUTES.counter.method} ${ROUTES.counter.template}` : null,
    // 'ejemplos' tiene que estar aqui: mas abajo se lee su .length, y sin
    // inicializar reventaba con un TypeError por cada roamer al que SI le
    // llegaban los counters. Los datos se salvaban (se asignan antes), pero el
    // diagnostico se llenaba de cuatro errores falsos y, con el tope de 4
    // alcanzado, tapaba los errores de verdad.
    conId: 0, porNombre: 0, ok: 0, errores: [], ejemplos: [],
  };

  for (const name of roamNames) {
    const id = idPorNombre.get(norm(name)) ?? name;
    if (idPorNombre.has(norm(name))) diagnostics.relations.conId++;
    else diagnostics.relations.porNombre++;
    try {
      // size grande: por defecto la API pagina de 20 en 20 y se perdian cruces.
      const values = { days: DAYS, past_days: DAYS, rank: RANK, rank_id: RANK, lang: 'en', size: 200, index: 1 };
      const [c, s] = await Promise.all([
        // Sin ruta en el esquema no se prueba a ciegas: acababa llamando a
        // dominios muertos y llenando el diagnóstico de errores de Vercel que
        // no decían nada del problema real.
        ROUTES?.counter
          ? callRoute(ROUTES.counter, { ...values, hero_id: id, id }, id)
          : Promise.reject(new Error('sin ruta de counter en el esquema')),
        ROUTES?.compatibility
          ? callRoute(ROUTES.compatibility, { ...values, hero_id: id, id }, id)
          : Promise.reject(new Error('sin ruta de compatibilidad en el esquema')),
      ]);
      counters[name] = relationMap(recogerPares(c.data), idToName);
      synergies[name] = relationMap(recogerPares(s.data), idToName);
      if (Object.keys(counters[name]).length) {
        diagnostics.relations.ok++;
        if (diagnostics.relations.ejemplos.length < 2) {
          const pares = Object.entries(counters[name]).slice(0, 3)
            .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ');
          diagnostics.relations.ejemplos.push(`${name} vs ${pares}`);
        }
      } else if (diagnostics.relations.errores.length < 2) {
        // Respondió pero no supimos leerlo. Guardamos un trozo de la respuesta
        // TAL CUAL: los nombres de campo son lo único que falta por saber, y
        // adivinarlos de uno en uno cuesta un despliegue por intento.
        diagnostics.relations.errores.push(`${name}: respuesta sin pares legibles`);
        diagnostics.relations.muestra = JSON.stringify(c.data).slice(0, 900);
      }
    } catch (err) {
      if (diagnostics.relations.errores.length < 4) {
        diagnostics.relations.errores.push(`${name}: ${err.message}`);
      }
    }
    await sleep(250); // cortesía con una API gratuita
  }
  return { counters, synergies };
}

async function main() {
  console.log(`Ingesta MLBB · rangos=${RANKS.join(',')} · ventana=${DAYS}d`);

  ROUTES = await discoverRoutes();
  if (ROUTES) {
    for (const [k, r] of Object.entries(ROUTES)) console.log(`  · ${k}: ${r.method} ${r.template}`);
  } else {
    console.warn('  · no se pudo leer el esquema; pruebo rutas conocidas a ciegas');
  }

  const heroes = JSON.parse(await readFile(HEROES, 'utf8'));

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* primera ejecución */
  }

  let heroList = previous?.heroes ?? [];
  try {
    const fresh = await fetchHeroList();
    if (fresh.length) heroList = fresh;
    console.log(`  · lista completa: ${heroList.length} héroes`);
  } catch (err) {
    console.warn(`  · lista de héroes: fallo (${err.message}); conservo la anterior`);
  }

  // La ficha de los 133: el tipo de dano hace falta para todos, y la
  // speciality viene en la misma respuesta. Solo se guarda la speciality de
  // los que no tienen tags escritos a mano, que son los unicos que la usan.
  //
  // Lo anterior se conserva heroe a heroe: el tipo de dano no cambia de un dia
  // para otro, asi que perder la peticion de un heroe no puede costarnos el
  // dato que ya teniamos.
  const enCatalogo = new Set(heroes.heroes.map((h) => h.name));
  const danoPrevio = Object.fromEntries(
    (previous?.heroes ?? []).filter((h) => h?.damage).map((h) => [h.name, h.damage]),
  );
  const retratoPrevio = Object.fromEntries(
    (previous?.heroes ?? []).filter((h) => h?.retrato).map((h) => [h.name, h.retrato]),
  );
  for (const h of heroList) {
    if (danoPrevio[h.name]) h.damage = danoPrevio[h.name];
    if (retratoPrevio[h.name]) h.retrato = retratoPrevio[h.name];
  }

  diagnostics.speciality = { pedidos: heroList.length, ok: 0, errores: [] };
  diagnostics.dano = { ok: 0, conservados: 0, sin: 0 };
  try {
    const fichas = await fetchFichas(heroList);
    for (const h of heroList) {
      const f = fichas[h.name];
      if (f?.speciality && !enCatalogo.has(h.name)) h.speciality = f.speciality;
      if (f?.damage) h.damage = f.damage;
      if (f?.retrato) h.retrato = f.retrato;
    }
    diagnostics.speciality.ok = Object.values(fichas).filter((f) => f.speciality).length;
    diagnostics.dano.ok = Object.values(fichas).filter((f) => f.damage).length;
    console.log(`  · fichas: ${Object.keys(fichas).length}/${heroList.length} heroes`);
  } catch (err) {
    console.warn(`  · fichas: fallo (${err.message}); se conserva lo anterior`);
  }
  diagnostics.dano.conservados = heroList.filter((h) => h.damage && danoPrevio[h.name]).length;
  diagnostics.dano.sin = heroList.filter((h) => !h.damage).length;
  console.log(`  · tipo de dano: ${heroList.length - diagnostics.dano.sin}/${heroList.length} heroes`);

  // Counters de TODOS los heroes, no solo de los roamers: la app recomienda
  // para las cinco lineas y un mediocarril necesita sus matchups igual que un
  // roamer. Son ~266 peticiones en vez de 70, que es el precio de que la app
  // sirva para cualquier rol.
  const todos = mergeCatalog(heroes.heroes, heroList);
  const nombresPedir = [...new Set(todos.map((h) => h.name))];
  const roamNames = [...new Set(todos.filter((h) => h.roam).map((h) => h.name))];
  console.log(`  · ${nombresPedir.length} heroes a los que pedir counters`);

  const statsByRank = { ...(previous?.statsByRank ?? {}) };
  diagnostics.rangos = {};
  for (const rank of RANKS) {
    try {
      const s = await fetchStats(rank);
      if (Object.keys(s).length) statsByRank[rank] = s;
      diagnostics.rangos[rank] = `${Object.keys(s).length} héroes`;
      console.log(`  · ${rank}: ${Object.keys(s).length} héroes`);
    } catch (err) {
      // Antes solo salía por consola y en la app no había forma de saber que
      // faltaban tres de los cuatro rangos.
      diagnostics.rangos[rank] = `fallo: ${err.message.slice(0, 120)}`;
      console.warn(`  · ${rank}: fallo (${err.message}); conservo lo anterior`);
    }
    await sleep(250);
  }
  const stats = statsByRank[RANK] ?? Object.values(statsByRank)[0] ?? previous?.stats ?? {};

  // Antes de pedir 266 veces, comprobar por cual de las rutas candidatas viene
  // el dato completo. Cuesta unas pocas peticiones y ha valido la matriz entera.
  const heroeDePrueba = heroList.find((h) => h.id)?.id ?? nombresPedir[0];
  for (const clave of ['counter', 'compatibility']) {
    try {
      await elegirRutaConMasDatos(clave, heroeDePrueba);
    } catch (err) {
      console.warn(`  · ${clave}: no se ha podido comparar rutas (${err.message}); se usa la del esquema`);
    }
  }

  // Objetos y builds. Como todo lo demas, si falla se conserva lo anterior: un
  // objeto no cambia de estadisticas de un dia para otro, y quedarse sin el
  // dato es peor que tenerlo con un dia de retraso.
  let equipo = previous?.equipment ?? {};
  try {
    const fresh = await fetchEquipo();
    if (Object.keys(fresh).length) equipo = fresh;
    console.log(`  · objetos: ${Object.keys(equipo).length}`);
  } catch (err) {
    console.warn(`  · objetos: fallo (${err.message}); conservo los anteriores`);
  }

  let builds = previous?.builds ?? {};
  try {
    const fresh = await fetchBuilds(heroList);
    if (Object.keys(fresh).length) builds = fresh;
    console.log(`  · builds: ${Object.keys(builds).length} heroes`);
  } catch (err) {
    console.warn(`  · builds: fallo (${err.message}); conservo las anteriores`);
  }

  // Los iconos, solo de los objetos que la app puede llegar a ensenar: los que
  // salen en alguna build y los que puede proponer por su defensa o su efecto.
  // Son ~70 de 184, y la segunda corrida no baja ninguno.
  try {
    const aEnsenar = new Set();
    for (const porLinea of Object.values(builds)) {
      for (const lista of Object.values(porLinea)) for (const b of lista) for (const id of b.objetos ?? []) aEnsenar.add(String(id));
    }
    for (const [id, o] of Object.entries(equipo)) if (o.magica || o.fisica || o.efectos?.length) aEnsenar.add(id);
    const subconjunto = Object.fromEntries(Object.entries(equipo).filter(([id]) => aEnsenar.has(id)));
    const urls = Object.fromEntries(Object.entries(subconjunto).map(([id, o]) => [id, o.icono]));
    const { bajados, fallos } = await bajarImagenes(urls, ICONOS, '.png', 'objetos');
    console.log(`  · iconos: ${bajados} nuevos, ${fallos} fallos (de ${Object.keys(subconjunto).length} que se ensenan)`);
  } catch (err) {
    console.warn(`  · iconos: fallo (${err.message}); se ensenaran solo los nombres`);
  }

  // Los retratos, uno por heroe, por su id: es lo que la app pide y no cambia
  // aunque a Moonton le de por reescribir el nombre.
  try {
    const urls = Object.fromEntries(
      heroList.filter((h) => h.retrato && h.id != null).map((h) => [h.id, h.retrato]),
    );
    const { bajados, fallos } = await bajarImagenes(urls, RETRATOS, '.jpg', 'heroes');
    console.log(`  · retratos: ${bajados} nuevos, ${fallos} fallos (de ${Object.keys(urls).length} heroes)`);
  } catch (err) {
    console.warn(`  · retratos: fallo (${err.message}); la lista saldra sin caras`);
  }

  let relations = { counters: previous?.counters ?? {}, synergies: previous?.synergies ?? {} };
  try {
    const fresh = await fetchRelations(nombresPedir, stats, heroList);
    if (Object.keys(fresh.counters).length) relations = fresh;
    console.log(`  · relaciones de ${Object.keys(relations.counters).length} roamers`);
  } catch (err) {
    console.warn(`  · relaciones: fallo (${err.message}); conservo las anteriores`);
  }

  const avgOf = (byName) => {
    const r = Object.values(byName).map((s) => s.winRate).filter((n) => n != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0.5;
  };

  // Misma normalización que usa la app, para que el aviso coincida con la realidad.
  const norm = (n) => String(n ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const statKeys = new Set(Object.keys(stats).map(norm));
  const sinDatos = roamNames.filter((n) => !statKeys.has(norm(n)));

  const known = new Set(heroes.heroes.map((h) => h.name));
  const seen = new Set([...Object.keys(stats), ...heroList.map((h) => h.name)]);
  const newHeroes = [...seen].filter((n) => !known.has(n));

  const out = {
    generatedAt: new Date().toISOString(),
    rank: RANK,
    ranks: Object.keys(statsByRank),
    days: DAYS,
    patchAvgWinRate: avgOf(stats),
    avgByRank: Object.fromEntries(Object.entries(statsByRank).map(([k, v]) => [k, avgOf(v)])),
    heroCount: Object.keys(stats).length,
    roamCoverage: { withData: roamNames.length - sinDatos.length, total: roamNames.length, missing: sinDatos },
    // Cuantos heroes de cada linea tienen counters. Es lo que dice si la app
    // puede recomendar de verdad para esa linea o esta a medias.
    coberturaPorLinea: Object.fromEntries(
      ['roam', 'jungle', 'mid', 'gold', 'exp'].map((linea) => {
        const de = heroList.filter((h) => (h.lanes ?? []).includes(linea));
        const con = de.filter((h) => Object.keys(relations.counters[h.name] ?? {}).length);
        return [linea, { total: de.length, conCounters: con.length }];
      }),
    ),
    heroes: heroList,
    newHeroes,
    diagnostics: {
      // Cuando las rutas salen del esquema, LOCKED no llega a usarse: la base
      // hay que sacarla de ahí o la app muestra "API: desconocida" teniéndola.
      base: LOCKED
        ? `${LOCKED.method} ${LOCKED.base}${LOCKED.prefix}`
        : (ROUTES?.rank ? `${ROUTES.rank.method} ${new URL(ROUTES.rank.template).origin}` : null),
      schema: diagnostics.schema ?? null,
      routes: diagnostics.routes ?? null,
      relations: diagnostics.relations ?? null,
      speciality: diagnostics.speciality ?? null,
      rutasMedidas: diagnostics.rutasMedidas ?? null,
      dano: diagnostics.dano ?? null,
      builds: diagnostics.builds ?? null,
      rangos: diagnostics.rangos ?? null,
      ok: [...new Set(diagnostics.ok)].slice(0, 6),
      failed: Object.keys(statsByRank).length ? [] : [...new Set(diagnostics.failed)].slice(0, 12),
    },
    stats,
    statsByRank,
    counters: relations.counters,
    synergies: relations.synergies,
    equipment: equipo,
    builds,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, serializar(out) + '\n');

  console.log(`Escrito ${OUT}`);
  if (diagnostics.relations) {
    const r = diagnostics.relations;
    console.log(`Relaciones: ${r.ok} con datos · ${r.conId} por id · ${r.porNombre} por nombre`);
    for (const e of r.errores) console.warn(`  ${e}`);
  }
  if (!Object.keys(statsByRank).length) {
    console.warn('SIN ESTADÍSTICAS. Combinaciones probadas que fallaron:');
    for (const f of [...new Set(diagnostics.failed)].slice(0, 12)) console.warn(`  ${f}`);
  } else if (sinDatos.length) {
    console.warn(`Roamers sin estadísticas (${sinDatos.length}/${roamNames.length}): ${sinDatos.join(', ')}`);
    console.warn('Si son muchos, los nombres de la API no coinciden con heroes.json.');
  }
  if (newHeroes.length) {
    console.log(`Héroes sin tags propios (usan los de su rol): ${newHeroes.join(', ')}`);
  }
}

// Solo se ejecuta al lanzarlo directamente, para poder importar sus funciones
// desde las pruebas sin disparar una ingesta entera.
const ejecutadoDirectamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ejecutadoDirectamente) {
  main().catch((err) => {
    console.error('Ingesta fallida:', err.message);
    process.exit(1);
  });
}

export { main, extraerLineas, extraerRol };
