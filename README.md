# bandadau-infra

Infraestructura de Bandada U (repositorio propio, ADR-0017): entorno local de la **fase 1** con
**Docker Compose + Traefik** (`*.bandada.localhost`), inicialización de PostgreSQL / MongoDB (rs0) /
DynamoDB Local / RabbitMQ / MinIO, Mailpit, n8n, observabilidad opcional (Grafana LGTM), datos de demo
(`seed/`), humo de extremo a extremo (`smoke/`) y plantillas de CI (`ci/`). El despliegue en AWS es de una
fase posterior (aún no incluido).

Normativo: `bandadau-docs/docs/06-plan/fase-1-alcance-y-contrato-local.md` (contrato de integración local),
`bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` (fuente de verdad) y
`bandadau-docs/docs/05-infraestructura/*.md`.

## Inicio rápido

Requisitos: los 8 repos como carpetas **hermanas** (`scripts/clone-all.sh`), Docker Desktop / OrbStack con
**≥ 12 GB de RAM** asignados, Node ≥ 22 (recomendado 24), `make` (sirve el 3.81 de macOS) y `openssl`.
No hace falta Java, PHP, Composer ni Gradle: todo se compila dentro de Docker.

```bash
cd bandadau-infra
cp .env.example .env
make setup      # verifica herramientas, corepack, build de bandadau-shared, llaves (secrets/), definitions de RabbitMQ
make up         # infra + 8 servicios (construye las imágenes desde los repos hermanos) y espera a que estén healthy
make seed       # universidades, usuarios demo, créditos, grupo, posts y 3 eventos
make smoke      # humo de la fase 1 (tabla ✓/✗, sale ≠ 0 si algo falla)
make mock       # (opcional) gateway mock en :4010 para desarrollar frontends sin backend; make mock-stop / make mock-test (ver mock/README.md)
```

Solo infraestructura (para correr servicios en tu IDE): `make up-infra`. Con Grafana/OTLP: `make up-obs`.
`make` sin argumentos lista todos los objetivos.

> Las imágenes de los servicios las escriben sus dueños (`bandadau-backend/services/<x>/Dockerfile`). Mientras un
> servicio no tenga Dockerfile, `make up` falla al construirlo; `make up-infra` funciona siempre.

## URLs, puertos y credenciales

| Qué | URL | Credenciales / notas |
|---|---|---|
| API REST | http://api.bandada.localhost/api/v1 | JWKS en `/.well-known/jwks.json`; `/internal/**` y `/api/v1/auth/service-token` → 403 |
| GraphQL (HTTP + WS) | http://api.bandada.localhost/graphql | Bearer del moderador/admin |
| Landing / App web / Panel | http://bandada.localhost · http://app.bandada.localhost · http://admin.bandada.localhost | dev servers en el host (`pnpm dev`: 3000, 8081, 3001); Traefik los reenvía a `host.docker.internal` |
| MFE moderación / insights | http://mfe.bandada.localhost/moderation · `/insights` | dev servers 4201 / 4301 |
| Servicios (directo, para depurar) | `localhost:7001` identity · 7002 social · 7003 media · 7004 events · 7005 wallet · 7006 ticketing · 7007 notification · 7010 admin-gateway | |
| Traefik dashboard | http://localhost:8080 | |
| RabbitMQ UI | http://localhost:15672 · http://rabbit.bandada.localhost | `admin` / `admin` (AMQP 5672: `bandada` / `bandada`) |
| MinIO consola / API S3 | http://localhost:9001 · http://localhost:9000 (`s3.bandada.localhost` vía Traefik) | `minio` / `minio_dev_pw` |
| Mailpit (correos, códigos de verificación) | http://localhost:8025 · http://mail.bandada.localhost | SMTP `mailpit:1025` |
| n8n | http://localhost:5678 · http://n8n.bandada.localhost | propietario `admin@bandada.localhost` / `Bandada-n8n-dev1` (variables `N8N_OWNER_*`); workflows de `n8n/` importados al arrancar — ver `n8n/README.md` |
| Grafana (solo `make up-obs`) | http://localhost:3300 · http://grafana.bandada.localhost | `admin` / `admin`; OTLP 4317 / 4318 |
| PostgreSQL | `127.0.0.1:5432` | `postgres`/`postgres`; `identity`/`identity_dev` (`identity_db`), `events`/`events_dev`, `wallet`/`wallet_dev` |
| MongoDB (rs0) | `127.0.0.1:27017` | `mongodb://social:social_dev@localhost:27017/social?authSource=social&directConnection=true` · `media`/`media_dev` · root `root`/`mongo_dev` |
| DynamoDB Local | http://127.0.0.1:8000 | región `us-east-1`, credenciales `local`/`local` |

