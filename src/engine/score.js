import {
  ROLE_DEFAULTS,
  SPECIALITY_TAGS,
  ROLE_VETO,
  COUNTER_RULES,
  DANGER_RULES,
  TEAM_NEEDS,
  MASTERY_CONFIDENCE_GAMES,
  DEFAULT_WEIGHTS,
} from './rules.js';

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Precisión medida de los tags deducidos (rol + speciality) frente a los
 * escritos a mano. Sale de scripts/derivar-tags.mjs, no de una intuición.
 */
const PRECISION_DEDUCIDA = 0.67;

/** Ventaja máxima que un roamer puede acumular contra un enemigo: 1.4 + 0.9/2. */
const SUB_MAX = 1.85;

/**
 * Lo que vale tapar el lado de daño que le falta al equipo, en la misma escala
 * que TEAM_NEEDS (engage 1.0, cc_hard 0.9, peel 0.8).
 *
 * Por debajo de engage y del control duro a propósito: que os falte magia
 * duele en late, pero no entrar a una pelea duele ya. Medido en drafts
 * simulados antes de subirlo.
 */
const PESO_DANO = 0.7;

/**
 * Clave normalizada de un nombre de héroe. La API y el catálogo escriben lo
 * mismo de formas distintas ("X.Borg" / "X Borg", "Yi Sun-shin" / "Yi Sun Shin",
 * "Chang'e" / "Change"), y un fallo aquí es invisible: el héroe simplemente se
 * queda sin datos y nadie se entera.
 */
export const normName = (name) =>
  String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')          // "Popol & Kupa" = "Popol and Kupa"
    .replace(/[^a-z0-9]/g, '');

/**
 * Reindexa {nombre: valor} por clave normalizada.
 * `depth` dice cuántos niveles de nombres hay: 1 para las estadísticas,
 * 2 para las matrices de counters y sinergias. Antes se adivinaba mirando si el
 * valor tenía winRate, y una estadística sin ese campo se rompía en silencio.
 */
export function indexByName(obj, depth = 1) {
  if (!obj) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[normName(k)] = depth > 1 ? indexByName(v, depth - 1) : v;
  }
  return out;
}

/**
 * Busca por clave normalizada y, si no, por el nombre tal cual. El respaldo
 * importa: si quien llama no normalizó el mapa, la versión anterior devolvía
 * "sin datos" en silencio y todos los héroes empataban a 0.50.
 */
const lookup = (map, name) => {
  if (!map) return undefined;
  return map[normName(name)] ?? map[name];
};

/**
 * Winrate de A contra B, mirando también el sentido contrario.
 *
 * Cuando un par existe en los dos sentidos suman EXACTAMENTE 1 (medido:
 * diferencia 0.0000 hasta en el peor caso), así que `1 - counters[B][A]` no es
 * una estimación, es el mismo dato por el otro lado.
 *
 * Desde 1.5.0 la matriz viene completa y la vuelta casi nunca hace falta. Se
 * queda porque cuesta nada y porque es justo lo que salva a un héroe recién
 * salido, del que la API publica sus cruces antes que su fila propia. Cuando la
 * matriz estaba a medias, esto subía la cobertura del 7,6% al 11,2%.
 */
export function matchup(counterMatrix, a, b) {
  const ida = lookup(lookup(counterMatrix, a), b);
  if (ida != null) return ida;
  const vuelta = lookup(lookup(counterMatrix, b), a);
  return vuelta != null ? 1 - vuelta : undefined;
}

/**
 * Sinergia de A con B, mirando también el sentido contrario.
 *
 * Mismo problema que en los counters y misma solución, pero SIN darle la
 * vuelta al número: llevar a A con B es exactamente lo mismo que llevar a B
 * con A, así que el dato es el mismo por los dos lados. Comprobado sobre los
 * datos de verdad: en los 271 pares que la API da en ambos sentidos, la
 * diferencia es 0.000000.
 *
 * Leyendo solo la fila del héroe se perdía el 37% de los cruces que la API sí
 * tenía: 1330 de 2118. No se notaba porque cuando falta el dato entran las
 * reglas por tags y la nota sale igual de razonable, solo que peor fundada.
 * Desde 1.5.0 la matriz viene completa y esto es, como en los counters, la red
 * para los héroes nuevos.
 */
export function sinergia(synergyMatrix, a, b) {
  const ida = lookup(lookup(synergyMatrix, a), b);
  if (ida != null) return ida;
  return lookup(lookup(synergyMatrix, b), a);
}

/**
 * Winrate crudo -> 0..1, encogido hacia 0.5 segun el tamaño de muestra.
 * Un heroe con 52% y 300 partidas vale mas que uno con 58% y 12 partidas.
 * Usa un shrink bayesiano simple (media a priori = winrate medio del parche).
 */
export function metaScore(stat, patchAvgWinRate = 0.5) {
  if (!stat || stat.winRate == null) return { value: 0.5, confident: false };

  // Muestra: partidas reales si la API las da. Muchas no las dan, y entonces
  // n=0 encogía TODOS los winrates a la media y el componente meta valía lo
  // mismo para todo el mundo. El pickrate sirve de proxy: un héroe con 3% de
  // presencia tiene mucha más muestra que uno con 0,2%.
  const n = stat.matches ?? (stat.pickRate != null ? stat.pickRate * 40000 : 1500);
  const prior = 400;
  const shrunk = (stat.winRate * n + patchAvgWinRate * prior) / (n + prior);

  // Centrado en la media del parche: ±6 puntos cubre casi todo el reparto.
  const value = clamp01((shrunk - (patchAvgWinRate - 0.06)) / 0.12);
  return { value, confident: n >= 200, shrunkWinRate: shrunk };
}

