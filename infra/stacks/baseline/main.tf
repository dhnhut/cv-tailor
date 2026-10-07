# Account-level controls for one environment (S1-09, S2-11): the monthly budget and the kill switch.
# Applied from a laptop only. GithubDeployRole can't change either (ADR-0013 §5).

module "settings" {
  source = "../../modules/settings"

  environment = var.environment
}

module "budget" {
  source = "../../modules/budget"

  name              = "${module.settings.name_prefix}-monthly"
  monthly_limit_usd = module.settings.monthly_budget_usd
  alert_email       = var.alert_email
}

module "kill_switch" {
  source = "../../modules/kill-switch"

  initial_value = module.settings.ai_calls_initial
}
