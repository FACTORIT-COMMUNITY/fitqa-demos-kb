# 02 — Reserva de canchas

**Repo del SUT:** https://github.com/FACTORIT-COMMUNITY/fitqa-demo-02

API de reserva de canchas de fútbol 5 y 7: sedes, canchas, horarios semanales, reservas con
estado, equipos, reseñas y un panel de gestión. Python 3.13 + FastAPI + `sqlite3` de la
biblioteca estándar + Jinja2. Sin ORM, sin build, sin servicios externos.

```bash
git clone https://github.com/FACTORIT-COMMUNITY/fitqa-demo-02.git
cd fitqa-demo-02
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 3211
```

`POST /admin/reset` devuelve la base a la semilla y **no pide sesión**. La base es en memoria
y compartida por todo el proceso: cada caso que escribe tiene que resetear antes. **Un reset
invalida todos los tokens**, así que después hay que volver a hacer login.

Credenciales de la semilla: en el README del SUT y en [`verdad.json`](verdad.json).

## Magnitud medida

Medido el 2026-09-23 sobre el clone del repo.

| | |
|---|---|
| Bucket | **mediano** |
| S (superficie) | 68 — 62 operaciones de API + 6 pantallas |
| D (profundidad) | 2.747 líneas |
| Confianza | **alta** |
| Stack detectado | fastapi |
| Modificadores | ninguno |

Parámetros de corrida que salen de esa medición:

```
FIT_MAX_TEST_CASES     = 68    # ~1 caso por punto de superficie
FIT_MIN_TEST_CASES     = 45
FIT_MAX_ITERATIONS     = 16    # ceil(68/5) + 2 de margen
FIT_MAX_TURNS_ANALYZER = 90
```

Presupuesto esperado: ~1.009 turnos, ~64,6M tokens de entrada, 33 sesiones. Es un **piso**,
con la tarifa ya reajustada con la corrida `biblioteca-02` adentro.

**Es el único de los tres demos sin `FIT_PLAN_GATE`**, porque es el único que llega a
confianza `alta`.

### Dos cosas que la medición dejó en evidencia

**Este demo es el que hizo que el contrato avale la detección.** Al medirlo por primera vez la
confianza daba `media` y no podía dar otra cosa: el repo versiona su `openapi.json`, el medidor
contaba sus 62 operaciones como `especificado`, y ese número **coincide exactamente** con las
68 del código menos las 6 pantallas que no van al contrato. Aun así `endpoints` salía
`inferido`, porque el contrato se reportaba aparte y nunca avalaba el conteo del código. Con un
framework reconocido, `alta` era inalcanzable.

Desde el 2026-09-22 la skill promueve el conteo a `especificado` cuando hay contrato y los dos
números coinciden dentro del 80%. Acá son 62 sobre 68 = 0,91:

```
endpoints   68 [especificado: fastapi, avalado por openapi.json]
contrato    62 [especificado: openapi.json]
```

El límite de eso: el aval dice que el contador no se quedó ciego a un stack, **no** que el
contrato sea correcto. Dos fuentes de acuerdo pueden estar de acuerdo en un error.

**D se quedó en 2.747 y no en los 6–8k del plan.** El bucket lo sostiene la superficie, no las
líneas. Escribir 3.000 líneas más para que el eje D acompañe sería inflar el demo para que el
número cierre, que es justo lo contrario de medir. Queda anotado: de los tres demos, este es
`mediano` **por S** — y el grande también llega por S.

## Defectos sembrados

Ocho, ninguno es un crash. El detalle ejecutable está en [`verdad.json`](verdad.json).

| ID | Qué | Sev | Dónde |
|---|---|---|---|
| CAN-01 | La reserva pendiente no reserva nada: dos reservas sobre la misma franja | **S1** | `reservas.py` `crear()` |
| CAN-02 | Confirmar revive una reserva cancelada | **S2** | `reservas.py` `confirmar()` |
| CAN-04 | Un jugador lee por id la reserva de otro | **S2** | `reservas.py` `detalle()` |
| CAN-05 | La última franja del día siempre figura libre | **S2** | `canchas.py` `disponibilidad()` |
| CAN-03 | `total` ignora el filtro de estado | **S3** | `reservas.py` `listar()` |
| CAN-07 | Una cancha en mantenimiento sigue ofreciendo franjas | **S3** | `canchas.py` `disponibilidad()` |
| CAN-08 | La ocupación cuenta reservas canceladas | **S3** | `panel.py` `ocupacion()` |
| CAN-06 | `orden=precio_hora` compara texto: 100000 antes que 9000 | **S4** | `canchas.py` `listar()` |

### CAN-01 — la reserva pendiente no reserva nada (S1)

