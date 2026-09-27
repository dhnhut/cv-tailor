#!/usr/bin/env bash
# Read-only AWS service availability check for CV Tailor (S0-07).
#
# Usage: bash scripts/aws-service-check.sh --profile <aws-profile> [--regions "r1 r2 ..."]
#   --regions defaults to the project region, us-east-1 (ADR-0002).
#
# Every call is a read-only list/describe/get call. Nothing is created or changed.
# Output is Markdown, so it can be compared with docs/cloud/service-availability.md.
#
# Result codes per API probe:
#   OK           the call succeeded, so the service is available in that region
#   DENIED       IAM denied the call; the endpoint exists, so the service is available
#   NOT_OFFERED  the endpoint exists but says the account can't use this API in the region
#   NO_ENDPOINT  no service endpoint in that region
#   ERR(<code>)  any other error; check it by hand

set -uo pipefail

PROFILE=""
REGIONS="us-east-1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --regions) REGIONS="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "Missing --profile <aws-profile>" >&2
  exit 2
fi

AWS=(aws --profile "$PROFILE" --cli-connect-timeout 5 --cli-read-timeout 15 --output json)

# Runs one probe in one region and prints its result code.
probe() {
  local region=$1; shift
  local err
  if err=$("${AWS[@]}" "$@" --region "$region" 2>&1 >/dev/null); then
    echo "OK"
  elif grep -qiE 'Could not connect to the endpoint|Connect timeout|Name or service not known' <<<"$err"; then
    echo "NO_ENDPOINT"
  elif grep -qi 'Your account is not authorized to invoke this API operation' <<<"$err"; then
    echo "NOT_OFFERED"
  elif grep -qiE 'AccessDenied|not authorized to perform|UnauthorizedOperation' <<<"$err"; then
    echo "DENIED"
  else
    local code
    code=$(grep -oE '\([A-Za-z]+(Exception|Error)?\)' <<<"$err" | head -1 | tr -d '()')
    echo "ERR(${code:-unknown})"
  fi
}

# label | aws cli arguments (read-only)
CHECKS=(
  "AgentCore Runtime|bedrock-agentcore-control list-agent-runtimes"
  "AgentCore Memory|bedrock-agentcore-control list-memories"
  "AgentCore Gateway|bedrock-agentcore-control list-gateways"
  "AgentCore Browser|bedrock-agentcore-control list-browsers"
  "AgentCore Evaluations|bedrock-agentcore-control list-evaluators"
  "AgentCore Policy|bedrock-agentcore-control list-policy-engines"
  "Bedrock foundation models|bedrock list-foundation-models"
  "Bedrock inference profiles|bedrock list-inference-profiles"
  "Bedrock Guardrails|bedrock list-guardrails"
  "Bedrock Knowledge Bases|bedrock-agent list-knowledge-bases"
  "Cognito user pools|cognito-idp list-user-pools --max-results 1"
  "API Gateway REST|apigateway get-rest-apis"
  "API Gateway HTTP/WebSocket|apigatewayv2 get-apis"
  "Lambda|lambda list-functions --max-items 1"
  "DynamoDB|dynamodb list-tables"
  "S3|s3api list-buckets --max-items 1"
  "SQS|sqs list-queues"
  "Step Functions|stepfunctions list-state-machines"
  "SSM Parameter Store|ssm describe-parameters --max-results 1"
  "Secrets Manager|secretsmanager list-secrets --max-results 1"
  "S3 Vectors (vector store)|s3vectors list-vector-buckets"
  "OpenSearch Serverless (vector store)|opensearchserverless list-collections"
  "Aurora PostgreSQL (vector store)|rds describe-db-engine-versions --engine aurora-postgresql --max-items 1"
)

# SSM global-infrastructure service names to cross-check (this list can lag behind).
SSM_NAMES="bedrock bedrock-runtime bedrock-agentcore cognito-idp apigateway apigatewayv2 lambda dynamodb s3 sqs stepfunctions ssm secretsmanager s3vectors opensearchserverless aurora budgets cloudfront"

