# The workload for one environment: data, knowledge base, sign-in, web app, and API. CI applies it
# on every merge to main (dev only), with GithubDeployRole (ADR-0013 §5). Everything refers to
# everything else directly, so OpenTofu orders the changes; only the sign-in domain needs a
# depends_on.

module "settings" {
  source = "../../modules/settings"

  environment = var.environment
}

locals {
  prefix    = module.settings.name_prefix
  host      = module.settings.host
  contracts = jsondecode(file("${path.module}/../../generated/contracts.json"))

  # The prebuilt Lambda bundles. `pnpm run check` builds them first (infra depends on
  # @cv-tailor/api), and deploy.yml builds them before AWS credentials exist.
  api_dist = "${path.module}/../../../apps/api/dist"

  # The access stack enforces these: every role the workload creates lives under this path and
  # carries this boundary (ADR-0013 §5). Built from names, as the deploy role's conditions are.
  role_path    = module.settings.workload_iam.role_path
  boundary_arn = "arn:aws:iam::${var.account_id}:policy${module.settings.workload_iam.boundary_path}${module.settings.workload_iam.boundary_name}"
}

# From the dns stack, found by name: no state is shared between stacks.
data "aws_route53_zone" "this" {
  name         = local.host
  private_zone = false
}

data "aws_acm_certificate" "this" {
  domain      = local.host
  statuses    = ["ISSUED"]
  most_recent = true
}

module "data" {
  source = "../../modules/data"

  table_name = "${local.prefix}-data"
}

module "knowledge_base" {
  source = "../../modules/knowledge-base"

  bucket_name         = "${local.prefix}-documents-${var.account_id}"
  knowledge_base_name = "${local.prefix}-kb"
  web_origin          = module.settings.web_origin

  region                   = module.settings.region
  account_id               = var.account_id
  role_path                = local.role_path
  permissions_boundary_arn = local.boundary_arn
}

module "auth" {
  source = "../../modules/auth"

  user_pool_name            = "${local.prefix}-users"
  name_prefix               = local.prefix
  web_origins               = module.settings.web_origins
  google_client_id          = module.settings.google_client_id
  google_client_secret_name = module.settings.google_client_secret_name
  pre_sign_up_dir           = "${local.api_dist}/pre-sign-up"

  region                   = module.settings.region
  account_id               = var.account_id
  role_path                = local.role_path
  permissions_boundary_arn = local.boundary_arn
}

module "web" {
  source = "../../modules/web"

  host            = local.host
  name_prefix     = local.prefix
  bucket_name     = "${local.prefix}-web-${var.account_id}"
  api_origin      = "https://api.${local.host}"
  auth_origin     = "https://auth.${local.host}"
  zone_id         = data.aws_route53_zone.this.zone_id
  certificate_arn = data.aws_acm_certificate.this.arn
}

module "auth_domain" {
  source = "../../modules/auth-domain"

  host            = local.host
  user_pool_id    = module.auth.user_pool_id
  web_client_id   = module.auth.web_client_id
  zone_id         = data.aws_route53_zone.this.zone_id
  certificate_arn = data.aws_acm_certificate.this.arn

  # Cognito creates the domain only once <host> resolves, which the web module's records do.
  depends_on = [module.web]
}

module "api" {
  source = "../../modules/api"

  host                  = local.host
  name_prefix           = local.prefix
  web_origin            = module.settings.web_origin # only the web app's own origin: no localhost, even in dev
  table_name            = module.data.table_name
  documents_bucket_name = module.knowledge_base.bucket_name
  documents_key_prefix  = local.contracts.documentsKeyPrefix
  user_pool_arn         = module.auth.user_pool_arn
  api_scope             = module.auth.api_scope
  dist_dir              = local.api_dist
  zone_id               = data.aws_route53_zone.this.zone_id
  certificate_arn       = data.aws_acm_certificate.this.arn

  region                   = module.settings.region
  account_id               = var.account_id
  role_path                = local.role_path
  permissions_boundary_arn = local.boundary_arn
}
