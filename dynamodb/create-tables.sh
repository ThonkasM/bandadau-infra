#!/usr/bin/env bash
# Crea las tablas de tables/*.json y activa el TTL. Idempotente (describe-table antes de create-table).
# Uso: DYNAMODB_ENDPOINT=http://dynamodb-local:8000 ./create-tables.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENDPOINT="${DYNAMODB_ENDPOINT:-http://dynamodb-local:8000}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=""
ddb() { aws dynamodb "$@" --endpoint-url "$ENDPOINT"; }

for i in $(seq 1 60); do
  ddb list-tables >/dev/null 2>&1 && break
  echo "esperando a DynamoDB Local ($i)…"; sleep 2
done
ddb list-tables >/dev/null

for f in "$DIR"/tables/*.json; do
  name="$(sed -n 's/.*"TableName": *"\([^"]*\)".*/\1/p' "$f" | head -1)"
  if ddb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "dynamodb: $name ya existe"
  else
    ddb create-table --cli-input-json "file://$f" >/dev/null
    ddb wait table-exists --table-name "$name"
    echo "dynamodb: $name creada"
  fi
done

grep -vE '^\s*(#|$)' "$DIR/ttl.txt" | while read -r table attr; do
  status="$(ddb describe-time-to-live --table-name "$table" --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null || echo DISABLED)"
  if [[ "$status" == "ENABLED" || "$status" == "ENABLING" ]]; then
    echo "dynamodb: TTL de $table ya activo"
  else
    ddb update-time-to-live --table-name "$table" \
        --time-to-live-specification "Enabled=true,AttributeName=$attr" >/dev/null
    echo "dynamodb: TTL($attr) activado en $table"
  fi
done
echo "dynamodb: tablas listas"