Usuarios de demo (`make seed`, contraseña de desarrollo **`Bandada#2026`**):

| Email | Rol |
|---|---|
| `admin@umsa.edu.bo` | ADMIN |
| `mod@umsa.edu.bo` | MODERATOR |
| `org@umsa.edu.bo` | ORGANIZER |
| `org2@umsa.edu.bo` | ORGANIZER (segundo organizador: el smoke comprueba que no puede validar tickets de eventos de `org`) |
| `lucia@umsa.edu.bo` (100 créditos) · `marco@umsa.edu.bo` | STUDENT |

`make urls` imprime esta tabla (con tu `BASE_DOMAIN`).

## Perfiles de Compose

| Perfil | Qué levanta |
|---|---|
| `infra` | `traefik`, `postgres`, `mongo-keyfile` + `mongo` + `mongo-init` (rs0, usuarios), `dynamodb-local` + `dynamodb-init` (tablas, TTL), `rabbitmq` (definitions), `minio` + `minio-init` (buckets, usuarios, políticas), `mailpit`, `n8n` |
| `services` | `identity-service`, `social-service`, `media-service`, `events-service`, `wallet-service` (+ `wallet-worker`, `wallet-relay`), `ticketing-service`, `notification-service` (+ `notification-worker`, `notification-relay`), `admin-gateway` |
| `observability` | `lgtm` (grafana/otel-lgtm). **OFF por defecto**: `make up-obs` |
| `llm` | vacío (placeholder de la fase 2) |

Red: `bandada` (`<proyecto>_bandada`). Todos los contenedores de larga vida tienen healthcheck, límites de memoria
(JVM 512 MB, PHP 256 MB, Node 256 MB; n8n 768 MB, RabbitMQ 640 MB) y logs rotados (10 MB × 3). Volúmenes con
nombre: `postgres-data`, `mongo-data`, `mongo-keyfile`, `dynamodb-data`, `rabbitmq-data`, `minio-data`,
`mailpit-data`, `n8n-data`, `lgtm-data`.

## Nombres que crea la infraestructura (los servicios deben respetarlos)

