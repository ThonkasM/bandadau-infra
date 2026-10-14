#!/usr/bin/env bash
# Job one-shot: inicia el replica set rs0 (1 nodo), espera PRIMARY y crea los usuarios social y media. Idempotente.
set -euo pipefail

HOST="${MONGO_HOST:-mongo}:27017"
ROOT=(mongosh "mongodb://${HOST}/admin?directConnection=true" --quiet
      -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin)

for i in $(seq 1 60); do
  "${ROOT[@]}" --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && break
  echo "esperando a mongod ($i)…"; sleep 2
done

"${ROOT[@]}" --file /init/init-replica.js

echo "esperando PRIMARY…"
for i in $(seq 1 60); do
  [[ "$("${ROOT[@]}" --eval 'db.hello().isWritablePrimary' 2>/dev/null)" == "true" ]] && break
  sleep 2
done
[[ "$("${ROOT[@]}" --eval 'db.hello().isWritablePrimary')" == "true" ]] || { echo "rs0 no llegó a PRIMARY" >&2; exit 1; }

"${ROOT[@]}" --file /init/create-users.js
echo "mongo: rs0 PRIMARY y usuarios listos"
