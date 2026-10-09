# Requisitos y criterios de aceptación — Reserva de canchas

API y pantallas para reservar canchas de fútbol 5 y 7 en varios predios: sedes, canchas,
horarios semanales, reservas con estado, equipos y reseñas, con un panel de gestión para quien
administra un predio. Cada regla de este documento indica el comportamiento esperado y el
criterio con el que se acepta.

## Entidades

| Entidad | Datos relevantes |
|---|---|
| Usuario | `email` (único), rol (`jugador`, `duenio`, `admin`), activo o dado de baja |
| Sede | `nombre` (único); cada duenio tiene sedes asignadas |
| Cancha | `nombre` (único dentro de su sede), `tipo`, `precio_hora`, estado (`habilitada`, `mantenimiento`, `baja`) |
| Horario | franjas semanales de una cancha por día de la semana |
| Reserva | cancha, fecha, `hora_inicio`, `hora_fin`, titular y estado |
| Equipo | `nombre` (único), miembros |
| Reseña | cancha, autor, `puntaje` |

## Autenticación

`POST /auth/login` devuelve un token opaco que se envía en cada petición como
`Authorization: Bearer <token>`. El token vive en el sistema, no es un JWT.

| Entrada | Resultado esperado |
|---|---|
| petición que requiere sesión, sin token o con un token inválido | 401 |
| `POST /auth/logout` y luego una petición con el mismo token | 401: el token queda revocado de inmediato |
| `PUT /auth/password` | invalida todas las sesiones del usuario, incluida la que hizo el cambio |
| login con email inexistente, con clave equivocada o con una cuenta dada de baja | 401 con el mensaje `email o clave incorrectos` en los tres casos |

Los tres fallos de login responden igual a propósito: distinguirlos convertiría el login en un
medio para averiguar qué emails están registrados.

## Roles y permisos

| Rol | Puede |
|---|---|
| `jugador` | reservar para sí mismo; ver y gestionar solo sus propias reservas; reseñar canchas donde jugó; armar equipos |
| `duenio` | todo lo anterior, y además administrar las sedes que tiene asignadas: sus canchas, sus horarios, confirmar y cerrar sus reservas, y ver su panel |
| `admin` | todo, en todas las sedes |

| Entrada | Resultado esperado |
|---|---|
| un jugador consulta o gestiona una reserva de otro usuario | 403 |
| un duenio opera sobre una sede que no tiene asignada, o sobre sus canchas, horarios o reservas | 403 |
| `POST /auth/registro` | crea siempre un usuario con rol `jugador` |
| `POST /usuarios` sin sesión de admin | 403 (401 sin sesión) |
| rutas de `/usuarios` sin ser admin, salvo las del propio usuario | 403 |
| rutas de `/panel` con rol `jugador` | 403 |
| `GET /admin/auditoria` sin ser admin | 403 |

## Endpoints

