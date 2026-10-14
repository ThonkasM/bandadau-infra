#!/usr/bin/env bash
# Verifica el perfil `infra` ya levantado: salud, topología de RabbitMQ, bases, tablas, buckets, UIs y Traefik.
# Uso: scripts/check-infra.sh   (variables: COMPOSE_PROJECT_NAME / PROJECT para otro nombre de proyecto)
set -uo pipefail
cd "$(dirname "$0")/.."

env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1; }
v() { local x; x="$(env_get "$1")"; echo "${x:-$2}"; }
PROJECT="${PROJECT:-$(v COMPOSE_PROJECT_NAME bandada)}"
dc() { docker compose -p "$PROJECT" "$@"; }
BASE_DOMAIN="$(v BASE_DOMAIN bandada.localhost)"
RABBIT="http://localhost:$(v RABBITMQ_UI_PORT 15672)/api"
RABBIT_AUTH="admin:$(v RABBITMQ_ADMIN_PASSWORD admin)"
HTTP_PORT="$(v HTTP_PORT 80)"
fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
check() { local msg="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$msg"; else bad "$msg"; fi; }
http_code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$@"; }

echo "Contenedores (proyecto $PROJECT)"
for s in traefik postgres mongo dynamodb-local rabbitmq minio mailpit n8n; do
  st="$(dc ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk -v s="$s" '$1==s{print $2}')"
  [[ "$st" == "healthy" ]] && ok "$s healthy" || bad "$s ($st)"
done
for s in mongo-keyfile mongo-init dynamodb-init minio-init; do
  code="$(dc ps -a --format '{{.Service}} {{.ExitCode}} {{.State}}' 2>/dev/null | awk -v s="$s" '$1==s{print $2" "$3}')"
  [[ "$code" == "0 exited" ]] && ok "$s terminó con código 0" || bad "$s ($code)"
done

echo "PostgreSQL"
for pair in identity:identity_db:IDENTITY_DB_PASSWORD:identity_dev events:events_db:EVENTS_DB_PASSWORD:events_dev wallet:wallet_db:WALLET_DB_PASSWORD:wallet_dev; do
  IFS=: read -r u db key def <<<"$pair"
  out="$(dc exec -T -e PGPASSWORD="$(v "$key" "$def")" postgres psql -h 127.0.0.1 -U "$u" -d "$db" -tAc 'select current_user' 2>&1)"
  [[ "$out" == "$u" ]] && ok "$db accesible como $u" || bad "$db / $u: $out"
done
out="$(dc exec -T -e PGPASSWORD="$(v IDENTITY_DB_PASSWORD identity_dev)" postgres psql -h 127.0.0.1 -U identity -d wallet_db -tAc 'select 1' 2>&1)"
[[ "$out" == *"permission denied"* ]] && ok "identity NO puede entrar a wallet_db" || bad "aislamiento entre bases: $out"

echo "MongoDB"
out="$(dc exec -T mongo mongosh --quiet -u "$(v MONGO_ROOT_USER root)" -p "$(v MONGO_ROOT_PASSWORD mongo_dev)" --authenticationDatabase admin --eval 'rs.status().members[0].stateStr' 2>&1)"
[[ "$out" == "PRIMARY" ]] && ok "rs0 PRIMARY" || bad "rs0: $out"
for pair in social:SOCIAL_MONGO_PASSWORD:social_dev media:MEDIA_MONGO_PASSWORD:media_dev; do
  IFS=: read -r u key def <<<"$pair"
  out="$(dc exec -T mongo mongosh --quiet "mongodb://$u:$(v "$key" "$def")@localhost:27017/$u?authSource=$u&directConnection=true" --eval 'db.runCommand({ping:1}).ok; db.check.insertOne({t:new Date()}).acknowledged' 2>&1 | tail -1)"
  [[ "$out" == "true" ]] && ok "usuario $u escribe en su base" || bad "usuario $u: $out"
done

echo "DynamoDB Local"
tables="$(dc run --rm --no-deps -T -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local -e AWS_DEFAULT_REGION=us-east-1 --entrypoint aws dynamodb-init dynamodb list-tables --endpoint-url http://dynamodb-local:8000 --query 'TableNames' --output text 2>/dev/null)"
for t in bandada-ticketing bandada-notifications bandada-idempotency bandada-insights; do
  [[ "$tables" == *"$t"* ]] && ok "tabla $t" || bad "tabla $t"
done

echo "MinIO"
buckets="$(dc run --rm --no-deps -T --entrypoint bash minio-init -c "mc alias set l http://minio:9000 '$(v MINIO_ROOT_USER minio)' '$(v MINIO_ROOT_PASSWORD minio_dev_pw)' >/dev/null && mc ls l" 2>/dev/null)"
for b in bandada-media bandada-reports bandada-models bandada-public; do
  [[ "$buckets" == *"$b/"* ]] && ok "bucket $b" || bad "bucket $b"
