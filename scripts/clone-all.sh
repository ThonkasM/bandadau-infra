#!/usr/bin/env bash
# Clona los 8 repositorios de Bandada U como carpetas hermanas en el directorio actual.
# Uso: mkdir parcial-II && cd parcial-II && bash clone-all.sh <owner>
set -euo pipefail
OWNER="${1:?Uso: $0 <owner>}"
for repo in bandadau-docs bandadau-shared bandadau-backend bandadau-frontend bandadau-admin bandadau-landing bandadau-infra bandadau-ml; do
  [[ -d "$repo" ]] && { echo "• $repo ya existe"; continue; }
  git clone "https://github.com/$OWNER/$repo.git"
done
echo "Copia AGENTS.md, CLAUDE.md, README.md y bandadau.code-workspace del workspace desde bandadau-docs/workspace/ si los necesitas."
