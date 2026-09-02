// Reglas estructurales del draft.
//
// OJO con 'why': ya NO es una frase ni una función que la construya, es una
// CLAVE del diccionario (src/i18n.js). El motor no sabe en qué idioma se va a
// leer; traducir es cosa de la interfaz. Si añades una regla, añade también su
// clave a los DOS idiomas o la prueba de traducción te lo dirá.
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
    why: 'regla.antiDash',
  },
  {
    enemyTag: 'dive',
    roamTag: 'peel',
    weight: 0.9,
    why: 'regla.peel',
  },
  {
    enemyTag: 'dive',
    roamTag: 'anti_dive',
    weight: 0.55,
    why: 'regla.antiDive',
  },
  {
    enemyTag: 'heal',
    roamTag: 'antiheal',
    weight: 1.0,
    why: 'regla.antiheal',
  },
  {
    // Casi toda composición tiene un carry lento, así que esto se cumple siempre:
    // si pesa mucho, cualquier héroe con "engage" gana contra cualquier enemigo.
    enemyTag: 'immobile',
    roamTag: 'engage',
    weight: 0.35,
    why: 'regla.engageInmovil',
  },
  {
    enemyTag: 'hypercarry',
    roamTag: 'engage',
    weight: 0.3,
    why: 'regla.engageHypercarry',
  },
  {
    enemyTag: 'poke',
    roamTag: 'shield',
    weight: 0.6,
    why: 'regla.escudoPoke',
  },
  {
    enemyTag: 'poke',
    roamTag: 'immobile',
    weight: -0.7, // penalizacion: un roamer lento sufre contra poke
    why: 'regla.sufrePoke',
  },
  {
    enemyTag: 'burst',
    roamTag: 'sustain',
    weight: 0.5,
    why: 'regla.sustainBurst',
  },
  {
    enemyTag: 'assassin_late',
    roamTag: 'vision',
    weight: 0.7,
    why: 'regla.visionAssassin',
  },
  {
    // Movilidad general (rotar, esquivar zonas), sin dashes de por medio.
    enemyTag: 'mobile',
    roamTag: 'anti_mobility',
    weight: 0.4,
    why: 'regla.estorbaRotaciones',
  },
  {
    enemyTag: 'zone',
    roamTag: 'mobile',
    weight: 0.4,
    why: 'regla.esquivaZonas',
  },
];

/**
 * Necesidades de composicion. Si tu equipo no cubre un tag, el roamer que lo
 * aporte sube. Si ya lo cubre de sobra, aporta menos (rendimiento decreciente).
 */
