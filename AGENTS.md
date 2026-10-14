# AGENTS.md — bandadau-infra

Repositorio de **infraestructura** de Bandada U (ADR-0017): Docker Compose local, Traefik, inicialización
de bases, broker y buckets, observabilidad, pruebas de carga, IaC de AWS (CloudFormation) y
piezas de CI/CD. **Aquí no hay código de aplicación.**

Lee antes: `../AGENTS.md` (workspace), `../bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` (fuente de
verdad), `../bandadau-docs/docs/05-infraestructura/infraestructura.md` y
`../bandadau-docs/docs/05-infraestructura/entornos-y-variables.md`.

## Reglas

1. **El catálogo manda.** Nombres de servicios, puertos, imágenes, colas, bindings, tablas
   DynamoDB, bases y usuarios salen de `catalogo-servicios.md`. Si algo no está ahí, no se
   inventa: se propone un ADR (`bandadau-docs/docs/03-arquitectura/adr/`) y se actualiza el catálogo primero.
2. **No toques código de servicios/apps desde aquí.** Los `Dockerfile` viven en los repos hermanos
   (`bandadau-backend/services/<x>/`, `bandadau-frontend/`, `bandadau-admin/<app>/`, `bandadau-landing/`);
   Compose solo los referencia (`build.context: ../../<repo>/…`). Si un Dockerfile
   necesita un cambio, se hace en una sesión/PR del componente dueño.
3. **Barato por defecto**: un EC2 + RDS micro + DynamoDB on-demand + S3/CloudFront. Prohibido
   agregar ALB, NAT Gateway, EKS/ECS, Multi-AZ, OpenSearch, MSK, etc. sin ADR con costo.
4. **Dominio parametrizado**: siempre `${BASE_DOMAIN}`; nunca `bandadau.com` ni
   `bandada.localhost` escritos a mano en configuración.
5. **Sin secretos en git.** Solo `.env.example` con valores de desarrollo. Producción: SSM
   Parameter Store / Secrets Manager (ver `entornos-y-variables.md` §5).
6. **Mínimo privilegio** (RNF-07): un usuario de Postgres por base, un usuario de Mongo por
   base, un usuario de RabbitMQ por servicio, políticas IAM por recurso. `/internal/**` → 403 en
   Traefik.
7. **Idempotencia de los scripts de init**: `create-tables.sh`, `init.sh` de MinIO,
   `mongo-init`, `db-bootstrap` deben poder ejecutarse N veces sin error ni efectos duplicados.
8. **Healthchecks obligatorios** en todo contenedor de larga vida; `depends_on` con
   `condition: service_healthy` / `service_completed_successfully`.
9. **Fija versiones** de imágenes (tag exacto, no `latest`) y verifica en la documentación
   oficial los cambios de versión (p. ej. el `PGDATA` de `postgres:18`).
10. Identificadores y archivos en inglés; comentarios solo cuando el *por qué* no es obvio;
    documentación en español.

## Mapa

| Ruta | Contenido |
|---|---|
| `compose/` | `compose.yaml` (include), `infra.yaml`, `services.yaml`, `apps.yaml`, `tools.yaml`, `override.host-upstreams.yaml`, `prod.yaml` |
| `traefik/` | `traefik.yml` + `dynamic/` (routers, middlewares: cors, ratelimit, internal-block, ops-auth) |
| `postgres/init/` | `01-create-databases.sh` (3 bases, 3 usuarios) |
| `mongo/init/` | replica set `rs0`, usuarios `social`, `media`, keyfile |
| `dynamodb/` | `tables/*.json` (4 tablas) + `create-tables.sh` |
| `rabbitmq/` | `rabbitmq.conf`, `definitions.template.json`, `render-definitions.sh` |
| `minio/` | `init.sh` (buckets, usuarios, CORS) |
| `n8n/` | workflows JSON (`wf-00-router` … `wf-06`), plantillas, scripts y credenciales de ejemplo — ver `n8n/AGENTS.md` |
| `observability/` | dashboards Grafana, reglas de alerta, config del colector |
| `seed/` | datos de demo vía APIs públicas/internas |
| `load/` | escenarios k6 (RNF-01, RNF-02) |
| `aws/cloudformation/` | `network`, `data`, `compute`, `edge`, `ci`, `scheduler` |
| `aws/params/` | `dev.env.example`, `prod.env.example` |
| `aws/scripts/` | `deploy-stack.sh`, `host-deploy.sh`, `render-env.sh`, `deploy-static.sh`, `backup-mongo.sh` |
| `ci/actions/` | composite actions (`docker-build-push`, `ssm-deploy`, `static-deploy`) |
| `ci/templates/` | plantillas de workflow por tipo de componente |

## Comandos (desde `bandadau-infra/`)

```bash
make env                 # crea bandadau-infra/.env desde .env.example
make infra-up            # perfil infra
make up                  # infra + services
make up-all              # infra + services + apps
make svc S=<servicio>    # infra + un servicio
make logs S=<servicio>   make ps   make down   make reset
make seed                make load
make n8n-import          make n8n-export
make models-sync         # sube ONNX de ../bandadau-ml a MinIO
make validate            # docker compose config --quiet + render definitions
make cfn-lint            # cfn-lint aws/cloudformation/*.yaml
make aws-deploy ENV=<dev|prod> STACK=<network|data|compute|edge|ci|scheduler>
make aws-start ENV=<env> / make aws-stop ENV=<env>
```

Validar antes de commitear (desde `bandadau-infra/`):

```bash
docker compose -f compose/compose.yaml config --quiet
cfn-lint aws/cloudformation/*.yaml
hadolint ../bandadau-backend/services/*/Dockerfile ../bandadau-{frontend,landing}/Dockerfile ../bandadau-admin/*/Dockerfile   # solo lectura: reporta al dueño
```

## Al cerrar la sesión

- Si cambiaste puertos, variables o URLs: actualiza `bandadau-docs/docs/05-infraestructura/*.md`
  (y el `.env.example` correspondiente).
- Entrada en `bandadau-docs/docs/06-plan/registro-de-sesiones.md`.
- Commits `feat(infra): …` / `fix(infra): …` en este repo; los cambios de servicios van en su propio repo.