| Grupo | Rutas |
|---|---|
| Sistema | `GET /health` · `GET /version` (versión y conteo de filas por tabla) · `POST /admin/reset` · `GET /admin/auditoria` (registro de acciones, admin) |
| Autenticación | `POST /auth/registro` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/yo` · `PUT /auth/password` |
| Usuarios (admin, salvo el propio) | `GET /usuarios` · `POST /usuarios` · `GET /usuarios/{id}` · `PUT /usuarios/{id}` · `DELETE /usuarios/{id}` · `PATCH /usuarios/{id}/rol` · `GET /usuarios/{id}/reservas` |
| Sedes | `GET /sedes` · `POST /sedes` · `GET /sedes/{id}` · `PUT /sedes/{id}` · `DELETE /sedes/{id}` · `GET /sedes/{id}/canchas` |
| Canchas | `GET /canchas` · `POST /canchas` · `GET /canchas/{id}` · `PUT /canchas/{id}` · `DELETE /canchas/{id}` · `PATCH /canchas/{id}/estado` · `GET /canchas/{id}/disponibilidad` · `GET /canchas/{id}/reservas` |
| Horarios | `GET /canchas/{id}/horarios` · `POST /canchas/{id}/horarios` · `GET /horarios/{id}` · `PUT /horarios/{id}` · `DELETE /horarios/{id}` |
| Reservas | `GET /reservas` · `POST /reservas` · `GET /reservas/agenda` · `GET /reservas/{id}` · `PUT /reservas/{id}` · `DELETE /reservas/{id}` · `POST /reservas/{id}/confirmar` · `POST /reservas/{id}/cancelar` · `POST /reservas/{id}/no-show` · `POST /reservas/{id}/completar` · `GET /reservas/{id}/historial` |
| Equipos | `GET /equipos` · `POST /equipos` · `GET /equipos/{id}` · `PUT /equipos/{id}` · `DELETE /equipos/{id}` · `POST /equipos/{id}/miembros` · `DELETE /equipos/{id}/miembros/{usuario_id}` |
| Reseñas | `GET /canchas/{id}/resenas` · `POST /canchas/{id}/resenas` · `GET /resenas/{id}` · `PUT /resenas/{id}` · `DELETE /resenas/{id}` |
| Panel (duenio o admin) | `GET /panel/resumen` · `GET /panel/ocupacion` · `GET /panel/cancelaciones` · `GET /panel/ranking-canchas` |

El contrato OpenAPI se publica en `/docs` y `/openapi.json`.

## Pantallas

`/` · `/ui/login` · `/ui/canchas` · `/ui/reservas` · `/ui/agenda` · `/ui/panel`. Consumen la
propia API. Las pantallas no cubren toda la API: el resto de las operaciones se ejercita por
HTTP.

## Operaciones de soporte

| Operación | Comportamiento esperado |
|---|---|
| `GET /health` | responde `{"estado":"ok"}` cuando el sistema está listo |
| `POST /admin/reset` | devuelve la base a los datos de partida. No pide sesión. Invalida todos los tokens: después de un reset hay que volver a iniciar sesión |

Datos de partida, fijos:

| Tabla | Filas |
|---|---|
| usuarios | 8 |
| sedes | 4 |
| canchas | 8 |
| horarios | 280 |
| reservas | 7 |
| equipos | 3 |
| resenas | 5 |

- Las canchas tienen franjas de una hora, de 18:00 a 23:00, todos los días de la semana.
- Las fechas de los datos de partida son de octubre de 2026 y no dependen de la fecha actual.

| Email | Clave | Rol |
|---|---|---|
| `admin@canchas.test` | `admin123` | admin |
| `roberto@canchas.test` | `duenio123` | duenio (sedes 1 y 2) |
| `lucia@canchas.test` | `duenio123` | duenio (sedes 3 y 4) |
| `ana@canchas.test` | `jugador123` | jugador |
| `bruno@canchas.test` | `jugador123` | jugador |
| `carla@canchas.test` | `jugador123` | jugador |
| `diego@canchas.test` | `jugador123` | jugador |
| `elena@canchas.test` | `jugador123` | jugador, dada de baja |

## Reglas y criterios de aceptación

### Estados de una reserva

```
pendiente ──┬─> confirmada ──┬─> completada
            │                ├─> no-show
            └─> cancelada <──┘
