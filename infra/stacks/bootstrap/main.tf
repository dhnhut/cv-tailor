# The state bucket and the state encryption key for one account (S3-15, ADR-0013 §4). It replaces
# `cdk bootstrap`. Applied once per account from a laptop, before any other stack.

locals {
  # Bucket names are global, so the account ID keeps another account from taking the name first.
  bucket_name = "cv-tailor-tfstate-${var.account_id}"
  # Built from the name, not read from the bucket, so a plan shows the policy in full.
  bucket_arn = "arn:aws:s3:::${local.bucket_name}"
  key_alias  = "alias/cv-tailor-tfstate" # every other stack's `encryption` block names it
}

# Encrypts state and plan files on the client before they're written (OpenTofu state encryption),
# and the state bucket at rest. Losing it makes every state unreadable, so it can't be destroyed by
# OpenTofu, and a scheduled deletion waits 30 days.
resource "aws_kms_key" "state" {
  description             = "OpenTofu state and plan encryption (ADR-0013 section 4)"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  # The account's IAM policies decide who may use the key: SSO administrators and GithubDeployRole
  # (access stack). This is AWS's default key policy, written out so it's reviewed.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DelegateToIam"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "state" {
  name          = local.key_alias
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

# Every apply writes a new version, so an earlier state can be restored after a bad apply.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced" # no object ACLs
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
    bucket_key_enabled = true # fewer KMS requests, so a lower cost
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "ExpireOldStateVersions"
    status = "Enabled"

    filter {}

    # 90 days of history is enough to recover from a bad apply.
    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    # Each run creates and deletes a lock file, which leaves delete markers behind.
    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [local.bucket_arn, "${local.bucket_arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # S3 has no deletion protection, so this deny plays its part, as on the documents bucket.
        # To delete the bucket on purpose, remove this statement first.
        Sid       = "DenyBucketDeletion"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:DeleteBucket"
        Resource  = local.bucket_arn
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}
