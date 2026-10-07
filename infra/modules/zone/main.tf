# One environment's public hosted zone, and the child zones it delegates (S2-03, ADR-0008).
# A new zone gets new name servers, which breaks the delegation above it (registrar or parent zone),
# so the zone can't be destroyed by OpenTofu. Moving from CDK, the zones were imported, not
# recreated (S3-15).
resource "aws_route53_zone" "this" {
  name    = var.zone_name
  comment = "Managed by OpenTofu: infra/stacks/dns (ADR-0008)"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "delegation" {
  for_each = var.delegations

  zone_id = aws_route53_zone.this.zone_id
  name    = each.key
  type    = "NS"
  # A mistake in a child zone's name servers is fixed by applying again. A short TTL lets the fix
  # reach resolvers within an hour.
  ttl     = 3600
  records = each.value
}
