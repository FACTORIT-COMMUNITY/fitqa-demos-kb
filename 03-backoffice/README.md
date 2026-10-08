# 03 — Back-office

**Repo del SUT:** https://github.com/FACTORIT-COMMUNITY/fitqa-demo-03

Back-office de un e-commerce chico: catálogo, inventario multi-bodega, clientes, pedidos,
pagos, envíos, cupones, reseñas y usuarios con roles. API en **Go + chi** sobre SQLite
embebido; panel de administración en **Next.js**.

```bash
git clone https://github.com/FACTORIT-COMMUNITY/fitqa-demo-03.git
cd fitqa-demo-03
go run ./cmd/api                        # API en :8080 (PORT lo cambia)
cd web && npm install && npm run dev    # panel en :3000, apunta a NEXT_PUBLIC_API_URL
```

`POST /admin/reset` recrea el esquema entero y vuelve a sembrar. `GET /admin/seed-info`
devuelve la contraseña de siembra y los usuarios, para poder autenticarse sin leer el código.
Ninguno de los dos pide autenticación.

Auth por JWT: `POST /auth/login` da `access_token` (15 min) y `refresh_token` (7 días). Tres
roles fijos: `admin`, `operador`, `vendedor`.

## Magnitud medida

Medido el 2026-09-23 sobre el clone del repo.

| | |
|---|---|
| Bucket | **grande** |
| S (superficie) | 107 — 94 endpoints + 8 rutas Next + 5 flujos |
| D (profundidad) | 5.940 líneas |
| Confianza | media |
| Stack detectado | next (+ chi por patrón genérico) |
| Modificadores | ninguno activo |

```
FIT_MAX_TEST_CASES     = 107   # ~1 caso por punto de superficie
FIT_MIN_TEST_CASES     = 71
FIT_MAX_ITERATIONS     = 24    # ceil(107/5) + 2 de margen
FIT_MAX_TURNS_ANALYZER = 120
FIT_PLAN_GATE          = 1     # la confianza no es alta
```

Presupuesto esperado: ~1.505 turnos, ~96,3M tokens de entrada, 49 sesiones. Es un **piso**.

### Es el demo que probó el agnosticismo, y lo rompió primero

chi no está en la lista de frameworks de la skill: los 94 endpoints los cuenta la **capa
genérica**, que es justamente para lo que existe. Pero medir este repo destapó dos defectos del
patrón genérico que ningún fixture había tocado, los dos por el mismo motivo —un router
anidado y centralizado en un solo archivo, el estilo idiomático de chi:

| | Contaba | Por qué |
|---|---|---|
| Dedup por `(verbo, ruta)` | **61** | tres bloques `r.Route(...)` que reusan `"/"` y `"/{id}"` colapsaban en uno |
| `r.Route(...)` como endpoint | **108** | los 14 montajes de sub-router se contaban a sí mismos como un endpoint `*` |
| Arreglado (2026-09-23) | **94** | el handler entra a la clave de dedup; un `Route` con closure y sin métodos es montaje |

94 es el conteo a mano: `grep -c 'r.(Get|Post|Put|Patch|Delete)("'` sobre los `.go` da 94, y
`r.Route("` da 14. El mismo problema existe en un `Router()` de Express o un `include_router`
de FastAPI, así que no era una particularidad de Go.

Mientras tanto el repo tuvo un `.magnitud.json` declarando la magnitud a mano; se sacó cuando
el medidor empezó a contar bien (commit `2449620`).

### Dos cosas más de la medición

**La confianza queda en `media` y está bien que quede.** Este repo no publica contrato, así que
`endpoints` sale `inferido` y no hay nada que lo avale. Es el resultado honesto: 94 salidos de
un regex sobre código Go son un piso, no una medida.

**Falta una ruta de Next.** El repo tiene 9 archivos `page.tsx` y el medidor cuenta 8: el regex
de rutas de Next exige un carácter antes de `page`, así que `web/app/page.tsx` —la home— nunca
matchea. S real es 108, no 107. No mueve el bucket, pero es un hueco conocido del medidor: el
mismo que hace que `fit-vigia` mida 11 rutas contra 12.

## Trampas

Son cuatro. Las tres primeras están escritas y justificadas en el README del SUT, sección
*Notas de diseño*; la cuarta, en la sección *Usuarios*. Reportar cualquiera cuenta como
**falso positivo**.

### TRAMPA-01 — `GET /usuarios/{id}` de un usuario desactivado devuelve 403, no 404

Parece un código de estado equivocado: el recurso no está disponible, debería ser 404. No lo
es: el usuario existe y lo que falta es acceso a su ficha. Un 404 permitiría mapear qué emails
existen probando ids uno por uno. `GET /usuarios?activo=false` sí lista a los desactivados,
porque ahí no se expone la ficha individual de nadie.

### TRAMPA-02 — un `operador` recibe 403 en `/reportes/*`

