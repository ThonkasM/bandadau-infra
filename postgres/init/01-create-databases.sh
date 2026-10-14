#!/usr/bin/env bash
# 3 bases (identity_db, events_db, wallet_db), 3 usuarios con mínimo privilegio. Idempotente.
# Corre solo con el volumen vacío (docker-entrypoint-initdb.d); en RDS lo ejecuta el job `db-bootstrap`.
set -euo pipefail

PSQL_USER="${POSTGRES_USER:-postgres}"
PSQL_HOST_ARGS=()
[[ -n "${PGHOST:-}" ]] && PSQL_HOST_ARGS=(-h "$PGHOST")

create_pair() {
  local role="$1" db="$2" password="$3"
  [[ -n "$password" ]] || { echo "falta la contraseña de $role" >&2; exit 1; }

  psql -v ON_ERROR_STOP=1 -U "$PSQL_USER" "${PSQL_HOST_ARGS[@]}" -d postgres \
       -v role="$role" -v db="$db" -v pw="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'role') \gexec
SQL

  psql -v ON_ERROR_STOP=1 -U "$PSQL_USER" "${PSQL_HOST_ARGS[@]}" -d "$db" -v role="$role" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'role') \gexec
SQL
  echo "postgres: $db / $role listo"
}

create_pair identity identity_db "${IDENTITY_DB_PASSWORD:-}"
create_pair events   events_db   "${EVENTS_DB_PASSWORD:-}"
create_pair wallet   wallet_db   "${WALLET_DB_PASSWORD:-}"
