#!/usr/bin/env bash
# Genera rabbitmq/definitions.json desde definitions.template.json con las contraseñas de .env.
# (En local las definiciones usan contraseña en claro: RabbitMQ las hashea al importar. Solo desarrollo.)
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${1:-../.env}"
# .env no se "sourcea" (hay valores con espacios): se leen solo las claves necesarias.
envval() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }
for k in RABBITMQ_DEFAULT_USER RABBITMQ_DEFAULT_PASS RABBITMQ_ADMIN_PASSWORD RABBITMQ_N8N_PASSWORD RABBITMQ_MONITOR_PASSWORD; do
  v="$(envval "$k")"; [[ -n "$v" ]] && export "$k=$v"
done
: "${RABBITMQ_DEFAULT_USER:=bandada}" "${RABBITMQ_DEFAULT_PASS:=bandada}" "${RABBITMQ_ADMIN_PASSWORD:=admin}"
: "${RABBITMQ_N8N_PASSWORD:=n8n_dev}" "${RABBITMQ_MONITOR_PASSWORD:=monitor_dev}"
# I-4 (RNF-07): un usuario por servicio (nombre = servicio) con permisos solo sobre sus colas `<svc>.*`
# y los exchanges bandada.{events,commands,dlx}. Variable: RABBITMQ_<SERVICIO_EN_MAYUSCULAS>_PASSWORD.
SERVICES=(identity-service social-service media-service events-service wallet-service ticketing-service notification-service insights-service admin-gateway)
svc_var() { printf 'RABBITMQ_%s_PASSWORD' "$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"; }
for svc in "${SERVICES[@]}"; do
  k="$(svc_var "$svc")"; v="$(envval "$k")"; [[ -n "$v" ]] && export "$k=$v"
done
esc() { printf '%s' "$1" | sed -e 's/[\/&|"\\]/\\&/g'; }
SVC_SED=()
for svc in "${SERVICES[@]}"; do
  k="$(svc_var "$svc")"; pw="${!k:-${svc}_dev}"
  SVC_SED+=(-e "s|__RABBITMQ_PASSWORD_${svc}__|$(esc "$pw")|g")
done
sed -e "s|__RABBITMQ_DEFAULT_USER__|$(esc "$RABBITMQ_DEFAULT_USER")|g" \
    -e "s|__RABBITMQ_DEFAULT_PASS__|$(esc "$RABBITMQ_DEFAULT_PASS")|g" \
    -e "s|__RABBITMQ_ADMIN_PASSWORD__|$(esc "$RABBITMQ_ADMIN_PASSWORD")|g" \
    -e "s|__RABBITMQ_N8N_PASSWORD__|$(esc "$RABBITMQ_N8N_PASSWORD")|g" \
    -e "s|__RABBITMQ_MONITOR_PASSWORD__|$(esc "$RABBITMQ_MONITOR_PASSWORD")|g" \
    "${SVC_SED[@]}" \
    definitions.template.json > definitions.json
# valida el JSON con lo que haya (en las VMs de despliegue no hay node)
if command -v node >/dev/null 2>&1; then node -e 'JSON.parse(require("fs").readFileSync("definitions.json","utf8"))'
elif command -v jq >/dev/null 2>&1; then jq empty definitions.json
elif command -v python3 >/dev/null 2>&1; then python3 -c 'import json;json.load(open("definitions.json"))'; fi
echo "rabbitmq/definitions.json generado"
