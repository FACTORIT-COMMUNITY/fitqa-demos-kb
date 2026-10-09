# Requisitos y criterios de aceptación — Back-office

API y panel de administración para operar un e-commerce chico: catálogo, inventario
multi-bodega, clientes, pedidos, pagos, envíos, cupones, reseñas y usuarios con roles. Está
pensado para un equipo de 3 a 10 personas (ventas, operaciones, administración). Cada regla de
este documento indica el comportamiento esperado y el criterio con el que se acepta.

## Alcance

- La API expone toda la superficie de negocio. El panel de administración web consume esa misma
  API; las reglas de este documento rigen para la API.
- Todas las cantidades de dinero son enteros en centavos (campos `*_centavos`).

## Entidades

| Entidad | Datos relevantes |
|---|---|
| Producto | `sku` (único), `precio_centavos`, `publicado`, `stock_total` |
| Categoría | productos asociados, orden |
| Precio por cliente | precio de un producto puntual para un cliente |
| Cliente | `activo`, direcciones |
| Dirección | `es_principal` |
| Bodega y existencias | `stock_bodega` por producto y bodega |
| Pedido | estado, items, `vendedor_id`, cupón, `subtotal`, `descuento`, `impuestos`, `total_centavos` |
| Pago | `monto_centavos`, estado (`pendiente`, `confirmado`, anulado) |
| Envío | estado (`pendiente`, `en_transito`, `entregado`), `tracking` |
| Cupón | `tipo` (`porcentaje` o `fijo`), activo o inactivo, `codigo` |
| Reseña | estado (`pendiente`, `aprobada`, `rechazada`) |
| Usuario | `email` (único sin distinguir mayúsculas), rol, activo o desactivado |
| Auditoría y notificación | registro de acciones sensibles; avisos al vendedor |

## Autenticación

| Entrada | Resultado esperado |
|---|---|
| `POST /auth/login {email, password}` con credenciales válidas | devuelve `access_token` (válido 15 minutos) y `refresh_token` (válido 7 días) |
| cualquier otra ruta de la API sin `Authorization: Bearer <access_token>` | rechazada por falta de autenticación |
| `POST /auth/refresh {refresh_token}` con un refresh token vigente | devuelve un access token nuevo |
| `POST /auth/logout` y luego una petición con el mismo access token | el access token queda invalidado |
| `GET /auth/me` | devuelve la sesión actual |
| login de un usuario desactivado | rechazado: no puede autenticarse |
| petición con un token emitido antes de desactivar al usuario | rechazada de inmediato: cada petición revalida contra la base, no solo contra la firma del token |

## Roles y permisos

Tres roles fijos: `admin`, `operador`, `vendedor`. Cada rol tiene un conjunto de permisos
asignado; `GET /roles` los lista.

| Entrada | Resultado esperado |
|---|---|
| un rol ejecuta una acción que requiere un permiso que no tiene asignado | 403 |
| `/reportes/*` con rol `admin` | permitido |
| `/reportes/*` con rol `operador` o `vendedor`, aun con token válido | 403 |
| un `vendedor` cancela un pedido propio (`vendedor_id` igual a su id) | permitido |
| un `vendedor` cancela un pedido de otro vendedor | 403 |
| `admin` u `operador` cancelan un pedido de cualquier vendedor | permitido |

Los reportes financieros son visibles solo para `admin` por decisión de negocio: la cifra de
ventas y el detalle de qué se vendió no son información operativa del día a día.

## Endpoints documentados

