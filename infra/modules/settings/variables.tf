variable "environment" {
  description = "The environment to return settings for: dev, stag, or prod."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["dev", "stag", "prod"], var.environment)
    error_message = "environment must be dev, stag, or prod."
  }
}
