# deploy/ — despliegue multi-nube de Bandada U (ADR-0025 y ADR-0026)

> **AWS ahora se crea con Terraform** (`../terraform/aws/`: EC2, IP elástica, DynamoDB, IAM, Route 53, ACM y CloudFront) y se borra con `make aws-destroy`. Aquí queda lo que corre *dentro* de las VMs.

> **Estado: diseño sin ejecutar.** Los tres `docker-compose.*.yaml` se validan con `docker compose config`; nada se ha desplegado
> todavía en AWS, Azure ni GCP. Guía paso a paso (cuentas, VMs, Tailscale, DynamoDB, demo): `bandadau-docs/docs/05-infraestructura/guia-despliegue.md`.

## Idea en una frase

Tres VMs unidas por **Tailscale**: **AWS** corre casi todo y guarda todos los datos; **Azure** corre `events-service`; **GCP** corre `wallet-service`
(+ worker y relay). Las VMs de Azure y GCP no abren puertos públicos: hablan con Postgres, RabbitMQ, identity y media del EC2 por su IP `100.x`,
y Traefik (EC2) les reenvía el tráfico por la misma red. Cada nube usa el **mismo `docker-compose.yaml` de la raíz** más un archivo de override.

## Contenido

| Archivo | Para qué |
|---|---|
| `docker-compose.aws.yaml` | Override del EC2: imágenes de GHCR, DynamoDB real, Traefik en HTTP:80 detrás de CloudFront (exige `X-Origin-Verify`), nginx de estáticos, puertos solo en la IP Tailscale |
| `docker-compose.azure.yaml` | Override de la VM de Azure: solo `events-service` |
| `docker-compose.gcp.yaml` | Override de la VM de GCP: `wallet-service`, `wallet-worker`, `wallet-relay` |
| `.env.aws.example` · `.env.azure.example` · `.env.gcp.example` | Variables de cada nube, con marcadores de secreto |
| `render-env.sh` | Genera `.env.<nube>` y `.secrets` (mismos secretos en las tres nubes) |
| `traefik/routers.prod.yml` | Rutas de producción (TLS, upstreams remotos por Tailscale, estáticos) |
| `nginx/default.conf.template` | Un nginx sirve landing, app, panel y microfrontends por host |
| `build-push.sh` | Construye las 9 imágenes (linux/amd64) y las publica en GHCR |
| `dynamodb-create.sh` | Crea las 4 tablas y el TTL en AWS real |
| `deploy.sh` | `ssh` por Tailscale + `pull` + `up -d --no-deps` + espera de salud + rollback |
| `publish-static.sh` | Copia un frontend compilado al nginx del EC2 (despliegue independiente de un microfrontend) |

## Flujo (resumen)

```bash
cd bandadau-infra
deploy/render-env.sh aws && deploy/render-env.sh azure && deploy/render-env.sh gcp   # luego edita los valores por rellenar
AWS_REGION=us-east-1 deploy/dynamodb-create.sh                                       # una vez
GHCR_OWNER=<tu-org> IMAGE_TAG=v1 deploy/build-push.sh                                # imágenes a GHCR
PUSH_ENV=1 deploy/deploy.sh aws && PUSH_ENV=1 deploy/deploy.sh azure && PUSH_ENV=1 deploy/deploy.sh gcp
deploy/deploy.sh azure events-service v2                                             # un solo servicio, con rollback si falla
deploy/publish-static.sh mfe ../bandadau-admin/mfe-moderation/dist moderation        # un solo microfrontend
```

`ops.htpasswd` (usuario/clave de Mailpit, RabbitMQ y consola de MinIO) se crea una vez:
`printf 'admin:%s\n' "$(openssl passwd -apr1 'CLAVE')" > deploy/traefik/ops.htpasswd`.

## Requisitos de Compose

`!override` y `!reset` exigen Docker Compose **≥ 2.24** (validado con v5.5.1). Todas las órdenes llevan `--profile infra --profile services`
(con solo `services`, Compose rechaza los `depends_on` hacia `infra`); en Azure y GCP se arranca con `--no-deps` y el servicio nombrado.

## Qué NO está verificado

Ejecución real de los contenedores (el daemon de Docker estaba apagado al escribirlo), el enrutamiento Docker → Tailscale, el certificado de ACM y el origen de CloudFront, el rollback de `deploy.sh`, el tiempo de construir para `linux/amd64` desde un Mac con Apple Silicon y la tag `nginx:1.28-alpine`.
