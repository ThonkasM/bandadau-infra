#!/usr/bin/env bash
# Construye las imágenes de los servicios y las publica en GHCR (un solo registro para AWS, Azure y GCP). ADR-0025.
#   deploy/build-push.sh [servicio...]        sin argumentos: los 9 servicios
# Variables:  GHCR_OWNER (obligatoria, minúsculas) · IMAGE_TAG (defecto: <fecha>-<sha corto de bandadau-backend>)
#             PLATFORM (por defecto cada servicio se compila para donde corre: events y wallet → linux/amd64 (VMs x86 de Azure y GCP);
#             el resto → linux/arm64 (EC2 t4g). En un Mac con Apple Silicon arm64 es nativo y amd64 se emula con QEMU y tarda.
#             Fija PLATFORM=linux/amd64,linux/arm64 para una imagen multi-arquitectura)
# Requisitos: `docker login ghcr.io -u <usuario>` con un token con permiso write:packages; `docker buildx`;
#             bandadau-shared compilado (make setup) para los servicios Node. Los Dockerfile viven en bandadau-backend (no se tocan).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GHCR_OWNER:?define GHCR_OWNER (usuario u organización de GitHub, en minúsculas)}"
plat() { [[ -n "${PLATFORM:-}" ]] && { echo "$PLATFORM"; return; }; case "$1" in events-service|wallet-service) echo linux/amd64 ;; *) echo linux/arm64 ;; esac; }
BACKEND=../bandadau-backend; SHARED=../bandadau-shared
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d)-$(git -C "$BACKEND" rev-parse --short HEAD 2>/dev/null || echo local)}"
ALL=(identity-service social-service media-service events-service wallet-service ticketing-service notification-service insights-service admin-gateway)
SERVICES=("$@"); [[ ${#SERVICES[@]} -gt 0 ]] || SERVICES=("${ALL[@]}")

build() { # servicio
  local svc="$1" ref="ghcr.io/$GHCR_OWNER/bandada-$1:$IMAGE_TAG" plt; plt="$(plat "$1")"
  case "$svc" in
    identity-service|events-service|wallet-service|notification-service)   # Java y PHP: contexto = carpeta del servicio
      docker buildx build --platform "$plt" --push -t "$ref" "$BACKEND/services/$svc" ;;
    social-service|media-service|ticketing-service|insights-service|admin-gateway)   # Node: contexto = backend + paquetes @bandada/*
      docker buildx build --platform "$plt" --push -t "$ref" \
        -f "$BACKEND/services/$svc/Dockerfile" --build-context "shared=$SHARED" "$BACKEND" ;;
    *) echo "servicio desconocido: $svc" >&2; exit 1 ;;
  esac
  echo "publicada $ref"
}

echo "tag=$IMAGE_TAG  servicios=${SERVICES[*]}  (plataforma por servicio; PLATFORM la fuerza)"
for s in "${SERVICES[@]}"; do build "$s"; done
echo "Listo. Pon IMAGE_TAG=$IMAGE_TAG en los .env de las VMs o despliega con: deploy/deploy.sh <nube> <servicio> $IMAGE_TAG"
