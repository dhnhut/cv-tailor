# The data table (S2-08, ADR-0006) and the knowledge base (S3-06, ADR-0007). No AWS access: the
# provider is mocked, and every run only plans.

mock_provider "aws" {
  # The provider checks that ARN arguments parse as ARNs, which the mock's random strings don't.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/cv-tailor/workload/mock" }
  }
}

run "data_table" {
  command = plan

  module {
    source = "../../modules/data"
  }

  variables {
    table_name = "cv-tailor-dev-data"
  }

  assert {
    condition = (
      aws_dynamodb_table.this.name == "cv-tailor-dev-data"
      && aws_dynamodb_table.this.billing_mode == "PAY_PER_REQUEST"
      && aws_dynamodb_table.this.hash_key == "PK"
      && aws_dynamodb_table.this.range_key == "SK"
    )
    error_message = "The table is on-demand, keyed by PK and SK."
  }

  assert {
    condition     = aws_dynamodb_table.this.ttl[0].attribute_name == "expiresAt" && aws_dynamodb_table.this.ttl[0].enabled
    error_message = "Items expire by expiresAt."
  }

  assert {
    condition     = aws_dynamodb_table.this.point_in_time_recovery[0].enabled && aws_dynamodb_table.this.deletion_protection_enabled
    error_message = "The table holds user data: PITR and deletion protection are on."
  }

  assert {
    condition     = length(aws_dynamodb_table.this.replica) == 0
    error_message = "One region only (ADR-0002)."
  }
}

