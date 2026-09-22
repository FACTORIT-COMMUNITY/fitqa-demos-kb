# fitqa demos — base de conocimiento

Verdad de referencia de los sistemas de demostración que se usan para ejercitar y medir el
agente de QA. Cada demo vive en **su propio repositorio**; acá vive lo que ese repositorio no
puede contener.

## Por qué esto está separado

El agente clona el repo del SUT y lee todo lo que hay adentro. Si el catálogo de defectos vive
en ese repo, el agente no encuentra los defectos: los copia, el recall da 100% y la corrida no
midió nada.

No alcanza con no listarlos. **Si el README del SUT dice siquiera que el proyecto tiene defectos
sembrados, la medición ya está contaminada**: un proyecto real no avisa que tiene bugs, y un
agente que sabe que los hay busca distinto. Por eso el repo del SUT se describe a sí mismo como
lo haría cualquier producto, y el aviso para las personas vive en la descripción del repo en
GitHub, que se ve en la web y no baja con `git clone`.

Los enlaces van en una sola dirección: de acá al demo, nunca del demo hacia acá.

## Demos

| # | Sistema | Repo | Stack | Magnitud | Sembrados |
|---|---|---|---|---|---|
| 01 | Biblioteca de barrio | [fitqa-demo-01](https://github.com/SantiagoMartinezCO/fitqa-demo-01) | Node 24 + Express + `node:sqlite` | **pequeño** (S=13, D=356) | 3 + 1 trampa |
| 02 | Reserva de canchas | [fitqa-demo-02](https://github.com/SantiagoMartinezCO/fitqa-demo-02) | Python 3.13 + FastAPI + `sqlite3` | **mediano** (S=68, D=2.747) | 8 + 2 trampas |
| 03 | Back-office | _pendiente_ | Go + chi + Next | grande (objetivo S≈105) | ~20 + trampas |

Ficha de cada uno en su carpeta: [`01-biblioteca/`](01-biblioteca/), [`02-canchas/`](02-canchas/).

## Qué lleva la ficha de un demo

- **Qué es y cómo levantarlo**, incluido el puerto y el endpoint de reset.
- **La magnitud medida** y los parámetros de corrida que salen de ella.
- **El catálogo de defectos sembrados**: ubicación, síntoma, repro mínima, severidad esperada y
  qué regla del README del SUT contradice cada uno.
- **Las trampas**: comportamientos que parecen defectos y están documentados en el SUT.
  Reportarlos cuenta como falso positivo.
- **Un verificador ejecutable** que confirma que cada entrada del catálogo reproduce de verdad.

## El ciclo completo

```bash
# 1. levantar el SUT
git clone https://github.com/SantiagoMartinezCO/fitqa-demo-01.git
cd fitqa-demo-01 && npm install && PORT=3210 npm start

# 2. confirmar que el catálogo describe al SUT (si esto falla, no midas nada)
node <kb>/01-biblioteca/verificar.mjs http://localhost:3210

# 3. dimensionar
python medir.py <ruta-al-clone>

# 4. correr el agente con los parámetros que salieron del paso 3
QA_BASE_URL=http://localhost:3210 fit-qa --project <ruta-al-clone> ...

# 5. puntear el informe del agente contra verdad.json
```

## Cómo se puntea una corrida

Tres números, y son el resultado de la corrida — no el informe del agente:

- **Recall** — sembrados con `trampa: false` que el agente reportó, sobre el total de sembrados.
- **Precisión** — bugs reportados que están en el catálogo, sobre el total de bugs reportados.
  **Reportar una trampa cuenta como falso positivo.** Sin al menos una trampa se mide recall y
  nunca precisión, y un agente que reporta todo saca 100%.
- **Acuerdo de severidad** — de los encontrados, cuántos coinciden con `severidad_esperada`.

## Reglas para sembrar un defecto

Lo aprendido construyendo el primero:

1. **Que no todos sean crashes.** Un 500 lo encuentra cualquiera. Los que valen: un off-by-one
   en paginación, un total que suma mal, un orden que ignora el `sort`.
2. **Al menos uno que solo aparezca en la segunda llamada** — idempotencia rota, doble
   confirmación. Eso distingue un agente de un linter.
3. **Al menos una trampa**, documentada y justificada en el README del SUT. Si no está
   documentada no es una trampa, es un bug.
4. **Que cada defecto contradiga una regla escrita** en el README del SUT. Un defecto que no
   contradice nada es una diferencia de opinión, y no se puede puntear.
5. **Semilla determinística y endpoint de reset.** Sin eso, la iteración 7 prueba sobre lo que
   dejó la 6 y no se distingue un defecto de una contaminación.
6. **Verificá el catálogo antes de usarlo.** Un catálogo que miente convierte cualquier punteo
   en basura. Los verificadores de cada demo existen para eso.
7. **Verificá cada regla por las dos puertas: la que crea y la que edita.** El verificador del
   demo 01 probó la unicidad de `isbn` en el alta y no en la modificación, y ahí había un
   defecto que nadie había sembrado: el agente lo encontró y el catálogo lo contó como falso
   positivo. Un catálogo incompleto no baja el recall, arruina la precisión.
