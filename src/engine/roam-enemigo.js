import { normName } from './score.js';

/**
 * Quién es el roamer del equipo enemigo.
 *
 * En el draft solo ves cinco nombres, sin líneas asignadas. Saber cuál es su
 * roam importa porque es con quien más vas a chocar, y su matchup pesa el doble.
 *
 * La decisión sale de en qué líneas se juega realmente cada héroe (dato de la
 * API), no de mi criterio. Si la API no lo trae, se cae al rol y a las etiquetas
 * del catálogo, que es peor pero sigue funcionando.
 */

/** Roles que casi nunca hacen roam, por mucho que el héroe pueda. */
const ROLES_DE_LINEA = new Set(['marksman', 'mage']);

/**
 * Probabilidad aproximada de que un héroe sea el roamer del equipo.
 * No pretende ser exacta: solo tiene que ORDENAR bien a cinco candidatos.
 */
export function probabilidadRoam(hero, info) {
  const lineas = info?.lanes ?? [];
  const rol = (info?.role ?? hero?.role ?? '').toLowerCase();

  let p = 0;

  // 1. Lo mejor: la API dice que se juega de roam.
  if (lineas.includes('roam')) {
    // Cuantas menos líneas alternativas tenga, más seguro es que sea el roam.
    p += 0.6 + 0.25 / Math.max(1, lineas.length);
  }

  // 2. Nuestro catálogo lo tiene en el pool de roam.
  if (hero?.roam) p += 0.25;

  // 3. El rol ayuda: tanques y supports hacen roam; tiradores y magos casi nunca.
  if (rol === 'tank' || rol === 'support') p += 0.2;
  if (ROLES_DE_LINEA.has(rol)) p -= 0.35;

  // 4. Las etiquetas de aguante y protección son propias del puesto.
  const tags = hero?.tags ?? [];
  if (tags.includes('peel')) p += 0.1;
  if (tags.includes('vision')) p += 0.1;
  if (tags.includes('hypercarry')) p -= 0.3;

  return p;
}

/**
 * Elige al roamer entre los enemigos ya elegidos.
 *
 * Devuelve null cuando no hay un favorito claro: equivocarse es peor que no
 * decir nada, porque duplica el peso del matchup equivocado. El margen exigido
 * evita cantar un roam cuando enfrente hay dos tanques y podría ser cualquiera.
 */
export function detectarRoamEnemigo(enemies, heroInfo = new Map(), margen = 0.15) {
  if (!enemies?.length) return null;

  const puntuados = enemies
    .map((h) => ({ hero: h, p: probabilidadRoam(h, heroInfo.get(normName(h.name))) }))
    .sort((a, b) => b.p - a.p);

  const [primero, segundo] = puntuados;
  if (primero.p <= 0.3) return null;                       // ninguno encaja
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
