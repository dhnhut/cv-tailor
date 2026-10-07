output "parameter_name" {
  description = "The kill switch parameter's name."
  value       = aws_ssm_parameter.ai_calls.name
}