- **PostgreSQL**: bases `identity_db`, `events_db`, `wallet_db`; usuarios `identity`, `events`, `wallet` (cada uno solo entra a su base). Los esquemas los crea cada servicio con sus migraciones.
- **MongoDB** `rs0` (1 nodo, host anunciado `mongo:27017`, keyfile): usuarios `social` (base `social`) y `media` (base `media`), `readWrite`. URI: `mongodb://social:<pw>@mongo:27017/social?replicaSet=rs0&authSource=social`. Los índices los crea cada servicio.
- **DynamoDB Local**: `bandada-idempotency` (pk), `bandada-ticketing` (pk/sk, GSI1 `gsi1pk/gsi1sk`, GSI2 `gsi2pk/gsi2sk`), `bandada-notifications` (pk/sk, GSI1), `bandada-insights` (pk/sk, GSI1). `PAY_PER_REQUEST`, TTL `expiresAt` activado en las cuatro (DynamoDB Local no garantiza el borrado: el código también filtra por `expiresAt`).
- **MinIO**: buckets `bandada-media`, `bandada-reports`, `bandada-models`, `bandada-public` (lectura anónima). Usuarios `media-svc` y `insights-svc` con políticas por bucket. CORS del API S3 = `CORS_ORIGINS`. Las URLs prefirmadas se firman con `S3_PUBLIC_ENDPOINT=http://localhost:9000` (path-style).
- **RabbitMQ** (vhost `/`, `rabbitmq/definitions.json`): exchanges topic `bandada.events`, `bandada.commands`, `bandada.dlx`. Por cada cola principal `<q>` (quorum, `x-dead-letter-exchange=bandada.dlx`, `x-dead-letter-routing-key=<q>`, `x-delivery-limit=10`): colas de espera `<q>.retry.5s|30s|5m` (classic, TTL 5 s/30 s/5 min, DLX `""` → `<q>`) y `<q>.dlq` (quorum, enlazada a `bandada.dlx` con routing key `<q>`). Colas principales: `events-service.saga-replies`, `wallet-service.commands`, `ticketing-service.commands`, `social-service.events`, `media-service.events`, `notification-service.events`, `insights-service.analytics`, `n8n.automation`, con los bindings del catálogo §5. `admin-gateway.subscriptions.<instanceId>` la declara el propio gateway (exclusiva, auto-delete). **Los servicios no crean esta topología: la verifican** (declaración pasiva) y, si la declaran, deben usar exactamente estos argumentos. Las colas sin consumidor en fase 1 (`n8n.automation`, `insights-service.analytics`) y las `.dlq` se acotan por *policy* (`max-length` 10 000, `drop-head`), no por argumento.
  Usuarios: `bandada`/`bandada` (servicios; permisos `.*`), `n8n`, `monitor` (solo lectura), `admin` (UI).
- **Mailpit**: SMTP `mailpit:1025` sin autenticación; API en `http://localhost:8025/api/v1`.

## Variables que deben respetar los servicios

Todas están en `.env.example` y se cablean en `docker-compose.yaml` (un bloque `environment` por servicio, derivado de
los `AGENTS.md` de cada servicio y de `entornos-y-variables.md`). Puntos de integración:

