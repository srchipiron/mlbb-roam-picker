import {
  rankRoamers, metaScore, masteryScore, coverage, normName, densidadCounters, matchup, sinergia,
} from './score.js';
import { DEFAULT_WEIGHTS } from './rules.js';
import { resumen, MINIMO_PARA_CONCLUIR, calibracion } from './registro.js';
import { coberturaBuilds } from './builds.js';

/**
 * Autodiagnóstico. Se ejecuta EN EL MÓVIL, contra los datos que tiene la app en
 * ese momento, y devuelve un texto plano para copiar y pegar.
 *
 * Existe porque las pruebas de `npm test` corren contra datos sintéticos en
 * GitHub: comprueban que el motor es correcto, no que la descarga de hoy haya
 * salido bien ni que el móvil esté mostrando lo que debe.
 */

/**
 * La primera línea del informe. Es lo único que Javi lee cuando abre el
 * diagnóstico con prisa, así que tiene que ser cierta de un vistazo: decía
 * "Todo correcto (1 avisos)", que se contradice y encima está mal escrito.
 */
export function titular(fallos, avisos) {
  const nf = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  if (fallos && avisos) return `${nf(fallos, 'FALLO', 'FALLOS')} y ${nf(avisos, 'aviso', 'avisos')}`;
  if (fallos) return nf(fallos, 'FALLO', 'FALLOS');
  if (avisos) return `Sin fallos, ${nf(avisos, 'aviso', 'avisos')}`;
  return 'Todo correcto';
}

const OK = 'OK  ';
const MAL = 'FALLO';
const AVISO = 'AVISO';

