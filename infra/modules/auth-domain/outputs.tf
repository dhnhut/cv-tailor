output "domain_name" {
  description = "The sign-in pages' domain."
  value       = aws_cognito_user_pool_domain.this.domain
}
