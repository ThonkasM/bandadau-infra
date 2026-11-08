# terraform/aws — infraestructura de AWS de Bandada U (ADR-0026)

Crea en **una sola región (us-east-1)** todo lo de AWS y **lo borra con un comando** después de la presentación.

```
Navegador ──HTTPS──▶ CloudFront (bandadau.lat y *.bandadau.lat, certificado ACM)
                         │ HTTP :80 + cabecera secreta X-Origin-Verify
                         ▼
                    EC2 + IP elástica ── Traefik ─▶ servicios, nginx (estáticos), datos
                         │                 └─ Tailscale ─▶ Azure (events) · GCP (wallet)
                         └─ rol IAM ─▶ DynamoDB (4 tablas)
Route 53 (zona delegada desde Namecheap) ─ alias ─▶ CloudFront
```

| Archivo | Qué crea |
|---|---|
| `dns.tf` | Zona de Route 53, certificado ACM (raíz + comodín) con validación DNS y alias A/AAAA hacia CloudFront |
| `cloudfront.tf` | Una distribución: sin caché por defecto, caché de assets versionados por host, secreto de origen |
| `network.tf` | Grupo de seguridad: **solo** la lista administrada de CloudFront al puerto 80 (sin 22 ni 443) |
| `ec2.tf` + `user-data.sh.tftpl` | EC2 Ubuntu 22.04 (IMDSv2, salto 2, disco cifrado), IP elástica, Docker, Tailscale, repo de infra |
| `dynamodb.tf` | Las 4 tablas, leyendo los mismos JSON y el TTL de `dynamodb/` |
| `iam.tf` | Rol del EC2 para DynamoDB y usuario IAM mínimo de wallet (`wallet-service#*`) |
| `destroy.sh` | Borrado total y comprobación posterior por etiqueta `Project=bandadau` |

Todos los recursos llevan las etiquetas `Project=bandadau`, `ManagedBy=terraform`, `Stack=demo`.

## Antes de empezar

- AWS CLI con credenciales de la cuenta correcta (`aws sts get-caller-identity`) y Terraform ≥ 1.6.
- `cp terraform.tfvars.example terraform.tfvars` (valores por defecto válidos). Opcional: una llave de Tailscale en `tailscale_auth_key`.
- El **estado** de Terraform es local (`terraform.tfstate`, fuera de git) y contiene secretos (llave IAM de wallet, secreto de origen).
  Guárdalo; quien lo pierda tendrá que borrar a mano (ver «Si se pierde el estado»).

## Etapa 1: la zona DNS (una vez)

```bash
cd bandadau-infra/terraform/aws
terraform init
terraform apply -target=aws_route53_zone.main
terraform output nameservers
```

En **Namecheap**: *Domain List → bandadau.lat → Manage → Nameservers → Custom DNS* y pega los **4 nameservers**.
Espera a que propague (minutos a pocas horas): `dig NS bandadau.lat +short` debe mostrar los de AWS.
El certificado de la etapa 2 no se valida hasta entonces.

## Etapa 2: todo lo demás

```bash
make aws-plan      # revisa qué se va a crear
make aws-apply     # ~15-20 min: ACM, CloudFront (la parte lenta), EC2, DynamoDB, IAM
terraform output   # IP elástica, ID de instancia, dominio de CloudFront
```

Si `aws_acm_certificate_validation` agota el tiempo, los nameservers aún no apuntan a Route 53: revisa la etapa 1 y repite `make aws-apply`.

## Etapa 3: desplegar la aplicación

1. El EC2 ya tiene Docker, Tailscale y el repo en `/opt/bandada/bandadau-infra` (log: `/var/log/bandada-bootstrap.log`). Si no pasaste llave de Tailscale: consola de EC2 → `sudo tailscale up --ssh --hostname bandada-aws`.
2. En `deploy/.env.aws`: `BASE_DOMAIN=bandadau.lat` y `ORIGIN_VERIFY=$(terraform output -raw origin_verify_secret)`.
3. En `deploy/.env.gcp`: la llave de wallet (`terraform output wallet_access_key_id` y `-raw wallet_secret_access_key`).
4. Sigue `bandadau-docs/docs/05-infraestructura/guia-despliegue.md` (Azure, GCP, imágenes y `deploy/deploy.sh`). **Las tablas de DynamoDB, el EC2 y el DNS ya los creó Terraform:** omite sus pasos manuales.

## Después de la presentación: borrar todo

```bash
make aws-destroy-preview   # qué se borrará (no borra)
make aws-destroy           # borra y pide escribir «bandadau»; ~15-20 min por CloudFront
make aws-check             # confirma que no queda nada con Project=bandadau
```

`destroy.sh` termina con los pasos que **no** son de AWS: volver a *Namecheap BasicDNS*, borrar las VMs de Azure y GCP y revocar Tailscale.

### Si se pierde el estado

`make aws-check` lista por etiqueta lo que sigue vivo. Bórralo en este orden: distribución de CloudFront (deshabilitar, esperar, eliminar) → EC2 → IP elástica → tablas DynamoDB → usuario IAM `bandada-wallet-service` y rol `bandada-ec2` → zona de Route 53 → certificado ACM.

## Costos orientativos (24/7, precios de lista; verifica en la calculadora de AWS)

`t3.xlarge` ≈ USD 0.17/h (≈ 4 USD/día) · disco 60 GB ≈ 5 USD/mes · IP pública ≈ 3.7 USD/mes · Route 53 0.50 USD/mes · DynamoDB y CloudFront dentro de la capa gratuita para una demo · ACM gratis.
Para ahorrar: `instance_type = "t3.large"` (8 GB, justo) y detener el EC2 fuera de horario (la IP elástica se cobra igual).

## Qué NO está verificado

Solo se ejecutó `terraform validate`: **no se ha hecho `plan` ni `apply`**, así que nada de esto corrió contra AWS todavía.
Puntos a vigilar en la primera ejecución: la validación del certificado tras delegar el DNS; que el origen `ec2-x-x-x-x.compute-1.amazonaws.com` resuelva y CloudFront lo acepte;
que la función de CloudFront y la clave de caché por `x-viewer-host` funcionen (si dan problemas, `enable_static_cache = false` deja todo sin caché);
que el WebSocket/SSE del MCP y las subidas prefirmadas a `s3.bandadau.lat` atraviesen CloudFront; y el arranque del `user-data`.
