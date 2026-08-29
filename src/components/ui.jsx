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

const RANK_LABELS = { all: 'Todos', epic: 'Epic', legend: 'Legend', mythic: 'Mythic', honor: 'Honor', glory: 'Glory' };

/** Selector del rango del que salen los winrates. El meta de Glory no es el de Epic. */
export function RankPicker({ ranks, value, onChange }) {
  if (!ranks?.length) return null;
  return (
    <div className="rank-picker">
      {ranks.map((r) => (
        <button key={r} aria-pressed={r === value} onClick={() => onChange(r)}>
          {RANK_LABELS[r] ?? r}
        </button>
      ))}
    </div>
  );
}

/** A quién banear, con el motivo cuando lo hay. */
export function BanSuggestions({ items, onBan }) {
  if (!items.length) return null;
  return (
    <section className="bans-suggested">
      <div className="side-label"><span>Merece la pena banear</span></div>
      {items.map((b) => (
        <div className="ban-row" key={b.hero.name}>
          <span>
            {b.hero.name}
            {b.reasons[0] && <span className="inferred">{b.reasons[0].text}</span>}
          </span>
          <span className="rate">
            {b.stat.banRate != null ? `${Math.round(b.stat.banRate * 100)}% ban` : ''}
          </span>
          <button onClick={() => onBan(b.hero)}>Banear</button>
        </div>
      ))}
    </section>
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

/** Acepta 50,6 y 50.6: el teclado español pone coma y Number() la rechaza. */
export function parseDecimal(raw) {
  if (raw == null) return NaN;
  const clean = String(raw).trim().replace(',', '.');
  if (clean === '') return NaN;
  return Number(clean);
}

/**
 * Pantalla de maestría: tus partidas y tu winrate con cada roamer.
 * Es el 15% del score y el componente que más separa tus picks de una tier list.
 *
 * Se trabaja en porcentaje (50,6) porque es como sale en el perfil del juego.
 * La conversión a fracción se hace solo al guardar.
 */
export function MasteryEditor({ pool, mastery, onChange, onClose }) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      Object.entries(mastery).map(([name, m]) => [
        name,
        { games: String(m.games ?? ''), wr: m.winRate != null ? String(+(m.winRate * 100).toFixed(1)) : '' },
      ]),
    ),
  );

  const set = (name, field, value) =>
    setDraft((prev) => ({
      ...prev,
      [name]: { games: '', wr: '', ...(prev[name] ?? {}), [field]: value },
    }));

  const save = () => {
    const clean = {};
    for (const [name, e] of Object.entries(draft)) {
      const games = parseDecimal(e.games);
      const wr = parseDecimal(e.wr);
      if (games > 0 && wr > 0 && wr <= 100) clean[name] = { games, winRate: wr / 100 };
    }
    onChange(clean);
    onClose();
  };

  const sorted = [...pool].sort((a, b) => {
    const filled = (h) => (draft[h.name]?.games ? 0 : 1);
    return filled(a) - filled(b) || a.name.localeCompare(b.name);
  });

  const invalid = (raw, max) => {
    if (!raw) return false;
    const n = parseDecimal(raw);
    return Number.isNaN(n) || n <= 0 || (max && n > max);
  };

  return (
    <div className="sheet" role="dialog" aria-label="Tu maestría">
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>Tu maestría</strong>
        <button className="close" onClick={onClose}>Cancelar</button>
        <button className="close" style={{ color: 'var(--gold)' }} onClick={save}>Guardar</button>
      </div>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        Copia partidas y winrate de tu perfil del juego. El winrate en porcentaje: 50,6 o 50.6.
        Por debajo de 20 partidas cuenta poco.
      </p>
      <div className="mastery-list">
        <div className="mastery-row head">
          <span>Héroe</span><span>Partidas</span><span>Winrate %</span>
        </div>
        {sorted.map((h) => (
          <div className="mastery-row" key={h.name}>
            <span>{h.name}</span>
            <input
              type="text" inputMode="numeric" placeholder="0"
              className={invalid(draft[h.name]?.games) ? 'bad' : ''}
              value={draft[h.name]?.games ?? ''}
              onChange={(e) => set(h.name, 'games', e.target.value)}
            />
            <input
              type="text" inputMode="decimal" placeholder="50,0"
              className={invalid(draft[h.name]?.wr, 100) ? 'bad' : ''}
              value={draft[h.name]?.wr ?? ''}
              onChange={(e) => set(h.name, 'wr', e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
