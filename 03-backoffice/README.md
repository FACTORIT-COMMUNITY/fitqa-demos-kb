# 03 — Back-office

**Repo del SUT:** https://github.com/SantiagoMartinezCO/fitqa-demo-03

Back-office de un e-commerce chico: catálogo, inventario multi-bodega, clientes, pedidos,
pagos, envíos, cupones, reseñas y usuarios con roles. API en **Go + chi** sobre SQLite
embebido; panel de administración en **Next.js**.

```bash
git clone https://github.com/SantiagoMartinezCO/fitqa-demo-03.git
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

Las tres están escritas y justificadas en el README del SUT, sección *Notas de diseño*.
Reportar cualquiera cuenta como **falso positivo**.

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

## Catálogo de defectos sembrados — PENDIENTE

**Este demo todavía no tiene catálogo, y sin catálogo no se puede puntear una corrida.**

El SUT se construyó fuera de esta base de conocimiento y su repo —correctamente— no dice cuáles
son sus defectos sembrados. Escribirlos acá a partir de leer el código sería adivinar: se
confundiría un defecto sembrado con uno accidental, y un catálogo incompleto no baja el recall
sino que arruina la precisión, que es la lección que dejó el demo 01.

Hasta que exista `verdad.json` y su `verificar.mjs`, de este demo se puede usar la **magnitud y
los parámetros de corrida** —que sí están medidos— pero **no** los tres números del punteo.

Lo que hace falta, en orden:

1. La lista de defectos sembrados con id, ubicación, síntoma, severidad esperada y la regla del
   README del SUT que cada uno contradice.
2. `verdad.json` con esa lista, más las tres trampas de arriba y los comportamientos sanos.
3. `verificar.mjs` que confirme cada entrada contra el SUT levantado, **incluida cada regla por
   la ruta de actualización y no solo por la de alta** (regla 7 del método).

El README del SUT es una spec detallada y sirve de base: cada regla explícita que declara es
candidata a ser contradicha por un defecto sembrado. Algunas que se prestan especialmente:

- La cadena del total de un pedido: `subtotal − descuento + impuestos(19%)`, con el descuento
  calculado sobre el subtotal y nunca mayor que él.
- La dirección principal de un cliente: exactamente una, y si se borra la principal la más
  antigua de las restantes ocupa el lugar.
- La idempotencia de `/bodegas/transferir-stock` por `idempotency_key`, la única escritura del
  sistema con esa garantía.
- El orden de los estados de un envío: `entregado` solo desde `en_transito`, nunca desde
  `pendiente`.
- Confirmar un pago ya confirmado es 409, no un no-op.
- El email de usuario es único **sin distinguir mayúsculas**.
- `GET /pedidos?estado=<valor inválido>` es 400, nunca una lista vacía silenciosa.
