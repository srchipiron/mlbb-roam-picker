import { useEffect, useMemo, useState } from 'react';
import { rankRoamers, mergeCatalog, suggestBans, indexByName, coverage, empatados, normName } from './engine/score.js';
import { Side, HeroSheet, Pick, Legend, MasteryEditor, RankPicker, BanSuggestions, Footer } from './components/ui.jsx';

const MASTERY_KEY = 'roam-picker:mastery';
const RANK_KEY = 'roam-picker:rank';
const DRAFT_KEY = 'roam-picker:draft';

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
  const [sheet, setSheet] = useState(null); // 'enemy' | 'ally' | 'ban'

  const [mastery, setMastery] = useState(() => load(MASTERY_KEY, {}));
  const [editingMastery, setEditingMastery] = useState(false);

  const saveMastery = (next) => { setMastery(next); save(MASTERY_KEY, next); };

  useEffect(() => {
    save(DRAFT_KEY, { enemies: enemyNames, allies: allyNames, bans: banNames, enemyRoam });
  }, [enemyNames, allyNames, banNames, enemyRoam]);
  useEffect(() => { if (rank) save(RANK_KEY, rank); }, [rank]);

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

  const roamPool = useMemo(() => allHeroes.filter((h) => h.roam), [allHeroes]);

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
    counters: indexByName(meta?.counters),
    synergies: indexByName(meta?.synergies),
    patchAvgWinRate: meta?.avgByRank?.[activeRank] ?? meta?.patchAvgWinRate ?? 0.5,
  }), [meta, activeRank]);

  const cov = useMemo(
    () => coverage(roamPool, metaCtx.stats, metaCtx.counters),
    [roamPool, metaCtx],
  );

  const ranked = useMemo(
    () => (catalog
      ? rankRoamers(roamPool, { enemies, allies, bans, mastery, meta: metaCtx, enemyRoam })
      : []),
    [catalog, roamPool, metaCtx, enemies, allies, bans, mastery, enemyRoam],
  );

  const empate = useMemo(() => empatados(ranked), [ranked]);

  const banIdeas = useMemo(
    () => (catalog && metaCtx.stats
      ? suggestBans(allHeroes, { allies, enemies, bans, meta: metaCtx })
      : []),
    [catalog, allHeroes, allies, enemies, bans, metaCtx],
  );

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

  const generado = meta?.generatedAt ? new Date(meta.generatedAt) : null;
  const fechaValida = generado && !Number.isNaN(generado.getTime());
  const ageHours = fechaValida ? (Date.now() - generado) / 3.6e6 : null;

  if (error) {
    return (
      <div className="results">
        <p className="notice">No se han podido cargar los datos ({error}). Ejecuta <code>npm run ingest</code> y recarga.</p>
      </div>
    );
  }
  if (!catalog) return <div className="results"><p className="empty-state">Cargando…</p></div>;

  return (
    <div className="app">
      <aside className="draft">
        <div className="brand">
          <h1>Roam</h1>
          <span className={`freshness ${ageHours > 36 ? 'stale' : ''}`}>
            {ageHours != null ? `${Math.round(ageHours)}h` : 'sin datos meta'}
          </span>
        </div>

        <Side title="Enemigos" kind="enemy" picks={enemies} max={5}
              onAdd={() => setSheet('enemy')} onRemove={remove(setEnemyNames)}
              markedName={enemyRoam}
              onMark={(h) => setEnemyRoam((r) => (r === h.name ? null : h.name))}
              markHint="Marca su roam" />
        <Side title="Tu equipo" kind="ally" picks={allies} max={4}
              onAdd={() => setSheet('ally')} onRemove={remove(setAllyNames)} />
        <details className="more">
          <summary>Baneos y ajustes</summary>

          <Side title="Baneados" kind="bans" picks={bans} max={6}
                onAdd={() => setSheet('ban')} onRemove={remove(setBanNames)} />

          <div className="side" >
            <div className="side-label"><span>Rango</span></div>
            <RankPicker ranks={meta?.ranks} value={activeRank} onChange={setRank} />
          </div>

          <BanSuggestions items={banIdeas} onBan={(h) => setBanNames((p) => [...p, h.name])} />
        </details>

        <div className="tools">
          <button className="reset" onClick={reset}>Nuevo draft</button>
          <button className="reset" onClick={() => setEditingMastery(true)}>Tu maestría</button>
        </div>
      </aside>

      <main className="results">
        <div className="results-head">
          <h2>Tu pick de roam</h2>
          <span className={`freshness ${cov.withData && cov.withData < cov.total ? 'stale' : ''}`}>
            {cov.withData
              ? `${cov.withData}/${cov.total} con datos · ${cov.conCounters} con counters`
              : `${roamPool.length} roamers`}
          </span>
        </div>

        {!metaCtx.stats || !Object.keys(metaCtx.stats).length ? (
          <div className="notice">
            Sin winrates: el ranking sale solo de composición y counters por rol.
            {meta?.diagnostics && (
              <details className="diag">
                <summary>Ver por qué</summary>
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

        {empate.length > 1 && (
          <p className="tie">
            {empate.map((e) => e.hero.name).join(', ')} están prácticamente igual.
            Coge el que mejor lleves.
          </p>
        )}

        {ranked.slice(0, 8).map((r, i) => (
          <Pick key={r.hero.name} result={r} index={i} stat={metaCtx.stats?.[normName(r.hero.name)]} />
        ))}

        <Legend />
      </main>

      {editingMastery && (
        <MasteryEditor
          pool={roamPool}
          mastery={mastery}
          onChange={saveMastery}
          onClose={() => setEditingMastery(false)}
        />
      )}

      <Footer meta={meta} generado={fechaValida ? generado : null} ageHours={ageHours} rango={activeRank} />

      {sheet && (
        <HeroSheet
          heroes={allHeroes}
          stats={metaCtx.stats}
          taken={taken}
          onPick={addTo}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