header() {
  local line="| $1 |" sep="| --- |" r
  for r in $REGIONS; do line+=" $r |"; sep+=" --- |"; done
  echo "$line"; echo "$sep"
}

identity=$("${AWS[@]}" sts get-caller-identity --region us-east-1 --query Account --output text) || {
  echo "Cannot call sts:GetCallerIdentity with profile '$PROFILE'." >&2
  exit 1
}

echo "# AWS service check"
echo
echo "- Date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "- Account: $identity"
echo "- Profile: $PROFILE"
echo

echo "## Region opt-in status"
echo
echo "| Region | Opt-in status |"
echo "| --- | --- |"
for r in $REGIONS; do
  status=$("${AWS[@]}" ec2 describe-regions --all-regions --region us-east-1 \
    --query "Regions[?RegionName=='$r'].OptInStatus | [0]" --output text 2>/dev/null)
  echo "| $r | ${status:-unknown} |"
done
echo

echo "## API probes"
echo
header "Service"
for check in "${CHECKS[@]}"; do
  label=${check%%|*}
  read -r -a args <<<"${check#*|}"
  line="| $label |"
  for r in $REGIONS; do line+=" $(probe "$r" "${args[@]}") |"; done
  echo "$line"
done
echo

echo "## Global services"
echo
echo "| Service | Result |"
echo "| --- | --- |"
echo "| Budgets (us-east-1 endpoint) | $(probe us-east-1 budgets describe-budgets --account-id "$identity" --max-results 1) |"
echo "| CloudFront (global) | $(probe us-east-1 cloudfront list-distributions --max-items 1) |"
echo

echo "## Bedrock models"
echo
header "Item"
row_emb="| Embedding models (on-demand) |"
row_au="| Claude \`au.\` inference profiles |"
row_glob="| Claude \`global.\` inference profiles |"
for r in $REGIONS; do
  emb=$("${AWS[@]}" bedrock list-foundation-models --by-output-modality EMBEDDING --by-inference-type ON_DEMAND \
    --region "$r" --query 'modelSummaries[].modelId' --output text 2>/dev/null | wc -w | tr -d ' ')
  profiles=$("${AWS[@]}" bedrock list-inference-profiles --region "$r" \
    --query 'inferenceProfileSummaries[].inferenceProfileId' --output text 2>/dev/null | tr '\t' '\n')
  au=$(grep -c '^au\.anthropic\.' <<<"$profiles")
  glob=$(grep -c '^global\.anthropic\.' <<<"$profiles")
  row_emb+=" $emb |"; row_au+=" $au |"; row_glob+=" $glob |"
done
echo "$row_emb"; echo "$row_au"; echo "$row_glob"
echo

for r in $REGIONS; do
  echo "<details><summary>Claude <code>au.</code> profiles in $r</summary>"
  echo
  "${AWS[@]}" bedrock list-inference-profiles --region "$r" \
    --query 'inferenceProfileSummaries[].inferenceProfileId' --output text 2>/dev/null \
    | tr '\t' '\n' | grep '^au\.anthropic\.' | sort | sed 's/^/- /'
  echo
  echo "</details>"
  echo
done

echo "## SSM global-infrastructure cross-check"
echo
echo "Source: \`/aws/service/global-infrastructure/regions/<region>/services\`. This list can lag behind real availability."
echo
header "SSM service name"
declare -A ssm_lists
for r in $REGIONS; do
  ssm_lists[$r]=$("${AWS[@]}" ssm get-parameters-by-path --region us-east-1 \
    --path "/aws/service/global-infrastructure/regions/$r/services" \
    --query 'Parameters[].Value' --output text 2>/dev/null | tr '\t' '\n')
done
for name in $SSM_NAMES; do
  line="| $name |"
  for r in $REGIONS; do
    if grep -qx "$name" <<<"${ssm_lists[$r]}"; then line+=" listed |"; else line+=" - |"; fi
  done
  echo "$line"
done
