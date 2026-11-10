data "aws_caller_identity" "current" {}

locals {
  table_arns = [for t in aws_dynamodb_table.this : t.arn]
  table_and_index_arns = flatten([
    for t in aws_dynamodb_table.this : [t.arn, "${t.arn}/index/*"]
  ])
}

# ---- Rol de la instancia: los contenedores del EC2 leen DynamoDB con él (IMDS, salto 2) ----------------------
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "bandada-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "ec2_dynamodb" {
  statement {
    sid = "DynamoDBBandada"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:ConditionCheckItem", "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem",
      "dynamodb:DescribeTable",
    ]
    resources = local.table_and_index_arns
  }

  # Lecturas administrativas de ticketing (estadísticas y reporte de asistencia): un Scan acotado y de baja frecuencia,
  # solo sobre la tabla de tickets.
  statement {
    sid       = "DynamoDBTicketingScan"
    actions   = ["dynamodb:Scan"]
    resources = [aws_dynamodb_table.this["ticketing"].arn]
  }
}

resource "aws_iam_role_policy" "ec2_dynamodb" {
  name   = "bandada-dynamodb"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_dynamodb.json
}

# Acceso de emergencia sin puertos: Session Manager (el agente SSM viene en la AMI de Ubuntu y sale por HTTPS).
# Sirve para entrar si no hay llave de Tailscale y para comprobar el arranque con `aws ssm send-command`.
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "bandada-ec2"
  role = aws_iam_role.ec2.name
}

# ---- Usuario de wallet (GCP): la única llave de AWS que sale del EC2 ---------------------------------------------
# Solo la tabla de idempotencia y solo claves que empiezan con wallet-service# (ADR-0025 punto 4).
resource "aws_iam_user" "wallet" {
  name          = "bandada-wallet-service"
  force_destroy = true
}

data "aws_iam_policy_document" "wallet" {
  statement {
    sid = "WalletIdempotencia"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:ConditionCheckItem", "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.this["idempotency"].arn]
    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["wallet-service#*"]
    }
  }

  # El healthcheck de wallet-service hace DescribeTable; esa acción no admite la condición LeadingKeys.
  statement {
    sid       = "WalletHealthDescribe"
    actions   = ["dynamodb:DescribeTable"]
    resources = [aws_dynamodb_table.this["idempotency"].arn]
  }
}

resource "aws_iam_user_policy" "wallet" {
  name   = "bandada-wallet-idempotency"
  user   = aws_iam_user.wallet.name
  policy = data.aws_iam_policy_document.wallet.json
}

resource "aws_iam_access_key" "wallet" {
  user = aws_iam_user.wallet.name
}
