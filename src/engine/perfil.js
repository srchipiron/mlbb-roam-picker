/**
 * Tu perfil en un código que puedes copiar y pegar.
 *
 * El problema: la maestría y las partidas viven en el almacenamiento del
 * navegador, y eso va por dispositivo. Abres la app en el ordenador y está
 * todo a cero.
 *
 * La solución que NO se ha hecho, y por qué: una base de datos con un código
 * por persona. Haría falta un servidor -la app es un fichero estático en
 * GitHub Pages, no tiene detrás nada que pueda guardar-, alguien pagándolo, y
 * convertiría a Javi en responsable de datos de otras personas, con lo que eso
 * trae en Europa. Y todo eso para mover un kilobyte y medio.
 *
 * Lo que sí: tus datos SON pequeños. Once héroes de maestría y unas partidas
 * caben de sobra en un texto que copias de un sitio y pegas en otro. Viajan por
 * donde tú quieras -WhatsApp contigo mismo, un correo, un papel- y no pasan por
 * ningún servidor. La promesa de "tus datos no salen de tu móvil" sigue siendo
 * literalmente cierta: salen porque TÚ los sacas.
 *
 * El código se comprime si el navegador sabe (CompressionStream, que llevan
 * Chrome y Safari modernos) y si no, va en claro. En los dos casos lleva
 * delante una marca de versión y detrás una suma de control, porque un código
 * pegado a medias que se importara en silencio podría llevarse por delante
 * 3.800 partidas de maestría.
 */

const MARCA = 'MLPA1';

/** Suma de control corta. No es criptografía: es cazar un pegado a medias. */
function suma(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36);
}

const aBase64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const deBase64 = (texto) => {
  const s = atob(texto.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

async function comprimir(texto) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(texto));
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch {
    return null;
  }
}

async function descomprimir(bytes) {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  w.write(bytes);
  w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

/**
 * Lo que se lleva: maestría, partidas y tus preferencias. NO el draft a medias,
 * que es de esta partida y no de este jugador.
 */
export function recogerPerfil({ mastery = {}, partidas = [], rango = null, linea = null, idioma = null }) {
  return {
    v: 1, mastery, partidas, rango, linea, idioma, cuando: Date.now(),
  };
}

/** El código para copiar. */
export async function exportarPerfil(perfil) {
  const json = JSON.stringify(perfil);
  const gz = await comprimir(json);
  const cuerpo = gz ? `z${aBase64(gz)}` : `p${aBase64(new TextEncoder().encode(json))}`;
  return `${MARCA}.${cuerpo}.${suma(cuerpo)}`;
}

/**
 * Lee un código. Devuelve { perfil } o { error }.
 *
 * Nunca lanza: esto lo va a usar alguien pegando desde el móvil con los dedos
 * gordos, y un error tiene que salir en pantalla, no dejar la app en blanco.
 */
export async function leerPerfil(codigo) {
  const limpio = String(codigo ?? '').trim().replace(/\s+/g, '');
  if (!limpio) return { error: 'vacio' };

  const partes = limpio.split('.');
  if (partes.length !== 3 || partes[0] !== MARCA) return { error: 'formato' };
  const [, cuerpo, control] = partes;
  if (suma(cuerpo) !== control) return { error: 'incompleto' };

  try {
    const bytes = deBase64(cuerpo.slice(1));
    const json = cuerpo[0] === 'z' ? await descomprimir(bytes) : new TextDecoder().decode(bytes);
    const perfil = JSON.parse(json);
    if (!perfil || typeof perfil !== 'object') return { error: 'formato' };
    return { perfil };
  } catch {
    return { error: 'ilegible' };
  }
}

/**
 * Junta lo que llega con lo que ya hay. NUNCA reemplaza a ciegas.
 *
 * Importante que sea así: si juegas en los dos sitios, las dos copias divergen,
 * y un "pegar y sustituir" te borraría lo que hiciste en el otro. Mezclando,
 * importar es seguro y se puede hacer las veces que haga falta, en los dos
 * sentidos, sin perder nada.
 *
 *  - maestría: gana el que tenga MÁS partidas, héroe a héroe.
 *  - partidas: se juntan las dos listas y se quitan las repetidas.
 *  - preferencias: solo se cogen si aquí no había nada.
 */
export function fundirPerfil(actual, entrante) {
  const mastery = { ...(actual.mastery ?? {}) };
  for (const [nombre, m] of Object.entries(entrante.mastery ?? {})) {
    const mio = mastery[nombre];
    if (!mio || (m?.games ?? 0) > (mio.games ?? 0)) mastery[nombre] = m;
  }

  const clave = (p) => `${p.t ?? ''}|${p.pick ?? ''}|${p.gane ? 1 : 0}`;
  const vistas = new Set();
  const partidas = [...(entrante.partidas ?? []), ...(actual.partidas ?? [])]
    .filter((p) => {
      const k = clave(p);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .sort((a, b) => (b.t ?? 0) - (a.t ?? 0));

  return {
    mastery,
    partidas,
    rango: actual.rango ?? entrante.rango ?? null,
    linea: actual.linea ?? entrante.linea ?? null,
    idioma: actual.idioma ?? entrante.idioma ?? null,
    // Para poder decirle a la persona qué ha entrado de verdad.
    resumen: {
      maestriaAntes: Object.keys(actual.mastery ?? {}).length,
      maestriaDespues: Object.keys(mastery).length,
      partidasAntes: (actual.partidas ?? []).length,
      partidasDespues: partidas.length,
    },
  };
}
