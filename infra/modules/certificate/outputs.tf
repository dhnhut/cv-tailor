output "certificate_arn" {
  description = "The issued certificate's ARN."
  value       = aws_acm_certificate_validation.this.certificate_arn
}
