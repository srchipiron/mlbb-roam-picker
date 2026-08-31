import { normName, tipoDeDano } from './score.js';

/**
 * Builds de objetos: lo que la gente compra de verdad, y como ajustarlo al
 * draft que tienes delante.
 *
 * Dos cosas MUY distintas viven en este fichero, y conviene no confundirlas:
 *
 * 1. `buildsDe` devuelve DATO: las builds mas jugadas de ese heroe en esa
 *    linea, con su winrate y su cuota de uso, tal como las publica la API.
 *
 * 2. `ajusteDefensivo` devuelve un CONSEJO: si el equipo enemigo pega casi
 *    todo magico, la defensa magica vale mas que la fisica. Eso no sale de
 *    ninguna medicion nuestra de "builds contra este draft" -ese dato no
 *    existe en la API-, sale de dos hechos medidos (de que pega cada heroe,
 *    cuanta defensa da cada objeto) mas una regla evidente del juego.
 *
 * La app tiene que ensenarlas distinto, porque no valen lo mismo.
 */

/**
 * Builds de un heroe en una linea, de la mas jugada a la menos.
 *
 * Se ORDENA POR USO, no por winrate, y no es una preferencia estetica: el
 * winrate de una build lleva dentro a QUIEN la compra. Quien se sale de la
 * build por defecto suele ser quien mas domina el heroe, y se ve en los
 * propios datos -las builds del 3% de uso salen por encima de las del 13%, y
 * el heroe entero por debajo de las tres-. Ordenar por winrate seria
 * recomendar el sesgo del jugador como si fuera el objeto.
 */
export function buildsDe(builds, hero, linea) {
  if (!builds || !hero || !linea) return [];
  const nombre = typeof hero === 'string' ? hero : hero.name;
  const porLinea = builds[nombre] ?? indice(builds)[normName(nombre)];
  const lista = porLinea?.[linea];
  if (!Array.isArray(lista)) return [];
  return fundirIguales(lista).sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0));
}

/** Todo lo que la app ENSENA de una build. Dos builds con esta misma firma son
 *  indistinguibles en pantalla. */
const firma = (b) => [(b.objetos ?? []).join(','), b.emblema ?? '', b.hechizo ?? ''].join('|');

/**
 * Junta las builds que en pantalla se ven EXACTAMENTE IGUAL.
 *
 * La API separa builds que solo se diferencian en un talento del emblema, y
 * los talentos no se descargan. Sin juntarlas, la pantalla ensena dos veces lo
 * mismo con dos porcentajes distintos: parece un fallo y ademas miente, porque
 * esa build se usa la suma de las dos y no la mayor. Son 57 de las 492.
 *
 * Se junta por objetos MAS emblema MAS hechizo, no solo por objetos: 115 pares
 * comparten los tres objetos pero cambian el hechizo de batalla, y ahi si hay
 * dos builds distintas que la app enseña como tales.
 *
 * El winrate junto va PONDERADO POR USO, no promediado a pelo: el uso es
 * proporcional al tamano de la muestra, asi que la media simple le daria a una
 * build del 0,4% el mismo peso que a una del 13%.
 */
export function fundirIguales(lista) {
  const porObjetos = new Map();
  for (const b of lista) {
    const clave = firma(b);
    const ya = porObjetos.get(clave);
    if (!ya) { porObjetos.set(clave, { ...b }); continue; }
    const pa = ya.pickRate ?? 0;
    const pb = b.pickRate ?? 0;
    if (ya.winRate != null && b.winRate != null && pa + pb > 0) {
      ya.winRate = (ya.winRate * pa + b.winRate * pb) / (pa + pb);
    } else if (ya.winRate == null) ya.winRate = b.winRate;
    ya.pickRate = pa + pb;
  }
  return [...porObjetos.values()];
}

/**
 * Indice por nombre normalizado, calculado una sola vez por objeto de builds.
 * Los nombres de la API y del catalogo se escriben distinto ("X.Borg" /
 * "X Borg") y buscar solo por la clave cruda dejaba sin build a esos heroes.
 */
const cache = new WeakMap();
function indice(builds) {
  if (typeof builds !== 'object' || builds === null) return {};
  let idx = cache.get(builds);
  if (!idx) {
    idx = {};
    for (const [k, v] of Object.entries(builds)) idx[normName(k)] = v;
    cache.set(builds, idx);
  }
  return idx;
}

/** Nombre legible de un objeto. Si no esta en el catalogo, su id. */
export function nombreObjeto(equipment, id) {
  return equipment?.[id]?.nombre ?? equipment?.[String(id)]?.nombre ?? `#${id}`;
}

/** Objetos de una build, con nombre y defensa. */
export function objetosDe(equipment, build) {
  return (build?.objetos ?? []).map((id) => ({
    id,
    nombre: nombreObjeto(equipment, id),
    ...(equipment?.[id] ?? equipment?.[String(id)] ?? {}),
  }));
}

