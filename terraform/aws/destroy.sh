#!/usr/bin/env bash
# Borra TODA la infraestructura de Bandada U en AWS (EC2, IP elástica, DynamoDB, IAM, CloudFront, ACM, Route 53)
# y luego comprueba que no quede nada etiquetado Project=bandadau.
#
#   terraform/aws/destroy.sh            # muestra qué se borraría (terraform plan -destroy) y NO borra
#   terraform/aws/destroy.sh --yes      # borra, tras pedir que escribas el nombre del proyecto
#   terraform/aws/destroy.sh --check    # solo busca recursos etiquetados Project=bandadau (sin borrar)
#
# Notas:
#   - CloudFront se deshabilita y se elimina: tarda ~15-20 minutos. Es normal.
#   - Los datos (Postgres, Mongo, MinIO, tablas) se pierden. Haz copias ANTES si las necesitas.
#   - Azure y GCP NO se tocan: borra sus VMs aparte (az group delete -n bandada-rg · gcloud compute instances delete bandada-gcp).
#   - Después, en Namecheap vuelve a "Namecheap BasicDNS" (Domain > Nameservers): la zona de Route 53 ya no existe.
set -euo pipefail
cd "$(dirname "$0")"
export AWS_PAGER=""
REGION="${AWS_REGION:-us-east-1}"
MODE="plan"
for a in "$@"; do
  case "$a" in
    --yes) MODE="destroy" ;;
    --check) MODE="check" ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "opción desconocida: $a" >&2; exit 2 ;;
  esac
done

command -v aws >/dev/null || { echo "falta aws CLI" >&2; exit 1; }
command -v terraform >/dev/null || { echo "falta terraform" >&2; exit 1; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Cuenta de AWS: $ACCOUNT · región: $REGION"

# Recursos etiquetados Project=bandadau (la API de etiquetas cubre también CloudFront y Route 53 en us-east-1)
leftovers() {
  aws resourcegroupstaggingapi get-resources --region us-east-1 \
    --tag-filters Key=Project,Values=bandadau \
    --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | sed '/^$/d'
}

check() {
  echo "Buscando recursos con la etiqueta Project=bandadau…"
  local list; list="$(leftovers || true)"
  if [[ -z "$list" ]]; then
    echo "OK: no queda ningún recurso etiquetado Project=bandadau."
    return 0
  fi
  echo "QUEDAN estos recursos (bórralos a mano en la consola o con la CLI):"
  echo "$list" | sed 's/^/  - /'
  # Costos que se escapan con más facilidad
  echo "$list" | grep -q ':elastic-ip/' && echo "  ! Hay IP elástica sin liberar: se cobra aunque no tenga instancia."
  return 1
}

if [[ "$MODE" == "check" ]]; then check; exit $?; fi

[[ -d .terraform ]] || terraform init -input=false >/dev/null

if [[ "$MODE" == "plan" ]]; then
  terraform plan -destroy -input=false
  echo
  echo "Esto fue solo una vista previa. Para borrar de verdad: $0 --yes"
  exit 0
fi

echo
echo "⚠  Se BORRARÁ toda la infraestructura de Bandada U en la cuenta $ACCOUNT (datos incluidos)."
read -r -p "Escribe 'bandadau' para confirmar: " ok
[[ "$ok" == "bandadau" ]] || { echo "Cancelado."; exit 1; }

terraform destroy -input=false -auto-approve
echo
check || { echo "El borrado terminó pero quedan recursos (ver arriba)."; exit 1; }
cat <<'MSG'

Listo. Pendiente fuera de AWS:
  1. Namecheap > Domain List > bandadau.lat > Nameservers > "Namecheap BasicDNS" (la zona de Route 53 ya no existe).
  2. Borra las VMs de Azure y GCP si ya no las necesitas.
  3. Revoca la llave de Tailscale y quita los nodos bandada-* de la consola de Tailscale.
MSG
