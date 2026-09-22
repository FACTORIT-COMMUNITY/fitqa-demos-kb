#!/usr/bin/env node
// Confirma que el catalogo de `verdad.json` describe al SUT que esta corriendo.
//
//     node verificar.mjs http://localhost:3211
//
// Si algo de aca falla, el catalogo no describe al sistema y cualquier punteo contra el
// es basura. Cada bloque deja la base en la semilla antes de empezar.

const BASE = (process.argv[2] || "http://localhost:3211").replace(/\/$/, "");

let ok = 0;
let mal = 0;

function comprobar(etiqueta, condicion, detalle = "") {
  if (condicion) {
    ok += 1;
    console.log(`  ok   ${etiqueta}`);
  } else {
    mal += 1;
    console.log(`  FALLA ${etiqueta}${detalle ? " — " + detalle : ""}`);
  }
}

async function pedir(ruta, { metodo = "GET", cuerpo, token } = {}) {
  const cabeceras = { "Content-Type": "application/json" };
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { crudo: texto };
  }
  return { estado: r.status, cuerpo: json };
}

const reset = () => pedir("/admin/reset", { metodo: "POST" });

async function entrar(email, clave) {
  const r = await pedir("/auth/login", { metodo: "POST", cuerpo: { email, clave } });
  if (r.estado !== 200) throw new Error(`login de ${email} devolvio ${r.estado}`);
  return r.cuerpo.token;
}

// --- CAN-01 ---------------------------------------------------------------------------
async function can01() {
  console.log("\nCAN-01 — la reserva pendiente no reserva nada");
  await reset();
  const ana = await entrar("ana@canchas.test", "jugador123");
  const bruno = await entrar("bruno@canchas.test", "jugador123");
  const franja = { cancha_id: 1, fecha: "2026-10-12", hora_inicio: "19:00", hora_fin: "20:00" };

  const primera = await pedir("/reservas", { metodo: "POST", cuerpo: franja, token: ana });
  comprobar("la primera reserva entra (201)", primera.estado === 201, `dio ${primera.estado}`);
  comprobar("nace pendiente", primera.cuerpo?.estado === "pendiente", primera.cuerpo?.estado);

  const segunda = await pedir("/reservas", { metodo: "POST", cuerpo: franja, token: bruno });
  comprobar(
    "la segunda sobre la misma franja tambien entra (deberia ser 409)",
    segunda.estado === 201,
    `dio ${segunda.estado}`
  );

  const grilla = await pedir("/canchas/1/disponibilidad?fecha=2026-10-12");
  const celda = grilla.cuerpo.franjas.find((f) => f.hora_inicio === "19:00");
  comprobar("la franja figura ocupada pese a las dos reservas", celda && celda.libre === false);
}

// --- CAN-02 ---------------------------------------------------------------------------
async function can02() {
  console.log("\nCAN-02 — confirmar revive una reserva cancelada");
  await reset();
  const ana = await entrar("ana@canchas.test", "jugador123");
  const admin = await entrar("admin@canchas.test", "admin123");

  const nueva = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 2, fecha: "2026-10-13", hora_inicio: "20:00", hora_fin: "21:00" },
    token: ana,
  });
  const id = nueva.cuerpo.id;
  const cancelada = await pedir(`/reservas/${id}/cancelar`, { metodo: "POST", token: ana });
  comprobar("se cancela bien", cancelada.cuerpo?.estado === "cancelada", cancelada.cuerpo?.estado);

  const revivida = await pedir(`/reservas/${id}/confirmar`, { metodo: "POST", token: admin });
  comprobar(
    "confirmar una cancelada devuelve 200 (deberia ser 409)",
    revivida.estado === 200,
    `dio ${revivida.estado}`
  );
  comprobar("y queda confirmada", revivida.cuerpo?.estado === "confirmada");

  const historial = await pedir(`/reservas/${id}/historial`, { token: admin });
  const salto = historial.cuerpo.datos.some(
    (e) => e.estado_anterior === "cancelada" && e.estado_nuevo === "confirmada"
  );
  comprobar("el historial deja registrado el salto cancelada -> confirmada", salto);

  const coherente = await pedir(`/reservas/${id}/completar`, { metodo: "POST", token: admin });
  comprobar(
    "en cambio la transicion por la tabla si valida (completar una confirmada: 200)",
    coherente.estado === 200,
    `dio ${coherente.estado}`
  );
}