/**
 * De que pega el equipo enemigo, en peso, no en cabezas.
 *
 * `perfilDeDano` cuenta heroes y sirve para saber que le FALTA a tu equipo.
 * Aqui hace falta otra cosa: cuanta de la amenaza que te viene encima es
 * magica. Un heroe mixto amenaza por los dos lados, asi que cuenta medio a
 * cada uno, y los que no tienen dato no cuentan (no se reparten a medias: eso
 * seria inventarse la mitad de la respuesta).
 *
 * Devuelve `null` cuando hay menos de dos enemigos con dato: con uno solo no
 * se puede decir que el equipo enemigo pegue de nada.
 *
 * OJO con los nombres, que se parecen a proposito y no son lo mismo: el DANO
 * va en masculino (`fisico`/`magico`, como en `tipoDeDano`) y la DEFENSA de un
 * objeto en femenino (`fisica`/`magica`). `ajusteDefensivo` traduce de lo uno
 * a lo otro; leer un campo de defensa en un perfil de dano daria `undefined`
 * sin que nada fallara.
 */
export function amenazaEnemiga(enemies = []) {
  let fisico = 0;
  let magico = 0;
  let conDato = 0;
  for (const e of enemies) {
    const t = tipoDeDano(e);
    if (!t) continue;
    conDato += 1;
    if (t === 'fisico') fisico += 1;
    else if (t === 'magico') magico += 1;
    else { fisico += 0.5; magico += 0.5; }
  }
  if (conDato < 2) return null;
  const total = fisico + magico;
  return { fisico, magico, conDato, sinDato: enemies.length - conDato, cuotaMagica: magico / total };
}

/**
 * Desde que cuota de dano magico enemigo se recomienda el lado magico.
 *
 * No es 0.5: cambiar de objeto cuesta oro y una build por defecto ya esta
 * elegida por millones de partidas. Solo se abre la boca cuando el desequilibrio
 * es claro, que con cinco enemigos significa cuatro de un lado.
 */
export const DESEQUILIBRIO = 0.7;

/**
 * Que lado conviene reforzar y si la build ya lo cubre.
 *
 * Devuelve `null` cuando no hay nada que decir: sin dato suficiente, con el
 * dano enemigo repartido, o cuando la build ya lleva defensa de ese lado. No
 * decir nada es la respuesta correcta la mayoria de las veces, y una app que
 * siempre tiene un consejo deja de leerse.
 */
export function ajusteDefensivo(build, equipment, enemies) {
  const amenaza = amenazaEnemiga(enemies);
  if (!amenaza) return null;

  const lado = amenaza.cuotaMagica >= DESEQUILIBRIO ? 'magica'
    : (1 - amenaza.cuotaMagica) >= DESEQUILIBRIO ? 'fisica'
      : null;
  if (!lado) return null;

  // A partir de aqui `lado` ya es un campo de OBJETO ('magica'/'fisica'), no
  // del perfil de dano. Ver el aviso de `amenazaEnemiga`.
  const objetos = objetosDe(equipment, build);
  const yaLoLleva = objetos.some((o) => (o[lado] ?? 0) > 0);
  if (yaLoLleva) return null;

  return { lado, cuotaMagica: amenaza.cuotaMagica, conDato: amenaza.conDato, alternativas: mejoresDefensas(equipment, lado) };
}

/**
 * Los objetos que mas defensa dan de un lado, del catalogo del juego.
 *
 * Ordenados por lo que dan, que es un numero del propio juego, no por una
 * opinion. Se quitan los que dan MENOS del lado que hace falta que del otro:
 * comprar Antique Cuirass contra un equipo magico es cambiar de objeto para
 * nada.
 *
 * NO se filtra ademas por "objetos que la gente compra de verdad", y es a
 * proposito: comprobado sobre los datos, los tres primeros de cada lado salen
 * ya en builds reales (magica: Athena's Shield, Dominance Ice, Radiant Armor;
 * fisica: Blade Armor, Antique Cuirass, Dominance Ice). Los componentes
 * baratos dan poca defensa por construccion, asi que nunca se cuelan arriba.
 * Si algun dia lo hicieran, el diagnostico lo canta con el recuento de objetos
 * con defensa medida.
 */
export function mejoresDefensas(equipment, lado, cuantos = 3) {
  const otro = lado === 'magica' ? 'fisica' : 'magica';
  return Object.entries(equipment ?? {})
    .map(([id, o]) => ({ id: Number(id), ...o }))
    .filter((o) => (o[lado] ?? 0) > 0 && (o[lado] ?? 0) >= (o[otro] ?? 0))
    .sort((a, b) => (b[lado] ?? 0) - (a[lado] ?? 0))
    .slice(0, cuantos);
}

/**
 * Cobertura de las builds: cuantos heroes de un pool tienen build en su linea.
 *
 * Lo usa el diagnostico. Igual que con los counters, lo que importa no es que
 * el fichero tenga builds sino que las tenga PARA LOS HEROES QUE SE
 * RECOMIENDAN.
 */
export function coberturaBuilds(pool, builds, linea) {
  const total = pool?.length ?? 0;
  const con = (pool ?? []).filter((h) => buildsDe(builds, h, linea).length).length;
  return { total, con };
}
