output "state_bucket" {
  description = "The bucket that holds every stack's state in this account."
  value       = aws_s3_bucket.state.bucket
}

output "state_key_arn" {
  description = "The KMS key that encrypts state and plan files."
  value       = aws_kms_key.state.arn
}

output "state_key_alias" {
  description = "The alias every other stack's encryption block uses."
  value       = aws_kms_alias.state.name
}
