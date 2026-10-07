output "url" {
  description = "The API's URL."
  value       = "https://${local.domain_name}"
}

output "function_policies" {
  description = "Each function's policy JSON, which tests compare exactly."
  value       = { for name, fn in module.functions : name => fn.policy }
}
