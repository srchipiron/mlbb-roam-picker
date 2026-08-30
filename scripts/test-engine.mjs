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
const test = (nombre, fn) => {
  try {
    const r = fn();
    // Algunas pruebas necesitan import() dinámico y devuelven una promesa.
    if (r instanceof Promise) {
      r.then(() => { pasadas++; }).catch((err) => {
        fallos++;
        console.error(`  FALLA  ${nombre}\n         ${err.message}`);
      });
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

test('se deduce quién es el roamer enemigo, y se calla si hay duda', async () => {
  const { detectarRoamEnemigo, indiceDeLineas } = await import('../src/engine/roam-enemigo.js');

  const info = indiceDeLineas([
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
  ]);

  // Draft real: solo Angela hace roam.
  ok(detectarRoamEnemigo(['Fredrinn', 'Angela', 'Zilong', 'Kagura', 'Claude'].map(h), info) === 'Angela',
    'no reconoce a Angela como su roam');

  // Draft real con DOS candidatos: equivocarse duplica el peso del matchup malo,
  // así que callarse es la respuesta correcta.
  ok(detectarRoamEnemigo(['Melissa', 'Argus', 'Saber', 'Minotaur', 'Floryn'].map(h), info) === null,
    'se moja habiendo dos roamers posibles');

  ok(detectarRoamEnemigo(['Kagura', 'Claude', 'Zilong', 'Saber', 'Argus'].map(h), info) === null,
    'inventa un roam donde no hay ninguno');

  // Sin datos de la API debe seguir funcionando con el catálogo.
  ok(detectarRoamEnemigo(['Fredrinn', 'Angela', 'Zilong', 'Kagura', 'Claude'].map(h), new Map()) === 'Angela',
    'sin datos de líneas no acierta ni con el catálogo');
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
  const stats = indexByName(Object.fromEntries(
    all.map((x) => [x.name, { winRate: 0.497 + (rnd() - 0.5) * 0.05, matches: 5000 }])));
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

test('ningún héroe acapara las recomendaciones', () => {
  // Con su propio generador y varios sorteos de winrates: si dependiera de un
  // único sorteo, el resultado cambiaría según cuántas pruebas corran antes.
  const otros = all.filter((x) => !x.roam);
  const cuotas = [];

  for (let sorteo = 0; sorteo < 5; sorteo++) {
    let semilla = 1000 + sorteo * 77;
    const r = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const stats = indexByName(Object.fromEntries(
      all.map((x) => [x.name, { winRate: 0.497 + (r() - 0.5) * 0.05, matches: 5000 }])));
    const meta = { stats, patchAvgWinRate: 0.497 };
    // Fisher-Yates. Con `sort(() => r() - 0.5)` el barajado está sesgado hacia
    // el orden original, así que salían casi siempre los mismos enemigos y la
    // concentración medida era mayor que la real.
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
      const top = rankRoamers(pool, { enemies: pick(otros, 3), allies: pick(otros, 3), meta })[0].hero.name;
      cuenta[top] = (cuenta[top] ?? 0) + 1;
    }
    cuotas.push(Math.max(...Object.values(cuenta)) / 100);
  }

  const media = cuotas.reduce((a, b) => a + b, 0) / cuotas.length;
  // Algo de concentración es normal: un roamer completo y con buen winrate
  // merece salir a menudo. Lo que no vale es lo de antes, un 94% fijo.
  ok(media < 0.55, `el líder acapara de media el ${Math.round(media * 100)}% (${cuotas.map((c) => Math.round(c * 100)).join(', ')})`);
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
    for (const t of new Set(r.reasons.map((x) => x.text))) {
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
  const salida = execFileSync('node', [
    resolve(ROOT, 'scripts/ingest.mjs'), '--base', 'http://127.0.0.1:1/api', '--ranks', 'mythic',
  ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });

  ok(!/is not defined|is not a function|Cannot read/.test(salida),
    `error de programación en la ingesta: ${salida.split('\n').find((l) => /is not/.test(l))}`);
  ok(salida.includes('Escrito'), 'no llega a escribir el fichero cuando la red falla');
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

await new Promise((r) => setTimeout(r, 60)); // deja terminar la prueba asíncrona

console.log(`\n${pasadas} pruebas correctas, ${fallos} fallos.`);
process.exit(fallos ? 1 : 0);