| Grupo | Rutas |
|---|---|
| Autenticación | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` |
| Roles | `GET /roles` |
| Productos | `POST /productos/{id}/publicar` · `/productos/{id}/ajustar-stock` |
| Categorías | `POST /categorias/reordenar` |
| Precios por cliente | `/precios-cliente` |
| Inventario | `/inventario/movimientos` · `/bodegas/transferir-stock` |
| Pedidos | `GET /pedidos` · `/pedidos/{id}/items` (`POST` para agregar) · `POST /pedidos/{id}/actualizar-estado` · `/pedidos/{id}/cancelar` · `/pedidos/{id}/reembolsar` |
| Pagos | alta de pago, confirmación y anulación |
| Envíos | `POST /envios/{id}/marcar-entregado` |
| Cupones | `GET /cupones/validar?codigo=...` |
| Reseñas | `POST /resenas/{id}/moderar` |
| Usuarios | `GET /usuarios` (filtro `activo`) · `GET /usuarios/{id}` · `POST /usuarios/{id}/resetear-password` · `/usuarios/{id}/cambiar-rol` |
| Auditoría | `GET /auditoria` · `GET /auditoria/recurso/{recurso}/{recurso_id}` |
| Notificaciones | `/notificaciones` |
| Reportes | `/reportes/*` |

## Operaciones de soporte

Ninguna de estas operaciones requiere autenticación.

| Operación | Comportamiento esperado |
|---|---|
| `GET /health` | responde `{"estado":"ok"}` cuando el sistema está listo |
| `POST /admin/reset` | recrea el esquema entero y vuelve a cargar los datos de partida. Conviene llamarlo antes de cada prueba que escriba. Es un reinicio de datos, no de sesiones: un access token emitido antes del reset sigue sirviendo mientras no expire |
| `GET /admin/seed-info` | devuelve la contraseña de los datos de partida y el email y rol de cada usuario cargado |

## Reglas y criterios de aceptación

### Productos

| Entrada | Resultado esperado |
|---|---|
| alta de un producto con un `sku` ya registrado | rechazada por duplicado |
| `precio_centavos` igual o menor a 0 | rechazado |
| alta de un producto | queda con `publicado: false` |
| `POST /productos/{id}/publicar` | el producto queda publicado |
| eliminar un producto con pedidos asociados | 409 |
| consulta de un producto | `stock_total` es la suma de sus existencias en todas las bodegas |
| `/productos/{id}/ajustar-stock` que dejaría el stock negativo | rechazado; el stock nunca queda negativo |

### Categorías

| Entrada | Resultado esperado |
|---|---|
| eliminar una categoría con productos asociados | 409; hay que reasignar sus productos primero |
| `POST /categorias/reordenar` | recibe la lista completa de ids en el orden deseado |

### Precios por cliente

| Entrada | Resultado esperado |
|---|---|
| pedido para un cliente con precio propio registrado para un producto | ese precio se usa en lugar del de catálogo |

### Clientes y direcciones

| Entrada | Resultado esperado |
|---|---|
| cliente dado de baja (`activo: false`) | se lista y se consulta igual que uno activo |
| cliente con al menos una dirección | tiene exactamente una dirección con `es_principal: true` |
| crear una dirección marcada como principal | la que era principal deja de serlo |
| editar una dirección para marcarla como principal | la que era principal deja de serlo |
| borrar la dirección principal cuando quedan otras | la más antigua de las restantes pasa a ser principal de inmediato |

### Inventario

| Entrada | Resultado esperado |
|---|---|
| `/inventario/movimientos` (entrada o salida) | ajusta el stock de una sola bodega |
| `/bodegas/transferir-stock` | mueve la cantidad de una bodega a otra; exige `idempotency_key` |
| reenviar una transferencia con la misma `idempotency_key` | devuelve el mismo resultado sin volver a tocar el stock: la transferencia se aplica una sola vez |
| salida o transferencia que dejaría el stock en negativo | 409; no se aplica nada, ni siquiera en parte |

### Pedidos

Estados: `borrador → confirmado → {cancelado | reembolsado}`.

| Entrada | Resultado esperado |
|---|---|
| alta de un pedido | nace en `borrador` |
| agregar o quitar items en `borrador` (`/pedidos/{id}/items`) | permitido |
| confirmar un pedido sin items | rechazado |
| `POST /pedidos/{id}/actualizar-estado {"estado":"confirmado"}` | el pedido queda `confirmado` y sus totales quedan fijos |
| alta de un pedido para un cliente dado de baja | 409 |
| agregar un producto con `publicado: false`, al crear el pedido o con `POST /pedidos/{id}/items` | 409 |
| cancelar un pedido en `borrador` o `confirmado` | pasa a `cancelado` |
| cancelar un pedido `reembolsado` | rechazado |
| reembolsar un pedido `confirmado` con un pago `confirmado` | el pago queda anulado y el pedido `reembolsado` |
| reembolsar un pedido en cualquier otra situación | rechazado |
| `GET /pedidos?estado=` con `borrador`, `confirmado`, `cancelado` o `reembolsado` | 200, filtrado por ese estado |
| `GET /pedidos?estado=` con cualquier otro valor | 400, nunca una lista vacía |

### Cálculo del total de un pedido

| Concepto | Regla |
|---|---|
| `subtotal` | suma de `cantidad × precio_unitario` de los items |
| `descuento` | calculado sobre el `subtotal` según el cupón; nunca supera el `subtotal` |
| `impuestos` | 19% sobre `subtotal − descuento` |
| `total` | `subtotal − descuento + impuestos` |

| Entrada | Resultado esperado |
|---|---|
| pedido sin cupón | `impuestos = 19% × subtotal`; `total = subtotal + impuestos` |
| pedido con cupón | `impuestos = 19% × (subtotal − descuento)`; `total = subtotal − descuento + impuestos` |
| cupón cuyo valor supera el subtotal | `descuento` no supera el `subtotal` |

### Cancelación de un pedido con pago

Cancelar un pedido no anula su pago: anular dinero que ya entró es una decisión financiera
distinta, con su propio endpoint (`/pedidos/{id}/reembolsar`) y su propio registro.

| Entrada | Resultado esperado |
|---|---|
| `POST /pedidos/{id}/cancelar` sobre un pedido `confirmado` con un pago `confirmado` | el pedido pasa a `cancelado` y el pago sigue `confirmado` |

### Pagos

| Entrada | Resultado esperado |
|---|---|
| alta de un pago | nace `pendiente` |
| alta de un pago para un pedido que ya tiene un pago activo (no anulado) | rechazada: un pedido tiene un solo pago activo a la vez |
| `monto_centavos` exactamente igual a `total_centavos` del pedido | aceptado |
| `monto_centavos` distinto de `total_centavos`, de más o de menos | 400: no hay pagos parciales |
| confirmar un pago `pendiente` | queda `confirmado` |
| confirmar un pago ya confirmado | 409 |
| anular un pago ya anulado | 409 |

### Envíos

| Entrada | Resultado esperado |
|---|---|
| generar un envío para un pedido confirmado sin envío previo | se crea en `pendiente` |
| pasar un envío a `en_transito` sin `tracking` | rechazado |
| pasar a `entregado` un envío que está en `en_transito` | permitido |
| pasar a `entregado` un envío en `pendiente`, por cualquier vía | 409 |
| `POST /envios/{id}/marcar-entregado` desde un estado distinto de `en_transito` | rechazado |
| cualquier cambio de estado sobre un envío `entregado` | rechazado |

### Cupones

| Entrada | Resultado esperado |
|---|---|
| cupón `tipo: "porcentaje"` | valor de 1 a 100 |
| cupón `tipo: "fijo"` | valor en centavos |
| aplicar un cupón inactivo a un pedido nuevo | rechazado |
| `GET /cupones/validar?codigo=...` | informa si el cupón se puede aplicar |
| eliminar un cupón referenciado por algún pedido | rechazado |

### Reseñas

| Entrada | Resultado esperado |
|---|---|
| alta de una reseña | nace `pendiente` |
| `POST /resenas/{id}/moderar` sobre una reseña `pendiente` | pasa a `aprobada` o `rechazada` |
| moderar una reseña ya moderada | rechazado |

### Usuarios

| Entrada | Resultado esperado |
|---|---|
| alta de un usuario | arranca con la contraseña de los datos de partida (`GET /admin/seed-info`) |
| `POST /usuarios/{id}/resetear-password` | la contraseña vuelve a la de los datos de partida |
| `/usuarios/{id}/cambiar-rol` | el rol nuevo rige en el próximo access token del usuario; el token ya emitido conserva el rol con el que se emitió hasta que expire o se refresque |
| alta de un usuario con un email idéntico a uno existente | 409 |
| alta de un usuario con un email que solo difiere en mayúsculas de uno existente (`ana@x.com` y `ANA@X.com`) | 409 |
| `GET /usuarios/{id}` de un usuario desactivado | 403 |
| `GET /usuarios?activo=false` | lista a los usuarios desactivados |

`GET /usuarios/{id}` de un usuario desactivado responde 403 y no 404 porque el usuario existe y
lo que se deniega es el acceso a su ficha: un 404 permitiría mapear qué emails existen probando
ids. El listado no expone la ficha individual de nadie.

### Auditoría y notificaciones

| Entrada | Resultado esperado |
|---|---|
| cambiar el rol de un usuario, resetear su contraseña, confirmar o anular un pago, moderar una reseña | cada acción queda registrada en `GET /auditoria` con quién la hizo, sobre qué recurso y cuándo |
| `GET /auditoria/recurso/{recurso}/{recurso_id}` | devuelve las entradas de auditoría de ese recurso |
| confirmar un pago | genera una notificación en `/notificaciones` para el vendedor dueño del pedido, avisando que puede proceder con el envío |

### Errores

Los errores se responden como `{"error": "...", "detalles": [...]}`; `detalles` solo aparece en
las validaciones (400).