```

| Entrada | Resultado esperado |
|---|---|
| `POST /reservas` válido | la reserva nace `pendiente` |
| confirmar una reserva `pendiente`, por quien administra la cancha | pasa a `confirmada` |
| cualquier transición desde `cancelada`, `completada` o `no-show` | 409: son estados terminales |
| completar o marcar no-show una reserva que no está `confirmada` | 409 |
| cada cambio de estado | queda registrado en `GET /reservas/{id}/historial` |
| mover de fecha u horario una reserva `pendiente` | se acepta |
| mover de fecha u horario una reserva que ya no está `pendiente` | 409 |

### Disponibilidad

Los rangos son semiabiertos `[inicio, fin)`.

| Entrada | Resultado esperado |
|---|---|
| reservar una franja ocupada por una reserva `pendiente` o `confirmada` de la misma cancha y fecha | 409 |
| reservar una franja cuya única reserva previa está `cancelada` o en `no-show` | se acepta: esas reservas liberan la franja |
| `GET /canchas/{id}/disponibilidad` para una franja tomada por una reserva vigente | la franja figura `libre: false` |
| reservar un rango que no existe en el horario de la cancha para ese día de la semana | 409 |
| reservas 19:00-20:00 y 20:00-21:00 en la misma cancha y fecha | ambas se aceptan: no se pisan |

### Estados de una cancha

Una cancha está `habilitada`, en `mantenimiento` o de `baja`.

| Entrada | Resultado esperado |
|---|---|
| `GET /canchas/{id}/disponibilidad` de una cancha no habilitada | sin franjas disponibles |
| reservar en una cancha no habilitada | rechazado |
| borrar una cancha con reservas vigentes | 409 |

### Listados y paginación

| Entrada | Resultado esperado |
|---|---|
| cualquier listado | responde `{datos, total, limite, desde}` |
| listado con filtros | `total` es la cantidad de registros que cumplen los filtros aplicados, no la de la tabla entera |
| `desde=0` | devuelve desde el primer registro |
| suma de los elementos de todas las páginas | igual a `total` |
| `limite` sin indicar | 20 |
| `limite` fuera de 1–100 | 400 |
| `orden` con un campo no documentado para el recurso | 400 |
| `GET /canchas?orden=` con `id`, `nombre`, `precio_hora` o `tipo` | ordenado por ese campo |
| `GET /canchas?orden=precio_hora` | ordenado por precio, de menor a mayor |
| `direccion` | acepta `asc` o `desc` |

### Unicidad

| Entrada | Resultado esperado |
|---|---|
| `email` de usuario repetido, en el alta o en la modificación | 409 |
| `nombre` de sede repetido | 409 |
| `nombre` de equipo repetido | 409 |
| `nombre` de cancha repetido dentro de la misma sede | 409 |
| segunda reseña del mismo usuario sobre la misma cancha | 409 |
| reseña sobre una cancha donde el usuario no tiene ninguna reserva `completada` | 409 |

### Panel

| Entrada | Resultado esperado |
|---|---|
| `GET /panel/ocupacion` | mide las franjas efectivamente tomadas sobre las franjas configuradas para ese día; una reserva cancelada libera la franja y no cuenta |
| `GET /panel/cancelaciones` | informa canceladas y no-shows sobre el total de reservas de la cancha |
| cualquier ruta de `/panel` con un duenio | incluye únicamente las canchas de sus sedes |

### Borrado de reservas

`DELETE /reservas/{id}` es idempotente: el resultado pedido —que la reserva no exista— ya se
cumple.

| Entrada | Resultado esperado |
|---|---|
| `DELETE /reservas/{id}` de una reserva existente o inexistente | 204 |
| `GET /reservas/{id}` de una reserva inexistente | 404 |

### Baja de usuarios

| Entrada | Resultado esperado |
|---|---|
| `DELETE /usuarios/{id}` | marca al usuario como inactivo (`activo = 0`) y corta sus sesiones; la fila no se borra |
| reservas históricas de un usuario dado de baja | siguen apuntando a ese usuario |
| login de un usuario dado de baja | 401 `email o clave incorrectos` |

### Errores

Todos los errores tienen la forma `{"error": "texto legible"}`. Los de validación agregan
detalles: `{"error": "datos invalidos", "detalles": [{"campo": "...", "problema": "..."}]}`.

| Código | Cuándo |
|---|---|
| 400 | datos inválidos, parámetro fuera de rango, enumerado desconocido |
| 401 | falta sesión o las credenciales no sirven |
| 403 | hay sesión pero el rol o la pertenencia no alcanzan |
| 404 | el recurso o la ruta no existen |
| 409 | choca con el estado actual: duplicado, transición imposible, franja tomada |