// --- CAN-03 ---------------------------------------------------------------------------
async function can03() {
  console.log("\nCAN-03 — el total del listado ignora el filtro de estado");
  await reset();
  const admin = await entrar("admin@canchas.test", "admin123");

  const todas = await pedir("/reservas?limite=100", { token: admin });
  comprobar("la semilla tiene 7 reservas", todas.cuerpo.total === 7, `total ${todas.cuerpo.total}`);

  const canceladas = await pedir("/reservas?estado=cancelada&limite=100", { token: admin });
  comprobar(
    "filtrando por cancelada llega 1 fila",
    canceladas.cuerpo.datos.length === 1,
    `llegaron ${canceladas.cuerpo.datos.length}`
  );
  comprobar(
    "pero total sigue diciendo 7 (deberia ser 1)",
    canceladas.cuerpo.total === 7,
    `total ${canceladas.cuerpo.total}`
  );

  const porCancha = await pedir("/reservas?cancha_id=1&limite=100", { token: admin });
  comprobar(
    "los otros filtros si se reflejan en total",
    porCancha.cuerpo.total === porCancha.cuerpo.datos.length,
    `total ${porCancha.cuerpo.total} vs ${porCancha.cuerpo.datos.length}`
  );
}

// --- CAN-04 ---------------------------------------------------------------------------
async function can04() {
  console.log("\nCAN-04 — un jugador ve la reserva de otro por id");
  await reset();
  const ana = await entrar("ana@canchas.test", "jugador123");

  const mias = await pedir("/reservas?limite=100", { token: ana });
  const ajenas = mias.cuerpo.datos.filter((r) => r.usuario_id !== 4);
  comprobar("el listado si esta acotado al propio usuario", ajenas.length === 0);

  // La reserva 3 es de Carla Gomez (usuario 6).
  const ajena = await pedir("/reservas/3", { token: ana });
  comprobar(
    "pero GET /reservas/3 devuelve 200 (deberia ser 403)",
    ajena.estado === 200,
    `dio ${ajena.estado}`
  );
  comprobar("y expone al titular", ajena.cuerpo?.usuario === "Carla Gomez", ajena.cuerpo?.usuario);

  const historial = await pedir("/reservas/3/historial", { token: ana });
  comprobar(
    "el historial de la misma reserva si rebota (403)",
    historial.estado === 403,
    `dio ${historial.estado}`
  );
}

// --- CAN-05 ---------------------------------------------------------------------------
async function can05() {
  console.log("\nCAN-05 — la ultima franja del dia siempre figura libre");
  await reset();

  // Semilla: cancha 4, 2026-10-07, 22:00-23:00, confirmada.
  const dia = await pedir("/canchas/4/disponibilidad?fecha=2026-10-07");
  const ultima = dia.cuerpo.franjas[dia.cuerpo.franjas.length - 1];
  comprobar("la ultima franja es 22:00-23:00", ultima.hora_inicio === "22:00");
  comprobar("figura libre aunque esta reservada", ultima.libre === true);
  comprobar(
    "y el conteo de libres la cuenta",
    dia.cuerpo.libres === dia.cuerpo.franjas.length,
    `libres ${dia.cuerpo.libres} de ${dia.cuerpo.franjas.length}`
  );

  const admin = await entrar("admin@canchas.test", "admin123");
  const reservas = await pedir("/canchas/4/reservas?fecha=2026-10-07", { token: admin });
  comprobar(
    "la reserva de las 22:00 existe y esta confirmada",
    reservas.cuerpo.datos.some((r) => r.hora_inicio === "22:00" && r.estado === "confirmada")
  );

  // Una franja que no sea la ultima si se marca.
  const ana = await entrar("ana@canchas.test", "jugador123");
  await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 4, fecha: "2026-10-07", hora_inicio: "19:00", hora_fin: "20:00" },
    token: ana,
  });
  const luego = await pedir("/canchas/4/disponibilidad?fecha=2026-10-07");
  const intermedia = luego.cuerpo.franjas.find((f) => f.hora_inicio === "19:00");
  comprobar("una franja intermedia si se marca ocupada", intermedia.libre === false);
}

