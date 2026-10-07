# Sign-in (S2-05, S2-06, S2-07, ADR-0009): the user pool, its client, the pre sign-up trigger, and
# Google. Expected values are written out literally, so changing one in the code fails here. No AWS
# access: the providers are mocked, and every run only plans.

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

  override_data {
    target = data.aws_secretsmanager_secret_version.google
    values = { secret_string = "test-google-secret" }
  }
}
mock_provider "archive" {}

variables {
  user_pool_name            = "cv-tailor-dev-users"
  name_prefix               = "cv-tailor-dev"
  web_origins               = ["https://dev.cv.ikiwii.com", "http://localhost:5173"]
  google_client_secret_name = "cv-tailor/google-client-secret"
  pre_sign_up_dir           = "tests/fixtures/bundles/pre-sign-up"
  region                    = "us-east-1"
  account_id                = "111111111111"
  role_path                 = "/cv-tailor/workload/"
  permissions_boundary_arn  = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
}

run "user_pool" {
  command = plan

  module {
    source = "../../modules/auth"
  }

  # Cognito can't change these once the pool exists. A new pool means a new sub for every user.
  assert {
    condition = (
      aws_cognito_user_pool.this.name == "cv-tailor-dev-users"
      && aws_cognito_user_pool.this.user_pool_tier == "ESSENTIALS"
      && aws_cognito_user_pool.this.username_attributes == toset(["email"])
      && aws_cognito_user_pool.this.username_configuration[0].case_sensitive == false
    )
    error_message = "Users sign in with their email address, case-insensitively, on the Essentials plan."
  }

  assert {
    condition = { for a in aws_cognito_user_pool.this.schema : a.name => [a.attribute_data_type, a.required, a.mutable] } == {
      email = ["String", true, true]
      hd    = ["String", false, true]
    }
    error_message = "email is required and mutable; custom:hd is mutable, so Cognito can rewrite it at each Google sign-in (S2-13)."
  }

  assert {
    condition     = aws_cognito_user_pool.this.deletion_protection == "ACTIVE"
    error_message = "The pool can't be restored once lost, so deletion protection is on."
  }

  assert {
    condition = (
      aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only == false
      && aws_cognito_user_pool.this.auto_verified_attributes == toset(["email"])
      && aws_cognito_user_pool.this.verification_message_template[0].default_email_option == "CONFIRM_WITH_CODE"
      && aws_cognito_user_pool.this.user_attribute_update_settings[0].attributes_require_verification_before_update == toset(["email"])
      && aws_cognito_user_pool.this.email_configuration[0].email_sending_account == "COGNITO_DEFAULT"
    )
    error_message = "A sign-up confirms its email with an emailed code, and a new email is used only once verified."
  }

  assert {
    condition = (
      aws_cognito_user_pool.this.password_policy[0].minimum_length == 8
      && !aws_cognito_user_pool.this.password_policy[0].require_lowercase
      && !aws_cognito_user_pool.this.password_policy[0].require_uppercase
      && !aws_cognito_user_pool.this.password_policy[0].require_numbers
      && !aws_cognito_user_pool.this.password_policy[0].require_symbols
      && aws_cognito_user_pool.this.mfa_configuration == "OFF"
      && [for m in aws_cognito_user_pool.this.account_recovery_setting[0].recovery_mechanism : [m.name, m.priority]] == [["verified_email", 1]]
    )
    error_message = "8 characters with no character-type rules, no MFA, and recovery by verified email only."
  }

  # --- The web client ---

  assert {
    condition = (
      aws_cognito_user_pool_client.web.name == "cv-tailor-web"
      && aws_cognito_user_pool_client.web.generate_secret == false
      && aws_cognito_user_pool_client.web.allowed_oauth_flows_user_pool_client
      && aws_cognito_user_pool_client.web.allowed_oauth_flows == toset(["code"])
      && aws_cognito_user_pool_client.web.allowed_oauth_scopes == toset(["openid", "email", "cv-tailor-api/user"])
      && aws_cognito_user_pool_client.web.explicit_auth_flows == toset(["ALLOW_USER_SRP_AUTH"])
      && aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED"
    )
    error_message = "A public client: code flow only, no secret, and no attribute-changing scope."
  }

  assert {
    condition = (
      aws_cognito_user_pool_client.web.callback_urls == toset(["https://dev.cv.ikiwii.com/auth/callback", "http://localhost:5173/auth/callback"])
      && aws_cognito_user_pool_client.web.logout_urls == toset(["https://dev.cv.ikiwii.com/", "http://localhost:5173/"])
    )
    error_message = "Managed login sends the browser back only to the web origins."
  }

  assert {
    condition = (
      aws_cognito_user_pool_client.web.access_token_validity == 60
      && aws_cognito_user_pool_client.web.id_token_validity == 60
      && aws_cognito_user_pool_client.web.refresh_token_validity == 1440
      && aws_cognito_user_pool_client.web.token_validity_units[0].access_token == "minutes"
      && aws_cognito_user_pool_client.web.token_validity_units[0].id_token == "minutes"
      && aws_cognito_user_pool_client.web.token_validity_units[0].refresh_token == "minutes"
      && aws_cognito_user_pool_client.web.refresh_token_rotation[0].feature == "ENABLED"
      && aws_cognito_user_pool_client.web.refresh_token_rotation[0].retry_grace_period_seconds == 10
      && aws_cognito_user_pool_client.web.enable_token_revocation
    )
    error_message = "One-hour tokens, and a one-day refresh token that rotates on every use."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.supported_identity_providers == toset(["COGNITO"]) && length(aws_cognito_identity_provider.google) == 0
    error_message = "No Google sign-in without a Google client ID."
  }

  # --- Scope, group, and parameters ---

  assert {
    condition = (
      aws_cognito_resource_server.api.identifier == "cv-tailor-api"
      && aws_cognito_resource_server.api.name == "CV Tailor API"
      && [for s in aws_cognito_resource_server.api.scope : [s.scope_name, s.scope_description]] == [["user", "Call the CV Tailor API as the signed-in user"]]
      && output.api_scope == "cv-tailor-api/user"
    )
    error_message = "Every API method requires cv-tailor-api/user."
  }

  assert {
    condition     = aws_cognito_user_group.admin.name == "admin" && aws_cognito_user_group.admin.role_arn == null
    error_message = "The admin group maps to no IAM role."
  }

  assert {
    condition     = [aws_ssm_parameter.user_pool_id.name, aws_ssm_parameter.web_client_id.name] == ["/cv-tailor/auth/user-pool-id", "/cv-tailor/auth/web-client-id"]
    error_message = "The runbooks read the pool and client IDs from SSM."
  }

  # --- The pre sign-up trigger ---

  assert {
    condition = (
      aws_lambda_permission.pre_sign_up.action == "lambda:InvokeFunction"
      && aws_lambda_permission.pre_sign_up.principal == "cognito-idp.amazonaws.com"
    )
    error_message = "Only Cognito may invoke the pre sign-up trigger."
  }
}

