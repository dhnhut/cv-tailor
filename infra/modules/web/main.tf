# The web app at https://<host> (S2-04): a private S3 bucket that only this CloudFront distribution
# can read, through origin access control. The files are uploaded after apply by
# scripts/deploy-web.sh, with /config.json built by scripts/web-config.ts (S3-15).

locals {
  bucket_arn = "arn:aws:s3:::${var.bucket_name}"

  # Everything comes from this origin only, except calls to the API (S2-09) and to the sign-in
  # endpoints at auth.<host>: the token exchange, refresh, and revocation (S2-10). Redirects to
  # managed login are page loads, which connect-src doesn't cover. base-uri, frame-ancestors, and
  # form-action don't fall back to default-src, so they're set too. Turnstile adds its own origin.
  content_security_policy = join("; ", [
    "default-src 'self'",
    "connect-src 'self' ${var.api_origin} ${var.auth_origin}", # 'self' keeps /config.json loading
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ])
}

# Holds only build output, which every deploy uploads again, so it may be emptied and deleted.
resource "aws_s3_bucket" "site" {
  bucket        = var.bucket_name
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [local.bucket_arn, "${local.bucket_arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # Only this distribution, through origin access control.
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${local.bucket_arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = var.bucket_name
  description                       = "Lets ${var.host}'s distribution read its bucket (S2-04)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Runs at the edge before the cache lookup. A path whose last segment has no dot is an app route,
# so it gets index.html and React shows the page. Files (/assets/*.js, /config.json) pass through,
# so a missing file gets S3's 403 instead of the app. App routes must never end in a segment with
# a dot.
resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing"
  comment = "Serves index.html for app routes (S2-04)"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-routing.js")
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.name_prefix}-security-headers"
  comment = "Security headers for ${var.host} (S2-04)"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000 # two years
      include_subdomains         = true
      override                   = true
    }

    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  comment         = var.host
  aliases         = [var.host]
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_All" # includes the edge locations in Australia and New Zealand

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "alias" {
  for_each = toset(["A", "AAAA"]) # IPv4 and IPv6

  zone_id = var.zone_id
  name    = var.host
  type    = each.key

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
