---
name: bateria-demos-qa
description: Use when the QA-agent battery has to be run against the fitqa demos (repository and URL, with or without requirements), when measuring a new agent or platform version against the seeded defects, or when asked for a "tanda", "batería de demos" or recall per demo.
---

# Batería de demos del agente de QA

## Principio

Lo mecánico (lanzar, aprobar la revisión del plan, vigilar, encender y apagar Cloud Run,
reintentar por infraestructura, puntear) lo hace `tandas/tanda.py`. El agente solo interviene
antes de lanzar y cuando el script termina. **Mientras corre, el agente no consulta nada.**

## Antes de lanzar

1. **El usuario hace `gcloud auth login`** si la tanda usa Cloud Run. La sesión vence en
   horas; pedirla al empezar.
2. **Modelos y agente:** `get_llm_settings` y `list_agents` del MCP `fit-qa`. Anotar el modelo de
   cada rol y el `image_ref`. Si cambiaron respecto de la tanda con la que se compara, la mejora
   no se atribuye solo al agente: decirlo en el resultado.
3. **El catálogo apunta al digest que bajó el despliegue** (`agente disponible: …@sha256:…` en
   el log de `desplegar-vm-qa`). La plataforma no tiene credencial del registry: otro digest
   falla con `provision_error`.
4. **Ejecuciones ajenas en curso** sobre los mismos demos: no tocarlas y preguntar, porque
   comparten la base en memoria.
5. `python tandas/tanda.py <config> --simular` y mostrar el orden y la duración al usuario.

## Lanzar

```bash
cd fitqa-demos-kb
export FITQA_BASE_URL=https://<plataforma>/api FITQA_TOKEN_FILE=~/.secrets/fit-qa-mcp-token
python -u tandas/tanda.py tandas/<config>.json
```

Lanzarlo como **comando en segundo plano de la sesión** (opción `background` del shell) y
terminar el turno. La sesión avisa cuando el proceso termina. Si el servidor se reinicia, el
mismo comando retoma sin duplicar.

## Mientras corre

Nada. Solo si el usuario pregunta: `python tandas/tanda.py <config> --estado`, una sola vez.

## Cuando termina

| Código | Qué hacer |
|---|---|
| 0 | Leer `tandas/salida/<nombre>/resumen.md` |
| 2 | Verificación previa falló: leer `tanda.log`, corregir y relanzar |
| 3 | Pausas que piden una persona: mostrarlas al usuario, no responderlas |

1. **Emparejamientos dudosos** (`SIN DECIDIR`, `aviso`): decidir cada uno con la evidencia del
   caso y la entrada del catálogo o el código del SUT; registrar en `punteo/emparejamientos.json`
   y volver a puntear.
2. **Cloud Run:** confirmar los cuatro servicios en `min-instances 0`; bajar a mano lo que figure
   en `apagar_a_mano`.
3. **Resultado:** nota en el vault junto a las anteriores, con la tabla comparada contra la tanda
   previa; issues para lo que siga fallando, con run y caso; PR a la KB con los emparejamientos.

## Prohibido

| Tentación | Por qué no |
|---|---|
| `schtasks`, cron o proceso desacoplado para "sobrevivir a la sesión" | El usuario lo prohibió. El script retoma con el mismo comando |
| Consultar el estado cada N minutos | Gasta tokens sin decidir nada; el aviso llega solo |
| Cancelar una ejecución lenta | Los techos de iteraciones y turnos ya la cortan |
| Responder una pausa que no es la revisión del plan | Requiere una persona |
| Recortar casos o iteraciones "para ir rápido" | Rompe la comparación con las tandas anteriores |
| Correr verificadores o resets contra los demos durante la tanda | Comparten la base con las ejecuciones |

Para una tanda nueva, copiar `tandas/tanda-3.json` y cambiar `nombre`, entradas y orden. El orden
de la lista es la prioridad: las ejecuciones del mismo `grupo` van en fila, así que conviene
ponerlas primero.
