# DNS for one environment (S2-03, ADR-0008): its hosted zone, the child zones it delegates, and
# its certificate. Applied from a laptop only, in the order in the deploy runbook. GithubDeployRole
# may change only the workload's own records in the zone (ADR-0013 §5).

module "settings" {
  source = "../../modules/settings"

  environment = var.environment
}

locals {
  dns = module.settings.dns # null: the environment has no DNS settings yet (stag, until slice R)
}

module "zone" {
  source = "../../modules/zone"

  zone_name   = module.settings.host
  delegations = try(local.dns.delegations, {})
}

module "certificate" {
  source = "../../modules/certificate"
  count  = try(local.dns.certificate, false) ? 1 : 0

  zone_name = module.settings.host
  zone_id   = module.zone.zone_id
}
