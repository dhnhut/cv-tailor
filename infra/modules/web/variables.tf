variable "host" {
  description = "The web app's host, such as dev.cv.ikiwii.com."
  type        = string
  nullable    = false
}

variable "name_prefix" {
  description = "The environment's name prefix, such as cv-tailor-dev."
  type        = string
  nullable    = false
}

variable "bucket_name" {
  description = "The site bucket's name: cv-tailor-<env>-web-<account>."
  type        = string
  nullable    = false
}

variable "api_origin" {
  description = "The API's origin, which the content security policy allows the app to call."
  type        = string
  nullable    = false
}

variable "auth_origin" {
  description = "The sign-in endpoints' origin, which the content security policy allows the app to call."
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
