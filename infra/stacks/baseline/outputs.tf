output "budget_name" {
  description = "The monthly budget's name."
  value       = module.budget.name
}

output "kill_switch_parameter" {
  description = "The kill switch parameter's name."
  value       = module.kill_switch.parameter_name
}
