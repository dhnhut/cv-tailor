# CI access for one account (S1-07, ADR-0004 §4, ADR-0013 §5): the GitHub OIDC provider,
# GithubDeployRole, and the workload permissions boundary. Applied from a laptop only, after the
# bootstrap stack, so CI can never change the role it signs in with.

module "settings" {
  source = "../../modules/settings"

  environment = var.environment
}

# The bootstrap stack's key. The deploy role needs it to read and write its encrypted state.
data "aws_kms_alias" "state" {
  name = "alias/cv-tailor-tfstate"
}

module "oidc" {
  source = "../../modules/oidc"

  environment               = var.environment
  account_id                = var.account_id
  region                    = module.settings.region
  host                      = module.settings.host
  github_subject            = module.settings.github_subject
  state_key_arn             = data.aws_kms_alias.state.target_key_arn
  google_client_secret_name = module.settings.google_client_secret_name
  workload_iam              = module.settings.workload_iam
}
