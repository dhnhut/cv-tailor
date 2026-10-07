variable "environment" {
  description = "The environment this account runs: dev, stag, or prod."
  type        = string
  nullable    = false
}

variable "account_id" {
  description = "The environment's AWS account ID."
  type        = string
  nullable    = false
}

variable "region" {
  description = "The environment's region (ADR-0002)."
  type        = string
  nullable    = false
}

variable "host" {
  description = "The web app's host. CI may change only the records for <host>, api.<host>, and auth.<host>."
  type        = string
  nullable    = false

  validation {
    condition     = var.host == lower(trimsuffix(var.host, "."))
    error_message = "host must be lowercase, without a trailing dot, as Route 53's record name condition compares it."
  }
}

variable "github_subject" {
  description = "The exact OIDC sub claim that may assume the deploy role (ADR-0004 §4)."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^repo:[^:*]+@[0-9]+/[^:*]+@[0-9]+:environment:[a-z]+$", var.github_subject))
    error_message = "github_subject must be one repository and one GitHub Environment, in GitHub's immutable subject format, with no wildcards."
  }
}

variable "state_key_arn" {
  description = "The KMS key that encrypts state (bootstrap stack). The deploy role may use it."
  type        = string
  nullable    = false
}

variable "google_client_secret_name" {
  description = "The Secrets Manager secret that holds the Google client secret. The deploy role may read only it."
  type        = string
  nullable    = false
}

variable "workload_iam" {
  description = "Where workload roles live, and the boundary each must carry (settings module)."
  type = object({
    role_path     = string
    boundary_name = string
    boundary_path = string
  })
  nullable = false
}
