# The dns stack: each environment's zone, its delegations, and its certificate (S2-03, ADR-0008).
# No AWS access: the provider is mocked, and every run only plans.

# The real provider knows each domain's validation options at plan time. The mock gives the
# certificate the shape ACM returns: one CNAME, which covers <host> and *.<host>.
mock_provider "aws" {
  mock_resource "aws_acm_certificate" {
    defaults = {
      domain_validation_options = [
        {
          domain_name           = "dev.cv.ikiwii.com"
          resource_record_name  = "_abc.dev.cv.ikiwii.com."
          resource_record_type  = "CNAME"
          resource_record_value = "_def.acm-validations.aws."
        },
        {
          domain_name           = "*.dev.cv.ikiwii.com"
          resource_record_name  = "_abc.dev.cv.ikiwii.com."
          resource_record_type  = "CNAME"
          resource_record_value = "_def.acm-validations.aws."
        },
      ]
    }
  }
}

variables {
  environment = "dev"
  account_id  = "111111111111"
}

run "dev_has_a_zone_and_a_certificate" {
  command = plan

  assert {
    condition     = module.zone.name_servers != null
    error_message = "dev must have its zone."
  }

  assert {
    condition     = length(module.certificate) == 1
    error_message = "dev must have a certificate for dev.cv.ikiwii.com and *.dev.cv.ikiwii.com."
  }
}

run "prod_delegates_dev_and_has_no_certificate_yet" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition     = length(module.certificate) == 0
    error_message = "prod gets its certificate with the release path (slice R)."
  }
}

run "stag_has_no_dns_yet" {
  command = plan

  variables {
    environment = "stag"
  }

  expect_failures = [output.name_servers]
}

run "zone_and_delegation" {
  command = plan

  module {
    source = "../../modules/zone"
  }

  variables {
    zone_name = "cv.ikiwii.com"
    delegations = {
      "dev.cv.ikiwii.com" = ["ns-1749.awsdns-26.co.uk", "ns-1117.awsdns-11.org", "ns-155.awsdns-19.com", "ns-524.awsdns-01.net"]
    }
  }

  assert {
    condition     = aws_route53_zone.this.name == "cv.ikiwii.com"
    error_message = "The zone must be for the environment's host."
  }

  assert {
    condition = (
      aws_route53_record.delegation["dev.cv.ikiwii.com"].type == "NS"
      && aws_route53_record.delegation["dev.cv.ikiwii.com"].ttl == 3600
      && aws_route53_record.delegation["dev.cv.ikiwii.com"].records == toset(["ns-1749.awsdns-26.co.uk", "ns-1117.awsdns-11.org", "ns-155.awsdns-19.com", "ns-524.awsdns-01.net"])
    )
    error_message = "A delegation is an NS record with the child zone's four name servers and a one-hour TTL."
  }
}

run "refuses_a_delegation_outside_the_zone" {
  command = plan

  module {
    source = "../../modules/zone"
  }

  variables {
    zone_name = "cv.ikiwii.com"
    delegations = {
      "dev.example.com" = ["ns-1.example", "ns-2.example", "ns-3.example", "ns-4.example"]
    }
  }

  expect_failures = [var.delegations]
}

run "certificate" {
  command = plan

  module {
    source = "../../modules/certificate"
  }

  variables {
    zone_name = "dev.cv.ikiwii.com"
    zone_id   = "Z0000000000000"
  }

  assert {
    condition = (
      aws_acm_certificate.this.domain_name == "dev.cv.ikiwii.com"
      && aws_acm_certificate.this.subject_alternative_names == toset(["*.dev.cv.ikiwii.com"])
      && aws_acm_certificate.this.validation_method == "DNS"
    )
    error_message = "The certificate covers <host> and *.<host>, validated through DNS."
  }

  assert {
    condition = (
      aws_route53_record.validation.zone_id == "Z0000000000000"
      && aws_route53_record.validation.name == "_abc.dev.cv.ikiwii.com."
      && aws_route53_record.validation.type == "CNAME"
      && aws_route53_record.validation.records == toset(["_def.acm-validations.aws."])
    )
    error_message = "One CNAME in the environment's own zone validates both names."
  }
}
