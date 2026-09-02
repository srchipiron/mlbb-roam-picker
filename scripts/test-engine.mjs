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
  riesgoContrapick, densidadCounters, tagsDeducidos, idRazon, matchup,
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
const eq = (a, b, msg) => ok(a === b, msg ?? `esperaba ${JSON.stringify(b)} y salio ${JSON.stringify(a)}`);
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

test('el rival se deduce por eliminacion, y acierta lo que se midio', async () => {
  const { detectarRivalDeLinea, indiceDeLineas, frecuenciaDeRoles } =
    await import('../src/engine/rival-de-linea.js');
  const { poolDeLinea, LINEAS } = await import('../src/engine/score.js');

  // 1. Eliminacion: cuatro enemigos claros en otras lineas y uno ambiguo entre
  //    exp y jungla. Mirandolo solo es ambiguo; mirando el draft entero, si la
  //    jungla ya esta cogida, va a la exp. Es como lo lee cualquiera.
  const listado = [
    { name: 'Angela', role: 'support', lane: 'roam' },
    { name: 'Kagura', role: 'mage', lane: 'mid' },
    { name: 'Claude', role: 'marksman', lane: 'gold' },
    { name: 'Saber', role: 'assassin', lane: 'jungle' },
    { name: 'YuZhong', role: 'fighter', lane: 'exp,jungle' },
    { name: 'Argus', role: 'fighter', lane: 'exp' },
  ];
  const info = indiceDeLineas(listado);
  const frec = frecuenciaDeRoles(listado.map((x) => ({ ...x, lanes: x.lane.split(',') })));
  const draft = ['Angela', 'Kagura', 'Claude', 'Saber', 'YuZhong'].map((n) => ({ name: n }));
  eq(detectarRivalDeLinea(draft, info, 'exp', frec), 'YuZhong',
    'con la jungla ya cogida, el que juega exp o jungla tiene que ir a la exp');
  eq(detectarRivalDeLinea(draft, info, 'jungle', frec), 'Saber', 'y la jungla es del jungla claro');

  // 2. Con solo el ambiguo y nadie mas, sigue sin mojarse entre sus dos lineas.
  ok(detectarRivalDeLinea([{ name: 'YuZhong' }], info, 'exp', frec) === null
    || detectarRivalDeLinea([{ name: 'YuZhong' }], info, 'jungle', frec) === null,
  'nombra al mismo heroe como rival de DOS lineas a la vez');

  // 3. Precision medida sobre los datos reales, no sobre un fixture: drafts con
  //    un enemigo por linea (verdad conocida). Los suelos salen de la medicion
  //    del cambio (exp 60%->88%, jungla 69%->91%) con holgura, y el techo de
  //    errores tambien. Si un cambio futuro vuelve a mirar a cada enemigo por
  //    separado, esto lo nota.
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  if (!(meta.heroes ?? []).length) return;
  const todos = mergeCatalog(cat.heroes, meta.heroes);
  const idx = indiceDeLineas(meta.heroes);
  const fr = frecuenciaDeRoles(meta.heroes);
  const pools = Object.fromEntries(LINEAS.map((l) => [l, poolDeLinea(todos, idx, l)]));
  if (LINEAS.some((l) => pools[l].length < 10)) return;

  let semilla = 13;
  const r = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  // Draft completo (5 enemigos) y draft a medias (3): el segundo es donde
  // nombrar a alguien que aun no ha salido cuesta caro, y donde mas se nota el
  // peso del rol (0.30: 2,7% de errores; 0.10: 0,0%).
  const cuenta = {};
  for (const cuantos of [5, 3]) {
    let bien = 0; let mal = 0; let n = 0;
    for (let d = 0; d < 600; d++) {
      const usados = new Set();
      const draftReal = {};
      for (const l of LINEAS) {
        let h;
        do h = pools[l][Math.floor(r() * pools[l].length)]; while (usados.has(h.name));
        usados.add(h.name);
        draftReal[l] = h;
      }
      const orden = [...LINEAS].sort(() => r() - 0.5).slice(0, cuantos);
      const enemigos = orden.map((l) => draftReal[l]);
      for (const l of LINEAS) {
        const real = orden.includes(l) ? draftReal[l].name : null;
        const dicho = detectarRivalDeLinea(enemigos, idx, l, fr);
        n++;
        if (dicho == null) { if (!real) bien++; } else if (dicho === real) bien++; else mal++;
      }
    }
    cuenta[cuantos] = { bien: bien / n, mal: mal / n };
  }
  // Suelos y techos con holgura sobre lo medido (5en: 93,5% / 0,0%; 3en:
  // 85,8% / 0,0%), pero lo bastante apretados para cazar tanto el metodo
  // enemigo a enemigo (60% en exp, 5% de error) como un peso del rol de 0.30
  // (2,7% de error a medias).
  ok(cuenta[5].bien >= 0.88, `draft completo: acierta solo el ${(cuenta[5].bien * 100).toFixed(1)}%`);
  ok(cuenta[5].mal <= 0.01, `draft completo: nombra al rival equivocado el ${(cuenta[5].mal * 100).toFixed(1)}%`);
  ok(cuenta[3].bien >= 0.80, `draft a medias: acierta solo el ${(cuenta[3].bien * 100).toFixed(1)}%`);
  ok(cuenta[3].mal <= 0.012, `draft a medias: nombra a un rival equivocado el ${(cuenta[3].mal * 100).toFixed(1)}%`);
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
  // Esta prueba EXIGIA que contra tres asesinos de dash el nº1 cortara dashes.
  // Se cambio en 1.5.0 y conviene saber por que, para no "arreglarla" de vuelta.
  //
  // Con la matriz de counters completa (17.556 cruces reales en vez de 1.330)
  // se puede medir la regla: los heroes con `anti_mobility` promedian 0.5042
  // contra los que tienen `dash`, y los demas 0.4999. Cuatro decimas de punto.
  // La regla es la MEJOR de las doce escritas a mano -las otras once no se ven
  // siquiera-, y aun asi no basta para mandar sobre el resto del motor.
  //
  // Aquella exigencia solo se cumplia porque el dato era escaso: sin winrate de
  // la pareja mandaban las reglas por tags, asi que la sensatez tactica se
  // apoyaba en un agujero, no en una decision. Ahora hay dato para todo.
  //
  // Lo que SI tiene que cumplirse, y es mas fuerte:
  //   1. cambiar el equipo enemigo cambia la recomendacion,
  //   2. el componente de counter ordena el pool igual que el dato real.
  const porNombre = (nombre) => {
    let x = 2166136261 ^ 31;
    for (const ch of nombre) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return ((x >>> 0) % 100000) / 100000;
  };
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.497 + (porNombre(x.name) - 0.5) * 0.05, matches: 5000, pickRate: 0.02 }])));
  const counters = indexByName(Object.fromEntries(all.map((a) => [a.name,
    Object.fromEntries(all.filter((b) => b.name !== a.name)
      .map((b) => [b.name, 0.5 + (porNombre(`${a.name}|${b.name}`) - 0.5) * 0.12]))])), 2);
  const meta = { stats, counters, patchAvgWinRate: 0.497 };

  const ranking = (nombres) => rankRoamers(pool, { enemies: nombres.map(h), meta });

  const unos = ranking(['Fanny', 'Ling', 'Lancelot']);
  const otros = ranking(['Esmeralda', 'Uranus', 'Thamuz']);
  ok(unos[0].hero.name !== otros[0].hero.name,
    'la recomendación no cambia entre dos composiciones enemigas opuestas');

  // Y que el counter ordene por el dato: quien mejor cruce tiene contra esos
  // tres tiene que puntuar mas alto en counter que quien peor lo tiene. Sin
  // esto, el componente podria estar leyendo cualquier cosa y nadie se
  // enteraria mientras el ranking siguiera moviendose.
  const enemigos = ['Fanny', 'Ling', 'Lancelot'].map(h);
  const cruceMedio = (nombre) => {
    const v = enemigos.map((e) => matchup(counters, nombre, e.name)).filter((x) => x != null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const porCounter = [...unos].sort((a, b) => b.parts.counter.value - a.parts.counter.value);
  ok(cruceMedio(porCounter[0].hero.name) > cruceMedio(porCounter[porCounter.length - 1].hero.name),
    'el componente de counter no ordena el pool como el dato real de los cruces');
});

test('las reglas por tags siguen mandando donde NO hay dato', () => {
  // Ahora que la matriz viene completa, las reglas escritas a mano no deciden
  // casi nunca. Su trabajo es otro: sostener a un heroe recien salido, del que
  // la API todavia no publica ni un cruce. Si eso se rompe, un heroe nuevo se
  // quedaria sin ninguna lectura tactica y nadie lo notaria.
  const porNombre = (nombre) => {
    let x = 2166136261 ^ 31;
    for (const ch of nombre) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return ((x >>> 0) % 100000) / 100000;
  };
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.497 + (porNombre(x.name) - 0.5) * 0.05, matches: 5000 }])));
  const meta = { stats, counters: undefined, patchAvgWinRate: 0.497 };
  const top3 = (nombres) =>
    rankRoamers(pool, { enemies: nombres.map(h), meta }).slice(0, 3).map((x) => x.hero.name);

  const vsDashes = top3(['Fanny', 'Ling', 'Lancelot']);
  const vsCuracion = top3(['Esmeralda', 'Uranus', 'Thamuz']);
  ok(h(vsDashes[0]).tags.includes('anti_mobility'),
    `sin datos, contra tres asesinos móviles el nº1 debería frenar dashes: ${vsDashes.join(', ')}`);
  ok(h(vsCuracion[0]).tags.includes('antiheal'),
    `sin datos, contra tres héroes de curación el nº1 debería cortar curación: ${vsCuracion.join(', ')}`);
  ok(vsDashes[0] !== vsCuracion[0],
    'sin datos, la recomendación no cambia entre dos composiciones enemigas opuestas');
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