`app/rutas/reservas.py`, en `crear()`. La consulta que busca choques filtra
`estado = 'confirmada'`, así que una reserva `pendiente` no bloquea la franja. Dos personas
distintas quedan con la misma cancha a la misma hora.

```
POST /admin/reset
login ana@canchas.test
POST /reservas {cancha_id:1, fecha:"2026-10-12", hora_inicio:"19:00", hora_fin:"20:00"} -> 201 pendiente
login bruno@canchas.test
POST /reservas {mismos datos}                                                            -> 201  (debería ser 409)
```

Contradice el README del SUT, *Disponibilidad*: "una franja ocupada por una reserva vigente
—pendiente o confirmada— no se puede volver a reservar".

**Por qué vale:** solo aparece en la segunda llamada y ninguna respuesta se ve mal. Y hay una
pista fuerte de que es un defecto y no una decisión: `PUT /reservas/{id}` **sí** mira las
pendientes al buscar choques. Las dos puertas del mismo recurso no se comportan igual.

### CAN-02 — confirmar revive una cancelada (S2)

`app/rutas/reservas.py`, en `confirmar()`. Todas las transiciones pasan por `_transicionar()`,
que valida contra la tabla `TRANSICIONES`. `confirmar()` es la excepción: valida a mano y solo
rechaza `completada` y `no-show`, así que una `cancelada` pasa.

```
POST /admin/reset
login ana@canchas.test
POST /reservas {cancha_id:2, fecha:"2026-10-13", hora_inicio:"20:00", hora_fin:"21:00"}
POST /reservas/{id}/cancelar   -> 200 cancelada
login admin@canchas.test
POST /reservas/{id}/confirmar  -> 200 confirmada  (debería ser 409)
GET  /reservas/{id}/historial  -> queda el salto cancelada -> confirmada
```

Contradice el README del SUT, *Estados de una reserva*: "cancelada, completada y no-show son
terminales".

**Por qué vale:** el resto de las transiciones valida bien. El defecto es la incoherencia de
un handler contra el helper compartido — justo lo que un lector apurado da por cubierto.

### CAN-03 — `total` ignora el filtro de estado (S3)

`app/rutas/reservas.py`, en `listar()`. El `COUNT` se calcula antes de agregar la condición de
estado a la lista de condiciones.

```
GET /reservas?estado=cancelada&limite=100  ->  datos: 1 fila, total: 7
```

Contradice el README del SUT, *Listados y paginación*: "`total` es la cantidad de registros que
cumplen los filtros aplicados, no la de la tabla entera".

**Por qué vale:** responde 200 y el JSON se ve sano. Además `cancha_id`, `fecha` y `usuario_id`
**sí** se reflejan en `total`, así que probar un solo filtro no lo encuentra.

### CAN-04 — un jugador ve la reserva de otro (S2)

`app/rutas/reservas.py`, en `detalle()`. Exige sesión pero nunca llama a `_puede_gestionar()`.

```
POST /admin/reset
login ana@canchas.test (usuario 4)
GET /reservas              -> solo las de Ana            (correcto)
GET /reservas/3            -> 200 con la reserva de Carla Gomez  (debería ser 403)
GET /reservas/3/historial  -> 403                        (correcto)
```

Contradice el README del SUT, *Roles*: "un jugador solo ve y gestiona sus propias reservas".

**Por qué vale:** hacen falta dos cuentas para verlo, el listado del mismo recurso sí está
acotado y el historial de esa misma reserva también rebota. El único agujero es el detalle.

### CAN-05 — la última franja del día siempre figura libre (S2)

`app/rutas/canchas.py`, en `disponibilidad()`. El bucle que marca las franjas ocupadas recorre
`range(len(salida) - 1)`, así que la última nunca se evalúa.

```
POST /admin/reset
GET /canchas/4/disponibilidad?fecha=2026-10-07  -> 22:00-23:00 sale libre:true, libres: 5 de 5
GET /canchas/4/reservas?fecha=2026-10-07        -> esa franja tiene una reserva confirmada
```

Contradice el README del SUT, *Disponibilidad*: "una franja tomada por una reserva vigente
figura `libre: false`".

**Por qué vale:** las franjas intermedias sí se marcan bien. Revisar una sola franja no lo
encuentra; es el caso borde de un recorrido, no un fallo general.

### CAN-06 — el orden por precio compara texto (S4)

`app/rutas/canchas.py`, en `listar()`: `filas.sort(key=lambda f: str(f[orden] or ""))`. El
`str()` está para tolerar nulos y termina ordenando números como cadenas.

```
GET /canchas?orden=precio_hora&direccion=asc&limite=100
  ->  100000, 15000, 18000, 19500, 20000, 21000, 30000, 9000
```

