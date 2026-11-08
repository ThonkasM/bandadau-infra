terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5, < 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Todo recurso que admite etiquetas lleva Project=bandadau: es lo que usa destroy.sh para
  # comprobar que no quedó nada tras borrar la pila.
  default_tags {
    tags = {
      Project   = "bandadau"
      ManagedBy = "terraform"
      Stack     = "demo"
    }
  }
}
