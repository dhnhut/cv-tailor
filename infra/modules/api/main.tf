# The API at https://api.<host> (S2-09, ADR-0009 §6): a regional REST API with a Cognito authorizer
# that accepts access tokens only, and one Lambda per route. It holds no data, so it can be deleted
# and created again.

locals {
  domain_name = "api.${var.host}"

  # Built from names, so a plan shows each policy in full.
  table_arn     = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.table_name}"
  bucket_arn    = "arn:aws:s3:::${var.documents_bucket_name}"
  documents_arn = "${local.bucket_arn}/${var.documents_key_prefix}*"

  # The role is one identity for every user, so it can't be limited to the caller's kb/<sub>/. The
  # code builds every key from the verified sub (apps/api/src/storage/keys.ts). PutObject covers
  # both the ACL file and the presigned URL, which S3 checks against the signing role.
  list_documents = {
    actions    = ["s3:ListBucket"]
    resources  = [local.bucket_arn]
    conditions = { StringLike = { "s3:prefix" = ["${var.documents_key_prefix}*"] } }
  }
  documents_environment = {
    TABLE_NAME     = var.table_name
    BUCKET_NAME    = var.documents_bucket_name
    ALLOWED_ORIGIN = var.web_origin
  }

  # One Lambda each, with exactly the calls its code makes (apps/api/src/data, S3-07).
  # TransactWriteItems has no IAM action of its own: its Put, Update, and Delete need PutItem,
  # UpdateItem, and DeleteItem. POST and GET /documents both run the lazy release, which marks,
  # deletes, and frees items.
  functions = {
    me = {
      # Two DynamoDB calls with one retry each can take about 7 seconds at worst.
      description = "GET /me: who the caller is (S2-09, ADR-0009 section 6)"
      timeout     = 10
      environment = { TABLE_NAME = var.table_name, ALLOWED_ORIGIN = var.web_origin }
      statements = [
        { actions = ["dynamodb:GetItem", "dynamodb:PutItem"], resources = [local.table_arn], conditions = {} },
      ]
    }
    # POST and GET make up to about 8 calls at worst (list, the lazy release, the transaction, the
    # ACL file), each with one retry: well under API Gateway's 29-second limit.
    create-document = {
      description = "POST /documents: reserve storage and return a presigned upload (S3-07)"
      timeout     = 20
      environment = local.documents_environment
      statements = [
        { actions = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"], resources = [local.table_arn], conditions = {} },
        { actions = ["s3:DeleteObject", "s3:PutObject"], resources = [local.documents_arn], conditions = {} },
        local.list_documents,
      ]
    }
    list-documents = {
      description = "GET /documents: the caller's documents and usage (S3-07)"
      timeout     = 20
      environment = local.documents_environment
      statements = [
        { actions = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"], resources = [local.table_arn], conditions = {} },
        { actions = ["s3:DeleteObject"], resources = [local.documents_arn], conditions = {} },
        local.list_documents,
      ]
    }
    delete-document = {
      description = "DELETE /documents/{id}: remove a document and free its bytes (S3-07)"
      timeout     = 15
      environment = local.documents_environment
      statements = [
        { actions = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [local.table_arn], conditions = {} },
        { actions = ["s3:DeleteObject"], resources = [local.documents_arn], conditions = {} },
      ]
    }
  }

  # Every route needs an access token with the API scope.
  routes = {
    "GET /me"                = { method = "GET", path = "/me", function = "me" }
    "GET /documents"         = { method = "GET", path = "/documents", function = "list-documents" }
    "POST /documents"        = { method = "POST", path = "/documents", function = "create-document" }
    "DELETE /documents/{id}" = { method = "DELETE", path = "/documents/{id}", function = "delete-document" }
  }

  resources = {
    "/me"             = aws_api_gateway_resource.me.id
    "/documents"      = aws_api_gateway_resource.documents.id
    "/documents/{id}" = aws_api_gateway_resource.document.id
  }

  # Preflight for the web app's origin only. Browsers require it to be open, so it has no
  # authorizer.
  cors_headers = {
    "Access-Control-Allow-Origin"  = "'${var.web_origin}'"
    "Access-Control-Allow-Methods" = "'GET,POST,DELETE'"
    "Access-Control-Allow-Headers" = "'Authorization,Content-Type'" # POST /documents sends JSON
    "Access-Control-Max-Age"       = "'3600'"
  }

  # API Gateway's own errors: 401 from the authorizer, 403 for an unknown route, 429 when
  # throttled, and 5xx. Without the CORS header, the browser hides them from the web app
  # (ADR-0009 §6). The two defaults cover every type without its own setting.
  gateway_responses = ["UNAUTHORIZED", "DEFAULT_4XX", "DEFAULT_5XX"]
}

module "functions" {
  source   = "../lambda-function"
  for_each = local.functions

  name              = "${var.name_prefix}-${each.key}"
  description       = each.value.description
  source_dir        = "${var.dist_dir}/${each.key}"
  timeout           = each.value.timeout
  environment       = each.value.environment
  policy_statements = each.value.statements

  region                   = var.region
  account_id               = var.account_id
  role_path                = var.role_path
  permissions_boundary_arn = var.permissions_boundary_arn
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "cv-tailor-api"
  description = "The CV Tailor API at https://${local.domain_name} (S2-09)"

  # The custom domain is the only way in, so the CORS and TLS settings can't be bypassed.
  disable_execute_api_endpoint = true

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "me" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "me"
}

resource "aws_api_gateway_resource" "documents" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "documents"
}

