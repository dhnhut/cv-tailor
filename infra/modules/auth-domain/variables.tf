variable "host" {
  description = "The web app's host. The sign-in pages are at auth.<host>."
  type        = string
  nullable    = false
}

variable "user_pool_id" {
  description = "The user pool that serves the sign-in pages."
  type        = string
  nullable    = false
}

variable "web_client_id" {
  description = "The web app's client, which gets Cognito's default style."
  type        = string
  nullable    = false
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
