# 01 — Biblioteca de barrio

**Repo del SUT:** https://github.com/SantiagoMartinezCO/fitqa_demo_01

API de préstamos de una biblioteca chica: catálogo, socios y préstamos. Node 24 + Express +
SQLite embebido (`node:sqlite`), sin build y sin base en disco. Una sola dependencia de
ejecución.

```bash
git clone https://github.com/SantiagoMartinezCO/fitqa_demo_01.git
cd fitqa_demo_01 && npm install
PORT=3210 npm start          # el 3000 por defecto suele estar tomado
```

`POST /admin/reset` devuelve la base a la semilla. La base es en memoria y compartida por todo
el proceso: **cada caso que escribe tiene que resetear antes**.

## Magnitud medida

| | |
|---|---|
| Bucket | **pequeño** |
| S (superficie) | 13 — todo endpoints, sin rutas de UI ni flujos con estado |
| D (profundidad) | 356 líneas |
| Confianza | media |
| Stack detectado | express |

Parámetros de corrida que salen de esa medición:

```
FIT_MAX_TEST_CASES     = 20    # piso del bucket; S=13 no alcanza para fijarlo desde la superficie
FIT_MIN_TEST_CASES     = 20
FIT_MAX_ITERATIONS     = 6     # ceil(20/5) + 2 de margen
FIT_MAX_TURNS_ANALYZER = 60
```

Presupuesto esperado: ~286 turnos, ~19,2M tokens de entrada, 13 sesiones.

> La confianza da `media` y no `alta` por un solo olor —"el repo no tiene archivos
> commiteados"— que aparece solo si se mide una copia sin commitear. Midiendo el clone del repo
> no debería aparecer.

## Defectos sembrados

Tres, ninguno es un crash. El detalle ejecutable está en [`verdad.json`](verdad.json).

### BIB-01 — doble préstamo (S2)

`src/prestamos.js`, en `crear()`. El chequeo de disponibilidad usa `< 0` donde va `<= 0`, así
que entra un préstamo de más: un libro con un solo ejemplar se puede prestar dos veces y
`disponibles` queda en −1. El tercero sí rebota.

```
POST /admin/reset
POST /prestamos {libro_id: 2, socio_id: 1}   -> 201  (correcto)
POST /prestamos {libro_id: 2, socio_id: 3}   -> 201  (debería ser 409)
GET  /libros/2                               -> disponibles: -1
```

Contradice el README del SUT, *Disponibilidad*: "nunca puede ser negativo".

**Por qué vale:** solo aparece en la segunda llamada y no rompe nada visible. Hay que ejercitar
el estado; leyendo la respuesta de una sola petición no se ve.

### BIB-02 — la paginación pierde el primer registro (S3)

`src/libros.js`, en `listar()`: `OFFSET ?` recibe `desde + 1`. Con `desde=0` el primer libro no
aparece nunca, y `total` no coincide con lo que llega.

```
GET /libros?limite=3&desde=0   -> libros 2,3,4 en vez de 1,2,3
GET /libros?limite=100         -> total: 8, pero llegan 7
```

Contradice el README del SUT, *Paginación*: "`desde=0` devuelve desde el primer libro" y "la
suma de todas las páginas tiene que dar `total`".

**Por qué vale:** responde 200 y el JSON se ve bien. Solo cae si alguien compara `total` contra
lo que efectivamente llegó.

### BIB-03 — borrar un libro prestado pierde el préstamo (S1)

`src/libros.js`, en `borrar()`. `DELETE /libros/:id` borra el libro aunque tenga préstamos sin
devolver. El esquema no declara claves foráneas, así que el borrado pasa y los préstamos quedan
huérfanos: el JOIN de `GET /prestamos` los deja afuera y el préstamo vigente desaparece del
sistema.

```
POST   /admin/reset
POST   /prestamos {libro_id: 4, socio_id: 1}  -> 201
GET    /prestamos?activos=true                -> 1 préstamo
DELETE /libros/4                              -> 204 (debería ser 409)
GET    /prestamos?activos=true                -> 0 préstamos: el registro se perdió
```

Contradice el README del SUT, *Integridad de los préstamos*.

**Por qué vale:** pérdida de datos silenciosa, sin un solo 500 de por medio.

## Trampas

### TRAMPA-01 — el 403 del socio de baja

`GET /socios/4` (socio dado de baja) devuelve **403 y no 404**. Parece un código de estado
equivocado y no lo es: está documentado y justificado en el README del SUT, sección *Notas de
diseño* — el socio existe, y un 404 permitiría averiguar qué emails están registrados probando
ids.

**Reportarlo cuenta como falso positivo.** Es la única forma de medir precisión: sin al menos
una trampa, un agente que reporta todo saca 100% de recall y parece perfecto.

## Comportamiento que sí está bien

Conviene tenerlo a mano para no contar como acierto algo que el agente reportó de más:

- Devolver dos veces el mismo préstamo es 409.
- Un socio de baja no puede pedir prestado: 409.
- `isbn` y `email` duplicados son 409.
- `orden` fuera de la lista permitida y `limite` fuera de rango son 400.
- Ruta inexistente y recurso inexistente son 404.

## Verificar el catálogo

```bash
node verificar.mjs http://localhost:3210
```

Confirma que los tres defectos reproducen tal como están escritos, que la trampa se comporta
como dice el README y que los casos sanos siguen sanos. **Si esto falla, el catálogo no describe
al SUT y cualquier punteo contra él es basura.**
