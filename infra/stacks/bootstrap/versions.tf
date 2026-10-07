terraform {
  required_version = "~> 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67"
    }
  }

  # The bucket and key come from scripts/tofu.sh: cv-tailor-tfstate-<account> and <env>/bootstrap.tfstate.
  # A new account's first run keeps state locally until this stack has created the bucket
  # (`tofu.sh <env> bootstrap create`, deploy runbook).
  #
  # No `encryption` block, unlike every other stack: this stack creates the KMS key, so its state
  # can't depend on it. The state holds no secrets, only the bucket's and the key's settings, and
  # the bucket encrypts it at rest with the same key (ADR-0013 §4).
  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
  }
}