Parece un permiso que falta asignar al rol. Es una decisión: los reportes financieros son solo
para `admin`, porque la cifra de ventas y el detalle de qué se vendió no son información
operativa del día a día.

### TRAMPA-03 — cancelar un pedido no anula su pago

`POST /pedidos/{id}/cancelar` sobre un pedido `confirmado` con un pago `confirmado` deja el
pedido en `cancelado` y el pago en `confirmado`. Parece un estado inconsistente. No lo es:
anular dinero que ya entró es una decisión financiera distinta de cancelar un pedido
operativamente, y tiene su propio endpoint (`/pedidos/{id}/reembolsar`) con su propio registro.
Un pedido cancelado con el pago todavía confirmado es la señal de que falta iniciar ese
reembolso.

### TRAMPA-04 — cambiar el rol no afecta al access token ya emitido

`POST /usuarios/{id}/cambiar-rol` no le quita privilegios al token que el usuario ya tiene: sigue
actuando con el rol anterior hasta que expire (15 min) o se refresque. Parece que el cambio de
rol no se aplicó. El README del SUT lo declara: el rol nuevo surte efecto en el próximo access
token.

## Defectos sembrados

Dieciséis, más las cuatro trampas de arriba. El detalle ejecutable (ubicación, repro, regla que
contradice) está en [`verdad.json`](verdad.json).

| ID | Qué | Sev | Clase |
|---|---|---|---|
| BO-01 | Confirmar un pago queda bajo `pedidos.gestionar` y no bajo `pagos.confirmar`: un operador lo confirma | **S1** | autorizacion |
| BO-02 | Un vendedor cancela el pedido de otro vendedor | **S1** | autorizacion |
| BO-03 | Reenviar una transferencia con la misma `idempotency_key` mueve el stock dos veces | **S1** | idempotencia |
| BO-05 | Borrar una categoría con productos los deja huérfanos | **S1** | integridad |
| BO-07 | Los impuestos se calculan sobre el subtotal sin descontar el cupón | **S2** | dinero |
| BO-08 | Editar una dirección a principal no desmarca la anterior | **S2** | alta-vs-edicion |
| BO-09 | Un envío pasa de `pendiente` a `entregado` sin `en_transito` | **S2** | estado |
| BO-10 | Borrar la dirección principal no promueve otra | **S2** | integridad |
| BO-12 | `POST /pagos` acepta un monto distinto del total del pedido | **S2** | validacion |
| BO-13 | Las acciones sensibles no se registran en auditoría | **S2** | integridad/observabilidad |
| BO-15 | Se puede vender un producto no publicado | **S2** | validacion/integridad |
| BO-04 | `GET /productos?orden=` acepta el valor y lo ignora: siempre ordena por id | **S3** | orden |
| BO-06 | La paginación de `/pedidos` pierde el primer registro | **S3** | off-by-one |
| BO-11 | `GET /pedidos?estado=<inválido>` responde lista vacía y no 400 | **S3** | validacion |
| BO-14 | Confirmar un pago no notifica al vendedor | **S3** | integridad/automatizacion |
| BO-16 | La unicidad del email distingue mayúsculas | **S3** | validacion/normalizacion |

**BO-04 y BO-06 no contradicen una regla escrita del README del SUT**: el parámetro `orden` de
`/productos` y la paginación de `/pedidos` no figuran ahí. BO-04 contradice el contrato que la
propia API expone (valida `orden` contra `id|nombre|precio` y responde 400 a cualquier otro
valor, pero descarta el valor aceptado); BO-06, la convención de paginación del resto de los
listados. Un agente que solo prueba lo que el README promete no tiene regla contra la cual
reportarlos.

### Errores visibles solo por la API

BO-09, BO-12 y BO-15 llevan el campo `solo_por_api`. En los tres el panel web aplica la regla y
tapa el defecto: el panel solo ofrece la transición a `en_transito` con el envío pendiente,
fija el monto del pago al total del pedido y filtra los productos no publicados en el
formulario de pedido nuevo. Una corrida que solo recorre el panel no puede encontrarlos; el
campo cita el archivo y la línea del panel que lo explica.

## Esquema de `verdad.json`

Cada entrada de `sembrados` lleva `id`, `ubicacion`, `clase`, `severidad_esperada`, `sintoma`,
`repro`, `contradice`, `por_que_vale` y `trampa`. Las trampas llevan `trampa: true` y
`severidad_esperada: null`. Campo opcional:

| Campo | Significado |
|---|---|
| `solo_por_api` | el defecto existe en la API, pero el panel web aplica la regla y no deja reproducirlo desde la interfaz; el valor cita `archivo:línea` del panel |

## Verificar el catálogo

```bash
node verificar.mjs http://localhost:8080
```

Confirma que los dieciséis defectos reproducen tal como están escritos, que las cuatro trampas
se comportan como dice el README del SUT y que los casos sanos siguen sanos. **Si esto falla,
el catálogo no describe al SUT y cualquier punteo contra él es basura.**
