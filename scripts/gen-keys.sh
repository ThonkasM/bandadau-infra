#!/usr/bin/env bash
# Genera las llaves de DESARROLLO en secrets/ (git-ignored) si no existen:
#   jwt-private.pem   RSA 2048 PKCS#8 (RS256, identity-service)
#   qr-es256.pem      EC P-256 PKCS#8 (ES256, JWS del QR de ticketing-service)
# Idempotente. Usa `FORCE=1 scripts/gen-keys.sh` para regenerarlas (invalida tokens y tickets existentes).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p secrets
command -v openssl >/dev/null || { echo "openssl no está instalado" >&2; exit 1; }

gen() { # archivo comando...
  local file="secrets/$1"; shift
  if [[ -s "$file" && "${FORCE:-0}" != "1" ]]; then echo "keys: $file ya existe"; return; fi
  "$@" -out "$file" 2>/dev/null
  chmod 644 "$file"   # el contenedor corre como usuario no root; son llaves de desarrollo
  echo "keys: $file generada"
}

gen jwt-private.pem openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048
gen qr-es256.pem    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256
touch secrets/.gitkeep