export const TEAM_NEEDS = [
  { tag: 'engage', weight: 1.0, why: 'necesidad.engage' },
  { tag: 'cc_hard', weight: 0.9, why: 'necesidad.cc_hard' },
  { tag: 'peel', weight: 0.8, why: 'necesidad.peel' },
  { tag: 'tanky', weight: 0.9, why: 'necesidad.tanky' },
  { tag: 'sustain', weight: 0.4, why: 'necesidad.sustain' },
  { tag: 'vision', weight: 0.3, why: 'necesidad.vision' },
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
 * Etiquetas de Moonton ("speciality") traducidas a nuestros tags.
 *
 * NO están escritas a ojo: las deriva `scripts/derivar-tags.mjs` mirando qué
 * tags tienen en el catálogo los héroes que llevan cada etiqueta. Sirven para
 * los héroes que la API conoce y el catálogo todavía no: antes dependían solo
 * de los tags genéricos de su rol.
 *
 * Medido dejando cada héroe fuera del aprendizaje, sobre los 133 del catálogo:
 *   solo rol                precisión 67.4%  cobertura 39.4%  F1 49.1%
 *   rol + speciality        precisión 66.9%  cobertura 54.6%  F1 58.6%
 *   rol + speciality + veto precisión 67.6%  cobertura 54.4%  F1 59.0%
 *
 * Hoy no se aplica a nadie: los 133 héroes tienen tags escritos a mano. Está
 * para el que salga mañana, que entrará mejor equipado que con solo su rol.
 * Reejecuta el script cuando crezca el catálogo o Moonton cambie sus etiquetas.
 */
export const SPECIALITY_TAGS = {
  'Guard': ['immobile', 'peel'],
  'Crowd Control': ['tanky', 'zone', 'cc_hard'],
  'Initiator': ['engage', 'tanky', 'cc_hard'],
  'Regen': ['heal'],
  'Chase': ['mobile', 'dash', 'dive'],
  'Poke': ['poke'],
  'Charge': ['cc_hard', 'dive'],
};

/**
 * Tags que NUNCA le corresponden a un rol, según el propio catálogo.
 *
 * Hacen falta porque la tabla de arriba recoge correlaciones, no propiedades:
 * casi todos los héroes de "Crowd Control" son tanques, así que sin este filtro
 * una maga con CC salía etiquetada como `tanky` y la composición se creía la
 * primera línea cubierta. Ningún mago, tirador ni asesino del catálogo lleva
 * `tanky`, así que el veto lo dicta el dato, no mi criterio.
 *
 * Solo filtra lo que añade la speciality: los tags por defecto del rol pasan
 * siempre, porque son la base sobre la que se mide todo lo demás.
 */
export const ROLE_VETO = {
  'tank': ['assassin_late', 'dash'],
  'fighter': ['anti_dive', 'assassin_late', 'sustain', 'vision'],
  'assassin': ['anti_dive', 'anti_mobility', 'antiheal', 'cc_chain', 'engage', 'immobile', 'peel', 'sustain', 'tanky', 'zone'],
  'mage': ['anti_dive', 'anti_mobility', 'antiheal', 'assassin_late', 'engage', 'shield', 'sustain', 'tanky'],
  'marksman': ['anti_mobility', 'antiheal', 'cc_chain', 'engage', 'heal', 'peel', 'shield', 'sustain', 'tanky', 'vision'],
};

/**
 * Qué hace peligroso a un heroe enemigo contra TU equipo ya elegido.
 * Es una tabla propia porque la de counters describe lo contrario: lo que un
 * roamer le hace a un enemigo. Reutilizarla al revés daba avisos sin sentido.
 */
/**
 * `soloSiFragil`: la regla solo vale si el aliado es de los que hay que
 * proteger. Un tanque tambien lleva el tag `immobile`, asi que sin esto la app
 * proponia banear a un asesino "porque salta encima de tu Tigreal", que es al
 * reves de como se juega: el tanque QUIERE que le salten encima. Es el mismo
 * fallo que ya se corrigio en el peel de synergyScore y que aqui sobrevivio.
 * Medido: el 12,1% de los disparos de esta tabla protegian a un tanque.
 */
export const DANGER_RULES = [
  { allyTag: 'immobile', enemyTag: 'dive', weight: 1.0, why: 'peligro.saltaEncima', soloSiFragil: true },
  { allyTag: 'immobile', enemyTag: 'burst', weight: 0.9, why: 'peligro.revienta', soloSiFragil: true },
  { allyTag: 'hypercarry', enemyTag: 'assassin_late', weight: 0.9, why: 'peligro.cazaLate' },
  { allyTag: 'heal', enemyTag: 'antiheal', weight: 0.8, why: 'peligro.anulaCuracion' },
  { allyTag: 'sustain', enemyTag: 'antiheal', weight: 0.8, why: 'peligro.anulaCuracion' },
  { allyTag: 'mobile', enemyTag: 'anti_mobility', weight: 0.7, why: 'peligro.bloqueaDashes' },
  { allyTag: 'poke', enemyTag: 'dive', weight: 0.6, why: 'peligro.noDejaPokear' },
  { allyTag: 'engage', enemyTag: 'zone', weight: 0.5, why: 'peligro.cortaInicios' },
];


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
  // Los tres primeros salen de datos reales; comp es lo único escrito a mano,
  // y por eso pesa poco: es la parte que envejece cuando cambia el juego.
  meta: 0.22,      // winrate global ajustado por muestra   [dato]
  counter: 0.40,   // matchup contra los picks enemigos      [dato]
  synergy: 0.15,   // sinergia con tus aliados               [dato]
  comp: 0.08,      // huecos de composición que rellena      [mis reglas]
  mastery: 0.15,   // tu propio historial con el héroe       [tus partidas]
};
