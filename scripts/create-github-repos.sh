#!/usr/bin/env bash
# Crea los 8 repositorios de Bandada U en GitHub y sube la rama main de cada uno.
# Uso: ./create-github-repos.sh <owner> [--public]
#   <owner>  usuario u organización de GitHub (requiere `gh auth login`)
# Ejecutar desde cualquier lugar: resuelve el workspace como el padre de bandadau-infra.
set -euo pipefail

OWNER="${1:?Uso: $0 <owner> [--public]}"
VISIBILITY="--private"
[[ "${2:-}" == "--public" ]] && VISIBILITY="--public"

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"
REPOS=(bandadau-docs bandadau-shared bandadau-backend bandadau-frontend bandadau-admin bandadau-landing bandadau-infra bandadau-ml)

gh auth status >/dev/null

for repo in "${REPOS[@]}"; do
  dir="$WORKSPACE/$repo"
  [[ -d "$dir/.git" ]] || { echo "✗ $repo no es un repo git ($dir)"; exit 1; }
  if gh repo view "$OWNER/$repo" >/dev/null 2>&1; then
    echo "• $OWNER/$repo ya existe, solo se configura el remoto"
  else
    gh repo create "$OWNER/$repo" "$VISIBILITY" --description "Bandada U — $repo"
  fi
  git -C "$dir" remote get-url origin >/dev/null 2>&1 || git -C "$dir" remote add origin "https://github.com/$OWNER/$repo.git"
  git -C "$dir" push -u origin main
  echo "✓ $OWNER/$repo"
done
