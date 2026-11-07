#!/usr/bin/env bash
# Genera deploy/.env.<nube> desde deploy/.env.<nube>.example sustituyendo los @@secretos@@.
#   @@nombre@@       → 48 caracteres hexadecimales aleatorios
#   @@b64:nombre@@   → "base64:" + 32 bytes en base64 (llave de Laravel)
# Los valores se guardan en deploy/.secrets (chmod 600, git-ignored) y se REUSAN: así events (Azure), wallet (GCP) y AWS
# comparten las mismas contraseñas de RabbitMQ/Postgres y el mismo secreto de cliente. Guarda ese archivo en tu gestor de contraseñas.
# Uso: deploy/render-env.sh <aws|azure|gcp>     (SECRETS_FILE y OUT_FILE permiten rutas distintas, p. ej. para pruebas)
set -euo pipefail
cd "$(dirname "$0")"
CLOUD="${1:?uso: render-env.sh <aws|azure|gcp>}"
EXAMPLE=".env.$CLOUD.example"; OUT="${OUT_FILE:-.env.$CLOUD}"; SECRETS="${SECRETS_FILE:-.secrets}"
[[ -f "$EXAMPLE" ]] || { echo "no existe $EXAMPLE" >&2; exit 1; }
command -v openssl >/dev/null || { echo "falta openssl" >&2; exit 1; }
touch "$SECRETS"; chmod 600 "$SECRETS"

secret() { # nombre tipo(hex|b64) → imprime el valor, creándolo si no existe
  local key="$1" kind="$2" v
  v="$(sed -n "s/^$key=//p" "$SECRETS" | tail -1)"
  if [[ -z "$v" ]]; then
    if [[ "$kind" == b64 ]]; then v="base64:$(openssl rand -base64 32)"; else v="$(openssl rand -hex 24)"; fi
    echo "$key=$v" >> "$SECRETS"
  fi
  printf '%s' "$v"
}

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
while IFS= read -r line || [[ -n "$line" ]]; do
  while [[ "$line" =~ @@(b64:)?([a-z0-9_]+)@@ ]]; do
    kind=hex; [[ -n "${BASH_REMATCH[1]}" ]] && kind=b64
    val="$(secret "${BASH_REMATCH[2]}" "$kind")"
    line="${line//${BASH_REMATCH[0]}/$val}"
  done
  printf '%s\n' "$line" >> "$tmp"
done < "$EXAMPLE"
install -m 600 "$tmp" "$OUT"
echo "generado deploy/$(basename "$OUT") (secretos en $(basename "$SECRETS"))"
grep -nE '=(RELLENAR|100\.x\.x\.x)|example\.com|tu-usuario' "$OUT" | sed 's/^/  por rellenar: /' || true
