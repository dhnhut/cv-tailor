variable "host" {
  description = "The web app's host. The API is at api.<host>."
  type        = string
  nullable    = false
}

variable "name_prefix" {
  description = "The environment's name prefix, such as cv-tailor-dev."
  type        = string
  nullable    = false
}

variable "web_origin" {
  description = "The one origin CORS allows."
  type        = string
  nullable    = false
}

variable "table_name" {
  description = "The data table, found by its fixed name."
  type        = string
  nullable    = false
}

variable "documents_bucket_name" {
  description = "The documents bucket, found by its fixed name."
  type        = string
  nullable    = false
}

variable "documents_key_prefix" {
  description = "The prefix of every document and ACL file key (packages/contracts DOCUMENTS_KEY_PREFIX)."
  type        = string
  nullable    = false
}

variable "user_pool_arn" {
  description = "The user pool whose access tokens the authorizer accepts."
  type        = string
  nullable    = false
}

variable "api_scope" {
  description = "The scope every method requires (ADR-0009 §6)."
  type        = string
  nullable    = false
}

variable "dist_dir" {
  description = "apps/api/dist, which holds one prebuilt bundle per function."
  type        = string
  nullable    = false
}

variable "stage_name" {
  description = "The stage behind the custom domain. Callers never see it."
  type        = string
  nullable    = false
  default     = "live"
}

variable "throttle_rate_limit" {
  description = "Requests per second, for every method."
  type        = number
  nullable    = false
  default     = 5
}

variable "throttle_burst_limit" {
  description = "The burst allowed above the rate, for every method."
  type        = number
  nullable    = false
  default     = 10
}

variable "zone_id" {
  description = "The environment's hosted zone (dns stack)."
  type        = string
  nullable    = false
}

variable "certificate_arn" {
  description = "The certificate for <host> and *.<host> (dns stack)."
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