resource "aws_api_gateway_resource" "document" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.documents.id
  path_part   = "{id}"
}

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito-access-tokens"
  rest_api_id     = aws_api_gateway_rest_api.this.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

resource "aws_api_gateway_method" "route" {
  for_each = local.routes

  rest_api_id          = aws_api_gateway_rest_api.this.id
  resource_id          = local.resources[each.value.path]
  http_method          = each.value.method
  authorization        = "COGNITO_USER_POOLS"
  authorizer_id        = aws_api_gateway_authorizer.cognito.id
  authorization_scopes = [var.api_scope]
}

resource "aws_api_gateway_integration" "route" {
  for_each = local.routes

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_method.route[each.key].resource_id
  http_method             = aws_api_gateway_method.route[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = module.functions[each.value.function].invoke_arn
}

# Only API Gateway may invoke each function, for its own method and path on the live stage. No
# test-invoke permission: the console's test button isn't used.
resource "aws_lambda_permission" "route" {
  for_each = local.routes

  statement_id  = "ApiGateway${replace(title(replace(lower(each.key), "/[^a-z]+/", " ")), " ", "")}"
  action        = "lambda:InvokeFunction"
  function_name = module.functions[each.value.function].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/${var.stage_name}/${each.value.method}${replace(each.value.path, "{id}", "*")}"
}

resource "aws_api_gateway_method" "preflight" {
  for_each = local.resources

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = each.value
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "preflight" {
  for_each = local.resources

  rest_api_id       = aws_api_gateway_rest_api.this.id
  resource_id       = each.value
  http_method       = aws_api_gateway_method.preflight[each.key].http_method
  type              = "MOCK"
  request_templates = { "application/json" = jsonencode({ statusCode = 204 }) }
}

resource "aws_api_gateway_method_response" "preflight" {
  for_each = local.resources

  rest_api_id         = aws_api_gateway_rest_api.this.id
  resource_id         = each.value
  http_method         = aws_api_gateway_method.preflight[each.key].http_method
  status_code         = "204"
  response_parameters = { for header in keys(local.cors_headers) : "method.response.header.${header}" => true }
}

resource "aws_api_gateway_integration_response" "preflight" {
  for_each = local.resources

  rest_api_id         = aws_api_gateway_rest_api.this.id
  resource_id         = each.value
  http_method         = aws_api_gateway_method.preflight[each.key].http_method
  status_code         = aws_api_gateway_method_response.preflight[each.key].status_code
  response_parameters = { for header, value in local.cors_headers : "method.response.header.${header}" => value }

  depends_on = [aws_api_gateway_integration.preflight]
}

resource "aws_api_gateway_gateway_response" "cors" {
  for_each = toset(local.gateway_responses)

  rest_api_id         = aws_api_gateway_rest_api.this.id
  response_type       = each.key
  response_parameters = { "gatewayresponse.header.Access-Control-Allow-Origin" = "'${var.web_origin}'" }
}

# A new deployment whenever a route, its integration, the preflight, or a gateway response changes.
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      local.routes,
      local.cors_headers,
      local.gateway_responses,
      var.api_scope,
      [for key in keys(local.routes) : aws_api_gateway_integration.route[key].uri],
      aws_api_gateway_authorizer.cognito.provider_arns,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.route,
    aws_api_gateway_integration_response.preflight,
    aws_api_gateway_gateway_response.cors,
  ]
}

# Callers never see the stage's name: the domain maps to it at /.
resource "aws_api_gateway_stage" "live" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name
}

# For every method, in requests per second. Well above one person using the web app, and far below
# the account's default of 10,000, so a flood is cut off early (S2-09, AGENTS.md §8).
resource "aws_api_gateway_method_settings" "throttle" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.live.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }
}

# *.<host> covers api.<host>. A regional API needs a certificate in its own region: us-east-1, where
# it is (ADR-0008).
resource "aws_api_gateway_domain_name" "this" {
  domain_name              = local.domain_name
  regional_certificate_arn = var.certificate_arn
  security_policy          = "TLS_1_2"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "this" {
  api_id      = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.live.stage_name
  domain_name = aws_api_gateway_domain_name.this.domain_name
}

# An A record only, as for the sign-in domain. No AAAA until IPv6 is turned on for the domain.
resource "aws_route53_record" "alias" {
  zone_id = var.zone_id
  name    = local.domain_name
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.this.regional_domain_name
    zone_id                = aws_api_gateway_domain_name.this.regional_zone_id
    evaluate_target_health = false
  }
}
