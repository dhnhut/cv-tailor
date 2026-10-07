# The user pool and the web app's client for one environment (S2-05, ADR-0009). Data is keyed by
# each user's sub, and a lost pool can't be restored (Cognito can't export passwords), so the pool
# has deletion protection and prevent_destroy.

locals {
  api_scope = "${var.api_resource_server}/${var.api_user_scope}"
}

resource "aws_cognito_user_pool" "this" {
  name           = var.user_pool_name
  user_pool_tier = "ESSENTIALS"

  # Permanent: Cognito can't change these once the pool exists (ADR-0009 §4).
  username_attributes = ["email"] # the email address is the username
  username_configuration {
    case_sensitive = false
  }

  # Each string attribute states its limits, or the provider plans to recreate the pool (provider
  # docs). 0 to 2048 is Cognito's own default and maximum.
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true # Google updates it (S2-06)

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  # Google's hd claim: the Workspace domain of a Google account (S2-13, ADR-0009 §2). Permanent:
  # Cognito can't remove or change a custom attribute. Mutable, because Cognito rewrites mapped
  # attributes at sign-in, and an immutable one would make that sign-in fail.
  schema {
    name                = "hd"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  # The web app's sign-up form calls SignUp (ADR-0009 §8). A sign-up confirms its email with an
  # emailed code, and a new email address is used only once it's verified.
  admin_create_user_config {
    allow_admin_create_user_only = false
  }
  auto_verified_attributes = ["email"]
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OFF"

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT" # 50 emails a day; SES before the first prod release
  }

  # The pre sign-up trigger links a first Google sign-in to the person's local user, so their sub
  # never changes (S2-07, ADR-0009 §1–§2). Cognito waits 5 seconds for it.
  lambda_config {
    pre_sign_up = module.pre_sign_up.function_arn
  }

  deletion_protection = "ACTIVE"

  lifecycle {
    prevent_destroy = true
  }
}

module "pre_sign_up" {
  source = "../lambda-function"

  name        = "${var.name_prefix}-pre-sign-up"
  description = "Links Google sign-ins to local users (S2-07, ADR-0009 section 2)"
  source_dir  = var.pre_sign_up_dir
  timeout     = 5 # Cognito stops waiting at 5 seconds anyway
  # No reserved concurrency: AdminCreateUser (case 4) invokes this function again while it runs.

  # Exactly the Cognito calls in apps/api/src/triggers/pre-sign-up/cognito.ts, on this pool only.
  # The pool refers to the function (its trigger), and this policy to the pool, which is no cycle:
  # the function doesn't wait for its policy.
  policy_statements = [{
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminLinkProviderForUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:ListUsers",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }]

  region                   = var.region
  account_id               = var.account_id
  role_path                = var.role_path
  permissions_boundary_arn = var.permissions_boundary_arn
}

resource "aws_lambda_permission" "pre_sign_up" {
  statement_id  = "CognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = module.pre_sign_up.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}

# The Google client's secret, stored by hand (google-sign-in runbook). It ends up in state, which
# is encrypted with KMS before it's written (ADR-0013 §4): the identity provider has no write-only
# argument.
data "aws_secretsmanager_secret_version" "google" {
  count = var.google_client_id == null ? 0 : 1

  secret_id = var.google_client_secret_name
}

# Google sign-in (S2-06). Asks Google only for the email address (SAFE-04), and maps whether Google
# verified it: mapped emails are unverified otherwise, and the pre sign-up trigger links accounts
# only on a verified address (S2-07). It also maps hd, so the trigger can tell a Google Workspace
# account (S2-13).
resource "aws_cognito_identity_provider" "google" {
  count = var.google_client_id == null ? 0 : 1

  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = data.aws_secretsmanager_secret_version.google[0].secret_string
    authorize_scopes = "openid email"

    # Cognito fills in Google's endpoints itself and returns them. Written out, so a plan matches
    # what AWS stores and never tries to remove them, which could break Google sign-in (S3-15).
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
    token_request_method          = "POST"
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    oidc_issuer                   = "https://accounts.google.com"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    "custom:hd"    = "hd"
    username       = "sub" # Cognito maps every Google user's username to Google's sub, and returns it
  }
}

# Every API method requires this scope (ADR-0009 §6). ID tokens have no scopes, so the API accepts
# only access tokens.
resource "aws_cognito_resource_server" "api" {
  user_pool_id = aws_cognito_user_pool.this.id
  identifier   = var.api_resource_server
  name         = "CV Tailor API"

  scope {
    scope_name        = var.api_user_scope
    scope_description = "Call the CV Tailor API as the signed-in user"
  }
}

# A public client: a browser can't keep a secret. Cognito can't require PKCE, so the web app's
# sign-in library adds it (S2-10).
resource "aws_cognito_user_pool_client" "web" {
  name            = "cv-tailor-web"
  user_pool_id    = aws_cognito_user_pool.this.id
  generate_secret = false

  # Managed login offers the flows allowed here, and SRP gives it password sign-in. Refresh goes
  # through the token endpoint, because rotation rules out ALLOW_REFRESH_TOKEN_AUTH.
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH"]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  # Not aws.cognito.signin.user.admin, which lets tokens change attributes.
  allowed_oauth_scopes = ["openid", "email", local.api_scope]
  callback_urls        = [for origin in var.web_origins : "${origin}${var.sign_in_callback_path}"]
  logout_urls          = [for origin in var.web_origins : "${origin}${var.sign_out_path}"]

  # The client names Google by a plain string, so it must wait for the provider to exist.
  supported_identity_providers = concat(["COGNITO"], aws_cognito_identity_provider.google[*].provider_name)

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 1440 # one day
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "minutes"
  }

  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 10
  }
  enable_token_revocation = true

  # The API scope must exist before a client can ask for it. It's named by a plain string above.
  depends_on = [aws_cognito_resource_server.api]
}

# Members are added and removed by hand (users-and-admins runbook, ADR-0009 §7).
resource "aws_cognito_user_group" "admin" {
  user_pool_id = aws_cognito_user_pool.this.id
  name         = var.admin_group
  description  = "Admins get the admin quota (QUOTA-03). Changed by hand only."
}

# The runbooks and the web app's config.json read these.
resource "aws_ssm_parameter" "user_pool_id" {
  name        = "/cv-tailor/auth/user-pool-id"
  description = "ID of the ${var.user_pool_name} user pool (S2-05)"
  type        = "String"
  value       = aws_cognito_user_pool.this.id
}

resource "aws_ssm_parameter" "web_client_id" {
  name        = "/cv-tailor/auth/web-client-id"
  description = "ID of the web app's client in ${var.user_pool_name} (S2-05)"
  type        = "String"
  value       = aws_cognito_user_pool_client.web.id
}
