#!/usr/bin/env bash
# Job one-shot (imagen de MinIO, trae `mc`): buckets, usuarios por servicio y políticas. Idempotente.
set -euo pipefail

ALIAS=local
for i in $(seq 1 60); do
  mc alias set "$ALIAS" "${MINIO_ENDPOINT:-http://minio:9000}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && break
  echo "esperando a MinIO ($i)…"; sleep 2
done

for b in bandada-media bandada-reports bandada-models bandada-public; do
  mc mb --ignore-existing "$ALIAS/$b" >/dev/null
  echo "minio: bucket $b"
done
# bandada-public: lectura anónima (solo local; en AWS va detrás de CloudFront). Los demás son privados.
mc anonymous set download "$ALIAS/bandada-public" >/dev/null

policy() { # nombre archivo
  mc admin policy create "$ALIAS" "$1" "$2" >/dev/null 2>&1 || mc admin policy add "$ALIAS" "$1" "$2" >/dev/null
}
attach() { # nombre usuario
  mc admin policy attach "$ALIAS" "$1" --user "$2" >/dev/null 2>&1 || mc admin policy set "$ALIAS" "$1" "user=$2" >/dev/null 2>&1 || true
}

cat > /tmp/media-svc.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload"], "Resource": ["arn:aws:s3:::bandada-media/*"] },
  { "Effect": "Allow", "Action": ["s3:ListBucket","s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::bandada-media"] },
  { "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": ["arn:aws:s3:::bandada-models/*"] },
  { "Effect": "Allow", "Action": ["s3:ListBucket","s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::bandada-models"] }
] }
JSON
cat > /tmp/insights-svc.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"], "Resource": ["arn:aws:s3:::bandada-reports/*"] },
  { "Effect": "Allow", "Action": ["s3:ListBucket","s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::bandada-reports"] },
  { "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": ["arn:aws:s3:::bandada-models/*"] },
  { "Effect": "Allow", "Action": ["s3:ListBucket","s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::bandada-models"] }
] }
JSON
policy media-svc-policy /tmp/media-svc.json
policy insights-svc-policy /tmp/insights-svc.json

# `mc admin user add` es idempotente (si existe, actualiza la contraseña).
mc admin user add "$ALIAS" "$MEDIA_S3_ACCESS_KEY" "$MEDIA_S3_SECRET_KEY" >/dev/null
mc admin user add "$ALIAS" "$INSIGHTS_S3_ACCESS_KEY" "$INSIGHTS_S3_SECRET_KEY" >/dev/null
attach media-svc-policy "$MEDIA_S3_ACCESS_KEY"
attach insights-svc-policy "$INSIGHTS_S3_ACCESS_KEY"

echo "minio: buckets, usuarios y políticas listos"
