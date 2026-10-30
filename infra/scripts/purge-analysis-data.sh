#!/usr/bin/env bash
# ============================================================================
# TradeWizard - Purge analysis history (targeted)
#
# Deletes analysis OUTPUT for one environment and leaves customer and portfolio
# data untouched. This is deliberately narrower than wipe-data.sh, which also
# truncates users / subscriptions / payment_transactions and deletes every
# Cognito user.
#
# Deleted:
#   analysis_results          (cascades agent_memory, analysis_deliveries)
#   agent_performance         (accuracy / Brier metrics derived from them)
#   s3://<analysis-bucket>/results/**   recommendation payloads
#   s3://<analysis-bucket>/detail/**    full analysis detail
#
# Preserved:
#   users, subscriptions, payment_transactions, credit_transactions
#   analysis_requests    (a user's request log; deleting these CASCADE-deletes
#                         market_subscribers and would silently unsubscribe
#                         paying users from recurring analysis)
#   market_subscribers, markets, market_analysis_schedule (only last_result_id
#                         is cleared so the schedule keeps running)
#   portfolio_manager_sessions / _trades / _decisions (trading history; their
#                         analysis_result_id FKs are nulled, rows kept)
#
# Usage:
#   ./scripts/purge-analysis-data.sh prod              # dry run, prints counts
#   ./scripts/purge-analysis-data.sh prod --execute    # prompts for confirmation
#   ./scripts/purge-analysis-data.sh prod --execute --force
# ============================================================================

set -euo pipefail

ENV="${1:-}"
shift || true
EXECUTE=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=true ;;
    --force) FORCE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Usage: $0 <dev|prod> [--execute] [--force]"
  exit 1
fi

REGION="us-east-1"
SECRET_ID="tw-${ENV}-db-credentials"
STACK_ENV="$(echo "$ENV" | sed 's/dev/Dev/;s/prod/Prod/')"
STORAGE_STACK="TradeWizard-${STACK_ENV}-Storage"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      ANALYSIS HISTORY PURGE - ${ENV^^}                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── Credentials ─────────────────────────────────────────────────────────────

SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text)

eval "$(python3 -c "
import json,sys,shlex
d = json.loads(sys.stdin.read())
for k in ('host','port','dbname','username','password'):
    print(f'{k.upper()}={shlex.quote(str(d[k]))}')
" <<< "$SECRET_JSON")"

BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STORAGE_STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AnalysisBucketName'].OutputValue" \
  --output text)

db() {
  PGPASSWORD="$PASSWORD" psql \
    -h "$HOST" -p "$PORT" -U "$USERNAME" -d "$DBNAME" \
    --set=sslmode=require -v ON_ERROR_STOP=1 "$@"
}

# ── Current inventory ───────────────────────────────────────────────────────

echo ""
echo "Current state:"
db -c "
SELECT 'analysis_results' AS object, count(*)::text AS rows FROM analysis_results
UNION ALL SELECT 'agent_memory', count(*)::text FROM agent_memory
UNION ALL SELECT 'analysis_deliveries', count(*)::text FROM analysis_deliveries
UNION ALL SELECT 'agent_performance', count(*)::text FROM agent_performance
UNION ALL SELECT 'market_analysis_schedule (kept, unlinked)', count(*)::text FROM market_analysis_schedule WHERE last_result_id IS NOT NULL
UNION ALL SELECT 'KEPT: analysis_requests', count(*)::text FROM analysis_requests
UNION ALL SELECT 'KEPT: market_subscribers', count(*)::text FROM market_subscribers
UNION ALL SELECT 'KEPT: users', count(*)::text FROM users
UNION ALL SELECT 'KEPT: subscriptions', count(*)::text FROM subscriptions;
"

echo "S3 payloads:"
echo "  results/ : $(aws s3 ls "s3://${BUCKET}/results/" --recursive --region "$REGION" 2>/dev/null | wc -l) objects"
echo "  detail/  : $(aws s3 ls "s3://${BUCKET}/detail/" --recursive --region "$REGION" 2>/dev/null | wc -l) objects"

if [[ "$EXECUTE" != "true" ]]; then
  echo ""
  echo "DRY RUN - nothing deleted. Re-run with --execute to purge."
  exit 0
fi

# ── Confirmation ────────────────────────────────────────────────────────────

if [[ "$FORCE" != "true" ]]; then
  if [[ "$ENV" == "prod" ]]; then
    read -r -p "Type 'PURGE PROD ANALYSIS' to confirm: " CONFIRM
    [[ "$CONFIRM" == "PURGE PROD ANALYSIS" ]] || { echo "Aborted."; exit 1; }
  else
    read -r -p "Type 'yes' to confirm: " CONFIRM
    [[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }
  fi
fi

# ── Database ────────────────────────────────────────────────────────────────

echo ""
echo "Purging database..."
db -c "
BEGIN;

-- Detach references so trading history and recurring schedules survive.
UPDATE market_analysis_schedule SET last_result_id = NULL WHERE last_result_id IS NOT NULL;
UPDATE portfolio_manager_trades SET analysis_result_id = NULL WHERE analysis_result_id IS NOT NULL;
UPDATE portfolio_manager_decisions SET analysis_result_id = NULL WHERE analysis_result_id IS NOT NULL;

-- Cascades: agent_memory, analysis_deliveries.
DELETE FROM analysis_results;

-- Derived accuracy/calibration metrics for the deleted analyses.
DELETE FROM agent_performance;

COMMIT;
"

echo "Deleting S3 payloads..."
aws s3 rm "s3://${BUCKET}/results/" --recursive --region "$REGION" --quiet || true
aws s3 rm "s3://${BUCKET}/detail/" --recursive --region "$REGION" --quiet || true

echo ""
echo "Post-purge state:"
db -c "
SELECT 'analysis_results' AS object, count(*)::text AS rows FROM analysis_results
UNION ALL SELECT 'agent_memory', count(*)::text FROM agent_memory
UNION ALL SELECT 'agent_performance', count(*)::text FROM agent_performance
UNION ALL SELECT 'KEPT: analysis_requests', count(*)::text FROM analysis_requests
UNION ALL SELECT 'KEPT: market_subscribers', count(*)::text FROM market_subscribers
UNION ALL SELECT 'KEPT: users', count(*)::text FROM users;
"

echo "✅ Analysis history purged for ${ENV}."
