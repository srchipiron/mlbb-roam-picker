/**
 * Dos idiomas: español e inglés.
 *
 * La app nació en español porque su primer usuario lo es. Se abre al público
 * con inglés porque la base de MLBB está en el sudeste asiático, y sin inglés
 * la mitad del mundo no puede usarla.
 *
 * Los textos que salen de las REGLAS (los motivos de cada tarjeta) viajan como
 * clave más parámetros, no como frase hecha: así el motor no sabe de idiomas y
 * la traducción no se cuela dentro de la lógica.
 */

export const IDIOMAS = ['es', 'en'];

const ES = {
  // --- cabecera y navegación ---
  'app.pick': 'Tu pick de {linea}',
  'app.enemigos': 'Enemigos',
  'app.tuEquipo': 'Tu equipo',
  'app.baneados': 'Baneados',
  'app.ajustes': 'Baneos y ajustes',
  'app.rango': 'Rango',
  'app.tuLinea': 'Tu línea',
  'app.cambiar': 'cambiar',
  'app.nuevoDraft': 'Nuevo draft',
  'app.maestria': 'Tu maestría',
  'app.apuntar': 'Apuntar partida',
  'app.diagnostico': 'Diagnóstico',
  'app.cargando': 'Cargando…',
  'app.anadir': 'Añadir',
  'app.buscar': 'Buscar héroe',
  'app.cerrar': 'Cerrar',
  'app.cancelar': 'Cancelar',
  'app.guardar': 'Guardar',
  'app.sinNombre': 'Ningún héroe con ese nombre.',
  'app.sinDatos': 'sin datos',
  'app.pickSolido': 'pick sólido de base',
  'app.tagsDeRol': 'tags de su rol',
  'app.tagsDeRolTitulo': 'No está en el catálogo: usa los tags genéricos de su rol',
  'app.marcarRival': 'Marca tu rival',
  'app.tuRival': 'tu rival: {nombre}',
  'app.empate': '{nombres} están prácticamente igual. Coge el que mejor lleves.',
  'app.sinWinrates': 'Sin winrates: el ranking sale solo de composición y counters por rol.',
  'app.sinPool': 'Todavía no hay datos de qué héroes se juegan en {linea}. Se descargan con el meta: vuelve a abrir la app en un rato.',
  'app.errorDatos': 'No se han podido cargar los datos ({error}).',

  // --- líneas ---
  'linea.roam': 'Roam',
  'linea.jungle': 'Jungla',
  'linea.mid': 'Mid',
  'linea.gold': 'Gold',
  'linea.exp': 'Exp',
  'linea.roam.pista': 'Tanque o support que rota y protege',
  'linea.jungle.pista': 'Farmeas la jungla y haces ganks',
  'linea.mid.pista': 'Línea central, normalmente mago',
  'linea.gold.pista': 'Línea de oro, normalmente tirador',
  'linea.exp.pista': 'Línea de experiencia, normalmente luchador',
  'linea.pregunta': '¿Qué línea juegas?',
  'linea.cambiarDespues': 'Se puede cambiar cuando quieras desde «Baneos y ajustes».',

  // --- componentes del score ---
  'parte.meta': 'Meta',
  'parte.counter': 'Counter',
  'parte.synergy': 'Sinergia',
  'parte.comp': 'Composición',
  'parte.mastery': 'Tu maestría',

  // --- motivos que salen de las reglas ---
  'regla.antiDash': 'bloquea los dashes de {e}',
  'regla.peel': 'saca a {e} de encima de tu carry',
  'regla.antiDive': 'castiga el salto de {e}',
  'regla.antiheal': 'corta la curación de {e}',
  'regla.engageInmovil': '{e} no tiene escape contra un inicio',
  'regla.engageHypercarry': 'obliga a pelear antes de que {e} escale',
  'regla.escudoPoke': 'absorbe el poke de {e}',
  'regla.sufrePoke': 'sufre el poke constante de {e}',
  'regla.sustainBurst': 'recupera el daño de {e} entre peleas',
  'regla.visionAssassin': 'quita la sorpresa a {e}',
  'regla.estorbaRotaciones': 'estorba las rotaciones de {e}',
  'regla.esquivaZonas': 'esquiva las zonas de {e}',
  'regla.ganaMatchup': 'gana el matchup contra {e}',
  'regla.pierdeMatchup': 'pierde contra {e}',
  'regla.combinaCon': 'combina bien con {a}',
  'regla.protege': 'protege a {a}, que no tiene escape',
  'regla.abrePelea': 'abre la pelea para {a}',
  'regla.mantieneVivo': 'mantiene vivo a {a}',
  'regla.maestriaBuena': 'lo llevas al {pct}% en {n} partidas',
  'regla.maestriaMala': 'solo {pct}% en {n} partidas',
  'regla.arriesgadoCiego': 'arriesgado como pick ciego',

  // --- necesidades del equipo ---
  'necesidad.engage': 'tu equipo no tiene quién inicie',
  'necesidad.cc_hard': 'te falta control duro',
  'necesidad.peel': 'tu carry va a quedarse solo',
  'necesidad.tanky': 'no hay primera línea',
  'necesidad.sustain': 'sin curación en el equipo',
  'necesidad.vision': 'nadie aporta visión',

  // --- peligros para los baneos ---
  'peligro.saltaEncima': 'salta encima de {a}',
  'peligro.revienta': 'revienta a {a}',
  'peligro.cazaLate': 'caza a {a} en late',
  'peligro.anulaCuracion': 'anula la curación de {a}',
  'peligro.bloqueaDashes': 'bloquea los dashes de {a}',
  'peligro.noDejaPokear': 'no deja a {a} pokear',
  'peligro.cortaInicios': 'corta los inicios de {a}',
  'ban.mereceLaPena': 'Merece la pena banear',
  'ban.banear': 'Banear',
  'ban.tasa': '{pct}% ban',

  // --- análisis del draft ---
  'analisis.ganasCruce': 'Ganas el cruce: {yo} va al {pct}% contra {rival}.',
  'analisis.pierdesCruce': 'Pierdes el cruce: {pct}% contra {rival}. Juega a no morir pronto.',
  'analisis.tuWinrateMejor': 'Tu héroe está {dif} puntos por encima de {rival} este parche.',
  'analisis.suWinrateMejor': '{rival} está {dif} puntos por encima este parche. No le regales el carril.',
  'analisis.cuidadoCon': 'Cuidado con {e}: es tu peor cruce del draft ({pct}%).',
  'analisis.pickCiego': 'Les faltan {n} picks y {yo} es de los castigables. Si puedes, espera.',
  'analisis.pickClaro': '{yo} le saca {puntos} puntos al siguiente. Pick claro.',
  'analisis.empatadoCon': 'Empatado con {otros}. Coge el que mejor lleves.',

  // --- maestría y partidas ---
  'maestria.explicacion': 'Copia partidas y winrate de tu perfil del juego. El winrate en porcentaje: 50,6 o 50.6. Por debajo de 20 partidas cuenta poco.',
  'maestria.heroe': 'Héroe',
  'maestria.partidas': 'Partidas',
  'maestria.winrate': 'Winrate %',
  'registro.conQuien': '¿Con quién jugaste?',
  'registro.gane': 'Gané',
  'registro.perdi': 'Perdí',
  'registro.recomendado': 'recomendado',

  // --- público: avisos y donaciones ---
  'legal.noAfiliado': 'Proyecto de aficionado, sin relación con Moonton. Mobile Legends: Bang Bang y sus héroes son marcas de sus propietarios.',
  'legal.privacidad': 'Tus datos no salen de tu móvil: no hay cuentas, ni servidor, ni seguimiento.',
  'donar.texto': 'Invítame a un café',
  'idioma.nombre': 'Idioma',
};

