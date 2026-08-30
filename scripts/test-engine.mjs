#!/usr/bin/env node
/**
 * Pruebas del motor. Sin dependencias: se ejecutan con `npm test` y en el
 * workflow ANTES de compilar, así que un cambio que rompa la lógica no llega
 * a publicarse.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  metaScore, counterScore, compScore, masteryScore, rankRoamers,
  suggestBans, mergeCatalog, indexByName, normName, coverage, empatados,
  riesgoContrapick, densidadCounters, tagsDeducidos, idRazon,
} from '../src/engine/score.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(readFileSync(resolve(ROOT, 'public/data/heroes.json'), 'utf8'));
const all = mergeCatalog(cat.heroes, []);
const pool = all.filter((h) => h.roam);
const by = new Map(all.map((h) => [h.name, h]));
const h = (n) => {
  const x = by.get(n);
  if (!x) throw new Error(`el catálogo no tiene a ${n}`);
  return x;
};

let pasadas = 0;
let fallos = 0;
// Las pruebas asíncronas se APUNTAN y se esperan al final, una por una.
// Antes se les daba un plazo fijo de 60 ms: en mi máquina llegaban, pero en
// GitHub seis se quedaban fuera de la cuenta, y como process.exit ya había
// corrido, un fallo suyo NO tumbaba el despliegue. Entre ellas, la que vigila
// el fallo de ROUTES. Lo destapó la vigilancia automática el primer día.
const pendientes = [];

const test = (nombre, fn) => {
  try {
    const r = fn();
    if (r instanceof Promise) {
      pendientes.push(r.then(() => { pasadas++; }).catch((err) => {
        fallos++;
        console.error(`  FALLA  ${nombre}\n         ${err.message}`);
      }));
      return;
    }
    pasadas++;
  } catch (err) {
    fallos++;
    console.error(`  FALLA  ${nombre}\n         ${err.message}`);
  }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const rnd = (() => { let s = 99; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();

console.log('Motor de recomendación');

test('el catálogo no tiene nombres repetidos', () => {
  const n = cat.heroes.map((x) => x.name);
  ok(new Set(n).size === n.length, 'hay nombres duplicados');
});

test('todos los tags del catálogo están documentados', () => {
  const conocidos = new Set(Object.keys(cat.tagLegend));
  const malos = cat.heroes.flatMap((x) => x.tags).filter((t) => !conocidos.has(t));
  ok(!malos.length, `tags sin definir: ${[...new Set(malos)].join(', ')}`);
});

test('los nombres se normalizan pese a puntuación y variantes', () => {
  const pares = [['X.Borg', 'X Borg'], ['Yi Sun-shin', 'Yi Sun Shin'], ["Chang'e", 'Change'],
    ['Popol and Kupa', 'Popol & Kupa'], ['Lapu-Lapu', 'LapuLapu']];
  for (const [a, b] of pares) ok(normName(a) === normName(b), `${a} ≠ ${b}`);
});

test('el winrate se encoge según la muestra', () => {
  const mucha = metaScore({ winRate: 0.54, matches: 9000 }, 0.50).value;
  const poca = metaScore({ winRate: 0.58, matches: 30 }, 0.50).value;
  ok(mucha > poca, '30 partidas al 58% no pueden valer más que 9000 al 54%');
});

test('sin número de partidas, el pickrate hace de muestra', () => {
  const alto = metaScore({ winRate: 0.54, pickRate: 0.03 }, 0.497).value;
  const bajo = metaScore({ winRate: 0.54, pickRate: 0.002 }, 0.497).value;
  ok(alto > bajo, 'el pickrate no está diferenciando la confianza');
});

test('el dato real de la API puede contradecir a las reglas por tags', () => {
  // Por tags, Belerick contraataca a Fanny (peel + anti_dive). Si las partidas
  // reales dicen que pierde el matchup, debe mandar el dato, no mi regla.
  const malo = counterScore(h('Belerick'), [h('Fanny')], indexByName({ Belerick: { Fanny: 0.44 } }, 2)).value;
  const porTags = counterScore(h('Belerick'), [h('Fanny')], undefined).value;
  const bueno = counterScore(h('Belerick'), [h('Fanny')], indexByName({ Belerick: { Fanny: 0.58 } }, 2)).value;
  ok(malo < porTags, 'un matchup perdido no baja la puntuación');
  ok(bueno > malo, 'el dato real no ordena los matchups');
});

test('se deduce el rival de TU línea, y se calla si hay duda', async () => {
  const { detectarRivalDeLinea, indiceDeLineas, frecuenciaDeRoles } =
    await import('../src/engine/rival-de-linea.js');

  const listado = [
    { name: 'Angela', role: 'support', lane: 'roam' },
    { name: 'Fredrinn', role: 'fighter', lane: 'jungle,exp' },
    { name: 'Zilong', role: 'fighter', lane: 'exp,gold' },
    { name: 'Kagura', role: 'mage', lane: 'mid' },
    { name: 'Claude', role: 'marksman', lane: 'gold' },
    { name: 'Minotaur', role: 'tank', lane: 'roam' },
    { name: 'Floryn', role: 'support', lane: 'roam' },
    { name: 'Melissa', role: 'marksman', lane: 'gold' },
    { name: 'Argus', role: 'fighter', lane: 'exp' },
    { name: 'Saber', role: 'assassin', lane: 'jungle' },
  ];
  const info = indiceDeLineas(listado);
  const frec = frecuenciaDeRoles(listado.map((x) => ({ ...x, lanes: x.lane.split(',') })));
  const draft = ['Fredrinn', 'Angela', 'Zilong', 'Kagura', 'Claude'].map(h);
  const rival = (linea, d = draft) => detectarRivalDeLinea(d, info, linea, frec);

  // El MISMO draft da un rival distinto según la línea que juegues tú. Esto es
  // lo que hace que la app sirva para los cinco roles y no solo para roam.
  ok(rival('roam') === 'Angela', `roam deberia ser Angela: ${rival('roam')}`);
  ok(rival('mid') === 'Kagura', `mid deberia ser Kagura: ${rival('mid')}`);
  ok(rival('gold') === 'Claude', `gold deberia ser Claude: ${rival('gold')}`);

  // Con DOS candidatos claros, callarse: equivocarse duplica el peso del
  // matchup equivocado, que es peor que no decir nada.
  const dosRoamers = ['Melissa', 'Argus', 'Saber', 'Minotaur', 'Floryn'].map(h);
  ok(rival('roam', dosRoamers) === null, 'se moja habiendo dos roamers posibles');

  // Y no se inventa un roam donde no hay ninguno.
  ok(rival('roam', ['Kagura', 'Claude', 'Zilong', 'Saber', 'Argus'].map(h)) === null,
    'inventa un roam donde no hay ninguno');

  // Sin datos de la API sigue funcionando para roam con el catálogo, que es lo
  // único que sabe quién rota. Para las otras cuatro no puede saberlo, y
  // callarse es la respuesta correcta.
  ok(detectarRivalDeLinea(draft, new Map(), 'roam', {}) === 'Angela',
    'sin datos de líneas no acierta el roam ni con el catálogo');
  ok(detectarRivalDeLinea(draft, new Map(), 'mid', {}) === null,
    'sin datos de líneas se inventa un mid');
});

test('los dos idiomas están completos y las reglas usan claves de verdad', async () => {
  const { CLAVES, DICCIONARIOS, crearT, idiomaPorDefecto, IDIOMAS } = await import('../src/i18n.js');
  const { COUNTER_RULES, TEAM_NEEDS, DANGER_RULES } = await import('../src/engine/rules.js');

  // 1. Ningún idioma a medias. Es el fallo tipico de esto: se anade una frase
  //    en uno y el otro se queda con la clave cruda en pantalla.
  for (const idioma of IDIOMAS) {
    const faltan = CLAVES.filter((k) => !DICCIONARIOS[idioma][k]);
    ok(!faltan.length, `${idioma} sin traducir: ${faltan.slice(0, 6).join(', ')}`);
    const sobran = Object.keys(DICCIONARIOS[idioma]).filter((k) => !CLAVES.includes(k));
    ok(!sobran.length, `${idioma} tiene claves que no existen en español: ${sobran.join(', ')}`);
  }

  // 2. Toda clave que usan las reglas tiene que existir. Si no, el usuario ve
  //    'regla.loQueSea' en la tarjeta.
  const usadas = [
    ...COUNTER_RULES.map((r) => r.why),
    ...TEAM_NEEDS.map((n) => n.why),
    ...DANGER_RULES.map((r) => r.why),
  ];
  for (const clave of usadas) {
    ok(typeof clave === 'string', `why deberia ser una clave, no ${typeof clave}`);
    ok(CLAVES.includes(clave), `la regla usa una clave que no existe: ${clave}`);
  }

  // 3. Los parámetros se sustituyen en los dos idiomas.
  for (const idioma of IDIOMAS) {
    const t = crearT(idioma);
    const frase = t('regla.antiDash', { e: 'Fanny' });
    ok(frase.includes('Fanny'), `${idioma} no sustituye el parámetro: ${frase}`);
    ok(!frase.includes('{e}'), `${idioma} deja el hueco sin rellenar: ${frase}`);
  }

  // 4. Una clave que no existe se devuelve tal cual: así se ve a la legua en
  //    vez de quedarse en blanco.
  ok(crearT('es')('no.existe.esta') === 'no.existe.esta', 'una clave perdida deberia verse');

  // 5. Idioma del móvil, con inglés de respaldo: la app ya no es solo para
  //    quien habla español.
  ok(IDIOMAS.includes(idiomaPorDefecto()), 'el idioma por defecto no es uno de los soportados');
});

test('el análisis dice lo que no se ve, y se calla cuando no sabe', async () => {
  const { analizarDraft } = await import('../src/engine/analisis.js');

  const yo = { name: 'Khufra', tags: ['engage', 'cc_hard', 'tanky', 'peel'], roam: true };
  const rival = { name: 'Estes', tags: ['heal', 'sustain'], roam: true };
  const ranked = [
    { hero: yo, score: 0.70, riesgo: 0.2 },
    { hero: { name: 'Atlas', tags: [] }, score: 0.55 },
  ];

  // 1. Con dato de la pareja, lo dice con el matchup, que es el dato bueno.
  const conPar = analizarDraft({
    ranked, enemies: [rival], allies: [], empate: [],
    rivalLinea: 'Estes',
    meta: { counters: indexByName({ Khufra: { Estes: 0.57 } }, 2) },
  });
  ok(conPar.some((f) => f.clave === 'analisis.ganasCruce' && f.params?.pct === 57),
    `no usa el matchup real: ${JSON.stringify(conPar)}`);

  // 2. La matriz solo cubre el 11% de los cruces, asi que casi nunca lo hay.
  //    Sin el, se comparan los winrates sueltos, que es peor informacion y por
  //    eso se dice con otras palabras: 'este parche', no 'le ganas'.
  const sinPar = analizarDraft({
    ranked, enemies: [rival], allies: [], empate: [],
    rivalLinea: 'Estes',
    meta: { counters: {}, stats: indexByName({ Khufra: { winRate: 0.54 }, Estes: { winRate: 0.49 } }) },
  });
  ok(sinPar.some((f) => f.clave === 'analisis.tuWinrateMejor'), `no cae al winrate: ${JSON.stringify(sinPar)}`);
  ok(!sinPar.some((f) => f.clave === 'analisis.ganasCruce'),
    'vende una comparación de winrates como si fuera el matchup de la pareja');

  // 3. Sin nada de nada, se calla. Una frase inventada en 30 segundos de draft
  //    es peor que ninguna.
  const aCiegas = analizarDraft({
    ranked: [{ hero: yo, score: 0.6 }, { hero: { name: 'Atlas', tags: [] }, score: 0.59 }],
    enemies: [], allies: [], empate: [], rivalLinea: null, meta: {},
  });
  ok(!aCiegas.length, `se inventa algo sin datos: ${JSON.stringify(aCiegas)}`);

  // 4. Nunca more de tres frases: en un draft se leen dos.
  ok(conPar.length <= 3, 'suelta demasiadas frases');
});

test('el pool sale de la línea que juegas, no de una lista escrita a mano', async () => {
  const { poolDeLinea, LINEAS } = await import('../src/engine/score.js');
  const { indiceDeLineas } = await import('../src/engine/rival-de-linea.js');

  const idx = indiceDeLineas([
    { name: 'Akai', role: 'tank', lanes: ['roam', 'jungle'] },
    { name: 'Layla', role: 'marksman', lanes: ['gold'] },
    { name: 'Kagura', role: 'mage', lanes: ['mid'] },
  ]);
  const heroes = [
    { name: 'Akai', tags: [], roam: true },
    { name: 'Layla', tags: [], roam: false },
    { name: 'Kagura', tags: [], roam: false },
  ];

  ok(poolDeLinea(heroes, idx, 'gold').map((x) => x.name).join() === 'Layla', 'gold mal');
  ok(poolDeLinea(heroes, idx, 'mid').map((x) => x.name).join() === 'Kagura', 'mid mal');
  // Un héroe que juega dos líneas sale en las dos. Es correcto: Akai hace roam
  // y jungla de verdad.
  ok(poolDeLinea(heroes, idx, 'roam').map((x) => x.name).join() === 'Akai', 'roam mal');
  ok(poolDeLinea(heroes, idx, 'jungle').map((x) => x.name).join() === 'Akai', 'jungle mal');

  ok(LINEAS.length === 5, 'deberían ser cinco líneas');

  // Sin datos de líneas: roam se cae al catálogo, las demás se quedan vacías
  // y la app lo dice en vez de inventarse un pool.
  ok(poolDeLinea(heroes, new Map(), 'roam').map((x) => x.name).join() === 'Akai',
    'sin datos, roam debería caer al catálogo');
  ok(!poolDeLinea(heroes, new Map(), 'gold').length,
    'sin datos, gold debería quedarse vacía en vez de inventarse un pool');
});

test('el roamer enemigo marcado pesa el doble', () => {
  const m = indexByName({ Khufra: { Fanny: 0.58, Layla: 0.42 } }, 2);
  const neutro = counterScore(h('Khufra'), [h('Fanny'), h('Layla')], m).value;
  const marcado = counterScore(h('Khufra'), [h('Fanny'), h('Layla')], m, 'Fanny').value;
  ok(marcado > neutro, 'marcar al enemigo bueno no sube el score');
});

test('la composición no premia huecos que un aliado ya cubre', () => {
  const solo = compScore(h('Tigreal'), [h('Layla')]).value;
  const conOtroTanque = compScore(h('Tigreal'), [h('Layla'), h('Atlas')]).value;
  ok(conOtroTanque < solo, 'con otro iniciador ya en el equipo debería bajar');
});

test('la maestría personal sube el puesto de un héroe', () => {
  const sin = rankRoamers(pool, { meta: {} });
  const con = rankRoamers(pool, { meta: {}, mastery: { Belerick: { games: 80, winRate: 0.62 } } });
  const puesto = (r) => r.findIndex((x) => x.hero.name === 'Belerick');
  ok(puesto(con) < puesto(sin), 'llevarlo al 62% no mejora su puesto');
});

test('pocas partidas apenas mueven la maestría', () => {
  const muchas = masteryScore(h('Belerick'), { Belerick: { games: 80, winRate: 0.62 } }).value;
  const pocas = masteryScore(h('Belerick'), { Belerick: { games: 3, winRate: 1.0 } }).value;
  ok(pocas < muchas, '3 partidas al 100% no pueden pesar tanto');
});

test('los héroes ya cogidos o baneados no se recomiendan', () => {
  const r = rankRoamers(pool, { bans: [h('Khufra')], allies: [h('Atlas')], meta: {} });
  ok(!r.some((x) => x.hero.name === 'Khufra'), 'recomienda un héroe baneado');
  ok(!r.some((x) => x.hero.name === 'Atlas'), 'recomienda un héroe ya cogido');
});

test('el orden es determinista ante empates', () => {
  const a = rankRoamers(pool, { meta: {} }).map((x) => x.hero.name);
  const b = rankRoamers([...pool].reverse(), { meta: {} }).map((x) => x.hero.name);
  ok(JSON.stringify(a) === JSON.stringify(b), 'el resultado depende del orden del catálogo');
});

test('contra dashes sube un anti-mobility; contra curación, un antiheal', () => {
  const vsFanny = rankRoamers(pool, { enemies: [h('Fanny')], meta: {} }).slice(0, 8).map((x) => x.hero.name);
  ok(vsFanny.some((n) => h(n).tags.includes('anti_mobility')),
    `sin anti-mobility en el top 8: ${vsFanny.join(', ')}`);
  const vsEsme = rankRoamers(pool, { enemies: [h('Esmeralda')], meta: {} }).slice(0, 8).map((x) => x.hero.name);
  ok(vsEsme.some((n) => h(n).tags.includes('antiheal')),
    `sin antiheal en el top 8: ${vsEsme.join(', ')}`);
});

test('la recomendación responde al equipo enemigo', () => {
  // Winrate por NOMBRE, no por posición en el fichero: si no, reordenar
  // heroes.json cambiaba el sorteo y con él el veredicto de esta prueba.
  const porNombre = (nombre) => {
    let x = 2166136261 ^ 31;
    for (const ch of nombre) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return ((x >>> 0) % 100000) / 100000;
  };
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.497 + (porNombre(x.name) - 0.5) * 0.05, matches: 5000 }])));
  const meta = { stats, patchAvgWinRate: 0.497 };
  const top3 = (nombres) =>
    rankRoamers(pool, { enemies: nombres.map(h), meta }).slice(0, 3).map((x) => x.hero.name);

  const vsDashes = top3(['Fanny', 'Ling', 'Lancelot']);
  const vsCuracion = top3(['Esmeralda', 'Uranus', 'Thamuz']);

  ok(h(vsDashes[0]).tags.includes('anti_mobility'),
    `contra tres asesinos móviles el nº1 debería frenar dashes: ${vsDashes.join(', ')}`);
  ok(h(vsCuracion[0]).tags.includes('antiheal'),
    `contra tres héroes de curación el nº1 debería cortar curación: ${vsCuracion.join(', ')}`);
  ok(vsDashes[0] !== vsCuracion[0],
    'la recomendación no cambia entre dos composiciones enemigas opuestas');
});

test('ningún héroe acapara por acumular etiquetas', () => {
  // La patología que esto vigila: Carmilla cubría cinco necesidades sobre el
  // papel y salía nº1 en el 94% de los drafts. Para medir SOLO eso, todos los
  // héroes llevan el MISMO winrate: lo que quede de concentración sale de los
  // tags y de nada más. Sin sorteo de winrates, así que no depende de la suerte
  // de una semilla ni del orden del catálogo.
  //
  // Medido hoy: Chou 51%, Carmilla 33%, y 8 roamers distintos llegan a nº1
  // alguna vez. Con datos reales baja al 39%, porque el counter de cada pareja
  // mueve la recomendación de un draft a otro.
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.50, matches: 5000 }])));
  const meta = { stats, patchAvgWinRate: 0.50 };
  const otros = all.filter((x) => !x.roam);

  let semilla = 42;
  const r = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (arr, n) => {
    const c = [...arr];
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c.slice(0, n);
  };

  const cuenta = {};
  for (let i = 0; i < 600; i++) {
    const top = rankRoamers(pool, { enemies: pick(otros, 3), allies: pick(otros, 3), meta })[0].hero.name;
    cuenta[top] = (cuenta[top] ?? 0) + 1;
  }
  const orden = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
  const cuota = orden[0][1] / 600;

  ok(cuota < 0.62,
    `${orden[0][0]} acapara el ${Math.round(cuota * 100)}% con winrates iguales: los tags mandan demasiado`);
  ok(orden.length >= 5,
    `solo ${orden.length} roamers distintos llegan a nº1: el pool está muerto`);
});

test('un winrate afortunado no convierte a nadie en respuesta única', () => {
  // Complementa a la de arriba con el caso realista: winrates distintos por
  // héroe. Aquí SÍ es normal que el que mejor winrate tiene salga mucho, así
  // que el umbral es flojo y solo caza un desastre.
  //
  // El winrate de cada uno sale de SU NOMBRE, no de su posición en el fichero.
  // Con el reparto por posición que había antes, ordenar heroes.json
  // alfabéticamente hacía fallar esta prueba sin tocar una línea del motor:
  // medía el orden del catálogo. Sobre 30 sorteos: media 63%, mediana 65%,
  // máximo 91%. De ahí el umbral flojo: la media real ronda ese 63%.
  const otros = all.filter((x) => !x.roam);
  const cuotas = [];

  for (let sorteo = 0; sorteo < 12; sorteo++) {
    const semillaSorteo = 1000 + sorteo * 77;
    const porNombre = (nombre) => {
      let x = 2166136261 ^ semillaSorteo;
      for (const ch of nombre) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
      return ((x >>> 0) % 100000) / 100000;
    };
    const stats = indexByName(Object.fromEntries(
      all.map((x) => [x.name, { winRate: 0.497 + (porNombre(x.name) - 0.5) * 0.05, matches: 5000 }])));

    let semilla = semillaSorteo;
    const r = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = (arr, n) => {
      const c = [...arr];
      for (let i = c.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [c[i], c[j]] = [c[j], c[i]];
      }
      return c.slice(0, n);
    };

    const cuenta = {};
    for (let i = 0; i < 100; i++) {
      const top = rankRoamers(pool, { enemies: pick(otros, 3), allies: pick(otros, 3), meta: { stats, patchAvgWinRate: 0.497 } })[0].hero.name;
      cuenta[top] = (cuenta[top] ?? 0) + 1;
    }
    cuotas.push(Math.max(...Object.values(cuenta)) / 100);
  }

  const media = cuotas.reduce((a, b) => a + b, 0) / cuotas.length;
  ok(media < 0.75,
    `el líder acapara de media el ${Math.round(media * 100)}% (${cuotas.map((c) => Math.round(c * 100)).join(', ')})`);
});

test('los baneos señalan la amenaza real contra tu equipo', () => {
  const stats = Object.fromEntries(all.map((x) => [x.name, { winRate: 0.50, banRate: 0.04, matches: 5000 }]));
  stats.Fanny = { winRate: 0.53, banRate: 0.60, matches: 9000 };
  const r = suggestBans(all, { allies: [h('Melissa')], meta: { stats: indexByName(stats), patchAvgWinRate: 0.50 } });
  ok(r[0].hero.name === 'Fanny', `esperaba Fanny la primera, salió ${r[0].hero.name}`);
});

test('la cobertura detecta héroes sin datos', () => {
  const c = coverage([h('Khufra'), h('Atlas')], indexByName({ Khufra: { winRate: 0.5 } }));
  ok(c.withData === 1 && c.missing[0] === 'Atlas', JSON.stringify(c));
});

test('los empates técnicos se agrupan', () => {
  const e = empatados([{ score: 0.60 }, { score: 0.595 }, { score: 0.50 }]);
  ok(e.length === 2, `esperaba 2 empatados, hubo ${e.length}`);
});

test('las estadísticas indexadas solo se leen con el nombre normalizado', () => {
  // Este fallo estuvo publicado: la tarjeta buscaba stats[hero.name] contra un
  // mapa indexado en minúsculas, así que TODAS mostraban "sin datos".
  const idx = indexByName({ 'X.Borg': { winRate: 0.53 } });
  ok(idx['X.Borg'] === undefined, 'el nombre crudo no debería encontrar nada');
  ok(idx[normName('X Borg')]?.winRate === 0.53, 'el normalizado sí debe encontrarlo');
});

test('la app no busca estadísticas con el nombre crudo', () => {
  const app = readFileSync(resolve(ROOT, 'src/App.jsx'), 'utf8');
  const crudos = app.match(/stats\??\.\[[^\]]*hero\.name\]/g) ?? [];
  const sinNormalizar = crudos.filter((x) => !x.includes('normName'));
  ok(!sinNormalizar.length, `sin normalizar: ${sinNormalizar.join(', ')}`);
});

test('el rol y la línea se leen aunque vengan hondos en la respuesta', async () => {
  // Forma REAL de la API: el titulo de la linea vive en el nivel 8. El limite de
  // profundidad estaba en 6, asi que los 133 heroes salian sin rol y sin linea
  // sin que nada fallara: los que no estan en el catalogo se quedaban con CERO
  // tags, y la deteccion del roamer enemigo perdia su senal principal.
  const { extraerLineas, extraerRol } = await import('./ingest.mjs');
  const fila = {
    data: {
      hero: {
        data: {
          name: 'Marcel',
          roadsort: [{ data: { road_sort_title: 'Roam', road_sort_icon: 'https://x/y.svg' } }, ''],
          sortid: [{ data: { sort_title: 'support' } }, ''],
        },
      },
    },
  };
  ok(extraerLineas(fila).includes('roam'), `no encuentra la linea: [${extraerLineas(fila)}]`);
  ok(extraerRol(fila) === 'support', `no encuentra el rol: "${extraerRol(fila)}"`);

  // Y no se inventa nada donde no lo hay.
  ok(extraerRol({ data: { hero: { data: { name: 'Gold Lane Guy' } } } }) === '',
    'saca un rol de donde no hay');
});

test('el diagnóstico de la ingesta no lee campos sin inicializar', () => {
  // Esto estuvo publicado: se leia diagnostics.relations.ejemplos.length sin
  // que 'ejemplos' existiera, y saltaba un TypeError por cada roamer al que SI
  // le llegaban los counters. La prueba de humo no lo veia porque corre contra
  // una base inalcanzable, donde ese camino nunca se ejecuta.
  const ing = readFileSync(resolve(ROOT, 'scripts/ingest.mjs'), 'utf8');
  const literal = ing.match(/diagnostics\.relations\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '';
  const inicializados = new Set([...literal.matchAll(/(\w+)\s*:/g)].map((m) => m[1]));

  const leidos = [...ing.matchAll(/diagnostics\.relations\.(\w+)/g)].map((m) => m[1]);
  const asignados = new Set([...ing.matchAll(/diagnostics\.relations\.(\w+)\s*=/g)].map((m) => m[1]));

  const sinInicializar = [...new Set(leidos)]
    .filter((k) => !inicializados.has(k) && !asignados.has(k));
  ok(!sinInicializar.length,
    `campos leidos sin inicializar en diagnostics.relations: ${sinInicializar.join(', ')}`);
});

test('el registro de partidas cuenta lo que hace falta para decidir', async () => {
  const { apuntar, resumen, siguioConsejo, maestriaDesdeRegistro, MINIMO_PARA_CONCLUIR } =
    await import('../src/engine/registro.js');

  // Una partida sin héroe no se guarda: seria una fila inutil para siempre.
  ok(apuntar([], { gane: true }).length === 0, 'guarda una partida sin pick');

  const p = apuntar([], { pick: 'Khufra', recomendados: ['Khufra', 'Atlas', 'Franco'], gane: true });
  ok(p.length === 1 && siguioConsejo(p[0]), 'no detecta que seguiste la recomendación');
  ok(!siguioConsejo({ pick: 'Estes', recomendados: ['Khufra'] }), 'dice que seguiste el consejo y no fue así');

  // La mas reciente va primero.
  const dos = apuntar(p, { pick: 'Atlas', recomendados: [], gane: false });
  ok(dos[0].pick === 'Atlas', 'la última partida debería ir la primera');

  // No crece sin limite.
  let muchas = [];
  for (let i = 0; i < 20; i++) muchas = apuntar(muchas, { pick: 'Khufra', gane: true }, 10);
  ok(muchas.length === 10, `el registro debería recortarse: ${muchas.length}`);

  // No concluye con muestra escasa, ni aunque una rama vaya sobrada: comparar
  // 40 partidas contra 3 es justo lo que invita a tocar los pesos de mas.
  const sesgado = [];
  for (let i = 0; i < 40; i++) sesgado.push({ pick: 'Khufra', recomendados: ['Khufra'], gane: i % 2 === 0 });
  for (let i = 0; i < 3; i++) sesgado.push({ pick: 'Estes', recomendados: ['Khufra'], gane: true });
  const r = resumen(sesgado);
  ok(!r.concluyente, 'concluye con 3 partidas por libre');
  ok(r.faltan === MINIMO_PARA_CONCLUIR - 3, `mal el conteo de las que faltan: ${r.faltan}`);
  ok(Math.abs(r.wrSiguiendo - 0.5) < 0.01, `winrate siguiendo mal: ${r.wrSiguiendo}`);

  // Con muestra en las dos ramas si concluye.
  const equilibrado = [];
  for (let i = 0; i < 30; i++) equilibrado.push({ pick: 'Khufra', recomendados: ['Khufra'], gane: true });
  for (let i = 0; i < 30; i++) equilibrado.push({ pick: 'Estes', recomendados: ['Khufra'], gane: false });
  ok(resumen(equilibrado).concluyente, 'con 30 y 30 debería concluir');

  // Sin partidas no se inventa un winrate.
  ok(resumen([]).wrSiguiendo === null, 'se inventa un winrate sin partidas');

  // Y de aqui sale maestria real, no tecleada.
  const m = maestriaDesdeRegistro([
    { pick: 'Khufra', gane: true }, { pick: 'Khufra', gane: false }, { pick: 'Atlas', gane: true },
  ]);
  ok(m.Khufra.games === 2 && Math.abs(m.Khufra.winRate - 0.5) < 0.01, `maestría mal: ${JSON.stringify(m)}`);
});

test('la matriz de counters se indexa en sus DOS niveles', () => {
  // Este fallo estuvo publicado: App.jsx indexaba con profundidad 1, el segundo
  // nivel se quedaba crudo ("Wanwan") y todo lo que lo buscaba normalizado
  // fallaba en silencio.
  const crudo = { 'X.Borg': { Wanwan: 0.44 } };
  ok(indexByName(crudo)[normName('X Borg')]?.[normName('Wanwan')] === undefined,
    'con profundidad 1 el segundo nivel NO queda normalizado');
  ok(indexByName(crudo, 2)[normName('X Borg')]?.[normName('Wanwan')] === 0.44,
    'con profundidad 2 debe encontrarse por clave normalizada');
});

test('la app indexa las matrices con los dos niveles', () => {
  const app = readFileSync(resolve(ROOT, 'src/App.jsx'), 'utf8');
  for (const m of ['counters', 'synergies']) {
    const linea = app.match(new RegExp(`${m}: indexByName\\([^)]*\\)`))?.[0] ?? '';
    ok(/,\s*2\s*\)/.test(linea), `${m} debe indexarse con profundidad 2, no con ${linea}`);
  }
});

test('el riesgo de contrapick y la densidad leen la matriz con nombres crudos', () => {
  // Con acceso crudo (fila[normName(x)]) contra un segundo nivel sin normalizar
  // no acertaban ni un matchup: riesgoContrapick devolvia null para los 34
  // roamers y el diagnostico anunciaba 0% de cobertura. Ambos deben usar lookup.
  const rivales = pool.slice(0, 12);
  const fila = Object.fromEntries(rivales.map((x, i) => [x.name, 0.40 + i * 0.01]));
  const matriz = indexByName({ [pool[0].name]: fila }); // a proposito: solo nivel 1

  ok(riesgoContrapick(pool[0], matriz, rivales) != null,
    'riesgoContrapick devuelve null: no encuentra los matchups');
  ok(densidadCounters([pool[0]], matriz, rivales).cobertura > 0,
    'densidadCounters da 0%: no encuentra los matchups');
});

test('la speciality de Moonton suma tags al rol, sin contradecirlo', async () => {
  const { SPECIALITY_TAGS, ROLE_VETO, ROLE_DEFAULTS } = await import('../src/engine/rules.js');

  // Suma: un support con "Crowd Control" gana control duro sobre sus tags base.
  const marcel = tagsDeducidos('support', ['Crowd Control']);
  for (const t of ROLE_DEFAULTS.support) ok(marcel.includes(t), `pierde el tag de rol ${t}`);
  ok(marcel.includes('cc_hard'), 'no recoge el control duro de "Crowd Control"');

  // Veto: la MISMA speciality no puede hacer tanque a una maga. Es correlacion
  // del catalogo (casi todo "Crowd Control" es tanque), no una propiedad suya,
  // y una maga marcada de primera linea enganaria a la composicion.
  const zetian = tagsDeducidos('mage', ['Crowd Control']);
  ok(!zetian.includes('tanky'), `una maga no puede salir tanky: ${zetian.join(', ')}`);

  // Sin speciality se comporta como siempre.
  const a = tagsDeducidos('marksman', []);
  ok(a.join() === (ROLE_DEFAULTS.marksman ?? []).join(), 'sin speciality debe dar los tags del rol');

  // Las tablas solo hablan de tags que el motor conoce.
  const conocidos = new Set(Object.values(ROLE_DEFAULTS).flat()
    .concat(cat.heroes.flatMap((h) => h.tags)));
  const inventados = [...new Set(Object.values(SPECIALITY_TAGS).flat())]
    .filter((x) => !conocidos.has(x));
  ok(!inventados.length, `SPECIALITY_TAGS usa tags que no existen: ${inventados.join(', ')}`);
  const vetoRaro = [...new Set(Object.values(ROLE_VETO).flat())].filter((x) => !conocidos.has(x));
  ok(!vetoRaro.length, `ROLE_VETO usa tags que no existen: ${vetoRaro.join(', ')}`);
});

test('lo que sale de tags deducidos pesa menos que lo escrito a mano', () => {
  // Estuvo a punto de colarse: al deducir los tags de Marcel desde su
  // speciality salia con seis, disparaba mas reglas que nadie y era el nº1 en
  // el 69% de 300 drafts, contra el 43% del lider anterior. Es el mismo sesgo
  // por acumular etiquetas que ya costo una correccion con Carmilla.
  //
  // Se comprueban los DOS descuentos por separado: quitar solo uno dejaba la
  // prueba en verde y el sesgo a medio arreglar.
  const tags = ['peel', 'sustain', 'engage', 'tanky', 'zone', 'cc_hard'];
  const aMano = { name: 'AMano', role: 'support', tags, roam: true };
  const deducido = { ...aMano, name: 'Deducido', inferred: true };
  const enemigo = h('Fanny');

  // 1) reglas por tags (counter), sin matriz: todo el valor sale de los tags
  const cMano = counterScore(aMano, [enemigo], null).value;
  const cDed = counterScore(deducido, [enemigo], null).value;
  ok(cDed < cMano, `el counter por tags no se descuenta: ${cDed} vs ${cMano}`);

  // 2) composicion
  const aliados = [h('Granger'), h('Cecilion'), h('Ling')].filter(Boolean);
  const pMano = compScore(aMano, aliados).value;
  const pDed = compScore(deducido, aliados).value;
  ok(pDed < pMano, `la composición no se descuenta: ${pDed} vs ${pMano}`);

  // 3) y el efecto neto: baja en el ranking
  const pool = [...cat.heroes.filter((x) => x.roam), deducido];
  const conDescuento = rankRoamers(pool, { enemies: [enemigo], meta: {} })
    .findIndex((x) => x.hero.name === 'Deducido');
  const sinDescuento = rankRoamers(pool.map((x) => (x.name === 'Deducido' ? { ...x, inferred: false } : x)),
    { enemies: [enemigo], meta: {} }).findIndex((x) => x.hero.name === 'Deducido');
  ok(conDescuento > sinDescuento,
    `deducido debería quedar por detrás (puesto ${conDescuento + 1} vs ${sinDescuento + 1})`);
});

test('un héroe con speciality entra al catálogo con ella aplicada', () => {
  const merged = mergeCatalog(cat.heroes, [
    { name: 'RoamerNuevo', role: 'support', speciality: ['Crowd Control', 'Regen'] },
  ]);
  const h = merged.find((x) => x.name === 'RoamerNuevo');
  ok(h?.roam, 'un support debe entrar al pool de roam');
  ok(h.tags.includes('cc_hard') && h.tags.includes('heal'),
    `no aplica la speciality: ${h.tags.join(', ')}`);
  ok(h.inferred, 'debe quedar marcado como deducido');
});

test('un héroe nuevo de la API entra con los tags de su rol', () => {
  const merged = mergeCatalog(cat.heroes, [{ name: 'HeroeNuevo', role: 'tank' }]);
  const nuevo = merged.find((x) => x.name === 'HeroeNuevo');
  ok(nuevo?.roam && nuevo.tags.length, 'no hereda tags de tanque ni entra al pool de roam');
});

test('un pick volátil se penaliza a ciegas pero no con el draft completo', () => {
  // Idea tomada de las herramientas de draft de LoL: como roam eliges pronto, y
  // el mejor pick sobre el papel no es el mejor si te lo pueden castigar luego.
  const counters = {};
  for (const rh of pool) {
    counters[rh.name] = {};
    const volatil = rh.name === 'Chou';
    for (const e of all) counters[rh.name][e.name] = volatil
      ? (all.indexOf(e) % 5 === 0 ? 0.40 : 0.56)   // muchos matchups pésimos
      : 0.50;
  }
  const meta = { counters: indexByName(counters, 2), patchAvgWinRate: 0.5 };
  const puesto = (r) => r.findIndex((x) => x.hero.name === 'Chou');

  const ciego = puesto(rankRoamers(pool, { meta, candidatos: all }));
  const completo = puesto(rankRoamers(pool, {
    enemies: ['Fanny', 'Ling', 'Melissa', 'Xavier', 'Esmeralda'].map(h),
    meta,
    candidatos: all,
  }));
  ok(completo < ciego, `volátil: puesto ${ciego} a ciegas y ${completo} con todo visto`);
});

test('los motivos que le salen a todo el pool no se muestran', () => {
  // "no hay primera línea" es cierto para los 34 roamers: la primera línea la
  // pone el propio roamer. Ocupaba las tres etiquetas de cada tarjeta.
  const res = rankRoamers(pool, {
    enemies: ['Melissa', 'Argus', 'Saber'].map(h),
    allies: ['Cecilion', 'Granger'].map(h),
    meta: { patchAvgWinRate: 0.5 },
  });

  const cuenta = new Map();
  for (const r of res) {
    // idRazon y no .text: desde que la app habla dos idiomas, los motivos
    // viajan como clave más parámetros y su identidad se arma con las dos.
    for (const t of new Set(r.reasons.map(idRazon))) {
      cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
    }
  }
  const ubicuos = [...cuenta.entries()].filter(([, n]) => n > res.length * 0.6);
  ok(!ubicuos.length, `motivos que le salen a casi todos: ${ubicuos.map(([t]) => t).join(', ')}`);
});

test('el id del héroe no se confunde con el id del canal', async () => {
  const { idPrincipal, esIdDeHeroe } = await import('./parse-relations.mjs');

  // Caso real: main_hero_channel.id vale 2678829 y aparece ANTES que
  // main_heroid en la respuesta. La API rechazaba con 422 diciendo que el
  // identificador debe ser <= 133, y se perdían los 34 counters.
  const registro = {
    _id: 'x',
    data: {
      main_hero: { data: { name: 'Atlas' } },
      main_hero_channel: { id: 2678829 },
      main_heroid: 93,
      sub_hero: [{ hero_channel: { id: 2678756 }, heroid: 20, increase_win_rate: 0.041 }],
    },
  };

  ok(idPrincipal(registro) === 93, `esperaba 93, salió ${idPrincipal(registro)}`);
  ok(idPrincipal({ name: 'Atlas', hero_id: 93 }) === 93, 'falla con el formato plano');
  ok(idPrincipal({ data: { main_hero_channel: { id: 2678829 } } }) === null,
    'acepta un id de canal como si fuera de héroe');
  ok(!esIdDeHeroe(2678829) && esIdDeHeroe(93), 'el rango válido de ids está mal');
});

test('un 422 se reintenta con menos parámetros en vez de perderlo todo', async () => {
  const { createServer } = await import('node:http');
  const { callRoute } = await import('./ingest.mjs');

  const peticiones = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    peticiones.push(u.search);
    res.setHeader('content-type', 'application/json');
    // Imita a la API real: rechaza el parámetro days con error de validación.
    if (u.searchParams.has('days')) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ code: 'VALIDATION_ERROR', details: [{ loc: ['query', 'days'] }] }));
    }
    return res.end(JSON.stringify({ code: 0, data: { records: [{ data: { main_heroid: 93 } }] } }));
  });
  await new Promise((r) => srv.listen(8815, r));

  try {
    const ruta = {
      template: 'http://127.0.0.1:8815/api/heroes/{hero_identifier}/counters',
      method: 'GET', params: ['rank', 'days'],
    };
    const { data } = await callRoute(ruta, { rank: 'glory', days: 7 }, 'Atlas');
    ok(peticiones.length === 2, `esperaba 2 intentos, hubo ${peticiones.length}`);
    ok(data?.data?.records?.length, 'no recupera los datos tras el 422');
  } finally {
    srv.close();
  }
});

test('la ingesta arranca sin errores de programación', async () => {
  // Comprobar solo la sintaxis no basta: un `ROUTES is not defined` pasaba
  // node --check y reventaba en la primera línea, dejando los datos congelados
  // en silencio porque el workflow lleva continue-on-error.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, copyFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  // A un temporal, nunca a public/data. Esta corrida falla a proposito y su
  // salida es peor que los datos buenos: mismos numeros, pero un diagnostico
  // que dice que solo se resolvio un rango. Escribiendo en su sitio ensuciaba
  // el repo en cada npm test y, como en el workflow las pruebas van antes de
  // compilar, ese diagnostico degradado era el que acababa publicado.
  // Se copia el fichero real para que la ingesta encuentre su "previous" y la
  // prueba recorra el mismo camino que una corrida de verdad.
  const dir = mkdtempSync(resolve(tmpdir(), 'ingesta-'));
  const out = resolve(dir, 'roam-meta.json');
  const real = resolve(ROOT, 'public/data/roam-meta.json');
  if (existsSync(real)) copyFileSync(real, out);

  try {
    const salida = execFileSync('node', [
      resolve(ROOT, 'scripts/ingest.mjs'), '--base', 'http://127.0.0.1:1/api',
      '--ranks', 'mythic', '--out', out,
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });

    ok(!/is not defined|is not a function|Cannot read/.test(salida),
      `error de programación en la ingesta: ${salida.split('\n').find((l) => /is not/.test(l))}`);
    ok(salida.includes('Escrito'), 'no llega a escribir el fichero cuando la red falla');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('se leen los counters con la forma real que devuelve la API', async () => {
  const { recogerPares, relationMap, pick } = await import('./parse-relations.mjs');

  // Respuesta REAL capturada con el diagnóstico en el móvil. Los rivales vienen
  // identificados solo por heroid, sin nombre: solo traen la URL de su icono.
  const real = {
    code: 0, message: 'OK',
    data: { records: [{
      _createdAt: 1724837698334, _id: '66ceef43af5771f18c501376', _updatedAt: 1788014700432,
      data: {
        bigrank: '7', camp_type: '0',
        main_hero: { data: { head: 'https://x/a.png', name: 'Atlas' } },
        main_hero_appearance_rate: 0.008016, main_hero_ban_rate: 0.140859,
        main_hero_win_rate: 0.538425, main_heroid: 93,
        sub_hero: [
          { hero: { data: { head: 'https://x/b.png' } }, hero_win_rate: 0.55588,
            heroid: 20, increase_win_rate: 0.041158, min_win_rate10_12: 0.543624 },
          { hero: { data: { head: 'https://x/c.png' } }, hero_win_rate: 0.47,
            heroid: 17, increase_win_rate: -0.028 },
        ],
      },
    }] },
  };

  ok(pick(real, ['main_heroid']) === 93, 'no encuentra el id del héroe principal');

  const mapa = relationMap(recogerPares(real), new Map([[20, 'Franco'], [17, 'Fanny']]));
  ok(Math.abs(mapa.Franco - 0.541158) < 1e-6, `Franco mal leído: ${mapa.Franco}`);
  ok(Math.abs(mapa.Fanny - 0.472) < 1e-6, `Fanny mal leída: ${mapa.Fanny}`);
  ok(mapa.Franco > mapa.Fanny, 'el signo del delta está invertido');

  // Sin el mapa de ids no hay forma de nombrar a los rivales: debe quedar vacío
  // en vez de inventarse nombres.
  ok(!Object.keys(relationMap(recogerPares(real), new Map())).length,
    'nombra rivales sin tener su id');
});

test('el autodiagnóstico detecta datos rotos y aprueba los buenos', async () => {
  const { runSelfTest } = await import('../src/engine/selftest.js');
  const env = { version: 'test', rango: 'mythic', width: 412, height: 915, storage: true };
  const stats = Object.fromEntries(all.map((x) => [x.name, { winRate: 0.497 + (rnd() - 0.5) * 0.06, pickRate: 0.02 }]));
  const base = { catalog: cat, allHeroes: all, roamPool: pool, mastery: {}, env };

  const bueno = runSelfTest({
    ...base,
    meta: { generatedAt: new Date().toISOString(), ranks: ['mythic'], days: 7, heroCount: 133, stats, statsByRank: { mythic: stats }, diagnostics: {} },
    metaCtx: { stats: indexByName(stats), counters: undefined, patchAvgWinRate: 0.497 },
  });
  // Sin counters siempre hay un fallo; lo que no puede haber son fallos de motor.
  ok(!bueno.texto.includes('[FALLO] Winrate NO influye'), 'marca el winrate como plano teniéndolo');
  ok(!bueno.texto.includes('[FALLO] Contra dashes'), 'falla la sensatez táctica con datos buenos');

  const roto = runSelfTest({
    ...base,
    meta: { generatedAt: new Date(0).toISOString(), ranks: [], days: 7, heroCount: 0, stats: {}, statsByRank: {}, diagnostics: {} },
    metaCtx: { stats: {}, counters: undefined, patchAvgWinRate: 0.5 },
  });
  ok(roto.fallos > bueno.fallos, 'no distingue unos datos rotos de unos buenos');
  ok(roto.texto.includes('Winrate NO influye'), 'no detecta que los winrates no entran');
});

await Promise.all(pendientes); // se esperan de verdad, sin plazos inventados

console.log(`\n${pasadas} pruebas correctas, ${fallos} fallos.`);
process.exit(fallos ? 1 : 0);
