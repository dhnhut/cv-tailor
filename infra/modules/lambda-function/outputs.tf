output "function_name" {
  description = "The function's name."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "The function's ARN."
  value       = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "The ARN API Gateway uses to invoke the function."
  value       = aws_lambda_function.this.invoke_arn
}

output "policy" {
  description = "The role's inline policy JSON, which tests compare exactly."
  value       = aws_iam_role_policy.this.policy
}
