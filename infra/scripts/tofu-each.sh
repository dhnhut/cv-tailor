#!/usr/bin/env bash
# Runs `tofu validate` or `tofu test` in every stack (pnpm run build / pnpm run test). Needs no AWS
# access: init skips the backend, and the tests use a mocked AWS provider (ADR-0013 §9).
#
#   scripts/tofu-each.sh validate
#   scripts/tofu-each.sh test
set -euo pipefail

command=${1:-}
if [[ $command != validate && $command != test ]]; then
  echo "Usage: $0 <validate|test>" >&2
  exit 2
fi

INFRA_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export TF_IN_AUTOMATION=1
export TF_PLUGIN_CACHE_DIR=${TF_PLUGIN_CACHE_DIR:-$HOME/.cache/opentofu/plugins}
mkdir -p "$TF_PLUGIN_CACHE_DIR"

shopt -s nullglob
for dir in "$INFRA_DIR"/stacks/*/; do
  dir=${dir%/}
  echo "==> stacks/$(basename "$dir"): tofu $command"
  # Its own working directory, apart from the per-environment ones that tofu.sh uses.
  export TF_DATA_DIR="$dir/.terraform-check"
  if ! output=$(tofu -chdir="$dir" init -backend=false -input=false -lockfile=readonly 2>&1); then
    echo "$output" >&2
    exit 1
  fi
  tofu -chdir="$dir" "$command" -no-color
done
