output "deploy_role_arn" {
  description = "GithubDeployRole's ARN, which deploy.yml assumes."
  value       = aws_iam_role.deploy.arn
}

output "oidc_provider_arn" {
  description = "The GitHub OIDC provider's ARN."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "workload_boundary_arn" {
  description = "The permissions boundary every workload role must carry."
  value       = aws_iam_policy.workload_boundary.arn
}