// --- CAN-06 ---------------------------------------------------------------------------
async function can06() {
  console.log("\nCAN-06 — el orden por precio compara texto");
  await reset();
  const r = await pedir("/canchas?orden=precio_hora&direccion=asc&limite=100");
  const precios = r.cuerpo.datos.map((c) => c.precio_hora);
  comprobar(
    "el primero es el de 100000 y no el de 9000",
    precios[0] === 100000,
    `primero ${precios[0]}`
  );
  comprobar(
    "el mas barato queda ultimo",
    precios[precios.length - 1] === 9000,
    `ultimo ${precios[precios.length - 1]}`
  );
  const ordenadoDeVerdad = [...precios].sort((a, b) => a - b);
  comprobar(
    "la lista no esta ordenada numericamente",
    JSON.stringify(precios) !== JSON.stringify(ordenadoDeVerdad)
  );

  const porNombre = await pedir("/canchas?orden=nombre&limite=100");
  const nombres = porNombre.cuerpo.datos.map((c) => c.nombre);
  comprobar(
    "ordenar por texto si funciona",
    JSON.stringify(nombres) === JSON.stringify([...nombres].sort())
  );
}

// --- CAN-07 ---------------------------------------------------------------------------
async function can07() {
  console.log("\nCAN-07 — una cancha en mantenimiento sigue ofreciendo franjas");
  await reset();

  const cancha = await pedir("/canchas/5");
  comprobar("la cancha 5 esta en mantenimiento", cancha.cuerpo.estado === "mantenimiento");

  const dia = await pedir("/canchas/5/disponibilidad?fecha=2026-10-14");
  comprobar(
    "la disponibilidad devuelve franjas libres igual",
    dia.cuerpo.libres > 0,
    `libres ${dia.cuerpo.libres}`
  );

  const ana = await entrar("ana@canchas.test", "jugador123");
  const intento = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 5, fecha: "2026-10-14", hora_inicio: "19:00", hora_fin: "20:00" },
    token: ana,
  });
  comprobar(
    "pero reservar esa franja rebota con 409",
    intento.estado === 409,
    `dio ${intento.estado}`
  );
}

// --- CAN-08 ---------------------------------------------------------------------------
async function can08() {
  console.log("\nCAN-08 — la ocupacion cuenta reservas canceladas");
  await reset();
  const admin = await entrar("admin@canchas.test", "admin123");

  // Semilla: cancha 3, 2026-10-07, 18:00-19:00, cancelada.
  const antes = await pedir("/panel/ocupacion?fecha=2026-10-07", { token: admin });
  const c3 = antes.cuerpo.datos.find((f) => f.cancha_id === 3);
  comprobar(
    "la cancha 3 figura con 1 franja reservada ese dia",
    c3.reservadas === 1,
    `reservadas ${c3.reservadas}`
  );
  const soloCancelada = await pedir("/canchas/3/reservas?fecha=2026-10-07", { token: admin });
  comprobar(
    "y su unica reserva de ese dia esta cancelada",
    soloCancelada.cuerpo.datos.length === 1 &&
      soloCancelada.cuerpo.datos[0].estado === "cancelada"
  );
  comprobar("o sea que la ocupacion no es cero", c3.ocupacion > 0, `ocupacion ${c3.ocupacion}`);

  // Cancelar una reserva vigente tampoco baja el numero.
  const c1Antes = antes.cuerpo.datos.find((f) => f.cancha_id === 1);
  const ana = await entrar("ana@canchas.test", "jugador123");
  const nueva = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 1, fecha: "2026-10-07", hora_inicio: "20:00", hora_fin: "21:00" },
    token: ana,
  });
  await pedir(`/reservas/${nueva.cuerpo.id}/cancelar`, { metodo: "POST", token: ana });
  const despues = await pedir("/panel/ocupacion?fecha=2026-10-07", { token: admin });
  const c1Despues = despues.cuerpo.datos.find((f) => f.cancha_id === 1);
  comprobar(
    "cancelar una reserva no baja la ocupacion",
    c1Despues.reservadas === c1Antes.reservadas + 1,
    `${c1Antes.reservadas} -> ${c1Despues.reservadas}`
  );
}

