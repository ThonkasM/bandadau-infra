# Las 4 tablas salen de los mismos JSON que usa dynamodb/create-tables.sh (fuente única de verdad)
# y el TTL de dynamodb/ttl.txt.
locals {
  tables = {
    for f in fileset("${path.module}/../../dynamodb/tables", "*.json") :
    trimsuffix(f, ".json") => jsondecode(file("${path.module}/../../dynamodb/tables/${f}"))
  }

  ttl_attributes = {
    for line in split("\n", file("${path.module}/../../dynamodb/ttl.txt")) :
    split(" ", trimspace(replace(line, "/\\s+/", " ")))[0] => split(" ", trimspace(replace(line, "/\\s+/", " ")))[1]
    if length(trimspace(line)) > 0 && !startswith(trimspace(line), "#")
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.tables

  name         = each.value.TableName
  billing_mode = each.value.BillingMode

  hash_key  = [for k in each.value.KeySchema : k.AttributeName if k.KeyType == "HASH"][0]
  range_key = try([for k in each.value.KeySchema : k.AttributeName if k.KeyType == "RANGE"][0], null)

  dynamic "attribute" {
    for_each = each.value.AttributeDefinitions
    content {
      name = attribute.value.AttributeName
      type = attribute.value.AttributeType
    }
  }

  dynamic "global_secondary_index" {
    for_each = try(each.value.GlobalSecondaryIndexes, [])
    content {
      name            = global_secondary_index.value.IndexName
      hash_key        = [for k in global_secondary_index.value.KeySchema : k.AttributeName if k.KeyType == "HASH"][0]
      range_key       = try([for k in global_secondary_index.value.KeySchema : k.AttributeName if k.KeyType == "RANGE"][0], null)
      projection_type = global_secondary_index.value.Projection.ProjectionType
    }
  }

  dynamic "ttl" {
    for_each = contains(keys(local.ttl_attributes), each.value.TableName) ? [local.ttl_attributes[each.value.TableName]] : []
    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  # Sin protección: la demo se borra por completo después de la presentación.
  deletion_protection_enabled = false
}
