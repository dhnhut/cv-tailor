variable "name" {
  description = "The budget's name, such as cv-tailor-dev-monthly."
  type        = string
  nullable    = false
}

variable "monthly_limit_usd" {
  description = "The monthly amount in USD that the alerts are measured against."
  type        = number
  nullable    = false

  validation {
    condition     = var.monthly_limit_usd > 0
    error_message = "monthly_limit_usd must be more than 0."
  }
}

variable "alert_email" {
  description = "Where alerts go. Not committed, because the repository is public (S1-09)."
  type        = string
  nullable    = false
  sensitive   = true

  validation {
    condition     = can(regex("^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}
