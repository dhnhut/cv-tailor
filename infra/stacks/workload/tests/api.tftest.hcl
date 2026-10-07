# The API (S2-09, S3-07, ADR-0009 §6). No AWS access: the providers are mocked.

mock_provider "aws" {
  # The provider checks that ARN arguments parse as ARNs, which the mock's random strings don't.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/cv-tailor/workload/mock" }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:111111111111:function:cv-tailor-dev-mock"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:cv-tailor-dev-mock/invocations"
    }
  }

  mock_resource "aws_api_gateway_rest_api" {
    defaults = { execution_arn = "arn:aws:execute-api:us-east-1:111111111111:mockapi" }
  }
}
mock_provider "archive" {}

variables {
  host                     = "dev.cv.ikiwii.com"
  name_prefix              = "cv-tailor-dev"
  web_origin               = "https://dev.cv.ikiwii.com"
  table_name               = "cv-tailor-dev-data"
  documents_bucket_name    = "cv-tailor-dev-documents-111111111111"
  documents_key_prefix     = "kb/"
  user_pool_arn            = "arn:aws:cognito-idp:us-east-1:111111111111:userpool/us-east-1_test"
  api_scope                = "cv-tailor-api/user"
  dist_dir                 = "tests/fixtures/bundles"
  zone_id                  = "Z0000000000000"
  certificate_arn          = "arn:aws:acm:us-east-1:111111111111:certificate/test"
  region                   = "us-east-1"
  account_id               = "111111111111"
  role_path                = "/cv-tailor/workload/"
  permissions_boundary_arn = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
}

