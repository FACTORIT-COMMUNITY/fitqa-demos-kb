---
name: medir-agente-con-demos
description: Use when the QA agent has to be measured against the fitqa demos (repository and URL runs, with or without the requirements document), when a new agent or platform version needs its recall against the seeded defects, or when asked to run the demo battery.
---

# Medición del agente de QA con los demos

## Reparto de trabajo

`mediciones/medir.py` lanza las ejecuciones, aprueba la revisión del plan, vigila, enciende y apaga
Cloud Run, reintenta las fallas de infraestructura y puntea. El agente actúa antes del lanzamiento
y después del final. Mientras el script corre, el agente no consulta la plataforma.

## Verificaciones previas

1. **Sesión de `gcloud`:** el usuario corre `gcloud auth login` si el conjunto usa Cloud Run. La
   sesión vence en horas, así que se pide al empezar.
2. **Modelos y agente:** `get_llm_settings` y `list_agents` del MCP `fit-qa`. Se registran el
   modelo de cada rol y el `image_ref`. Si difieren de la medición con la que se compara, el
   resultado lo informa: la diferencia no se atribuye solo al agente.
3. **Digest del catálogo:** el `image_ref` es el digest que bajó el despliegue (línea
   `agente disponible: …@sha256:…` del log de `desplegar-vm-qa`). La plataforma no tiene
   credencial del registry, y otro digest termina en `provision_error`.
4. **Ejecuciones ajenas en curso:** no se tocan, y se consulta al usuario antes de lanzar sobre
   los mismos demos, porque comparten la base en memoria. También ocupan el tope de ejecuciones
   simultáneas de la plataforma.
5. **Simulación:** `python mediciones/medir.py <conjunto> --simular`, con el orden y la duración
   mostrados al usuario.

## Lanzamiento

```bash
cd fitqa-demos-kb
export FITQA_BASE_URL=https://<plataforma>/api FITQA_TOKEN_FILE=~/.secrets/fit-qa-mcp-token
python -u mediciones/medir.py mediciones/<conjunto>.json
```

El comando corre en segundo plano dentro de la sesión (opción `background` del shell) y el turno
termina ahí. La sesión avisa cuando el proceso termina. Tras un reinicio del servidor, el mismo
comando retoma sin duplicar ejecuciones.

## Consultas durante la ejecución

Solo a pedido del usuario: `python mediciones/medir.py <conjunto> --estado`, una vez.

## Cierre según el código de salida

| Código | Acción |
|---|---|
| 0 | Leer `mediciones/salida/<slug>/resumen.md` |
| 2 | La verificación previa falló: leer `registro.log`, corregir y relanzar |
| 3 | Hay pausas que piden una persona: informarlas al usuario sin responderlas |

1. **Emparejamientos dudosos** (`SIN DECIDIR` y `aviso`): cada uno se decide con la evidencia del
   caso y la entrada del catálogo o el código del SUT, se registra en
   `punteo/emparejamientos.json` y se vuelve a puntear.
2. **Cloud Run:** los cuatro servicios en `min-instances 0`. Lo listado en `apagar_a_mano` se
   baja con `gcloud`.
3. **Resultado:** nota en el vault junto a las mediciones anteriores, con la tabla comparada;
   issues de lo que siga fallando, con ejecución y caso; PR a la KB con los emparejamientos.

## Acciones excluidas

| Acción | Motivo |
|---|---|
| `schtasks`, cron o un proceso desacoplado para sobrevivir a la sesión | El usuario lo prohibió; el script retoma con el mismo comando |
| Consultar el estado cada cierto tiempo | Consume tokens sin decidir nada; la sesión avisa al terminar |
| Cancelar una ejecución lenta | Los techos de iteraciones y turnos la cierran |
| Responder una pausa distinta de la revisión del plan | Requiere una persona |
| Reducir casos o iteraciones | Rompe la comparación con las mediciones anteriores |
| Verificadores o `POST /admin/reset` contra los demos durante la medición | Alteran la base que usan las ejecuciones |

## Conjunto nuevo

Se copia `mediciones/tres-demos-todos-los-modos.json` y se cambian `slug`, `titulo`, las
`etiqueta` de cada ejecución, las entradas y el orden. El orden de la lista es la prioridad de
lanzamiento; las ejecuciones del mismo `grupo` corren en fila y conviene ubicarlas primero. La
`etiqueta` es el nombre visible en la plataforma: demo, superficie y si lleva requisitos.
