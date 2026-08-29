import { useEffect, useMemo, useState } from 'react';
import { rankRoamers } from './engine/score.js';
import { Side, HeroSheet, Pick, Legend } from './components/ui.jsx';

const MASTERY_KEY = 'roam-picker:mastery';

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  const [enemies, setEnemies] = useState([]);
  const [allies, setAllies] = useState([]);
  const [bans, setBans] = useState([]);
  const [sheet, setSheet] = useState(null); // 'enemy' | 'ally' | 'ban'

  const [mastery] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MASTERY_KEY) ?? '{}'); } catch { return {}; }
  });

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

  const allHeroes = useMemo(() => {
    if (!catalog) return [];
    const byName = new Map();
    for (const h of [...catalog.roamPool, ...catalog.threatPool]) {
      if (!byName.has(h.name)) byName.set(h.name, h);
    }
    // Héroes que la API conoce pero el catálogo todavía no (recién salidos):
    // entran sin tags para que al menos se puedan marcar como pick enemigo.
    for (const name of meta?.newHeroes ?? []) {
      if (!byName.has(name)) byName.set(name, { name, tags: [] });
    }
    return [...byName.values()];
  }, [catalog, meta]);

  const taken = useMemo(
    () => new Set([...enemies, ...allies, ...bans].map((h) => h.name)),
    [enemies, allies, bans],
  );

  const ranked = useMemo(() => {
    if (!catalog) return [];
    return rankRoamers(catalog.roamPool, {
      enemies, allies, bans, mastery,
      meta: {
        stats: meta?.stats,
        counters: meta?.counters,
        synergies: meta?.synergies,
        patchAvgWinRate: meta?.patchAvgWinRate ?? 0.5,
      },
    });
  }, [catalog, meta, enemies, allies, bans, mastery]);

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

        <button className="reset" onClick={reset}>Nuevo draft</button>
      </aside>

      <main className="results">
        <div className="results-head">
          <h2>Tu pick de roam</h2>
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
