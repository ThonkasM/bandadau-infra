# bandadau-infra

Infraestructura de Bandada U (repositorio propio, ADR-0017): entorno local con **Docker Compose + Traefik**
(`*.bandada.localhost`), inicialización de PostgreSQL / MongoDB / DynamoDB Local / RabbitMQ /
MinIO / n8n, observabilidad (Grafana LGTM), pruebas de carga (k6) e IaC de la demo en **AWS**
(EC2 + RDS + DynamoDB + S3 + CloudFront, CloudFormation, despliegue por SSM).

Documentación completa:

- `bandadau-docs/docs/05-infraestructura/infraestructura.md` — local, AWS, CI/CD, backups, costos.
- `bandadau-docs/docs/05-infraestructura/entornos-y-variables.md` — variables, puertos, URLs, secretos.
- `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` — fuente de verdad de servicios, puertos, colas y tablas.

## Inicio rápido

Requisitos: los 8 repos clonados como carpetas hermanas (`scripts/clone-all.sh`), Docker Desktop /
OrbStack con ≥ 10 GB de RAM asignados, `make`, `pnpm`, JDK 25, PHP 8.4 + Composer (solo si vas a
correr servicios fuera de Docker).

```bash
cd bandadau-infra
make env          # copia .env.example → .env (valores de desarrollo)
make up           # infraestructura + 9 servicios
make seed         # universidades, usuarios por rol, grupos, eventos, créditos
```

| URL | Qué |
|---|---|
| http://bandada.localhost | Landing |
| http://app.bandada.localhost | App web (PWA) |
| http://admin.bandada.localhost | Panel |
| http://api.bandada.localhost/api/v1 | API REST (GraphQL en `/graphql`, MCP en `/mcp`) |
| http://localhost:15672 | RabbitMQ |
| http://localhost:5678 | n8n |
| http://localhost:3300 | Grafana |
| http://localhost:8025 | Mailpit (correos de verificación) |
| http://localhost:9001 | MinIO |
| http://localhost:8080 | Traefik dashboard |

## Perfiles

| Perfil | Qué levanta |
|---|---|
| `infra` | traefik, postgres, mongo (+init rs0), dynamodb-local (+tablas), rabbitmq (definitions), minio (+buckets), n8n, lgtm, mailpit |
| `services` | identity, social, media, events, wallet, ticketing, notification, insights, admin-gateway |
| `apps` | landing, admin-shell, mfe-moderation, mfe-insights, mobile-web |
| `llm` | ollama |
| `tools` | k6, seed |

Desarrollo diario: `make infra-up` y corre en tu IDE solo el servicio/app que editas; activa
`<SERVICIO>_UPSTREAM=host` en `bandadau-infra/.env` para que Traefik lo enrute a `host.docker.internal`.

## Estructura

```
bandadau-infra/
├── compose/            # compose.yaml + archivos por perfil + prod.yaml
├── traefik/            # estático + dinámico (routers, middlewares)
├── postgres/init/      # 3 bases, 3 usuarios
├── mongo/init/         # replica set rs0 + usuarios
├── dynamodb/tables/    # bandada-idempotency, -ticketing, -notifications, -insights
├── rabbitmq/           # definitions.json (exchanges, colas, DLQ, usuarios)
├── minio/              # buckets bandada-media, -reports, -models, -public
├── n8n/                # workflows n8n (wf-00…wf-06), plantillas y scripts
├── observability/      # dashboards, alertas
├── seed/  load/        # datos de demo, k6
├── aws/cloudformation/ # network, data, compute, edge, ci, scheduler
├── aws/scripts/        # deploy-stack, host-deploy, render-env, deploy-static, backup-mongo
├── scripts/            # clone-all.sh, create-github-repos.sh (workspace multi-repo)
└── ci/                 # composite actions + plantillas de workflows
```

## AWS (demo)

```bash
cp aws/params/prod.env.example aws/params/prod.env   # editar (git-ignored)
make aws-deploy ENV=prod STACK=network   # luego data, ci, compute, edge, scheduler
```

Los servicios se despliegan desde GitHub Actions (build → ECR → `ssm send-command` →
`host-deploy.sh`). Estáticos y microfrontends van a S3 + CloudFront de forma independiente.
Costo objetivo ≈ USD 55–65/mes con apagado programado (detalle en `infraestructura.md` §4.4).

## Problemas comunes

- **`*.localhost` no resuelve** (Linux/Android): agrega las entradas a `/etc/hosts` o usa la IP
  LAN para `EXPO_PUBLIC_API_URL`.
- **Mongo "not primary"**: espera a que `mongo-init` termine (`make ps`); desde el host usa
  `?directConnection=true`.
- **URL prefirmada no abre**: revisa `S3_PUBLIC_ENDPOINT` (debe ser `http://s3.${BASE_DOMAIN}`).
- **Cambié una variable `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`** y no se ve: son de *build*, recompila.
- **Se perdieron credenciales de n8n**: cambió `N8N_ENCRYPTION_KEY`.
