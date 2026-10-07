provider "aws" {
  region = "us-east-1" # the only region (ADR-0002)

  # A plan fails at once if the credentials belong to another account (ADR-0013 §3).
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "cv-tailor"
      Environment = var.environment
      Stack       = "workload"
      ManagedBy   = "opentofu"
    }
  }
}
