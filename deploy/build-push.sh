#!/usr/bin/env bash
# Construye las imágenes de los servicios y las publica en GHCR (un solo registro para AWS, Azure y GCP). ADR-0025.
#   deploy/build-push.sh [servicio...]        sin argumentos: los 9 servicios
# Variables:  GHCR_OWNER (obligatoria, minúsculas) · IMAGE_TAG (defecto: <fecha>-<sha corto de bandadau-backend>)
#             PLATFORM (defecto linux/amd64,linux/arm64: el EC2 t4g es ARM; Azure y GCP son x86-64. En un Mac con Apple
#             Silicon la parte amd64 se emula con QEMU y tarda; PLATFORM=linux/arm64 si solo vas a desplegar en AWS)
# Requisitos: `docker login ghcr.io -u <usuario>` con un token con permiso write:packages; `docker buildx`;
#             bandadau-shared compilado (make setup) para los servicios Node. Los Dockerfile viven en bandadau-backend (no se tocan).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GHCR_OWNER:?define GHCR_OWNER (usuario u organización de GitHub, en minúsculas)}"
PLATFORM="${PLATFORM:-linux/amd64,linux/arm64}"
BACKEND=../bandadau-backend; SHARED=../bandadau-shared
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d)-$(git -C "$BACKEND" rev-parse --short HEAD 2>/dev/null || echo local)}"
ALL=(identity-service social-service media-service events-service wallet-service ticketing-service notification-service insights-service admin-gateway)
SERVICES=("$@"); [[ ${#SERVICES[@]} -gt 0 ]] || SERVICES=("${ALL[@]}")

build() { # servicio
  local svc="$1" ref="ghcr.io/$GHCR_OWNER/bandada-$1:$IMAGE_TAG"
  case "$svc" in
    identity-service|events-service|wallet-service|notification-service)   # Java y PHP: contexto = carpeta del servicio
      docker buildx build --platform "$PLATFORM" --push -t "$ref" "$BACKEND/services/$svc" ;;
    social-service|media-service|ticketing-service|insights-service|admin-gateway)   # Node: contexto = backend + paquetes @bandada/*
      docker buildx build --platform "$PLATFORM" --push -t "$ref" \
        -f "$BACKEND/services/$svc/Dockerfile" --build-context "shared=$SHARED" "$BACKEND" ;;
    *) echo "servicio desconocido: $svc" >&2; exit 1 ;;
  esac
  echo "publicada $ref"
}

echo "plataforma=$PLATFORM  tag=$IMAGE_TAG  servicios=${SERVICES[*]}"
for s in "${SERVICES[@]}"; do build "$s"; done
echo "Listo. Pon IMAGE_TAG=$IMAGE_TAG en los .env de las VMs o despliega con: deploy/deploy.sh <nube> <servicio> $IMAGE_TAG"
