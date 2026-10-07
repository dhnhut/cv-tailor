output "bucket_name" {
  description = "The site bucket, which deploy-web.sh uploads to."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "The distribution, whose cache deploy-web.sh invalidates."
  value       = aws_cloudfront_distribution.site.id
}

output "content_security_policy" {
  description = "The content security policy sent with every response."
  value       = local.content_security_policy
}
