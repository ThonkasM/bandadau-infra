# VPC por defecto: la demo no necesita red propia y así no hay NAT ni subredes que borrar.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Rangos desde los que CloudFront contacta al origen (lista administrada por AWS).
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin_facing"
}

resource "aws_security_group" "ec2" {
  name        = "bandada-ec2"
  description = "Bandada U: solo CloudFront entra por el 80. Sin 22 (SSH por Tailscale) ni 443."
  vpc_id      = data.aws_vpc.default.id

  # La lista administrada de CloudFront cuenta como ~55 reglas del límite (60 por grupo):
  # por eso este grupo no puede tener otras reglas de entrada.
  ingress {
    description     = "HTTP desde CloudFront (origen)"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "Salida libre (GHCR, Tailscale, apt, DynamoDB)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "bandada-ec2" }
}
