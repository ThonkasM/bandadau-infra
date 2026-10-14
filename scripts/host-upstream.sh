#!/usr/bin/env bash
# Redirige un servicio de Compose al proceso que corre en tu IDE (host): para el resto de contenedores y
# para Traefik el nombre `<servicio>:<puerto>` pasa a resolver a un proxy TCP que apunta a host.docker.internal.
#   scripts/host-upstream.sh on  identity-service     # detiene el contenedor y levanta el proxy
#   scripts/host-upstream.sh off identity-service     # quita el proxy y vuelve a levantar el contenedor
set -euo pipefail
cd "$(dirname "$0")/.."
ACTION="${1:?uso: $0 on|off <servicio>}"; SVC="${2:?uso: $0 on|off <servicio>}"
PROJECT="${PROJECT:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | tail -1)}"; PROJECT="${PROJECT:-bandada}"
case "$SVC" in
  identity-service) PORT=7001;; social-service) PORT=7002;; media-service) PORT=7003;;
  events-service) PORT=7004;; wallet-service) PORT=7005;; ticketing-service) PORT=7006;;
  notification-service) PORT=7007;; admin-gateway) PORT=7010;;
  *) echo "servicio desconocido: $SVC" >&2; exit 1;;
esac
PROXY="${PROJECT}-hostproxy-${SVC}"
case "$ACTION" in
  on)
    docker compose -p "$PROJECT" --profile '*' stop "$SVC" >/dev/null 2>&1 || true
    docker rm -f "$PROXY" >/dev/null 2>&1 || true
    docker run -d --name "$PROXY" --network "${PROJECT}_bandada" --network-alias "$SVC" \
      --add-host host.docker.internal:host-gateway --restart unless-stopped \
      alpine/socat:1.8.1.3 "TCP-LISTEN:${PORT},fork,reuseaddr" "TCP:host.docker.internal:${PORT}" >/dev/null
    echo "$SVC:$PORT → host.docker.internal:$PORT (arranca tu proceso local en el puerto $PORT)";;
  off)
    docker rm -f "$PROXY" >/dev/null 2>&1 || true
    docker compose -p "$PROJECT" --profile '*' up -d "$SVC"
    echo "$SVC vuelve a correr en Docker";;
  *) echo "uso: $0 on|off <servicio>" >&2; exit 1;;
esac
