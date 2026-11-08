#!/usr/bin/env bash
# Despliega en una nube por SSH sobre Tailscale: git pull + docker compose pull + up -d --no-deps + espera de healthcheck,
# con rollback automático al tag anterior si el servicio no queda sano. ADR-0025.
#   deploy/deploy.sh <aws|azure|gcp>                      redespliega todo lo de esa nube con las etiquetas actuales
#   deploy/deploy.sh <aws|azure|gcp> <servicio>           redespliega un servicio
#   deploy/deploy.sh <aws|azure|gcp> <servicio> <tag>     fija TAG_<SERVICIO>=<tag> y lo redespliega (rollback si falla)
# Variables: DEPLOY_SSH_AWS/AZURE/GCP (defecto ubuntu@bandada-aws, azureuser@bandada-azure, ubuntu@bandada-gcp)
#            REMOTE_DIR (defecto /opt/bandada/bandadau-infra) · DEPLOY_GIT_PULL=0 omite el git pull
#            PUSH_ENV=1 copia antes deploy/.env.<nube> (y, en aws, deploy/traefik/ops.htpasswd) a la VM
# Servicios por nube: aws = todo salvo events y wallet · azure = events-service · gcp = wallet-service (+worker, +relay)
set -euo pipefail
cd "$(dirname "$0")/.."
CLOUD="${1:?uso: deploy.sh <aws|azure|gcp> [servicio] [tag]}"; SVC="${2:-}"; TAG="${3:-}"
case "$CLOUD" in
  aws)   TARGET="${DEPLOY_SSH_AWS:-ubuntu@bandada-aws}" ;;
  azure) TARGET="${DEPLOY_SSH_AZURE:-azureuser@bandada-azure}" ;;
  gcp)   TARGET="${DEPLOY_SSH_GCP:-ubuntu@bandada-gcp}" ;;
  *) echo "nube inválida: $CLOUD (aws|azure|gcp)" >&2; exit 1 ;;
esac
REMOTE_DIR="${REMOTE_DIR:-/opt/bandada/bandadau-infra}"

if [[ "${PUSH_ENV:-0}" == "1" ]]; then
  [[ -f "deploy/.env.$CLOUD" ]] || { echo "falta deploy/.env.$CLOUD (ejecuta deploy/render-env.sh $CLOUD)" >&2; exit 1; }
  scp -q "deploy/.env.$CLOUD" "$TARGET:$REMOTE_DIR/deploy/.env.$CLOUD"
  ssh "$TARGET" "chmod 600 '$REMOTE_DIR/deploy/.env.$CLOUD'"
  if [[ "$CLOUD" == aws && -f deploy/traefik/ops.htpasswd ]]; then scp -q deploy/traefik/ops.htpasswd "$TARGET:$REMOTE_DIR/deploy/traefik/ops.htpasswd"; fi
  echo "enviado deploy/.env.$CLOUD a $TARGET"
fi

# El resto corre en la VM (bash de Linux). Argumentos: nube servicio tag directorio git-pull (con %q para que los vacíos no se pierdan por SSH)
ssh "$TARGET" "bash -s -- $(printf '%q ' "$CLOUD" "$SVC" "$TAG" "$REMOTE_DIR" "${DEPLOY_GIT_PULL:-1}")" <<'REMOTE'
set -euo pipefail
CLOUD="$1"; SVC="$2"; TAG="$3"; DIR="$4"; PULL="$5"
cd "$DIR"
[[ "$PULL" == "1" ]] && git pull --ff-only --quiet
ENVF="deploy/.env.$CLOUD"
[[ -f "$ENVF" ]] || { echo "falta $DIR/$ENVF (usa PUSH_ENV=1 desde tu máquina)"; exit 1; }
dc() { docker compose --env-file "$ENVF" -f docker-compose.yaml -f "deploy/docker-compose.$CLOUD.yaml" --profile infra --profile services "$@"; }
case "$CLOUD" in azure) ALL="events-service" ;; gcp) ALL="wallet-service wallet-worker wallet-relay" ;; aws) ALL="" ;; esac

# wallet-* y notification-* comparten imagen (un solo TAG_...)
group()  { case "$1" in wallet-*) echo "wallet-service wallet-worker wallet-relay" ;; notification-*) echo "notification-service notification-worker notification-relay" ;; *) echo "$1" ;; esac; }
tagvar() { local n="$1"; case "$1" in wallet-*) n=wallet-service ;; notification-*) n=notification-service ;; esac; echo "TAG_$(echo "$n" | tr 'a-z-' 'A-Z_')"; }
getenv() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
setenv() { if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
delenv() { sed -i "/^$1=/d" "$ENVF"; }

wait_healthy() { # servicio...  (espera hasta ~3 min a que cada contenedor esté healthy)
  local s cid st i
  for s in "$@"; do
    cid="$(dc ps -q "$s" | head -1)"; [[ -n "$cid" ]] || { echo "$s: no hay contenedor"; return 1; }
    for i in $(seq 1 60); do
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
      [[ "$st" == "healthy" || "$st" == "running" ]] && { echo "$s: $st"; continue 2; }
      sleep 3
    done
    echo "$s: no quedó sano (último estado: $st)"; return 1
  done
}

if [[ "$CLOUD" == aws ]]; then   # preparación idempotente del EC2 (primera vez y siguientes)
  [[ -s secrets/qr-es256.pem ]] || scripts/gen-keys.sh
  [[ -f deploy/traefik/ops.htpasswd ]] || { echo "falta deploy/traefik/ops.htpasswd (ver deploy/README.md)"; exit 1; }
  # definitions.json de producción (contraseñas reales) sin ensuciar el archivo versionado
  cp rabbitmq/definitions.json /tmp/definitions.dev.json
  rabbitmq/render-definitions.sh "$DIR/$ENVF" >/dev/null
  mv rabbitmq/definitions.json deploy/rabbitmq/definitions.prod.json
  mv /tmp/definitions.dev.json rabbitmq/definitions.json
fi

if [[ -n "$SVC" ]]; then NAMES="$(group "$SVC")"; else NAMES="$ALL"; fi
PREV=""; HAD_PREV=0
if [[ -n "$SVC" && -n "$TAG" ]]; then
  VAR="$(tagvar "$SVC")"; PREV="$(getenv "$VAR")"; [[ -n "$PREV" ]] && HAD_PREV=1
  setenv "$VAR" "$TAG"
fi

# shellcheck disable=SC2086
dc pull $NAMES
if [[ -n "$NAMES" ]]; then
  # shellcheck disable=SC2086
  dc up -d --no-deps $NAMES
else
  dc up -d
fi

if [[ -n "$NAMES" ]]; then TO_CHECK="$NAMES"; else TO_CHECK="$(dc ps --format '{{.Service}}')"; fi
# shellcheck disable=SC2086
if wait_healthy $TO_CHECK; then echo "OK: despliegue de ${SVC:-todo $CLOUD} terminado"; exit 0; fi

echo "FALLÓ el despliegue de ${SVC:-todo $CLOUD}"
if [[ -n "$SVC" && -n "$TAG" ]]; then
  echo "ROLLBACK a ${PREV:-la etiqueta por defecto (IMAGE_TAG)}"
  if [[ "$HAD_PREV" == 1 ]]; then setenv "$VAR" "$PREV"; else delenv "$VAR"; fi
  # shellcheck disable=SC2086
  dc up -d --no-deps $NAMES || true
fi
exit 1
REMOTE
