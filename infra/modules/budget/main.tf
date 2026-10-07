# Monthly cost budget for one account (S1-09, AGENTS.md §8). It's in the baseline stack, which is
# applied from a laptop only, so a CI deploy can't change it.

locals {
  # Alert thresholds, as a percentage of the monthly amount (S1-09).
  alerts = concat(
    [for threshold in [25, 50, 80, 100] : { type = "ACTUAL", threshold = threshold }],
    [{ type = "FORECASTED", threshold = 100 }],
  )
}

resource "aws_budgets_budget" "monthly_cost" {
  name         = var.name
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = format("%.2f", var.monthly_limit_usd)
  limit_unit   = "USD"

  # Credits would hide real usage until they run out, so track spend before credits. The other cost
  # types keep their defaults, as in the CloudFormation budget before S3-15.
  cost_types {
    include_credit = false
  }

  dynamic "notification" {
    for_each = local.alerts

    content {
      notification_type          = notification.value.type
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}
