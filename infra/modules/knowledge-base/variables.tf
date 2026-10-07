variable "bucket_name" {
  description = "The documents bucket's fixed name: cv-tailor-<env>-documents-<account>. Bucket names are global, so the account ID keeps another account from taking it first."
  type        = string
  nullable    = false
}

variable "knowledge_base_name" {
  description = "The knowledge base's name, such as cv-tailor-dev-kb."
  type        = string
  nullable    = false
}

variable "web_origin" {
  description = "The only origin that may upload directly (KB-04)."
  type        = string
  nullable    = false
}

variable "max_file_size_mb" {
  description = "KB-03: the largest file the connector ingests, in MB. The connector skips anything bigger."
  type        = number
  nullable    = false
  default     = 50
}

variable "noncurrent_version_days" {
  description = "How long old versions of a document are kept: as long as PITR keeps the table's items (S2-08)."
  type        = number
  nullable    = false
  default     = 35
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
