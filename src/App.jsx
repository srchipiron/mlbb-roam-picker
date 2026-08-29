import { useEffect, useMemo, useState } from 'react';
import { rankRoamers, mergeCatalog } from './engine/score.js';
import { Side, HeroSheet, Pick, Legend, MasteryEditor } from './components/ui.jsx';

const MASTERY_KEY = 'roam-picker:mastery';

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  const [enemies, setEnemies] = useState([]);
  const [allies, setAllies] = useState([]);
  const [bans, setBans] = useState([]);
  const [sheet, setSheet] = useState(null); // 'enemy' | 'ally' | 'ban'

  const [mastery, setMastery] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MASTERY_KEY) ?? '{}'); } catch { return {}; }
  });
  const [editingMastery, setEditingMastery] = useState(false);

  const saveMastery = (next) => {
    setMastery(next);
    try { localStorage.setItem(MASTERY_KEY, JSON.stringify(next)); } catch { /* modo incógnito */ }
  };

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

  const ranked = useMemo(() => {
    if (!catalog) return [];
    return rankRoamers(roamPool, {
      enemies, allies, bans, mastery,
      meta: {
        stats: meta?.stats,
        counters: meta?.counters,
        synergies: meta?.synergies,
        patchAvgWinRate: meta?.patchAvgWinRate ?? 0.5,
      },
    });
  }, [catalog, roamPool, meta, enemies, allies, bans, mastery]);

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
            {meta
              ? `${meta.rank} · ${Math.round(ageHours)}h`
              : 'sin datos meta'}
          </span>
        </div>

        <Side title="Enemigos" kind="enemy" picks={enemies} max={5}
              onAdd={() => setSheet('enemy')} onRemove={remove(setEnemies)} />
        <Side title="Tu equipo" kind="ally" picks={allies} max={4}
              onAdd={() => setSheet('ally')} onRemove={remove(setAllies)} />
        <Side title="Baneados" kind="bans" picks={bans} max={6}
              onAdd={() => setSheet('ban')} onRemove={remove(setBans)} />

        <div className="tools">
          <button className="reset" onClick={reset}>Nuevo draft</button>
          <button className="reset" onClick={() => setEditingMastery(true)}>Tu maestría</button>
        </div>
      </aside>

      <main className="results">
        <div className="results-head">
          <h2>Tu pick de roam</h2>
          <span className="freshness">{roamPool.length} roamers</span>
        </div>

        {!meta && (
          <p className="notice">
            Faltan los datos meta, así que esto se basa solo en composición y counters por rol.
            Ejecuta <code>npm run ingest</code> para añadir winrates reales.
          </p>
        )}

        {ranked.slice(0, 8).map((r, i) => (
          <Pick key={r.hero.name} result={r} index={i} stat={meta?.stats?.[r.hero.name]} />
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
