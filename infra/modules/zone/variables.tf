variable "zone_name" {
  description = "The zone's domain, which is the environment's host, such as dev.cv.ikiwii.com."
  type        = string
  nullable    = false
}

variable "delegations" {
  description = "Child zones to delegate: zone name => its four name servers (from the child zone's name_servers output)."
  type        = map(list(string))
  nullable    = false
  default     = {}

  validation {
    condition     = alltrue([for child in keys(var.delegations) : endswith(child, ".${var.zone_name}")])
    error_message = "Every delegated zone must be a subdomain of zone_name."
  }

  validation {
    condition     = alltrue([for servers in values(var.delegations) : length(servers) == 4])
    error_message = "A Route 53 zone has exactly four name servers."
  }
}
