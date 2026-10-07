variable "user_pool_name" {
  description = "The user pool's name, such as cv-tailor-dev-users."
  type        = string
  nullable    = false
}

variable "name_prefix" {
  description = "The environment's name prefix, such as cv-tailor-dev."
  type        = string
  nullable    = false
}

variable "web_origins" {
  description = "Where the web app runs. Managed login sends the browser back only to these."
  type        = list(string)
  nullable    = false
}

variable "sign_in_callback_path" {
  description = "Where managed login sends the browser back after sign-in. The web app's routes must match (S2-10)."
  type        = string
  nullable    = false
  default     = "/auth/callback"
}

variable "sign_out_path" {
  description = "Where managed login sends the browser back after sign-out."
  type        = string
  nullable    = false
  default     = "/"
}

variable "google_client_id" {
  description = "The Google OAuth client ID, or null for no Google sign-in (S2-06)."
  type        = string
  default     = null
}

variable "google_client_secret_name" {
  description = "The Secrets Manager secret that holds the Google client secret."
  type        = string
  nullable    = false
}

variable "api_resource_server" {
  description = "The API's resource server identifier. Every API method requires its user scope (ADR-0009 §6)."
  type        = string
  nullable    = false
  default     = "cv-tailor-api"
}

variable "api_user_scope" {
  description = "The scope every API method requires."
  type        = string
  nullable    = false
  default     = "user"
}

variable "admin_group" {
  description = "The group whose members get the admin quota (ADR-0009 §7)."
  type        = string
  nullable    = false
  default     = "admin"
}

variable "pre_sign_up_dir" {
  description = "The pre sign-up trigger's bundle: apps/api/dist/pre-sign-up."
  type        = string
  nullable    = false
}

variable "region" {
  description = "The environment's region."
  type        = string
  nullable    = false
}

variable "account_id" {
  description = "The environment's AWS account ID."
  type        = string
  nullable    = false
}

variable "role_path" {
  description = "The workload role path the deploy role may manage (settings module)."
  type        = string
  nullable    = false
}

variable "permissions_boundary_arn" {
  description = "The workload permissions boundary every role must carry (access stack)."
  type        = string
  nullable    = false
}
