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
 * Cuánto pesa que el rol del héroe sea típico de la línea, frente a que la API
 * diga que juega ahí (0.6 + 0.25/líneas).
 *
 * Medido sobre drafts con la línea de cada enemigo conocida, 800 por caso y
 * dos semillas, moviendo cada constante de esta función. Tres están en meseta
 * (±0,2 puntos: ruido). Esta es la única que mueve algo, y de forma monótona:
 *
 *   rol   acierta 5en   se equivoca 5en   acierta 3en   se equivoca 3en
 *   0.30     94,4%          1,3-1,5%          87,3%          2,7%
 *   0.15     94,4%          0,7-0,9%          86,1%          0,5-0,6%
 *   0.10     93,5%          0,0%              85,8%          0,0%
 *
 * Se elige 0.10: cero rivales equivocados en 1.600 drafts a cambio de 1-1,5
 * puntos de cobertura. Un rival mal nombrado dobla su cruce y sale en el
 * análisis como un hecho; callarse no cuesta nada. Y el rol siempre fue la
 * señal débil: se equivoca con Gusion, Hylos, Natan y Kimmy. Lo que decide es
 * la lista de líneas de la API, que es el dato.
 */
const ROL_TIPICO = 0.10;

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
  if (maxima > 0) p += (suya / maxima) * ROL_TIPICO - (suya === 0 ? 0.25 : 0);

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
 * Cuánto tiene que ganar el mejor reparto al mejor reparto que ponga a OTRO en
 * tu línea, para nombrar a alguien.
 *
 * Medido sobre 1.500 drafts por caso con la línea de cada enemigo conocida:
 * entre 0.15 y 0.30 la precisión en draft completo no se mueve (94%), y en
 * draft a medias cada subida quita errores a cambio de callarse un poco más
 * (0.15: 3,6% de errores; 0.20: 2,7%; 0.30: 0,7% pero calla el 13,5%). 0.20
 * es el punto en que se dejan de nombrar rivales separados SOLO por lo típico
 * de su rol -dos que juegan roam y nada más, uno tanque y otro support- sin
 * perder cobertura apreciable.
 */
const MARGEN_PARA_HABLAR = 0.20;

/** Las cinco líneas. Copia local para no importar en círculo desde score.js. */
const LINEAS = ['roam', 'jungle', 'mid', 'gold', 'exp'];

function permutaciones(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const resto = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutaciones(resto)) out.push([arr[i], ...p]);
  }
  return out;
}

function combinaciones(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [x, ...r] = arr;
  return [...combinaciones(r, k - 1).map((c) => [x, ...c]), ...combinaciones(r, k)];
}

/**
 * Elige al rival de tu línea entre los enemigos ya elegidos.
 *
 * No mira a cada enemigo por separado: reparte a TODOS los enemigos entre las
 * líneas a la vez, una por cabeza, y se queda con el reparto que mejor encaja.
 * Así usa la eliminación, que es como lo hace cualquiera que lea un draft: si
 * cuatro enemigos encajan claramente en otras líneas, el quinto es tu rival
 * aunque él solo sea ambiguo (Yu Zhong juega exp y jungla; si ya hay un
 * jungla claro, va a la exp).
 *
 * Medido contra 2.000 drafts con la línea de cada enemigo conocida:
 *
 *   - Draft completo: exp pasa de acertar el 60% al 88%, jungla del 69% al
 *     91%, roam del 78% al 94%. Y con MENOS errores, no más.
 *   - Draft a medias (2-3 enemigos): el método anterior se equivocaba del 10%
 *     al 21% de las veces, porque nombraba a un rival que todavía no estaba en
 *     el draft -el mid como si fuera tu exp- y le doblaba el cruce. Ahora
 *     entre el 4% y el 6%, y en su lugar se calla, que es lo correcto cuando
 *     tu rival aún no ha salido.
 *
 * Devuelve null cuando no hay un favorito claro: equivocarse es peor que no
 * decir nada, porque duplica el peso del matchup equivocado. "Claro" es que el
 * mejor reparto le gane por `margen` al mejor reparto que ponga a OTRO en tu
 * línea, que es la pregunta exacta y no una aproximación por cabeza.
 */
export function detectarRivalDeLinea(enemies, heroInfo = new Map(), linea = 'roam', frecuencias = {}, margen = MARGEN_PARA_HABLAR) {
  if (!enemies?.length || !linea) return null;

  const P = enemies.map((h) => {
    const info = heroInfo.get(normName(h.name));
    return Object.fromEntries(LINEAS.map((l) => [l, probabilidadDeLinea(h, info, l, frecuencias)]));
  });
  const n = Math.min(enemies.length, LINEAS.length);

  // Todos los repartos posibles: qué líneas entran (si hay menos de cinco
  // enemigos) y quién va a cuál. Como mucho 5! = 120 por combinación.
  let mejor = null;
  let mejorConOtro = null;
  for (const lineas of combinaciones(LINEAS, n)) {
    for (const perm of permutaciones(lineas)) {
      const total = perm.reduce((s, l, i) => s + P[i][l], 0);
      const quien = perm.indexOf(linea);
      if (!mejor || total > mejor.total) mejor = { total, quien };
    }
  }
  if (!mejor || mejor.quien < 0) return null;

  for (const lineas of combinaciones(LINEAS, n)) {
    for (const perm of permutaciones(lineas)) {
      const quien = perm.indexOf(linea);
      if (quien === mejor.quien) continue;
      const total = perm.reduce((s, l, i) => s + P[i][l], 0);
      if (!mejorConOtro || total > mejorConOtro.total) mejorConOtro = { total, quien };
    }
  }

  if (mejorConOtro && mejor.total - mejorConOtro.total < margen) return null; // demasiado parejo
  if (P[mejor.quien][linea] <= 0.3) return null;                             // no encaja ahí
  return enemies[mejor.quien].name;
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