# The mock gives the pool an ARN at plan time, so the policy can be compared exactly.
run "pre_sign_up_calls" {
  command = plan

  module {
    source = "../../modules/auth"
  }

  assert {
    condition = jsondecode(output.pre_sign_up_policy).Statement[1] == {
      Effect = "Allow"
      Action = [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminLinkProviderForUser",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:ListUsers",
      ]
      Resource = [aws_cognito_user_pool.this.arn]
    }
    error_message = "The trigger may call only the five Cognito actions it uses, on this pool only."
  }

  assert {
    condition     = aws_lambda_permission.pre_sign_up.source_arn == aws_cognito_user_pool.this.arn
    error_message = "Only this pool may invoke the trigger."
  }

  assert {
    condition     = aws_cognito_user_pool.this.lambda_config[0].pre_sign_up != null
    error_message = "The trigger is the pool's pre sign-up trigger."
  }
}

run "google_sign_in" {
  command = plan

  module {
    source = "../../modules/auth"
  }

  variables {
    google_client_id = "123-abc.apps.googleusercontent.com"
  }

  assert {
    condition = aws_cognito_identity_provider.google[0].provider_details == tomap({
      client_id                     = "123-abc.apps.googleusercontent.com"
      client_secret                 = "test-google-secret"
      authorize_scopes              = "openid email"
      authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
      token_url                     = "https://www.googleapis.com/oauth2/v4/token"
      token_request_method          = "POST"
      attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
      attributes_url_add_attributes = "true"
      oidc_issuer                   = "https://accounts.google.com"
    })
    error_message = "Google is asked only for the email address, with the secret from Secrets Manager."
  }

  assert {
    condition = aws_cognito_identity_provider.google[0].attribute_mapping == tomap({
      email          = "email"
      email_verified = "email_verified"
      "custom:hd"    = "hd"
      username       = "sub"
    })
    error_message = "Map the email, whether Google verified it, and hd (S2-13)."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.supported_identity_providers == toset(["COGNITO", "Google"])
    error_message = "The web client offers Google."
  }
}