/**
 * Counter. Primero intenta el dato real de la API (winrate del heroe A contra B).
 * Si no existe para ese par, cae a las reglas por tags.
 */
/**
 * Presencia del rival a partir de la cual su cruce se cree entero.
 *
 * La idea es sana: contra un héroe que casi nadie juega hay menos partidas
 * detrás y el número se mueve más. Lo que estaba mal era CUÁNTO. La constante
 * valía 0.004 y salía de suponer que el dato venía de unos pocos miles de
 * partidas; nunca se comprobó.
 *
 * Comprobado ahora, con la matriz completa y de dos formas:
 *
 *  1. Si el ruido fuera de muestreo, el cuartil MENOS jugado debería tener sus
 *     cruces 2.65 veces más dispersos que el más jugado (va con 1/raíz de n).
 *     Medido: 1.16 veces. O sea que casi toda la dispersión de un héroe entre
 *     sus rivales es REAL -a unos les gana y a otros no-, no ruido.
 *  2. Dos corridas de la ingesta separadas nueve minutos dan los mismos cruces
 *     con una diferencia mediana de 0.00003. No son estimaciones temblorosas.
 *
 * Con 0.004, un héroe del cuartil raro veía su cruce encogido al 0.35 y uno
 * popular al 0.79: los castigaba el DOBLE de lo que el dato justifica. La
 * constante de aquí sale de resolver que esa razón sea justo el 1.16 medido,
 * en vez de un número inventado. Deja al héroe mediano en 0.94 y solo encoge
 * de verdad a los rarísimos.
 *
 * Si cambias de fuente de datos, vuelve a medir las dos cosas antes de tocarla.
 */
const PICKRATE_FIABLE = 4.1e-4;

/** Confianza en el matchup cuando no se sabe cuánto se juega al rival. */
const CONFIANZA_SIN_MUESTRA = 0.7;

/**
 * Ventaja de un roamer contra un enemigo según las reglas por tags, en 0..1.
 * Cuenta la ventaja más fuerte y media la segunda: sumarlas todas premiaba al
 * héroe con más etiquetas en el catálogo, no al que mejor le va de verdad.
 */
function ventajaPorTags(roamHero, enemy, reasons) {
  // Si los tags del roamer están deducidos, lo que salga de ellos vale menos:
  // acertamos el 67%. Se encoge hacia el empate, igual que un matchup con poca
  // muestra. Sin esto, un héroe nuevo con seis tags adivinados disparaba más
  // reglas que nadie y salía nº1 en el 69% de los drafts.
  const fiable = roamHero.inferred ? PRECISION_DEDUCIDA : 1;
  const positivas = [];
  let penalizacion = 0;

  for (const rule of COUNTER_RULES) {
    if (!enemy.tags.includes(rule.enemyTag) || !roamHero.tags.includes(rule.roamTag)) continue;
    reasons?.push({
      clave: rule.why,
      params: { e: enemy.name },
      good: rule.weight > 0,
      w: Math.abs(rule.weight),
      kind: `${rule.enemyTag}>${rule.roamTag}`,
    });
    if (rule.weight > 0) positivas.push(rule.weight);
    else penalizacion += rule.weight; // las desventajas sí suman: son avisos
  }

  positivas.sort((a, b) => b - a);
  const sub = (positivas[0] ?? 0) + (positivas[1] ?? 0) * 0.5 + penalizacion;
  // Escalado, no recortado: con un multiplicador fijo media plantilla marcaba
  // 1.00 y dejaba de distinguir a quien corta dashes de quien solo hace peel.
  return 0.5 + clamp01(sub / SUB_MAX) * 0.5 * fiable;
}

/**
 * Matchup contra los picks enemigos.
 *
 * Cuando hay winrate real de la pareja se MEZCLA con las reglas por tags en vez
 * de sustituirlas. El dato real es mejor, pero sale de pocas partidas y es
 * ruidoso: dejándole todo el peso, contra tres asesinos de dash podía dejar de
 * recomendarse un anti-dash, que es justo lo que la app debe acertar.
 */
export function counterScore(roamHero, enemies, counterMatrix, enemyRoamName = null, stats = null) {
  if (!enemies.length) return { value: 0.5, reasons: [] };

  const reasons = [];
  let total = 0;
  let pesoTotal = 0;

  for (const enemy of enemies) {
    // El roamer rival es con quien más vas a chocar: su matchup pesa el doble.
    const peso = enemyRoamName && normName(enemy.name) === normName(enemyRoamName) ? 2 : 1;
    pesoTotal += peso;

    const porTags = ventajaPorTags(roamHero, enemy, reasons);
    const pair = matchup(counterMatrix, roamHero.name, enemy.name);

    if (pair == null) {
      total += porTags * peso;
      continue;
    }

    // pair = winrate de roamHero contra enemy (0..1). 0.50 es neutro.
    // Se encoge hacia el empate según lo jugado que esté el rival: con poca
    // muestra, un 57% de matchup es ruido y no una ventaja.
    // Sin pickrate no se puede medir la muestra, pero descartar el dato por eso
    // sería peor: se confía de forma moderada en vez de tirarlo.
    const pr = lookup(stats, enemy.name)?.pickRate;
    const confianza = pr > 0 ? pr / (pr + PICKRATE_FIABLE) : CONFIANZA_SIN_MUESTRA;
    const encogido = 0.5 + (pair - 0.5) * confianza;

    const porDato = clamp01((encogido - 0.44) / 0.12);
    total += porDato * peso;

    if (pair >= 0.53) reasons.push({ clave: 'regla.ganaMatchup', params: { e: enemy.name }, good: true, w: 1.2 });
    if (pair <= 0.47) reasons.push({ clave: 'regla.pierdeMatchup', params: { e: enemy.name }, good: false, w: 1.3 });
  }

  return { value: total / pesoTotal, reasons: dedupe(reasons) };
}

