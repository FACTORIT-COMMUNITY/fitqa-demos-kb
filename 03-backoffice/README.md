# 03 — Back-office

**Repo del SUT:** https://github.com/SantiagoMartinezCO/fitqa-demo-03

API de back-office para un e-commerce chico: catálogo, inventario multi-bodega,
clientes, pedidos, pagos, envíos, cupones y usuarios con roles. Go 1.25 + chi v5 +
SQLite embebido (`modernc.org/sqlite`, sin CGO) en memoria; panel de administración en
Next.js (App Router).

```bash
git clone https://github.com/SantiagoMartinezCO/fitqa-demo-03.git
cd fitqa-demo-03 && go run ./cmd/api          # API en :8080 (PORT la cambia)
cd web && npm install && npm run dev          # panel en :3000 (opcional)
```

`POST /admin/reset` devuelve la base a la semilla; no requiere auth.
`GET /admin/seed-info` devuelve la contraseña y el email+rol de cada usuario sembrado;
tampoco requiere auth. El resto de la API exige `Authorization: Bearer <access_token>`
(`POST /auth/login {email, password}`).

## Magnitud medida

| | |
|---|---|
| Bucket | **grande** |
| S (superficie) | 102 — 94 endpoints + 7 páginas del panel Next + 1 flujo con estado |
| D (profundidad) | 5.481 líneas |
| Confianza | **alta** |
| Stack detectado | next (rutas/UI); Go+chi no está en `FRAMEWORKS` a propósito |

Parámetros de corrida que salen de esa medición:

```
FIT_MAX_TEST_CASES     = 102
FIT_MIN_TEST_CASES     = 68
FIT_MAX_ITERATIONS     = 23
FIT_MAX_TURNS_ANALYZER = 120
FIT_PLAN_GATE          = 1
```

Presupuesto esperado: ~1.443 turnos (piso), ~92,4M tokens de entrada, 47 sesiones.

> **Por qué hace falta un `.magnitud.json` en este demo y en ninguno de los otros dos.**
> `chi` está deliberadamente fuera de `FRAMEWORKS`: es el stack que la skill de medición
> usa para probar su capa de patrón genérico a escala real (el fixture sintético
> `go-chi-api` de la skill ya la cubre con 9 endpoints de juguete; este SUT la ejercita
> con 94 de verdad). El patrón genérico SÍ encuentra las rutas, pero su regla de
> deduplicación —"un mismo (verbo, ruta) repetido en el mismo archivo cuenta una vez"—
> asume que un archivo grande con rutas repetidas es *el mismo endpoint escrito dos
> veces* (el caso que esa regla existe para blindar, ver `jev-testing` en el propio
> `SKILL.md`). Acá no lo es: es el estilo idiomático de chi, que centraliza el árbol de
> rutas en `cmd/api/main.go` reutilizando paths relativos (`"/"`, `"/{id}"`) dentro de
> decenas de bloques `r.Route()/r.Group()`, uno por recurso. La consecuencia medida:
> sin declarar nada, `medir.py` cuenta 61 endpoints (`inferido`) y clasifica **mediano**
> con confianza media; contando a mano las llamadas `r.Get/r.Post/r.Put/r.Delete` de ese
> archivo (`grep -oE 'r\.(Get|Post|Put|Delete|Patch)\(' cmd/api/main.go | wc -l`) da 94.
> El `.magnitud.json` en la raíz del SUT declara ese número real, que pasa a
> `especificado` y sube la confianza a **alta** — es exactamente el escape hatch que el
> propio `SKILL.md` de la skill de medición documenta para "el stack que el medidor no
> sabe leer y para corregirlo cuando cuenta mal". Esto es realimentación real para la
> skill de medición, no un defecto de este SUT: vale la pena que quien mantenga
> `medir.py` sepa que su dedup por archivo no distingue "mismo endpoint repetido" de
> "mismo router anidado con paths relativos", y son cosas muy distintas.

## Roles y credenciales sembradas

Contraseña de todos los usuarios: `Demo1234!` (o `GET /admin/seed-info`).

| Email | Rol | Notas |
|---|---|---|
| ana.rodriguez@backoffice.demo | admin | todos los permisos |
| bruno.salas@backoffice.demo | operador | productos, categorías, inventario, pedidos, cupones |
| carla.nunez@backoffice.demo | vendedor | dueña del pedido 1 en la semilla |
| diego.paredes@backoffice.demo | vendedor | dueño del pedido 3 y 4 en la semilla |
| elena.vidal@backoffice.demo | operador | **desactivada** — para TRAMPA-01 |

