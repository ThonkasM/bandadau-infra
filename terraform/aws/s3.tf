# ---- Almacenamiento masivo: S3 REAL (reemplaza a MinIO en producción) -----------------------------------------------
# Media de usuarios (media-service), modelos ONNX de moderación y audios de reportes (insights-service). Privados: el
# acceso del navegador/app es por URL prefirmada. Una llave de servicio (usuario IAM) limitada a estos tres buckets.
locals {
  s3_buckets = {
    media   = "bandada-media-${data.aws_caller_identity.current.account_id}"
    models  = "bandada-models-${data.aws_caller_identity.current.account_id}"
    reports = "bandada-reports-${data.aws_caller_identity.current.account_id}"
  }
  s3_cors_origins = ["https://app.${var.domain}", "https://admin.${var.domain}", "https://${var.domain}", "https://mfe.${var.domain}"]
}

resource "aws_s3_bucket" "this" {
  for_each      = local.s3_buckets
  bucket        = each.value
  force_destroy = true # demo: `terraform destroy` debe poder vaciarlos
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# El navegador sube (PUT) y descarga (GET) directo con URL prefirmada: CORS solo para los orígenes de la plataforma.
resource "aws_s3_bucket_cors_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = local.s3_cors_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_iam_user" "s3" {
  name          = "bandada-s3-storage"
  force_destroy = true
}

data "aws_iam_policy_document" "s3" {
  statement {
    sid       = "ObjetosBandada"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = [for b in aws_s3_bucket.this : "${b.arn}/*"]
  }
  statement {
    sid       = "ListarBandada"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [for b in aws_s3_bucket.this : b.arn]
  }
}

resource "aws_iam_user_policy" "s3" {
  name   = "bandada-s3-storage"
  user   = aws_iam_user.s3.name
  policy = data.aws_iam_policy_document.s3.json
}

resource "aws_iam_access_key" "s3" {
  user = aws_iam_user.s3.name
}

output "s3_bucket_media" {
  value = aws_s3_bucket.this["media"].bucket
}

output "s3_bucket_models" {
  value = aws_s3_bucket.this["models"].bucket
}

output "s3_bucket_reports" {
  value = aws_s3_bucket.this["reports"].bucket
}

output "s3_access_key_id" {
  value = aws_iam_access_key.s3.id
}

output "s3_secret_access_key" {
  description = "terraform output -raw s3_secret_access_key"
  value       = aws_iam_access_key.s3.secret
  sensitive   = true
}