run "api" {
  command = plan

  module {
    source = "../../modules/api"
  }

  assert {
    condition = (
      aws_api_gateway_rest_api.this.disable_execute_api_endpoint
      && aws_api_gateway_rest_api.this.endpoint_configuration[0].types == tolist(["REGIONAL"])
      && aws_api_gateway_domain_name.this.domain_name == "api.dev.cv.ikiwii.com"
      && aws_api_gateway_domain_name.this.security_policy == "TLS_1_2"
      && aws_api_gateway_domain_name.this.regional_certificate_arn == "arn:aws:acm:us-east-1:111111111111:certificate/test"
    )
    error_message = "A regional REST API, reachable only at api.<host>, over TLS 1.2."
  }

  assert {
    condition = (
      aws_api_gateway_authorizer.cognito.type == "COGNITO_USER_POOLS"
      && aws_api_gateway_authorizer.cognito.provider_arns == toset(["arn:aws:cognito-idp:us-east-1:111111111111:userpool/us-east-1_test"])
    )
    error_message = "Tokens are checked against the user pool."
  }

  assert {
    condition = { for key, m in aws_api_gateway_method.route : key => [m.http_method, m.authorization, m.authorization_scopes] } == {
      "GET /me"                = ["GET", "COGNITO_USER_POOLS", toset(["cv-tailor-api/user"])]
      "GET /documents"         = ["GET", "COGNITO_USER_POOLS", toset(["cv-tailor-api/user"])]
      "POST /documents"        = ["POST", "COGNITO_USER_POOLS", toset(["cv-tailor-api/user"])]
      "DELETE /documents/{id}" = ["DELETE", "COGNITO_USER_POOLS", toset(["cv-tailor-api/user"])]
    }
    error_message = "Every route needs an access token with the API scope."
  }

  assert {
    condition     = alltrue([for i in aws_api_gateway_integration.route : i.type == "AWS_PROXY" && i.integration_http_method == "POST"])
    error_message = "Every route is a Lambda proxy integration."
  }

  assert {
    condition     = { for key, m in aws_api_gateway_method.preflight : key => [m.http_method, m.authorization] } == { "/me" = ["OPTIONS", "NONE"], "/documents" = ["OPTIONS", "NONE"], "/documents/{id}" = ["OPTIONS", "NONE"] }
    error_message = "Each path has an open preflight, as browsers require."
  }

  assert {
    condition = alltrue([for r in aws_api_gateway_integration_response.preflight : r.response_parameters == tomap({
      "method.response.header.Access-Control-Allow-Origin"  = "'https://dev.cv.ikiwii.com'"
      "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE'"
      "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
      "method.response.header.Access-Control-Max-Age"       = "'3600'"
    })])
    error_message = "Preflight allows only the web origin, the methods in use, and two headers."
  }

  assert {
    condition = (
      keys(aws_api_gateway_gateway_response.cors) == ["DEFAULT_4XX", "DEFAULT_5XX", "UNAUTHORIZED"]
      && alltrue([for r in aws_api_gateway_gateway_response.cors : r.response_parameters == tomap({ "gatewayresponse.header.Access-Control-Allow-Origin" = "'https://dev.cv.ikiwii.com'" })])
    )
    error_message = "API Gateway's own errors carry the CORS header, or the browser hides them."
  }

  assert {
    condition = (
      aws_api_gateway_stage.live.stage_name == "live"
      && aws_api_gateway_method_settings.throttle.method_path == "*/*"
      && aws_api_gateway_method_settings.throttle.settings[0].throttling_rate_limit == 5
      && aws_api_gateway_method_settings.throttle.settings[0].throttling_burst_limit == 10
    )
    error_message = "Every method on the live stage is throttled at 5 requests a second, with a burst of 10."
  }

  assert {
    condition     = aws_route53_record.alias.name == "api.dev.cv.ikiwii.com" && aws_route53_record.alias.type == "A"
    error_message = "api.<host> points at the API's domain."
  }

  # Exact match, for each Lambda: a new action or resource needs a decision. Each function gets
  # only the calls its own code makes (S3-07). The first statement is its own log group.
  assert {
    condition = { for name, policy in output.function_policies : name => slice(jsondecode(policy).Statement, 1, length(jsondecode(policy).Statement)) } == {
      me = [
        { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem"], Resource = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"] },
      ]
      create-document = [
        { Effect = "Allow", Action = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"], Resource = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"] },
        { Effect = "Allow", Action = ["s3:DeleteObject", "s3:PutObject"], Resource = ["arn:aws:s3:::cv-tailor-dev-documents-111111111111/kb/*"] },
        { Effect = "Allow", Action = ["s3:ListBucket"], Resource = ["arn:aws:s3:::cv-tailor-dev-documents-111111111111"], Condition = { StringLike = { "s3:prefix" = ["kb/*"] } } },
      ]
      list-documents = [
        { Effect = "Allow", Action = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"], Resource = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"] },
        { Effect = "Allow", Action = ["s3:DeleteObject"], Resource = ["arn:aws:s3:::cv-tailor-dev-documents-111111111111/kb/*"] },
        { Effect = "Allow", Action = ["s3:ListBucket"], Resource = ["arn:aws:s3:::cv-tailor-dev-documents-111111111111"], Condition = { StringLike = { "s3:prefix" = ["kb/*"] } } },
      ]
      delete-document = [
        { Effect = "Allow", Action = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = ["arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data"] },
        { Effect = "Allow", Action = ["s3:DeleteObject"], Resource = ["arn:aws:s3:::cv-tailor-dev-documents-111111111111/kb/*"] },
      ]
    }
    error_message = "A function's calls changed. Update this test only after reviewing what the code now calls."
  }
}

# The mock gives the API an execution ARN at plan time, so each permission can be compared exactly.
run "invoke_permissions" {
  command = plan

  module {
    source = "../../modules/api"
  }

  assert {
    condition = { for key, p in aws_lambda_permission.route : key => trimprefix(p.source_arn, aws_api_gateway_rest_api.this.execution_arn) } == {
      "GET /me"                = "/live/GET/me"
      "GET /documents"         = "/live/GET/documents"
      "POST /documents"        = "/live/POST/documents"
      "DELETE /documents/{id}" = "/live/DELETE/documents/*"
    }
    error_message = "Only API Gateway may invoke each Lambda, for its own method and path on the live stage."
  }

  assert {
    condition     = alltrue([for p in aws_lambda_permission.route : p.principal == "apigateway.amazonaws.com"])
    error_message = "Only API Gateway may invoke the API's functions."
  }
}
