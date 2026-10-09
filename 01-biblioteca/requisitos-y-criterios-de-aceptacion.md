# Requisitos y criterios de aceptación — Biblioteca de barrio

API de préstamos de una biblioteca de barrio: catálogo de libros, socios y préstamos. Cada
regla de este documento indica el comportamiento esperado y el criterio con el que se acepta.

## Alcance

- El sistema no tiene autenticación: todas las operaciones se invocan sin credenciales.
- La raíz (`/`) sirve una página del catálogo que consume la propia API.
- No hay contrato OpenAPI: el comportamiento comprometido es el que describe este documento.

## Entidades

| Entidad | Datos relevantes |
|---|---|
| Libro | `isbn` (único), `titulo`, `autor`, `anio`, `ejemplares`; la ficha agrega `disponibles` |
| Socio | `email` (único), `estado` (`activo` o `baja`); la ficha agrega `prestamos_activos` |
| Préstamo | libro, socio y si está devuelto o vigente |

## Endpoints

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | estado y versión |
| POST | `/admin/reset` | vuelve a los datos de partida |
| GET | `/libros` | listado paginado (`limite`, `desde`, `orden`) |
| POST | `/libros` | alta |
| GET | `/libros/:id` | ficha, con `disponibles` |
| PUT | `/libros/:id` | modificación parcial |
| DELETE | `/libros/:id` | baja |
| GET | `/socios` | listado, filtrable por `estado` |
| POST | `/socios` | alta |
| GET | `/socios/:id` | ficha, con `prestamos_activos` |
| GET | `/prestamos` | listado, filtrable por `activos` |
| POST | `/prestamos` | prestar un libro a un socio |
| POST | `/prestamos/:id/devolucion` | devolver |

## Operaciones de soporte

| Operación | Comportamiento esperado |
|---|---|
| `GET /health` | responde `{"estado":"ok"}` cuando el sistema está listo |
| `POST /admin/reset` | devuelve la base a los datos de partida. Los datos son compartidos por todo el sistema, por lo que conviene llamarlo antes de cada prueba que escriba |

Datos de partida:

- 8 libros y 4 socios.
- Socios: 1 Ana Torres (activo), 2 Bruno Díaz (activo), 3 Carla Ruiz (activo), 4 Darío Peña
  (baja).
- Ejemplares por libro (id → ejemplares): 1→2, 2→1, 3→3, 4→1, 5→2, 6→1, 7→1, 8→4.

## Reglas y criterios de aceptación

### Paginación de `/libros`

`limite` acepta valores de 1 a 100 (valor predeterminado 20); `desde` es un desplazamiento
(valor predeterminado 0).

| Entrada | Resultado esperado |
|---|---|
| `GET /libros` sin parámetros | hasta 20 libros, desde el primero |
| `GET /libros?desde=0` | el primer elemento devuelto es el primer libro |
| recorrer el listado avanzando `desde` de a `limite` | cada libro aparece exactamente una vez |
| suma de los elementos de todas las páginas | igual a `total` |
| `limite` fuera de 1–100, o `desde` fuera de rango | 400 |

### Orden de `/libros`

| Entrada | Resultado esperado |
|---|---|
| `orden` igual a `id`, `titulo`, `autor` o `anio` | 200, listado ordenado por ese campo |
| `orden` con cualquier otro valor | 400 |

### Disponibilidad

`disponibles = ejemplares − préstamos sin devolver`. Nunca puede ser negativo.

| Entrada | Resultado esperado |
|---|---|
| préstamo de un libro con `disponibles` mayor a 0 | el préstamo se registra; `disponibles` baja en 1 |
| préstamo de un libro con `disponibles` en 0 | 409 `no quedan ejemplares disponibles` |
| un libro con N ejemplares y N préstamos vigentes | `GET /libros/:id` informa `disponibles: 0` |
| cualquier secuencia de préstamos | `disponibles` nunca es menor que 0 |

### Devolución

| Entrada | Resultado esperado |
|---|---|
| devolver un préstamo vigente | el préstamo queda devuelto y el ejemplar vuelve a estar disponible |
| devolver un préstamo ya devuelto | 409, sin ningún cambio de estado |

### Socios de baja

| Entrada | Resultado esperado |
|---|---|
| `POST /prestamos` con un socio en estado `baja` | 409 |

### Integridad de los préstamos

Un préstamo sin devolver es un hecho registrado: ninguna operación sobre el catálogo puede
hacerlo desaparecer ni dejarlo sin libro asociado.

| Entrada | Resultado esperado |
|---|---|
| cualquier operación sobre `/libros` con préstamos vigentes registrados | `GET /prestamos` sigue mostrando todos los préstamos vigentes, cada uno con su libro asociado |

### Unicidad

| Entrada | Resultado esperado |
|---|---|
| alta o modificación de un libro con un `isbn` ya registrado en otro libro | 409 |
| alta de un socio con un `email` ya registrado | 409 |

### Validación y errores

Los errores se responden como `{"error": "..."}`; los de validación agregan `detalles`.

| Entrada | Resultado esperado |
|---|---|
| cuerpo con datos inválidos | 400 con `{error, detalles[]}` |
| JSON mal formado | 400 |
| recurso inexistente | 404 |
| ruta inexistente | 404 |

### Ficha de un socio de baja

El socio de baja existe y el acceso a su ficha está denegado. Responder 404 permitiría averiguar
qué emails están registrados probando ids.

| Entrada | Resultado esperado |
|---|---|
| `GET /socios/:id` de un socio en estado `baja` | 403 |
| `GET /socios?estado=baja` | 200; el listado incluye a los socios de baja |