run "knowledge_base" {
  command = plan

  module {
    source = "../../modules/knowledge-base"
  }

  variables {
    bucket_name              = "cv-tailor-dev-documents-111111111111"
    knowledge_base_name      = "cv-tailor-dev-kb"
    web_origin               = "https://dev.cv.ikiwii.com"
    region                   = "us-east-1"
    account_id               = "111111111111"
    role_path                = "/cv-tailor/workload/"
    permissions_boundary_arn = "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
  }

  # --- The bucket ---

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.documents.block_public_acls,
      aws_s3_bucket_public_access_block.documents.block_public_policy,
      aws_s3_bucket_public_access_block.documents.ignore_public_acls,
      aws_s3_bucket_public_access_block.documents.restrict_public_buckets,
      aws_s3_bucket_ownership_controls.documents.rule[0].object_ownership == "BucketOwnerEnforced",
      one(aws_s3_bucket_server_side_encryption_configuration.documents.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256",
      aws_s3_bucket_versioning.documents.versioning_configuration[0].status == "Enabled",
    ])
    error_message = "The documents bucket is private, without ACLs, encrypted, and versioned."
  }

  assert {
    condition = (
      aws_s3_bucket_lifecycle_configuration.documents.rule[0].noncurrent_version_expiration[0].noncurrent_days == 35
      && aws_s3_bucket_lifecycle_configuration.documents.rule[0].expiration[0].expired_object_delete_marker
      && aws_s3_bucket_lifecycle_configuration.documents.rule[0].abort_incomplete_multipart_upload[0].days_after_initiation == 1
    )
    error_message = "Old versions are kept 35 days, as long as PITR keeps the table's items."
  }

  assert {
    condition = (
      one(aws_s3_bucket_cors_configuration.documents.cors_rule).allowed_origins == toset(["https://dev.cv.ikiwii.com"])
      && one(aws_s3_bucket_cors_configuration.documents.cors_rule).allowed_methods == toset(["PUT"])
      && one(aws_s3_bucket_cors_configuration.documents.cors_rule).allowed_headers == toset(["content-type", "x-amz-checksum-sha256"])
      && one(aws_s3_bucket_cors_configuration.documents.cors_rule).max_age_seconds == 3600
    )
    error_message = "Only the web app may upload directly, with a presigned PUT and its two signed headers."
  }

  assert {
    condition = [for s in jsondecode(aws_s3_bucket_policy.documents.policy).Statement : [s.Sid, s.Effect, s.Action]] == [
      ["DenyInsecureTransport", "Deny", "s3:*"],
      ["DenyBucketDeletion", "Deny", "s3:DeleteBucket"],
    ]
    error_message = "The bucket refuses plain HTTP and bucket deletion to everyone."
  }

  # --- The service role ---

  assert {
    condition = jsondecode(aws_iam_role.knowledge_base.assume_role_policy).Statement[0].Condition == {
      StringEquals = { "aws:SourceAccount" = "111111111111" }
      ArnLike      = { "aws:SourceArn" = "arn:aws:bedrock:us-east-1:111111111111:knowledge-base/*" }
    }
    error_message = "Only Bedrock, for knowledge bases in this account, may assume the role."
  }

  assert {
    condition     = [for s in jsondecode(aws_iam_role_policy.knowledge_base.policy).Statement : [s.Action, s.Resource]] == [["s3:ListBucket", "arn:aws:s3:::cv-tailor-dev-documents-111111111111"], ["s3:GetObject", "arn:aws:s3:::cv-tailor-dev-documents-111111111111/*"]]
    error_message = "The service role may only list the bucket and read its objects."
  }

  assert {
    condition     = aws_iam_role.knowledge_base.path == "/cv-tailor/workload/" && aws_iam_role.knowledge_base.permissions_boundary == "arn:aws:iam::111111111111:policy/cv-tailor/CvTailorWorkloadBoundary"
    error_message = "The role must be under the workload path and carry the boundary."
  }

  # --- The knowledge base and its data source ---

  assert {
    condition = (
      aws_bedrockagent_knowledge_base.this.name == "cv-tailor-dev-kb"
      && aws_bedrockagent_knowledge_base.this.knowledge_base_configuration[0].type == "MANAGED"
      && aws_bedrockagent_knowledge_base.this.knowledge_base_configuration[0].managed_knowledge_base_configuration[0].embedding_model_type == "MANAGED"
    )
    error_message = "One managed knowledge base with managed embedding."
  }

  # Free-form JSON that nothing checks before apply, and aclEnabled can't change after creation.
  assert {
    condition = jsondecode(aws_bedrockagent_data_source.documents.data_source_configuration[0].managed_knowledge_base_connector_configuration[0].connector_parameters) == {
      type                    = "S3"
      version                 = "1"
      aclEnabled              = true
      connectionConfiguration = { bucketName = "cv-tailor-dev-documents-111111111111", bucketOwnerAccountId = "111111111111" }
      filterConfiguration     = { maxFileSizeInMegaBytes = "50" }
    }
    error_message = "connectorParameters must be exactly: S3, ACLs on, this bucket, a 50 MB filter."
  }

  assert {
    condition = (
      aws_bedrockagent_data_source.documents.name == "documents"
      && aws_bedrockagent_data_source.documents.data_deletion_policy == "DELETE"
      && aws_bedrockagent_data_source.documents.data_source_configuration[0].type == "MANAGED_KNOWLEDGE_BASE_CONNECTOR"
    )
    error_message = "One data source, the managed connector, whose index is rebuilt from the bucket."
  }

  assert {
    condition = [
      aws_bedrockagent_data_source.documents.data_source_configuration[0].managed_knowledge_base_connector_configuration[0].media_extraction_configuration[0].image_extraction_configuration[0].image_extraction_status,
      aws_bedrockagent_data_source.documents.data_source_configuration[0].managed_knowledge_base_connector_configuration[0].media_extraction_configuration[0].audio_extraction_configuration[0].audio_extraction_status,
      aws_bedrockagent_data_source.documents.data_source_configuration[0].managed_knowledge_base_connector_configuration[0].media_extraction_configuration[0].video_extraction_configuration[0].video_extraction_status,
      aws_bedrockagent_data_source.documents.data_source_configuration[0].managed_knowledge_base_connector_configuration[0].deletion_protection_configuration[0].deletion_protection_status,
    ] == ["DISABLED", "DISABLED", "DISABLED", "DISABLED"]
    error_message = "No media extraction (SAFE-04), and no deletion protection, which could keep a deleted document retrievable."
  }

  assert {
    condition = [aws_ssm_parameter.knowledge_base_id.name, aws_ssm_parameter.data_source_id.name, aws_ssm_parameter.bucket_name.name] == [
      "/cv-tailor/knowledge-base/id", "/cv-tailor/knowledge-base/data-source-id", "/cv-tailor/knowledge-base/bucket-name",
    ]
    error_message = "The API and the agent runtime read these three parameters."
  }
}
