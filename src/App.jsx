import { useEffect, useMemo, useState } from 'react';
import { rankRoamers, mergeCatalog, suggestBans, indexByName, coverage, empatados, normName, poolDeLinea, LINEAS } from './engine/score.js';
import { runSelfTest, leerEntorno } from './engine/selftest.js';
import { apuntar, olvidar, corregir, maestriaEfectiva } from './engine/registro.js';
import { analizarDraft } from './engine/analisis.js';
import { crearT, idiomaPorDefecto, IDIOMAS } from './i18n.js';
import { detectarRivalDeLinea, indiceDeLineas, frecuenciaDeRoles } from './engine/rival-de-linea.js';
import { Side, HeroSheet, Pick, Legend, MasteryEditor, RankPicker, BanSuggestions, Footer, SelfTest, RegistroPartida, SelectorDeLinea, Analisis, AvisoLegal, Perfil, HistorialPartidas, Build } from './components/ui.jsx';

// OJO: estas claves siguen diciendo 'roam-picker' aunque la app se llame ya
// Mobile Legends Pick Assist. NO se renombran: el almacenamiento del navegador
// va por clave, así que cambiarlas borraría la maestría y las partidas que
// Javi ya tiene guardadas. El nombre bonito va por fuera; esto es plomería.
const MASTERY_KEY = 'roam-picker:mastery';
const RANK_KEY = 'roam-picker:rank';
const DRAFT_KEY = 'roam-picker:draft';
const PARTIDAS_KEY = 'roam-picker:partidas';
const LINEA_KEY = 'roam-picker:linea';
const IDIOMA_KEY = 'roam-picker:idioma';

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo incógnito */ }
};

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  // El draft sobrevive a que Android mate la pestaña al cambiar de app:
  // volver al juego y perder los picks que ya habías metido sería inaceptable.
  // Se guardan NOMBRES, no objetos. Guardar el héroe entero congelaba sus tags:
  // tras una actualización del catálogo, el draft seguía usando los viejos.
  const [enemyNames, setEnemyNames] = useState(() => load(DRAFT_KEY, {}).enemies ?? []);
  const [allyNames, setAllyNames] = useState(() => load(DRAFT_KEY, {}).allies ?? []);
  const [banNames, setBanNames] = useState(() => load(DRAFT_KEY, {}).bans ?? []);
  const [enemyRoam, setEnemyRoam] = useState(() => load(DRAFT_KEY, {}).enemyRoam ?? null);
  const [rank, setRank] = useState(() => load(RANK_KEY, null));
  // La línea que juegas. Sin ella la app no sabe qué recomendarte, así que en
  // el primer arranque se pregunta y ya no se vuelve a preguntar.
  const [linea, setLinea] = useState(() => load(LINEA_KEY, null));
  // El idioma del móvil si lo hablamos; si no, inglés. La app ya no es solo
  // para Javi.
  const [idioma, setIdioma] = useState(() => load(IDIOMA_KEY, null) ?? idiomaPorDefecto());
  const t = useMemo(() => crearT(idioma), [idioma]);
  const [sheet, setSheet] = useState(null); // 'enemy' | 'ally' | 'ban'

  const [partidas, setPartidas] = useState(() => load(PARTIDAS_KEY, []));
  const [apuntando, setApuntando] = useState(false);
  const [eligiendoLinea, setEligiendoLinea] = useState(false);
  const [mastery, setMastery] = useState(() => load(MASTERY_KEY, {}));
  const [editingMastery, setEditingMastery] = useState(false);
  const [verPerfil, setVerPerfil] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const [test, setTest] = useState(null);
  const [verBuild, setVerBuild] = useState(null);

  const saveMastery = (next) => { setMastery(next); save(MASTERY_KEY, next); };

  /**
   * La maestría que ve el motor. Antes solo era la escrita a mano y el registro
   * de partidas no personalizaba NADA: dos cosas que no se hablaban. Ahora
   * apuntar partidas -y meter las de tu historial- mueve la recomendación.
   */
  const maestriaUsada = useMemo(() => maestriaEfectiva(mastery, partidas), [mastery, partidas]);

  const guardarPartidas = (siguiente) => { setPartidas(siguiente); save(PARTIDAS_KEY, siguiente); };

  /**
   * Trae los datos de otro dispositivo. Vienen ya FUNDIDOS con los de aquí
   * (`fundirPerfil`), así que esto solo guarda: no puede borrar nada.
   */
  const traerPerfil = (fundido) => {
    setMastery(fundido.mastery);
    save(MASTERY_KEY, fundido.mastery);
    setPartidas(fundido.partidas);
    save(PARTIDAS_KEY, fundido.partidas);
    if (fundido.rango && !rank) { setRank(fundido.rango); save(RANK_KEY, fundido.rango); }
    if (fundido.linea && !linea) { setLinea(fundido.linea); save(LINEA_KEY, fundido.linea); }
  };

  useEffect(() => {
    save(DRAFT_KEY, { enemies: enemyNames, allies: allyNames, bans: banNames, enemyRoam });
  }, [enemyNames, allyNames, banNames, enemyRoam]);
  useEffect(() => { if (rank) save(RANK_KEY, rank); }, [rank]);
  useEffect(() => { if (linea) save(LINEA_KEY, linea); }, [linea]);
  useEffect(() => { save(IDIOMA_KEY, idioma); }, [idioma]);

  /**
   * Que la app se actualice sola.
   *
   * El service worker guarda la app entera para que funcione sin cobertura, y
   * el navegador solo comprueba si hay una nueva al navegar. Con la pestaña
   * abierta desde hace horas te quedas con la de ayer: pasó, y el diagnóstico
   * tenía que pedirte que cerraras y volvieras a abrir.
   *
   * Aquí se pregunta al volver a la app y una vez por hora, y se recarga en
   * cuanto la nueva toma el control. Recargar no te quita nada: el draft, la
   * maestría y las partidas viven en el almacenamiento del navegador y se
   * guardan en cada cambio.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    // Una sola vez: sin el pestillo, un navegador que reinstale el worker
    // podría dejar la página recargándose en bucle.
    let yaRecargado = false;
    const alCambiar = () => {
      if (yaRecargado) return;
      yaRecargado = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', alCambiar);

    const preguntar = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    preguntar();
    document.addEventListener('visibilitychange', preguntar);
    const cadaHora = setInterval(preguntar, 60 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', alCambiar);
      document.removeEventListener('visibilitychange', preguntar);
      clearInterval(cadaHora);
    };
  }, []);

  useEffect(() => {
    const fetchJson = async (path) => {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    fetchJson('./data/heroes.json').then(setCatalog).catch((e) => setError(e.message));
    // El meta puede faltar en el primer arranque: la app sigue siendo útil sin él.
    fetchJson('./data/roam-meta.json').then(setMeta).catch(() => setMeta(null));
  }, []);

  // Catálogo escrito a mano + todo lo que conozca la API, con tags deducidos
  // del rol. Así ningún héroe del juego se queda fuera del selector.
  const allHeroes = useMemo(
    () => (catalog ? mergeCatalog(catalog.heroes, meta?.heroes) : []),
    [catalog, meta],
  );

  const lineas = useMemo(() => indiceDeLineas(meta?.heroes), [meta]);
  const frecuencias = useMemo(() => frecuenciaDeRoles(meta?.heroes ?? []), [meta]);

  // El pool ya no es "los roamers": son los héroes que se juegan en TU línea,
  // según la API. Se sigue llamando roamPool en las partes que aún no se han
  // renombrado, pero contiene lo que toque según la línea elegida.
  const roamPool = useMemo(
    () => (linea ? poolDeLinea(allHeroes, lineas, linea) : []),
    [allHeroes, lineas, linea],
  );

  const resolve = useMemo(() => {
    const byName = new Map(allHeroes.map((h) => [h.name, h]));
    return (names) => names.map((n) => byName.get(n)).filter(Boolean);
  }, [allHeroes]);

  const enemies = useMemo(() => resolve(enemyNames), [resolve, enemyNames]);
  const allies = useMemo(() => resolve(allyNames), [resolve, allyNames]);
  const bans = useMemo(() => resolve(banNames), [resolve, banNames]);

  const taken = useMemo(
    () => new Set([...enemyNames, ...allyNames, ...banNames]),
    [enemyNames, allyNames, banNames],
  );

  // Si el rango elegido (o el de por defecto) no está en los datos descargados,
  // se cae al primero disponible. Antes se quedaba sin estadísticas y la app
  // mostraba "sin datos" teniéndolos.
  const activeRank = useMemo(() => {
    const disponibles = meta?.statsByRank ?? {};
    if (rank && disponibles[rank]) return rank;
    if (meta?.rank && disponibles[meta.rank]) return meta.rank;
    return Object.keys(disponibles)[0] ?? meta?.rank;
  }, [rank, meta]);

  // Todo se indexa por nombre normalizado: la API y el catálogo escriben algunos
  // héroes distinto y si no, se quedarían sin datos sin dar ningún error.
  const metaCtx = useMemo(() => ({
    stats: indexByName(meta?.statsByRank?.[activeRank] ?? meta?.stats),
    // Profundidad 2: las matrices tienen nombre de heroe en los DOS niveles.
    // Con 1 el segundo se quedaba crudo ("Wanwan"), y todo lo que buscaba ahi
    // por clave normalizada fallaba en silencio.
    counters: indexByName(meta?.counters, 2),
    synergies: indexByName(meta?.synergies, 2),
    patchAvgWinRate: meta?.avgByRank?.[activeRank] ?? meta?.patchAvgWinRate ?? 0.5,
  }), [meta, activeRank]);

  const cov = useMemo(
    () => coverage(roamPool, metaCtx.stats, metaCtx.counters),
    [roamPool, metaCtx],
  );

  // El rival de TU línea, deducido de las líneas que juega cada héroe. Es con
  // quien más vas a chocar, así que su matchup pesa el doble. Lo que marques a
  // mano manda siempre: esto solo rellena el hueco cuando no has tocado nada.
  const roamAuto = useMemo(
    () => detectarRivalDeLinea(enemies, lineas, linea, frecuencias),
    [enemies, lineas, linea, frecuencias],
  );
  const enemyRoamEfectivo = enemyRoam ?? roamAuto;

  const ranked = useMemo(
    () => (catalog
      ? rankRoamers(roamPool, {
        enemies, allies, bans, mastery: maestriaUsada, meta: metaCtx, enemyRoam: enemyRoamEfectivo,
        // Héroes que el enemigo aún podría elegir: base del riesgo de contrapick.
        candidatos: allHeroes.filter((h) => !taken.has(h.name)),
      })
      : []),
    [catalog, roamPool, allHeroes, taken, metaCtx, enemies, allies, bans, maestriaUsada, enemyRoamEfectivo],
  );

  const empate = useMemo(() => empatados(ranked), [ranked]);

  // Dos o tres frases sobre lo que NO se ve en las tarjetas: si ganas tu cruce,
  // quién te va a doler y si estás eligiendo a ciegas.
  const analisis = useMemo(
    () => analizarDraft({
      ranked, enemies, allies, meta: metaCtx,
      rivalLinea: enemyRoamEfectivo, linea, empate,
    }),
    [ranked, enemies, allies, metaCtx, enemyRoamEfectivo, linea, empate],
  );

  const banIdeas = useMemo(
    () => (catalog && metaCtx.stats
      ? suggestBans(allHeroes, { allies, enemies, bans, meta: metaCtx })
      : []),
    [catalog, allHeroes, allies, enemies, bans, metaCtx],
  );

  const lanzarTest = async () => {
    try {
      // Qué versión hay PUBLICADA, sin pasar por la caché. El service worker
      // guarda la app entera, así que se puede estar usando la de ayer con los
      // datos de hoy y el diagnóstico decía "todo correcto" sin poder saberlo.
      // Si no se puede preguntar (sin cobertura), se sigue igual: es un extra.
      let publicada = null;
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) publicada = await res.json();
      } catch { /* sin red: el resto del diagnóstico sigue valiendo */ }

      setTest(runSelfTest({
        catalog, meta, metaCtx, allHeroes, roamPool, mastery: maestriaUsada, partidas,
        linea,
        env: leerEntorno({
          version: __APP_VERSION__, buildTime: __BUILD_TIME__, rango: activeRank, publicada,
        }),
      }));
    } catch (err) {
      // Que el diagnóstico falle no debe dejar la app en blanco: el propio error
      // es información útil, así que se muestra como resultado.
      setTest({ texto: `El diagnóstico ha fallado:\n${err?.stack ?? err}`, fallos: 1, avisos: 0 });
    }
  };

  const addTo = (hero) => {
    const setter = { enemy: setEnemyNames, ally: setAllyNames, ban: setBanNames }[sheet];
    setter?.((prev) => [...prev, hero.name]);
    setSheet(null);
  };

  const remove = (setter) => (hero) => {
    setter((prev) => prev.filter((n) => n !== hero.name));
    setEnemyRoam((r) => (r === hero.name ? null : r));
  };

  const reset = () => {
    setEnemyNames([]); setAllyNames([]); setBanNames([]); setEnemyRoam(null);
  };

  // Apunta la partida y limpia el draft, que es lo que toca justo después.
  const guardarPartida = (pick, gane) => {
    const siguiente = apuntar(partidas, {
      pick, gane, rango: activeRank,
      recomendados: ranked.slice(0, 3).map((r) => r.hero.name),
    });
    setPartidas(siguiente);
    save(PARTIDAS_KEY, siguiente);
    setApuntando(false);
    reset();
  };

  const generado = meta?.generatedAt ? new Date(meta.generatedAt) : null;
  const fechaValida = generado && !Number.isNaN(generado.getTime());
  const ageHours = fechaValida ? (Date.now() - generado) / 3.6e6 : null;

  if (error) {
    return (
      <div className="results">
        <p className="notice">{t('app.errorDatos', { error })}</p>
      </div>
    );
  }
  if (!catalog) return <div className="results"><p className="empty-state">{t('app.cargando')}</p></div>;

  // Primer arranque: sin línea no hay nada que recomendar, así que se pregunta
  // antes de enseñar una pantalla vacía que no se entiende.
  if (!linea) {
    return (
      <div className="app">
        <SelectorDeLinea lineas={LINEAS} valor={null} onElegir={setLinea} t={t} />
        <AvisoLegal t={t} idioma={idioma} onIdioma={setIdioma} idiomas={IDIOMAS} />
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="draft">
        <div className="brand">
          <h1>Roam</h1>
          <span className={`freshness ${ageHours > 36 ? 'stale' : ''}`}>
            {ageHours != null ? `${Math.round(ageHours)}h` : 'sin datos meta'}
          </span>
        </div>

        <Side t={t} title={t('app.enemigos')} kind="enemy" picks={enemies} max={5}
              onAdd={() => setSheet('enemy')} onRemove={remove(setEnemyNames)}
              markedName={enemyRoam}
              onMark={(h) => setEnemyRoam((r) => (r === h.name ? null : h.name))}
              markHint={roamAuto && !enemyRoam ? t('app.tuRival', { nombre: roamAuto }) : t('app.marcarRival')}
              autoName={roamAuto} />
        <Side t={t} title={t('app.tuEquipo')} kind="ally" picks={allies} max={4}
              onAdd={() => setSheet('ally')} onRemove={remove(setAllyNames)} />
        <details className="more">
          <summary>{t('app.ajustes')}</summary>

          <Side t={t} title={t('app.baneados')} kind="bans" picks={bans} max={10}
                onAdd={() => setSheet('ban')} onRemove={remove(setBanNames)} />

          <div className="side" >
            <div className="side-label"><span>{t('app.tuLinea')}</span></div>
            <button className="reset" onClick={() => setEligiendoLinea(true)}>
              {t(`linea.${linea}`)} · {t('app.cambiar')}
            </button>
          </div>

          <div className="side" >
            <div className="side-label"><span>{t('app.rango')}</span></div>
            <RankPicker ranks={meta?.ranks} value={activeRank} onChange={setRank} />
          </div>

          <BanSuggestions t={t} items={banIdeas} onBan={(h) => setBanNames((p) => [...p, h.name])} />

          {/* Lo que se toca UNA VEZ vive aquí dentro. Fuera se quedan los dos
              botones que se usan con una partida delante. Antes estaban los
              cinco fuera, en dos filas, y en un móvil de 844px de alto empujaban
              la primera recomendación hasta y=602: se veían dos. */}
          <div className="tools">
            <button className="reset" onClick={() => setEditingMastery(true)}>{t('app.maestria')}</button>
            <button className="reset" onClick={() => setVerHistorial(true)}>{t('hist.boton')}</button>
            <button className="reset" onClick={() => setVerPerfil(true)}>{t('perfil.boton')}</button>
          </div>

          <button className="reset" style={{ marginTop: '14px' }} onClick={lanzarTest}>
            {t('app.diagnostico')}
          </button>
        </details>

        <div className="tools">
          <button className="reset" onClick={reset}>{t('app.nuevoDraft')}</button>
          <button className="reset" disabled={!ranked.length} onClick={() => setApuntando(true)}>
            {t('app.apuntar')}
          </button>
        </div>
      </aside>

      <main className="results">
        <div className="results-head">
          <h2>{t('app.pick', { linea: t(`linea.${linea}`) })}</h2>
          <span className={`freshness ${cov.withData && cov.withData < cov.total ? 'stale' : ''}`}>
            {/* Estaba escrito a mano en español: salía tal cual dentro de la
                interfaz en inglés. Y decía "roamers" aunque la app sirve para
                las cinco líneas desde 1.0.0. */}
            {cov.withData
              ? t('app.cobertura', { con: cov.withData, total: cov.total, counters: cov.conCounters })
              : t('app.enPool', { n: roamPool.length })}
          </span>
        </div>

        {!metaCtx.stats || !Object.keys(metaCtx.stats).length ? (
          <div className="notice">
            {t('app.sinWinrates')}
            {meta?.diagnostics && (
              <details className="diag">
                <summary>{t('app.verPorQue')}</summary>
                <p>Base: <code>{meta.diagnostics.base ?? 'ninguna'}</code></p>
                {meta.diagnostics.schema && (
                  <p>Esquema: <code>{meta.diagnostics.schema.pathCount} rutas en {meta.diagnostics.schema.url}</code></p>
                )}
                {meta.diagnostics.routes && Object.entries(meta.diagnostics.routes).map(([k, v]) => (
                  <p key={k}><code>{k}: {v}</code></p>
                ))}
                {meta.diagnostics.schema?.sample && !meta.diagnostics.routes && (
                  <p><code>{meta.diagnostics.schema.sample.join(' · ')}</code></p>
                )}
                {meta.diagnostics.failed?.map((f) => <p key={f}><code>{f}</code></p>)}
              </details>
            )}
          </div>
        ) : null}

        {!roamPool.length && (
          <div className="notice">
            {t('app.sinPool', { linea: t(`linea.${linea}`) })}
          </div>
        )}

        {/* El empate lo dice el analisis (`analisis.empatadoCon`), asi que aqui
            ya no se repite: salian las dos frases seguidas diciendo lo mismo
            con otras palabras, y el bloque empujaba la recomendacion fuera de
            la primera pantalla. */}
        <Analisis frases={analisis} t={t} />

        {ranked.slice(0, 8).map((r, i) => (
          <Pick
            key={r.hero.name}
            result={r}
            index={i}
            t={t}
            stat={metaCtx.stats?.[normName(r.hero.name)]}
            onBuild={meta?.builds ? setVerBuild : null}
          />
        ))}

        <Legend t={t} />
        <AvisoLegal t={t} idioma={idioma} onIdioma={setIdioma} idiomas={IDIOMAS} />
      </main>

      {test && <SelfTest resultado={test} onClose={() => setTest(null)} />}

      {verBuild && (
        <Build
          hero={verBuild}
          linea={linea}
          builds={meta?.builds}
          equipment={meta?.equipment}
          enemies={enemies}
          onClose={() => setVerBuild(null)}
          t={t}
        />
      )}

      {eligiendoLinea && (
        <SelectorDeLinea
          lineas={LINEAS}
          valor={linea}
          onElegir={(l) => { setLinea(l); setEligiendoLinea(false); }}
          onClose={() => setEligiendoLinea(false)}
          t={t}
        />
      )}

      {apuntando && (
        <RegistroPartida
          pool={roamPool}
          recomendados={ranked.slice(0, 3).map((r) => r.hero.name)}
          onGuardar={guardarPartida}
          onClose={() => setApuntando(false)}
          t={t}
        />
      )}

      {verHistorial && (
        <HistorialPartidas
          partidas={partidas}
          maestria={maestriaUsada}
          pool={roamPool}
          onOlvidar={(t2) => guardarPartidas(olvidar(partidas, t2))}
          onCorregir={(t2, gane) => guardarPartidas(corregir(partidas, t2, gane))}
          onAnadir={(hero, gane) => guardarPartidas(apuntar(partidas, {
            pick: hero, gane, previa: true, rango: activeRank,
            // Fecha propia para que dos seguidas no colisionen en la clave.
            t: Date.now(),
          }))}
          onClose={() => setVerHistorial(false)}
          t={t}
        />
      )}

      {verPerfil && (
        <Perfil
          datos={{ mastery, partidas, rango: activeRank, linea, idioma }}
          onImportar={traerPerfil}
          onClose={() => setVerPerfil(false)}
          t={t}
        />
      )}

      {editingMastery && (
        <MasteryEditor
          pool={roamPool}
          mastery={mastery}
          onChange={saveMastery}
          onClose={() => setEditingMastery(false)}
          t={t}
        />
      )}

      <Footer
        meta={meta}
        generado={fechaValida ? generado : null}
        ageHours={ageHours}
        rango={activeRank}
        cov={cov}
      />

      {sheet && (
        <HeroSheet
          heroes={allHeroes}
          stats={metaCtx.stats}
          taken={taken}
          onPick={addTo}
          onClose={() => setSheet(null)}
          t={t}
        />
      )}
    </div>
  );
}