/**
 * ¿Es un aliado de los que hay que proteger?
 *
 * Un tanque también lleva el tag `immobile`, así que sin este filtro la app
 * recomendaba hacerle peel a la primera línea -y banear a quien le saltara
 * encima-, que es justo al revés de cómo se juega.
 *
 * Vive aquí y no dentro de una función porque el criterio se necesita en DOS
 * sitios: la sinergia y los baneos. Estaba escrito solo en el primero, y el
 * fallo sobrevivió entero en el segundo: el 12,1% de los avisos de peligro
 * protegían a un tanque.
 */
export const hayQueProtegerlo = (hero) =>
  ['hypercarry', 'poke', 'burst'].some((t) => hero?.tags?.includes(t))
  && !hero?.tags?.includes('tanky');

/** Sinergia con aliados ya elegidos. Mismo patron: dato real, si no, tags. */
export function synergyScore(roamHero, allies, synergyMatrix) {
  if (!allies.length) return { value: 0.5, reasons: [] };
  const reasons = [];
  let total = 0;

  for (const ally of allies) {
    const pair = sinergia(synergyMatrix, roamHero.name, ally.name);
    if (pair != null) {
      // Centrado en el empate y con medio ancho de 0.08. Estaba en (0.46, 0.10),
      // que aplastaba a CERO el 5,3% de las parejas: la peor sinergia del juego
      // (Chip con Lolita, 0.20) y una mala del montón (0.45) valían lo mismo.
      // Con este rango se recorta el 1,1%, que son los cuatro extremos de
      // verdad, y es la misma holgura que ya tienen los counters.
      //
      // NO se encoge por presencia, y eso es una decisión medida, no un olvido:
      // la dispersión de las sinergias de un héroe raro es solo 1.05 veces la
      // de uno popular (en los counters, 1.16), así que aquí no hay ni ese poco
      // ruido que corregir.
      total += clamp01((pair - 0.42) / 0.16);
      if (pair >= 0.53) reasons.push({ clave: 'regla.combinaCon', params: { a: ally.name }, good: true, w: 0.7 });
      continue;
    }
    let sub = 0;
    if (hayQueProtegerlo(ally) && ally.tags.includes('immobile') && roamHero.tags.includes('peel')) {
      sub += 0.8;
      reasons.push({ clave: 'regla.protege', params: { a: ally.name }, good: true, w: 0.8 });
    }
    if (ally.tags.includes('dive') && roamHero.tags.includes('engage')) {
      sub += 0.6;
      reasons.push({ clave: 'regla.abrePelea', params: { a: ally.name }, good: true, w: 0.6 });
    }
    if (ally.tags.includes('hypercarry') && roamHero.tags.includes('sustain')) {
      sub += 0.5;
      reasons.push({ clave: 'regla.mantieneVivo', params: { a: ally.name }, good: true, w: 0.5 });
    }
    total += clamp01(0.5 + sub * 0.20);
  }

  return { value: total / allies.length, reasons: dedupe(reasons) };
}

/** Tags que cubren la misma necesidad: encadenar CC vale como control duro. */
const SATISFIES = {
  cc_hard: ['cc_hard', 'cc_chain'],
  peel: ['peel', 'shield', 'anti_dive'],
  sustain: ['sustain', 'heal'],
  engage: ['engage'],
  tanky: ['tanky'],
  vision: ['vision'],
};

const has = (hero, need) => (SATISFIES[need] ?? [need]).some((t) => hero.tags.includes(t));

/**
 * Huecos de composicion que rellena este roamer.
 *
 * Cuenta solo los DOS huecos más importantes que tapa, más medio punto por un
 * tercero. Sumar todos premiaba al héroe con más tags escritos en el catálogo:
 * Carmilla cubre cinco necesidades sobre el papel y salía primera en el 94% de
 * los drafts. Un roamer no arregla cinco agujeros él solo, así que la ventaja
 * por acumular etiquetas se corta aquí.
 *
 * Con pocos aliados elegidos, además, el resultado se acerca a neutro: sin eso,
 * un draft vacío premia al generalista y ya está.
 */
