# The kill switch (S2-11, ADMIN-03), read by the AI call guard (services/agents,
# cv_tailor_agents/ai_guard/kill_switch.py) and, from S3-12, by the API. It's in the baseline stack,
# which is applied from a laptop only, so a CI deploy can't change it.
resource "aws_ssm_parameter" "ai_calls" {
  name        = "/cv-tailor/ai-calls"
  description = "Kill switch for every AI call (ADMIN-03). See docs/runbooks/kill-switch.md."
  type        = "String"
  tier        = "Standard"
  value       = var.initial_value

  # SSM rejects any other value, so a typo in put-parameter fails loudly.
  allowed_pattern = "^(enabled|disabled)$"

  lifecycle {
    # The value is set with `aws ssm put-parameter` (kill switch runbook). The committed value is
    # used only when the parameter is created, so an apply never resets the switch. CloudFormation
    # couldn't do this (S3-15).
    ignore_changes = [value]
  }
}