// --- Trampas --------------------------------------------------------------------------
async function trampas() {
  console.log("\nTRAMPAS — comportamiento raro que esta documentado");
  await reset();

  const inexistente = await pedir("/auth/login", {
    metodo: "POST",
    cuerpo: { email: "nadie@canchas.test", clave: "jugador123" },
  });
  const claveMala = await pedir("/auth/login", {
    metodo: "POST",
    cuerpo: { email: "ana@canchas.test", clave: "loquesea1" },
  });
  comprobar("TRAMPA-01: los dos logins fallidos dan 401", inexistente.estado === 401 && claveMala.estado === 401);
  comprobar(
    "TRAMPA-01: y el mismo mensaje exacto",
    inexistente.cuerpo.error === claveMala.cuerpo.error,
    `${inexistente.cuerpo.error} / ${claveMala.cuerpo.error}`
  );

  const admin = await entrar("admin@canchas.test", "admin123");
  const fantasma = await pedir("/reservas/99999", { metodo: "DELETE", token: admin });
  comprobar(
    "TRAMPA-02: borrar una reserva inexistente da 204 y no 404",
    fantasma.estado === 204,
    `dio ${fantasma.estado}`
  );
  const leer = await pedir("/reservas/99999", { token: admin });
  comprobar("TRAMPA-02: pero leerla si da 404", leer.estado === 404, `dio ${leer.estado}`);
}

