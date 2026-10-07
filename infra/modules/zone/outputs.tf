output "zone_id" {
  description = "The hosted zone's ID."
  value       = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "The zone's four name servers. Copied by hand once: to the registrar for cv.ikiwii.com, or into the parent zone's delegations for a child zone (deploy runbook)."
  value       = aws_route53_zone.this.name_servers
}
