import { useEffect, useMemo, useState } from 'react';
import { rankRoamers, mergeCatalog, suggestBans, indexByName, coverage, empatados } from './engine/score.js';
import { Side, HeroSheet, Pick, Legend, MasteryEditor, RankPicker, BanSuggestions } from './components/ui.jsx';

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
  const [enemies, setEnemies] = useState(() => load(DRAFT_KEY, {}).enemies ?? []);
  const [allies, setAllies] = useState(() => load(DRAFT_KEY, {}).allies ?? []);
  const [bans, setBans] = useState(() => load(DRAFT_KEY, {}).bans ?? []);
  const [rank, setRank] = useState(() => load(RANK_KEY, null));
  const [sheet, setSheet] = useState(null); // 'enemy' | 'ally' | 'ban'

  const [mastery, setMastery] = useState(() => load(MASTERY_KEY, {}));
  const [editingMastery, setEditingMastery] = useState(false);

  const saveMastery = (next) => { setMastery(next); save(MASTERY_KEY, next); };

  useEffect(() => { save(DRAFT_KEY, { enemies, allies, bans }); }, [enemies, allies, bans]);
  useEffect(() => { if (rank) save(RANK_KEY, rank); }, [rank]);

  useEffect(() => {
    const load = async (path) => {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    load('./data/heroes.json').then(setCatalog).catch((e) => setError(e.message));
    // El meta puede faltar en el primer arranque: la app sigue siendo útil sin él.
    load('./data/roam-meta.json').then(setMeta).catch(() => setMeta(null));
  }, []);

  // Catálogo escrito a mano + todo lo que conozca la API, con tags deducidos
  // del rol. Así ningún héroe del juego se queda fuera del selector.
  const allHeroes = useMemo(
    () => (catalog ? mergeCatalog(catalog.heroes, meta?.heroes) : []),
    [catalog, meta],
  );

  const roamPool = useMemo(() => allHeroes.filter((h) => h.roam), [allHeroes]);

  const taken = useMemo(
    () => new Set([...enemies, ...allies, ...bans].map((h) => h.name)),
    [enemies, allies, bans],
  );

  const activeRank = rank && meta?.statsByRank?.[rank] ? rank : meta?.rank;

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
    () => (catalog ? rankRoamers(roamPool, { enemies, allies, bans, mastery, meta: metaCtx }) : []),
    [catalog, roamPool, metaCtx, enemies, allies, bans, mastery],
  );

  const empate = useMemo(() => empatados(ranked), [ranked]);

  const banIdeas = useMemo(
    () => (catalog && metaCtx.stats
      ? suggestBans(allHeroes, { allies, enemies, bans, meta: metaCtx })
      : []),
    [catalog, allHeroes, allies, enemies, bans, metaCtx],
  );

  const addTo = (hero) => {
    const setter = { enemy: setEnemies, ally: setAllies, ban: setBans }[sheet];
    setter?.((prev) => [...prev, hero]);
    setSheet(null);
  };

  const remove = (setter) => (hero) =>
    setter((prev) => prev.filter((h) => h.name !== hero.name));

  const reset = () => { setEnemies([]); setAllies([]); setBans([]); };

  const ageHours = meta ? (Date.now() - new Date(meta.generatedAt)) / 3.6e6 : null;

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
            {meta ? `${Math.round(ageHours)}h` : 'sin datos meta'}
          </span>
        </div>

        <Side title="Enemigos" kind="enemy" picks={enemies} max={5}
              onAdd={() => setSheet('enemy')} onRemove={remove(setEnemies)} />
        <Side title="Tu equipo" kind="ally" picks={allies} max={4}
              onAdd={() => setSheet('ally')} onRemove={remove(setAllies)} />
        <details className="more">
          <summary>Baneos y ajustes</summary>

          <Side title="Baneados" kind="bans" picks={bans} max={6}
                onAdd={() => setSheet('ban')} onRemove={remove(setBans)} />

          <div className="side" >
            <div className="side-label"><span>Rango</span></div>
            <RankPicker ranks={meta?.ranks} value={activeRank} onChange={setRank} />
          </div>

          <BanSuggestions items={banIdeas} onBan={(h) => setBans((p) => [...p, h])} />
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
          <Pick key={r.hero.name} result={r} index={i} stat={metaCtx.stats?.[r.hero.name]} />
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

      {sheet && (
        <HeroSheet
          heroes={allHeroes}
          taken={taken}
          onPick={addTo}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
