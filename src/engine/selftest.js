import {
  rankRoamers, metaScore, masteryScore, coverage, normName, densidadCounters, matchup,
} from './score.js';
import { DEFAULT_WEIGHTS } from './rules.js';
import { resumen, MINIMO_PARA_CONCLUIR } from './registro.js';

/**
 * Autodiagnóstico. Se ejecuta EN EL MÓVIL, contra los datos que tiene la app en
 * ese momento, y devuelve un texto plano para copiar y pegar.
 *
 * Existe porque las pruebas de `npm test` corren contra datos sintéticos en
 * GitHub: comprueban que el motor es correcto, no que la descarga de hoy haya
 * salido bien ni que el móvil esté mostrando lo que debe.
 */

const OK = 'OK  ';
const MAL = 'FALLO';
const AVISO = 'AVISO';

export function runSelfTest({ catalog, meta, metaCtx, allHeroes, roamPool, mastery, partidas = [], linea = 'roam', env = {} }) {
  const lineas = [];
  let fallos = 0;
  let avisos = 0;

  const add = (estado, texto) => {
    if (estado === MAL) fallos++;
    if (estado === AVISO) avisos++;
    lineas.push(`[${estado}] ${texto}`);
  };
  const check = (cond, bien, mal, blando = false) =>
    add(cond ? OK : (blando ? AVISO : MAL), cond ? bien : mal);

  const seccion = (t) => lineas.push('', `--- ${t} ---`);

  // ---------- entorno ----------
  seccion('ENTORNO');
  lineas.push(`Versión: ${env.version ?? '?'} · compilada ${env.buildTime ?? '?'}`);
  lineas.push(`Pantalla: ${env.width}x${env.height} · ${env.width > env.height ? 'horizontal' : 'vertical'}`);
  lineas.push(`Instalada como app: ${env.standalone ? 'sí' : 'no'}`);
  check(env.storage, 'Almacenamiento local disponible',
    'Sin almacenamiento local: no se guardan maestría ni draft');
  lineas.push(`Service worker: ${env.sw ?? 'desconocido'}`);

  // ---------- datos ----------
  seccion('DATOS');
  check(!!catalog?.heroes?.length,
    `Catálogo: ${catalog?.heroes?.length ?? 0} héroes`,
    'Catálogo vacío o no cargado');
  check(roamPool.length > 0,
    `Línea ${linea}: ${roamPool.length} héroes en el pool`,
    `Línea ${linea}: pool VACÍO, no hay nada que recomendar`);

  if (!meta) {
    add(MAL, 'roam-meta.json no cargado: la app va solo con reglas por tags');
  } else {
    const gen = new Date(meta.generatedAt);
    const horas = (Date.now() - gen) / 3.6e6;
    lineas.push(`Generado: ${gen.toLocaleString('es-ES')} (hace ${Math.round(horas)} h)`);
    check(horas < 36, 'Datos frescos', `Datos de hace ${Math.round(horas)} h: la actualización automática puede estar rota`, true);
    lineas.push(`Rangos: ${meta.ranks?.join(', ') || 'ninguno'} · activo: ${env.rango ?? '?'}`);
  if (meta.coberturaPorLinea) {
    lineas.push('Cobertura por línea: ' + Object.entries(meta.coberturaPorLinea)
      .map(([l, c]) => `${l} ${c.conCounters}/${c.total}`).join(' · '));
  }
    lineas.push(`Ventana: ${meta.days ?? '?'} días · héroes con estadísticas: ${meta.heroCount ?? 0}`);
    lineas.push(`API: ${meta.diagnostics?.base ?? 'desconocida'}`);

    for (const [r, v] of Object.entries(meta.diagnostics?.rangos ?? {})) {
      if (String(v).startsWith('fallo')) add(AVISO, `Rango ${r}: ${v}`);
    }
  }

  // ---------- cobertura ----------
  seccion('COBERTURA');
  const cov = coverage(roamPool, metaCtx.stats, metaCtx.counters);
  check(cov.withData === cov.total,
    `Winrates: ${cov.withData}/${cov.total} héroes de tu línea`,
    `Winrates: faltan ${cov.missing.length} (${cov.missing.slice(0, 8).join(', ')})`);
  check(cov.conCounters > 0,
    `Counters: ${cov.conCounters}/${cov.total} héroes de tu línea`,
    'Counters: ninguno. El motor usa reglas por tags, no partidas reales');

  if (cov.conCounters) {
    const d = densidadCounters(roamPool, metaCtx.counters, allHeroes);
    lineas.push(`Matriz: ${d.media.toFixed(0)} rivales por roamer de media · cubre el ${(d.cobertura * 100).toFixed(1)}% de los cruces posibles`);
    // El umbral mide la SALUD de la descarga, no la ambición. Desde 1.5.0 la
    // ingesta trae los 132 rivales de cada héroe, no una decena: la ruta que
    // daba cinco seguía existiendo y se elegía sola, así que este número es lo
    // que avisa si volvemos a caer en ella. 60 deja sitio a que la API tenga un
    // mal día sin encender un aviso permanente, y chilla mucho antes de que la
    // app vuelva a decidir con reglas escritas a mano.
    check(d.media >= 60,
      `Matriz completa: ${d.media.toFixed(0)} rivales por héroe`,
      `Solo ${d.media.toFixed(0)} rivales por héroe: la descarga se ha quedado en la ruta corta`,
      true);
  }

  if (!cov.conCounters && meta?.diagnostics) {
    lineas.push(`  ruta counter: ${meta.diagnostics.relations?.rutaCounter ?? 'no encontrada en el esquema'}`);
    for (const e of meta.diagnostics.relations?.errores ?? []) lineas.push(`  ${e}`);
    if (meta.diagnostics.relations?.muestra) {
      lineas.push(`  respuesta tal cual: ${meta.diagnostics.relations.muestra}`);
    }
    if (meta.diagnostics.schema?.heroPaths) {
      lineas.push(`  rutas de héroes en la API: ${meta.diagnostics.schema.heroPaths.join(' ')}`);
    }
  }

  // Nombres de la API que el catálogo no reconoce, y al revés.
  const nombresApi = Object.keys(meta?.statsByRank?.[env.rango] ?? meta?.stats ?? {});
  const catalogoNorm = new Set(catalog?.heroes?.map((h) => normName(h.name)) ?? []);
  const huerfanos = nombresApi.filter((n) => !catalogoNorm.has(normName(n)));
  check(huerfanos.length < 12,
    `Nombres: ${nombresApi.length} de la API, ${huerfanos.length} sin tags propios`,
    `Nombres: ${huerfanos.length} sin casar (${huerfanos.slice(0, 10).join(', ')})`, true);

  // ---------- motor ----------
  seccion('MOTOR');
  const by = new Map(allHeroes.map((h) => [h.name, h]));
  const H = (n) => by.get(n);
  const nombresTop = (enemigos) => rankRoamers(roamPool, {
    enemies: enemigos.map(H).filter(Boolean),
    meta: metaCtx,
    mastery,
  }).slice(0, 5).map((r) => r.hero.name);

  // Hasta 1.5.0 aquí se exigía que contra tres asesinos de dash el nº1 cortara
  // dashes, y contra tres curanderos cortara curación. Eso solo se cumplía
  // porque la matriz de counters cubría el 11% de los cruces: sin dato mandaban
  // las reglas por tags. Con la matriz completa se puede MEDIR la regla, y
  // `scripts/medir-reglas.mjs` dice que los anti-dash promedian 0.5042 contra
  // los dashers y el resto 0.4999. No da para mandar sobre el resto del motor.
  //
  // Lo que sí tiene que cumplirse, y comprueba de verdad que el draft manda:
  // que ante dos equipos enemigos opuestos cambie la RECOMENDACIÓN, no solo el
  // primer nombre. Un héroe puede ser la mejor respuesta a los dos -si está
  // fuerte este parche y además les gana- sin que eso sea un fallo; lo que
  // sería un fallo es que la lista entera fuera la misma.
  const dashes = nombresTop(['Fanny', 'Ling', 'Lancelot']);
  const curacion = nombresTop(['Esmeralda', 'Uranus', 'Thamuz']);
  lineas.push(`Contra dashes: ${dashes.slice(0, 3).join(', ')}`);
  lineas.push(`Contra curación: ${curacion.slice(0, 3).join(', ')}`);

  const comunes = dashes.filter((n) => curacion.includes(n)).length;
  check(comunes < dashes.length,
    `La recomendación cambia según el equipo enemigo (${dashes.length - comunes} de ${dashes.length} distintos)`,
    'MISMA recomendación ante equipos enemigos opuestos: el draft no influye');

  // Y que el componente de counter ordene por el DATO, no por cualquier cosa:
  // quien mejor cruce real tiene contra esos tres tiene que puntuar más alto en
  // counter que quien peor lo tiene. Sin esto el ranking podría moverse por
  // ruido y esta sección seguiría en verde.
  if (metaCtx.counters) {
    const enemigos = ['Fanny', 'Ling', 'Lancelot'].map(H).filter(Boolean);
    const cruce = (hero) => {
      const v = enemigos.map((e) => matchup(metaCtx.counters, hero.name, e.name)).filter((x) => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const conCounter = rankRoamers(roamPool, { enemies: enemigos, meta: metaCtx, mastery })
      .filter((r) => cruce(r.hero) != null)
      .sort((a, b) => b.parts.counter.value - a.parts.counter.value);
    if (conCounter.length >= 4) {
      const mejor = cruce(conCounter[0].hero);
      const peor = cruce(conCounter[conCounter.length - 1].hero);
      check(mejor > peor,
        `El counter ordena por el dato real (${(mejor * 100).toFixed(1)}% vs ${(peor * 100).toFixed(1)}%)`,
        `El counter NO ordena por el dato real: el mejor puntuado cruza al ${(mejor * 100).toFixed(1)}% y el peor al ${(peor * 100).toFixed(1)}%`);
    }
  }

  // Que el winrate esté influyendo de verdad y no todo valga 0.50.
  const valoresMeta = roamPool.map((h) => metaScore(metaCtx.stats?.[normName(h.name)],
    metaCtx.patchAvgWinRate).value);
  const rango = Math.max(...valoresMeta) - Math.min(...valoresMeta);
  check(rango > 0.05,
    `Winrate influye (dispersión ${rango.toFixed(2)})`,
    `Winrate NO influye: todos los héroes puntúan igual (dispersión ${rango.toFixed(2)})`);

  // Riesgo de contrapick: solo se puede calcular con la matriz de counters.
  if (cov.conCounters) {
    const conRiesgo = roamPool
      .map((hero) => ({ hero, r: rankRoamers([hero], { meta: metaCtx, candidatos: allHeroes })[0]?.riesgo }))
      .filter((x) => x.r != null)
      .sort((a, b) => b.r - a.r);
    if (conRiesgo.length) {
      lineas.push(`Más arriesgados como pick ciego: ${conRiesgo.slice(0, 3).map((x) => `${x.hero.name} ${x.r.toFixed(2)}`).join(', ')}`);
    }
  }

  // ---------- maestría ----------
  seccion('MAESTRÍA');
  const conMaestria = Object.keys(mastery ?? {}).length;
  // En la vigilancia automática no hay móvil: la maestría y las partidas viven
  // en el almacenamiento de Javi. Ahí no son un aviso, porque no hay nada que
  // arreglar; si lo fueran, TODOS los informes automáticos vendrían con avisos
  // y dejaríamos de leerlos.
  if (env.sinDatosPersonales) {
    lineas.push('Sin acceso: la maestría vive en el móvil');
  } else {
    check(conMaestria >= 5,
      `${conMaestria} héroes con datos tuyos`,
      `Solo ${conMaestria} héroes con datos tuyos: rellena más para que la app se ajuste a ti`, true);
  }

  if (conMaestria) {
    const [nombre] = Object.keys(mastery);
    const h = H(nombre);
    if (h) {
      const sin = rankRoamers(roamPool, { meta: metaCtx }).findIndex((r) => r.hero.name === nombre);
      const con = rankRoamers(roamPool, { meta: metaCtx, mastery }).findIndex((r) => r.hero.name === nombre);
      const m = mastery[nombre];
      lineas.push(`Ejemplo: ${nombre} ${Math.round(m.winRate * 100)}% en ${m.games} partidas · puesto ${sin + 1} -> ${con + 1}`);
      check(masteryScore(h, mastery).value !== 0.5,
        'Tu maestría se está aplicando',
        'Tu maestría NO se aplica: los nombres guardados no casan con el catálogo');
    }
  }

  // ---------- partidas apuntadas ----------
  seccion('TUS PARTIDAS');
  const reg = resumen(partidas);
  lineas.push(env.sinDatosPersonales
    ? 'Sin acceso: las partidas viven en el móvil'
    : `Apuntadas: ${reg.total}`);
  if (reg.total && !env.sinDatosPersonales) {
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    lineas.push(`Siguiendo la recomendación: ${reg.siguiendo} · ganadas ${pct(reg.wrSiguiendo)}`);
    lineas.push(`Por libre: ${reg.porLibre} · ganadas ${pct(reg.wrPorLibre)}`);
  }
  // Una línea, NO un aviso. No hay nada que arreglar: es que aún no has jugado
  // bastante. Un aviso encendido de forma permanente deja de avisar, que es el
  // error que ya tenía el umbral de cobertura de counters.
  if (!env.sinDatosPersonales) {
    lineas.push(reg.concluyente
      ? `Hay muestra para comparar los dos winrates (${MINIMO_PARA_CONCLUIR}+ de cada tipo)`
      : `Faltan ${reg.faltan} para poder comparar: hasta entonces, no toques los pesos`);
  }

  // ---------- autonomía ----------
  seccion('AUTONOMÍA');
  // Cuánto de la recomendación sale de partidas reales y cuánto de reglas
  // escritas a mano. Las reglas envejecen cuando cambia el juego; los datos no.
  const muestra = rankRoamers(roamPool, {
    enemies: ['Fanny', 'Esmeralda', 'Melissa'].map(H).filter(Boolean),
    allies: ['Cecilion', 'Granger'].map(H).filter(Boolean),
    meta: metaCtx,
    mastery,
  });

  if (muestra.length) {
    const infl = {};
    for (const k of ['meta', 'counter', 'synergy', 'comp', 'mastery']) {
      const v = muestra.map((x) => x.contributions[k] ?? 0);
      infl[k] = Math.max(...v) - Math.min(...v);
    }
    const total = Object.values(infl).reduce((a, b) => a + b, 0) || 1;
    const datos = ((infl.meta + infl.counter + infl.synergy) / total) * 100;
    const reglas = (infl.comp / total) * 100;
    const tuyo = (infl.mastery / total) * 100;

    lineas.push(`Partidas reales: ${datos.toFixed(0)}% · reglas escritas a mano: ${reglas.toFixed(0)}% · tus partidas: ${tuyo.toFixed(0)}%`);
    check(datos >= 60,
      'La recomendación se apoya sobre todo en datos',
      `Solo el ${datos.toFixed(0)}% viene de datos: el resto son reglas que envejecen`);

    const primeros = new Set(muestra.slice(0, 3).map((x) => x.hero.name));
    lineas.push(`Ejemplo (vs Fanny/Esmeralda/Melissa): ${[...primeros].join(', ')}`);
  }

  // ---------- pesos ----------
  seccion('PESOS');
  const suma = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  check(Math.abs(suma - 1) < 0.001, `Suman 1.00`, `Suman ${suma.toFixed(3)}, deberían sumar 1`);
  lineas.push(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(' · '));

  // ---------- resumen ----------
  const cabecera = [
    `MOBILE LEGENDS PICK ASSIST · DIAGNÓSTICO`,
    new Date().toLocaleString('es-ES'),
    fallos ? `${fallos} FALLOS, ${avisos} avisos` : `Todo correcto (${avisos} avisos)`,
  ];

  return { texto: [...cabecera, ...lineas].join('\n'), fallos, avisos };
}

/** Datos del entorno que solo existen en el navegador. */
export function leerEntorno({ version, buildTime, rango }) {
  let storage = false;
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    storage = true;
  } catch { /* modo incógnito o bloqueado */ }

  return {
    version,
    buildTime: buildTime ? new Date(buildTime).toLocaleString('es-ES') : null,
    rango,
    width: window.innerWidth,
    height: window.innerHeight,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    storage,
    sw: 'serviceWorker' in navigator
      ? (navigator.serviceWorker.controller ? 'activo' : 'registrado sin controlar')
      : 'no soportado',
  };
}
