# Zona pública de Route 53: o la que ya existe (route53_zone_id) o una nueva. Los nameservers de Namecheap deben
# apuntar a los de `terraform output nameservers` (ver README, etapa 1).
resource "aws_route53_zone" "main" {
  count = var.route53_zone_id == "" ? 1 : 0

  name          = var.domain
  comment       = "Bandada U (demo). Se borra con terraform destroy."
  force_destroy = true
}

# Zona ya existente (creada a mano): Terraform solo añade y quita registros en ella
data "aws_route53_zone" "existing" {
  count   = var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
}

locals {
  zone_id      = var.route53_zone_id == "" ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
  name_servers = var.route53_zone_id == "" ? aws_route53_zone.main[0].name_servers : data.aws_route53_zone.existing[0].name_servers
}

# Certificado para la raíz y todos los subdominios (app, api, admin, mfe, s3, n8n, mail, rabbit, minio)
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.main.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }

  zone_id         = local.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true # la raíz y el comodín comparten el mismo CNAME de validación
}

# Falla (tras ~75 min) si los nameservers de Namecheap todavía no apuntan a Route 53.
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# Raíz y comodín hacia CloudFront (IPv4 e IPv6). Z2FDTNDATAQYW2 es la zona fija de CloudFront.
locals {
  alias_names = {
    root     = var.domain
    wildcard = "*.${var.domain}"
  }
  alias_records = {
    for pair in setproduct(keys(local.alias_names), ["A", "AAAA"]) :
    "${pair[0]}-${pair[1]}" => { name = local.alias_names[pair[0]], type = pair[1] }
  }
}

resource "aws_route53_record" "site" {
  for_each = local.alias_records

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}
