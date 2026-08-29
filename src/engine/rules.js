// Reglas estructurales del draft de roam.
// Estas reglas NO dependen de la API: siguen funcionando con un heroe recien
// salido del que todavia no hay estadisticas fiables.

/**
 * Reglas de counter: "si el enemigo tiene el tag X, un roamer con el tag Y gana valor".
 * weight va de 0 a 1 y se multiplica por el peso global de counter.
 * El texto de `why` es el que ve el usuario, asi que va en su idioma y en plano.
 */
export const COUNTER_RULES = [
  {
    enemyTag: 'mobile',
    roamTag: 'anti_mobility',
    weight: 1.0,
    why: (e) => `bloquea los dashes de ${e}`,
  },
  {
    enemyTag: 'dive',
    roamTag: 'peel',
    weight: 0.9,
    why: (e) => `saca a ${e} de encima de tu carry`,
  },
  {
    enemyTag: 'dive',
    roamTag: 'anti_dive',
    weight: 0.8,
    why: (e) => `castiga el salto de ${e}`,
  },
  {
    enemyTag: 'heal',
    roamTag: 'antiheal',
    weight: 1.0,
    why: (e) => `corta la curación de ${e}`,
  },
  {
    enemyTag: 'immobile',
    roamTag: 'engage',
    weight: 0.7,
    why: (e) => `${e} no tiene escape contra un inicio`,
  },
  {
    enemyTag: 'hypercarry',
    roamTag: 'engage',
    weight: 0.6,
    why: (e) => `obliga a pelear antes de que ${e} escale`,
  },
  {
    enemyTag: 'poke',
    roamTag: 'shield',
    weight: 0.6,
    why: (e) => `absorbe el poke de ${e}`,
  },
  {
    enemyTag: 'poke',
    roamTag: 'immobile',
    weight: -0.7, // penalizacion: un roamer lento sufre contra poke
    why: (e) => `sufre el poke constante de ${e}`,
  },
  {
    enemyTag: 'burst',
    roamTag: 'sustain',
    weight: 0.5,
    why: (e) => `recupera el daño de ${e} entre peleas`,
  },
  {
    enemyTag: 'assassin_late',
    roamTag: 'vision',
    weight: 0.7,
    why: (e) => `quita la sorpresa a ${e}`,
  },
  {
    enemyTag: 'zone',
    roamTag: 'mobile',
    weight: 0.4,
    why: (e) => `esquiva las zonas de ${e}`,
  },
];

/**
 * Necesidades de composicion. Si tu equipo no cubre un tag, el roamer que lo
 * aporte sube. Si ya lo cubre de sobra, aporta menos (rendimiento decreciente).
 */
export const TEAM_NEEDS = [
  { tag: 'engage', weight: 1.0, why: 'tu equipo no tiene quién inicie' },
  { tag: 'cc_hard', weight: 0.9, why: 'te falta control duro' },
  { tag: 'peel', weight: 0.8, why: 'tu carry va a quedarse solo' },
  { tag: 'tanky', weight: 0.9, why: 'no hay primera línea' },
  { tag: 'sustain', weight: 0.4, why: 'sin curación en el equipo' },
  { tag: 'vision', weight: 0.3, why: 'nadie aporta visión' },
];

/** Umbral de partidas a partir del cual la maestría personal se considera fiable. */
export const MASTERY_CONFIDENCE_GAMES = 20;

/**
 * Pesos por defecto de cada componente del score final.
 * Suman 1. Ajustables desde la app (pantalla de Ajustes).
 */
export const DEFAULT_WEIGHTS = {
  meta: 0.30,      // winrate global ajustado por muestra
  counter: 0.22,   // matchup contra los picks enemigos
  synergy: 0.13,   // sinergia con tus aliados
  comp: 0.20,      // huecos de composición que rellena
  mastery: 0.15,   // tu propio historial con el héroe
};
