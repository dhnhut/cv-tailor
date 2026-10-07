# The workload stack's wiring: names, origins, and the values config.json and deploy-web.sh read.
# No AWS access: the providers are mocked, and the run only plans.

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

  mock_resource "aws_cognito_user_pool" {
    defaults = { arn = "arn:aws:cognito-idp:us-east-1:111111111111:userpool/us-east-1_mock", id = "us-east-1_mock" }
  }

  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:function/cv-tailor-dev-spa-routing" }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:distribution/EMOCK" }
  }

  mock_resource "aws_api_gateway_rest_api" {
    defaults = { execution_arn = "arn:aws:execute-api:us-east-1:111111111111:mockapi" }
  }

  mock_data "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:111111111111:certificate/mock" }
  }
}
mock_provider "archive" {}

variables {
  environment = "dev"
  account_id  = "111111111111"
}

run "dev_wiring" {
  command = plan

  assert {
    condition     = output.environment == "dev" && output.api_url == "https://api.dev.cv.ikiwii.com" && output.auth_url == "https://auth.dev.cv.ikiwii.com"
    error_message = "config.json gets dev's API and sign-in URLs."
  }

  assert {
    condition     = local.contracts.documentsKeyPrefix == "kb/"
    error_message = "The documents key prefix comes from packages/contracts (generated/contracts.json)."
  }

  assert {
    condition     = local.boundary_arn == "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
    error_message = "Workload roles carry the boundary the access stack creates and the deploy role requires."
  }

  assert {
    condition     = alltrue([for policy in values(module.api.function_policies) : strcontains(policy, "arn:aws:s3:::cv-tailor-dev-documents-111111111111") || !strcontains(policy, "s3:")])
    error_message = "The API's functions use dev's documents bucket."
  }
}
