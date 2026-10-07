output "region" {
  description = "The only region, for every environment (ADR-0002)."
  value       = "us-east-1"
}

output "host" {
  description = "The web app's host. The API is at api.<host>, and the sign-in pages at auth.<host>."
  value       = local.host
}

output "web_origin" {
  description = "The web app's own origin: the only one CORS allows on the API and the documents bucket."
  value       = "https://${local.host}"
}

output "web_origins" {
  description = "Every origin the web app runs on, for sign-in callbacks (S2-05). dev adds the Vite dev server."
  value       = concat(["https://${local.host}"], var.environment == "dev" ? [local.local_web_origin] : [])
}

output "monthly_budget_usd" {
  description = "The account's monthly cost budget in USD (S1-09)."
  value       = local.monthly_budget_usd[var.environment]
}

output "google_client_id" {
  description = "The Google OAuth client ID, or null if the environment has no Google sign-in yet (S2-06)."
  value       = lookup(local.google_client_ids, var.environment, null)
}

output "dns" {
  description = "The environment's DNS settings (certificate, delegations), or null if it has no dns stack yet (S2-03)."
  value       = lookup(local.dns, var.environment, null)
}

output "ai_calls_initial" {
  description = "The kill switch's value when its parameter is first created (S2-11)."
  value       = local.ai_calls_initial[var.environment]
}

output "github_subject" {
  description = "The exact OIDC sub claim that may assume the deploy role: this repository, in this environment's GitHub Environment (ADR-0004 §4)."
  value = format(
    "repo:%s@%d/%s@%d:environment:%s",
    local.github_repository.owner,
    local.github_repository.owner_id,
    local.github_repository.name,
    local.github_repository.id,
    var.environment,
  )
}

output "name_prefix" {
  description = "The prefix of every named resource in the environment, such as cv-tailor-dev-data."
  value       = "cv-tailor-${var.environment}"
}

output "workload_iam" {
  description = "Where workload IAM roles live, and the permissions boundary each must carry (ADR-0013 §5). The access stack enforces both, and the workload stack uses them."
  value = {
    role_path     = "/cv-tailor/workload/"
    boundary_name = "CvTailorWorkloadBoundary"
    boundary_path = "/cv-tailor/"
  }
}

output "google_client_secret_name" {
  description = "The Secrets Manager secret that holds the Google client secret, stored by hand (google-sign-in runbook). The workload reads it, and the deploy role may read only it."
  value       = "cv-tailor/google-client-secret"
}
