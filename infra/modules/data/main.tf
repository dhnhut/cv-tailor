# The data table for one environment (S2-08, ADR-0006). It holds user data, so it has PITR,
# deletion protection, and prevent_destroy. Other modules find it by its fixed name.
#
# A plain table, not CloudFormation's AWS::DynamoDB::GlobalTable: the reason for that type was
# CloudFormation's (it can't turn a Table into a GlobalTable in place). OpenTofu adds a replica
# region to an existing table in place, so a second region stays possible (ADR-0006, S3-15).
resource "aws_dynamodb_table" "this" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST" # no cost at zero traffic

  # Generic names: the values carry the meaning (apps/api/src/data/keys.ts).
  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # Only items that should expire carry it (quota counters, jobs).
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}
