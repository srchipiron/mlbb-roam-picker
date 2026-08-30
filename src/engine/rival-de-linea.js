import { normName } from './score.js';

/**
 * Quién es el rival de TU línea en el equipo enemigo.
 *
 * En el draft solo ves cinco nombres, sin líneas asignadas. Saber cuál va a tu
 * línea importa porque es con quien más vas a chocar: su matchup pesa el doble.
 *
 * Esto era `roam-enemigo.js` y solo sabía encontrar al roamer. Al abrir la app
 * a las cinco líneas, la idea es la misma para todas: si juegas mid, quien te
 * importa el doble es su mediocarril.
 *
 * La decisión sale de en qué líneas se juega realmente cada héroe (dato de la
 * API). Los roles típicos de cada línea NO están escritos a mano: se cuentan
 * del propio listado, así que si el meta cambia y los magos empiezan a ir a la
 * exp, esto se entera solo.
 */

/**
 * Con qué frecuencia cada rol juega cada línea, contado del listado de la API.
 * Devuelve { linea: { rol: 0..1 } }.
 */
export function frecuenciaDeRoles(apiHeroes = []) {
  const cuenta = {};
  for (const h of apiHeroes) {
    const rol = String(h?.role ?? '').toLowerCase();
    if (!rol) continue;
    for (const l of h?.lanes ?? []) {
      ((cuenta[l] ??= {})[rol] ??= 0);
      cuenta[l][rol]++;
    }
  }
  const salida = {};
  for (const [linea, roles] of Object.entries(cuenta)) {
    const total = Object.values(roles).reduce((a, b) => a + b, 0) || 1;
    salida[linea] = Object.fromEntries(
      Object.entries(roles).map(([rol, n]) => [rol, n / total]),
    );
  }
  return salida;
}

/**
 * Probabilidad aproximada de que un héroe sea el de esa línea en su equipo.
 * No pretende ser exacta: solo tiene que ORDENAR bien a cinco candidatos.
 */
export function probabilidadDeLinea(hero, info, linea, frecuencias = {}) {
  const lineas = info?.lanes ?? [];
  const rol = (info?.role ?? hero?.role ?? '').toLowerCase();

  let p = 0;

  // 1. Lo mejor con diferencia: la API dice que se juega ahí.
  if (lineas.includes(linea)) {
    // Cuantas menos líneas alternativas tenga, más seguro es que sea esa.
    p += 0.6 + 0.25 / Math.max(1, lineas.length);
  }

  // 2. Lo típico de esa línea, contado del listado. Un rol que copa la línea
  //    suma; uno que casi nunca aparece por ahí, resta.
  const frec = frecuencias[linea] ?? {};
  const suya = frec[rol] ?? 0;
  const maxima = Math.max(0, ...Object.values(frec));
  if (maxima > 0) p += (suya / maxima) * 0.3 - (suya === 0 ? 0.25 : 0);

  // 3. Respaldo para cuando NO hay datos de la API todavía. Solo sirve para
  //    roam, porque el catálogo escrito a mano es lo único que marca quién
  //    hace roam: de las otras cuatro líneas no sabe nada. Es peor que el
  //    dato, pero mantiene la app útil en el primer arranque.
  if (!lineas.length && maxima === 0 && linea === 'roam') {
    if (hero?.roam) p += 0.45;
    if (rol === 'tank' || rol === 'support') p += 0.2;
    if (hero?.tags?.includes('hypercarry')) p -= 0.3;
  }

  return p;
}

/**
 * Elige al rival de tu línea entre los enemigos ya elegidos.
 *
 * Devuelve null cuando no hay un favorito claro: equivocarse es peor que no
 * decir nada, porque duplica el peso del matchup equivocado.
 */
export function detectarRivalDeLinea(enemies, heroInfo = new Map(), linea = 'roam', frecuencias = {}, margen = 0.15) {
  if (!enemies?.length || !linea) return null;

  const puntuados = enemies
    .map((h) => ({ hero: h, p: probabilidadDeLinea(h, heroInfo.get(normName(h.name)), linea, frecuencias) }))
    .sort((a, b) => b.p - a.p);

  const [primero, segundo] = puntuados;
  if (primero.p <= 0.3) return null;                        // ninguno encaja
  if (segundo && primero.p - segundo.p < margen) return null; // demasiado parejo

  return primero.hero.name;
}

/** Mapa nombre normalizado -> { role, lanes } a partir de los datos de la API. */
export function indiceDeLineas(apiHeroes = []) {
  const mapa = new Map();
  for (const h of apiHeroes) {
    if (!h?.name) continue;
    const lanes = Array.isArray(h.lanes)
      ? h.lanes.map((l) => String(l).toLowerCase())
      : String(h.lane ?? '').toLowerCase().split(/[,/|]/).map((l) => l.trim()).filter(Boolean);
    mapa.set(normName(h.name), { role: String(h.role ?? '').toLowerCase(), lanes });
  }
  return mapa;
}