export function compScore(roamHero, allies) {
  const covered = new Set(allies.flatMap((a) => a.tags));
  const cubiertos = [];

  for (const need of TEAM_NEEDS) {
    if (!has(roamHero, need.tag)) continue;
    // Si un aliado ya lo cubre, no cuenta NADA. Antes daba un 35% y eso convertía
    // la composición en una nota fija de "lo completo que es el héroe", que apenas
    // cambiaba con el draft y duplicaba lo que ya mide el winrate.
    if ((SATISFIES[need.tag] ?? [need.tag]).some((t) => covered.has(t))) continue;
    cubiertos.push({ ...need, valor: need.weight });
  }

  // El lado de daño que le falta al equipo. No es un tag: sale de los textos
  // de Moonton, así que no lo encoge PRECISION_DEDUCIDA -aunque los tags del
  // héroe estén deducidos, su tipo de daño es un dato, no una suposición-.
  // Por eso entra aquí y se descuenta aparte, más abajo.
  const { falta } = perfilDeDano(allies);
  if (tapaElHueco(roamHero, falta)) {
    cubiertos.push({ tag: 'dano', valor: PESO_DANO, weight: PESO_DANO, why: `necesidad.dano_${falta}`, medido: true });
  }

  cubiertos.sort((a, b) => b.valor - a.valor);
  const contados = cubiertos.slice(0, 3);
  // El tercer hueco vale la mitad: tener tres cosas está bien, pero el draft lo
  // decide sobre todo lo que más falta.
  const aporte = contados.map((n, i) => n.valor * (i < 2 ? 1 : 0.5));

  // Techo: los dos huecos más valiosos del juego, más medio del tercero.
  const techo = [...TEAM_NEEDS].sort((a, b) => b.weight - a.weight)
    .slice(0, 3).reduce((acc, n, i) => acc + n.weight * (i < 2 ? 1 : 0.5), 0);

  const suma = (f) => aporte.reduce((acc, v, i) => acc + (f(contados[i]) ? v : 0), 0);
  const porTags = clamp01(suma((n) => !n.medido) / techo);
  const bonoMedido = suma((n) => n.medido) / techo;

  // OJO: para ORDENAR, esto no hace nada. `normalizarComponente` reescala el
  // componente dentro del pool, y un factor igual para todos los héroes se va
  // entero en esa reescala. Medido: el rango de la contribución de comp es
  // 0.0800 con uno, dos o tres aliados elegidos, o sea el peso completo.
  // Sirve para quien llame a `compScore` suelto (el diagnóstico), no para el
  // ranking. Se deja porque el valor devuelto sí debe ser honesto; si algún día
  // hay que encoger de verdad la composición con pocos aliados, el único sitio
  // donde eso se nota es el PESO, no aquí.
  const confidence = Math.min(1, allies.length / 3);
  // Un héroe cuyos tags están DEDUCIDOS no puede reclamar el techo de
  // composición como uno etiquetado a mano: la deducción acierta el 67% de los
  // tags, y comp es justo el componente que premia acumular etiquetas. Sin
  // esto, un héroe nuevo con seis tags adivinados salía nº1 en el 69% de los
  // drafts, que es el sesgo que ya costó una corrección con Carmilla.
  //
  // El hueco de daño NO se encoge: no sale de tags deducidos sino de los
  // textos de habilidad de Moonton, que dicen literalmente de qué pega cada
  // héroe. Encogerlo sería descontar dos veces.
  const fiabilidad = roamHero.inferred ? PRECISION_DEDUCIDA : 1;
  const desvio = (porTags - 0.5) * fiabilidad + bonoMedido;

  return {
    value: clamp01(0.5 + desvio * (0.35 + 0.65 * confidence)),
    reasons: allies.length
      ? contados.map((n) => ({ clave: n.why, good: true, w: n.weight }))
      : [],
  };
}

/**
 * Tu winrate de siempre, ponderado por partidas.
 *
 * Hace falta un mínimo para creérselo: con dos partidas, tu "nivel" sería 0% o
 * 100% y arrastraría todo lo demás. Por debajo de ese mínimo se usa el 50%,
 * que es lo mismo que hacía la app antes de tener esto.
 */
const PARTIDAS_PARA_TU_NIVEL = 100;

export function tuNivel(mastery = {}) {
  let partidas = 0;
  let ganadas = 0;
  for (const m of Object.values(mastery ?? {})) {
    if (!(m?.games > 0) || m.winRate == null) continue;
    partidas += m.games;
    ganadas += m.winRate * m.games;
  }
  return partidas >= PARTIDAS_PARA_TU_NIVEL ? ganadas / partidas : 0.5;
}

/**
 * Tu winrate personal con ese héroe, encogido si llevas pocas partidas.
 *
 * OJO con la referencia: se encoge hacia TU NIVEL, no hacia el 50%, y la escala
 * va centrada en tu nivel. Antes iba centrada en 0.50, y eso metía un sesgo que
 * NO es el que esta función dice medir: para alguien que gana el 53,4% de sus
 * partidas, un héroe jugado a su media exacta puntuaba 0.64 y uno que no ha
 * tocado nunca, 0.50. O sea que premiaba TENER DATOS, no ser bueno con el
 * héroe. Y un héroe al 50%, que para él es de los peores, salía neutro.
 *
 * Centrado en tu nivel: por encima de lo tuyo sube, por debajo baja, y a tu
 * media exacta empata con un héroe del que no se sabe nada. Que es justo lo que
 * la función dice que mide.
 */
/**
 * Cuánto encoger un winrate personal hacia tu nivel, en partidas de prior.
 *
 * No es un número suelto: en un encogimiento bayesiano el peso del prior es
 *
 *     k = varianza de muestreo / varianza REAL entre héroes = 0.25 / σ²
 *
 * donde σ es lo que de verdad varía tu winrate de un héroe a otro. Y eso se
 * puede MEDIR de tus propias partidas: la dispersión que se observa entre tus
 * héroes menos la que explica el propio muestreo.
 *
 * El valor que había, 20, equivale a suponer σ = ±11 puntos: que tu winrate va
 * del 42% al 64% según el héroe. No es creíble, y salía caro: cinco partidas
 * al 90% puntuaban 0.87, casi el tope.
 *
 * Los límites están para que un jugador con pocos datos no acabe con un prior
 * absurdo en ninguno de los dos sentidos.
 */
const SIGMA_MINIMA = 0.02;
const SIGMA_MAXIMA = 0.08;
/** Con menos de esto no se puede medir la dispersión: se usa ±4 puntos. */
const HEROES_PARA_MEDIR_DISPERSION = 5;
const SIGMA_POR_DEFECTO = 0.04;

