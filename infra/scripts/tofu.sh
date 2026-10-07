#!/usr/bin/env bash
# Runs OpenTofu for one environment and one stack (S3-15, ADR-0013 §2). It's the only way to run
# OpenTofu against AWS: it sets the state bucket and key, and it never runs more than one stack.
#
#   scripts/tofu.sh <env> <stack> <command> [args...]
#   scripts/tofu.sh dev workload plan
#
# Account IDs and the alert email aren't committed (ADR-0004 §2). They come from the shell or from
# infra/.env (see infra/.env.example). A value set in the shell wins.
set -euo pipefail

ENVIRONMENTS=(dev stag prod)
STACKS=(bootstrap access baseline dns workload)

usage() {
  echo "Usage: $0 <dev|stag|prod> <bootstrap|access|baseline|dns|workload> <command> [args...]" >&2
  exit 2
}

contains() {
  local item=$1
  shift
  [[ " $* " == *" $item "* ]]
}

[[ $# -ge 3 ]] || usage
env=$1
stack=$2
shift 2
contains "$env" "${ENVIRONMENTS[@]}" || usage
contains "$stack" "${STACKS[@]}" || usage

INFRA_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STACK_DIR="$INFRA_DIR/stacks/$stack"

if [[ -f "$INFRA_DIR/.env" ]]; then
  while IFS='=' read -r key value || [[ -n $key ]]; do
    [[ $key =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue # skips comments and blank lines
    [[ -n ${!key:-} ]] || export "$key=$value"
  done <"$INFRA_DIR/.env"
fi

account_var="CVT_${env^^}_ACCOUNT_ID"
account=${!account_var:-}
if [[ ! $account =~ ^[0-9]{12}$ ]]; then
  echo "$account_var must be a 12-digit account ID. Set it in the shell or in infra/.env." >&2
  exit 1
fi

export TF_VAR_environment=$env
export TF_VAR_account_id=$account

# Only the budget sends email, so only the baseline stack needs the address.
if [[ $stack == baseline ]]; then
  if [[ ! ${CVT_ALERT_EMAIL:-} =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
    echo "CVT_ALERT_EMAIL must be an email address. Set it in the shell or in infra/.env." >&2
    exit 1
  fi
  export TF_VAR_alert_email=$CVT_ALERT_EMAIL
fi

# One working directory per environment, so switching environments never mixes backends.
export TF_DATA_DIR="$STACK_DIR/.terraform-$env"
export TF_PLUGIN_CACHE_DIR=${TF_PLUGIN_CACHE_DIR:-$HOME/.cache/opentofu/plugins}
mkdir -p "$TF_PLUGIN_CACHE_DIR"

BACKEND_CONFIG=(
  -backend-config="bucket=cv-tailor-tfstate-$account"
  -backend-config="key=$env/$stack.tfstate"
)

# A new account's first run (deploy runbook): the state bucket doesn't exist yet, so the bootstrap
# stack keeps its state in its working directory while it creates the bucket, then moves it in. If
# the apply fails, the local state stays, and running `create` again continues from it.
if [[ $stack == bootstrap && $1 == create ]]; then
  override="$STACK_DIR/backend_override.tf" # gitignored; OpenTofu merges it over versions.tf
  local_state="$TF_DATA_DIR/bootstrap.tfstate"
  trap 'rm -f "$override"' EXIT
  printf 'terraform {\n  backend "local" {\n    path = "%s"\n  }\n}\n' "$local_state" >"$override"
  tofu -chdir="$STACK_DIR" init -input=false -lockfile=readonly -reconfigure
  tofu -chdir="$STACK_DIR" apply
  rm -f "$override"
  tofu -chdir="$STACK_DIR" init -input=false -lockfile=readonly -migrate-state -force-copy "${BACKEND_CONFIG[@]}"
  rm -f "$local_state" "$local_state.backup"
  echo "The bootstrap state is now in s3://cv-tailor-tfstate-$account/$env/bootstrap.tfstate."
  exit 0
fi

if [[ $1 == init ]]; then
  shift
  exec tofu -chdir="$STACK_DIR" init -input=false "${BACKEND_CONFIG[@]}" "$@"
fi

# Init on every run is quick with the plugin cache, and keeps the backend right. The lock file is
# read-only: providers change only through `tofu providers lock` (deploy runbook).
if ! output=$(tofu -chdir="$STACK_DIR" init -input=false -lockfile=readonly "${BACKEND_CONFIG[@]}" 2>&1); then
  echo "$output" >&2
  exit 1
fi

exec tofu -chdir="$STACK_DIR" "$@"
