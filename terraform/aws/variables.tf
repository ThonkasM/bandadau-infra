variable "aws_region" {
  description = "Región única de la pila. CloudFront exige el certificado ACM en us-east-1, por eso es la única admitida."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "La pila usa una sola región y el certificado de CloudFront debe estar en us-east-1."
  }
}

variable "domain" {
  description = "Dominio raíz (comprado en Namecheap). Se delega a Route 53."
  type        = string
  default     = "bandadau.lat"
}

variable "instance_type" {
  description = "Tipo de EC2 (Postgres, Mongo, RabbitMQ, MinIO, n8n y 7 servicios). t3.large = 8 GB; t3.xlarge = 16 GB."
  type        = string
  default     = "t3.xlarge"
}

variable "root_volume_gb" {
  description = "Tamaño del disco raíz (gp3, cifrado)."
  type        = number
  default     = 60
}

variable "tailscale_auth_key" {
  description = "Llave de autenticación de Tailscale (reutilizable o de un solo uso). Si queda vacía, instalas Tailscale a mano."
  type        = string
  default     = ""
  sensitive   = true
}

variable "infra_repo_url" {
  description = "Repositorio de bandadau-infra que se clona en /opt/bandada (deploy.sh hace git pull ahí)."
  type        = string
  default     = "https://github.com/ThonkasM/bandadau-infra.git"
}

variable "enable_static_cache" {
  description = "Cachea en CloudFront las rutas de assets versionados (/_next/static, /_expo/static, /assets). Ver README: no verificado."
  type        = bool
  default     = true
}
