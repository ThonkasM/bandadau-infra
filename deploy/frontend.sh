#!/usr/bin/env bash
# Compila un frontend con las URLs de PRODUCCIÓN y lo publica en el EC2 (nginx `static`). ADR-0025/0026.
#   deploy/frontend.sh landing        página de aterrizaje (bandadau.lat)
#   deploy/frontend.sh app            app web / PWA (app.bandadau.lat)
#   deploy/frontend.sh admin          shell del panel (admin.bandadau.lat) + regenera mfe-manifest.json
#   deploy/frontend.sh moderation     microfrontend de moderación (publica solo ese) + actualiza el manifiesto
#   deploy/frontend.sh insights       microfrontend de insights (publica solo ese) + actualiza el manifiesto
#   deploy/frontend.sh all            todo lo anterior
# Variables: BASE_DOMAIN (defecto bandadau.lat) · DEPLOY_SSH_AWS (defecto ubuntu@bandada-aws) · SITES_DIR (defecto /opt/bandada/sites)
#            DRY_RUN=1 muestra lo que haría sin compilar ni publicar
# Requisitos: corepack/pnpm y Tailscale activo en tu máquina (se entra al EC2 por `ssh ubuntu@bandada-aws`).
# Las variables NEXT_PUBLIC_* / EXPO_PUBLIC_* se fijan al COMPILAR: por eso este script las pone con https://*.<dominio>.
set -euo pipefail
cd "$(dirname "$0")/.."
D="${BASE_DOMAIN:-bandadau.lat}"
TARGET="${DEPLOY_SSH_AWS:-ubuntu@bandada-aws}"
SITES="${SITES_DIR:-/opt/bandada/sites}"
ADMIN=../bandadau-admin
ROOT="$(pwd)"
WHAT="${1:?uso: frontend.sh <landing|app|admin|moderation|insights|all>}"

run() { if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "[dry-run] $*"; else "$@"; fi; }
pnpm() { corepack pnpm "$@"; }
mfe_version() { node -p "require('$ADMIN/mfe-$1/package.json').version"; }

build_landing() {
  echo "== landing"
  ( cd ../bandadau-landing
    run env NEXT_PUBLIC_API_URL="https://api.$D" NEXT_PUBLIC_APP_URL="https://app.$D" \
      NEXT_PUBLIC_ADMIN_URL="https://admin.$D" NEXT_PUBLIC_SITE_URL="https://$D" corepack pnpm build )
  run "$ROOT/deploy/publish-static.sh" landing ../bandadau-landing/out
}

build_app() {
  echo "== app"
  local llm nsfw
  llm="$(sed -n 's/^EXPO_PUBLIC_LOCAL_LLM_MODEL_URL=//p' ../bandadau-frontend/.env.example | sed "s#http://s3.bandada.localhost#https://s3.$D#")"
  nsfw="$(sed -n 's/^EXPO_PUBLIC_NSFW_MODEL_URL=//p' ../bandadau-frontend/.env.example | sed "s#http://s3.bandada.localhost#https://s3.$D#")"
  ( cd ../bandadau-frontend
    run env EXPO_PUBLIC_API_URL="https://api.$D" EXPO_PUBLIC_APP_URL="https://app.$D" EXPO_PUBLIC_ADMIN_URL="https://admin.$D" \
      EXPO_PUBLIC_BASE_DOMAIN="$D" EXPO_PUBLIC_DEFAULT_LOCALE=es EXPO_PUBLIC_USE_MOCKS=false \
      EXPO_PUBLIC_LOCAL_LLM_MODEL_URL="$llm" EXPO_PUBLIC_NSFW_MODEL_URL="$nsfw" corepack pnpm build:web )
  run "$ROOT/deploy/publish-static.sh" app ../bandadau-frontend/dist
}

build_mfe() { # moderation|insights : compila (y deja la entrada del manifiesto en dist/)
  ( cd "$ADMIN/mfe-$1" && run env MFE_PUBLIC_BASE="https://mfe.$D/$1" corepack pnpm build )
}

write_manifest() { # $1 = archivo de salida: une la entrada de cada microfrontend
  local out="$1" n
  local f
  for n in moderation insights; do
    f="$ADMIN/mfe-$n/dist/mfe-$n/mfe-manifest-entry.json"
    # reconstruye si falta o si es de un build con otra URL base (p. ej. el valor por defecto de otro dominio)
    [[ -f "$f" ]] && grep -q "\"https://mfe.$D/$n/" "$f" || build_mfe "$n"
  done
  [[ "${DRY_RUN:-0}" == 1 ]] && { echo "[dry-run] escribir $out con las entradas de moderation e insights"; return; }
  node -e '
    const fs = require("fs"), m = {};
    for (const n of ["moderation", "insights"])
      Object.assign(m, JSON.parse(fs.readFileSync(`'"$ADMIN"'/mfe-${n}/dist/mfe-${n}/mfe-manifest-entry.json`, "utf8")));
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\n");
  ' "$out"
}

build_admin() {
  echo "== admin (shell)"
  ( cd "$ADMIN/shell"
    run env NEXT_PUBLIC_API_URL="https://api.$D" NEXT_PUBLIC_GRAPHQL_URL="https://api.$D/graphql" \
      NEXT_PUBLIC_GRAPHQL_WS_URL="wss://api.$D/graphql" NEXT_PUBLIC_APP_URL="https://app.$D" \
      NEXT_PUBLIC_MFE_MANIFEST_URL=/mfe-manifest.json NEXT_PUBLIC_DEFAULT_LOCALE=es NEXT_PUBLIC_FEATURE_INSIGHTS=true \
      corepack pnpm build )
  write_manifest "$ADMIN/shell/out/mfe-manifest.json"
  run "$ROOT/deploy/publish-static.sh" admin "$ADMIN/shell/out"
}

publish_mfe() { # moderation|insights
  echo "== microfrontend $1"
  build_mfe "$1"
  local v; v="$(mfe_version "$1")"
  run "$ROOT/deploy/publish-static.sh" mfe "$ADMIN/mfe-$1/dist/mfe-$1" "$1/$v"
  # Solo el manifiesto del shell (sin recompilar el shell): copia el archivo a la carpeta admin del EC2
  local tmp; tmp="$(mktemp -d)"
  write_manifest "$tmp/mfe-manifest.json"
  if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "[dry-run] scp mfe-manifest.json $TARGET:$SITES/admin/"; else
    ssh "$TARGET" "mkdir -p '$SITES/admin'" && scp -q "$tmp/mfe-manifest.json" "$TARGET:$SITES/admin/mfe-manifest.json"; fi
  rm -rf "$tmp"
  echo "mfe $1 $v publicado y manifiesto actualizado"
}

case "$WHAT" in
  landing) build_landing ;;
  app) build_app ;;
  admin) build_admin ;;
  moderation|insights) publish_mfe "$WHAT" ;;
  all) build_landing; build_app; publish_mfe moderation; publish_mfe insights; build_admin ;;
  *) echo "opción inválida: $WHAT" >&2; exit 1 ;;
esac
echo "OK: https://${D} · https://app.${D} · https://admin.${D}"