test('una corrida de ingesta degradada no llega a los datos guardados', async () => {
  // Esto llego a produccion: el bot de datos commiteo una corrida con los 133
  // heroes SIN linea y SIN rol, y con counters de 34 en vez de 133. Cuatro de
  // las cinco lineas se quedaban sin pool. El diff parecia normal porque la
  // ingesta conserva los datos anteriores cuando un endpoint falla: solo
  // cambiaba generatedAt.
  const { comparar, medir } = await import('./comparar-ingesta.mjs');

  const heroe = (n, lanes) => ({ name: n, role: 'tank', lanes, damage: { fisico: 3, magico: 0 } });
  const buena = {
    heroes: Array.from({ length: 10 }, (_, i) => heroe(`H${i}`, ['roam'])),
    stats: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i}`, {}])),
    counters: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i}`,
      Object.fromEntries(Array.from({ length: 9 }, (_, j) => [`H${j}`, 0.5]))])),
    synergies: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i}`,
      Object.fromEntries(Array.from({ length: 9 }, (_, j) => [`H${j}`, 0.5]))])),
  };

  ok(comparar(buena, buena).peores.length === 0, 'marca como peor una corrida identica');

  const sinLineas = { ...buena, heroes: buena.heroes.map((h) => ({ ...h, lanes: [] })) };
  ok(comparar(sinLineas, buena).peores.some((p) => p.clave === 'conLinea'),
    'no detecta que la corrida nueva se ha quedado sin lineas');

  const sinRol = { ...buena, heroes: buena.heroes.map(({ role, ...h }) => h) };
  ok(comparar(sinRol, buena).peores.some((p) => p.clave === 'conRol'),
    'no detecta que la corrida nueva se ha quedado sin roles');

  const sinDano = { ...buena, heroes: buena.heroes.map(({ damage, ...h }) => h) };
  ok(comparar(sinDano, buena).peores.some((p) => p.clave === 'conDano'),
    'no detecta que la corrida nueva se ha quedado sin tipo de dano');

  const menosCounters = { ...buena, counters: { H0: {}, H1: {} } };
  ok(comparar(menosCounters, buena).peores.some((p) => p.clave === 'counters'),
    'no detecta que la corrida nueva trae muchos menos counters');

  // Y el caso mas traicionero: los 10 heroes siguen teniendo fila, pero con
  // dos cruces en vez de nueve. En el recuento de filas no cambia nada.
  const filasFlacas = { ...buena,
    counters: Object.fromEntries(Object.entries(buena.counters)
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).slice(0, 2))])) };
  ok(comparar(filasFlacas, buena).peores.some((p) => p.clave === 'cruces'),
    'no detecta que las filas vienen casi vacias, con los mismos heroes');

  // El margen esta para que el ruido normal de la API no pare el despliegue:
  // que un heroe no devuelva counters un dia no es una regresion.
  const unoMenos = { ...buena, counters: Object.fromEntries(Object.entries(buena.counters).slice(0, 9)) };
  ok(comparar(unoMenos, buena).peores.length === 0, 'un heroe de menos no puede parar el despliegue');

  // Y la primera vez no hay con que comparar: no puede bloquear.
  ok(medir({}).heroes === 0, 'medir() no aguanta un JSON vacio');
});

test('los workflows que publican datos pasan por el guardarrail', () => {
  // Si alguien vuelve a poner la ingesta escribiendo directa sobre
  // public/data, el guardarrail deja de mirar y volvemos al fallo de arriba.
  // Los TRES que ejecutan la ingesta. mantenimiento.yml se quedo fuera de esta
  // lista y escribia directa sobre public/data sin comparar: no lo commiteaba,
  // pero derivaba las tablas y pasaba npm test sobre lo que saliera.
  for (const f of ['deploy.yml', 'update-data.yml', 'mantenimiento.yml']) {
    const yml = readFileSync(resolve(ROOT, '.github/workflows', f), 'utf8');
    const ingesta = yml.split('\n').filter((l) => l.includes('scripts/ingest.mjs'));
    ok(ingesta.length > 0, `${f}: ya no ejecuta la ingesta`);
    for (const l of ingesta) {
      ok(l.includes('--out'), `${f}: la ingesta escribe directa sobre los datos buenos`);
    }
    ok(yml.includes('scripts/comparar-ingesta.mjs'), `${f}: no compara la corrida con la guardada`);
  }

  // El despliegue puede seguir adelante con los datos del repositorio si la API
  // esta caida -si no, un UPSTREAM_REQUEST_FAILED impide publicar cualquier
  // cambio de codigo-, pero NO puede publicar datos rancios sin darse cuenta.
  const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  ok(/h > \d+\)/.test(deploy), 'deploy.yml ya no comprueba la antiguedad de los datos');
  ok(/cruces < \d+/.test(deploy), 'deploy.yml ya no comprueba que haya matriz de counters');

  // El despliegue NO vuelve a descargar si el repositorio tiene datos
  // recientes: el bot ya lo hace dos veces al dia. Sin esto cada push de
  // codigo costaba diez minutos y, con cancel-in-progress, cada push
  // reiniciaba la descarga del anterior: cinco commits seguidos dejaron la app
  // 25 minutos por detras. Y el umbral de "reciente" tiene que quedar por
  // debajo del de "rancio" (72 h), o se publicaria sin descargar algo que
  // luego el propio despliegue rechaza.
  const pasoIngesta = deploy.slice(deploy.indexOf('name: Ingesta'), deploy.indexOf('scripts/ingest.mjs'));
  ok(/if:\s*steps\.frescura\.outputs\.fresca/.test(pasoIngesta),
    'deploy.yml descarga datos en cada push aunque el repositorio los tenga recientes');
  const umbral = deploy.match(/fresca=.*?\(h < (\d+)\)/)?.[1];
  ok(umbral, 'no se ve el umbral de frescura');
  ok(Number(umbral) < 72, `frescura ${umbral} h no es menor que el limite de rancio (72 h)`);
  ok(/outcome }}"? = "skipped"/.test(deploy),
    'el paso de elegir datos no distingue "ingesta omitida" de "ingesta fallida": avisaria de un fallo que no existe');

  // Y con tope de tiempo en la ingesta. "Fallar" lo cubre continue-on-error,
  // "colgarse" no: ~570 peticiones con 15 s de timeout son 140 minutos con la
  // API a medias, y el despliegue se quedaba ahi sabiendo publicar con los
  // datos del repositorio. Se vio en directo: una ingesta llevaba 20 minutos
  // en un paso que normalmente tarda 9.
  for (const f of ['deploy.yml', 'update-data.yml', 'mantenimiento.yml']) {
    const yml = readFileSync(resolve(ROOT, `.github/workflows/${f}`), 'utf8');
    const paso = yml.slice(yml.indexOf('name: Ingesta'), yml.indexOf('scripts/ingest.mjs'));
    const m = paso.match(/timeout-minutes:\s*(\d+)/);
    ok(m, `${f}: la ingesta no tiene timeout-minutes y puede colgar el workflow dos horas`);
    if (m) ok(Number(m[1]) >= 15 && Number(m[1]) <= 40,
      `${f}: timeout de ${m[1]} min; lo normal son 9-10 y hace falta margen sin dejar que se cuelgue`);
  }
});

test('el tipo de dano sale del texto de Moonton, no del rol', async () => {
  const { tipoDeDano, perfilDeDano, tapaElHueco } = await import('../src/engine/score.js');

  // Los dos casos que el rol se comeria, comprobados contra la API real:
  // Gusion es asesino y pega magico; Hylos es tanque y pega magico.
  eq(tipoDeDano({ name: 'Gusion', role: 'assassin', damage: { fisico: 0, magico: 5 } }), 'magico');
  eq(tipoDeDano({ name: 'Hylos', role: 'tank', damage: { fisico: 0, magico: 2 } }), 'magico');
  eq(tipoDeDano({ name: 'Miya', role: 'marksman', damage: { fisico: 4, magico: 0 } }), 'fisico');
  // Esmeralda pega las dos cosas de verdad: 4 y 4 en sus habilidades.
  eq(tipoDeDano({ name: 'Esmeralda', damage: { fisico: 4, magico: 4 } }), 'mixto');
  // El dano verdadero no decide el lado: atraviesa las dos defensas.
  eq(tipoDeDano({ name: 'Karrie', damage: { fisico: 4, magico: 0, verdadero: 1 } }), 'fisico');
  eq(tipoDeDano({ name: 'Nuevo' }), null, 'se inventa un tipo para un heroe sin dato');

  const fis = (n) => ({ name: n, tags: [], damage: { fisico: 3, magico: 0 } });
  const mag = (n) => ({ name: n, tags: [], damage: { fisico: 0, magico: 3 } });
  const mix = (n) => ({ name: n, tags: [], damage: { fisico: 3, magico: 3 } });

  eq(perfilDeDano([fis('a'), fis('b'), fis('c')]).falta, 'magico');
  eq(perfilDeDano([mag('a'), mag('b')]).falta, 'fisico');
  eq(perfilDeDano([fis('a'), mag('b')]).falta, null, 've un hueco donde hay de las dos');
  eq(perfilDeDano([fis('a'), mix('b')]).falta, null, 'un mixto no cuenta como que tapa el hueco');

  // Con un solo aliado no se puede decir que al equipo le falte nada, y sin
  // dato tampoco: inventar un aviso es peor que callarse.
  eq(perfilDeDano([fis('a')]).falta, null, 'avisa con un solo aliado elegido');
  eq(perfilDeDano([{ name: 'x', tags: [] }, { name: 'y', tags: [] }]).falta, null,
    'avisa sin tener el dato de ninguno');

  ok(tapaElHueco(mag('m'), 'magico'), 'no ve que un magico tapa el hueco magico');
  ok(tapaElHueco(mix('m'), 'magico'), 'no ve que un mixto tapa cualquier hueco');
  ok(!tapaElHueco(fis('f'), 'magico'), 'cree que un fisico tapa el hueco magico');
  ok(!tapaElHueco(mag('m'), null), 'tapa un hueco que no existe');
});

test('tapar el hueco de dano sube la nota de composicion, y no lo encoge la deduccion', async () => {
  const { compScore } = await import('../src/engine/score.js');

  const fis = (n) => ({ name: n, tags: ['tanky'], damage: { fisico: 3, magico: 0 } });
  const aliados = [fis('a1'), fis('a2'), fis('a3')];

  const base = { name: 'Yo', tags: ['engage'], damage: { fisico: 3, magico: 0 } };
  const tapa = { ...base, damage: { fisico: 0, magico: 3 } };
  ok(compScore(tapa, aliados).value > compScore(base, aliados).value,
    'meter el dano que falta no vale mas que repetir el que sobra');

  // Con el equipo ya equilibrado no hay hueco, asi que los dos valen igual.
  const mixtos = [fis('a1'), { name: 'a2', tags: ['tanky'], damage: { fisico: 0, magico: 3 } }];
  eq(compScore(tapa, mixtos).value, compScore(base, mixtos).value,
    'premia el tipo de dano cuando al equipo no le falta ninguno');

  // El descuento por tags deducidos NO puede comerse el hueco de dano: el tipo
  // de dano esta medido en el texto del juego, no deducido de una etiqueta.
  const ded = { ...tapa, inferred: true };
  const dedSinTapar = { ...base, inferred: true };
  const ganancia = compScore(tapa, aliados).value - compScore(base, aliados).value;
  const gananciaDed = compScore(ded, aliados).value - compScore(dedSinTapar, aliados).value;
  ok(Math.abs(ganancia - gananciaDed) < 1e-9,
    'encoge el hueco de dano por deduccion, descontando dos veces');

  // Y lo que SI viene de tags se sigue encogiendo hacia el empate. Hace falta
  // un heroe que puntue POR ENCIMA de 0.5 en tags: encoger es acercarse a 0.5,
  // asi que a uno flojo la deduccion le SUBE la nota, no se la baja.
  const completo = { name: 'Completo', tags: ['engage', 'cc_hard'], damage: { fisico: 3, magico: 0 } };
  ok(compScore(completo, aliados).value > 0.5, 'el heroe de la comprobacion no puntua por encima del empate');
  ok(compScore({ ...completo, inferred: true }, aliados).value < compScore(completo, aliados).value,
    'ya no encoge lo que viene de tags deducidos');
});

test('se puede buscar un heroe por su nombre en espanol', async () => {
  const { ALIAS, nombresDe } = await import('../src/engine/alias.js');

  // El caso que lo motivo: Javi tiene el juego en espanol, ve "Ciclope" y no
  // encontraba nada porque la app solo miraba el nombre en ingles.
  const { filtrarPorNombre } = await import('../src/engine/alias.js');
  const busca = (hero, q) => filtrarPorNombre([hero], q).length > 0;
  ok(busca({ name: 'Cyclops' }, 'Cíclope'), 'no encuentra a Cyclops escribiendo Cíclope');
  ok(busca({ name: 'Cyclops' }, 'ciclope'), 'no encuentra a Cyclops sin tilde');
  ok(busca({ name: 'Cyclops' }, 'cyclo'), 'ha roto la busqueda por el nombre en ingles');
  ok(busca({ name: 'Minotaur' }, 'minotauro'), 'no encuentra a Minotaur escribiendo Minotauro');
  ok(!busca({ name: 'Layla' }, 'ciclope'), 'saca heroes que no tienen nada que ver');

  // Un alias que apunte a un heroe que no existe es peor que no tenerlo:
  // escribes el nombre bueno y no sale nadie, o sale otro.
  const catalogo = JSON.parse(readFileSync(resolve(ROOT, 'public/data/heroes.json'), 'utf8')).heroes;
  const nombres = new Set(catalogo.map((h) => h.name));
  for (const n of Object.keys(ALIAS)) {
    ok(nombres.has(n), `el alias apunta a un heroe que no esta en el catalogo: ${n}`);
  }

  // Y que la BUSQUEDA de la app lo use de verdad. Sin esto se podia quitar el
  // alias del filtro y las pruebas seguian en verde: el modulo funcionaba
  // perfectamente y no lo llamaba nadie.
  const ui = readFileSync(resolve(ROOT, 'src/components/ui.jsx'), 'utf8');
  ok(/filtrarPorNombre\(heroes, q\)/.test(ui), 'el buscador de heroes ya no usa filtrarPorNombre');

  // Y ningun alias puede pisar el nombre real de OTRO heroe.
  for (const [heroe, otros] of Object.entries(ALIAS)) {
    for (const alias of otros) {
      const choca = catalogo.find((h) => h.name !== heroe && h.name.toLowerCase() === alias.toLowerCase());
      ok(!choca, `el alias "${alias}" de ${heroe} es el nombre real de ${choca?.name}`);
    }
  }
});

test('eligiendo pronto recomienda heroes menos castigables que eligiendo ultimo', () => {
  // Lo que hace distinto elegir primero no es saber menos del rival: los
  // enemigos que faltan te eligen A TI en contra. Asi que con la pantalla casi
  // vacia el nº1 tiene que ser mas dificil de castigar que con el draft hecho.
  const porNombre = (nombre) => {
    let x = 2166136261 ^ 31;
    for (const ch of nombre) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
    return ((x >>> 0) % 100000) / 100000;
  };
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.497 + (porNombre(x.name) - 0.5) * 0.05, matches: 5000 }])));
  // Cada heroe con SU amplitud: unos tienen cruces planos (dificiles de
  // castigar) y otros muy abiertos (castigables). Con la misma amplitud para
  // todos, el riesgo sale saturado e igual para el pool entero y no hay nada
  // que medir: la primera version de esta prueba fallaba por eso, no por el
  // motor.
  const amplitud = (n) => 0.03 + porNombre(`ancho:${n}`) * 0.17;
  const counters = indexByName(Object.fromEntries(all.map((a) => [a.name,
    Object.fromEntries(all.filter((b) => b.name !== a.name)
      .map((b) => [b.name, 0.5 + (porNombre(a.name + b.name) - 0.5) * amplitud(a.name)]))])), 2);
  const meta = { stats, counters, patchAvgWinRate: 0.497 };

  // Se compara el MISMO draft con y sin el descuento, no un draft pronto
  // contra otro tarde: con enemigos distintos cambia el nº1 de todas formas y
  // la comprobacion pasaba aunque se quitara el descuento entero. Sin
  // `candidatos` no hay riesgo que calcular, asi que ese es el "sin".
  const riesgoDelPrimero = (enemigos, conDescuento) => {
    const ctx = { enemies: enemigos.map(h), meta, ...(conDescuento ? { candidatos: pool } : {}) };
    return riesgoContrapick(rankRoamers(pool, ctx)[0].hero, counters, pool);
  };

  const conDescuento = riesgoDelPrimero(['Fanny'], true);
  const sinDescuento = riesgoDelPrimero(['Fanny'], false);
  ok(conDescuento != null && sinDescuento != null, 'no hay riesgo que medir: la comprobacion no vale');
  ok(conDescuento < sinDescuento,
    `con un solo enemigo deberia recomendar algo menos castigable: ${conDescuento?.toFixed(3)} vs ${sinDescuento?.toFixed(3)}`);

  // Y con el draft completo el descuento NO puede existir: ya no te puede
  // contrapickear nadie, asi que ahi manda el counter y nada mas.
  const completo = ['Fanny', 'Ling', 'Lancelot', 'Gusion', 'Hayabusa'].map(h);
  const conRiesgo = rankRoamers(pool, { enemies: completo, meta, candidatos: pool });
  const sinCandidatos = rankRoamers(pool, { enemies: completo, meta });
  eq(conRiesgo[0].hero.name, sinCandidatos[0].hero.name,
    'con los cinco enemigos elegidos el riesgo de contrapick todavia cambia el orden');
});

test('la sinergia se lee en los dos sentidos, como los counters', async () => {
  const { sinergia, synergyScore, indexByName } = await import('../src/engine/score.js');

  // Llevar a A con B es lo mismo que llevar a B con A, asi que el dato vale
  // igual por los dos lados. NO se le da la vuelta: eso es cosa de los
  // counters, donde A gana lo que B pierde.
  const m = indexByName({ Tigreal: { Layla: 0.56 } }, 2);
  eq(sinergia(m, 'Tigreal', 'Layla'), 0.56);
  eq(sinergia(m, 'Layla', 'Tigreal'), 0.56, 'no encuentra el dato por el otro lado');
  eq(sinergia(m, 'Layla', 'Franco'), undefined, 'se inventa una sinergia que no existe');

  // Y que synergyScore lo aproveche de verdad: sin esto el dato existia y no
  // lo miraba nadie, que es como se perdia el 37% de los cruces.
  const yo = { name: 'Layla', tags: [] };
  const aliado = { name: 'Tigreal', tags: [] };
  const conDato = synergyScore(yo, [aliado], m).value;
  const sinDato = synergyScore(yo, [aliado], indexByName({}, 2)).value;
  ok(conDato > sinDato, 'no usa el dato de sinergia cuando solo esta apuntado del otro lado');
});

test('un heroe ya elegido no se propone como ban aunque se escriba distinto', async () => {
  const { suggestBans, indexByName } = await import('../src/engine/score.js');

  // Mismo fallo que ya se arreglo en rankRoamers: comparar nombres crudos. La
  // API y el catalogo escriben "X.Borg" y "X Borg", asi que un pick guardado
  // con otra grafia seguia saliendo como ban recomendado.
  const heroes = [
    { name: 'X.Borg', tags: [], role: 'fighter' },
    { name: 'Tigreal', tags: [], role: 'tank' },
  ];
  const stats = indexByName({ 'X.Borg': { winRate: 0.56, pickRate: 0.05, banRate: 0.4 },
    Tigreal: { winRate: 0.51, pickRate: 0.04, banRate: 0.1 } });
  const meta = { stats, patchAvgWinRate: 0.5 };

  const sinNada = suggestBans(heroes, { meta }).map((b) => b.hero.name);
  ok(sinNada.includes('X.Borg'), 'la comprobacion no vale: X.Borg no salia como ban de todas formas');

  const conPick = suggestBans(heroes, { meta, enemies: [{ name: 'X Borg', tags: [] }] }).map((b) => b.hero.name);
  ok(!conPick.includes('X.Borg'), 'propone banear a un heroe que ya esta elegido, escrito con otra grafia');
});

test('el registro sigue contando bien si la API cambia la grafia de un heroe', async () => {
  const { siguioConsejo, resumen } = await import('../src/engine/registro.js');

  // Las partidas viven meses en el movil. Si la API pasa de "X.Borg" a
  // "X Borg", una partida vieja no puede cambiar de bando: es el unico dato
  // con el que se puede comprobar si la app acierta.
  ok(siguioConsejo({ pick: 'X.Borg', recomendados: ['X Borg', 'Chou'] }),
    'una grafia distinta convierte un acierto en "por libre"');
  ok(siguioConsejo({ pick: 'Yi Sun-shin', recomendados: ['Yi Sun Shin'] }),
    'no reconoce el mismo heroe escrito con espacios');
  ok(!siguioConsejo({ pick: 'Chou', recomendados: ['Franco'] }), 'da por seguido un consejo que no se siguio');
  ok(!siguioConsejo({ pick: '', recomendados: [''] }), 'cuenta una partida sin pick');

  // Y que el resumen no concluya nada sin muestra en LAS DOS ramas.
  const con = Array.from({ length: 40 }, () => ({ pick: 'A', recomendados: ['A'], gane: true }));
  const sin = Array.from({ length: 3 }, () => ({ pick: 'B', recomendados: ['A'], gane: false }));
  ok(!resumen([...con, ...sin]).concluyente, 'concluye con 40 partidas contra 3');
});

test('el JSON de datos se guarda compacto y se vuelve a leer entero', async () => {
  const { serializar } = await import('./ingest.mjs');

  const fila = (n) => Object.fromEntries(
    Array.from({ length: 132 }, (_, i) => [`H${i}`, 0.5 + ((n * 7 + i) % 100) / 10000]));
  const datos = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    heroes: [{ name: 'H0', lanes: ['roam'] }],
    counters: Object.fromEntries(Array.from({ length: 133 }, (_, i) => [`H${i}`, fila(i)])),
    synergies: Object.fromEntries(Array.from({ length: 133 }, (_, i) => [`H${i}`, fila(i)])),
  };

  const texto = serializar(datos);
  const vuelta = JSON.parse(texto);

  const pares = (m) => Object.values(m).reduce((n, f) => n + Object.keys(f).length, 0);
  eq(pares(vuelta.counters), pares(datos.counters), 'se pierden cruces al guardar');
  eq(pares(vuelta.synergies), pares(datos.synergies), 'se pierden sinergias al guardar');
  eq(vuelta.generatedAt, datos.generatedAt, 'se pierde algo fuera de las matrices');

  // La marca de sustitucion no puede quedarse en el fichero: la primera
  // version usaba \u0000 y JSON.stringify lo escapaba, asi que el fichero
  // salia con basura donde iban los datos y seguia siendo JSON valido.
  ok(!texto.includes('@@fila'), 'la marca interna se ha quedado en el fichero');
  ok(!/\\u0000/.test(texto), 'quedan caracteres de control escapados en el fichero');

  // Una linea por heroe, no una por numero: es lo que hace el diff legible
  // desde el movil. 133 + 133 filas y el resto de campos, no 35.000 lineas.
  ok(texto.split('\n').length < 1000,
    `el fichero se ha vuelto a partir en una linea por numero: ${texto.split('\n').length} lineas`);

  // Y redondeado: la quinta cifra de un winrate es ruido y ocupa.
  const v = Object.values(vuelta.counters.H0)[0];
  ok(String(v).replace(/^0\./, '').length <= 4, `winrate sin redondear: ${v}`);
});

test('no propone banear a quien salta encima de tu TANQUE', async () => {
  const { suggestBans, hayQueProtegerlo, indexByName } = await import('../src/engine/score.js');

  // Un tanque tambien lleva el tag `immobile`. Sin filtrar, la app decia
  // "banealo porque salta encima de tu Tigreal", que es al reves de como se
  // juega. Ya se corrigio en el peel de la sinergia y aqui habia sobrevivido.
  ok(!hayQueProtegerlo({ tags: ['immobile', 'tanky', 'burst'] }), 'trata a un tanque como si hubiera que protegerlo');
  ok(hayQueProtegerlo({ tags: ['immobile', 'hypercarry'] }), 'no protege a un tirador inmovil');

  const asesino = { name: 'Asesino', tags: ['dive', 'burst'], role: 'assassin' };
  const otro = { name: 'Otro', tags: [], role: 'mage' };
  const stats = indexByName({ Asesino: { winRate: 0.52, pickRate: 0.03, banRate: 0.1 },
    Otro: { winRate: 0.52, pickRate: 0.03, banRate: 0.1 } });
  const meta = { stats, patchAvgWinRate: 0.5 };

  const conTanque = suggestBans([asesino, otro], { meta, allies: [{ name: 'Tigreal', tags: ['immobile', 'tanky'] }] });
  const razonesTanque = conTanque.find((b) => b.hero.name === 'Asesino')?.reasons ?? [];
  eq(razonesTanque.length, 0, 'avisa de que le van a saltar encima al tanque, que es lo que el tanque quiere');

  // Y con un tirador de verdad SI tiene que avisar: si no, la comprobacion
  // pasaria por haber apagado la regla entera.
  const conCarry = suggestBans([asesino, otro], { meta, allies: [{ name: 'Layla', tags: ['immobile', 'hypercarry'] }] });
  const razonesCarry = conCarry.find((b) => b.hero.name === 'Asesino')?.reasons ?? [];
  ok(razonesCarry.length > 0, 'ya no avisa de que le van a saltar encima al tirador');
});

test('si no sale nadie, el buscador prueba con las letras en orden', async () => {
  const { filtrarPorNombre } = await import('../src/engine/alias.js');

  // El caso que lo motivo: Javi no encontraba a Layla. Escrita "Lyla" -como
  // aparece en algunas listas en espanol- el buscador no devolvia nada, y
  // desde el movil, en 30 segundos de draft, eso es un callejon sin salida.
  const heroes = ['Layla', 'Tigreal', 'Lolita', 'Alucard', 'Lunox', 'Miya', 'Cyclops']
    .map((name) => ({ name }));
  const nombres = (q) => filtrarPorNombre(heroes, q).map((h) => h.name);

  eq(nombres('Lyla').join(), 'Layla', 'no encuentra a Layla escribiendo Lyla');
  eq(nombres('Tigral').join(), 'Tigreal', 'no perdona una letra bailada');
  eq(nombres('Lucard').join(), 'Alucard', 'no encuentra un nombre al que le falta el principio');

  // Lo normal NO cambia: mientras algo encaje de la forma de siempre, el
  // respaldo no entra. Si entrara siempre, tres letras sacarian media
  // plantilla y el buscador seria inutil. Se compara contra el filtro de
  // siempre en vez de contra una lista escrita a mano: escribirla a mano ya me
  // ha salido mal dos veces (ni "Lolita" contiene "la" ni "Cyclops" deja de
  // contener "lo").
  const contiene = (q) => heroes
    .filter((h) => h.name.toLowerCase().includes(q.toLowerCase())).map((h) => h.name).join();
  for (const q of ['la', 'Lo', 'lay', 'yl']) {
    ok(contiene(q).length > 0, `la comprobacion no vale: "${q}" no encontraba nada de la forma normal`);
    eq(nombres(q).join(), contiene(q), `el respaldo se ha colado buscando "${q}"`);
  }

  // Y pide tres letras: con una o dos, las letras sueltas encajan en casi todo.
  eq(nombres('ly').length, 0, 'con dos letras ya se pone a adivinar');
  eq(nombres('zzz').length, 0, 'saca heroes para algo que no se parece a nada');
  eq(nombres('').length, heroes.length, 'sin escribir nada deberia salir todo');
});

test('el registro compara contra tu winrate de siempre, no solo contra la otra rama', async () => {
  const { resumen, winrateDeReferencia } = await import('../src/engine/registro.js');

  // La rama "por libre" no se llena jugando: para juntar 30 hay que ignorar la
  // app 30 veces a proposito. La maestria son miles de partidas que ya existen.
  const maestria = { Diggie: { games: 3821, winRate: 0.54 }, Franco: { games: 900, winRate: 0.51 } };
  const ref = winrateDeReferencia(maestria);
  eq(ref.partidas, 4721, 'no suma bien las partidas de la maestria');
  ok(ref.winRate > 0.53 && ref.winRate < 0.54, `pondera mal por partidas: ${ref.winRate}`);
  // Ponderado: el heroe de 3821 partidas manda sobre el de 900, no cuentan igual.
  ok(Math.abs(ref.winRate - 0.54) < Math.abs(ref.winRate - 0.51), 'no pondera por partidas');

  const jugadas = (n, ganadas) => Array.from({ length: n }, (_, i) => ({
    pick: 'Diggie', recomendados: ['Diggie'], gane: i < ganadas,
  }));

  // Con poca muestra tiene que decir que NO se ve, por muy grande que parezca.
  const poco = resumen(jugadas(11, 8), maestria);
  ok(poco.contraReferencia, 'no compara contra la referencia teniendo maestria');
  ok(!poco.contraReferencia.seVe, 'da por buena una diferencia de 11 partidas');
  ok(poco.contraReferencia.faltan > 20, 'se cree que con cuatro partidas mas basta');

  // Y con 11 partidas GANADAS TODAS, el error no puede salir cero. Con la
  // formula de Wald -que usa lo observado- p(1-p) seria 0 y diria que se ve
  // clarisimo con once partidas. Se usa la referencia, no lo observado.
  const todasGanadas = resumen(jugadas(11, 11), maestria);
  ok(todasGanadas.contraReferencia.margen > 0.15,
    `con 11 partidas el margen no puede ser ${todasGanadas.contraReferencia.margen}`);

  // La cuenta de partidas que faltan es la de UNA muestra contra una
  // referencia conocida, no la de dos muestras: la referencia son miles de
  // partidas y su error propio es despreciable. Con la formula equivocada
  // pedia casi cuatro veces mas.
  const esperado = Math.ceil(
    ((1.96 * Math.sqrt(0.534 * 0.466) + 0.84 * Math.sqrt((8 / 11) * (3 / 11))) ** 2)
    / ((8 / 11 - ref.winRate) ** 2),
  ) - 11;
  ok(Math.abs(poco.contraReferencia.faltan - esperado) <= 2,
    `la cuenta de potencia no cuadra: dice ${poco.contraReferencia.faltan}, deberia rondar ${esperado}`);

  // Con mucha muestra y una diferencia grande, tiene que verse.
  const mucho = resumen(jugadas(400, 300), maestria);
  ok(mucho.contraReferencia.seVe, 'no reconoce una diferencia clara con 400 partidas');
  eq(mucho.contraReferencia.faltan, 0, 'sigue pidiendo partidas cuando ya se ve');

  // Y si el winrate coincide con el de siempre, tampoco puede "verse" nada.
  const igual = resumen(jugadas(200, 107), maestria);
  ok(!igual.contraReferencia.seVe, 've una diferencia donde no la hay');

  // Sin maestria no hay contra que comparar: mejor callarse que inventar base.
  eq(resumen(jugadas(20, 15), {}).contraReferencia, null, 'se inventa una referencia sin maestria');
  eq(winrateDeReferencia({}), null, 'devuelve una referencia de la nada');
});

test('el perfil viaja entero y no puede borrar nada al llegar', async () => {
  const { recogerPerfil, exportarPerfil, leerPerfil, fundirPerfil } = await import('../src/engine/perfil.js');

  const mastery = Object.fromEntries(
    ['Diggie', 'Franco', 'Khufra'].map((n, i) => [n, { games: 3821 - i * 900, winRate: 0.54 - i * 0.01 }]));
  const partidas = Array.from({ length: 13 }, (_, i) => ({
    t: 1700000000000 - i * 86400000, pick: 'Diggie', recomendados: ['Diggie'], gane: i % 3 !== 0,
  }));

  const codigo = await exportarPerfil(recogerPerfil({ mastery, partidas, rango: 'glory', linea: 'roam' }));
  ok(codigo.startsWith('MLPA1.'), 'el codigo no lleva su marca delante');

  const { perfil } = await leerPerfil(codigo);
  ok(perfil, 'un codigo recien hecho no se puede volver a leer');
  eq(Object.keys(perfil.mastery).length, 3, 'se pierden heroes por el camino');
  eq(perfil.partidas.length, 13, 'se pierden partidas por el camino');
  eq(perfil.mastery.Diggie.games, 3821, 'se pierde el numero de partidas de un heroe');

  // Un codigo a medias NO puede importarse: llevarse por delante 3821 partidas
  // de maestria por un pegado incompleto seria el peor fallo posible aqui.
  const [m, cuerpo, ctrl] = codigo.split('.');
  eq((await leerPerfil(`${m}.${cuerpo.slice(0, -8)}.${ctrl}`)).error, 'incompleto', 'traga un codigo cortado');
  eq((await leerPerfil(`${m}.${cuerpo.slice(0, -1)}X.${ctrl}`)).error, 'incompleto', 'traga un codigo alterado');
  eq((await leerPerfil('hola que tal')).error, 'formato', 'traga cualquier texto');
  eq((await leerPerfil('')).error, 'vacio', 'traga una cadena vacia');
  // Y los espacios y saltos de linea de un pegado real no pueden estorbar.
  ok((await leerPerfil(`  ${m}.\n${cuerpo}.\n${ctrl} `)).perfil, 'un pegado con espacios no se lee');

  // Al fundir, gana quien tenga MAS partidas y no se pierde nada del otro lado.
  const enElPc = {
    mastery: { Diggie: { games: 10, winRate: 0.9 }, Chou: { games: 500, winRate: 0.52 } },
    partidas: [{ t: 1, pick: 'Chou', recomendados: [], gane: true }],
  };
  const f = fundirPerfil(enElPc, perfil);
  eq(f.mastery.Diggie.games, 3821, 'el dispositivo con MENOS partidas pisa al que tiene mas');
  ok(f.mastery.Chou, 'se pierde un heroe que solo estaba en el dispositivo de destino');
  eq(f.partidas.length, 14, 'no junta las partidas de los dos lados');

  // Y AL REVES, que es el caso peligroso: pegar un codigo VIEJO en el
  // dispositivo bueno. Si el que llega pisara sin mirar, aqui se irian 3821
  // partidas de maestria por pegar un codigo de hace un mes. La primera
  // version de esta prueba solo miraba la direccion facil y pasaba aunque se
  // quitara el mecanismo entero.
  const viejo = { mastery: { Diggie: { games: 12, winRate: 0.9 } }, partidas: [] };
  const alReves = fundirPerfil({ mastery, partidas }, viejo);
  eq(alReves.mastery.Diggie.games, 3821, 'un codigo viejo se lleva por delante la maestria buena');
  eq(alReves.partidas.length, 13, 'un codigo viejo se lleva por delante las partidas');

  // Importar dos veces no puede duplicar nada: se hara mas de una vez.
  const otraVez = fundirPerfil(f, perfil);
  eq(otraVez.partidas.length, 14, 'importar dos veces duplica las partidas');
  eq(Object.keys(otraVez.mastery).length, Object.keys(f.mastery).length, 'importar dos veces duplica maestria');
});

test('las partidas viejas personalizan pero NO ensucian la comparacion', async () => {
  const { apuntar, olvidar, corregir, resumen, maestriaEfectiva, esPrevia } = await import('../src/engine/registro.js');

  let ps = [];
  for (let i = 0; i < 11; i++) ps = apuntar(ps, { pick: 'Diggie', recomendados: ['Diggie'], gane: i < 8 });
  ps = apuntar(ps, { pick: 'Franco', recomendados: ['Diggie'], gane: true });
  ps = apuntar(ps, { pick: 'Franco', recomendados: ['Diggie'], gane: false });

  const antes = resumen(ps);
  eq(antes.siguiendo, 11, 'no cuenta bien las seguidas');
  eq(antes.porLibre, 2, 'no cuenta bien las de por libre');

  // Cuarenta partidas del historial del juego. La trampa: no llevan
  // `recomendados`, asi que sin marcarlas irian todas a "por libre" y la
  // comparacion pasaria a medir el winrate de siempre en vez de la app.
  for (let i = 0; i < 40; i++) {
    ps = apuntar(ps, { pick: 'Atlas', gane: i < 21, previa: true, t: 1600000000000 + i });
  }
  const despues = resumen(ps);
  eq(despues.total, 53, 'pierde partidas al meter las viejas');
  eq(despues.previas, 40, 'no distingue las viejas');
  eq(despues.siguiendo, antes.siguiendo, 'las viejas se han colado en las seguidas');
  eq(despues.porLibre, antes.porLibre, 'las viejas se han colado en "por libre"');
  ok(ps.filter(esPrevia).length === 40, 'no marca las viejas como previas');

  // Y SI tienen que personalizar: para eso se meten.
  const m = maestriaEfectiva({ Diggie: { games: 3821, winRate: 0.54 } }, ps);
  eq(m.Atlas.games, 40, 'las partidas viejas no llegan a la maestria');
  ok(Math.abs(m.Atlas.winRate - 21 / 40) < 1e-9, 'calcula mal el winrate de las viejas');
  // La escrita a mano gana si tiene mas partidas: no se suman, se elige.
  eq(m.Diggie.games, 3821, 'el registro pisa la maestria escrita a mano, que tiene mucho mas');
  eq(m.Franco.games, 2, 'un heroe que solo esta en el registro no llega a la maestria');

  // Corregir y quitar, que es para lo que existe la pantalla.
  const unaSeguida = ps.find((p) => !esPrevia(p) && p.pick === 'Diggie');
  const corregidas = corregir(ps, unaSeguida.t, !unaSeguida.gane);
  eq(corregidas.length, ps.length, 'corregir cambia el numero de partidas');
  eq(corregidas.find((p) => p.t === unaSeguida.t).gane, !unaSeguida.gane, 'no cambia el resultado');
  eq(resumen(corregidas).siguiendo, 11, 'corregir mueve una partida de rama');

  const quitadas = olvidar(ps, unaSeguida.t);
  eq(quitadas.length, ps.length - 1, 'no quita la partida');
  ok(!quitadas.some((p) => p.t === unaSeguida.t), 'la partida quitada sigue ahi');
  eq(olvidar(ps, 'no-existe').length, ps.length, 'quita algo cuando no deberia');
});

test('la maestria se mide contra TU nivel, no contra el 50%', async () => {
  const { masteryScore, tuNivel } = await import('../src/engine/score.js');

  // Javi gana el 53.4% de sus partidas. Un heroe jugado a esa media exacta no
  // es mejor que uno que no ha tocado nunca: es EXACTAMENTE su nivel. Con la
  // escala centrada en 0.50 puntuaba 0.64 contra 0.50, o sea que la app
  // premiaba tener datos apuntados en vez de ser bueno con el heroe.
  const suya = { A: { games: 3821, winRate: 0.54 }, B: { games: 900, winRate: 0.51 } };
  const nivel = tuNivel(suya);
  ok(Math.abs(nivel - 0.534) < 0.002, `su nivel deberia rondar el 53.4%, sale ${nivel}`);

  const conNivel = (wr, games) => masteryScore({ name: 'X' }, { ...suya, X: { games, winRate: wr } }).value;
  const sinDatos = masteryScore({ name: 'Z' }, suya).value;
  eq(sinDatos, 0.5, 'un heroe sin datos tuyos deberia salir neutro');

  ok(Math.abs(conNivel(nivel, 500) - 0.5) < 0.02,
    `a tu media exacta deberia empatar con un heroe desconocido, sale ${conNivel(nivel, 500)}`);
  ok(conNivel(0.50, 500) < 0.45, 'un heroe al 50% deberia salir POR DEBAJO para un jugador del 53.4%');
  ok(conNivel(0.60, 500) > 0.7, 'un heroe muy por encima de tu nivel deberia destacar');

  // Y con pocas partidas se encoge hacia TU nivel, no hacia el 50%. Cuanto se
  // encoge NO es un numero suelto: el prior sale de 0.25/σ², con σ medida de la
  // dispersion real entre tus heroes. Con el valor viejo (20) cinco partidas al
  // 90% puntuaban 0.87, casi el tope.
  ok(conNivel(0.90, 2) < 0.58, `dos partidas ganadas no pueden disparar la nota: ${conNivel(0.90, 2)}`);
  ok(conNivel(0.90, 5) < 0.62, `cinco partidas al 90% no pueden disparar la nota: ${conNivel(0.90, 5)}`);
  ok(conNivel(0.90, 400) > 0.9, 'con muchisimas partidas al 90% la nota SI tiene que subir');

  // Con pocas partidas tu nivel se encoge hacia el 50%, y SIN acantilado. Antes
  // habia un corte en 100 partidas: por debajo, 0.50; por encima, tu winrate
  // entero. Medido, apuntar UNA partida mas (de 99 a 100) reordenaba el numero
  // 1 en 54 de 200 drafts. Un jugador no cambia de nivel entre la 99 y la 100.
  ok(Math.abs(tuNivel({ A: { games: 2, winRate: 1 } }) - 0.5) < 0.02,
    `se cree un nivel sacado de dos partidas: ${tuNivel({ A: { games: 2, winRate: 1 } })}`);
  eq(tuNivel({}), 0.5, 'se inventa un nivel sin datos');
  ok(tuNivel({ A: { games: 4000, winRate: 0.60 } }) > 0.58,
    'con miles de partidas deberia creerse tu nivel casi entero');

  // Y que crezca de forma continua: ningun par de valores consecutivos puede
  // dar un salto grande. Es lo que distingue un encogimiento de un corte.
  let anterior = tuNivel({ A: { games: 1, winRate: 0.60 } });
  let mayorSalto = 0;
  for (let n = 2; n <= 400; n++) {
    const ahora = tuNivel({ A: { games: n, winRate: 0.60 } });
    mayorSalto = Math.max(mayorSalto, Math.abs(ahora - anterior));
    anterior = ahora;
  }
  ok(mayorSalto < 0.002, `tu nivel da un salto de ${mayorSalto.toFixed(4)} entre dos partidas seguidas: sigue habiendo un corte`);
});

test('el encogimiento de la maestria sale de la dispersion medida', async () => {
  const { priorDeMaestria } = await import('../src/engine/score.js');

  // k = 0.25 / σ², con σ = lo que de verdad varia tu winrate entre heroes.
  // Un jugador MUY parejo (todos sus heroes casi igual) tiene que encogerse
  // mas; uno con heroes muy dispares, menos.
  const parejo = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
    `H${i}`, { games: 800, winRate: 0.53 + (i % 2 ? 0.005 : -0.005) }]));
  const dispar = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
    `H${i}`, { games: 800, winRate: 0.53 + (i % 2 ? 0.07 : -0.07) }]));
  ok(priorDeMaestria(parejo) > priorDeMaestria(dispar),
    'un jugador parejo deberia encogerse MAS que uno con heroes muy dispares');

  // Y con topes: sin datos suficientes no se puede medir nada, y un caso
  // extremo no puede dar un prior absurdo.
  const k = priorDeMaestria({ A: { games: 500, winRate: 0.9 } });
  ok(k >= 0.25 / 0.08 ** 2 && k <= 0.25 / 0.02 ** 2, `prior fuera de los topes: ${k}`);
  ok(Number.isFinite(priorDeMaestria({})), 'sin datos deberia dar un prior por defecto');
});

test('las builds se ordenan por USO, no por winrate', async () => {
  const { buildsDe } = await import('../src/engine/builds.js');

  // Esto no es una preferencia estetica. El winrate de una build lleva dentro
  // a QUIEN la compra: el que se sale de la build normal suele ser el que mas
  // domina el heroe. Se ve en los datos de verdad -las builds del 3% de uso
  // salen por encima de las del 13%-, asi que ordenar por winrate seria
  // recomendar el sesgo del jugador como si fuera el objeto.
  const builds = {
    Paquito: {
      exp: [
        { objetos: [1, 2, 3], pickRate: 0.03, winRate: 0.60 },
        { objetos: [4, 5, 6], pickRate: 0.13, winRate: 0.56 },
      ],
    },
  };
  const lista = buildsDe(builds, { name: 'Paquito' }, 'exp');
  eq(lista[0].pickRate, 0.13, 'la primera build no es la mas jugada');
  ok(lista[0].winRate < lista[1].winRate, 'la prueba no esta midiendo lo que cree');
});

test('dos builds que se ven iguales en pantalla se juntan en una', async () => {
  const { buildsDe } = await import('../src/engine/builds.js');

  // La API separa builds que solo se diferencian en un talento del emblema, y
  // los talentos no se descargan: en pantalla salen los MISMOS tres objetos
  // dos veces con dos porcentajes distintos. Parece un fallo y ademas miente,
  // porque esa build se usa la suma de las dos.
  const builds = {
    Rafaela: {
      roam: [
        { objetos: [1, 2, 3], pickRate: 0.04, winRate: 0.60, emblema: 'Support', hechizo: 'Purify' },
        { objetos: [1, 2, 3], pickRate: 0.02, winRate: 0.66, emblema: 'Support', hechizo: 'Purify' },
        // Mismos objetos, OTRO hechizo: son dos builds distintas y la app las
        // ensena como tales. Juntarlas seria perder informacion de verdad.
        { objetos: [1, 2, 3], pickRate: 0.03, winRate: 0.55, emblema: 'Support', hechizo: 'Revitalize' },
      ],
    },
  };
  const lista = buildsDe(builds, { name: 'Rafaela' }, 'roam');
  eq(lista.length, 2, 'no se han juntado las dos builds indistinguibles');
  const [junta] = lista;
  ok(Math.abs(junta.pickRate - 0.06) < 1e-9, `el uso deberia sumarse: ${junta.pickRate}`);

  // Y el winrate junto, PONDERADO por uso: (0.60*0.04 + 0.66*0.02)/0.06.
  ok(Math.abs(junta.winRate - 0.62) < 1e-9,
    `el winrate junto deberia ir ponderado por uso, no promediado: ${junta.winRate}`);
  ok(lista.some((b) => b.hechizo === 'Revitalize'), 'se ha perdido la build del otro hechizo');
});

test('no se proponen objetos que ese jugador no puede comprar', async () => {
  const { conEfecto, mejoresDefensas, ajustesDeBuild } = await import('../src/engine/builds.js');

  // Salio contra el sitio publicado, no aqui: a un ROAMER con tres enemigos de
  // control duro se le proponian las tres botas de JUNGLA. Mismo efecto y misma
  // defensa que las normales, y no puede comprarlas. El tipo lo trae la propia
  // API, asi que no hace falta ninguna lista escrita a mano.
  const equipment = {
    1: { nombre: 'Tough Boots', tipo: 'Movement', magica: 18, efectos: ['cortaControl'] },
    2: { nombre: "Ice Hunter's Tough Boots", tipo: 'Jungle', magica: 18, efectos: ['cortaControl'] },
    // A proposito: MAS defensa y un nombre que ordena ANTES que el universal.
    // Si la prueba no lo hiciera asi, pasaria por suerte del alfabeto aunque se
    // quitara la regla, que es como ya colaron dos invariantes en su dia.
    3: { nombre: 'Blessed Tough Boots', tipo: 'Roam', magica: 25, efectos: ['cortaControl'] },
    4: { nombre: "Athena's Shield", tipo: 'Defense', magica: 48 },
    5: { nombre: "Ice Hunter's Wings", tipo: 'Jungle', magica: 60 },
  };

  const paraRoam = conEfecto(equipment, 'cortaControl', 'roam').map((o) => o.nombre);
  ok(!paraRoam.some((n) => n.includes("Hunter's")), `a un roamer se le proponen objetos de jungla: ${paraRoam}`);
  const paraMid = conEfecto(equipment, 'cortaControl', 'mid').map((o) => o.nombre);
  eq(paraMid.length, 1, `a un mid se le proponen objetos de otra linea: ${paraMid}`);
  eq(paraMid[0], 'Tough Boots', 'el objeto universal deberia ser el primero');

  // Y el de linea propia sirve, pero DETRAS del universal: dice lo mismo y no
  // depende de la bendicion que lleves.
  eq(paraRoam[0], 'Tough Boots', `el primero para un roamer deberia ser el universal: ${paraRoam}`);
  ok(paraRoam.includes('Blessed Tough Boots'), 'las botas de roam deberian seguir valiendo para un roamer');

  // Lo mismo con la defensa: 60 de defensa magica no valen si no puedes
  // comprar el objeto.
  const def = mejoresDefensas(equipment, 'magica', 'roam').map((o) => o.nombre);
  ok(!def.includes("Ice Hunter's Wings"), `propone un objeto de jungla a un roamer: ${def}`);
  eq(def[0], "Athena's Shield", 'no manda el que mas defensa da de los que si puede comprar');
  const defJungla = mejoresDefensas(equipment, 'magica', 'jungle').map((o) => o.nombre);
  ok(defJungla.includes("Ice Hunter's Wings"), 'a un jungla si deberia proponerle el objeto de jungla');
  // Pero DETRAS del universal, aunque de mas defensa (60 contra 48): el objeto
  // de linea ata la build a esa bendicion y el universal dice lo mismo.
  eq(defJungla[0], "Athena's Shield", `el objeto de linea se ha colado delante: ${defJungla}`);

  // Y el aviso completo, con la linea puesta, no cuela ninguno.
  const mag = (n) => ({ name: n, damage: { fisico: 0, magico: 6 }, tags: [] });
  const avisos = ajustesDeBuild({ objetos: [] }, equipment, [mag('A'), mag('B')], 'roam');
  for (const a of avisos) {
    for (const o of a.objetos) ok(o.tipo !== 'Jungle', `el aviso propone ${o.nombre}, que es de jungla`);
  }
});

test('las builds se encuentran aunque el nombre se escriba distinto', async () => {
  const { buildsDe } = await import('../src/engine/builds.js');

  // El fallo invisible de siempre: la API escribe "X.Borg" y el catalogo
  // "X Borg". Sin normalizar, ese heroe se queda sin build y nadie se entera
  // porque la pantalla simplemente dice "todavia no hay builds".
  const builds = { 'X.Borg': { exp: [{ objetos: [1], pickRate: 0.2 }] } };
  eq(buildsDe(builds, { name: 'X Borg' }, 'exp').length, 1, 'no encuentra la build por nombre normalizado');
  eq(buildsDe(builds, 'X.Borg', 'exp').length, 1, 'no encuentra la build por la clave cruda');
  eq(buildsDe(builds, { name: 'Layla' }, 'exp').length, 0, 'se inventa una build de otro heroe');
  eq(buildsDe(builds, { name: 'X.Borg' }, 'roam').length, 0, 'devuelve la build de otra linea');
});

test('la amenaza enemiga se calla cuando no sabe y no reparte lo que no tiene', async () => {
  const { amenazaEnemiga } = await import('../src/engine/builds.js');

  const fis = (n) => ({ name: n, damage: { fisico: 6, magico: 0 } });
  const mag = (n) => ({ name: n, damage: { fisico: 0, magico: 6 } });
  const mix = (n) => ({ name: n, damage: { fisico: 5, magico: 5 } });
  const sin = (n) => ({ name: n });

  // Con un solo enemigo con dato no se puede decir de que pega el equipo.
  eq(amenazaEnemiga([mag('A')]), null, 'se moja con un solo enemigo');
  eq(amenazaEnemiga([]), null, 'se moja sin enemigos');

  // Un mixto amenaza por los dos lados: medio a cada uno.
  const m = amenazaEnemiga([mag('A'), mix('B')]);
  eq(m.magico, 1.5, 'el mixto no cuenta medio al lado magico');
  eq(m.fisico, 0.5, 'el mixto no cuenta medio al lado fisico');

  // Y los que no tienen dato NO se reparten a medias: eso seria inventarse la
  // mitad de la respuesta. Se cuentan aparte y ya.
  const s = amenazaEnemiga([mag('A'), mag('B'), sin('C')]);
  eq(s.cuotaMagica, 1, 'el heroe sin dato se ha colado en el reparto');
  eq(s.sinDato, 1, 'no se esta contando a quien falta el dato');
  eq(amenazaEnemiga([fis('A'), fis('B')]).cuotaMagica, 0, 'un equipo todo fisico no sale a 0 de cuota magica');
});

test('el ajuste defensivo solo habla cuando el desequilibrio es claro y falta el objeto', async () => {
  const { ajusteDefensivo, DESEQUILIBRIO } = await import('../src/engine/builds.js');

  const mag = (n) => ({ name: n, damage: { fisico: 0, magico: 6 } });
  const fis = (n) => ({ name: n, damage: { fisico: 6, magico: 0 } });
  const equipment = {
    1: { nombre: 'Blade Armor', fisica: 80 },
    2: { nombre: "Athena's Shield", magica: 48 },
    3: { nombre: 'Hunter Strike' },
    4: { nombre: 'Radiant Armor', magica: 40 },
  };
  const buildSinDefensa = { objetos: [3] };

  // 1. Equipo enemigo repartido: no hay nada que decir.
  eq(ajusteDefensivo(buildSinDefensa, equipment, [mag('A'), mag('B'), fis('C'), fis('D')]), null,
    'aconseja con el dano enemigo repartido');

  // 2. Cuatro de cinco magicos y la build sin defensa magica: ahi si.
  const a = ajusteDefensivo(buildSinDefensa, equipment, [mag('A'), mag('B'), mag('C'), mag('D'), fis('E')]);
  ok(a && a.lado === 'magica', 'no detecta un equipo enemigo mayoritariamente magico');
  ok(a.cuotaMagica >= DESEQUILIBRIO, 'ha hablado por debajo del umbral');

  // 3. Nunca propone un objeto del lado equivocado. Comprar Blade Armor contra
  //    un equipo magico es cambiar de objeto para nada.
  ok(a.alternativas.length, 'no propone ningun objeto');
  for (const o of a.alternativas) {
    ok((o.magica ?? 0) > 0, `propone ${o.nombre}, que no da defensa magica`);
    ok((o.magica ?? 0) >= (o.fisica ?? 0), `propone ${o.nombre}, que da mas defensa del otro lado`);
  }

  // 4. Si la build YA lleva defensa de ese lado, se calla. Una app que siempre
  //    tiene un consejo deja de leerse.
  eq(ajusteDefensivo({ objetos: [2, 3] }, equipment, [mag('A'), mag('B'), mag('C'), mag('D'), fis('E')]), null,
    'aconseja defensa magica a una build que ya lleva Athena');

  // 5. Sin enemigos con dato, silencio.
  eq(ajusteDefensivo(buildSinDefensa, equipment, [{ name: 'X' }]), null, 'aconseja sin datos de dano enemigo');
});

test('la build se adapta al draft, y se calla cuando ya lo cubre', async () => {
  const { ajustesDeBuild, TOPE_AVISOS, ENEMIGOS_PARA_HABLAR } = await import('../src/engine/builds.js');

  const mag = (n) => ({ name: n, damage: { fisico: 0, magico: 6 }, tags: [] });
  const cura = (n) => ({ name: n, damage: { fisico: 3, magico: 3 }, tags: ['heal'] });
  const control = (n) => ({ name: n, damage: { fisico: 3, magico: 3 }, tags: ['cc_hard'] });
  const equipment = {
    1: { nombre: "Athena's Shield", magica: 48 },
    2: { nombre: 'Sea Halberd', efectos: ['antiCuracion'] },
    3: { nombre: 'Tough Boots', magica: 18, efectos: ['cortaControl'] },
    4: { nombre: 'Hunter Strike' },
    5: { nombre: 'Dominance Ice', magica: 40, fisica: 40, efectos: ['antiCuracion'] },
  };

  // 1. Un enemigo que cura no es una composicion que cura: con uno, silencio.
  eq(ajustesDeBuild({ objetos: [4] }, equipment, [cura('A'), mag('B')])
    .filter((x) => x.clave === 'build.ajusteCuracion').length, 0,
  `habla de curacion con menos de ${ENEMIGOS_PARA_HABLAR} enemigos`);

  // 2. Con dos, lo dice y propone objetos que de verdad la cortan.
  const conCura = ajustesDeBuild({ objetos: [4] }, equipment, [cura('A'), cura('B'), mag('C')]);
  const aviso = conCura.find((x) => x.clave === 'build.ajusteCuracion');
  ok(aviso, 'no avisa contra dos enemigos que se curan');
  ok(aviso.objetos.every((o) => o.efectos.includes('antiCuracion')),
    'propone objetos que no cortan la curacion');
  ok(aviso.params.quien.includes('A'), 'no dice quien cura');

  // 3. Si la build YA lleva anti-curacion, se calla. Una app que siempre tiene
  //    un consejo deja de leerse.
  eq(ajustesDeBuild({ objetos: [2] }, equipment, [cura('A'), cura('B')])
    .filter((x) => x.clave === 'build.ajusteCuracion').length, 0,
  'avisa de curacion a una build que ya lleva Sea Halberd');

  // 4. Y como mucho TOPE_AVISOS, aunque el draft dispare las tres cosas.
  const todo = ajustesDeBuild({ objetos: [4] }, equipment, [
    { name: 'A', damage: { fisico: 0, magico: 6 }, tags: ['heal', 'cc_hard'] },
    { name: 'B', damage: { fisico: 0, magico: 6 }, tags: ['heal', 'cc_hard'] },
    { name: 'C', damage: { fisico: 0, magico: 6 }, tags: [] },
  ]);
  eq(todo.length, TOPE_AVISOS, `salen ${todo.length} avisos y el tope es ${TOPE_AVISOS}`);
  // Y manda el que mas mueve: la defensa son 40-80 puntos, no un efecto.
  eq(todo[0].clave, 'build.ajusteMagica', 'el aviso mas importante no va primero');

  // 5. Sin objetos que proponer no se abre la boca: un aviso sin salida es ruido.
  eq(ajustesDeBuild({ objetos: [4] }, { 4: { nombre: 'Hunter Strike' } }, [cura('A'), cura('B')]).length, 0,
    'avisa sin tener ningun objeto que proponer');
  eq(ajustesDeBuild({ objetos: [4] }, equipment, [control('A')]).length, 0, 'habla con un solo enemigo');

  // 6. Un heroe con tags DEDUCIDOS (no esta en el catalogo escrito a mano)
  //    cuenta menos: dos adivinados no bastan para abrir la boca. Es la misma
  //    regla que ya costo una version con Marcel, acumulando etiquetas dudosas
  //    hasta que parecian un hecho.
  const adivinado = (n) => ({ ...cura(n), inferred: true });
  eq(ajustesDeBuild({ objetos: [4] }, equipment, [adivinado('A'), adivinado('B')])
    .filter((x) => x.clave === 'build.ajusteCuracion').length, 0,
  'dos heroes con tags adivinados disparan el aviso ellos solos');
  ok(ajustesDeBuild({ objetos: [4] }, equipment, [cura('A'), adivinado('B'), adivinado('C')])
    .some((x) => x.clave === 'build.ajusteCuracion'),
  'uno seguro y dos adivinados deberian bastar');
});

test('lo que hace un objeto se lee de su texto, no de una lista escrita a mano', async () => {
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const objetos = Object.values(meta.equipment ?? {});
  if (!objetos.length) return;

  const porNombre = Object.fromEntries(objetos.map((o) => [o.nombre, o]));
  const tiene = (n, e) => porNombre[n]?.efectos?.includes(e);

  // Objetos de efecto público. Si la API cambia el formato del texto, esto se
  // entera: sin efectos, los avisos contra el draft enmudecen SIN fallar.
  ok(tiene('Sea Halberd', 'antiCuracion'), 'Sea Halberd sin efecto anti-curacion');
  ok(tiene('Dominance Ice', 'antiCuracion'), 'Dominance Ice sin efecto anti-curacion');
  ok(tiene('Tough Boots', 'cortaControl'), 'Tough Boots sin efecto de acortar control');
  ok(tiene('Winter Crown', 'cortaControl'), 'Winter Crown sin efecto de acortar control');
  ok(!tiene('Hunter Strike', 'antiCuracion'), 'Hunter Strike no corta curacion y sale como si');

  const conEfectos = objetos.filter((o) => o.efectos?.length).length;
  ok(conEfectos >= 5, `solo ${conEfectos} objetos con efecto leido: el texto ha cambiado de forma`);
});

test('cada heroe lleva su id, tambien los de nombre raro', async () => {
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  if (!(meta.heroes ?? []).length) return;
  const todos = mergeCatalog(cat.heroes, meta.heroes);

  // El retrato se pide por id (./heroes/{id}.jpg). Sin id no hay cara, y como
  // la imagen que falta se quita sola, no fallaria nada: solo desaparecerian
  // las caras de unos cuantos heroes y nadie se enteraria. Justo el fallo que
  // ya costo una version con los counters de X.Borg.
  const sinId = todos.filter((h) => h.id == null).map((h) => h.name);
  ok(!sinId.length, `heroes sin id: ${sinId.slice(0, 8).join(', ')}`);

  // Y los que escriben distinto la API y el catalogo tienen que cuadrar.
  for (const nombre of ['X.Borg', 'Yi Sun-shin', "Chang'e", 'Popol and Kupa']) {
    const h = todos.find((x) => x.name === nombre);
    if (h) ok(h.id != null, `${nombre} se ha quedado sin id: el nombre no cuadra entre API y catalogo`);
  }
});

test('los retratos que la app va a pedir existen de verdad', async () => {
  const { existsSync } = await import('node:fs');
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const conRetrato = (meta.heroes ?? []).filter((h) => h.retrato);
  if (!conRetrato.length) return; // todavia sin retratos

  const faltan = conRetrato.filter((h) => !existsSync(resolve(ROOT, `public/heroes/${h.id}.jpg`)));
  ok(faltan.length <= conRetrato.length * 0.05,
    `faltan ${faltan.length} retratos de ${conRetrato.length}: ${faltan.slice(0, 6).map((h) => h.name).join(', ')}`);

  // Y que sean el retrato pequeño, no el dibujo de cuerpo entero: ese pesa
  // 165 KB por heroe, veintidos megas para los 133, y el repositorio se
  // clona desde un movil.
  const { statSync } = await import('node:fs');
  const pesos = conRetrato
    .filter((h) => existsSync(resolve(ROOT, `public/heroes/${h.id}.jpg`)))
    .map((h) => statSync(resolve(ROOT, `public/heroes/${h.id}.jpg`)).size);
  const medio = pesos.reduce((a, b) => a + b, 0) / pesos.length;
  ok(medio < 60 * 1024, `los retratos pesan ${Math.round(medio / 1024)} KB de media: se ha colado la imagen grande`);
});

test('los motivos que se ensenan estan respaldados por el dato', async () => {
  const { counterScore, indexByName, CRUCE_DESTACABLE, CRUCE_MALO } = await import('../src/engine/score.js');

  // Medir las once reglas por heroe dice que la etiqueta casi nunca predice el
  // efecto que afirma: de los nueve heroes con `anti_mobility` solo Phoveus
  // estorba de verdad a los moviles. Ensenar "bloquea los dashes de X" cuando
  // el cruce real dice que pierdes es explicar mal una decision correcta.
  const yo = { name: 'Khufra', tags: ['anti_mobility', 'engage', 'cc_hard'], roam: true };
  const enemigo = { name: 'Fanny', tags: ['mobile', 'dash', 'assassin'] };

  // 1. El cruce dice que PIERDES: el motivo por tag no se ensena.
  const pierde = counterScore(yo, [enemigo], indexByName({ Khufra: { Fanny: 0.44 } }, 2));
  ok(!pierde.reasons.some((r) => r.good), `ensena una ventaja perdiendo el cruce: ${JSON.stringify(pierde.reasons)}`);

  // 2. El cruce lo respalda: se ensena, y con el dato al lado.
  const gana = counterScore(yo, [enemigo], indexByName({ Khufra: { Fanny: 0.56 } }, 2));
  ok(gana.reasons.some((r) => r.good && r.clave.startsWith('regla.') && r.clave !== 'regla.ganaMatchup'),
    'con el cruce a favor deberia explicar POR QUE, no solo el numero');
  ok(gana.reasons.some((r) => r.clave === 'regla.ganaMatchup'), 'no dice que gana el cruce');

  // 3. SIN dato del cruce la regla es lo unico que hay, y para eso esta: no se
  //    puede exigir que el dato la respalde porque no existe.
  const sinDato = counterScore(yo, [enemigo], indexByName({}, 2));
  ok(sinDato.reasons.some((r) => r.good), 'un heroe recien salido se queda sin ningun motivo');
});

test('el analisis avisa del peor cruce del draft cuando el dato lo dice', async () => {
  const { analizarDraft } = await import('../src/engine/analisis.js');
  const { CRUCE_MALO } = await import('../src/engine/score.js');

  // Lo destapo una partida perdida: la app tenia el dato de que ese pick perdia
  // un cruce importante y NO lo decia en el analisis, solo como etiqueta
  // pequena en la tarjeta. El umbral exigia bajar de 0.47, que es el percentil
  // 1,6% de los cruces reales: con un draft completo el analisis sacaba UNA
  // frase.
  const yo = { name: 'Minotaur', tags: ['tanky', 'engage', 'cc_hard'], roam: true };
  const malo = { name: 'Ixia', tags: ['poke'] };
  const neutro = { name: 'Vale', tags: ['burst'] };
  const ranked = [{ hero: yo, score: 0.7 }, { hero: { name: 'Atlas', tags: [] }, score: 0.6 }];

  // Un cruce en la cola mala (p10) tiene que avisar.
  const avisa = analizarDraft({
    ranked, enemies: [malo, neutro], allies: [], empate: [], linea: 'roam',
    meta: { counters: indexByName({ Minotaur: { Ixia: CRUCE_MALO - 0.002, Vale: 0.505 } }, 2) },
  });
  ok(avisa.some((f) => f.clave === 'analisis.cuidadoCon' && f.params?.e === 'Ixia'),
    `no avisa de un cruce en el 10% peor: ${JSON.stringify(avisa)}`);

  // Y uno normal, no: si avisara de todo, dejaria de leerse.
  const calla = analizarDraft({
    ranked, enemies: [neutro], allies: [], empate: [], linea: 'roam',
    meta: { counters: indexByName({ Minotaur: { Vale: 0.497 } }, 2) },
  });
  ok(!calla.some((f) => f.clave === 'analisis.cuidadoCon'),
    'avisa de un cruce que esta dentro de lo normal');

  // El umbral es el MISMO que usa el motor para las tarjetas: si se separan,
  // la etiqueta y el analisis dicen cosas distintas del mismo cruce.
  const analisis = readFileSync(resolve(ROOT, 'src/engine/analisis.js'), 'utf8');
  ok(/CRUCE_MALO/.test(analisis),
    'el analisis tiene su propio umbral: acabara diciendo algo distinto que la tarjeta');
});

test('el umbral de "ganas el cruce" sale de la distribucion, no de una intuicion', async () => {
  const { CRUCE_DESTACABLE, CRUCE_MALO, indexByName, matchup } = await import('../src/engine/score.js');
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const C = indexByName(meta.counters, 2);
  const nombres = (meta.heroes ?? []).map((h) => h.name);
  if (nombres.length < 100) return;

  const v = [];
  for (const a of nombres) for (const b of nombres) {
    if (a === b) continue;
    const x = matchup(C, a, b);
    if (x != null) v.push(x);
  }
  const porEncima = v.filter((x) => x >= CRUCE_DESTACABLE).length / v.length;
  const porDebajo = v.filter((x) => x <= CRUCE_MALO).length / v.length;

  // El umbral tiene que caer en la COLA de la distribucion real, no donde a
  // uno le suene bien. Estuvo en 0.53, que es el percentil 99: el motivo
  // respaldado por datos salia en el 1,6% de los cruces y en su lugar se leian
  // los de los tags, que es lo que la app tenia peor fundado.
  ok(porEncima > 0.04 && porEncima < 0.20,
    `"ganas el cruce" sale en el ${(porEncima * 100).toFixed(1)}% de los cruces: no esta en la cola`);
  ok(porDebajo > 0.04 && porDebajo < 0.20,
    `"pierdes el cruce" sale en el ${(porDebajo * 100).toFixed(1)}% de los cruces: no esta en la cola`);
  // Y simetricos: no hay razon para avisar mas de lo malo que de lo bueno.
  ok(Math.abs(porEncima - porDebajo) < 0.03, 'los dos umbrales no cubren la misma cola');

  // Las PAREJAS tienen su propia distribucion y no valen los numeros de los
  // cruces: p90 = 0.5100 frente a 0.5154. Tambien estuvo en 0.53, que aqui es
  // el percentil 99: "combina bien con X" salia en el 1,3% de las parejas.
  const { PAREJA_DESTACABLE, sinergia } = await import('../src/engine/score.js');
  const S = indexByName(meta.synergies, 2);
  const par = [];
  for (let i = 0; i < nombres.length; i++) {
    for (let j = i + 1; j < nombres.length; j++) {
      const x = sinergia(S, nombres[i], nombres[j]);
      if (x != null) par.push(x);
    }
  }
  const buenas = par.filter((x) => x >= PAREJA_DESTACABLE).length / par.length;
  ok(buenas > 0.04 && buenas < 0.20,
    `"combina bien" sale en el ${(buenas * 100).toFixed(1)}% de las parejas: no esta en la cola`);
  ok(PAREJA_DESTACABLE !== CRUCE_DESTACABLE,
    'las parejas usan el umbral de los cruces: son distribuciones distintas');
});

test('el motivo de maestria se mide contra TU nivel, no contra un 55% fijo', async () => {
  const { masteryScore, tuNivel, priorDeMaestria } = await import('../src/engine/score.js');

  // Es el mismo fallo que ya se arreglo en la NOTA de maestria y que se habia
  // quedado vivo en el MOTIVO: un umbral absoluto (>=0.55) no significa lo
  // mismo para un jugador del 53% que para uno del 45%.
  const motivos = (mast, hero) => {
    const nivel = tuNivel(mast);
    return masteryScore({ name: hero }, mast, nivel, priorDeMaestria(mast, nivel))
      .reasons.map((r) => r.clave);
  };
  const g = 300;

  // Jugador del 53%: seis heroes repartidos alrededor de lo suyo.
  const bueno = {
    flojo: { games: g, winRate: 0.46 }, medio: { games: g, winRate: 0.53 },
    justo: { games: g, winRate: 0.55 }, crack: { games: g, winRate: 0.62 },
    x: { games: g, winRate: 0.50 }, y: { games: g, winRate: 0.57 },
  };
  // 55% es practicamente su media: antes salia "lo llevas al 55%" como si
  // destacara, y no destaca nada.
  ok(!motivos(bueno, 'justo').includes('regla.maestriaBuena'),
    'a un jugador del 53% le dice que lleva bien un heroe que esta en su media');
  ok(motivos(bueno, 'crack').includes('regla.maestriaBuena'), 'no le reconoce su mejor heroe');
  ok(motivos(bueno, 'flojo').includes('regla.maestriaMala'), 'no le avisa de su peor heroe');

  // Jugador del 45%: su mejor heroe merece salir aunque no llegue al 55%.
  // Antes NUNCA se le reconocia ninguno.
  const flojo = {
    peor: { games: g, winRate: 0.38 }, medio: { games: g, winRate: 0.45 },
    bueno: { games: g, winRate: 0.53 }, x: { games: g, winRate: 0.42 },
    y: { games: g, winRate: 0.48 }, z: { games: g, winRate: 0.44 },
  };
  ok(motivos(flojo, 'bueno').includes('regla.maestriaBuena'),
    'a un jugador del 45% no le reconoce nunca su mejor heroe, porque no llega al 55%');
  ok(motivos(flojo, 'peor').includes('regla.maestriaMala'), 'no le avisa de su peor heroe');
  eq(motivos(flojo, 'medio').length, 0, 'saca motivo de un heroe que esta en su media');

  // Y se decide con el estimado ENCOGIDO: la evidencia debil no sale y la
  // fuerte si. Antes era al reves: 20 partidas al 60% sacaban motivo (12
  // victorias contra 10,6 esperadas: nada) y 300 al 57% no.
  const conNuevo = (n, wr) => ({ ...bueno, nuevo: { games: n, winRate: wr } });
  ok(!motivos(conNuevo(20, 0.60), 'nuevo').includes('regla.maestriaBuena'),
    '20 partidas al 60% no son evidencia de nada y saca motivo');
  // (62%, no 59%: con este perfil el nivel es 54,4% y σ 4,2 puntos, asi que
  // 59% encogido se queda a +3,1, por debajo de una desviacion. Primera version
  // de esta prueba pedia 59% y era la prueba la que estaba mal, no el motor.)
  ok(motivos(conNuevo(300, 0.62), 'nuevo').includes('regla.maestriaBuena'),
    '300 partidas al 62% son una senal real y no saca motivo');
  ok(!motivos(conNuevo(5, 1.0), 'nuevo').includes('regla.maestriaBuena'),
    'cinco partidas ganadas disparan el motivo');
});

test('ningun 0.53 escrito a mano suelto en el motor', async () => {
  // Tres veces ha aparecido el mismo 0.53 en sitios distintos -counters,
  // analisis del draft y sinergias- y las tres es el percentil 99 de su
  // distribucion, o sea "casi nunca". Es la clase de constante que se copia de
  // un sitio a otro sin volver a medirla.
  const motor = ['src/engine/score.js', 'src/engine/analisis.js']
    .map((f) => readFileSync(resolve(ROOT, f), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')          // sin comentarios de bloque
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  const sueltos = [...motor.matchAll(/(?:>=|<=|>|<)\s*(0\.4[0-9]+|0\.5[0-9]+)\b/g)]
    .map((m) => m[1])
    .filter((v) => Number(v) !== 0.5); // 0.5 es el empate, no un umbral calibrado
  ok(!sueltos.length,
    `umbrales de cruce escritos a mano: ${[...new Set(sueltos)].join(', ')}. `
    + 'Van como constante medida contra la distribucion, no a ojo.');
});

test('el veredicto no canta victoria antes de tiempo', async () => {
  const { resumen } = await import('../src/engine/registro.js');

  // El caso real de Javi: 11 partidas siguiendo la app al 73% contra un 51,3%
  // histórico. Son +21 puntos, que suena a demostracion y NO lo es: el margen
  // es de ±29. Si esto se ensena como "la app te sube 21 puntos", la siguiente
  // racha lo desmiente y con razon.
  const maestria = { A: { games: 10535, winRate: 0.513 } };
  const partidas = [
    ...Array.from({ length: 8 }, (_, i) => ({ t: i, pick: 'A', recomendados: ['A'], gane: true })),
    ...Array.from({ length: 3 }, (_, i) => ({ t: 100 + i, pick: 'A', recomendados: ['A'], gane: false })),
  ];
  const r = resumen(partidas, maestria);
  ok(r.contraReferencia, 'no calcula la comparacion con 11 partidas');
  ok(r.contraReferencia.dif > 0.15, 'la prueba no esta midiendo el caso que cree');
  ok(!r.contraReferencia.seVe,
    `da por buena una diferencia de ${(r.contraReferencia.dif * 100).toFixed(1)} puntos con margen de ${(r.contraReferencia.margen * 100).toFixed(1)}`);
  ok(r.contraReferencia.faltan > 0, 'no dice cuantas partidas faltan');

  // Y al reves: con muestra de sobra y una diferencia grande, SI se afirma.
  // Si no, el veredicto seria un "no se sabe" perpetuo, que tampoco sirve.
  const muchas = Array.from({ length: 400 }, (_, i) => ({
    t: i, pick: 'A', recomendados: ['A'], gane: i % 100 < 70,
  }));
  const claro = resumen(muchas, maestria);
  ok(claro.contraReferencia.seVe,
    'con 400 partidas al 70% contra un 51% sigue diciendo que no se sabe');

  // Una diferencia pequena con muestra grande tampoco se canta.
  const rozando = Array.from({ length: 400 }, (_, i) => ({
    t: i, pick: 'A', recomendados: ['A'], gane: i % 100 < 53,
  }));
  ok(!resumen(rozando, maestria).contraReferencia.seVe,
    'canta victoria por dos puntos de diferencia');

  // El margen SIEMPRE viaja con la diferencia: quien pinte esto no puede
  // ensenar una sin la otra por descuido.
  ok(Number.isFinite(r.contraReferencia.margen) && r.contraReferencia.margen > 0,
    'la diferencia viene sin margen: el numero solo es publicidad');
});

test('la pantalla del veredicto ensena el margen y la trampa, no solo el numero', async () => {
  const ui = readFileSync(resolve(ROOT, 'src/components/ui.jsx'), 'utf8');
  const { CLAVES } = await import('../src/i18n.js');

  // Tres cosas que no pueden desaparecer de esa pantalla sin que deje de ser
  // honesta: el margen al lado de la diferencia, el "todavia no se sabe"
  // mientras no se distinga, y el aviso de que no esta aleatorizado.
  for (const clave of ['veredicto.dif', 'veredicto.noSeVe', 'veredicto.trampa']) {
    ok(ui.includes(clave), `la pantalla ya no usa ${clave}`);
    ok(CLAVES.includes(clave), `${clave} no existe en los idiomas`);
  }
  // Y que el margen se pinte en la MISMA frase que la diferencia.
  ok(/veredicto\.dif[\s\S]{0,260}margen/.test(ui),
    'el margen se ha separado de la diferencia: el numero solo es publicidad');
});

test('el diagnostico lleva el draft con nombres, para poder reproducir una partida', async () => {
  const { runSelfTest } = await import('../src/engine/selftest.js');

  // Desde que los huecos ensenan la cara y no el nombre, una captura no dice
  // quien estaba enfrente: hubo que reconstruir a medias el draft de una
  // derrota. El diagnostico es lo que Javi pega, asi que tiene que llevarlo.
  const base = {
    catalog: { heroes: cat.heroes }, meta: { heroes: [] },
    metaCtx: { stats: {}, counters: {}, synergies: {} },
    allHeroes: all, roamPool: pool, mastery: {}, partidas: [], linea: 'roam',
    env: { version: '1.0', buildTime: null, rango: 'glory', width: 400, height: 800, storage: true, sw: 'x', sinDatosPersonales: true },
  };
  const draft = {
    enemies: [h('Kadita'), h('Ixia')], allies: [h('Layla')], bans: [],
    rival: 'Kadita', marcado: false,
    ranked: [{ hero: h('Atlas'), score: 0.79, reasons: [{ clave: 'regla.ganaMatchup', params: { e: 'Ixia' } }] }],
    analisis: [{ clave: 'analisis.cuidadoCon', params: { e: 'Ixia', pct: 48 } }],
  };
  const con = runSelfTest({ ...base, draft }).texto;
  for (const esperado of ['DRAFT ACTUAL', 'Kadita', 'Ixia', 'Layla', 'Atlas 79', 'ganaMatchup:Ixia', 'cuidadoCon', 'deducido']) {
    ok(con.includes(esperado), `el diagnostico no lleva "${esperado}"`);
  }
  // Marcado a mano se distingue de deducido: no es lo mismo que la app se
  // equivoque de rival a que lo hayas puesto tu.
  ok(runSelfTest({ ...base, draft: { ...draft, marcado: true } }).texto.includes('marcado a mano'),
    'no distingue el rival marcado a mano del deducido');

  // Sin draft, lo dice y no cuenta como aviso ni fallo.
  const sin = runSelfTest({ ...base, draft: null });
  ok(sin.texto.includes('sin draft'), 'sin draft no lo dice');
  eq(sin.fallos, runSelfTest({ ...base, draft }).fallos, 'el draft cambia el numero de fallos');
});

test('el titular del diagnostico no se contradice ni escribe mal el plural', async () => {
  const { titular } = await import('../src/engine/selftest.js');

  // Decia "Todo correcto (1 avisos)": afirma que esta todo bien Y que hay algo
  // que mirar, y encima en plural. Es la primera linea que se lee con prisa.
  ok(!/correcto/i.test(titular(0, 1)), `dice que todo esta correcto habiendo avisos: ${titular(0, 1)}`);
  ok(/1 aviso\b/.test(titular(0, 1)), `plural mal con un aviso: ${titular(0, 1)}`);
  ok(/3 avisos/.test(titular(0, 3)), `plural mal con tres avisos: ${titular(0, 3)}`);
  eq(titular(0, 0), 'Todo correcto', 'sin fallos ni avisos deberia decir que todo esta bien');
  ok(/1 FALLO\b/.test(titular(1, 0)), `plural mal con un fallo: ${titular(1, 0)}`);
  ok(/2 FALLOS/.test(titular(2, 0)), `plural mal con dos fallos: ${titular(2, 0)}`);
  // Con las dos cosas, las dos se dicen: un fallo no puede tapar los avisos.
  ok(/FALLO/.test(titular(1, 2)) && /aviso/.test(titular(1, 2)), `se pierde algo: ${titular(1, 2)}`);
});

test('la app se actualiza sola cuando sale una version nueva', async () => {
  // Comprobado tambien en un navegador de verdad, con un service worker real y
  // una version nueva publicada con la pestaña abierta: se recarga sola. Aqui
  // se vigila que el mecanismo siga estando, porque `npm test` corre sin
  // navegador y sin esto el fallo seria invisible: la app se quedaria con la
  // version de ayer y todo seguiria "correcto".
  const app = readFileSync(resolve(ROOT, 'src/App.jsx'), 'utf8');

  // Lo imprescindible: recargar cuando el worker nuevo toma el control. Sin
  // esto no se actualiza (medido: quitandolo, la prueba de navegador falla).
  ok(/addEventListener\('controllerchange'/.test(app),
    'nadie recarga cuando el service worker nuevo toma el control: se queda con la version vieja');
  // Y preguntar al volver a la app, que es cuando el navegador no lo hace solo.
  ok(/visibilitychange/.test(app) && /\.update\(\)/.test(app),
    'no se comprueba si hay version nueva al volver a la app');
  // Con pestillo: sin el, un navegador que reinstale el worker podria dejar la
  // pagina recargandose en bucle.
  ok(/yaRecargado/.test(app), 'la recarga no tiene pestillo: podria entrar en bucle');
});

test('el diagnostico avisa si el movil esta usando una version vieja', async () => {
  const { runSelfTest, leerEntorno } = await import('../src/engine/selftest.js');

  // Paso de verdad: el service worker guarda la app entera, asi que Javi vio un
  // diagnostico con los DATOS de hoy y la APP de dos versiones antes, diciendo
  // "todo correcto". Desde el movil no habia forma de enterarse.
  const base = {
    catalog: { heroes: cat.heroes }, meta: { heroes: [] },
    metaCtx: { stats: {}, counters: {}, synergies: {} },
    allHeroes: all, roamPool: pool, mastery: {}, partidas: [], linea: 'roam',
  };
  const env = (version, publicada) => ({
    version, versionPublicada: publicada, buildTime: null, rango: 'glory',
    width: 412, height: 915, standalone: false, storage: true, sw: 'activo',
    sinDatosPersonales: true,
  });

  // Se mira LA LINEA de la version, no el total de avisos: el fixture minimo ya
  // genera otros por su cuenta y contarlos todos mediria otra cosa.
  const avisoVersion = (r) => r.texto.split('\n').filter((l) => /^\[AVISO\].*versión|^\[AVISO\].*publicada/i.test(l));

  const vieja = runSelfTest({ ...base, env: env('1.11.0', '1.12.0') });
  ok(/1\.11\.0.*1\.12\.0/.test(vieja.texto), 'no dice que version tiene y cual hay publicada');
  eq(avisoVersion(vieja).length, 1, 'usar una version vieja no saca aviso');
  ok(vieja.avisos > runSelfTest({ ...base, env: env('1.12.0', '1.12.0') }).avisos,
    'la version vieja no suma un aviso respecto a estar al dia');

  const aldia = runSelfTest({ ...base, env: env('1.12.0', '1.12.0') });
  eq(avisoVersion(aldia).length, 0, 'avisa aunque la version sea la ultima');
  ok(/última publicada/.test(aldia.texto), 'no confirma que esta al dia');

  // Sin red no se puede preguntar: eso NO es un aviso, es no saberlo. Un
  // diagnostico que chilla cuando no hay cobertura deja de leerse.
  const sinRed = runSelfTest({ ...base, env: env('1.12.0', null) });
  eq(avisoVersion(sinRed).length, 0, 'avisa cuando simplemente no ha podido preguntar');
  ok(!/publicada/.test(sinRed.texto), 'habla de la version publicada sin haberla podido leer');

  // Y que exista de verdad el fichero que se consulta: sin el, la comprobacion
  // enmudece para siempre sin que nada falle.
  const vite = readFileSync(resolve(ROOT, 'vite.config.js'), 'utf8');
  ok(/version\.json/.test(vite), 'nadie genera version.json: la comprobacion no puede funcionar');
  const app = readFileSync(resolve(ROOT, 'src/App.jsx'), 'utf8');
  ok(/version\.json/.test(app) && /no-store/.test(app),
    'la app no pide version.json sin cache: leeria la version vieja de la propia cache');
});

test('las imagenes no entran en la precarga del instalador', async () => {
  // Son ~4,6 MB entre iconos y caras. En la precarga, instalar la app pasaria
  // de 1 MB a 5,6 MB de golpe, y de todas ellas un draft usa once. Van fuera y
  // se guardan en cuanto se ven.
  const vite = readFileSync(resolve(ROOT, 'vite.config.js'), 'utf8');
  const glob = vite.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] ?? '';
  ok(glob, 'vite.config.js no fija globPatterns: por defecto precarga TODOS los png');
  ok(!/\bpng\b(?![^,]*icon)/.test(glob.replace(/'icon-\*\.png'/, '')),
    `la precarga sigue metiendo png: ${glob}`);
  ok(/runtimeCaching/.test(vite) && /(objetos|heroes)/.test(vite),
    'las imagenes no tienen regla de cache en tiempo de ejecucion: no funcionarian sin cobertura');
});

test('los iconos que la app va a pedir existen de verdad', async () => {
  const { existsSync } = await import('node:fs');
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  if (!Object.keys(meta.builds ?? {}).length) return;

  // El <img> pide ./objetos/{id}.png. Si el fichero no está, el hueco se quita
  // solo y queda el nombre -no se rompe la pantalla-, pero es un icono menos
  // sin que nadie se entere. Aqui se entera.
  const pedidos = new Set();
  for (const porLinea of Object.values(meta.builds)) {
    for (const lista of Object.values(porLinea)) {
      for (const b of lista) for (const id of b.objetos ?? []) pedidos.add(id);
    }
  }
  const faltan = [...pedidos].filter((id) => !existsSync(resolve(ROOT, `public/objetos/${id}.png`)));
  ok(faltan.length <= pedidos.size * 0.05,
    `faltan ${faltan.length} iconos de ${pedidos.size}: ${faltan.slice(0, 6).join(', ')}`);
});

test('la ingesta no escribe las imagenes en el repositorio cuando va a un temporal', async () => {
  // Mismo fallo que ya costo una version con los datos: la prueba que ejecuta
  // la ingesta escribia en public/data y ensuciaba el repo en cada npm test.
  // Las imagenes tienen que ir donde digan --iconos y --retratos, no a su
  // sitio por defecto.
  const ing = readFileSync(resolve(ROOT, 'scripts/ingest.mjs'), 'utf8');
  ok(/args\.iconos/.test(ing), 'la ingesta no acepta --iconos: los escribiria siempre en public/objetos');
  ok(/args\.retratos/.test(ing), 'la ingesta no acepta --retratos: los escribiria siempre en public/heroes');
  ok(/bajarImagenes\([^)]*,\s*ICONOS,/.test(ing), 'los iconos no usan la ruta configurable');
  ok(/bajarImagenes\([^)]*,\s*RETRATOS,/.test(ing), 'los retratos no usan la ruta configurable');
});

test('la defensa de cada objeto sale del texto del juego, no de su categoria', async () => {
  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  const eq5 = meta.equipment ?? {};
  if (!Object.keys(eq5).length) return; // todavia sin datos de objetos

  const porNombre = Object.fromEntries(Object.values(eq5).map((o) => [o.nombre, o]));

  // Objetos de diseno publico, con su defensa conocida. Si la API cambia el
  // formato de `equiptips`, esto se entera: sin ellos el ajuste defensivo
  // seguiria funcionando en silencio SIN proponer nunca nada.
  ok((porNombre["Athena's Shield"]?.magica ?? 0) > 0, "Athena's Shield sin defensa magica");
  ok(!(porNombre["Athena's Shield"]?.fisica > 0), "Athena's Shield con defensa fisica");
  ok((porNombre['Blade Armor']?.fisica ?? 0) > 0, 'Blade Armor sin defensa fisica');
  ok(!(porNombre['Blade Armor']?.magica > 0), 'Blade Armor con defensa magica');
  ok((porNombre['Dominance Ice']?.magica ?? 0) > 0 && (porNombre['Dominance Ice']?.fisica ?? 0) > 0,
    'Dominance Ice deberia dar las dos defensas');

  // Y el caso que demuestra por que NO vale el tipo del objeto: Tough Boots
  // esta catalogado como "Movement" y da 18 de defensa magica.
  const tough = porNombre['Tough Boots'];
  if (tough) ok((tough.magica ?? 0) > 0, 'Tough Boots sin defensa magica: se esta mirando el tipo, no el texto');

  const conDefensa = Object.values(eq5).filter((o) => o.magica || o.fisica).length;
  ok(conDefensa >= 20, `solo ${conDefensa} objetos con defensa medida: el texto ha cambiado de forma`);
});

test('hay builds para los heroes que de verdad se recomiendan', async () => {
  const { buildsDe, coberturaBuilds } = await import('../src/engine/builds.js');
  const { poolDeLinea, LINEAS } = await import('../src/engine/score.js');
  const { indiceDeLineas } = await import('../src/engine/rival-de-linea.js');

  const meta = JSON.parse(readFileSync(resolve(ROOT, 'public/data/roam-meta.json'), 'utf8'));
  if (!meta.builds || !Object.keys(meta.builds).length) return; // todavia sin builds

  // Lo que importa no es que el fichero tenga builds, sino que las tenga PARA
  // EL POOL DE CADA LINEA. Es el mismo fallo que costo la matriz de counters:
  // 34 heroes con datos de 133 y la app recomendando a ciegas.
  const todos = mergeCatalog(cat.heroes, meta.heroes ?? []);
  const lineas = indiceDeLineas(meta.heroes);
  for (const linea of LINEAS) {
    const pool = poolDeLinea(todos, lineas, linea);
    if (!pool.length) continue;
    const { total, con } = coberturaBuilds(pool, meta.builds, linea);
    ok(con / total >= 0.8, `${linea}: solo ${con} de ${total} heroes del pool tienen build`);
  }

  // Y las builds tienen que traer objetos que estemos en condiciones de
  // nombrar: un id sin nombre sale en pantalla como "#3009".
  const primera = buildsDe(meta.builds, { name: Object.keys(meta.builds)[0] },
    Object.keys(Object.values(meta.builds)[0])[0])[0];
  ok(primera?.objetos?.length, 'la primera build no trae objetos');
  for (const id of primera.objetos) {
    ok(meta.equipment?.[id]?.nombre, `el objeto ${id} no tiene nombre en el catalogo`);
  }
});

test('las builds sobreviven al guardado compacto', async () => {
  const { serializar } = await import('./ingest.mjs');

  const datos = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    counters: {},
    synergies: {},
    equipment: { 3009: { nombre: 'Hunter Strike' } },
    builds: {
      Paquito: {
        exp: [{ objetos: [3009, 2014, 3001], pickRate: 0.13, winRate: 0.5671, emblema: 'Assassin' }],
        jungle: [{ objetos: [3009], pickRate: 0.2, winRate: 0.51 }],
      },
    },
  };
  const vuelta = JSON.parse(serializar(datos));
  eq(vuelta.builds.Paquito.exp[0].objetos.length, 3, 'se pierden objetos al guardar');
  eq(vuelta.builds.Paquito.exp[0].emblema, 'Assassin', 'se pierde el emblema al guardar');
  eq(Object.keys(vuelta.builds.Paquito).length, 2, 'se pierde una linea al guardar');
  eq(vuelta.equipment['3009'].nombre, 'Hunter Strike', 'se pierde el catalogo de objetos');
});

test('una corrida que pierde builds no pasa el filtro', async () => {
  const { comparar } = await import('./comparar-ingesta.mjs');

  const tres = (n) => Array.from({ length: n }, () => ({ objetos: [1, 2, 3] }));
  const base = {
    heroes: [{ name: 'A', lanes: ['exp'], role: 'fighter', damage: { fisico: 3 } }],
    stats: { A: {} }, counters: { A: { B: 0.5 } }, synergies: { A: { B: 0.5 } },
    equipment: { 1: { nombre: 'X' } },
    builds: { A: { exp: tres(3) } },
  };
  eq(comparar(base, base).peores.length, 0, 'una corrida identica se rechaza');

  // El caso que hay que cazar: MISMOS heroes con build, una build cada uno en
  // vez de tres. Contando heroes esto pasaba.
  const pobre = { ...base, builds: { A: { exp: tres(1) } } };
  ok(comparar(pobre, base).peores.some((p) => p.clave === 'builds'),
    'una corrida con un tercio de las builds pasa el filtro');

  ok(comparar({ ...base, equipment: {} }, base).peores.some((p) => p.clave === 'objetos'),
    'una corrida sin catalogo de objetos pasa el filtro');
});

await Promise.all(pendientes); // se esperan de verdad, sin plazos inventados

console.log(`\n${pasadas} pruebas correctas, ${fallos} fallos.`);
process.exit(fallos ? 1 : 0);
