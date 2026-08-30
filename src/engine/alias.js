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

/**
 * Todos los nombres por los que se puede buscar un héroe, ya en minúsculas y
 * sin tildes. El primero es siempre el que la app enseña.
 */
export function nombresDe(hero) {
  const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [hero?.name, ...(ALIAS[hero?.name] ?? [])].filter(Boolean).map(sinTildes);
}