done

echo "RabbitMQ (definitions.json cargadas)"
for x in bandada.events bandada.commands bandada.dlx; do
  [[ "$(http_code -u "$RABBIT_AUTH" "$RABBIT/exchanges/%2F/$x")" == 200 ]] && ok "exchange $x" || bad "exchange $x"
done
for q in events-service.saga-replies wallet-service.commands ticketing-service.commands social-service.events media-service.events notification-service.events insights-service.analytics n8n.automation; do
  all=1
  for suffix in "" .retry.5s .retry.30s .retry.5m .dlq; do
    [[ "$(http_code -u "$RABBIT_AUTH" "$RABBIT/queues/%2F/$q$suffix")" == 200 ]] || all=0
  done
  [[ $all == 1 ]] && ok "cola $q (+retry 5s/30s/5m, +dlq)" || bad "cola $q"
done
n="$(curl -s -m 10 -u "$RABBIT_AUTH" "$RABBIT/bindings/%2F" | grep -o '"routing_key"' | wc -l | tr -d ' ')"
[[ "$n" -ge 33 ]] && ok "bindings cargados ($n entradas)" || bad "bindings ($n)"

echo "Mailpit / n8n / MinIO / Traefik"
[[ "$(http_code "http://localhost:$(v MAILPIT_UI_PORT 8025)/api/v1/info")" == 200 ]] && ok "Mailpit API responde" || bad "Mailpit API"
[[ "$(http_code "http://localhost:$(v N8N_PORT 5678)/healthz")" == 200 ]] && ok "n8n /healthz" || bad "n8n /healthz"
[[ "$(http_code "http://localhost:$(v MINIO_API_PORT 9000)/minio/health/live")" == 200 ]] && ok "MinIO live" || bad "MinIO live"
[[ "$(http_code "http://localhost:$(v TRAEFIK_DASHBOARD_PORT 8080)/api/overview")" == 200 ]] && ok "Traefik dashboard/API" || bad "Traefik dashboard"
tr() { http_code -H "Host: $1" "http://localhost:$HTTP_PORT$2"; }
[[ "$(tr "n8n.$BASE_DOMAIN" /healthz)" == 200 ]] && ok "n8n.$BASE_DOMAIN → n8n" || bad "n8n.$BASE_DOMAIN"
[[ "$(tr "mail.$BASE_DOMAIN" /livez)" == 200 ]] && ok "mail.$BASE_DOMAIN → mailpit" || bad "mail.$BASE_DOMAIN"
[[ "$(http_code -u "$RABBIT_AUTH" -H "Host: rabbit.$BASE_DOMAIN" "http://localhost:$HTTP_PORT/api/overview")" == 200 ]] && ok "rabbit.$BASE_DOMAIN → rabbitmq" || bad "rabbit.$BASE_DOMAIN"
[[ "$(tr "s3.$BASE_DOMAIN" /minio/health/live)" == 200 ]] && ok "s3.$BASE_DOMAIN → minio" || bad "s3.$BASE_DOMAIN"
[[ "$(tr "api.$BASE_DOMAIN" /internal/v1/users)" == 403 ]] && ok "/internal/** → 403" || bad "/internal/** debería ser 403"
[[ "$(tr "api.$BASE_DOMAIN" /api/v1/auth/service-token)" == 403 ]] && ok "/api/v1/auth/service-token → 403" || bad "service-token debería ser 403"
# Traefik responde "404 page not found" cuando NINGÚN router coincide; 502/503 = enruta pero el servicio no está.
for p in /api/v1/auth/login /api/v1/users/me /api/v1/universities /.well-known/jwks.json /api/v1/profiles/me /api/v1/posts /api/v1/feed /api/v1/groups /api/v1/follows/x /api/v1/reports /api/v1/media/uploads /api/v1/events /api/v1/registrations/me /api/v1/wallet/me /api/v1/tickets/me /api/v1/notifications /api/v1/devices/x /api/v1/insights/reports /mcp /graphql; do
  body="$(curl -s -m 10 -H "Host: api.$BASE_DOMAIN" "http://localhost:$HTTP_PORT$p")"
  c="$(tr "api.$BASE_DOMAIN" "$p")"
  if [[ "$body" == "404 page not found" ]]; then bad "api.$BASE_DOMAIN$p: ningún router coincide"; else ok "api.$BASE_DOMAIN$p enruta (HTTP $c)"; fi
done

echo
[[ $fail == 0 ]] && echo "TODO OK" || { echo "HAY FALLOS"; exit 1; }
