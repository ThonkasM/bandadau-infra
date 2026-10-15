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
   Compose solo los referencia (`build.context: ../bandadau-backend/services/<x>`; los servicios Node usan
   `context: ../bandadau-backend` + `additional_contexts: { shared: ../bandadau-shared }`). Si un Dockerfile
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
| `docker-compose.yaml` | Un solo archivo con perfiles `infra`, `services`, `observability`, `llm` (la fase 1 no usa `compose/`) |
| `.env.example` | Todas las variables (valores de desarrollo); `.env` está git-ignored |
| `traefik/` | `traefik.yml` + `dynamic/{routers,middlewares}.yml` (usan `{{ env "BASE_DOMAIN" }}`; `deny-all` para `/internal` y `service-token`) |
| `postgres/init/` | `01-create-databases.sh` (3 bases, 3 usuarios, idempotente) |
| `mongo/init/` | `init.sh`, `init-replica.js`, `create-users.js` (rs0 + usuarios `social`, `media`); el keyfile lo crea el job `mongo-keyfile` |
| `dynamodb/` | `tables/*.json` (4 tablas) + `ttl.txt` + `create-tables.sh` |
| `rabbitmq/` | `rabbitmq.conf`, `definitions.template.json`, `render-definitions.sh` → `definitions.json` (versionado; se regenera con `make rabbit-defs`) |
| `minio/` | `init.sh` (buckets, usuarios por servicio, políticas) |
| `seed/` `smoke/` | Node ESM sin dependencias; `seed/lib` es compartido. `seed.mjs` carga lo básico y `extra.mjs` los datos de demo ampliados (9 usuarios con perfil, seguidores, grupos, posts con foto generada, comentarios, reacciones, eventos con portada, recargas, inscripciones/tickets y limpieza de eventos de smoke); `node seed/seed.mjs --basic` omite lo ampliado |
| `scripts/` | `gen-keys.sh`, `wait-healthy.sh`, `check-infra.sh`, `host-upstream.sh`, `clone-all.sh`, `create-github-repos.sh` |
| `secrets/` | PEM de desarrollo generados por `make keys` (git-ignored) |
| `mock/` | Gateway mock (Fastify + graphql) que imita `api.*` desde `bandadau-docs/contracts/`; `make mock*` |
| `n8n/` | workflows JSON (fase 2) — ver `n8n/AGENTS.md` |
| `ci/templates/` | plantillas de GitHub Actions por repo (copiar a `<repo>/.github/workflows/ci.yml`) |
| *(pendiente, fases posteriores)* | `observability/` (dashboards), `load/` (k6), `aws/` (CloudFormation, scripts de despliegue), `ci/actions/` |

## Comandos (desde `bandadau-infra/`)

```bash
cp .env.example .env && make setup && make up && make seed && make smoke   # arranque completo de la fase 1
make up-infra            # solo infraestructura (para correr servicios en el IDE)
make up-obs              # + Grafana LGTM y OTLP activado
make down   make reset   # reset = down -v (borra volúmenes)
make restart S=<svc>     make logs S=<svc>   make ps   make build [S=<svc>]
make host S=<svc>        make unhost S=<svc>   # redirige un servicio a tu IDE (proxy TCP hacia el host)
make check-infra         # verifica el perfil infra (salud, colas, bases, tablas, buckets, rutas)
make validate            # compose config + sintaxis de scripts + seed/smoke
make urls                # URLs, puertos y credenciales de demo
make mock / mock-stop / mock-test   # gateway mock Node en :4010 (sin Docker) para frontends; ver mock/README.md
```

`PROJECT=<nombre>` cambia el nombre del proyecto Compose (pruebas en paralelo sin tocar el stack principal).

Validar antes de commitear:

```bash
make validate
make up-infra PROJECT=test && make check-infra PROJECT=test && make reset PROJECT=test
```

## Gotchas aprendidos (no los redescubras)

- `mongo` está fijado a **8.0.19**: 8.0.21+ y 8.3 abortan en kernels Linux ≥ 6.19 (SERVER-121912, Docker Desktop reciente).
- `postgres:18` monta el volumen en `/var/lib/postgresql` (no `/var/lib/postgresql/data`).
- MinIO ya no se publica en `minio/minio` ni en quay: se usa la bifurcación comunitaria `pgsty/minio` (trae `mc` y `curl`).
- `docker compose up --wait` falla con los jobs one-shot que terminan en 0: se usa `scripts/wait-healthy.sh`.
- Con `--profile services` sola, Compose rechaza `depends_on` hacia servicios del perfil `infra`: usa `--profile '*'` o `infra`+`services`.
- Traefik: el dominio sale de `{{ env "BASE_DOMAIN" }}` en el *file provider* (variable de entorno del contenedor); no escribas el dominio a mano.
- RabbitMQ: las contraseñas de `definitions.json` van en claro (solo local); las colas/retry/DLQ siguen `eventos-y-mensajeria.md` §2.
- Las `*.dlq` y las colas sin consumidor en fase 1 se acotan con *policies*, no con argumentos (para no romper la declaración idempotente del dueño).

## Al cerrar la sesión

- Si cambiaste puertos, variables o URLs: actualiza `bandadau-docs/docs/05-infraestructura/*.md`
  (y el `.env.example` correspondiente).
- Entrada en `bandadau-docs/docs/06-plan/registro-de-sesiones.md`.
- Commits `feat(infra): …` / `fix(infra): …` en este repo; los cambios de servicios van en su propio repo.
