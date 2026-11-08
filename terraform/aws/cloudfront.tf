# Un solo CloudFront delante de todo (ADR-0026): bandadau.lat y *.bandadau.lat -> EC2 (Traefik).
# - Viewer: HTTPS obligatorio con el certificado de ACM.
# - Origen: HTTP al puerto 80 del EC2 (el grupo de seguridad solo admite la lista de CloudFront y Traefik
#   exige la cabecera secreta X-Origin-Verify).
# - Se reenvía la cabecera Host original (AllViewer): Traefik y nginx enrutan por host como en local.

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# Para los assets versionados el host debe formar parte de la clave de caché: app.*, admin.* y el
# dominio raíz sirven archivos distintos con la misma ruta. Una función de CloudFront copia Host a
# x-viewer-host y la política de caché usa esa cabecera como clave.
resource "aws_cloudfront_function" "viewer_host" {
  name    = "bandada-viewer-host"
  runtime = "cloudfront-js-2.0"
  comment = "Copia Host a x-viewer-host para la clave de caché"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      request.headers['x-viewer-host'] = { value: request.headers.host.value };
      return request;
    }
  JS
}

resource "aws_cloudfront_cache_policy" "static_by_host" {
  name        = "bandada-static-by-host"
  comment     = "Assets versionados; clave = ruta + x-viewer-host. Respeta Cache-Control del origen."
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["x-viewer-host"]
      }
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

locals {
  static_paths = var.enable_static_cache ? ["/_next/static/*", "/_expo/static/*", "/assets/*"] : []
}

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_100" # EE. UU., Canadá y Europa: el más barato
  comment         = "Bandada U (demo)"
  aliases         = [var.domain, "*.${var.domain}"]

  origin {
    origin_id   = "ec2"
    domain_name = local.origin_domain

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60 # máximo sin pedir aumento de cuota; cubre la SAGA y el agente de reportes
      origin_keepalive_timeout = 60
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # Por defecto TODO pasa sin caché (API, HTML, manifiestos, cookies y Authorization incluidos)
  default_cache_behavior {
    target_origin_id         = "ec2"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.static_paths
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "ec2"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = aws_cloudfront_cache_policy.static_by_host.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
      compress                 = true

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer_host.arn
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Borrar la distribución deshabilita primero y espera (~15 min): terraform destroy lo gestiona.
  retain_on_delete    = false
  wait_for_deployment = true
}
