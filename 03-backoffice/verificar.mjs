// Confirma que cada bug del catalogo reproduce tal como esta escrito, y que lo que NO es bug
// se comporta como dice el README. Si esto falla, el catalogo miente y cualquier punteo de
// una corrida del agente contra el es basura.
//
// Vive fuera del arbol del SUT: el agente no tiene que poder leerlo.
//
//   node verificar.mjs [base-url]
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:8080";
const SEED_PASSWORD = "Demo1234!";

const pedir = async (ruta, opciones = {}) => {
  const headers = { "content-type": "application/json" };
  if (opciones.token) headers["authorization"] = `Bearer ${opciones.token}`;
  const r = await fetch(BASE + ruta, {
    method: opciones.method,
    headers,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const cuerpo = r.status === 204 ? null : await r.json();
  return { estado: r.status, cuerpo };
};
const reset = () => pedir("/admin/reset", { method: "POST" });
const login = async (email) => {
  const r = await pedir("/auth/login", { method: "POST", body: { email, password: SEED_PASSWORD } });
  assert.equal(r.estado, 200, `login de ${email} deberia funcionar`);
  return r.cuerpo.access_token;
};

// Los tokens se obtienen UNA vez: el reset es de datos, no de sesiones (documentado en
// CLAUDE.md del SUT), asi que un access token emitido antes de un reset sigue sirviendo.
const ADMIN = await login("ana.rodriguez@backoffice.demo");
const OPERADOR = await login("bruno.salas@backoffice.demo");
const VENDEDOR3 = await login("carla.nunez@backoffice.demo"); // dueno del pedido 1 en la semilla
const VENDEDOR4 = await login("diego.paredes@backoffice.demo"); // otro vendedor

const casos = {
  async "BO-01 operador confirma un pago sin permiso financiero"() {
    await reset();
    const pedido = await pedir("/pedidos", { method: "POST", token: VENDEDOR3, body: { cliente_id: 2, items: [{ producto_id: 6, cantidad: 1 }] } });
    await pedir(`/pedidos/${pedido.cuerpo.id}/actualizar-estado`, { method: "POST", token: VENDEDOR3, body: { estado: "confirmado" } });
    const total = (await pedir(`/pedidos/${pedido.cuerpo.id}`, { token: ADMIN })).cuerpo.total_centavos;
    const pago = await pedir("/pagos", { method: "POST", token: OPERADOR, body: { pedido_id: pedido.cuerpo.id, monto_centavos: total, metodo: "efectivo" } });
    assert.equal(pago.estado, 201);
    const confirmar = await pedir(`/pagos/${pago.cuerpo.id}/confirmar`, { method: "POST", token: OPERADOR });
    assert.equal(confirmar.estado, 200, "deberia ser 403: operador no tiene pagos.confirmar (ese es el bug)");
  },

  async "BO-02 un vendedor cancela el pedido de otro vendedor"() {
    await reset();
    const r = await pedir("/pedidos/1/cancelar", { method: "POST", token: VENDEDOR4 });
    assert.equal(r.estado, 200, "deberia ser 403: el pedido 1 es de carla.nunez, no de diego.paredes (ese es el bug)");
  },

  async "BO-03 transferir stock dos veces con la misma idempotency_key lo duplica"() {
    await reset();
    const body = { producto_id: 1, bodega_origen_id: 1, bodega_destino_id: 2, cantidad: 3, idempotency_key: "verificar-03" };
    assert.equal((await pedir("/bodegas/transferir-stock", { method: "POST", token: ADMIN, body })).estado, 200);
    assert.equal((await pedir("/bodegas/transferir-stock", { method: "POST", token: ADMIN, body })).estado, 200);
    const historial = await pedir("/inventario/movimientos?producto_id=1&tipo=transferencia", { token: ADMIN });
    assert.equal(historial.cuerpo.total, 2, "deberia quedar 1 solo movimiento (ese es el bug)");
  },

  async "BO-04 orden=nombre en /productos se ignora"() {
    await reset();
    const r = await pedir("/productos?orden=nombre&limite=10", { token: ADMIN });
    const nombres = r.cuerpo.items.map((p) => p.nombre);
    const ordenados = [...nombres].sort((a, b) => a.localeCompare(b));
    assert.notDeepEqual(nombres, ordenados, "deberia venir alfabetico (ese es el bug: viene por id)");
  },

  async "BO-05 borrar una categoria con productos los deja huerfanos"() {
    await reset();
    const borrar = await pedir("/categorias/1", { method: "DELETE", token: ADMIN });
    assert.equal(borrar.estado, 204, "deberia ser 409: la categoria 1 tiene productos (ese es el bug)");
    const producto = await pedir("/productos/1", { token: ADMIN });
    assert.equal(producto.cuerpo.categoria_id, 1, "el producto sigue apuntando a una categoria que ya no existe");
    assert.equal((await pedir("/categorias/1", { token: ADMIN })).estado, 404);
  },

  async "BO-06 la paginacion de /pedidos pierde el primer registro"() {
    await reset();
    const pagina = await pedir("/pedidos?desde=0&limite=10", { token: ADMIN });
    assert.equal(pagina.cuerpo.total, 5);
    assert.deepEqual(pagina.cuerpo.items.map((p) => p.id), [2, 3, 4, 5], "deberia incluir el pedido 1 (ese es el bug)");
  },

  async "BO-07 los impuestos ignoran el descuento del cupon"() {
    await reset();
    const pedido = await pedir("/pedidos", {
      method: "POST", token: VENDEDOR3,
      body: { cliente_id: 2, cupon_codigo: "BIENVENIDA10", items: [{ producto_id: 1, cantidad: 1 }] },
    });
    const { subtotal_centavos, descuento_centavos, impuestos_centavos } = pedido.cuerpo;
    const correcto = Math.floor((subtotal_centavos - descuento_centavos) * 19 / 100);
    assert.notEqual(impuestos_centavos, correcto, "el bug hace que impuestos sea distinto del calculo correcto");
    assert.equal(impuestos_centavos, Math.floor(subtotal_centavos * 19 / 100), "el bug calcula sobre el subtotal sin descuento");
  },

  async "BO-08 editar una direccion a principal no desmarca la anterior"() {
    await reset();
    const a = await pedir("/clientes/1/direcciones", { method: "POST", token: ADMIN, body: { calle: "Calle A", ciudad: "Bogota", es_principal: true } });
    const b = await pedir("/clientes/1/direcciones", { method: "POST", token: ADMIN, body: { calle: "Calle B", ciudad: "Bogota", es_principal: false } });
    await pedir(`/clientes/1/direcciones/${b.cuerpo.id}`, { method: "PUT", token: ADMIN, body: { calle: "Calle B", ciudad: "Bogota", es_principal: true } });
    const lista = await pedir("/clientes/1/direcciones", { token: ADMIN });
    const principales = lista.cuerpo.items.filter((d) => d.es_principal).map((d) => d.id);
    assert.deepEqual(principales.sort(), [a.cuerpo.id, b.cuerpo.id].sort(), "deberia quedar solo B como principal (ese es el bug)");
  },

  async "BO-09 un envio pasa a entregado sin pasar por en_transito"() {
    await reset();
    const envios = await pedir("/envios?pedido_id=1", { token: ADMIN });
    const envioId = envios.cuerpo.items[0].id;
    const r = await pedir(`/envios/${envioId}/actualizar-estado`, { method: "POST", token: ADMIN, body: { estado: "entregado" } });
    assert.equal(r.estado, 200, "deberia ser 409: el envio esta en pendiente, no en_transito (ese es el bug)");
  },

  async "BO-10 borrar la direccion principal no promueve otra"() {
    await reset();
    const a = await pedir("/clientes/2/direcciones", { method: "POST", token: ADMIN, body: { calle: "Calle X", ciudad: "Cali", es_principal: true } });
    await pedir("/clientes/2/direcciones", { method: "POST", token: ADMIN, body: { calle: "Calle Y", ciudad: "Cali", es_principal: false } });
    await pedir(`/clientes/2/direcciones/${a.cuerpo.id}`, { method: "DELETE", token: ADMIN });
    const lista = await pedir("/clientes/2/direcciones", { token: ADMIN });
    const principales = lista.cuerpo.items.filter((d) => d.es_principal);
    assert.equal(principales.length, 0, "deberia quedar 1 direccion promovida (ese es el bug: queda en 0)");
  },

  async "BO-11 filtro estado invalido en /pedidos devuelve 200 vacio"() {
    await reset();
    const r = await pedir("/pedidos?estado=no-existe", { token: ADMIN });
    assert.equal(r.estado, 200, "deberia ser 400 (ese es el bug)");
    assert.equal(r.cuerpo.total, 0);
  },

  async "BO-12 un pago con monto distinto al total del pedido se acepta"() {
    await reset();
    const pedido = await pedir("/pedidos", { method: "POST", token: ADMIN, body: { cliente_id: 2, items: [{ producto_id: 1, cantidad: 1 }] } });
    await pedir(`/pedidos/${pedido.cuerpo.id}/actualizar-estado`, { method: "POST", token: ADMIN, body: { estado: "confirmado" } });
    const r = await pedir("/pagos", { method: "POST", token: ADMIN, body: { pedido_id: pedido.cuerpo.id, monto_centavos: 1, metodo: "efectivo" } });
    assert.equal(r.estado, 201, "deberia ser 400: el monto no coincide con el total del pedido (ese es el bug)");
  },

  async "BO-13 ninguna accion administrativa queda registrada en auditoria"() {
    await reset();
    await pedir("/usuarios/2/cambiar-rol", { method: "POST", token: ADMIN, body: { rol: "admin" } });
    const r = await pedir("/auditoria", { token: ADMIN });
    assert.equal(r.cuerpo.total, 0, "deberia haber al menos 1 entrada (ese es el bug)");
  },

  async "BO-14 confirmar un pago no notifica al vendedor"() {
    await reset();
    const pedido = await pedir("/pedidos", { method: "POST", token: VENDEDOR3, body: { cliente_id: 2, items: [{ producto_id: 1, cantidad: 1 }] } });
    await pedir(`/pedidos/${pedido.cuerpo.id}/actualizar-estado`, { method: "POST", token: VENDEDOR3, body: { estado: "confirmado" } });
    const antes = (await pedir("/notificaciones", { token: VENDEDOR3 })).cuerpo.total;
    const total = (await pedir(`/pedidos/${pedido.cuerpo.id}`, { token: ADMIN })).cuerpo.total_centavos;
    const pago = await pedir("/pagos", { method: "POST", token: ADMIN, body: { pedido_id: pedido.cuerpo.id, monto_centavos: total, metodo: "efectivo" } });
    await pedir(`/pagos/${pago.cuerpo.id}/confirmar`, { method: "POST", token: ADMIN });
    const despues = (await pedir("/notificaciones", { token: VENDEDOR3 })).cuerpo.total;
    assert.equal(despues, antes, "deberia haber una notificacion nueva para el vendedor (ese es el bug)");
  },

  async "BO-15 un producto sin publicar se puede agregar a un pedido"() {
    await reset();
    const producto = await pedir("/productos/7", { token: ADMIN });
    assert.equal(producto.cuerpo.publicado, false, "el producto 7 deberia estar sin publicar en la semilla");
    const r = await pedir("/pedidos", { method: "POST", token: VENDEDOR3, body: { cliente_id: 2, items: [{ producto_id: 7, cantidad: 1 }] } });
    assert.equal(r.estado, 201, "deberia ser 409: el producto no esta publicado (ese es el bug)");
  },

  async "BO-16 un email duplicado con distinta capitalizacion no se detecta"() {
    await reset();
    const r = await pedir("/usuarios", { method: "POST", token: ADMIN, body: { nombre: "Ana Duplicada", email: "ANA.RODRIGUEZ@backoffice.demo", rol: "operador" } });
    assert.equal(r.estado, 201, "deberia ser 409: ya existe ana.rodriguez@backoffice.demo (ese es el bug)");
  },

  async "TRAMPA-01 el 403 del usuario desactivado es el comportamiento documentado"() {
    await reset();
    assert.equal((await pedir("/usuarios/5", { token: ADMIN })).estado, 403);
    assert.equal((await pedir("/usuarios/999", { token: ADMIN })).estado, 404, "un usuario inexistente si es 404");
    assert.equal((await pedir("/usuarios?activo=false", { token: ADMIN })).cuerpo.total, 1, "el listado si lo muestra");
  },

  async "TRAMPA-02 los reportes son solo para admin"() {
    await reset();
    assert.equal((await pedir("/reportes/stock-bajo", { token: OPERADOR })).estado, 403);
    assert.equal((await pedir("/reportes/stock-bajo", { token: ADMIN })).estado, 200);
  },

  async "TRAMPA-03 cancelar un pedido no anula su pago confirmado"() {
    await reset();
    await pedir("/pedidos/1/cancelar", { method: "POST", token: ADMIN });
    const pedido = await pedir("/pedidos/1", { token: ADMIN });
    assert.equal(pedido.cuerpo.estado, "cancelado");
    const pagos = await pedir("/pagos?pedido_id=1", { token: ADMIN });
    assert.equal(pagos.cuerpo.items[0].estado, "confirmado", "el pago sigue confirmado: hay que reembolsar aparte");
  },

  async "TRAMPA-04 cambiar el rol no invalida el access token ya emitido"() {
    await reset();
    const vendedorToken = await login("diego.paredes@backoffice.demo");
    await pedir("/usuarios/4/cambiar-rol", { method: "POST", token: ADMIN, body: { rol: "operador" } });
    // el token viejo sigue actuando como vendedor: puede cancelar SU propio pedido (3)
    assert.equal((await pedir("/pedidos/3/cancelar", { method: "POST", token: vendedorToken })).estado, 200);
  },

  // Lo que tiene que estar BIEN. Un demo donde todo falla no mide precision: mide si el
  // agente sabe decir "esto anda".
  async "sano: confirmar y anular un pago ya resuelto es 409"() {
    await reset();
    assert.equal((await pedir("/pagos/1/confirmar", { method: "POST", token: ADMIN })).estado, 409);
    await pedir("/pagos/2/anular", { method: "POST", token: ADMIN });
    assert.equal((await pedir("/pagos/2/anular", { method: "POST", token: ADMIN })).estado, 409);
  },

  async "sano: un producto con pedidos asociados no se puede borrar"() {
    await reset();
    assert.equal((await pedir("/productos/1", { method: "DELETE", token: ADMIN })).estado, 409);
  },

  async "sano: un cliente dado de baja no puede generar pedidos"() {
    await reset();
    const r = await pedir("/pedidos", { method: "POST", token: ADMIN, body: { cliente_id: 5, items: [{ producto_id: 1, cantidad: 1 }] } });
    assert.equal(r.estado, 409);
  },

  async "sano: un cupon inactivo no es valido"() {
    await reset();
    const r = await pedir("/cupones/validar?codigo=VERANO2026", { token: ADMIN });
    assert.equal(r.cuerpo.valido, false);
  },

  async "sano: un vendedor SI puede cancelar su propio pedido"() {
    await reset();
    assert.equal((await pedir("/pedidos/1/cancelar", { method: "POST", token: VENDEDOR3 })).estado, 200);
  },

  async "sano: validacion y rutas inexistentes"() {
    await reset();
    assert.equal((await pedir("/productos", { method: "POST", token: ADMIN, body: { sku: "", nombre: "", categoria_id: 1, precio_centavos: 0 } })).estado, 400);
    assert.equal((await pedir("/productos?orden=stock", { token: ADMIN })).estado, 400, "orden fuera del enum si es 400");
    assert.equal((await pedir("/no-existe", { token: ADMIN })).estado, 404);
    assert.equal((await pedir("/no-existe")).estado, 404, "una ruta inexistente es 404 incluso sin auth");
    assert.equal((await pedir("/productos")).estado, 401, "sin token es 401");
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
