#!/usr/bin/env bash
# Uploads the web app after the workload apply (S2-04, S3-15). It replaces the CDK app's
# BucketDeployment, with the same order and cache rules.
#
#   scripts/deploy-web.sh <env>
#
# Needs the web app's build (apps/web/dist) and AWS credentials for the environment: CI's
# GithubDeployRole, or an SSO profile on a laptop.
set -euo pipefail

env=${1:-}
if [[ $env != dev && $env != stag && $env != prod ]]; then
  echo "Usage: $0 <dev|stag|prod>" >&2
  exit 2
fi

INFRA_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SITE_DIR="$INFRA_DIR/../apps/web/dist"
if [[ ! -f $SITE_DIR/index.html ]]; then
  echo "Build the web app first: pnpm --filter @cv-tailor/web run build" >&2
  exit 1
fi

outputs=$("$INFRA_DIR/scripts/tofu.sh" "$env" workload output -json)
bucket=$(jq -r '.site_bucket.value' <<<"$outputs")
distribution=$(jq -r '.distribution_id.value' <<<"$outputs")

# Checked against the WebConfig contract before anything is uploaded.
config=$(mktemp)
trap 'rm -f "$config"' EXIT
node "$INFRA_DIR/scripts/web-config.ts" <<<"$outputs" >"$config"

# 1. Hashed files: a new name for every change, so browsers keep them for a year. Old ones stay
#    (no --delete), so a tab opened before a deploy can still load its chunks.
aws s3 sync "$SITE_DIR/assets" "s3://$bucket/assets" \
  --cache-control "public, max-age=31536000, immutable"

# 2. index.html and the other entry files: browsers check for a new version on every load. After
#    the assets, so index.html never points at a file that isn't there yet. --delete removes entry
#    files that are gone, and the excludes keep it away from the hashed files and config.json.
aws s3 sync "$SITE_DIR" "s3://$bucket" \
  --exclude "assets/*" --exclude "config.json" --delete \
  --cache-control "no-cache"
aws s3 cp "$config" "s3://$bucket/config.json" \
  --content-type "application/json" --cache-control "no-cache"

# 3. Browsers get the new entry files at once, not after CloudFront's cache expires.
aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' \
  --query 'Invalidation.Id' --output text
