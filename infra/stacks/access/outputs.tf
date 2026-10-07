output "deploy_role_arn" {
  description = "GithubDeployRole's ARN, which deploy.yml assumes."
  value       = module.oidc.deploy_role_arn
}

output "workload_boundary_arn" {
  description = "The permissions boundary every workload role must carry."
  value       = module.oidc.workload_boundary_arn
}