// --- Lo que si esta bien --------------------------------------------------------------
async function sanos() {
  console.log("\nSANOS — lo que no hay que reportar");
  await reset();
  const ana = await entrar("ana@canchas.test", "jugador123");
  const admin = await entrar("admin@canchas.test", "admin123");

  const sinSesion = await pedir("/reservas");
  comprobar("sin token: 401", sinSesion.estado === 401, `dio ${sinSesion.estado}`);

  const noAdmin = await pedir("/usuarios", { token: ana });
  comprobar("un jugador en /usuarios: 403", noAdmin.estado === 403, `dio ${noAdmin.estado}`);

  const noExiste = await pedir("/canchas/999");
  comprobar("cancha inexistente: 404", noExiste.estado === 404, `dio ${noExiste.estado}`);

  const rutaFantasma = await pedir("/no-existe");
  comprobar("ruta inexistente: 404", rutaFantasma.estado === 404, `dio ${rutaFantasma.estado}`);

  const limiteMalo = await pedir("/canchas?limite=500");
  comprobar("limite fuera de rango: 400", limiteMalo.estado === 400, `dio ${limiteMalo.estado}`);

  const ordenMalo = await pedir("/canchas?orden=color");
  comprobar("orden no permitido: 400", ordenMalo.estado === 400, `dio ${ordenMalo.estado}`);

  const fechaMala = await pedir("/canchas/1/disponibilidad?fecha=12-10-2026");
  comprobar("fecha mal formada: 400", fechaMala.estado === 400, `dio ${fechaMala.estado}`);

  const emailRepetido = await pedir("/auth/registro", {
    metodo: "POST",
    cuerpo: { nombre: "Otra Ana", email: "ana@canchas.test", clave: "jugador123" },
  });
  comprobar("email repetido: 409", emailRepetido.estado === 409, `dio ${emailRepetido.estado}`);

  const bajaLogin = await pedir("/auth/login", {
    metodo: "POST",
    cuerpo: { email: "elena@canchas.test", clave: "jugador123" },
  });
  comprobar("usuario de baja no entra: 401", bajaLogin.estado === 401, `dio ${bajaLogin.estado}`);

  const confirmaJugador = await pedir("/reservas/2/confirmar", { metodo: "POST", token: ana });
  comprobar(
    "un jugador no confirma su propia reserva: 403",
    confirmaJugador.estado === 403,
    `dio ${confirmaJugador.estado}`
  );

  const completarPendiente = await pedir("/reservas/2/completar", { metodo: "POST", token: admin });
  comprobar(
    "completar una pendiente: 409",
    completarPendiente.estado === 409,
    `dio ${completarPendiente.estado}`
  );

  const franjaInventada = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 1, fecha: "2026-10-12", hora_inicio: "07:00", hora_fin: "08:00" },
    token: ana,
  });
  comprobar(
    "franja fuera del horario de la cancha: 409",
    franjaInventada.estado === 409,
    `dio ${franjaInventada.estado}`
  );

  const chocaConfirmada = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 1, fecha: "2026-10-05", hora_inicio: "19:00", hora_fin: "20:00" },
    token: ana,
  });
  comprobar(
    "chocar con una reserva CONFIRMADA si rebota: 409",
    chocaConfirmada.estado === 409,
    `dio ${chocaConfirmada.estado}`
  );

  const resenaSinJugar = await pedir("/canchas/2/resenas", {
    metodo: "POST",
    cuerpo: { puntaje: 5, comentario: "sin haber jugado" },
    token: ana,
  });
  comprobar(
    "resenar una cancha en la que no jugo: 409",
    resenaSinJugar.estado === 409,
    `dio ${resenaSinJugar.estado}`
  );

  const sacarCapitan = await pedir("/equipos/1/miembros/4", { metodo: "DELETE", token: ana });
  comprobar("sacar al capitan del equipo: 409", sacarCapitan.estado === 409, `dio ${sacarCapitan.estado}`);

  const rangoInvertido = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 1, fecha: "2026-10-12", hora_inicio: "20:00", hora_fin: "19:00" },
    token: ana,
  });
  comprobar("hora_fin anterior a hora_inicio: 400", rangoInvertido.estado === 400, `dio ${rangoInvertido.estado}`);

  const puntajeFuera = await pedir("/canchas/1/resenas", {
    metodo: "POST",
    cuerpo: { puntaje: 9 },
    token: ana,
  });
  comprobar("puntaje fuera de 1..5: 400", puntajeFuera.estado === 400, `dio ${puntajeFuera.estado}`);
}

