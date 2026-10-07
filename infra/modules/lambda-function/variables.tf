variable "name" {
  description = "The function's name, which its role and log group share, such as cv-tailor-dev-me."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^cv-tailor-(dev|stag|prod)-[a-z0-9-]+$", var.name)) && length(var.name) <= 64
    error_message = "name must be cv-tailor-<env>-<name>, at most 64 characters: the deploy role may manage only those."
  }
}

variable "description" {
  description = "What the function does, with its sprint item."
  type        = string
  nullable    = false
}

variable "source_dir" {
  description = "The prebuilt bundle's folder in apps/api/dist, with index.js."
  type        = string
  nullable    = false
}

variable "timeout" {
  description = "The function's timeout in seconds."
  type        = number
  nullable    = false
}

variable "environment" {
  description = "Environment variables for the function."
  type        = map(string)
  nullable    = false
  default     = {}
}

variable "policy_statements" {
  description = "The calls the function's code makes, as allow statements. Logging to its own log group is added."
  type = list(object({
    actions    = list(string)
    resources  = list(string)
    conditions = optional(map(map(list(string))), {})
  }))
  nullable = false
  default  = []
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
