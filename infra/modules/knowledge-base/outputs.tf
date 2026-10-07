output "bucket_name" {
  description = "The documents bucket's name."
  value       = aws_s3_bucket.documents.bucket
}

output "knowledge_base_id" {
  description = "The knowledge base's ID."
  value       = aws_bedrockagent_knowledge_base.this.id
}

output "data_source_id" {
  description = "The documents data source's ID."
  value       = aws_bedrockagent_data_source.documents.data_source_id
}