- `JWKS_URL=http://identity-service:7001/.well-known/jwks.json`, `JWT_ISSUER=http://api.${BASE_DOMAIN}`.
- identity: `JWT_PRIVATE_KEY_PATH=/run/secrets/jwt-private.pem` (`./secrets` montado **de lectura y escritura**: `make keys` pre-genera una llave RS256 PKCS#8; si el archivo no existe, identity la genera ahí), `SERVICE_CLIENTS=id:secret,…` (incluye `bandada-seed`), `SMTP_HOST=mailpit`, `SPRING_PROFILES_ACTIVE=dev`.
- ticketing: `QR_SIGNING_KEY_PATH=/run/secrets/qr-es256.pem` (EC P-256 PKCS#8, montado de solo lectura; `make keys`), `QR_SIGNING_KID=tk-2026-10`, `CHAOS_TICKETING_FAIL`.
- wallet: `APP_KEY` (`WALLET_APP_KEY`), `PAYMENT_SIMULATOR_ENABLED` y `PAYMENT_GATEWAY=simulated` (el alias `SIMULATE_PAYMENT_ENABLED` se retiró: ningún servicio lo lee), `TOPUP_PACKAGES=CREDITS_20,CREDITS_50,CREDITS_100`. Procesos auxiliares: `php artisan wallet:consume-commands` y `wallet:relay-outbox` (configurables con `WALLET_WORKER_CMD` / `WALLET_RELAY_CMD`).
- notification: `APP_KEY` (`NOTIFICATION_APP_KEY`), `MAIL_HOST=mailpit`, `PUSH_ENABLED=false`; auxiliares `php artisan notifications:consume` y `notifications:relay-outbox` (`NOTIFICATION_WORKER_CMD` / `NOTIFICATION_RELAY_CMD`; ambos comandos existen en el servicio).
- media: `MODERATION_MODE=allow-all|manual`, `S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_ACCESS_KEY_ID=media-svc`.
- Todos: `OTEL_SDK_DISABLED=true` salvo `make up-obs`; `CORS_ORIGINS` (si el servicio añade CORS propio para el acceso directo `localhost:700x`, Traefik sobrescribe la cabecera `Access-Control-Allow-Origin` en el camino `api.*`, no se duplica).
- Los healthchecks de Compose llaman a `GET /health/ready` con `wget` o `curl` (la imagen debe traer uno de los dos).

## `make seed` y `make smoke`

`seed/seed.mjs` (Node ESM, solo `fetch`) crea universidades UMSA (`umsa.edu.bo`) y UCB (`ucb.edu.bo`), los 5 usuarios demo
(registro → código leído de **Mailpit** → `verify-email`), asigna roles por `PATCH /internal/v1/users/{id}/roles`
con token de servicio (cliente `bandada-seed`), recarga 100 créditos a Lucía con `simulate-payment`, crea un grupo,
3 posts y 3 eventos publicados (gratuito, 20 créditos, cupo 1). Es idempotente.

`smoke/smoke.mjs`: registro (y replay con la misma `Idempotency-Key`) → verificación → login → post → recarga idempotente
(doble `simulate-payment` simultáneo = un solo crédito) → evento de 20 créditos con inscripción pagada y ticket
**ES256 verificado** contra `/tickets/signing-keys` → `ALREADY_REGISTERED` → notificación in-app → `EVENT_FULL` (cupo 1) →
**caos**: recrea `ticketing-service` con `CHAOS_TICKETING_FAIL=true`, comprueba `FAILED/TICKET_ISSUE_FAILED` y el reembolso, y lo
restaura → login del moderador y `moderationQueue` por GraphQL (+ RBAC `FORBIDDEN` para un estudiante). Opciones:
`SMOKE_CHAOS=0` o `--no-chaos` omiten el caos; `--only=chaos` lo ejecuta solo.

Supuestos sobre identity (si no se cumplen, el seed lo dice en el paso que falla): `POST /api/v1/auth/service-token` acepta el
cliente `bandada-seed` por el puerto publicado de identity (`localhost:7001`, nunca por Traefik); `X-Actor-Id` en
`/internal/v1/**` acepta cualquier UUID; el correo de verificación llega a Mailpit con el código de 6 dígitos en el texto.

## Correr un servicio fuera de Docker (en tu IDE)

1. `make up-infra` (más los servicios que no editas: `docker compose --profile services up -d <svc> …`).
2. En el IDE usa los valores `localhost` del `AGENTS.md` del servicio (`DATABASE_URL=jdbc:postgresql://localhost:5432/…`,
   `MONGODB_URI=mongodb://social:social_dev@localhost:27017/social?authSource=social&directConnection=true`,
   `RABBITMQ_URL=amqp://bandada:bandada@localhost:5672`, `DYNAMODB_ENDPOINT=http://localhost:8000`,
   `S3_ENDPOINT=http://localhost:9000`, `SMTP_HOST=localhost`, `JWKS_URL=http://localhost:7001/.well-known/jwks.json`).
3. `make host S=identity-service` detiene el contenedor y levanta un proxy TCP con el mismo nombre de red hacia
   `host.docker.internal:7001`: Traefik y los demás contenedores empiezan a hablar con tu proceso local. `make unhost S=identity-service` lo deshace.

## Problemas comunes

- **Docker con poca memoria**: la pila completa necesita ≈ 8 GB; se recomienda ≥ 12 GB (Docker Desktop → Settings → Resources → Memory).
  `make setup` lo avisa. Si no puedes: `make up-infra` y corre solo el servicio que editas en el IDE.
- **Puerto ocupado** (`bind: address already in use`): cambia el puerto del host en `.env` (`POSTGRES_PORT`, `HTTP_PORT`, …) y repite `make up`.
  Para ver quién lo usa: `lsof -nP -iTCP:5432 -sTCP:LISTEN`. (En esta máquina `5433` es de otro proyecto y `8081` suele ser Metro.)
- **`*.localhost` no resuelve** (Safari, Linux, Android): agrega a `/etc/hosts`
  `127.0.0.1 bandada.localhost api.bandada.localhost app.bandada.localhost admin.bandada.localhost mfe.bandada.localhost n8n.bandada.localhost mail.bandada.localhost rabbit.bandada.localhost s3.bandada.localhost`,
  o usa los puertos directos (`http://localhost:7001…`). Para un teléfono físico: `EXPO_PUBLIC_API_URL=http://<IP-LAN>`.
- **MongoDB no arranca con "Linux kernel versions 6.19 and newer has a known incompatibility"** (SERVER-121912): por eso la imagen está fijada a
  `mongo:8.0.19`; las 8.0.21+ y 8.3 abortan en el kernel de Docker Desktop reciente. No la actualices hasta que MongoDB lo corrija.
- **Mongo "not primary"**: espera a que `mongo-init` termine (`make ps`); desde el host usa `?directConnection=true`.
- **`make up` falla en un servicio**: `make logs S=<servicio>`; revisa que su `Dockerfile` exista y que `bandadau-shared` esté construido (`make setup`).
- **El seed no recibe el código de verificación**: abre http://localhost:8025; si el correo no llega, identity no usa `SMTP_HOST=mailpit` o
  no está en perfil `dev` (el código también debe estar en `make logs S=identity-service`).
- **URL prefirmada no abre / CORS en la subida**: revisa `S3_PUBLIC_ENDPOINT` (`http://localhost:9000`) y `CORS_ORIGINS`.
- **Cambié una variable `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`** y no se ve: son de *build*, recompila el frontend.
- **Se perdieron credenciales de n8n**: cambió `N8N_ENCRYPTION_KEY`.
- **Empezar de cero**: `make reset` borra los volúmenes (bases, buckets, colas, llaves de Mongo).
- **Otro proyecto Compose en paralelo**: `make up-infra PROJECT=prueba` y `make reset PROJECT=prueba` (cambia los puertos del host en `.env` si ambos corren a la vez).

## Estructura

```
bandadau-infra/
├── docker-compose.yaml    # perfiles infra · services · observability · llm
├── .env.example           # todas las variables (valores de desarrollo)
├── Makefile               # make help
├── traefik/               # traefik.yml + dynamic/{routers,middlewares}.yml (dominio por BASE_DOMAIN)
├── postgres/init/         # 3 bases, 3 usuarios
├── mongo/init/            # rs0 + usuarios (el keyfile lo genera el job mongo-keyfile)
├── dynamodb/              # tables/*.json + create-tables.sh + ttl.txt
├── rabbitmq/              # rabbitmq.conf, definitions.template.json → definitions.json (render-definitions.sh)
├── minio/init.sh          # buckets, usuarios, políticas
├── seed/  smoke/          # Node ESM sin dependencias (seed/lib compartido)
├── scripts/               # gen-keys, wait-healthy, check-infra, host-upstream, clone-all, create-github-repos
├── secrets/               # PEM de desarrollo (git-ignored; los crea `make keys`)
├── n8n/                   # workflows (fase 2) — ver n8n/AGENTS.md
└── ci/templates/          # plantillas de GitHub Actions por repo (+ .github/workflows/ci.yml de este repo)
```

## CI

`ci/templates/<repo>.yml` es la plantilla para copiar a `<repo>/.github/workflows/ci.yml` (lint + test + build, sin despliegue).
Cada una hace *checkout* hermano de `bandadau-shared` y `bandadau-docs` (secreto opcional `CI_REPOS_TOKEN` si los repos son
privados). El CI de este repo (`.github/workflows/ci.yml`) valida la configuración, levanta el perfil `infra` real y corre
`make check-infra`; el job `stack` (pila completa + seed + smoke) es manual/semanal (los servicios ya existen; no corre en cada push por duración).
