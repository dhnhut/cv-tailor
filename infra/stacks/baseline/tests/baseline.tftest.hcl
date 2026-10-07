# The baseline stack: the monthly budget (S1-09) and the kill switch (S2-11). No AWS access: the
# provider is mocked, and every run only plans.

mock_provider "aws" {}

variables {
  environment = "dev"
  account_id  = "111111111111"
  alert_email = "alerts@example.com"
}

run "budget_alerts" {
  command = plan

  module {
    source = "../../modules/budget"
  }

  variables {
    name              = "cv-tailor-dev-monthly"
    monthly_limit_usd = 5
  }

  assert {
    condition = (
      aws_budgets_budget.monthly_cost.budget_type == "COST"
      && aws_budgets_budget.monthly_cost.time_unit == "MONTHLY"
      && aws_budgets_budget.monthly_cost.limit_amount == "5.00"
      && aws_budgets_budget.monthly_cost.limit_unit == "USD"
    )
    error_message = "The budget must be a monthly cost budget of USD 5.00."
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.cost_types[0].include_credit == false
    error_message = "Credits must not hide real spend."
  }

  assert {
    condition = toset([
      for n in aws_budgets_budget.monthly_cost.notification :
      "${n.notification_type} ${n.comparison_operator} ${n.threshold} ${n.threshold_type}"
      ]) == toset([
      "ACTUAL GREATER_THAN 25 PERCENTAGE",
      "ACTUAL GREATER_THAN 50 PERCENTAGE",
      "ACTUAL GREATER_THAN 80 PERCENTAGE",
      "ACTUAL GREATER_THAN 100 PERCENTAGE",
      "FORECASTED GREATER_THAN 100 PERCENTAGE",
    ])
    error_message = "Alerts must fire at 25, 50, 80, and 100% actual, and 100% forecast."
  }

  assert {
    condition = alltrue([
      for n in aws_budgets_budget.monthly_cost.notification :
      n.subscriber_email_addresses == toset(["alerts@example.com"])
    ])
    error_message = "Every alert must go to the alert email, and only there."
  }
}

run "budget_refuses_a_bad_email" {
  command = plan

  module {
    source = "../../modules/budget"
  }

  variables {
    name              = "cv-tailor-dev-monthly"
    monthly_limit_usd = 5
    alert_email       = "not-an-email"
  }

  expect_failures = [var.alert_email]
}

run "kill_switch" {
  command = plan

  module {
    source = "../../modules/kill-switch"
  }

  variables {
    initial_value = "enabled"
  }

  assert {
    condition = (
      aws_ssm_parameter.ai_calls.name == "/cv-tailor/ai-calls"
      && aws_ssm_parameter.ai_calls.type == "String"
      && aws_ssm_parameter.ai_calls.tier == "Standard"
      && aws_ssm_parameter.ai_calls.value == "enabled"
    )
    error_message = "The kill switch must be the standard String parameter /cv-tailor/ai-calls, holding the initial value."
  }

  assert {
    condition     = aws_ssm_parameter.ai_calls.allowed_pattern == "^(enabled|disabled)$"
    error_message = "SSM must refuse any value other than enabled or disabled."
  }

  # The guard in services/agents reads the parameter by name, so the two must match.
  assert {
    condition     = strcontains(file("../../../services/agents/src/cv_tailor_agents/ai_guard/kill_switch.py"), "PARAMETER_NAME = \"${aws_ssm_parameter.ai_calls.name}\"")
    error_message = "The AI call guard must read the kill switch parameter by the same name."
  }
}

run "kill_switch_refuses_a_bad_value" {
  command = plan

  module {
    source = "../../modules/kill-switch"
  }

  variables {
    initial_value = "on"
  }

  expect_failures = [var.initial_value]
}

run "stack_uses_the_environment_settings" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition     = output.budget_name == "cv-tailor-prod-monthly"
    error_message = "The budget must be named after the environment."
  }

  assert {
    condition     = module.budget.name == "cv-tailor-prod-monthly"
    error_message = "The budget module must get the environment's name."
  }
}
