# The bootstrap stack (S3-15, ADR-0013 §4). No AWS access: the provider is mocked, and every run
# only plans.

mock_provider "aws" {}

variables {
  environment = "dev"
  account_id  = "111111111111"
}

run "state_bucket" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.bucket == "cv-tailor-tfstate-111111111111"
    error_message = "The state bucket must be named after the account, which other stacks' backends use."
  }

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning must be on, so an earlier state can be restored."
  }

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.state.block_public_acls,
      aws_s3_bucket_public_access_block.state.block_public_policy,
      aws_s3_bucket_public_access_block.state.ignore_public_acls,
      aws_s3_bucket_public_access_block.state.restrict_public_buckets,
    ])
    error_message = "All public access must be blocked."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.state.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Object ACLs must be off."
  }

  assert {
    condition = (
      one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms"
      && one(aws_s3_bucket_server_side_encryption_configuration.state.rule).bucket_key_enabled
    )
    error_message = "The bucket must be encrypted at rest with the state key."
  }
}

run "state_bucket_policy" {
  command = plan

  assert {
    condition = jsondecode(aws_s3_bucket_policy.state.policy).Statement == [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = ["arn:aws:s3:::cv-tailor-tfstate-111111111111", "arn:aws:s3:::cv-tailor-tfstate-111111111111/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyBucketDeletion"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:DeleteBucket"
        Resource  = "arn:aws:s3:::cv-tailor-tfstate-111111111111"
      },
    ]
    error_message = "The bucket policy must deny plain HTTP and bucket deletion, and nothing else."
  }
}

run "state_key" {
  command = plan

  assert {
    condition     = aws_kms_key.state.enable_key_rotation && aws_kms_key.state.deletion_window_in_days == 30
    error_message = "The key must rotate yearly, and a deletion must wait 30 days."
  }

  assert {
    condition     = aws_kms_alias.state.name == "alias/cv-tailor-tfstate"
    error_message = "Every other stack's encryption block names the key by this alias."
  }

  assert {
    condition = jsondecode(aws_kms_key.state.policy).Statement == [{
      Sid       = "DelegateToIam"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::111111111111:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
    error_message = "The key policy must only delegate to IAM in the same account."
  }
}

run "refuses_a_bad_account_id" {
  command = plan

  variables {
    account_id = "12345"
  }

  expect_failures = [var.account_id]
}

run "refuses_an_unknown_environment" {
  command = plan

  variables {
    environment = "test"
  }

  expect_failures = [var.environment]
}
