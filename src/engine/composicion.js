import { perfilDeDano, tipoDeDano, SATISFIES } from './score.js';
import { TEAM_NEEDS } from './rules.js';

/**
 * Qué tiene y qué le falta a un equipo, a la vista de los cinco.
 *
 * Es lo que se mira antes que nada en un draft de verdad: si vais todos
 * físicos, si hay alguien delante, si alguien puede iniciar. La app ya lo
 * usaba por dentro (`compScore`, el 8% de la nota) para premiar al héroe que
 * tapa el hueco; aquí se ENSEÑA el hueco, que es lo que se pedía.
 *
 * Dos clases de cosa, y conviene no mezclarlas:
 *
 *  - Lo medido en las parejas (8.778 pares, sinergia neta centrada en la media
 *    de la matriz): dos héroes del MISMO daño rinden 0,54 puntos peor que dos
 *    de daño distinto (−0,72pp frente a −0,18pp, ±0,04), y dos del mismo ROL
 *    peor todavía: dos magos −4,0pp, dos asesinos −2,6pp, dos tanques −1,95pp,
 *    dos tiradores −1,26pp. Eso es DATO, y va con su cifra.
 *  - Los huecos por etiqueta (nadie con `tanky`, nadie con `cc_hard`...) salen
 *    de `TEAM_NEEDS`, que es regla escrita a mano. Se enseñan como lo que son.
 */

/** Roles cuyo duplicado está medido (sinergia neta media del par, en puntos). */
export const ROL_DOBLE_PP = { mage: -4.0, assassin: -2.6, tank: -1.95, marksman: -1.26 };

/** Huecos que merece la pena decir en voz alta: los tres que más pesan. */
export const HUECOS_QUE_SE_DICEN = ['tanky', 'cc_hard', 'engage'];

const cubre = (hero, need) => (SATISFIES[need] ?? [need]).some((t) => (hero.tags ?? []).includes(t));

export function composicionDe(equipo = []) {
  const dano = perfilDeDano(equipo);
  const roles = {};
  for (const h of equipo) if (h.role) roles[h.role] = (roles[h.role] ?? 0) + 1;
  const cubiertos = Object.fromEntries(TEAM_NEEDS.map((n) => [n.tag, equipo.some((h) => cubre(h, n.tag))]));
  const huecos = TEAM_NEEDS.filter((n) => !cubiertos[n.tag]).map((n) => n.tag);
  const dobles = Object.entries(roles)
    .filter(([rol, n]) => n >= 2 && ROL_DOBLE_PP[rol] != null)
    .map(([rol, n]) => ({ rol, n, pp: ROL_DOBLE_PP[rol] }));
  return { n: equipo.length, dano, roles, cubiertos, huecos, dobles };
}

/**
 * Tu equipo con tu candidato dentro, y el suyo. `tapa` son los huecos de tus
 * cuatro que tu candidato cierra: lo que se dice en pantalla es "os falta X"
 * cuando sigue faltando con él, y "él tapa X" cuando lo cierra.
 */
export function analizarComposicion({ allies = [], yo = null, enemies = [] } = {}) {
  const sinMi = composicionDe(allies);
  const mios = yo ? [...allies.filter((h) => h.name !== yo.name), yo] : allies;
  const mio = composicionDe(mios);
  const suyo = composicionDe(enemies);
  const tapa = yo ? sinMi.huecos.filter((tag) => cubre(yo, tag)) : [];
  const tapaDano = !!(yo && sinMi.dano.falta && ['mixto', sinMi.dano.falta].includes(tipoDeDano(yo)));
  return { mio, suyo, sinMi, tapa, tapaDano };
}
