#!/usr/bin/env bash
# Lints the OpenTofu code (pnpm run lint, ADR-0013 §9): formatting, TFLint with the AWS ruleset,
# and Trivy's misconfiguration scan. Trivy fails on HIGH or CRITICAL findings. An accepted finding
# is listed in .trivyignore.yaml with its reason.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> tofu fmt"
tofu fmt -check -recursive -diff

echo "==> tflint"
tflint --init --config="$PWD/.tflint.hcl" >/dev/null
tflint --recursive --config="$PWD/.tflint.hcl"

echo "==> trivy config"
trivy config --quiet --exit-code 1 --severity HIGH,CRITICAL \
  --ignorefile .trivyignore.yaml \
  --skip-dirs node_modules --skip-dirs '**/.terraform-*' \
  .
