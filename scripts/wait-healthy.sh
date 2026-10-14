#!/usr/bin/env bash
# Espera a que todos los contenedores del proyecto estén healthy (y los jobs one-shot hayan terminado con 0).
# (`docker compose up --wait` falla con los jobs que terminan en 0; por eso este script.)
# Uso: scripts/wait-healthy.sh [timeout-segundos] ; variable PROJECT para el nombre del proyecto Compose.
set -uo pipefail
cd "$(dirname "$0")/.."
TIMEOUT="${1:-600}"
PROJECT="${PROJECT:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | tail -1)}"; PROJECT="${PROJECT:-bandada}"
deadline=$(( $(date +%s) + TIMEOUT ))
last=""
while :; do
  pending=(); failed=()
  while IFS='|' read -r svc state health code; do
    [[ -z "$svc" ]] && continue
    case "$state" in
      exited) if [[ -z "$code" ]]; then pending+=("$svc"); elif [[ "$code" != "0" ]]; then failed+=("$svc(exit $code)"); fi;;
      running) case "$health" in healthy|"") ;; unhealthy) failed+=("$svc(unhealthy)");; *) pending+=("$svc");; esac;;
      restarting|dead) failed+=("$svc($state)");;
      *) pending+=("$svc($state)");;
    esac
  done < <(docker compose -p "$PROJECT" --profile '*' ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>/dev/null)
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "FALLO: ${failed[*]}"; echo "Revisa: make logs S=<servicio>"; exit 1
  fi
  if [[ ${#pending[@]} -eq 0 ]]; then echo "Todo healthy."; exit 0; fi
  msg="esperando: ${pending[*]}"
  [[ "$msg" != "$last" ]] && { echo "$msg"; last="$msg"; }
  if [[ $(date +%s) -ge $deadline ]]; then echo "TIMEOUT tras ${TIMEOUT}s: ${pending[*]}"; exit 1; fi
  sleep 3
done
