#!/usr/bin/env bash
# Copia un frontend ya compilado al volumen del contenedor nginx `static` del EC2 (por Tailscale SSH). ADR-0025.
#   deploy/publish-static.sh <landing|app|admin|mfe> <carpeta-compilada> [subcarpeta]
# Ejemplos:
#   deploy/publish-static.sh landing ../bandadau-landing/out
#   deploy/publish-static.sh app     ../bandadau-frontend/dist
#   deploy/publish-static.sh admin   ../bandadau-admin/shell/out
#   deploy/publish-static.sh mfe     <dist-de-mfe-moderation> moderation     # despliega SOLO ese microfrontend
# Variables: DEPLOY_SSH_AWS (defecto ubuntu@bandada-aws) · SITES_DIR (defecto /opt/bandada/sites)
# Las variables NEXT_PUBLIC_* / EXPO_PUBLIC_* son de BUILD: compila el frontend con las URLs https://api.<dominio> antes de publicar.
set -euo pipefail
SITE="${1:?uso: publish-static.sh <landing|app|admin|mfe> <carpeta> [subcarpeta]}"; SRC="${2:?falta la carpeta compilada}"; SUB="${3:-}"
case "$SITE" in landing|app|admin|mfe) ;; *) echo "sitio inválido: $SITE" >&2; exit 1 ;; esac
[[ -d "$SRC" ]] || { echo "no existe $SRC (¿compilaste el frontend?)" >&2; exit 1; }
TARGET="${DEPLOY_SSH_AWS:-ubuntu@bandada-aws}"; DEST="${SITES_DIR:-/opt/bandada/sites}/$SITE${SUB:+/$SUB}"
ssh "$TARGET" "mkdir -p '$DEST'"
rsync -az --delete "$SRC"/ "$TARGET:$DEST/"
echo "publicado $SRC → $TARGET:$DEST"
