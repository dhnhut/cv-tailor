variable "initial_value" {
  description = "The switch's value when the parameter is first created: enabled or disabled."
  type        = string
  nullable    = false

  validation {
    condition     = contains(["enabled", "disabled"], var.initial_value)
    error_message = "initial_value must be enabled or disabled."
  }
}
