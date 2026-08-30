import {
  rankRoamers, metaScore, masteryScore, coverage, normName,
} from './score.js';
import { DEFAULT_WEIGHTS } from './rules.js';

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

export function runSelfTest({ catalog, meta, metaCtx, allHeroes, roamPool, mastery, env = {} }) {
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
    `Catálogo: ${catalog?.heroes?.length ?? 0} héroes, ${roamPool.length} roamers`,
    'Catálogo vacío o no cargado');

  if (!meta) {
    add(MAL, 'roam-meta.json no cargado: la app va solo con reglas por tags');
  } else {
    const gen = new Date(meta.generatedAt);
    const horas = (Date.now() - gen) / 3.6e6;
    lineas.push(`Generado: ${gen.toLocaleString('es-ES')} (hace ${Math.round(horas)} h)`);
    check(horas < 36, 'Datos frescos', `Datos de hace ${Math.round(horas)} h: la actualización automática puede estar rota`, true);
    lineas.push(`Rangos: ${meta.ranks?.join(', ') || 'ninguno'} · activo: ${env.rango ?? '?'}`);
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
    `Winrates: ${cov.withData}/${cov.total} roamers`,
    `Winrates: faltan ${cov.missing.length} (${cov.missing.slice(0, 8).join(', ')})`);
  check(cov.conCounters > 0,
    `Counters: ${cov.conCounters}/${cov.total} roamers`,
    'Counters: ninguno. El motor usa reglas por tags, no partidas reales');

  if (!cov.conCounters && meta?.diagnostics) {
    lineas.push(`  ruta counter: ${meta.diagnostics.relations?.rutaCounter ?? 'no encontrada en el esquema'}`);
    for (const e of meta.diagnostics.relations?.errores ?? []) lineas.push(`  ${e}`);
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

  const dashes = nombresTop(['Fanny', 'Ling', 'Lancelot']);
  check(dashes.some((n) => H(n)?.tags.includes('anti_mobility')),
    `Contra dashes propone anti-dash: ${dashes.slice(0, 3).join(', ')}`,
    `Contra dashes NO propone anti-dash: ${dashes.join(', ')}`);

  const curacion = nombresTop(['Esmeralda', 'Uranus', 'Thamuz']);
  check(curacion.some((n) => H(n)?.tags.includes('antiheal')),
    `Contra curación propone antiheal: ${curacion.slice(0, 3).join(', ')}`,
    `Contra curación NO propone antiheal: ${curacion.join(', ')}`);

  check(dashes[0] !== curacion[0],
    'La recomendación cambia según el equipo enemigo',
    'MISMA recomendación ante equipos enemigos opuestos: el draft no influye');

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
  check(conMaestria >= 5,
    `${conMaestria} héroes con datos tuyos`,
    `Solo ${conMaestria} héroes con datos tuyos: rellena más para que la app se ajuste a ti`, true);

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

  // ---------- pesos ----------
  seccion('PESOS');
  const suma = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  check(Math.abs(suma - 1) < 0.001, `Suman 1.00`, `Suman ${suma.toFixed(3)}, deberían sumar 1`);
  lineas.push(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(' · '));

  // ---------- resumen ----------
  const cabecera = [
    `ROAM PICKER · DIAGNÓSTICO`,
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
