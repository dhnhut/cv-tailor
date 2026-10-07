# One API Lambda (S2-07, S2-09, S3-07): Node.js 24 on arm64, a prebuilt bundle from apps/api/dist
# (built before AWS credentials exist), a one-month log, and its own role with only the calls its
# code makes. The role lives under the workload path and carries the permissions boundary, as the
# deploy role requires (ADR-0013 §5). No reserved concurrency: a new account's limit can be too low.

locals {
  log_group = "/aws/lambda/${var.name}"
  # Built from names, so a plan shows the policy in full.
  log_group_arn = "arn:aws:logs:${var.region}:${var.account_id}:log-group:${local.log_group}"
}

resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group
  retention_in_days = 30
}

resource "aws_iam_role" "this" {
  name                 = var.name
  path                 = var.role_path
  permissions_boundary = var.permissions_boundary_arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Writing to its own log group, plus the calls its code makes. Not AWSLambdaBasicExecutionRole,
# which allows every log group in the account.
resource "aws_iam_role_policy" "this" {
  name = "Calls"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.log_group_arn}:*"
      }],
      [
        for statement in var.policy_statements : merge(
          { Effect = "Allow", Action = statement.actions, Resource = statement.resources },
          length(statement.conditions) > 0 ? { Condition = statement.conditions } : {},
        )
      ],
    )
  })
}

data "archive_file" "bundle" {
  type             = "zip"
  source_dir       = var.source_dir
  output_path      = "${path.module}/.build/${var.name}.zip" # gitignored
  output_file_mode = "0644"                                  # the same zip on every machine
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  description   = var.description
  role          = aws_iam_role.this.arn
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  timeout       = var.timeout
  memory_size   = 512 # more memory gives more CPU, so a shorter cold start; the cost is negligible

  filename = data.archive_file.bundle.output_path
  # From the files, not the zip, so the hash depends only on the code.
  source_code_hash = base64sha256(join("", [for file in sort(fileset(var.source_dir, "**")) : filesha256("${var.source_dir}/${file}")]))

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.this.name
  }

  dynamic "environment" {
    for_each = length(var.environment) > 0 ? [var.environment] : []

    content {
      variables = environment.value
    }
  }
}
