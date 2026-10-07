output "zone_id" {
  description = "The hosted zone's ID. The workload finds the zone by name, so nothing reads this one."
  value       = module.zone.zone_id
}

output "name_servers" {
  description = "The zone's four name servers, for the registrar or the parent zone's delegations."
  value       = module.zone.name_servers

  precondition {
    condition     = local.dns != null
    error_message = "This environment has no DNS settings yet (modules/settings). stag gets them with the release path (slice R)."
  }
}

output "certificate_arn" {
  description = "The certificate for <host> and *.<host>, or null if the environment has none yet."
  value       = one(module.certificate[*].certificate_arn)
}
