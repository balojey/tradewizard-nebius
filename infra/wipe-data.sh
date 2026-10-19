#!/usr/bin/env bash
# ============================================================================
# TradeWizard - Wipe All Data
#
# Clears ALL stored data for a given environment: Aurora PostgreSQL tables,
# S3 buckets, DynamoDB tables, EventBridge Schedules, CloudWatch logs,
# and Cognito users.
#
# Usage:
#   ./wipe-data.sh <dev|prod>
#
# Examples:
#   ./wipe-data.sh dev          # Wipe development environment
#   ./wipe-data.sh prod         # Wipe production environment (requires confirmation)
#
# This script does NOT destroy infrastructure - only the data within it.
# The CDK stacks, Lambda functions, API Gateway, etc. remain intact.
# ============================================================================

set -euo pipefail

# ─── Argument Parsing ─────────────────────────────────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: ./wipe-data.sh <dev|prod>"
  exit 1
fi

ENV="$1"

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Error: Environment must be 'dev' or 'prod'"
  exit 1
fi

# ─── Environment Mapping ─────────────────────────────────────────────────────

if [[ "$ENV" == "prod" ]]; then
  PREFIX="tw-prod"
  ENV_LONG="production"
  CDK_OUTPUTS="cdk-outputs-prod.json"
  REGION="us-east-1"
else
  PREFIX="tw-dev"
  ENV_LONG="development"
  CDK_OUTPUTS="cdk-outputs-dev.json"
  REGION="us-east-1"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUTS_FILE="$SCRIPT_DIR/$CDK_OUTPUTS"

if [[ ! -f "$OUTPUTS_FILE" ]]; then
  echo "Error: CDK outputs file not found at $OUTPUTS_FILE"
  echo "Run 'npm run deploy:${ENV}' first to generate it."
  exit 1
fi

# ─── Resource Names from CDK Outputs ─────────────────────────────────────────

DB_SECRET_ARN=$(jq -r '."TradeWizard-'$(echo "$ENV" | sed 's/dev/Dev/;s/prod/Prod/')'-Database".DbSecretArn' "$OUTPUTS_FILE")
S3_ANALYSIS_BUCKET=$(jq -r '."TradeWizard-'$(echo "$ENV" | sed 's/dev/Dev/;s/prod/Prod/')'-Storage".AnalysisBucketName' "$OUTPUTS_FILE")
S3_TRACES_BUCKET=$(jq -r '."TradeWizard-'$(echo "$ENV" | sed 's/dev/Dev/;s/prod/Prod/')'-Storage".TracesBucketName' "$OUTPUTS_FILE")
DYNAMO_DEDUP_TABLE="${PREFIX}-dedup-cache"
DYNAMO_CONNECTIONS_TABLE="${PREFIX}-ws-connections"
DYNAMO_RATE_LIMIT_TABLE="${PREFIX}-rate-limits"
DYNAMO_RENEWAL_DEDUP_TABLE="${PREFIX}-renewal-dedup"
COGNITO_USER_POOL_ID=$(jq -r '."TradeWizard-'$(echo "$ENV" | sed 's/dev/Dev/;s/prod/Prod/')'-Auth".UserPoolId' "$OUTPUTS_FILE")

# ─── Safety Confirmation ─────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          ⚠️  DATA WIPE - ${ENV^^} ENVIRONMENT  ⚠️             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║ This will PERMANENTLY DELETE all data:                      ║"
echo "║                                                             ║"
echo "║  • Aurora PostgreSQL: ALL table rows (schema preserved)     ║"
echo "║  • S3: ALL objects in analysis + traces buckets             ║"
echo "║  • DynamoDB: ALL items in dedup, connections, rate limits   ║"
echo "║  • EventBridge: ALL tw-${ENV}-* schedules                      ║"
echo "║  • CloudWatch: ALL /aws/lambda/${PREFIX}-* log groups         ║"
echo "║  • Cognito: ALL users in the user pool                     ║"
echo "║                                                             ║"
echo "║  THIS IS IRREVERSIBLE.                                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [[ "$ENV" == "prod" ]]; then
  read -p "Type 'WIPE PRODUCTION' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "WIPE PRODUCTION" ]]; then
    echo "Aborted."
    exit 1
  fi
