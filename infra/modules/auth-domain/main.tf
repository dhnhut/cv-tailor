# The sign-in pages at https://auth.<host>: managed login on a custom domain (S2-05, ADR-0008,
# ADR-0009). Cognito creates the domain only when <host> resolves, so the workload stack applies
# this after the web module's records. It holds no data, so it can be deleted and created again.

locals {
  domain_name = "auth.${var.host}"
}

# Version 2 is managed login. Version 1 is the classic hosted UI. *.<host> covers auth.<host>, and
# Cognito serves the domain through CloudFront, so the certificate must be in us-east-1, which it is.
resource "aws_cognito_user_pool_domain" "this" {
  domain                = local.domain_name
  user_pool_id          = var.user_pool_id
  certificate_arn       = var.certificate_arn
  managed_login_version = 2
}

# A client created through the API has no managed login pages until it has a style. Cognito's
# default look is enough for now.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = var.user_pool_id
  client_id                   = var.web_client_id
  use_cognito_provided_values = true

  depends_on = [aws_cognito_user_pool_domain.this] # styles apply to a domain that serves managed login
}

# AWS documents an A alias for this record. No AAAA until IPv6 is confirmed.
resource "aws_route53_record" "alias" {
  zone_id = var.zone_id
  name    = local.domain_name
  type    = "A"

  alias {
    name                   = aws_cognito_user_pool_domain.this.cloudfront_distribution
    zone_id                = aws_cognito_user_pool_domain.this.cloudfront_distribution_zone_id
    evaluate_target_health = false
  }
}