export function priorDeMaestria(mastery = {}, nivel) {
  const base = nivel ?? tuNivel(mastery);
  const suyos = Object.values(mastery ?? {}).filter((m) => m?.games >= 30 && m.winRate != null);

  let sigma = SIGMA_POR_DEFECTO;
  if (suyos.length >= HEROES_PARA_MEDIR_DISPERSION) {
    const n = suyos.length;
    const observada = suyos.reduce((s, m) => s + (m.winRate - base) ** 2, 0) / n;
    // Lo que explica el propio muestreo. Lo que sobra es variación de verdad.
    const porMuestreo = suyos.reduce((s, m) => s + 0.25 / m.games, 0) / n;
    const real = observada - porMuestreo;
    if (real > 0) sigma = Math.sqrt(real);
  }
  sigma = Math.max(SIGMA_MINIMA, Math.min(SIGMA_MAXIMA, sigma));
  return 0.25 / (sigma * sigma);
}

export function masteryScore(roamHero, mastery, nivel, prior) {
  const m = lookup(mastery, roamHero.name) ?? mastery?.[roamHero.name];
  if (!m || !m.games) return { value: 0.5, reasons: [] };
  const base = nivel ?? tuNivel(mastery);
  const k = prior ?? priorDeMaestria(mastery, base);
  const shrunk = (m.winRate * m.games + base * k) / (m.games + k);
  // Mismo ancho de siempre (±10 puntos), pero alrededor de tu nivel.
  const value = clamp01((shrunk - (base - 0.10)) / 0.20);
  const reasons = [];
  if (m.games >= MASTERY_CONFIDENCE_GAMES && m.winRate >= 0.55) {
    reasons.push({ clave: 'regla.maestriaBuena', params: { pct: Math.round(m.winRate * 100), n: m.games }, good: true, w: 1.4 });
  }
  if (m.games >= MASTERY_CONFIDENCE_GAMES && m.winRate <= 0.45) {
    reasons.push({ clave: 'regla.maestriaMala', params: { pct: Math.round(m.winRate * 100), n: m.games }, good: false, w: 1.4 });
  }
  return { value, reasons };
}

/**
 * Score final de un roamer para un estado de draft concreto.
 * Devuelve el desglose completo para poder pintar la barra del "por qué".
 */
export function scoreHero(roamHero, ctx) {
  const { enemies = [], allies = [], meta = {}, mastery = {}, weights = DEFAULT_WEIGHTS } = ctx;

  const parts = {
    meta: metaScore(lookup(meta.stats, roamHero.name), meta.patchAvgWinRate ?? 0.5),
    counter: counterScore(roamHero, enemies, meta.counters, ctx.enemyRoam, meta.stats),
    synergy: synergyScore(roamHero, allies, meta.synergies),
    comp: compScore(roamHero, allies),
    mastery: masteryScore(roamHero, mastery, ctx.nivel, ctx.priorMaestria),
  };

  const total = Object.entries(weights).reduce(
    (acc, [key, w]) => acc + (parts[key]?.value ?? 0.5) * w,
    0,
  );

  // Ordena los motivos por relevancia y evita repetir tres veces al mismo enemigo:
  // en 30 segundos de draft solo se leen dos o tres etiquetas.
  const reasons = spread(
    dedupe([
      ...parts.mastery.reasons,
      ...parts.counter.reasons,
      ...parts.comp.reasons,
      ...parts.synergy.reasons,
    ]).sort((a, b) => (b.w ?? 0) - (a.w ?? 0)),
  );

  return {
    hero: roamHero,
    score: total,
    parts,
    contributions: Object.fromEntries(
      Object.entries(weights).map(([k, w]) => [k, (parts[k]?.value ?? 0.5) * w]),
    ),
    reasons: reasons.slice(0, 3),
    banned: false,
  };
}

/**
 * Lo lejos del empate que llega el décimo peor cruce del héroe MÁS castigable.
 *
 * Sale del reparto real, no de una intuición: con la matriz completa el p10 de
 * cada héroe va de 0.465 a 0.492, así que la distancia al empate va de 0.008 a
 * 0.035. Dividir por eso reparte el riesgo entre 0.22 y 1.00, con la mediana
 * en 0.43.
 *
 * Estaba en 0.08, y ese número venía de cuando la API solo devolvía los cinco
 * cruces MÁS EXTREMOS de cada héroe. Con esa muestra sesgada el p10 parecía
 * 0.467; con la matriz entera es 0.485. Manteniendo 0.08, el héroe más
 * castigable del juego marcaba 0.43 y NADIE pasaba de 0.6: el aviso de "estás
 * eligiendo a ciegas y este pick es castigable" no habría vuelto a salir
 * nunca, sin que nada fallara.
 */
const PEOR_CRUCE_REAL = 0.035;

/**
 * Cuánto puede descontar como máximo el riesgo de contrapick.
 *
 * Esto es lo que hace distinto elegir pronto o tarde, y es lo único que lo
 * hace: los enemigos que faltan por elegir no son desconocidos cualesquiera,
 * te eligen A TI en contra. Eligiendo primero interesa un héroe difícil de
 * castigar; eligiendo último, ir a por el counter y ya está -y ahí `cegera` es
 * 0, así que este descuento no existe-.
 *
 * De 0.10 a 0.20 en 1.4.0, medido en 1200 drafts con un solo enemigo en
 * pantalla: el riesgo medio del nº1 baja de 0.477 a 0.380, y la concentración
 * no se mueve (el líder sale en el 10.3% contra el 10.4%, 85 héroes distintos
 * contra 83). Subirlo a 0.30 ya no mejora: 0.391.
 */
