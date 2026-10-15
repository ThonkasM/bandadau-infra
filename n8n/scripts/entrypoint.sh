#!/bin/sh
# Entrypoint del contenedor n8n de Bandada U: importa credenciales y workflows (idempotente) y arranca n8n.
# Verificado contra n8n 2.43.5: `--activeState=fromJson` solo existe en modo cola; en modo normal se usa
# `import:workflow` + `publish:workflow --id` (se publican los JSON con "active": true).
set -eu
# propietario gestionado por variables solo si hay hash bcrypt
if [ -n "${N8N_OWNER_PASSWORD_HASH:-}" ]; then
  export N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true N8N_INSTANCE_OWNER_PASSWORD_HASH="$N8N_OWNER_PASSWORD_HASH"
fi
IMPORT_DIR=${N8N_IMPORT_DIR:-/import}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -d "$IMPORT_DIR/credentials" ]; then
  node "$IMPORT_DIR/scripts/render-credentials.mjs" "$IMPORT_DIR/credentials" "$TMP/credentials.json"
  n8n import:credentials --input="$TMP/credentials.json"
fi
if [ -d "$IMPORT_DIR/workflows" ]; then
  # --activeState=fromJson solo vale en modo cola; en modo normal se importa y luego se publica por id
  n8n import:workflow --separate --input="$IMPORT_DIR/workflows"
  for id in $(node -e 'const fs=require("fs"),d=process.argv[1];for(const f of fs.readdirSync(d).sort()){if(!f.endsWith(".json"))continue;const w=JSON.parse(fs.readFileSync(d+"/"+f));if(w.active)console.log(w.id)}' "$IMPORT_DIR/workflows"); do
    n8n publish:workflow --id="$id" || echo "AVISO: no se pudo publicar $id"
  done
fi
rm -rf "$TMP"; trap - EXIT
exec n8n start