const EN = {
  'app.pick': 'Your {linea} pick',
  'app.enemigos': 'Enemies',
  'app.tuEquipo': 'Your team',
  'app.baneados': 'Banned',
  'app.ajustes': 'Bans and settings',
  'app.rango': 'Rank',
  'app.tuLinea': 'Your lane',
  'app.cambiar': 'change',
  'app.nuevoDraft': 'New draft',
  'app.maestria': 'Your mastery',
  'app.apuntar': 'Log match',
  'app.diagnostico': 'Diagnostics',
  'app.cargando': 'Loading…',
  'app.anadir': 'Add',
  'app.buscar': 'Search hero',
  'app.cerrar': 'Close',
  'app.cancelar': 'Cancel',
  'app.guardar': 'Save',
  'app.sinNombre': 'No hero with that name.',
  'app.sinDatos': 'no data',
  'app.pickSolido': 'solid all-round pick',
  'app.tagsDeRol': 'role tags',
  'app.tagsDeRolTitulo': 'Not in the catalogue: using generic tags for its role',
  'app.marcarRival': 'Mark your rival',
  'app.tuRival': 'your rival: {nombre}',
  'app.empate': '{nombres} are practically tied. Take the one you play best.',
  'app.sinWinrates': 'No win rates: ranking comes only from composition and role counters.',
  'app.sinPool': 'No data yet on which heroes are played in {linea}. It arrives with the meta: reopen the app in a while.',
  'app.errorDatos': 'Could not load the data ({error}).',

  'linea.roam': 'Roam',
  'linea.jungle': 'Jungle',
  'linea.mid': 'Mid',
  'linea.gold': 'Gold',
  'linea.exp': 'Exp',
  'linea.roam.pista': 'Tank or support who rotates and protects',
  'linea.jungle.pista': 'You farm the jungle and gank',
  'linea.mid.pista': 'Mid lane, usually a mage',
  'linea.gold.pista': 'Gold lane, usually a marksman',
  'linea.exp.pista': 'Exp lane, usually a fighter',
  'linea.pregunta': 'Which lane do you play?',
  'linea.cambiarDespues': 'You can change it any time from “Bans and settings”.',

  'parte.meta': 'Meta',
  'parte.counter': 'Counter',
  'parte.synergy': 'Synergy',
  'parte.comp': 'Composition',
  'parte.mastery': 'Your mastery',

  'regla.antiDash': 'blocks {e}’s dashes',
  'regla.peel': 'pulls {e} off your carry',
  'regla.antiDive': 'punishes {e}’s dive',
  'regla.antiheal': 'cuts {e}’s healing',
  'regla.engageInmovil': '{e} has no escape from an engage',
  'regla.engageHypercarry': 'forces the fight before {e} scales',
  'regla.escudoPoke': 'absorbs {e}’s poke',
  'regla.sufrePoke': 'suffers {e}’s constant poke',
  'regla.sustainBurst': 'heals off {e}’s damage between fights',
  'regla.visionAssassin': 'takes away {e}’s surprise',
  'regla.estorbaRotaciones': 'disrupts {e}’s rotations',
  'regla.esquivaZonas': 'dodges {e}’s zones',
  'regla.ganaMatchup': 'wins the matchup against {e}',
  'regla.pierdeMatchup': 'loses to {e}',
  'regla.combinaCon': 'pairs well with {a}',
  'regla.protege': 'protects {a}, who has no escape',
  'regla.abrePelea': 'opens the fight for {a}',
  'regla.mantieneVivo': 'keeps {a} alive',
  'regla.maestriaBuena': 'you win {pct}% on it over {n} matches',
  'regla.maestriaMala': 'only {pct}% over {n} matches',
  'regla.arriesgadoCiego': 'risky as a blind pick',

  'necesidad.engage': 'your team has no one to start fights',
  'necesidad.cc_hard': 'you lack hard crowd control',
  'necesidad.peel': 'your carry will be left alone',
  'necesidad.tanky': 'there is no front line',
  'necesidad.sustain': 'no healing on the team',
  'necesidad.vision': 'nobody provides vision',

  'peligro.saltaEncima': 'dives onto {a}',
  'peligro.revienta': 'bursts {a} down',
  'peligro.cazaLate': 'hunts {a} in the late game',
  'peligro.anulaCuracion': 'shuts down {a}’s healing',
  'peligro.bloqueaDashes': 'blocks {a}’s dashes',
  'peligro.noDejaPokear': 'stops {a} from poking',
  'peligro.cortaInicios': 'cuts {a}’s engages',
  'ban.mereceLaPena': 'Worth banning',
  'ban.banear': 'Ban',
  'ban.tasa': '{pct}% ban',

  'analisis.ganasCruce': 'You win the matchup: {yo} is at {pct}% against {rival}.',
  'analisis.pierdesCruce': 'You lose the matchup: {pct}% against {rival}. Play safe early.',
  'analisis.tuWinrateMejor': 'Your hero is {dif} points above {rival} this patch.',
  'analisis.suWinrateMejor': '{rival} is {dif} points above you this patch. Do not hand over the lane.',
  'analisis.cuidadoCon': 'Watch out for {e}: your worst matchup in this draft ({pct}%).',
  'analisis.pickCiego': 'They still have {n} picks and {yo} is punishable. Wait if you can.',
  'analisis.pickClaro': '{yo} is {puntos} points clear of the next one. Easy pick.',
  'analisis.empatadoCon': 'Tied with {otros}. Take the one you play best.',

  'maestria.explicacion': 'Copy matches and win rate from your in-game profile. Win rate as a percentage: 50.6. Below 20 matches it barely counts.',
  'maestria.heroe': 'Hero',
  'maestria.partidas': 'Matches',
  'maestria.winrate': 'Win rate %',
  'registro.conQuien': 'Who did you play?',
  'registro.gane': 'Won',
  'registro.perdi': 'Lost',
  'registro.recomendado': 'recommended',

  'legal.noAfiliado': 'A fan project, not affiliated with Moonton. Mobile Legends: Bang Bang and its heroes are trademarks of their respective owners.',
  'legal.privacidad': 'Your data never leaves your phone: no accounts, no server, no tracking.',
  'donar.texto': 'Buy me a coffee',
  'idioma.nombre': 'Language',
};

const TEXTOS = { es: ES, en: EN };

/** El idioma del móvil, si lo hablamos. Si no, inglés. */
export function idiomaPorDefecto() {
  const pref = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const l of pref) {
    const corto = String(l ?? '').slice(0, 2).toLowerCase();
    if (IDIOMAS.includes(corto)) return corto;
  }
  return 'en';
}

/**
 * Traductor. Si falta una clave devuelve la clave misma: así un texto sin
 * traducir se ve a la legua en vez de quedarse en blanco.
 */
export function crearT(idioma) {
  const dic = TEXTOS[idioma] ?? EN;
  return (clave, params) => {
    const plantilla = dic[clave] ?? TEXTOS.es[clave] ?? clave;
    if (!params) return plantilla;
    return plantilla.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
  };
}

/** Para las pruebas: comprobar que ningún idioma se ha quedado a medias. */
export const CLAVES = Object.keys(ES);
export const DICCIONARIOS = TEXTOS;