const RIESGO_MAX = 0.20;

/** Umbral por debajo del cual se considera que un componente no aporta señal. */
const SENAL_MINIMA = 0.02;

/**
 * Reescala un componente al rango 0..1 dentro del pool.
 *
 * Sin esto los pesos no significaban lo que decían: con datos reales el winrate
 * se repartía por un rango de 0.55 y la composición por 0.19, así que meta
 * decidía el triple de lo que marcaba su peso y el draft apenas movía la
 * recomendación. Medido en la app: influencia real meta 0.121 frente a comp
 * 0.028, teniendo pesos 0.22 y 0.15.
 *
 * Si un componente casi no varía (draft vacío, sin counters, sin maestría) se
 * deja plano en 0.5: no tiene información y no debe inventarse diferencias.
 */
function normalizarComponente(valores) {
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  if (max - min < SENAL_MINIMA) return valores.map(() => 0.5);
  return valores.map((v) => (v - min) / (max - min));
}

/** Ordena todo el pool de roam para el estado actual del draft. */
export function rankRoamers(pool, ctx) {
  // Normalizado: un pick guardado con otra grafía seguiría apareciendo como
  // recomendación disponible aunque ya esté cogido.
  const taken = new Set([
    ...(ctx.enemies ?? []),
    ...(ctx.allies ?? []),
    ...(ctx.bans ?? []),
  ].map((h) => normName(h.name)));

  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const claves = Object.keys(weights);

  const resultados = pool
    .filter((h) => !taken.has(normName(h.name)))
    .map((h) => scoreHero(h, ctx));

  if (!resultados.length) return resultados;

  // Cada componente se reescala dentro del pool ANTES de aplicar su peso, para
  // que un peso de 0.36 sea de verdad el 36% de la decisión.
  const normalizados = {};
  for (const k of claves) {
    normalizados[k] = normalizarComponente(resultados.map((r) => r.parts[k]?.value ?? 0.5));
  }

  // Con el equipo enemigo a medias, un pick muy castigable es una apuesta: se
  // marca para que lo sepas, y se penaliza en proporción a lo que falta por ver.
  const porVer = Math.max(0, 5 - (ctx.enemies?.length ?? 0));
  const cegera = porVer / 5;

  // Un motivo que le sale a casi todo el pool no informa de nada: "no hay
  // primera línea" es cierto para los 34 roamers a la vez, porque la primera
  // línea la pones TÚ. Ocupaba las tres etiquetas de cada tarjeta y tapaba lo
  // que de verdad distingue a un pick de otro.
  const frecuencia = new Map();
  for (const r of resultados) {
    for (const razon of new Set(r.reasons.map(idRazon))) {
      frecuencia.set(razon, (frecuencia.get(razon) ?? 0) + 1);
    }
  }
  const comunes = new Set(
    [...frecuencia.entries()]
      .filter(([, n]) => n > resultados.length * 0.6)
      .map(([texto]) => texto),
  );

  resultados.forEach((r, i) => {
    const propios = r.reasons.filter((x) => !comunes.has(idRazon(x)));
    // Si al quitar los comunes no queda nada, mejor decir eso que mentir.
    r.reasons = propios.length ? propios : [];
    r.contributions = Object.fromEntries(claves.map((k) => [k, normalizados[k][i] * weights[k]]));
    r.score = claves.reduce((acc, k) => acc + r.contributions[k], 0);

    r.riesgo = riesgoContrapick(r.hero, ctx.meta?.counters, ctx.candidatos ?? []);
    if (r.riesgo != null && cegera > 0) {
      r.score -= r.riesgo * cegera * RIESGO_MAX;
      if (r.riesgo > 0.6 && cegera > 0.4) {
        r.reasons = [{ clave: 'regla.arriesgadoCiego', good: false, w: 1.5 }, ...r.reasons].slice(0, 3);
      }
    }
  });

  return resultados.sort((a, b) =>
    // Empate exacto: primero lo que mejor lleves, luego el winrate, y por
    // último el nombre. Sin esto el orden dependía del orden del catálogo.
    b.score - a.score ||
    b.parts.mastery.value - a.parts.mastery.value ||
    b.parts.meta.value - a.parts.meta.value ||
    a.hero.name.localeCompare(b.hero.name));
}

