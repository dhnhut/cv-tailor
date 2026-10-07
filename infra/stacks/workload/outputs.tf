# scripts/web-config.ts builds /config.json from these, and scripts/deploy-web.sh uploads to them.

output "environment" {
  description = "The environment, for config.json."
  value       = var.environment
}

output "api_url" {
  description = "The API's URL, for config.json."
  value       = module.api.url
}

output "auth_url" {
  description = "The sign-in pages' URL, for config.json."
  value       = "https://${module.auth_domain.domain_name}"
}

output "user_pool_id" {
  description = "The user pool's ID, for config.json."
  value       = module.auth.user_pool_id
}

output "web_client_id" {
  description = "The web app's client ID, for config.json."
  value       = module.auth.web_client_id
}

output "site_bucket" {
  description = "The bucket deploy-web.sh uploads the web app to."
  value       = module.web.bucket_name
}

output "distribution_id" {
  description = "The distribution whose cache deploy-web.sh invalidates."
  value       = module.web.distribution_id
}
