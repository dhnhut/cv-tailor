# The web app (S2-04) and the sign-in domain (S2-05). No AWS access: the provider is mocked.

mock_provider "aws" {
  # The provider checks that ARN arguments parse as ARNs, which the mock's random strings don't.
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:function/cv-tailor-dev-spa-routing" }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::111111111111:distribution/EMOCK" }
  }
}

variables {
  host            = "dev.cv.ikiwii.com"
  name_prefix     = "cv-tailor-dev"
  bucket_name     = "cv-tailor-dev-web-111111111111"
  api_origin      = "https://api.dev.cv.ikiwii.com"
  auth_origin     = "https://auth.dev.cv.ikiwii.com"
  zone_id         = "Z0000000000000"
  certificate_arn = "arn:aws:acm:us-east-1:111111111111:certificate/test"
  user_pool_id    = "us-east-1_test"
  web_client_id   = "testclient"
}

run "web" {
  command = plan

  module {
    source = "../../modules/web"
  }

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.site.block_public_acls,
      aws_s3_bucket_public_access_block.site.block_public_policy,
      aws_s3_bucket_public_access_block.site.ignore_public_acls,
      aws_s3_bucket_public_access_block.site.restrict_public_buckets,
      aws_s3_bucket_ownership_controls.site.rule[0].object_ownership == "BucketOwnerEnforced",
      one(aws_s3_bucket_server_side_encryption_configuration.site.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256",
    ])
    error_message = "The site bucket is private, without ACLs, and encrypted."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.site.aliases == toset(["dev.cv.ikiwii.com"])
      && aws_cloudfront_distribution.site.price_class == "PriceClass_All"
      && aws_cloudfront_distribution.site.http_version == "http2and3"
      && aws_cloudfront_distribution.site.is_ipv6_enabled
      && aws_cloudfront_distribution.site.viewer_certificate[0].acm_certificate_arn == "arn:aws:acm:us-east-1:111111111111:certificate/test"
      && aws_cloudfront_distribution.site.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
      && aws_cloudfront_distribution.site.viewer_certificate[0].ssl_support_method == "sni-only"
      && aws_cloudfront_distribution.site.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    )
    error_message = "The distribution serves only the host, over HTTPS with TLS 1.2 or later, from every edge location."
  }

  assert {
    condition     = [for f in aws_cloudfront_distribution.site.default_cache_behavior[0].function_association : f.event_type] == ["viewer-request"]
    error_message = "The routing function runs on viewer requests, before the cache lookup."
  }

  assert {
    condition = (
      aws_cloudfront_function.spa_routing.runtime == "cloudfront-js-2.0"
      && aws_cloudfront_function.spa_routing.publish
      && aws_cloudfront_function.spa_routing.code == file("../../modules/web/spa-routing.js")
    )
    error_message = "The routing function runs on the 2.0 runtime, and is published."
  }

  assert {
    condition     = output.content_security_policy == "default-src 'self'; connect-src 'self' https://api.dev.cv.ikiwii.com https://auth.dev.cv.ikiwii.com; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
    error_message = "The content security policy allows only this origin, the API, and the sign-in endpoints."
  }

  assert {
    condition = (
      aws_cloudfront_response_headers_policy.security.security_headers_config[0].strict_transport_security[0].access_control_max_age_sec == 63072000
      && aws_cloudfront_response_headers_policy.security.security_headers_config[0].strict_transport_security[0].include_subdomains
      && aws_cloudfront_response_headers_policy.security.security_headers_config[0].content_security_policy[0].content_security_policy == output.content_security_policy
      && aws_cloudfront_response_headers_policy.security.security_headers_config[0].content_type_options[0].override
      && aws_cloudfront_response_headers_policy.security.security_headers_config[0].frame_options[0].frame_option == "DENY"
      && aws_cloudfront_response_headers_policy.security.security_headers_config[0].referrer_policy[0].referrer_policy == "strict-origin-when-cross-origin"
    )
    error_message = "HSTS for two years, the content security policy, nosniff, DENY framing, and a strict referrer policy."
  }

  assert {
    condition     = toset([for r in aws_route53_record.alias : r.type]) == toset(["A", "AAAA"]) && alltrue([for r in aws_route53_record.alias : r.name == "dev.cv.ikiwii.com"])
    error_message = "The host points at the distribution over IPv4 and IPv6."
  }
}

# The mock gives the distribution an ARN at plan time, so the policy can be compared exactly.
run "web_bucket_policy" {
  command = plan

  module {
    source = "../../modules/web"
  }

  assert {
    condition = jsondecode(aws_s3_bucket_policy.site.policy).Statement[1] == {
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "arn:aws:s3:::cv-tailor-dev-web-111111111111/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
    }
    error_message = "Only this distribution may read the bucket, through origin access control."
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "The bucket refuses plain HTTP."
  }
}

run "sign_in_domain" {
  command = plan

  module {
    source = "../../modules/auth-domain"
  }

  assert {
    condition = (
      aws_cognito_user_pool_domain.this.domain == "auth.dev.cv.ikiwii.com"
      && aws_cognito_user_pool_domain.this.managed_login_version == 2
      && aws_cognito_user_pool_domain.this.certificate_arn == "arn:aws:acm:us-east-1:111111111111:certificate/test"
    )
    error_message = "auth.<host> serves managed login (version 2), not the classic hosted UI."
  }

  assert {
    condition     = aws_cognito_managed_login_branding.web.use_cognito_provided_values && aws_cognito_managed_login_branding.web.client_id == "testclient"
    error_message = "The web client gets Cognito's default style, or it has no managed login pages."
  }

  assert {
    condition     = aws_route53_record.alias.name == "auth.dev.cv.ikiwii.com" && aws_route53_record.alias.type == "A"
    error_message = "auth.<host> points at Cognito's distribution, with an A record."
  }
}
