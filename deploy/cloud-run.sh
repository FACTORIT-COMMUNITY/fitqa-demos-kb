#!/usr/bin/env bash
# Despliega los tres demos en Cloud Run desde su codigo fuente, con buildpacks.
#
#   bash deploy/cloud-run.sh              # despliega main de cada demo
#   REF=<tag|commit> bash deploy/cloud-run.sh
#
# Los repos de los demos no llevan Dockerfile ni configuracion de despliegue: el agente los
# clona y todo lo que haya adentro altera lo que mide. Por eso el despliegue vive aca y
# clona cada demo en una carpeta temporal.
#
# Se puede correr cuantas veces haga falta: cada corrida publica una revision nueva de los
# mismos cuatro servicios.
set -euo pipefail

PROJECT="${PROJECT:-fit-qa-495414}"
REGION="${REGION:-us-central1}"
REF="${REF:-main}"
ORG="https://github.com/FACTORIT-COMMUNITY"
REPO_IMAGENES="cloud-run-source-deploy"

# max-instances=1 es obligatorio: cada demo guarda su base SQLite en memoria del proceso.
# Con dos instancias el estado queda partido entre ellas y aparecen defectos que no existen.
# min-instances=0 y cpu-throttling (facturacion por request): sin trafico no se cobra.
COMUNES=(
  --project "$PROJECT"
  --region "$REGION"
  --allow-unauthenticated
  --min-instances 0
  --max-instances 1
  --cpu 1
  --memory 512Mi
  --cpu-throttling
  --labels app=fitqa-demos
  --quiet
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

clonar() {
  local repo="$1"
  git clone -q "$ORG/$repo.git" "$TMP/$repo"
  git -C "$TMP/$repo" checkout -q "$REF"
  echo "$repo @ $(git -C "$TMP/$repo" rev-parse --short HEAD)"
}

desplegar() {
  local servicio="$1" carpeta="$2"
  shift 2
  echo
  echo "== $servicio"
  (cd "$carpeta" && gcloud run deploy "$servicio" --source . "${COMUNES[@]}" "$@")
}

url_de() {
  gcloud run services describe "$1" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
}

comprobar() {
  local servicio="$1" ruta="$2" url codigo
  url="$(url_de "$servicio")"
  codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$url$ruta")"
  printf '%-20s %s%s -> %s\n' "$servicio" "$url" "$ruta" "$codigo"
  [ "$codigo" = "200" ]
}

clonar fitqa-demo-01
clonar fitqa-demo-02
clonar fitqa-demo-03

# 01 - Node 24 + Express. Arranca con `npm start` y escucha en $PORT.
desplegar fitqa-demo-01 "$TMP/fitqa-demo-01" \
  --set-build-env-vars GOOGLE_RUNTIME_VERSION=24

# 02 - FastAPI. Un solo worker de uvicorn: cada worker tendria su propia base.
# requirements.txt no fija versiones y las pantallas usan TemplateResponse(nombre, contexto),
# firma que starlette 1.x ya no acepta: sin esta restriccion las 6 pantallas dan 500. La
# restriccion se escribe solo en la copia temporal y pip la toma de PIP_CONSTRAINT.
echo 'starlette<1.0' > "$TMP/fitqa-demo-02/restricciones-deploy.txt"
desplegar fitqa-demo-02 "$TMP/fitqa-demo-02" \
  --set-build-env-vars 'GOOGLE_RUNTIME_VERSION=3.13,PIP_CONSTRAINT=/workspace/restricciones-deploy.txt,GOOGLE_ENTRYPOINT=uvicorn app.main:app --host 0.0.0.0 --port $PORT'

# 03 - API Go (chi). El CORS ya permite cualquier origen.
desplegar fitqa-demo-03-api "$TMP/fitqa-demo-03" \
  --set-build-env-vars GOOGLE_BUILDABLE=./cmd/api

# 03 - Panel Next. NEXT_PUBLIC_API_URL queda fijo en el build, por eso va despues de la API.
API_03="$(url_de fitqa-demo-03-api)"
desplegar fitqa-demo-03-web "$TMP/fitqa-demo-03/web" \
  --set-build-env-vars "GOOGLE_NODE_RUN_SCRIPTS=build,NEXT_PUBLIC_API_URL=$API_03"

# El repo de imagenes lo crea el primer despliegue. Se conserva solo la ultima imagen de
# cada demo para no pagar almacenamiento; la regla filtra por prefijo y no toca otras
# imagenes que puedan llegar a este repo.
cat > "$TMP/limpieza.json" <<'JSON'
[
  {
    "name": "borrar-demos-viejos",
    "action": {"type": "Delete"},
    "condition": {"tagState": "any", "packageNamePrefixes": ["fitqa-demo"]}
  },
  {
    "name": "conservar-ultima-imagen",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": 1, "packageNamePrefixes": ["fitqa-demo"]}
  }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$REPO_IMAGENES" \
  --project "$PROJECT" --location "$REGION" \
  --policy "$TMP/limpieza.json" --no-dry-run --quiet >/dev/null

echo
echo "== Comprobacion"
fallos=0
comprobar fitqa-demo-01 /health || fallos=$((fallos + 1))
comprobar fitqa-demo-02 /health || fallos=$((fallos + 1))
comprobar fitqa-demo-02 / || fallos=$((fallos + 1))
comprobar fitqa-demo-03-api /health || fallos=$((fallos + 1))
comprobar fitqa-demo-03-web /login || fallos=$((fallos + 1))
exit "$fallos"
