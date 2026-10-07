variable "environment" {
  description = "The environment this account runs: dev, stag, or prod. Set by scripts/tofu.sh."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["dev", "stag", "prod"], var.environment)
    error_message = "environment must be dev, stag, or prod."
  }
}

variable "account_id" {
  description = "The environment's AWS account ID, from CVT_<ENV>_ACCOUNT_ID. Not committed (ADR-0004 §2)."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be 12 digits."
  }
}

variable "alert_email" {
  description = "Where budget alerts go, from CVT_ALERT_EMAIL. Not committed, because the repository is public (S1-09)."
  type        = string
  nullable    = false
  sensitive   = true
}
