// Confirma que cada bug del catalogo reproduce tal como esta escrito, y que lo que NO es bug
// se comporta como dice el README. Si esto falla, el catalogo miente y cualquier punteo de
// una corrida del agente contra el es basura.
//
// Vive fuera del arbol del SUT: el agente no tiene que poder leerlo.
//
//   node demos/_verdad/verificar.mjs [base-url]
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3000";
const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(BASE + ruta, {
    ...opciones,
    headers: opciones.body ? { "content-type": "application/json" } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const cuerpo = r.status === 204 ? null : await r.json();
  return { estado: r.status, cuerpo };
};
const reset = () => pedir("/admin/reset", { method: "POST" });

const casos = {
  async "BIB-01 doble prestamo deja disponibles en -1"() {
    await reset();
    assert.equal((await pedir("/prestamos", { method: "POST", body: { libro_id: 2, socio_id: 1 } })).estado, 201);
    const segundo = await pedir("/prestamos", { method: "POST", body: { libro_id: 2, socio_id: 3 } });
    assert.equal(segundo.estado, 201, "el segundo prestamo deberia pasar (ese es el bug)");
    const libro = await pedir("/libros/2");
    assert.equal(libro.cuerpo.disponibles, -1, "disponibles tendria que quedar en -1");
    const tercero = await pedir("/prestamos", { method: "POST", body: { libro_id: 2, socio_id: 2 } });
    assert.equal(tercero.estado, 409, "el tercero si tiene que rebotar: entra UNO de mas, no infinitos");
  },

  async "BIB-02 la paginacion pierde el primer libro"() {
    await reset();
    const pagina = await pedir("/libros?limite=3&desde=0");
    assert.deepEqual(pagina.cuerpo.libros.map((l) => l.id), [2, 3, 4], "deberia ser [1,2,3]");
    const todo = await pedir("/libros?limite=100&desde=0");
    assert.equal(todo.cuerpo.total, 8);
    assert.equal(todo.cuerpo.libros.length, 7, "total dice 8 y llegan 7");
  },

  async "BIB-03 borrar un libro prestado pierde el prestamo"() {
    await reset();
    assert.equal((await pedir("/prestamos", { method: "POST", body: { libro_id: 4, socio_id: 1 } })).estado, 201);
    assert.equal((await pedir("/prestamos?activos=true")).cuerpo.total, 1);
    const borrado = await pedir("/libros/4", { method: "DELETE" });
    assert.equal(borrado.estado, 204, "deberia ser 409 (ese es el bug)");
    assert.equal((await pedir("/prestamos?activos=true")).cuerpo.total, 0, "el prestamo vigente se perdio");
  },

  async "TRAMPA-01 el 403 del socio de baja es el comportamiento documentado"() {
    await reset();
    assert.equal((await pedir("/socios/4")).estado, 403);
    assert.equal((await pedir("/socios/99")).estado, 404, "un socio inexistente si es 404");
    assert.equal((await pedir("/socios?estado=baja")).cuerpo.total, 1, "el listado si lo muestra");
  },

  // Lo que tiene que estar BIEN. Un demo donde todo falla no mide precision: mide si el
  // agente sabe decir "esto anda".
  async "sano: devolver dos veces es 409"() {
    await reset();
    const p = await pedir("/prestamos", { method: "POST", body: { libro_id: 1, socio_id: 1 } });
    assert.equal((await pedir(`/prestamos/${p.cuerpo.id}/devolucion`, { method: "POST" })).estado, 200);
    assert.equal((await pedir(`/prestamos/${p.cuerpo.id}/devolucion`, { method: "POST" })).estado, 409);
  },

  async "sano: socio de baja no puede pedir prestado"() {
    await reset();
    assert.equal((await pedir("/prestamos", { method: "POST", body: { libro_id: 1, socio_id: 4 } })).estado, 409);
  },

  async "sano: validacion, unicidad y rutas inexistentes"() {
    await reset();
    assert.equal((await pedir("/libros", { method: "POST", body: { titulo: "" } })).estado, 400);
    assert.equal((await pedir("/libros", { method: "POST", body: { titulo: "X", autor: "Y", isbn: "978-8420633114", anio: 2000 } })).estado, 409);
    assert.equal((await pedir("/libros?orden=ejemplares")).estado, 400);
    assert.equal((await pedir("/libros?limite=999")).estado, 400);
    assert.equal((await pedir("/no-existe")).estado, 404);
  },
};

let fallos = 0;
for (const [nombre, prueba] of Object.entries(casos)) {
  try {
    await prueba();
    console.log(`  OK    ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA ${nombre}\n        ${e.message.split("\n")[0]}`);
  }
}
console.log(fallos ? `\n${fallos} desvio(s): el catalogo no describe al SUT` : "\nCatalogo verificado");
process.exit(fallos ? 1 : 0);
