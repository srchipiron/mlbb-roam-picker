import { useEffect, useMemo, useRef, useState } from 'react';

const PART_COLORS = {
  meta: 'var(--c-meta)',
  counter: 'var(--c-counter)',
  synergy: 'var(--c-synergy)',
  comp: 'var(--c-comp)',
  mastery: 'var(--c-mastery)',
};

const PART_LABELS = {
  meta: 'Meta',
  counter: 'Counter',
  synergy: 'Sinergia',
  comp: 'Composición',
  mastery: 'Tu maestría',
};

/** Fila de huecos de un bando. Tocar un hueco abre el selector. */
export function Side({ title, kind, picks, max, onAdd, onRemove }) {
  const slots = [...picks, ...Array(Math.max(0, max - picks.length)).fill(null)];
  return (
    <section className={`side ${kind}`}>
      <div className="side-label">
        <span>{title}</span>
        <span>{picks.length}/{max}</span>
      </div>
      <div className="slots">
        {slots.map((hero, i) =>
          hero ? (
            <button
              key={hero.name}
              className="slot"
              onClick={() => onRemove(hero)}
              aria-label={`Quitar ${hero.name}`}
            >
              <span>{hero.name}</span>
              <span className="x" aria-hidden>×</span>
            </button>
          ) : (
            <button key={`empty-${i}`} className="slot empty" onClick={onAdd}>
              Añadir
            </button>
          ),
        )}
      </div>
    </section>
  );
}

/** Selector a pantalla completa. Buscador enfocado y rejilla de toque grande. */
export function HeroSheet({ heroes, taken, onPick, onClose }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const list = useMemo(() => {
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const needle = norm(q.trim());
    return heroes
      .filter((h) => !needle || norm(h.name).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [heroes, q]);

  return (
    <div className="sheet" role="dialog" aria-label="Elegir héroe">
      <div className="sheet-head">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar héroe"
          autoComplete="off"
        />
        <button className="close" onClick={onClose}>Cerrar</button>
      </div>
      <div className="hero-grid">
        {list.map((h) => (
          <button key={h.name} disabled={taken.has(h.name)} onClick={() => onPick(h)}>
            {h.name}
          </button>
        ))}
        {!list.length && <p className="empty-state">Ningún héroe con ese nombre.</p>}
      </div>
    </div>
  );
}

/** Tarjeta de recomendación con la barra de desglose del score. */
export function Pick({ result, index, stat }) {
  const total = Object.values(result.contributions).reduce((a, b) => a + b, 0) || 1;
  return (
    <article className={`pick ${index === 0 ? 'top' : ''}`}>
      <div className="rank">{index + 1}</div>
      <div>
        <h3 className="pick-name">{result.hero.name}</h3>
        <div className="why-bar" aria-hidden>
          {Object.entries(result.contributions).map(([key, v]) => (
            <span key={key} style={{ width: `${(v / total) * 100}%`, background: PART_COLORS[key] }} />
          ))}
        </div>
        <ul className="reasons">
          {result.reasons.length ? (
            result.reasons.map((r) => (
              <li key={r.text} className={r.good ? '' : 'bad'}>{r.text}</li>
            ))
          ) : (
            <li>pick sólido de base</li>
          )}
        </ul>
      </div>
      <div>
        <div className="pick-score">{Math.round(result.score * 100)}</div>
        <span className="pick-wr">
          {stat?.winRate != null ? `${(stat.winRate * 100).toFixed(1)}% WR` : 'sin datos'}
        </span>
      </div>
    </article>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {Object.entries(PART_LABELS).map(([k, label]) => (
        <span key={k}><i style={{ background: PART_COLORS[k] }} />{label}</span>
      ))}
    </div>
  );
}
