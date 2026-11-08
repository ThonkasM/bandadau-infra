# Ubuntu 22.04 x86_64 (las imágenes de GHCR se construyen para linux/amd64)
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "main" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # Los contenedores alcanzan el rol de la instancia solo con salto 2 (ADR-0025 punto 4).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    tailscale_auth_key = var.tailscale_auth_key
    infra_repo_url     = var.infra_repo_url
  })
  user_data_replace_on_change = false

  tags = { Name = "bandada-aws" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "main" {
  domain = "vpc"
  tags   = { Name = "bandada-aws" }
}

resource "aws_eip_association" "main" {
  instance_id   = aws_instance.main.id
  allocation_id = aws_eip.main.id
}

locals {
  # CloudFront necesita un nombre DNS como origen (no una IP). El nombre ec2-x-x-x-x resuelve a la IP elástica.
  origin_domain = format(
    "ec2-%s.%s.amazonaws.com",
    replace(aws_eip.main.public_ip, ".", "-"),
    var.aws_region == "us-east-1" ? "compute-1" : "${var.aws_region}.compute"
  )
}