## Defectos sembrados

Doce, cubriendo autorización, idempotencia, integridad, dinero, validación y la
lección de "alta vs. edición" que dejó demo-02. El detalle ejecutable con repro exacta
está en [`verdad.json`](verdad.json); acá el resumen.

| ID | Clase | Severidad | Resumen |
|---|---|---|---|
| BO-01 | autorización | S1 | `operador` confirma un pago sin tener `pagos.confirmar` (ruta mal wireada) |
| BO-02 | autorización | S1 | un `vendedor` cancela el pedido de otro vendedor |
| BO-03 | idempotencia | S1 | transferir stock dos veces con el mismo `idempotency_key` lo duplica |
| BO-04 | off-by-one | S3 | `orden=nombre` en `/productos` se valida pero se ignora al ordenar |
| BO-05 | integridad | S1 | borrar una categoría con productos los deja apuntando a un id inexistente |
| BO-06 | off-by-one | S3 | paginación de `/pedidos` con `desde=0` pierde el primer registro |
| BO-07 | dinero | S2 | los impuestos se calculan sobre el subtotal completo, ignorando el descuento del cupón |
| BO-08 | alta-vs-edición | S2 | editar una dirección a principal no desmarca la anterior (sí ocurre al crearla) |
| BO-09 | estado | S2 | un envío pasa a `entregado` sin pasar por `en_transito` |
| BO-10 | integridad | S2 | borrar la dirección principal de un cliente no promueve otra |
| BO-11 | validación | S3 | `estado` inválido en `/pedidos` da 200 con lista vacía en vez de 400 |
| BO-12 | validación/dinero | S2 | un pago se acepta aunque su monto no coincida con el total del pedido |

**Por qué vale cada uno:** BO-01/02 son bypasses de autorización reales, sin ningún 500
de por medio. BO-03 solo aparece en la SEGUNDA llamada (regla 2 del método). BO-05 y
BO-10 son pérdida silenciosa de integridad referencial, sin crash. BO-07 y BO-12 son
errores de dinero que no se notan mirando un solo campo, hay que hacer la cuenta. BO-08
es la regla 7 del método aplicada de nuevo: se verificó la ruta del alta y no la de la
edición.

## Trampas

### TRAMPA-01 — el 403 del usuario desactivado

`GET /usuarios/{id}` de un usuario desactivado (`elena.vidal`, id 5) devuelve **403 y no
404**. Documentado en el README del SUT, sección *Notas de diseño*: el usuario existe,
lo que no hay es acceso a su ficha — mismo argumento que BIB-01 en demo-01.

### TRAMPA-02 — los reportes son solo para `admin`

`/reportes/*` devuelve 403 para cualquier rol que no sea `admin`, aunque el endpoint
exista y el token sea válido. Documentado como decisión de negocio, no como permiso mal
asignado.

### TRAMPA-03 — cancelar un pedido no anula su pago

Cancelar un pedido `confirmado` con un pago `confirmado` deja el pago exactamente como
estaba. Parece plata que quedó colgada; es una decisión deliberada — anular dinero que
ya entró es un flujo aparte (`/pedidos/{id}/reembolsar`), documentado en el README del
SUT.

**Reportar cualquiera de las tres cuenta como falso positivo.**

## Comportamiento que sí está bien

Conviene tenerlo a mano para no contar como acierto algo que el agente reportó de más:

- Confirmar o anular un pago ya resuelto es 409 (no un no-op silencioso).
- Un producto con pedidos asociados no se puede eliminar: 409.
- Un cliente dado de baja no puede generar pedidos nuevos: 409.
- Un cupón inactivo no es válido para un pedido nuevo.
- Un vendedor **sí** puede cancelar sus propios pedidos (el bug es solo con los ajenos).
- Validación de cuerpo, `orden` fuera del enum y rutas inexistentes son 400/404, incluso
  sin autenticación.

## Verificar el catálogo

```bash
node verificar.mjs http://localhost:8080
```

Confirma los 12 defectos, las 3 trampas y 6 casos "sano" contra un servidor recién
reseteado. **Si esto falla, el catálogo no describe al SUT y cualquier punteo contra él
es basura.**