export function runSelfTest({ catalog, meta, metaCtx, allHeroes, roamPool, mastery, partidas = [], linea = 'roam', env = {}, draft = null, historial = null, pro = null }) {
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
  // La app que estás usando puede no ser la última: el service worker la guarda
  // entera y los datos se refrescan por su cuenta, así que se ven datos de hoy
  // con la app de ayer. Sin esto no había forma de enterarse desde el móvil, y
  // el diagnóstico decía "todo correcto" enseñando una versión vieja.
  if (env.versionPublicada) {
    check(env.versionPublicada === env.version,
      `Es la última publicada (${env.versionPublicada})`,
      `Estás usando la ${env.version} y la publicada es la ${env.versionPublicada}: cierra la app y vuelve a abrirla`,
      true);
  }

  // ---------- el draft que tienes delante ----------
  // Va aqui, al principio, porque es lo que hace falta para reproducir una
  // partida. Desde que los huecos del draft ensenan la cara y no el nombre,
  // una captura de pantalla no dice quien estaba enfrente: hubo que
  // reconstruir un draft a medias para investigar una derrota. Con esto, pegar
  // el diagnostico basta.
  seccion('DRAFT ACTUAL');
  if (draft && (draft.enemies?.length || draft.allies?.length)) {
    const nombres = (lista) => (lista?.length ? lista.map((h) => h.name).join(', ') : '(nadie)');
    lineas.push(`Línea: ${linea} · rango: ${env.rango ?? '?'}`);
    lineas.push(`Enemigos: ${nombres(draft.enemies)}`);
    lineas.push(`Tu equipo: ${nombres(draft.allies)}`);
    if (draft.bans?.length) lineas.push(`Baneados: ${nombres(draft.bans)}`);
    lineas.push(`Tu rival: ${draft.rival ?? '(sin detectar)'}${draft.marcado ? ' (marcado a mano)' : draft.rival ? ' (deducido)' : ''}`);
    for (const [i, r] of (draft.ranked ?? []).slice(0, 3).entries()) {
      const motivos = (r.reasons ?? []).map((m) => m.clave.replace(/^regla\.|^necesidad\./, '')
        + (m.params?.e ? `:${m.params.e}` : m.params?.a ? `:${m.params.a}` : '')).join(' ');
      lineas.push(`  ${i + 1}. ${r.hero.name} ${Math.round(r.score * 100)}${motivos ? ` · ${motivos}` : ''}`);
    }
    for (const f of draft.analisis ?? []) lineas.push(`  > ${f.clave.replace(/^analisis\./, '')} ${JSON.stringify(f.params ?? {})}`);

    // Por qué gana el nº1: qué componente lo separa del nº2, y por cuánto. Es
    // lo que hace falta para discutir una recomendación en vez de creérsela.
    const [a, b] = draft.ranked ?? [];
    if (a?.contributions && b?.contributions) {
      const dif = Object.entries(a.contributions).map(([k, v]) => [k, v - (b.contributions[k] ?? 0)])
        .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      const margen = ((a.score - b.score) * 100).toFixed(1);
      lineas.push(`Por qué ${a.hero.name} y no ${b.hero.name}: ${margen} puntos de margen · lo decide ${dif[0][0]} (${(dif[0][1] * 100 >= 0 ? '+' : '')}${(dif[0][1] * 100).toFixed(1)})`
        + (dif[1] ? `, luego ${dif[1][0]} (${(dif[1][1] * 100 >= 0 ? '+' : '')}${(dif[1][1] * 100).toFixed(1)})` : ''));
    }
    // La probabilidad estimada con cada uno de los tres, y de dónde sale
    // (ver estimacion.js). Es lo que permite discutir el número, no solo verlo.
    const signo = (v) => (v > 0 ? `+${v}` : `${v}`);
    for (const e of draft.estimaciones ?? []) {
      if (e?.p == null) continue;
      lineas.push(`Estimación con ${e.yo}: ${Math.round(e.p * 100)}% · héroes ${signo(e.puntos.heroes)} · cruces ${signo(e.puntos.cruces)} · parejas ${signo(e.puntos.parejas)} · tú ${signo(e.puntos.tu)} (${e.vistos}/10 a la vista)`);
    }
    // Y la composición de cada lado: de qué pega y qué le falta.
    const comp = (c) => (c?.n ? `${c.n} héroes · físico ${c.dano.fisico} · mágico ${c.dano.magico} · mixto ${c.dano.mixto}`
      + (c.huecos.length ? ` · sin ${c.huecos.join(', ')}` : ' · sin huecos')
      + (c.dobles.length ? ` · doble: ${c.dobles.map((d) => `${d.rol}×${d.n} (${d.pp})`).join(', ')}` : '') : null);
    if (draft.composicion) {
      const m = comp(draft.composicion.mio); const s = comp(draft.composicion.suyo);
      if (m) lineas.push(`Tu equipo (con el nº1): ${m}${draft.composicion.tapa.length ? ` · el nº1 tapa ${draft.composicion.tapa.join(', ')}` : ''}`);
      if (s) lineas.push(`Ellos: ${s}`);
    }
    // Y si aguanta lo que falta por salir (ver robustez.js).
    if (draft.robustez?.lineasAbiertas?.length && a) {
      const r = draft.robustez;
      const top3 = Object.entries(r.cuota).sort((x, y) => y[1] - x[1]).slice(0, 3)
        .map(([n, c]) => `${n} ${Math.round(c * 100)}%`).join(' · ');
      lineas.push(`Líneas enemigas abiertas: ${r.lineasAbiertas.join(', ')} · en ${r.n} finales plausibles, nº1: ${top3}`);
      lineas.push(`  ${a.hero.name} aguanta el ${Math.round((r.cuota[a.hero.name] ?? 0) * 100)}%: ${(r.cuota[a.hero.name] ?? 0) >= 0.5 ? 'pick seguro' : 'depende de lo que saquen'}`);
    }
  } else {
    lineas.push('(sin draft: no hay ningún héroe elegido)');
  }

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

    // Datos que no pueden ser: un winrate del 90%, cuotas de pick que no
    // suman uno, un ban por encima del 100%, una fila de counters plana. La
    // ingesta conserva lo anterior cuando un endpoint falla, así que una API
    // rota no se nota en la forma del fichero: se nota en los VALORES.
    const st = Object.entries(meta.stats ?? {});
    if (st.length) {
      const raros = st.filter(([, v]) => v?.winRate != null && (v.winRate < 0.35 || v.winRate > 0.65)).map(([n]) => n);
      check(!raros.length, 'Winrates dentro de lo posible (35-65%)',
        `Winrates imposibles: ${raros.slice(0, 5).join(', ')} (¿API rota?)`, true);
      const sumaPick = st.reduce((acc, [, v]) => acc + (v?.pickRate ?? 0), 0);
      check(Math.abs(sumaPick - 1) < 0.05, `Cuotas de pick suman ${sumaPick.toFixed(3)}`,
        `Cuotas de pick suman ${sumaPick.toFixed(3)}, no 1: pickRate ya no es cuota y PICKRATE_FIABLE está mal calibrado`, true);
      const banMal = st.filter(([, v]) => v?.banRate > 1 || v?.banRate < 0).map(([n]) => n);
      check(!banMal.length, 'Tasas de ban dentro de 0-100%', `Tasas de ban imposibles: ${banMal.slice(0, 5).join(', ')}`, true);
    }
    const filas = Object.entries(metaCtx.counters ?? {});
    if (filas.length) {
      const planas = filas.filter(([, fila]) => {
        const v = Object.values(fila ?? {}).filter((x) => typeof x === 'number');
        return v.length > 20 && v.every((x) => Math.abs(x - 0.5) < 1e-6);
      }).map(([n]) => n);
      check(!planas.length, 'Ninguna fila de counters plana',
        `Filas de counters planas (todo 0.5): ${planas.slice(0, 5).join(', ')}`, true);
    }

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

  // Objetos y builds. Igual que con los counters: lo que importa no es que el
  // fichero traiga builds, sino que las traiga PARA EL POOL DE TU LINEA. La
  // pantalla de objetos diria "todavia no hay builds" sin distinguir entre
  // "ese heroe no las tiene" y "la descarga se ha caido entera".
  const cb = coberturaBuilds(roamPool, meta?.builds, linea);
  if (Object.keys(meta?.builds ?? {}).length) {
    check(cb.con >= cb.total * 0.8,
      `Builds: ${cb.con}/${cb.total} héroes de tu línea`,
      `Builds: solo ${cb.con} de ${cb.total} héroes de tu línea`,
      true);
    const objetos = Object.values(meta?.equipment ?? {});
    const conDefensa = objetos.filter((o) => o.magica || o.fisica).length;
    // Sin objetos con defensa medida, el ajuste por el draft enmudece SIN
    // fallar: la pantalla sale igual y nunca propone nada.
    check(conDefensa >= 20,
      `Objetos: ${objetos.length} · ${conDefensa} con defensa medida`,
      `Objetos: solo ${conDefensa} con defensa medida de ${objetos.length}: el texto del juego ha cambiado de forma`,
      true);
    const sinNombre = new Set();
    for (const porLinea of Object.values(meta.builds)) {
      for (const lista of Object.values(porLinea)) {
        for (const b of lista) for (const id of b.objetos ?? []) if (!meta.equipment?.[id]) sinNombre.add(id);
      }
    }
    if (sinNombre.size) {
      lineas.push(`  objetos sin nombre en el catálogo: ${[...sinNombre].slice(0, 8).join(', ')}`);
    }
  } else {
    lineas.push('Builds: ninguna todavía (la pantalla de objetos saldrá vacía)');
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

  // ---------- salud estadistica de los datos ----------
  //
  // Estas dos comprobaciones no van en `npm test` a proposito: no miran el
  // codigo, miran los DATOS, y los datos se regeneran dos veces al dia. Una
  // prueba del arnes que dependa de ellos falla por el mundo, no por el
  // repositorio. Aqui, en cambio, es justo lo que toca: la vigilancia corre
  // esto contra lo publicado y avisa si la fuente cambia de comportamiento.
  if (metaCtx.counters && metaCtx.stats) {
    const nombres = Object.keys(meta?.stats ?? {});
    const med = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const desv = (a) => Math.sqrt(a.reduce((s, x) => s + (x - med(a)) ** 2, 0) / (a.length - 1));

    // 1. Que las transformaciones no aplasten datos contra el tope. Un clamp
    //    se come informacion en silencio: dos cruces distintos salen iguales.
    const recorte = (leer, lo, ancho) => {
      let n = 0; let fuera = 0;
      for (const a of nombres) {
        for (const b of nombres) {
          if (a === b) continue;
          const v = leer(a, b);
          if (v == null) continue;
          n++;
          const x = (v - lo) / ancho;
          if (x <= 0 || x >= 1) fuera++;
        }
      }
      return n ? fuera / n : 0;
    };
    const rc = recorte((a, b) => matchup(metaCtx.counters, a, b), 0.44, 0.12);
    check(rc < 0.02,
      `Escala de counters bien ajustada (se recorta el ${(rc * 100).toFixed(1)}%)`,
      `Los counters se recortan contra el tope en el ${(rc * 100).toFixed(1)}% de los cruces: se pierde informacion`,
      true);
    if (metaCtx.synergies) {
      const rs = recorte((a, b) => sinergia(metaCtx.synergies, a, b), 0.42, 0.16);
      check(rs < 0.02,
        `Escala de sinergias bien ajustada (se recorta el ${(rs * 100).toFixed(1)}%)`,
        `Las sinergias se recortan contra el tope en el ${(rs * 100).toFixed(1)}% de las parejas`,
        true);
    }

    // 2. Que el ruido siga sin crecer con lo poco jugado que sea el heroe. Es
    //    lo que sostiene PICKRATE_FIABLE: si la fuente pasa a dar estimaciones
    //    temblorosas para los heroes raros, la constante se queda mal calibrada
    //    y hay que volver a medirla.
    const filas = [];
    for (const n of nombres) {
      const pr = meta.stats[n]?.pickRate;
      if (!(pr > 0)) continue;
      const v = nombres.filter((o) => o !== n)
        .map((o) => matchup(metaCtx.counters, n, o)).filter((x) => x != null);
      if (v.length > 50) filas.push({ pr, sd: desv(v) });
    }
    if (filas.length >= 100) {
      filas.sort((a, b) => a.pr - b.pr);
      const corte = Math.floor(filas.length / 4);
      const raros = filas.slice(0, corte);
      const comunes = filas.slice(-corte);
      const razon = med(raros.map((f) => f.sd)) / med(comunes.map((f) => f.sd));
      const siFueraRuido = Math.sqrt(med(comunes.map((f) => f.pr)) / med(raros.map((f) => f.pr)));
      lineas.push(`Ruido: los héroes raros dispersan ${razon.toFixed(2)}x lo que los populares (muestreo puro daría ${siFueraRuido.toFixed(2)}x)`);
      check(razon < 1 + (siFueraRuido - 1) * 0.4,
        'El dato de los héroes poco jugados sigue siendo firme',
        `Los cruces de los héroes raros se han vuelto ruidosos (${razon.toFixed(2)}x): hay que recalibrar PICKRATE_FIABLE`,
        true);
    }
  }

  // ---------- motor ----------
  // ---------- historial ----------
  // La app comparada con SU propio pasado. Un umbral solo salta cuando ya es
  // tarde; una serie enseña la pendiente. Se compara contra la mediana de las
  // últimas corridas, y la holgura sale de la dispersión de la propia serie
  // (MAD), no de un número puesto a mano: si la serie es estable, cualquier
  // desvío pequeño ya es noticia; si baila, hace falta más para avisar.
  seccion('HISTORIAL');
  const filasHist = Array.isArray(historial) ? historial.filter((f) => f && typeof f === 'object') : [];
  if (filasHist.length >= 4 && meta) {
    const pares = (m) => Object.values(m ?? {}).reduce((acc, fila) => acc + Object.keys(fila ?? {}).length, 0);
    const hoy = {
      cruces: pares(meta.counters), sinergias: pares(meta.synergies),
      objetos: Object.keys(meta.equipment ?? {}).length,
      builds: Object.values(meta.builds ?? {}).reduce((acc, p) => acc + Object.values(p ?? {}).reduce((m, l) => m + (l?.length ?? 0), 0), 0),
      heroes: (meta.heroes ?? []).length,
      [`pool ${linea}`]: roamPool.length,
    };
    const ultimas = filasHist.slice(-30);
    lineas.push(`${ultimas.length} corridas anteriores (última ${ultimas[ultimas.length - 1].fecha?.slice(0, 16) ?? '?'})`);
    for (const [clave, valor] of Object.entries(hoy)) {
      const serie = ultimas.map((f) => (clave.startsWith('pool ') ? f.pools?.[linea] : f[clave])).filter((x) => typeof x === 'number');
      if (serie.length < 4) continue;
      const orden = [...serie].sort((x, y) => x - y);
      const mediana = orden[Math.floor(orden.length / 2)];
      const desv = serie.map((x) => Math.abs(x - mediana)).sort((x, y) => x - y);
      const mad = desv[Math.floor(desv.length / 2)];
      // Holgura: 3 MAD, y nunca menos del 2% de la mediana, para que una serie
      // clavada (MAD 0) no chille por un cruce de más o de menos.
      const holgura = Math.max(3 * mad, mediana * 0.02);
      const cae = mediana - valor > holgura;
      check(!cae,
        `${clave}: ${valor} (mediana de la serie ${mediana})`,
        `${clave} ha CAÍDO: ${valor} frente a una mediana de ${mediana} (±${Math.round(holgura)})`,
        true);
    }
    const conFallos = ultimas.filter((f) => f.fallos > 0).length;
    if (conFallos) lineas.push(`Corridas con fallos en la serie: ${conFallos} de ${ultimas.length}`);
  } else {
    lineas.push(filasHist.length ? `Solo ${filasHist.length} corridas: aún no hay serie` : '(sin historial a mano)');
  }

  // ---------- partidas profesionales ----------
  seccion('PROFESIONAL');
  if (!pro) {
    lineas.push('Sin partidas profesionales (public/data/pro.json no llega): la app funciona igual, sin la línea «Pro» de las tarjetas');
  } else {
    lineas.push(`${pro.partidas ?? 0} partidas de ${pro.torneos ?? 0} torneos desde ${pro.desde ?? '?'} (${pro.primera ?? '?'} → ${pro.ultima ?? '?'}) · ${pro.total ?? '?'} guardadas en total`);
    const edadDias = pro.generatedAt ? (Date.now() - Date.parse(pro.generatedAt)) / 86400e3 : null;
    if (edadDias != null) lineas.push(`Corrida de hace ${edadDias.toFixed(1)} días · ${pro.peticiones ?? '?'} peticiones · ${(pro.errores ?? []).length} errores`);
    for (const e of (pro.errores ?? []).slice(0, 3)) lineas.push(`  ${e}`);
    // La medida del motor contra esas partidas (medir-pro.mjs, en el bot):
    // es lo único que dice si la probabilidad estimada se parece a algo.
    const m = pro.medicion;
    if (m?.terminos?.modelo) {
      const t = m.terminos;
      const f = (r) => `AUC ${r.auc?.toFixed(2)} · pendiente ${r.pendiente?.toFixed(2)} ± ${r.errorPendiente?.toFixed(2)}`;
      lineas.push(`Estimación contra ${m.usables} partidas pro desde ${m.desde}: acierto ${Math.round(t.modelo.acierto * 100)}% · ${f(t.modelo)}`);
      lineas.push(`  héroes ${f(t.heroes)} · cruces ${f(t.cruces)} · parejas ${f(t.parejas)} · lado azul ${Math.round((m.azul ?? 0.5) * 100)}%`);
      // Con muestra, el modelo tiene que distinguir algo: AUC por debajo de
      // 0.5 es que ordena al revés, y eso sí sería un fallo del motor.
      if (m.usables >= 200) {
        check(t.modelo.auc >= 0.5, 'La estimación ordena las partidas pro en el sentido correcto',
          `La estimación ordena las partidas pro AL REVÉS (AUC ${t.modelo.auc?.toFixed(2)} en ${m.usables}): revisar estimacion.js`, true);
      }
    }
    // Un slug que no se reconoce descarta partidas en silencio: que se vea.
    const sinMapear = Object.entries(pro.sinMapear ?? {});
    check(!sinMapear.length, 'Todos los nombres de Liquipedia se reconocen',
      `Nombres de Liquipedia sin reconocer: ${sinMapear.map(([s, n]) => `${s} (${n})`).join(', ')}: añade el alias en ingesta-pro.mjs`, true);
    // Los picks de la ventana tienen que ser los del pool de tu línea: si un
    // héroe con 40 picks pro no está en tu pool, o las líneas de la API o los
    // alias están mal.
    const conPicks = Object.keys(pro.heroes ?? {}).length;
    check(conPicks >= 50 || (pro.partidas ?? 0) < 30, `${conPicks} héroes con presencia profesional`,
      `Solo ${conPicks} héroes con presencia en ${pro.partidas} partidas: la ventana o el mapeo están mal`, true);
  }

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
  const reg = resumen(partidas, mastery);
  // ¿La probabilidad estimada se parece a lo que pasa? Solo con partidas que
  // llevaran la estimación delante. Mientras no haya 20 es una línea; con 20 o
  // más y peor que una moneda, es un aviso: el modelo no sirve para ti.
  if (!env.sinDatosPersonales) {
    const cal = calibracion(partidas);
    if (cal.n) {
      const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
      lineas.push(`Estimación vs realidad: ${cal.n} partidas · previsto ${pct(cal.prevista)} · ganadas ${pct(cal.real)} · Brier ${cal.brier.toFixed(3)} (moneda 0.250)`);
      lineas.push(`  con ≥50% ganadas ${pct(cal.altas.real)} de ${cal.altas.n} · con <50% ganadas ${pct(cal.bajas.real)} de ${cal.bajas.n}`);
      if (cal.concluyente) {
        check(cal.brier < cal.brierMoneda, 'La estimación acierta más que una moneda en tus partidas',
          `La estimación acierta MENOS que una moneda en tus ${cal.n} partidas (Brier ${cal.brier.toFixed(3)}): no te fíes del porcentaje`, true);
      } else {
        lineas.push(`  faltan ${cal.faltan} partidas con estimación para juzgarla`);
      }
    }
  }
  lineas.push(env.sinDatosPersonales
    ? 'Sin acceso: las partidas viven en el móvil'
    : `Apuntadas: ${reg.total}`);
  if (reg.total && !env.sinDatosPersonales) {
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    lineas.push(`Siguiendo la recomendación: ${reg.siguiendo} · ganadas ${pct(reg.wrSiguiendo)}`);
    lineas.push(`Por libre: ${reg.porLibre} · ganadas ${pct(reg.wrPorLibre)}`);
  }
  // Todo esto son LÍNEAS, no avisos. No hay nada que arreglar: es que aún no
  // has jugado bastante. Un aviso encendido de forma permanente deja de avisar,
  // que es el error que ya tenía el umbral de cobertura de counters.
  if (!env.sinDatosPersonales) {
    lineas.push(reg.concluyente
      ? `Siguiendo/por libre: hay muestra en las dos ramas (${MINIMO_PARA_CONCLUIR}+ de cada)`
      : `Siguiendo/por libre: faltan ${reg.faltan}, y la rama "por libre" solo crece si ignoras la app a propósito`);

    // La comparación que SÍ se puede llenar jugando: contra tu winrate de
    // siempre, que ya son miles de partidas. La otra pide que juegues peor 28
    // veces para completar la muestra, y eso no va a pasar.
    if (reg.contraReferencia) {
      const c = reg.contraReferencia;
      const signo = c.dif >= 0 ? '+' : '';
      lineas.push(`Contra tu winrate de siempre (${(c.base * 100).toFixed(1)}% en ${c.partidasBase} partidas): `
        + `${signo}${(c.dif * 100).toFixed(1)} puntos ± ${(c.margen * 100).toFixed(1)}`);
      lineas.push(c.seVe
        ? 'Esa diferencia ya se distingue del azar'
        : `Aún no se distingue del azar: harían falta ~${c.faltan} partidas más siguiendo la app`);
    } else if (reg.siguiendo < 5 && !reg.referencia) {
      lineas.push('Sin maestría apuntada no hay contra qué comparar: rellena "Tu maestría"');
    }
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
    // "Todo correcto (1 avisos)" se contradecía a sí mismo: si hay algo que
    // mirar, la cabecera no puede decir que está todo bien. Y el plural, que se
    // lee cada vez que abres esto.
    titular(fallos, avisos),
  ];

  return { texto: [...cabecera, ...lineas].join('\n'), fallos, avisos };
}

/** Datos del entorno que solo existen en el navegador. */
export function leerEntorno({ version, buildTime, rango, publicada = null }) {
  let storage = false;
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    storage = true;
  } catch { /* modo incógnito o bloqueado */ }

  return {
    version,
    versionPublicada: publicada?.version ?? null,
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
