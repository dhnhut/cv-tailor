# TFLint settings for every module and stack (S3-15, ADR-0013 §9). Run by scripts/lint-tofu.sh.

config {
  # Follow local module calls, so a stack's values are checked inside its modules too.
  call_module_type = "local"
}

# The built-in ruleset, with every rule on: typed and documented variables and outputs, naming,
# pinned versions, the standard module layout (main.tf, variables.tf, outputs.tf), and unused code.
plugin "terraform" {
  enabled = true
  preset  = "all"
}

# AWS checks, such as invalid instance types, runtimes, and IAM policy JSON.
plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
