output "user_pool_id" {
  description = "The user pool's ID."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "The user pool's ARN, for the API's authorizer."
  value       = aws_cognito_user_pool.this.arn
}

output "web_client_id" {
  description = "The web app's client ID."
  value       = aws_cognito_user_pool_client.web.id
}

output "api_scope" {
  description = "The scope every API method requires: <resource server>/<scope>."
  value       = local.api_scope
}

output "pre_sign_up_policy" {
  description = "The pre sign-up trigger's policy JSON, which tests compare exactly."
  value       = module.pre_sign_up.policy
}
