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
esc() { printf '%s' "$1" | sed -e 's/[\/&|"\\]/\\&/g'; }
sed -e "s|__RABBITMQ_DEFAULT_USER__|$(esc "$RABBITMQ_DEFAULT_USER")|g" \
    -e "s|__RABBITMQ_DEFAULT_PASS__|$(esc "$RABBITMQ_DEFAULT_PASS")|g" \
    -e "s|__RABBITMQ_ADMIN_PASSWORD__|$(esc "$RABBITMQ_ADMIN_PASSWORD")|g" \
    -e "s|__RABBITMQ_N8N_PASSWORD__|$(esc "$RABBITMQ_N8N_PASSWORD")|g" \
    -e "s|__RABBITMQ_MONITOR_PASSWORD__|$(esc "$RABBITMQ_MONITOR_PASSWORD")|g" \
    definitions.template.json > definitions.json
node -e 'JSON.parse(require("fs").readFileSync("definitions.json","utf8"))'
echo "rabbitmq/definitions.json generado"
