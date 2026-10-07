terraform {
  required_version = "~> 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67"
    }
  }

  # The bucket and key come from scripts/tofu.sh: cv-tailor-tfstate-<account> and <env>/baseline.tfstate.
  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
  }

  # State and plan files are encrypted with the bootstrap stack's KMS key before they're written,
  # and OpenTofu refuses to write them unencrypted (ADR-0013 §4).
  encryption {
    key_provider "aws_kms" "state" {
      kms_key_id = "alias/cv-tailor-tfstate"
      region     = "us-east-1"
      key_spec   = "AES_256"
    }

    method "aes_gcm" "state" {
      keys = key_provider.aws_kms.state
    }

    state {
      method   = method.aes_gcm.state
      enforced = true
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