// --- Las mismas reglas, por la ruta de actualizacion -----------------------------------
// En el demo 01 el catalogo probo la unicidad en el alta y no en la modificacion, y ahi
// habia un defecto que nadie habia sembrado. Cada regla del README se verifica por las dos
// puertas: la que crea y la que edita.
async function actualizaciones() {
  console.log("\nACTUALIZACION — cada regla tambien por el PUT/PATCH");
  await reset();
  const admin = await entrar("admin@canchas.test", "admin123");
  const ana = await entrar("ana@canchas.test", "jugador123");

  const emailAjeno = await pedir("/usuarios/5", {
    metodo: "PUT",
    cuerpo: { nombre: "Bruno Diaz", email: "ana@canchas.test", telefono: null, activo: true },
    token: admin,
  });
  comprobar(
    "PUT /usuarios: email de otro usuario: 409",
    emailAjeno.estado === 409,
    `dio ${emailAjeno.estado}`
  );

  const emailPropio = await pedir("/usuarios/5", {
    metodo: "PUT",
    cuerpo: { nombre: "Bruno Diaz", email: "bruno@canchas.test", telefono: null, activo: true },
    token: admin,
  });
  comprobar(
    "PUT /usuarios: conservar el email propio: 200",
    emailPropio.estado === 200,
    `dio ${emailPropio.estado}`
  );

  const sedeRepetida = await pedir("/sedes/2", {
    metodo: "PUT",
    cuerpo: {
      nombre: "Predio Norte",
      direccion: "Calle Mitre 120",
      ciudad: "Avellaneda",
      telefono: null,
      duenio_id: 2,
      activa: true,
    },
    token: admin,
  });
  comprobar(
    "PUT /sedes: nombre ya usado: 409",
    sedeRepetida.estado === 409,
    `dio ${sedeRepetida.estado}`
  );

  const canchaRepetida = await pedir("/canchas/2", {
    metodo: "PUT",
    cuerpo: {
      sede_id: 1,
      nombre: "Norte 1",
      tipo: "futbol5",
      superficie: "sintetico",
      techada: false,
      precio_hora: 18000,
    },
    token: admin,
  });
  comprobar(
    "PUT /canchas: nombre repetido en la misma sede: 409",
    canchaRepetida.estado === 409,
    `dio ${canchaRepetida.estado}`
  );

  const tipoInvalido = await pedir("/canchas/2", {
    metodo: "PUT",
    cuerpo: {
      sede_id: 1,
      nombre: "Norte 2",
      tipo: "padel",
      superficie: "sintetico",
      techada: false,
      precio_hora: 18000,
    },
    token: admin,
  });
  comprobar(
    "PUT /canchas: tipo fuera del enumerado: 400",
    tipoInvalido.estado === 400,
    `dio ${tipoInvalido.estado}`
  );

  const estadoInvalido = await pedir("/canchas/2/estado", {
    metodo: "PATCH",
    cuerpo: { estado: "rota" },
    token: admin,
  });
  comprobar(
    "PATCH /canchas/{id}/estado: estado inventado: 400",
    estadoInvalido.estado === 400,
    `dio ${estadoInvalido.estado}`
  );

  const rolInvalido = await pedir("/usuarios/5/rol", {
    metodo: "PATCH",
    cuerpo: { rol: "dios" },
    token: admin,
  });
  comprobar(
    "PATCH /usuarios/{id}/rol: rol inventado: 400",
    rolInvalido.estado === 400,
    `dio ${rolInvalido.estado}`
  );

  const equipoRepetido = await pedir("/equipos/2", {
    metodo: "PUT",
    cuerpo: { nombre: "Los Pibes", capitan_id: 6 },
    token: admin,
  });
  comprobar(
    "PUT /equipos: nombre repetido: 409",
    equipoRepetido.estado === 409,
    `dio ${equipoRepetido.estado}`
  );

  const capitanForastero = await pedir("/equipos/2", {
    metodo: "PUT",
    cuerpo: { nombre: "Fulbito FC", capitan_id: 7 },
    token: admin,
  });
  comprobar(
    "PUT /equipos: capitan que no es miembro: 409",
    capitanForastero.estado === 409,
    `dio ${capitanForastero.estado}`
  );

  const horarioPisado = await pedir("/horarios/2", {
    metodo: "PUT",
    cuerpo: { dia_semana: 0, hora_inicio: "18:00", hora_fin: "19:00", activo: true },
    token: admin,
  });
  comprobar(
    "PUT /horarios: franja que se pisa con otra del dia: 409",
    horarioPisado.estado === 409,
    `dio ${horarioPisado.estado}`
  );

  // PUT /reservas si mira las pendientes al buscar choques; POST no. Esa asimetria es
  // parte de por que CAN-01 es un defecto y no una decision.
  const propia = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 7, fecha: "2026-10-15", hora_inicio: "18:00", hora_fin: "19:00" },
    token: ana,
  });
  const otra = await pedir("/reservas", {
    metodo: "POST",
    cuerpo: { cancha_id: 7, fecha: "2026-10-15", hora_inicio: "20:00", hora_fin: "21:00" },
    token: ana,
  });
  const mover = await pedir(`/reservas/${otra.cuerpo.id}`, {
    metodo: "PUT",
    cuerpo: {
      fecha: "2026-10-15",
      hora_inicio: "18:00",
      hora_fin: "19:00",
      equipo_id: null,
      nota: null,
    },
    token: ana,
  });
  comprobar(
    "PUT /reservas: mover sobre una PENDIENTE ajena si rebota: 409",
    mover.estado === 409,
    `dio ${mover.estado}`
  );
  comprobar("(y la que ocupa la franja sigue ahi)", propia.estado === 201);

  const moverConfirmada = await pedir("/reservas/1", {
    metodo: "PUT",
    cuerpo: {
      fecha: "2026-10-05",
      hora_inicio: "20:00",
      hora_fin: "21:00",
      equipo_id: null,
      nota: null,
    },
    token: admin,
  });
  comprobar(
    "PUT /reservas: mover una confirmada: 409",
    moverConfirmada.estado === 409,
    `dio ${moverConfirmada.estado}`
  );

  const resenaFuera = await pedir("/resenas/1", {
    metodo: "PUT",
    cuerpo: { puntaje: 0, comentario: "cero" },
    token: admin,
  });
  comprobar(
    "PUT /resenas: puntaje fuera de 1..5: 400",
    resenaFuera.estado === 400,
    `dio ${resenaFuera.estado}`
  );

  const resenaAjena = await pedir("/resenas/1", {
    metodo: "PUT",
    cuerpo: { puntaje: 1, comentario: "no es mia" },
    token: await entrar("bruno@canchas.test", "jugador123"),
  });
  comprobar(
    "PUT /resenas: resena de otro: 403",
    resenaAjena.estado === 403,
    `dio ${resenaAjena.estado}`
  );

  const claveIgual = await pedir("/auth/password", {
    metodo: "PUT",
    cuerpo: { clave_actual: "jugador123", clave_nueva: "jugador123" },
    token: ana,
  });
  comprobar(
    "PUT /auth/password: clave nueva igual a la actual: 400",
    claveIgual.estado === 400,
    `dio ${claveIgual.estado}`
  );

  const claveMal = await pedir("/auth/password", {
    metodo: "PUT",
    cuerpo: { clave_actual: "equivocada", clave_nueva: "otraclave1" },
    token: ana,
  });
  comprobar(
    "PUT /auth/password: clave actual equivocada: 401",
    claveMal.estado === 401,
    `dio ${claveMal.estado}`
  );
}