/** Un motivo por tipo de razón: repetir "bloquea los dashes de X" tres veces no informa. */
function spread(reasons) {
  const mentioned = new Set();
  const out = [];
  for (const r of reasons) {
    const key = r.kind ?? idRazon(r);
    if (mentioned.has(key)) continue;
    mentioned.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Completa el catalogo con los heroes que solo conoce la API.
 * Marca los rellenados con `inferred` para poder avisarlo en la interfaz.
 */
export function mergeCatalog(catalogHeroes, apiHeroes = []) {
  // El tipo de dano lo tiene la API para los 133, tambien para los que ya
  // estan en el catalogo escrito a mano: el catalogo lleva rol y tags, no dano.
  const porApi = new Map(apiHeroes.map((h) => [normName(h.name), h]));
  const byName = new Map(catalogHeroes.map((h) => {
    const api = porApi.get(normName(h.name));
    // El id tampoco lo lleva el catalogo, y hace falta para pedir su retrato:
    // los ficheros van por id porque un id no cambia aunque Moonton reescriba
    // el nombre, que es justo lo que aqui rompe las cosas en silencio.
    return [h.name, {
      ...h,
      ...(api?.damage ? { damage: api.damage } : {}),
      ...(api?.id != null ? { id: api.id } : {}),
    }];
  }));
  for (const api of apiHeroes) {
    if (byName.has(api.name)) continue;
    const role = (api.role ?? '').toLowerCase();
    byName.set(api.name, {
      name: api.name,
      ...(api.id != null ? { id: api.id } : {}),
      role,
      tags: tagsDeducidos(role, api.speciality),
      roam: role === 'tank' || role === 'support',
      inferred: true,
      ...(api.damage ? { damage: api.damage } : {}),
    });
  }
  return [...byName.values()];
}

/**
 * Proporcion a partir de la cual un heroe cuenta como que pega de las dos
 * cosas. Sale del reparto real de los 133, no de una intuicion.
 */
const MIXTO_DESDE = 0.5;

/**
 * De que pega un heroe: 'fisico', 'magico', 'mixto' o null si no se sabe.
 *
 * Las cuentas salen de los textos de habilidad de Moonton (ver `extraerDano`
 * en la ingesta), no del rol. El rol se equivocaria en unos cuantos: Gusion es
 * asesino y pega magico, Hylos es tanque y pega magico, Esmeralda pega las dos
 * cosas de verdad.
 *
 * El dano verdadero no cuenta como tipo: atraviesa las dos defensas, asi que
 * no ayuda a decidir si al equipo le falta un lado.
 */
export function tipoDeDano(hero) {
  const d = hero?.damage;
  if (!d) return null;
  const { fisico = 0, magico = 0 } = d;
  if (!fisico && !magico) return null;
  const menor = Math.min(fisico, magico);
  const mayor = Math.max(fisico, magico);
  if (menor >= mayor * MIXTO_DESDE) return 'mixto';
  return fisico > magico ? 'fisico' : 'magico';
}

/**
 * De que pega un equipo, y que lado le falta.
 *
 * Es el concepto de draft mas repetido en MLBB: si los cinco pegais fisico, al
 * rival le basta con comprar armadura y desapareceis en late. Lo mismo al
 * reves con la resistencia magica.
 *
 * `falta` solo se rellena cuando hay de que fiarse: al menos dos heroes con
 * dato y ninguno del lado que falta. Con un solo aliado elegido no se puede
 * decir que al equipo le falte nada.
 */
export function perfilDeDano(heroes = []) {
  const tipos = heroes.map(tipoDeDano);
  const conDato = tipos.filter(Boolean);
  const cuenta = (t) => tipos.filter((x) => x === t).length;
  const fisico = cuenta('fisico');
  const magico = cuenta('magico');
  const mixto = cuenta('mixto');

  let falta = null;
  if (conDato.length >= 2) {
    if (!magico && !mixto) falta = 'magico';
    else if (!fisico && !mixto) falta = 'fisico';
  }
  return { fisico, magico, mixto, sinDato: tipos.length - conDato.length, falta };
}

/** Un heroe mixto tapa cualquier hueco; uno puro solo el suyo. */
export function tapaElHueco(hero, falta) {
  if (!falta) return false;
  const t = tipoDeDano(hero);
  return t === falta || t === 'mixto';
}

/**
 * Tags de un héroe que no está en el catálogo escrito a mano.
 *
 * Base: los tags por defecto de su rol. Encima, lo que se pueda traducir de la
 * "speciality" que publica Moonton, quitando lo que el catálogo dice que nunca
 * le corresponde a ese rol. Con solo el rol se acertaba el 39.6% de los tags
 * reales; sumando la speciality, el 52.5%, sin perder precisión.
 */
export function tagsDeducidos(role, speciality = []) {
  const porRol = ROLE_DEFAULTS[role] ?? [];
  const veto = new Set(ROLE_VETO[role] ?? []);
  const porEsp = (speciality ?? [])
    .flatMap((e) => SPECIALITY_TAGS[e] ?? [])
    .filter((t) => !veto.has(t));
  return [...new Set([...porRol, ...porEsp])];
}

/** Las cinco líneas, en el orden en que se leen en el juego. */
export const LINEAS = ['roam', 'jungle', 'mid', 'gold', 'exp'];

/**
 * Héroes que se juegan en una línea, según la API.
 *
 * El pool NO está escrito a mano: sale de en qué líneas se juega de verdad cada
 * héroe. Un héroe puede aparecer en dos (31 de los 133 lo hacen) y eso es
 * correcto: Yu Zhong es exp y también jungla.
 *
 * Si no hay datos de líneas todavía, para roam se cae al catálogo escrito a
 * mano, que es el único que los tiene. Las otras cuatro se quedan vacías, y la
 * app lo dice en vez de inventarse un pool.
 */
export function poolDeLinea(heroes, indiceLineas, linea) {
  const conLineas = heroes.filter((h) => indiceLineas?.get?.(normName(h.name))?.lanes?.length);
  if (!conLineas.length) return linea === 'roam' ? heroes.filter((h) => h.roam) : [];
  return heroes.filter((h) => indiceLineas.get(normName(h.name))?.lanes?.includes(linea));
}

/**
 * A quién banear. No es "el héroe con más winrate": es el que más te duele a ti,
 * así que pesa el banrate global (lo que la gente ya considera peligroso) junto
 * con lo mal que le va a tu composición ya elegida.
 */
export function suggestBans(allHeroes, ctx) {
  const { allies = [], enemies = [], bans = [], meta = {} } = ctx;
  // Normalizado, igual que en rankRoamers y por la misma razón: un pick
  // guardado con otra grafía seguía apareciendo como ban recomendado aunque ya
  // estuviera en la pantalla.
  const taken = new Set([...allies, ...enemies, ...bans].map((h) => normName(h.name)));

  return allHeroes
    .filter((h) => !taken.has(normName(h.name)) && lookup(meta.stats, h.name))
    .map((hero) => {
      const stat = lookup(meta.stats, hero.name);
      const power = metaScore(stat, meta.patchAvgWinRate ?? 0.5).value;
      const consensus = stat.banRate ?? 0;

      // Cuánto castiga a los aliados que ya has elegido. Con la tabla propia de
      // peligro, no con la de counters puesta del revés.
      const positivas = [];
      const reasons = [];
      for (const ally of allies) {
        for (const rule of DANGER_RULES) {
          if (!ally.tags.includes(rule.allyTag) || !hero.tags.includes(rule.enemyTag)) continue;
          if (rule.soloSiFragil && !hayQueProtegerlo(ally)) continue;
          positivas.push(rule.weight);
          reasons.push({ clave: rule.why, params: { a: ally.name }, good: false, w: rule.weight });
        }
      }
      // La amenaza más fuerte y media la segunda, como en el resto del motor.
      positivas.sort((a, b) => b - a);
      const danger = (positivas[0] ?? 0) + (positivas[1] ?? 0) * 0.5;
      const dangerNorm = Math.min(1, danger / 1.5);

      return {
        hero,
        stat,
        score: power * 0.40 + consensus * 0.35 + dangerNorm * 0.25,
        reasons: dedupe(reasons).sort((a, b) => b.w - a.w).slice(0, 1),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Riesgo de contrapick: cuánto puede hundirse este roamer si el enemigo aún no
 * ha elegido y luego te saca su peor matchup.
 *
 * Idea tomada de las herramientas de draft de LoL, y especialmente pertinente en
 * roam porque sueles elegir pronto, a ciegas. En ese momento no quieres el mejor
 * pick sobre el papel, quieres el que menos te pueden castigar después.
 *
 * Devuelve 0..1, donde 1 es muy castigable. Se mide con el percentil 10 de sus
 * matchups (el mal día típico), no con el mínimo absoluto, que sería un dato
 * suelto con poca muestra.
 */
export function riesgoContrapick(roamHero, counterMatrix, candidatos) {
  const fila = lookup(counterMatrix, roamHero.name);
  if (!fila) return null;

  const valores = candidatos
    .map((h) => matchup(counterMatrix, roamHero.name, h.name))
    .filter((v) => v != null)
    .sort((a, b) => a - b);

  if (valores.length < 10) return null;

  const p10 = valores[Math.floor(valores.length * 0.1)];
  return clamp01((0.50 - p10) / PEOR_CRUCE_REAL);
}

/** Cuántos roamers tienen datos reales. Si baja, algo se ha roto en silencio. */
/**
 * Densidad de la matriz de counters: cuántos rivales cubre cada roamer de media.
 *
 * "34/34 con counters" solo dice que cada roamer tiene FILA, no que tenga dato
 * contra los cinco enemigos de tu partida. La API devuelve los matchups más
 * relevantes, no los 133. Donde no hay dato entran mis reglas por tags, así que
 * este número es lo que de verdad mide cuánto se apoya la app en partidas.
 */
export function densidadCounters(pool, counters, candidatos) {
  if (!counters) return { media: 0, cobertura: 0 };
  const tam = pool.map((h) => Object.keys(lookup(counters, h.name) ?? {}).length);
  const media = tam.reduce((a, b) => a + b, 0) / (tam.length || 1);

  let conDato = 0;
  let total = 0;
  for (const h of pool) {
    for (const e of candidatos ?? []) {
      // Un héroe contra sí mismo no es un cruce que falte: no existe. Contarlo
      // dejaba la cobertura en el 99.2% con la matriz COMPLETA, y eso, leído en
      // el móvil, parece que falta algo cuando no falta nada.
      if (normName(h.name) === normName(e.name)) continue;
      total++;
      if (matchup(counters, h.name, e.name) != null) conDato++;
    }
  }
  return { media, cobertura: total ? conDato / total : 0 };
}

export function coverage(pool, stats, counters) {
  const missing = stats ? pool.filter((h) => !lookup(stats, h.name)).map((h) => h.name) : pool.map((h) => h.name);
  const conCounters = counters
    ? pool.filter((h) => Object.keys(lookup(counters, h.name) ?? {}).length).length
    : 0;
  return { withData: pool.length - missing.length, total: pool.length, missing, conCounters };
}

/**
 * Agrupa los primeros puestos que están dentro del margen de ruido.
 * Fingir que el nº1 es mejor que el nº2 cuando les separan 3 milésimas es
 * precisión falsa: si están empatados, hay que decirlo.
 */
export function empatados(ranked, margen = 0.015) {
  if (!ranked.length) return [];
  return ranked.filter((r) => ranked[0].score - r.score <= margen).slice(0, 4);
}

/**
 * Identidad de un motivo. Antes era su texto; ahora los motivos viajan como
 * clave más parámetros, así que la identidad se arma con las dos cosas. Sin
 * esto, dos motivos distintos sobre enemigos distintos se tomarían por el
 * mismo y se filtrarían mal.
 */
export function idRazon(r) {
  return `${r.clave}|${r.params?.e ?? r.params?.a ?? ''}`;
}

function dedupe(reasons) {
  const seen = new Set();
  return reasons.filter((r) => {
    const id = idRazon(r);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
