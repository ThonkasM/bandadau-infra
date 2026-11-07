#!/usr/bin/env bash
# Crea en AWS REAL las 4 tablas de DynamoDB (dynamodb/tables/*.json) y activa el TTL (dynamodb/ttl.txt). Idempotente.
#   AWS_REGION=us-east-1 deploy/dynamodb-create.sh        (usa tus credenciales de AWS CLI; sin --endpoint-url)
# Es el equivalente de dynamodb/create-tables.sh (que apunta a DynamoDB Local) para producción.
set -euo pipefail
cd "$(dirname "$0")/../dynamodb"
REGION="${AWS_REGION:-us-east-1}"; export AWS_PAGER=""
command -v aws >/dev/null || { echo "falta aws CLI" >&2; exit 1; }
ddb() { aws dynamodb "$@" --region "$REGION"; }

for f in tables/*.json; do
  name="$(sed -n 's/.*"TableName": *"\([^"]*\)".*/\1/p' "$f" | head -1)"
  if ddb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "dynamodb: $name ya existe"
  else
    ddb create-table --cli-input-json "file://$f" >/dev/null
    ddb wait table-exists --table-name "$name"
    echo "dynamodb: $name creada"
  fi
done

grep -vE '^\s*(#|$)' ttl.txt | while read -r table attr; do
  status="$(ddb describe-time-to-live --table-name "$table" --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null || echo DISABLED)"
  if [[ "$status" == "ENABLED" || "$status" == "ENABLING" ]]; then
    echo "dynamodb: TTL de $table ya activo"
  else
    ddb update-time-to-live --table-name "$table" --time-to-live-specification "Enabled=true,AttributeName=$attr" >/dev/null
    echo "dynamodb: TTL($attr) activado en $table"
  fi
done
echo "dynamodb: tablas listas en $REGION"
