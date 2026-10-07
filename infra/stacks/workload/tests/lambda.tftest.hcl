# Every API Lambda's shape (modules/lambda-function): runtime, logs, role, and policy. No AWS
# access: the providers are mocked, and every run only plans.

mock_provider "aws" {
  # The provider checks that ARN arguments parse as ARNs, which the mock's random strings don't.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/cv-tailor/workload/mock" }
  }
}
mock_provider "archive" {}

run "function" {
  command = plan

  module {
    source = "../../modules/lambda-function"
  }

  variables {
    name        = "cv-tailor-dev-me"
    description = "GET /me"
    source_dir  = "tests/fixtures/bundles/me"
    timeout     = 10
    environment = { TABLE_NAME = "cv-tailor-dev-data" }
    policy_statements = [
      { actions = ["dynamodb:GetItem"], resources = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"] },
    ]
    region                   = "us-east-1"
    account_id               = "111111111111"
    role_path                = "/cv-tailor/workload/"
    permissions_boundary_arn = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
  }

  assert {
    condition = (
      aws_lambda_function.this.runtime == "nodejs24.x"
      && aws_lambda_function.this.architectures == tolist(["arm64"])
      && aws_lambda_function.this.handler == "index.handler"
      && aws_lambda_function.this.memory_size == 512
      && aws_lambda_function.this.timeout == 10
    )
    error_message = "Every API Lambda runs index.handler on Node.js 24, arm64, with 512 MB."
  }

  assert {
    condition     = aws_lambda_function.this.reserved_concurrent_executions == null
    error_message = "No reserved concurrency: a new account's limit can be too low, and the pre sign-up trigger invokes itself."
  }

  assert {
    condition     = aws_lambda_function.this.environment[0].variables == tomap({ TABLE_NAME = "cv-tailor-dev-data" })
    error_message = "The function gets exactly the environment it's given."
  }

  assert {
    condition     = aws_cloudwatch_log_group.this.name == "/aws/lambda/cv-tailor-dev-me" && aws_cloudwatch_log_group.this.retention_in_days == 30
    error_message = "Each function keeps its log for one month."
  }

  assert {
    condition     = aws_lambda_function.this.logging_config[0].log_group == "/aws/lambda/cv-tailor-dev-me"
    error_message = "The function writes to its own log group."
  }

  assert {
    condition = (
      aws_iam_role.this.path == "/cv-tailor/workload/"
      && aws_iam_role.this.permissions_boundary == "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
    )
    error_message = "The role must be under the workload path and carry the boundary, or the deploy role can't create it."
  }

  assert {
    condition     = jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Principal == { Service = "lambda.amazonaws.com" }
    error_message = "Only Lambda may assume the role."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.this.policy).Statement == [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/cv-tailor-dev-me:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"]
      },
    ]
    error_message = "The policy is its own log group plus exactly the statements given."
  }
}

run "refuses_a_name_the_deploy_role_cannot_manage" {
  command = plan

  module {
    source = "../../modules/lambda-function"
  }

  variables {
    name                     = "me"
    description              = "GET /me"
    source_dir               = "tests/fixtures/bundles/me"
    timeout                  = 10
    region                   = "us-east-1"
    account_id               = "111111111111"
    role_path                = "/cv-tailor/workload/"
    permissions_boundary_arn = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
  }

  expect_failures = [var.name]
}
