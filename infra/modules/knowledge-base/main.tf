# The knowledge base for one environment (S3-06, ADR-0007): the documents bucket, a Bedrock Managed
# Knowledge Base, and an ACL-enabled S3 data source. The bucket holds user data, so it has the data
# table's guards: a fixed name, versioning (as PITR), a deny on DeleteBucket (as deletion
# protection), and prevent_destroy.

locals {
  # Built from names, so a plan shows each policy in full.
  bucket_arn = "arn:aws:s3:::${var.bucket_name}"
}

resource "aws_s3_bucket" "documents" {
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced" # no object ACLs
  }
}

# S3-managed keys: no fixed cost, and no key policy for Bedrock to need (S3-06).
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "ExpireOldVersions"
    status = "Enabled"

    filter {}

    # Old versions are kept as long as PITR keeps the table's items (S2-08).
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    # Tidy up once a deleted document's versions are gone.
    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.documents]
}

# The browser uploads with a presigned PUT (S3-07), sending the two signed headers below.
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_origins = [var.web_origin]
    allowed_methods = ["PUT"]
    allowed_headers = ["content-type", "x-amz-checksum-sha256"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id

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
        # S3 has no deletion protection, so this deny plays its part. To delete the bucket on
        # purpose, remove this statement first.
        Sid       = "DenyBucketDeletion"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:DeleteBucket"
        Resource  = local.bucket_arn
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# AWS's documented service role for a managed knowledge base with an S3 source
# (kb-managed-permissions). Managed embedding and reranking need no model permissions.
resource "aws_iam_role" "knowledge_base" {
  name                 = "${var.knowledge_base_name}-service"
  path                 = var.role_path
  permissions_boundary = var.permissions_boundary_arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${var.account_id}:knowledge-base/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "knowledge_base" {
  name = "ReadDocuments"
  role = aws_iam_role.knowledge_base.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = local.bucket_arn
        Condition = { StringEquals = { "aws:ResourceAccount" = var.account_id } }
      },
      {
        Effect    = "Allow"
        Action    = "s3:GetObject"
        Resource  = "${local.bucket_arn}/*"
        Condition = { StringEquals = { "aws:ResourceAccount" = var.account_id } }
      },
    ]
  })
}

resource "aws_bedrockagent_knowledge_base" "this" {
  name        = var.knowledge_base_name
  description = "Candidate documents, with one ACL per document (ADR-0007)"
  role_arn    = aws_iam_role.knowledge_base.arn

  knowledge_base_configuration {
    type = "MANAGED"

    managed_knowledge_base_configuration {
      embedding_model_type = "MANAGED"
    }
  }

  # The S3 permissions exist before Bedrock first uses the role.
  depends_on = [aws_iam_role_policy.knowledge_base]
}

# No chunking settings: the default can't be changed after creation, so a change means a new data
# source (ADR-0007).
resource "aws_bedrockagent_data_source" "documents" {
  knowledge_base_id    = aws_bedrockagent_knowledge_base.this.id
  name                 = "documents"
  data_deletion_policy = "DELETE" # the index is rebuilt from the bucket, so nothing is lost

  data_source_configuration {
    type = "MANAGED_KNOWLEDGE_BASE_CONNECTOR"

    managed_knowledge_base_connector_configuration {
      # Free-form JSON: nothing checks these names before apply, so the test pins them. aclEnabled
      # can't change after creation, and a document without an ACL is not ingested. Every key the
      # service returns is set here, so it adds none. If a plan ever shows this changing only in
      # key order (provider issue #50065), see the deploy runbook.
      connector_parameters = jsonencode({
        type    = "S3"
        version = "1"
        # A numeric string, as the connector expects. The service default is "500".
        filterConfiguration = { maxFileSizeInMegaBytes = tostring(var.max_file_size_mb) }
        aclEnabled          = true
        connectionConfiguration = {
          bucketName           = var.bucket_name
          bucketOwnerAccountId = var.account_id
        }
      })

      # KB-03 allows no media types, and images inside a PDF or DOCX (such as a CV photo) are
      # personal data the agents don't need (SAFE-04). The service turns image extraction on by
      # default.
      media_extraction_configuration {
        image_extraction_configuration {
          image_extraction_status = "DISABLED"
        }
        audio_extraction_configuration {
          audio_extraction_status = "DISABLED"
        }
        video_extraction_configuration {
          video_extraction_status = "DISABLED"
        }
      }

      # Deletion protection skips a sync's delete phase when it would delete more than a share of
      # the index. With one shared knowledge base and few documents, one candidate's delete can
      # pass it, and the deleted document would stay retrievable. The bucket's versioning guards
      # against bulk deletion instead.
      deletion_protection_configuration {
        deletion_protection_status = "DISABLED"
      }
    }
  }
}

# Read by the API (S3-07) and the agent runtime (S3-10) at run time.
resource "aws_ssm_parameter" "knowledge_base_id" {
  name        = "/cv-tailor/knowledge-base/id"
  description = "ID of the ${var.knowledge_base_name} knowledge base (S3-06)"
  type        = "String"
  value       = aws_bedrockagent_knowledge_base.this.id
}

resource "aws_ssm_parameter" "data_source_id" {
  name        = "/cv-tailor/knowledge-base/data-source-id"
  description = "ID of the documents data source in ${var.knowledge_base_name} (S3-06)"
  type        = "String"
  value       = aws_bedrockagent_data_source.documents.data_source_id
}

resource "aws_ssm_parameter" "bucket_name" {
  name        = "/cv-tailor/knowledge-base/bucket-name"
  description = "Name of the candidate documents bucket (S3-06)"
  type        = "String"
  value       = aws_s3_bucket.documents.bucket
}
