/**
 * Nombres con los que el juego llama a un héroe en otros idiomas.
 *
 * La app enseña SIEMPRE el nombre en inglés, porque es la clave de todos los
 * datos: si la pantalla dijera "Cíclope" y el motor buscara "Cyclops", un
 * fallo ahí sería invisible -el héroe se quedaría sin counters y nadie se
 * enteraría-. Es el error de los nombres que ya costó una corrección entera.
 *
 * Lo que sí cambia es la BÚSQUEDA: Javi juega con el móvil en español y ve
 * "Cíclope" en el juego, así que escribe "Cíclope" y no encontraba nada.
 *
 * Esto no es una regla que envejezca con los reequilibrios: un nombre es un
 * nombre. Solo hay que ampliarlo cuando salga un héroe nuevo con el nombre
 * traducido, y `mantenimiento.yml` ya avisa de los héroes nuevos.
 *
 * Se apunta solo lo comprobado. Un alias equivocado es peor que no tenerlo:
 * escribes el nombre bueno y te sale el héroe de al lado.
 */
export const ALIAS = {
  Cyclops: ['Cíclope', 'Ciclope'],
  Minotaur: ['Minotauro'],
  Uranus: ['Urano'],
  Miya: ['Maya'],
  Silvanna: ['Silvana'],
  'Popol and Kupa': ['Popol y Kupa'],
  Angela: ['Ángela'],
  'Yi Sun-shin': ['Yi Sun Shin'],
};

const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Todos los nombres por los que se puede buscar un héroe, ya en minúsculas y
 * sin tildes. El primero es siempre el que la app enseña.
 */
export function nombresDe(hero) {
  return [hero?.name, ...(ALIAS[hero?.name] ?? [])].filter(Boolean).map(sinTildes);
}

/** ¿Están las letras de `q` dentro de `nombre`, en orden? */
function enOrden(q, nombre) {
  let i = 0;
  for (const ch of nombre) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/**
 * Los héroes que encajan con lo que se ha escrito.
 *
 * Primero, lo de siempre: que el nombre CONTENGA lo escrito. Es lo que quiere
 * el 99% de las veces y lo que no da sorpresas.
 *
 * Y solo si eso no encuentra nada, se prueba con las letras en orden aunque no
 * estén pegadas: así "Lyla" encuentra a Layla y "Tigral" a Tigreal. Va de
 * respaldo y no de norma a propósito: buscando así de suelto, tres letras
 * sacan media plantilla. Vale la pena porque la alternativa es la pantalla de
 * "no hay ningún héroe con ese nombre", que desde el móvil, en 30 segundos de
 * draft, es un callejón sin salida.
 *
 * Pide tres letras: con una o dos, las letras sueltas encajan en casi todo.
 */
export function filtrarPorNombre(heroes = [], texto = '') {
  const q = sinTildes(texto).trim();
  if (!q) return heroes;

  const contiene = heroes.filter((h) => nombresDe(h).some((n) => n.includes(q)));
  if (contiene.length || q.length < 3) return contiene;

  return heroes.filter((h) => nombresDe(h).some((n) => enOrden(q, n)));
}
