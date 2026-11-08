output "nameservers" {
  description = "Pon ESTOS 4 nameservers en Namecheap (Domain > Nameservers > Custom DNS)."
  value       = local.name_servers
}

output "elastic_ip" {
  description = "IP pública del EC2 (solo el origen de CloudFront debe llegar al 80)."
  value       = aws_eip.main.public_ip
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_id" {
  value = aws_cloudfront_distribution.main.id
}

output "ec2_instance_id" {
  value = aws_instance.main.id
}

output "origin_verify_secret" {
  description = "Va en deploy/.env.aws como ORIGIN_VERIFY (Traefik la exige). terraform output -raw origin_verify_secret"
  value       = random_password.origin_verify.result
  sensitive   = true
}

output "wallet_access_key_id" {
  description = "Llave del usuario IAM de wallet (va en deploy/.env.gcp)."
  value       = aws_iam_access_key.wallet.id
}

output "wallet_secret_access_key" {
  description = "terraform output -raw wallet_secret_access_key"
  value       = aws_iam_access_key.wallet.secret
  sensitive   = true
}

output "dynamodb_tables" {
  value = [for t in aws_dynamodb_table.this : t.name]
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
