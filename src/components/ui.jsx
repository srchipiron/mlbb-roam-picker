import { useEffect, useMemo, useRef, useState } from 'react';
import { filtrarPorNombre } from '../engine/alias.js';
import { recogerPerfil, exportarPerfil, leerPerfil, fundirPerfil } from '../engine/perfil.js';
import { esPrevia, siguioConsejo } from '../engine/registro.js';
import { crearT } from '../i18n.js';

// Traductor por defecto para los componentes que no reciben uno. La app le pasa
// el suyo; esto solo evita que un olvido deje la pantalla en blanco.
const tPorDefecto = crearT('es');

const PART_COLORS = {
  meta: 'var(--c-meta)',
  counter: 'var(--c-counter)',
  synergy: 'var(--c-synergy)',
  comp: 'var(--c-comp)',
  mastery: 'var(--c-mastery)',
};

/** Fila de huecos de un bando. Tocar un hueco abre el selector. */
export function Side({ title, kind, picks, max, onAdd, onRemove, markedName, onMark, markHint, autoName, t = tPorDefecto }) {
  const slots = [...picks, ...Array(Math.max(0, max - picks.length)).fill(null)];
  return (
    <section className={`side ${kind}`}>
      <div className="side-label">
        <span>{title}</span>
        <span>{onMark && picks.length ? markHint : `${picks.length}/${max}`}</span>
      </div>
      <div className="slots">
        {slots.map((hero, i) =>
          hero ? (
            <div
              key={hero.name}
              className={`slot ${markedName === hero.name ? 'marked' : ''} ${!markedName && autoName === hero.name ? 'auto' : ''}`}
            >
              {onMark ? (
                <button
                  className="mark"
                  onClick={() => onMark(hero)}
                  aria-pressed={markedName === hero.name}
                  aria-label={t('app.marcarRivalDe', { nombre: hero.name })}
                  title={t('app.marcarRivalDe', { nombre: hero.name })}
                >
                  {markedName === hero.name ? '◉' : (!markedName && autoName === hero.name ? '◎' : '○')}
                </button>
              ) : null}
              <span className="slot-name">{hero.name}</span>
              <button className="x" onClick={() => onRemove(hero)} aria-label={t('app.quitar', { nombre: hero.name })}>×</button>
            </div>
          ) : (
            <button key={`empty-${i}`} className="slot empty" onClick={onAdd}>
              {t('app.anadir')}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

/** Selector a pantalla completa. Buscador enfocado y rejilla de toque grande. */
export function HeroSheet({ heroes, taken, stats, onPick, onClose, t = tPorDefecto }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const list = useMemo(() => {
    const key = (s) => s.toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const pickRate = (h) => stats?.[key(h.name)]?.pickRate ?? -1;
    // filtrarPorNombre busca tambien por el nombre que el juego usa en otros
    // idiomas -Javi lo tiene en espanol y escribia "Ciclope" sin encontrar
    // nada- y, si aun asi no sale nadie, por las letras en orden. Lo que se
    // ENSENA sigue siendo el nombre en ingles, que es la clave de los datos;
    // solo se amplia por donde se busca.
    return filtrarPorNombre(heroes, q)
      // Sin buscar, primero los más jugados: en 30 segundos de draft, el pick
      // que necesitas suele estar entre los veinte primeros y te ahorras teclear.
      .sort((a, b) => (q ? 0 : pickRate(b) - pickRate(a)) || a.name.localeCompare(b.name));
  }, [heroes, q, stats]);

  return (
    <div className="sheet" role="dialog" aria-label={t('app.elegirHeroe')}>
      <div className="sheet-head">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('app.buscar')}
          autoComplete="off"
        />
        <button className="close" onClick={onClose}>{t('app.cerrar')}</button>
      </div>
      <div className="hero-grid">
        {list.map((h) => (
          <button key={h.name} disabled={taken.has(h.name)} onClick={() => onPick(h)}>
            {h.name}
          </button>
        ))}
        {!list.length && <p className="empty-state">{t('app.sinNombre')}</p>}
      </div>
    </div>
  );
}

/** Tarjeta de recomendación con la barra de desglose del score. */
export function Pick({ result, index, stat, t = tPorDefecto }) {
  const total = Object.values(result.contributions).reduce((a, b) => a + b, 0) || 1;
  return (
    <article className={`pick ${index === 0 ? 'top' : ''}`}>
      <div className="rank">{index + 1}</div>
      <div>
        <h3 className="pick-name">
          {result.hero.name}
          {/* Un héroe que no está en el catálogo escrito a mano juega con los tags
              genéricos de su rol. Se recomienda igual, pero conviene saberlo. */}
          {result.hero.inferred && (
            <span className="inferred" title={t('app.tagsDeRolTitulo')}>
              {t('app.tagsDeRol')}
            </span>
          )}
        </h3>
        <div className="why-bar" aria-hidden>
          {Object.entries(result.contributions).map(([key, v]) => (
            <span key={key} style={{ width: `${(v / total) * 100}%`, background: PART_COLORS[key] }} />
          ))}
        </div>
        <ul className="reasons">
          {result.reasons.length ? (
            result.reasons.map((r) => (
              <li key={`${r.clave}|${r.params?.e ?? r.params?.a ?? ''}`} className={r.good ? '' : 'bad'}>
                {t(r.clave, r.params)}
              </li>
            ))
          ) : (
            <li>{t('app.pickSolido')}</li>
          )}
        </ul>
      </div>
      <div>
        <div className="pick-score">{Math.round(result.score * 100)}</div>
        <span className="pick-wr">
          {stat?.winRate != null ? `${(stat.winRate * 100).toFixed(1)}% WR` : t('app.sinDatos')}
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
export function BanSuggestions({ items, onBan, t = tPorDefecto }) {
  if (!items.length) return null;
  return (
    <section className="bans-suggested">
      <div className="side-label"><span>{t('ban.mereceLaPena')}</span></div>
      {items.map((b) => (
        <div className="ban-row" key={b.hero.name}>
          <span>
            {b.hero.name}
            {b.reasons[0] && <span className="inferred">{t(b.reasons[0].clave, b.reasons[0].params)}</span>}
          </span>
          <span className="rate">
            {b.stat.banRate != null ? t('ban.tasa', { pct: Math.round(b.stat.banRate * 100) }) : ''}
          </span>
          <button onClick={() => onBan(b.hero)}>{t('ban.banear')}</button>
        </div>
      ))}
    </section>
  );
}

export function Legend({ t = tPorDefecto }) {
  return (
    <div className="legend">
      {Object.keys(PART_COLORS).map((k) => (
        <span key={k}><i style={{ background: PART_COLORS[k] }} />{t(`parte.${k}`)}</span>
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
export function MasteryEditor({ pool, mastery, onChange, onClose, t = tPorDefecto }) {
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
    <div className="sheet" role="dialog" aria-label={t('app.maestria')}>
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>{t('app.maestria')}</strong>
        <button className="close" onClick={onClose}>{t('app.cancelar')}</button>
        <button className="close" style={{ color: 'var(--gold)' }} onClick={save}>{t('app.guardar')}</button>
      </div>
      <p className="empty-state" style={{ padding: '0 0 8px' }}>
        {t('maestria.explicacion')}
      </p>
      <div className="mastery-list">
        <div className="mastery-row head">
          <span>{t('maestria.heroe')}</span><span>{t('maestria.partidas')}</span><span>{t('maestria.winrate')}</span>
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

/**
 * Pie fijo abajo a la derecha: versión de la app y cuándo se descargaron los
 * datos. La hora es la LOCAL del móvil, convertida desde la marca UTC que deja
 * la ingesta, para que se lea de un vistazo sin hacer cuentas.
 */
export function Footer({ meta, generado, ageHours, rango, cov }) {
  const [abierto, setAbierto] = useState(false);

  const fecha = generado
    ? generado.toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const viejo = ageHours != null && ageHours > 36;

  return (
    <footer className={`pie ${viejo ? 'stale' : ''}`} onClick={() => setAbierto((v) => !v)}>
      {abierto && meta && (
        <div className="pie-detalle">
          <div>Datos de la API: {fecha ?? 'nunca'}</div>
          <div>Antigüedad: {ageHours != null ? `${Math.round(ageHours)} h` : '—'}</div>
          <div>Rango: {rango ?? '—'} · ventana {meta.days ?? '?'} días</div>
          <div>Héroes con estadísticas: {meta.heroCount ?? 0}</div>
          <div>Rangos descargados: {meta.ranks?.join(', ') || 'ninguno'}</div>
          {meta.diagnostics?.rangos && Object.entries(meta.diagnostics.rangos)
            .filter(([, v]) => String(v).startsWith('fallo'))
            .map(([k, v]) => <div key={k} className="pie-aviso">{k}: {v}</div>)}

          {/* Si faltan los counters, el motivo se enseña aquí: leer el JSON
              en un móvil no es una opción razonable. */}
          {cov && !cov.conCounters && (
            <div className="pie-aviso">
              Sin counters.
              {meta.diagnostics?.relations ? (
                <>
                  {' '}Ruta: {meta.diagnostics.relations.rutaCounter ?? 'no encontrada'}.
                  {' '}Intentos: {meta.diagnostics.relations.conId} por id,
                  {' '}{meta.diagnostics.relations.porNombre} por nombre,
                  {' '}{meta.diagnostics.relations.ok} con datos.
                  {meta.diagnostics.relations.errores?.map((e) => (
                    <div key={e} className="pie-api">{e}</div>
                  ))}
                  {meta.diagnostics.relations.muestra && (
                    <div className="pie-api">Respuesta: {meta.diagnostics.relations.muestra}</div>
                  )}
                </>
              ) : ' La ingesta no dejó diagnóstico: reejecútala.'}
              {meta.diagnostics?.schema?.heroPaths && (
                <div className="pie-api">
                  Rutas de héroes en la API: {meta.diagnostics.schema.heroPaths.join(' · ')}
                </div>
              )}
            </div>
          )}
          <div>Compilada: {new Date(__BUILD_TIME__).toLocaleString('es-ES')}</div>
          {meta.diagnostics?.base && <div className="pie-api">{meta.diagnostics.base}</div>}
        </div>
      )}
      <span className="pie-linea">
        v{__APP_VERSION__}
        {fecha ? ` · datos ${fecha}` : ' · sin datos'}
      </span>
    </footer>
  );
}

/** Pantalla de diagnóstico: ejecuta las comprobaciones y deja el texto listo para copiar. */
export function SelfTest({ resultado, onClose }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resultado.texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles: se selecciona el texto para copiar a mano.
      const el = document.getElementById('selftest-texto');
      const sel = window.getSelection();
      const rango = document.createRange();
      rango.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(rango);
    }
  };

  const compartir = () => navigator.share?.({ text: resultado.texto }).catch(() => {});

  /**
   * Deja el informe como incidencia en GitHub, que es donde se puede trabajar
   * con él después. Se abre el formulario YA RELLENO y tú solo confirmas: así
   * no hace falta ninguna credencial dentro de la app, que en una web pública
   * sería una credencial regalada.
   */
  const aGitHub = () => {
    // El repositorio se deduce de la propia dirección de la app: en GitHub
    // Pages el primer tramo de la ruta ES el nombre del repositorio. Así, si se
    // renombra, esto sigue apuntando bien sin tocar una línea.
    const duenno = window.location.hostname.split('.')[0];
    const repo = window.location.pathname.split('/').filter(Boolean)[0] ?? 'mlbb-roam-picker';
    const url = new URL(`https://github.com/${duenno}/${repo}/issues/new`);
    url.searchParams.set('title', `Diagnóstico ${new Date().toLocaleDateString('es-ES')}: ${resultado.fallos ? `${resultado.fallos} fallos` : `${resultado.avisos} avisos`}`);
    url.searchParams.set('labels', 'diagnostico');
    url.searchParams.set('body', `Enviado desde el móvil con el botón Diagnóstico.\n\n\`\`\`\n${resultado.texto}\n\`\`\``);
    window.open(url.toString(), '_blank', 'noopener');
  };

  return (
    <div className="sheet" role="dialog" aria-label="Diagnóstico">
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>
          {resultado.fallos ? `${resultado.fallos} fallos` : 'Todo correcto'}
          {resultado.avisos ? ` · ${resultado.avisos} avisos` : ''}
        </strong>
        {navigator.share && <button className="close" onClick={compartir}>Enviar</button>}
        <button className="close" onClick={aGitHub}>A GitHub</button>
        <button className="close" style={{ color: 'var(--gold)' }} onClick={copiar}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <button className="close" onClick={onClose}>Cerrar</button>
      </div>
      <pre id="selftest-texto" className="selftest">{resultado.texto}</pre>
    </div>
  );
}

/**
 * Tus partidas: verlas, corregirlas y añadir las de antes.
 *
 * Dos cosas distintas viven aquí, y la diferencia importa:
 *
 *  - Las apuntadas CON la app, que llevan lo que te recomendó. Son las que
 *    dicen si la app acierta.
 *  - Las de tu historial del juego, metidas a mano. Cuentan para tu maestría
 *    -o sea, personalizan la recomendación- pero NO para comprobar si la app
 *    acierta: cuando las jugaste no había consejo que seguir. Mezclarlas
 *    llenaría la rama "por libre" con tu winrate de siempre y la comparación
 *    no diría nada.
 */
export function HistorialPartidas({ partidas, pool, onOlvidar, onCorregir, onAnadir, onClose, t = tPorDefecto }) {
  const [anadiendo, setAnadiendo] = useState(false);
  const [heroe, setHeroe] = useState(null);
  const [aviso, setAviso] = useState(null);

  const conApp = partidas.filter((p) => !esPrevia(p)).length;

  const guardar = (gane) => {
    if (!heroe) return;
    onAnadir(heroe, gane);
    setAviso(t('hist.anadida', { hero: heroe, resultado: gane ? t('hist.gane') : t('hist.perdi') }));
    setHeroe(null);
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('hist.titulo')}>
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>{t('hist.titulo')}</strong>
        <button className="close" onClick={onClose}>{t('app.cerrar')}</button>
      </div>

      <div className="sheet-body">
        <p className="nota">{t('hist.resumenLineas', {
          total: partidas.length, conApp, previas: partidas.length - conApp,
        })}</p>

        <button className="ancho" onClick={() => setAnadiendo((v) => !v)}>{t('hist.anadir')}</button>
        {anadiendo && (
          <>
            <p className="nota">{t('hist.anadirPista')}</p>
            <strong>{t('hist.elegirHeroe')}</strong>
            <div className="hero-grid corto">
              {pool.map((h) => (
                <button
                  key={h.name}
                  className={heroe === h.name ? 'elegido' : ''}
                  onClick={() => setHeroe(h.name)}
                >
                  {h.name}
                </button>
              ))}
            </div>
            <div className="resultado">
              <button className="reset" disabled={!heroe} onClick={() => guardar(false)}>{t('hist.perdi')}</button>
              <button className="reset" disabled={!heroe} onClick={() => guardar(true)}>{t('hist.gane')}</button>
            </div>
            {aviso && <p className="nota bien">{aviso}</p>}
          </>
        )}

        <hr />

        {!partidas.length && <p className="nota">{t('hist.vacio')}</p>}
        {partidas.map((p) => (
          <div key={p.t} className="partida">
            <span className="partida-fecha">
              {new Date(p.t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </span>
            <span className="partida-hero">{p.pick}</span>
            <span className={p.gane ? 'partida-bien' : 'partida-mal'}>
              {p.gane ? t('hist.gane') : t('hist.perdi')}
            </span>
            <span className="partida-tipo">
              {esPrevia(p) ? t('hist.previa') : (siguioConsejo(p) ? t('hist.seguida') : t('hist.libre'))}
            </span>
            <button className="x" title={t('hist.cambiar')} aria-label={t('hist.cambiar')}
              onClick={() => onCorregir(p.t, !p.gane)}>⇄</button>
            <button className="x" title={t('hist.quitar')} aria-label={t('hist.quitar')}
              onClick={() => onOlvidar(p.t)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tu perfil: el código que lleva tus datos a otro dispositivo.
 *
 * Sin servidor y sin cuenta. Tus datos son pequeños -once héroes de maestría y
 * unas partidas- y caben en un texto que copias aquí y pegas allí. Al traerlos
 * se FUNDEN con lo que ya haya, nunca se sustituye: si juegas en los dos sitios
 * las copias divergen, y un "pegar y reemplazar" te borraría medio historial.
 */
export function Perfil({ datos, onImportar, onClose, t = tPorDefecto }) {
  const [codigo, setCodigo] = useState('');
  const [pegado, setPegado] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let vivo = true;
    exportarPerfil(recogerPerfil(datos)).then((c) => { if (vivo) setCodigo(c); });
    return () => { vivo = false; };
  }, [datos]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de portapapeles queda el texto a la vista para copiarlo a mano.
    }
  };

  const traer = async () => {
    const { perfil, error } = await leerPerfil(pegado);
    if (error) {
      setAviso({ mal: true, texto: t(`perfil.error${error[0].toUpperCase()}${error.slice(1)}`) });
      return;
    }
    const fundido = fundirPerfil(datos, perfil);
    onImportar(fundido);
    const r = fundido.resumen;
    setAviso({
      mal: false,
      texto: t('perfil.fundido', {
        ma: r.maestriaAntes, md: r.maestriaDespues, pa: r.partidasAntes, pd: r.partidasDespues,
      }),
    });
    setPegado('');
  };

  return (
    <div className="sheet" role="dialog" aria-label={t('perfil.titulo')}>
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>{t('perfil.titulo')}</strong>
        <button className="close" onClick={onClose}>{t('app.cerrar')}</button>
      </div>
      <div className="sheet-body">
        <p className="nota">{t('perfil.queEs')}</p>
        <p className="nota">{t('perfil.noSale')}</p>

        <strong>{t('perfil.tuCodigo')}</strong>
        <p className="nota">{t('perfil.contiene', {
          heroes: Object.keys(datos.mastery ?? {}).length,
          partidas: (datos.partidas ?? []).length,
        })}</p>
        <textarea className="codigo" readOnly rows={4} value={codigo} onFocus={(e) => e.target.select()} />
        <button className="ancho" onClick={copiar}>{copiado ? t('perfil.copiado') : t('perfil.copiar')}</button>

        <hr />

        <strong>{t('perfil.pegaAqui')}</strong>
        <textarea
          className="codigo"
          rows={4}
          value={pegado}
          onChange={(e) => setPegado(e.target.value)}
          placeholder="MLPA1..."
        />
        <button className="ancho" onClick={traer} disabled={!pegado.trim()}>{t('perfil.importar')}</button>
        {aviso && <p className={aviso.mal ? 'nota mal' : 'nota bien'}>{aviso.texto}</p>}
      </div>
    </div>
  );
}

/**
 * Apuntar cómo fue la partida. Dos toques: a quién cogiste y si ganaste.
 *
 * Los recomendados van primero y marcados, porque en el 90% de las veces vas a
 * tocar uno de esos tres, y porque saber si le hiciste caso es justo el dato
 * que hace falta para saber si la app sirve de algo.
 */
export function RegistroPartida({ pool, recomendados, onGuardar, onClose, t = tPorDefecto }) {
  const [pick, setPick] = useState(recomendados[0] ?? null);

  const orden = useMemo(() => {
    const rec = new Set(recomendados);
    return [...pool].sort((a, b) =>
      (rec.has(b.name) ? 1 : 0) - (rec.has(a.name) ? 1 : 0) || a.name.localeCompare(b.name));
  }, [pool, recomendados]);

  return (
    <div className="sheet" role="dialog" aria-label={t('app.apuntarPartida')}>
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>{t('registro.conQuien')}</strong>
        <button className="close" onClick={onClose}>{t('app.cancelar')}</button>
      </div>

      <div className="hero-grid">
        {orden.map((h) => (
          <button
            key={h.name}
            className={pick === h.name ? 'elegido' : ''}
            onClick={() => setPick(h.name)}
          >
            {h.name}
            {recomendados.includes(h.name) && <span className="inferred">{t('registro.recomendado')}</span>}
          </button>
        ))}
      </div>

      <div className="resultado">
        <button className="reset" disabled={!pick} onClick={() => onGuardar(pick, false)}>{t('registro.perdi')}</button>
        <button className="reset" disabled={!pick} onClick={() => onGuardar(pick, true)}>{t('registro.gane')}</button>
      </div>
    </div>
  );
}




/**
 * Qué línea juegas. Se pregunta una sola vez y se recuerda.
 *
 * Sin esto la app no sabe qué pool recomendarte: no es una preferencia
 * estética, es el dato que decide entre 21 y 40 héroes distintos.
 */
export function SelectorDeLinea({ lineas, valor, onElegir, onClose, t = tPorDefecto }) {
  return (
    <div className="sheet" role="dialog" aria-label={t('app.elegirLinea')}>
      <div className="sheet-head">
        <strong style={{ flex: 1, alignSelf: 'center' }}>{t('linea.pregunta')}</strong>
        {onClose && <button className="close" onClick={onClose}>{t('app.cerrar')}</button>}
      </div>
      <div className="lineas">
        {lineas.map((l) => (
          <button
            key={l}
            className={`linea ${valor === l ? 'elegida' : ''}`}
            onClick={() => onElegir(l)}
          >
            <span className="linea-nombre">{t(`linea.${l}`)}</span>
            <span className="linea-pista">{t(`linea.${l}.pista`)}</span>
          </button>
        ))}
      </div>
      <p className="empty-state" style={{ paddingTop: '10px' }}>
        {t('linea.cambiarDespues')}
      </p>
    </div>
  );
}

/**
 * Las dos o tres frases sobre el draft. Va ARRIBA del todo, antes de las
 * tarjetas: es lo que se lee en los tres segundos que hay de verdad.
 */
export function Analisis({ frases, t = tPorDefecto }) {
  if (!frases?.length) return null;
  return (
    <section className="analisis">
      {frases.map((f) => (
        <p key={f.clave} className={`frase ${f.tono}`}>{t(f.clave, f.params)}</p>
      ))}
    </section>
  );
}

/**
 * Enlace de donación. Vacío hasta que Javi ponga el suyo: prefiero un hueco a
 * un enlace inventado que lleve a ninguna parte o, peor, al sitio de otro.
 * Se rellena con la URL de Ko-fi, PayPal, GitHub Sponsors o lo que use.
 */
export const ENLACE_DONAR = '';

/**
 * Pie público: idioma, aviso de no afiliación, privacidad y donación.
 *
 * El aviso de no afiliación NO es adorno. Los nombres de héroes y los datos son
 * de Moonton; esto es una herramienta de aficionado y tiene que decirlo, más
 * aún si pide dinero.
 */
export function AvisoLegal({ t = tPorDefecto, idioma, onIdioma, idiomas = ['es', 'en'] }) {
  return (
    <section className="aviso">
      <div className="idiomas">
        {idiomas.map((l) => (
          <button
            key={l}
            className={idioma === l ? 'elegido' : ''}
            aria-pressed={idioma === l}
            onClick={() => onIdioma(l)}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <p>{t('legal.noAfiliado')}</p>
      <p>{t('legal.privacidad')}</p>
      {ENLACE_DONAR && (
        <a className="donar" href={ENLACE_DONAR} target="_blank" rel="noopener noreferrer">
          {t('donar.texto')}
        </a>
      )}
    </section>
  );
}
