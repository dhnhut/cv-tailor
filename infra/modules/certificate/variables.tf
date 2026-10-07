variable "zone_name" {
  description = "The zone's domain. The certificate covers it and *.<it>."
  type        = string
  nullable    = false
}

variable "zone_id" {
  description = "The hosted zone that gets the validation record."
  type        = string
  nullable    = false
}