// --- Semilla --------------------------------------------------------------------------
async function semilla() {
  console.log("\nSEMILLA — el estado del que parte cada caso");
  await reset();
  const v = await pedir("/version");
  const f = v.cuerpo.filas;
  comprobar("8 usuarios", f.usuarios === 8, String(f.usuarios));
  comprobar("4 sedes", f.sedes === 4, String(f.sedes));
  comprobar("8 canchas", f.canchas === 8, String(f.canchas));
  comprobar("280 horarios", f.horarios === 280, String(f.horarios));
  comprobar("7 reservas", f.reservas === 7, String(f.reservas));
  comprobar("3 equipos", f.equipos === 3, String(f.equipos));
  comprobar("5 resenas", f.resenas === 5, String(f.resenas));
}

async function principal() {
  console.log(`Verificando el catalogo contra ${BASE}`);
  const salud = await pedir("/health");
  if (salud.estado !== 200) {
    console.error(`El SUT no responde en ${BASE}. Levantalo antes de verificar.`);
    process.exit(2);
  }
  await semilla();
  await can01();
  await can02();
  await can03();
  await can04();
  await can05();
  await can06();
  await can07();
  await can08();
  await trampas();
  await sanos();
  await actualizaciones();
  await reset();

  console.log(`\n${ok} comprobaciones ok, ${mal} fallidas`);
  if (mal) {
    console.error("El catalogo NO describe a este SUT. No midas nada hasta arreglarlo.");
    process.exit(1);
  }
  console.log("El catalogo describe al SUT.");
}

principal().catch((e) => {
  console.error(e);
  process.exit(2);
});
