/**
 * Lectura de las respuestas de counters y compatibilidad.
 *
 * Vive aparte de la ingesta para poder probarlo con respuestas reales guardadas,
 * sin levantar servidores ni salir a internet. Toda la fragilidad de este
 * proyecto está aquí: la API envuelve los datos en varias capas y nombra los
 * campos de formas distintas según el endpoint.
 */

export const NAME_KEYS = [
  'name', 'hero_name', 'heroname', 'hero', 'heroName',
  'target_name', 'opponent', 'enemy_name', 'against', 'title', 'label',
];

/**
 * Claves que identifican a un héroe. NO se incluye `id` a secas: la respuesta
 * trae `main_hero_channel.id` con valores como 2678829, y la búsqueda recursiva
 * se quedaba con ese en vez del 93 del héroe. La API lo rechazaba con un 422
 * diciendo que el identificador debe ser <= 133.
 */
export const ID_KEYS = ['heroid', 'hero_id', 'heroId', 'sub_heroid', 'main_heroid'];

/** Hoy hay ~133 héroes. Un número muy por encima no es un héroe, es otra cosa. */
export const MAX_HERO_ID = 400;

export const esIdDeHeroe = (v) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_HERO_ID;

/**
 * Id del héroe PRINCIPAL de un registro.
 *
 * Mira solo el nivel superior y el `data` inmediato, y prueba `main_heroid`
 * antes que nada. Buscar en profundidad se metía dentro de `sub_hero` y volvía
 * con el id del primer rival en lugar del héroe del registro.
 */
export function idPrincipal(row) {
  const niveles = [row, row?.data, row?.data?.data].filter((n) => n && typeof n === 'object');
  const orden = ['main_heroid', 'hero_id', 'heroid', 'heroId'];

  for (const clave of orden) {
    for (const nivel of niveles) {
      if (esIdDeHeroe(nivel[clave])) return nivel[clave];
    }
  }
  return null;
}

/** Campos que expresan una VENTAJA sobre la media, no un winrate absoluto. */
export const DELTA_KEYS = [
  'increase_win_rate', 'increase_winrate', 'win_rate_increase',
  'winRateIncrease', 'delta', 'advantage', 'diff',
];

export const ABS_KEYS = [
  'win_rate', 'hero_win_rate', 'winRate', 'winrate', 'wr', 'rate', 'value', 'score',
];

/**
 * La API mezcla 0.52 y 52 para decir lo mismo. Con Math.abs, además, un delta
 * negativo (-2.5, o sea -2,5 puntos) se convierte bien.
 */
export const asRate = (n) => {
  if (n == null) return null;
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Math.abs(x) > 1 ? x / 100 : x;
};

/** Busca un valor por varios nombres de campo, a cualquier profundidad. */
export function pick(obj, keys, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] != null && typeof obj[k] !== 'object') return obj[k];
  }
  for (const v of Object.values(obj)) {
    const found = pick(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Recorre la respuesta entera y recoge los objetos que describen a un rival.
 *
 * Un rival puede venir identificado por nombre o SOLO por su id numérico: en
 * esta API, `sub_hero` trae `heroid` y la URL de su icono, sin ninguna cadena
 * con el nombre. Buscar solo nombres devolvía cero pares.
 */
export function recogerPares(node, out = [], depth = 0) {
  if (depth > 10 || node == null) return out;

  // Algunas respuestas guardan el contenido como texto JSON dentro de un campo.
  if (typeof node === 'string') {
    const t = node.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length < 200000) {
      try { return recogerPares(JSON.parse(t), out, depth + 1); } catch { /* no era JSON */ }
    }
    return out;
  }

  if (typeof node !== 'object') return out;

  if (Array.isArray(node)) {
    for (const v of node) recogerPares(v, out, depth + 1);
    return out;
  }

  const tieneNombre = NAME_KEYS.some((k) => typeof node[k] === 'string');
  const tieneId = ID_KEYS.some((k) => esIdDeHeroe(node[k]));
  const tieneTasa = [...DELTA_KEYS, ...ABS_KEYS]
    .some((k) => node[k] != null && typeof node[k] !== 'object');

  if ((tieneNombre || tieneId) && tieneTasa) out.push(node);

  for (const v of Object.values(node)) recogerPares(v, out, depth + 1);
  return out;
}

/**
 * Convierte los objetos recogidos en un mapa { rival: winrate }.
 *
 * `idToName` resuelve los rivales que solo traen id. El winrate se saca del
 * delta si lo hay (más fiable, ya viene centrado en la media) y si no, del
 * valor absoluto. Se descarta lo que caiga fuera de 20%-80%, que sería un dato
 * mal leído y no un matchup.
 */
export function relationMap(rows, idToName = new Map()) {
  const map = {};

  for (const row of rows) {
    let name = NAME_KEYS.map((k) => row[k]).find((v) => typeof v === 'string');
    if (!name) {
      const id = ID_KEYS.map((k) => row[k]).find(esIdDeHeroe);
      name = idToName.get(Number(id));
    }
    if (!name) continue;

    const delta = asRate(DELTA_KEYS.map((k) => row[k]).find((v) => v != null));
    const abs = asRate(ABS_KEYS.map((k) => row[k]).find((v) => v != null));
    const valor = delta != null ? 0.5 + delta : abs;

    if (valor != null && valor > 0.2 && valor < 0.8) map[String(name).trim()] = valor;
  }

  return map;
}

/**
 * Nombre del héroe al que se refiere un registro de relaciones. Sirve para
 * comprobar que la respuesta corresponde al héroe que se pidió.
 */
export function heroeDelRegistro(data) {
  return pick(data?.data ?? data, ['name']) ?? null;
}