else
  read -p "Type 'yes' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
echo "Starting data wipe for ${ENV}..."
echo ""

# ─── 1. Aurora PostgreSQL - Truncate All Tables ──────────────────────────────

echo "═══ [1/6] Aurora PostgreSQL - Truncating all tables..."

DB_CREDS=$(aws secretsmanager get-secret-value \
  --secret-id "$DB_SECRET_ARN" \
  --region "$REGION" \
  --query SecretString \
  --output text)

DB_HOST=$(echo "$DB_CREDS" | jq -r '.host')
DB_PORT=$(echo "$DB_CREDS" | jq -r '.port')
DB_NAME=$(echo "$DB_CREDS" | jq -r '.dbname')
DB_USER=$(echo "$DB_CREDS" | jq -r '.username')
DB_PASS=$(echo "$DB_CREDS" | jq -r '.password')

PGPASSWORD="$DB_PASS" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --set=sslmode=require \
  -c "
    -- Disable triggers temporarily for clean truncation
    SET session_replication_role = 'replica';

    TRUNCATE TABLE
      portfolio_manager_decisions,
      portfolio_manager_trades,
      portfolio_manager_sessions,
      analysis_deliveries,
      agent_memory,
      agent_performance,
      market_subscribers,
      market_analysis_schedule,
      analysis_results,
      analysis_requests,
      credit_transactions,
      payment_transactions,
      notification_preferences,
      device_endpoints,
      markets,
      subscriptions,
      users
    CASCADE;

    -- Re-enable triggers
    SET session_replication_role = 'origin';
  " 2>&1 | head -5

echo "  ✓ All PostgreSQL tables truncated (schema preserved)"

# ─── 2. S3 - Empty Buckets ──────────────────────────────────────────────────

echo ""
echo "═══ [2/6] S3 - Emptying buckets..."

for BUCKET in "$S3_ANALYSIS_BUCKET" "$S3_TRACES_BUCKET"; do
  if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    aws s3 rm "s3://${BUCKET}" --recursive --region "$REGION" --quiet 2>/dev/null || true
    echo "  ✓ Emptied s3://${BUCKET}"
  else
    echo "  ⊘ Bucket ${BUCKET} not found (skipped)"
  fi
done

# ─── 3. DynamoDB - Delete All Items ─────────────────────────────────────────

echo ""
echo "═══ [3/6] DynamoDB - Clearing all tables..."

wipe_dynamo_table() {
  local TABLE_NAME="$1"

  # Check if table exists
  if ! aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &>/dev/null; then
    echo "  ⊘ Table ${TABLE_NAME} not found (skipped)"
    return
  fi

  # Get key schema
  local KEY_SCHEMA
  KEY_SCHEMA=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.KeySchema[].AttributeName' \
    --output text)

  local PROJECTION
  PROJECTION=$(echo "$KEY_SCHEMA" | tr '\t' ',')

  # Scan and delete in batches
  local ITEMS
  ITEMS=$(aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --projection-expression "$PROJECTION" \
    --query 'Items' \
    --output json 2>/dev/null)

  local COUNT
  COUNT=$(echo "$ITEMS" | jq 'length')

  if [[ "$COUNT" == "0" || "$COUNT" == "null" ]]; then
    echo "  ✓ Table ${TABLE_NAME} already empty"
    return
  fi

  # Build batch delete requests (max 25 per batch)
  echo "$ITEMS" | jq -c '.[]' | while IFS= read -r item; do
    local KEY
    KEY=$(echo "$item" | jq -c '.')
    aws dynamodb delete-item \
      --table-name "$TABLE_NAME" \
      --key "$KEY" \
      --region "$REGION" 2>/dev/null
  done

  echo "  ✓ Deleted ${COUNT} items from ${TABLE_NAME}"
}

wipe_dynamo_table "$DYNAMO_DEDUP_TABLE"
wipe_dynamo_table "$DYNAMO_CONNECTIONS_TABLE"
wipe_dynamo_table "$DYNAMO_RATE_LIMIT_TABLE"
wipe_dynamo_table "$DYNAMO_RENEWAL_DEDUP_TABLE"