Contradice el README del SUT, *Listados*: "`orden=precio_hora` ordena por precio, de menor a
mayor".

**Por qué vale:** ordenar por `nombre` o por `tipo` funciona perfecto. Hay que mirar la columna
numérica. Es el único defecto puramente cosmético del catálogo, y está a propósito: sirve para
ver si el evaluador sabe repartir severidades o pone S2 a todo.

### CAN-07 — una cancha en mantenimiento sigue ofreciendo franjas (S3)

`app/rutas/canchas.py`, en `disponibilidad()`: no mira `canchas.estado`.

```
GET  /canchas/5                                  -> estado: mantenimiento
GET  /canchas/5/disponibilidad?fecha=2026-10-14  -> libres: 5
POST /reservas {cancha_id:5, ...}                -> 409 "la cancha esta mantenimiento"
```

Contradice el README del SUT, *Estados de una cancha*: "una cancha que no está habilitada no
tiene disponibilidad".

**Por qué vale:** cada endpoint por separado parece correcto. El defecto es que se contradicen,
y eso solo se ve cruzando dos respuestas.

### CAN-08 — la ocupación cuenta canceladas (S3)

`app/rutas/panel.py`, en `ocupacion()`: el `COUNT` de reservadas no filtra por estado.

```
POST /admin/reset
login admin@canchas.test
GET /panel/ocupacion?fecha=2026-10-07      -> la cancha 3 figura con reservadas: 1
GET /canchas/3/reservas?fecha=2026-10-07   -> su única reserva de ese día está cancelada
```

Y cancelar una reserva vigente no baja el número.

Contradice el README del SUT, *Panel*: "la ocupación mide las franjas efectivamente tomadas;
una reserva cancelada libera la franja y no cuenta".

**Por qué vale:** el número es plausible y nadie lo contrasta. `/panel/cancelaciones` y
`/panel/ranking-canchas` **sí** filtran por estado, o sea que el mismo dominio está bien
resuelto dos líneas más abajo.

## Trampas

### TRAMPA-01 — los tres fallos de login dan la misma respuesta

Email inexistente, clave equivocada y cuenta dada de baja devuelven los tres `401` con el
mensaje exacto `email o clave incorrectos`. Parece que la API no distingue los casos y que el
mensaje es poco útil. Está documentado y justificado en el README del SUT, *Notas de diseño*:
distinguirlos convierte el login en un oráculo de enumeración de cuentas.

### TRAMPA-02 — borrar una reserva inexistente da 204

`DELETE /reservas/99999` devuelve `204` y no `404`. Parece que el endpoint no valida la
existencia del recurso. Está documentado y justificado en el README del SUT, *Notas de
diseño*: el borrado es idempotente porque el resultado que se pide ya se cumple.
`GET /reservas/99999` sí devuelve 404.

**Reportar cualquiera de las dos cuenta como falso positivo.** Son la única forma de medir
precisión: sin trampas, un agente que reporta todo saca 100% de recall y parece perfecto.

## Comportamiento que sí está bien

Conviene tenerlo a mano para no contar como acierto algo reportado de más. La lista completa
está en `verdad.json` bajo `sano`; lo que más se presta a confusión:

- Chocar con una reserva **confirmada** sí rebota con 409. El defecto es solo con las
  pendientes.
- Las franjas **intermedias** de la disponibilidad se marcan ocupadas correctamente.
- Ordenar por `nombre` o por `tipo` funciona bien.
- `/panel/cancelaciones` y `/panel/ranking-canchas` sí filtran por estado.
- Un jugador no puede confirmar ni marcar no-show: 403. Tampoco entra a `/usuarios` ni a
  `/panel`.
- Completar o marcar no-show sobre una reserva pendiente: 409.
- Reservar una franja que no está en el horario de la cancha: 409.
- Reseñar una cancha donde no se jugó, o reseñarla dos veces: 409.
- Un usuario dado de baja no inicia sesión: 401.

## Verificar el catálogo

```bash
node verificar.mjs http://localhost:3211
```

**78 comprobaciones**: los ocho defectos, las dos trampas, diecisiete comportamientos sanos, la
semilla, y un bloque entero que repite cada regla del README **por la ruta de actualización**
(`PUT`/`PATCH`) y no solo por la de alta.

Ese bloque existe por lo que pasó en el demo 01: el verificador probó la unicidad de `isbn` en
el alta y no en la modificación, y ahí había un defecto que nadie había sembrado. Un catálogo
incompleto convierte un acierto del agente en un falso positivo y arruina el número de
precisión.

**Si esto falla, el catálogo no describe al SUT y cualquier punteo contra él es basura.**
