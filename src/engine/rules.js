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
    // La relación más decisiva del juego: contra Fanny o Ling, quien le corta el
    // dash gana la partida. Va contra 'dash', no contra 'mobile': esa etiqueta
    // servía a la vez para asesinos de blink y para héroes que solo rotan bien,
    // y hacía que un anti-dash saliera recomendado contra Esmeralda o Uranus.
    enemyTag: 'dash',
    roamTag: 'anti_mobility',
    weight: 0.95,
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
    weight: 0.55,
    why: (e) => `castiga el salto de ${e}`,
  },
  {
    enemyTag: 'heal',
    roamTag: 'antiheal',
    weight: 1.0,
    why: (e) => `corta la curación de ${e}`,
  },
  {
    // Casi toda composición tiene un carry lento, así que esto se cumple siempre:
    // si pesa mucho, cualquier héroe con "engage" gana contra cualquier enemigo.
    enemyTag: 'immobile',
    roamTag: 'engage',
    weight: 0.35,
    why: (e) => `${e} no tiene escape contra un inicio`,
  },
  {
    enemyTag: 'hypercarry',
    roamTag: 'engage',
    weight: 0.3,
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
    // Movilidad general (rotar, esquivar zonas), sin dashes de por medio.
    enemyTag: 'mobile',
    roamTag: 'anti_mobility',
    weight: 0.4,
    why: (e) => `estorba las rotaciones de ${e}`,
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

/**
 * Tags por defecto segun el rol, para heroes que la API conoce y el catalogo
 * todavia no. Es una aproximacion grosera, pero permite que un heroe recien
 * salido se pueda marcar como pick enemigo y cuente en los counters desde el
 * primer dia, en vez de ser invisible hasta que alguien le escriba los tags.
 */
export const ROLE_DEFAULTS = {
  tank: ['tanky', 'engage', 'cc_hard'],
  support: ['peel', 'sustain'],
  fighter: ['dive', 'burst'],
  assassin: ['mobile', 'dive', 'burst'],
  mage: ['poke', 'burst'],
  marksman: ['hypercarry', 'immobile'],
};

/**
 * Qué hace peligroso a un heroe enemigo contra TU equipo ya elegido.
 * Es una tabla propia porque la de counters describe lo contrario: lo que un
 * roamer le hace a un enemigo. Reutilizarla al revés daba avisos sin sentido.
 */
export const DANGER_RULES = [
  { allyTag: 'immobile', enemyTag: 'dive', weight: 1.0, why: (a) => `salta encima de ${a}` },
  { allyTag: 'immobile', enemyTag: 'burst', weight: 0.9, why: (a) => `revienta a ${a}` },
  { allyTag: 'hypercarry', enemyTag: 'assassin_late', weight: 0.9, why: (a) => `caza a ${a} en late` },
  { allyTag: 'heal', enemyTag: 'antiheal', weight: 0.8, why: (a) => `anula la curación de ${a}` },
  { allyTag: 'sustain', enemyTag: 'antiheal', weight: 0.8, why: (a) => `anula la curación de ${a}` },
  { allyTag: 'mobile', enemyTag: 'anti_mobility', weight: 0.7, why: (a) => `bloquea los dashes de ${a}` },
  { allyTag: 'poke', enemyTag: 'dive', weight: 0.6, why: (a) => `no deja a ${a} pokear` },
  { allyTag: 'engage', enemyTag: 'zone', weight: 0.5, why: (a) => `corta los inicios de ${a}` },
];

/** Umbral de partidas a partir del cual la maestría personal se considera fiable. */
export const MASTERY_CONFIDENCE_GAMES = 20;

/**
 * Pesos por defecto de cada componente del score final.
 * Suman 1. Ajustables desde la app (pantalla de Ajustes).
 */
/**
 * Pesos por defecto. Salen de un barrido sobre 200 drafts aleatorios, midiendo
 * tres cosas: que contra asesinos móviles gane un anti-dash, que contra héroes
 * de curación gane un antiheal, y que ningún roamer acapare las recomendaciones.
 * No son intuición: cambiarlos a ojo suele empeorar alguna de las tres.
 */
export const DEFAULT_WEIGHTS = {
  meta: 0.22,      // winrate global ajustado por muestra
  counter: 0.36,   // matchup contra los picks enemigos
  synergy: 0.10,   // sinergia con tus aliados
  comp: 0.15,      // huecos de composición que rellena
  mastery: 0.17,   // tu propio historial con el héroe
};