# ─── 4. EventBridge Schedules - Delete All tw-{env}-* Schedules ─────────────

echo ""
echo "═══ [4/6] EventBridge Schedules - Deleting all ${PREFIX}-* and tw-${ENV_LONG}-* schedules..."

# The Lambda code uses the full environment name (production/development) for schedule prefixes,
# e.g. tw-production-{marketId}-{interval}. Also delete trial-expiry-* schedules.

# Collect all schedules matching either naming pattern
ALL_SCHEDULES=$(aws scheduler list-schedules \
  --region "$REGION" \
  --query 'Schedules[].Name' \
  --output text 2>/dev/null || echo "")

SCHEDULE_COUNT=0
for SCHEDULE in $ALL_SCHEDULES; do
  # Match: tw-production-*, tw-development-*, tw-prod-*, tw-dev-*, trial-expiry-*
  if [[ "$SCHEDULE" == "tw-${ENV_LONG}-"* ]] || [[ "$SCHEDULE" == "${PREFIX}-"* ]] || [[ "$SCHEDULE" == "trial-expiry-"* ]]; then
    aws scheduler delete-schedule --name "$SCHEDULE" --region "$REGION" 2>/dev/null || true
    SCHEDULE_COUNT=$((SCHEDULE_COUNT + 1))
  fi
done

if [[ $SCHEDULE_COUNT -eq 0 ]]; then
  echo "  ✓ No schedules found"
else
  echo "  ✓ Deleted ${SCHEDULE_COUNT} EventBridge schedule(s)"
fi

# ─── 5. CloudWatch Logs - Delete Log Groups ─────────────────────────────────

echo ""
echo "═══ [5/6] CloudWatch - Deleting Lambda log groups..."

LOG_GROUPS=$(aws logs describe-log-groups \
  --region "$REGION" \
  --log-group-name-prefix "/aws/lambda/${PREFIX}-" \
  --query 'logGroups[].logGroupName' \
  --output text 2>/dev/null || echo "")

# Also get the Bedrock model invocations log group
BEDROCK_LOG="/aws/bedrock/${PREFIX}-model-invocations"

if [[ -z "$LOG_GROUPS" || "$LOG_GROUPS" == "None" ]]; then
  echo "  ✓ No Lambda log groups found"
else
  LOG_COUNT=0
  for LOG_GROUP in $LOG_GROUPS; do
    aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$REGION" 2>/dev/null || true
    LOG_COUNT=$((LOG_COUNT + 1))
  done
  echo "  ✓ Deleted ${LOG_COUNT} Lambda log group(s)"
fi

# Delete Bedrock log group if it exists
if aws logs describe-log-groups --log-group-name-prefix "$BEDROCK_LOG" --region "$REGION" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$BEDROCK_LOG"; then
  aws logs delete-log-group --log-group-name "$BEDROCK_LOG" --region "$REGION" 2>/dev/null || true
  echo "  ✓ Deleted Bedrock model invocations log group"
fi

# ─── 6. Cognito - Delete All Users ──────────────────────────────────────────

echo ""
echo "═══ [6/6] Cognito - Deleting all users..."

COGNITO_USERS=$(aws cognito-idp list-users \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --region "$REGION" \
  --query 'Users[].Username' \
  --output text 2>/dev/null || echo "")

if [[ -z "$COGNITO_USERS" || "$COGNITO_USERS" == "None" ]]; then
  echo "  ✓ No Cognito users found"
else
  USER_COUNT=0
  for USERNAME in $COGNITO_USERS; do
    aws cognito-idp admin-delete-user \
      --user-pool-id "$COGNITO_USER_POOL_ID" \
      --username "$USERNAME" \
      --region "$REGION" 2>/dev/null || true
    USER_COUNT=$((USER_COUNT + 1))
  done
  echo "  ✓ Deleted ${USER_COUNT} Cognito user(s)"
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅  Data wipe complete for ${ENV^^} environment               ║"
echo "║                                                             ║"
echo "║  Infrastructure is intact. Re-run deploy.sh to re-apply    ║"
echo "║  the schema: ./deploy.sh up ${ENV}                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
