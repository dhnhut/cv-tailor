# The certificate for <host> and *.<host> (S2-03, ADR-0008). CloudFront, API Gateway, and the
# Cognito custom domain all use it, which is why it lives in us-east-1. ACM checks the validation
# record through public DNS, so it's applied only after the zone's delegation resolves (deploy
# runbook).
resource "aws_acm_certificate" "this" {
  domain_name               = var.zone_name
  subject_alternative_names = ["*.${var.zone_name}"]
  validation_method         = "DNS"

  tags = {
    Name = var.zone_name
  }

  lifecycle {
    # It's in use, so a replacement must exist before the old one goes.
    create_before_destroy = true
  }
}

locals {
  # ACM validates <host> and *.<host> with the same CNAME record, so one record covers both.
  validation = one([
    for option in aws_acm_certificate.this.domain_validation_options : option
    if option.domain_name == var.zone_name
  ])
}

resource "aws_route53_record" "validation" {
  zone_id = var.zone_id
  name    = local.validation.resource_record_name
  type    = local.validation.resource_record_type
  ttl     = 300
  records = [local.validation.resource_record_value]
}

# Waits until ACM has issued the certificate, usually a few minutes.
resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [aws_route53_record.validation.fqdn]
}
