#!/bin/bash
set -e

# ============================================================================
# TradeWizard V2 - Infrastructure Lifecycle Script
#
# Fully automated deployment and teardown of all infrastructure.
# Handles: CDK stacks, DB migration, wallet/API secrets, Resend API key
#           population, SES verification (retained fallback), and Secrets
#           Manager secrets.
#
# Environment Files:
#   The script loads environment-specific variables from:
#     .env.dev   - Development environment credentials and config
#     .env.prod  - Production environment credentials and config
#   If neither exists, falls back to .env or interactive prompts.
#   See .env.example for all available variables.
#
# Usage:
#   ./deploy.sh up dev              # Deploy everything (development)
#   ./deploy.sh up prod             # Deploy everything (production)
#   ./deploy.sh up dev --skip-db    # Skip DB migration
#   ./deploy.sh down dev            # Destroy everything (development)
#   ./deploy.sh down prod           # Destroy everything (production)
#   ./deploy.sh status dev          # Show current deployment status
#
# Legacy (backwards-compatible):
#   ./deploy.sh dev                 # Same as: ./deploy.sh up dev
#   ./deploy.sh prod                # Same as: ./deploy.sh up prod
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - Node.js 18+, CDK CLI (npm i -g aws-cdk)
#   - python3 (for JSON parsing)
#   - psql (optional - Node.js pg client used as fallback for DB migration)
# ============================================================================

# ─── Colors & Formatting ─────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

log_step() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  ${BOLD}$1${NC}"; echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }
log_ok() { echo -e "  ${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
log_err() { echo -e "  ${RED}❌ $1${NC}"; }
log_info() { echo -e "  ${CYAN}ℹ️  $1${NC}"; }
log_skip() { echo -e "  ${YELLOW}⏭️  $1 - SKIPPED${NC}"; }

# ─── Argument Parsing ─────────────────────────────────────────────────────────

ACTION=""
ENV=""
SKIP_DB=false

# Legacy support: ./deploy.sh dev → ./deploy.sh up dev
if [[ "$1" == "dev" || "$1" == "prod" ]]; then
  ACTION="up"
  ENV="$1"
  shift
elif [[ "$1" == "up" || "$1" == "down" || "$1" == "status" ]]; then
  ACTION="$1"
  ENV="$2"
  shift 2
else
  echo -e "${RED}Usage: ./deploy.sh [up|down|status] [dev|prod] [--skip-db]${NC}"
  echo ""
  echo "  Commands:"
  echo "    up      Deploy all infrastructure (CDK, secrets, DB, Resend/SES)"
  echo "    down    Destroy all infrastructure"
  echo "    status  Show current deployment status"
  echo ""
  echo "  Environments:"
  echo "    dev     Development environment"
  echo "    prod    Production environment"
  echo ""
  echo "  Options:"
  echo "    --skip-db       Skip database migration"
  echo ""
  echo "  Steps (up):"
  echo "    1. Wallet & API Secrets (Platform Wallet key, Magic SDK key in Secrets Manager)"
  echo "    2. CDK Deploy (all stacks: network, database, auth, queue, notification,"
  echo "       storage, monitoring, compute, hosting)"
  echo "    3. API Credentials (populate CLOB, Resend, and Nebius secrets created by CDK)"
  echo "    4. Database Migration (runs all sql/*.sql files in order)"
  echo "    5. SES Email Verification (retained fallback sender identity)"
  echo "    6. Amplify Frontend Build (trigger build with env vars from CDK outputs)"
  echo ""
  echo "  Examples:"
  echo "    ./deploy.sh up dev                  # Full deploy to development"
  echo "    ./deploy.sh up prod                 # Full deploy to production"
  echo "    ./deploy.sh up dev --skip-db        # Skip DB migration"
  echo "    ./deploy.sh down dev                # Tear down development"
  echo "    ./deploy.sh status dev              # Check deployment status"
  exit 1
fi

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-db) SKIP_DB=true; shift ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

# Validate environment
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo -e "${RED}Invalid environment: $ENV (must be 'dev' or 'prod')${NC}"
  exit 1
fi

# ─── Load Environment File ────────────────────────────────────────────────────
# Loads .env.{dev|prod} if present. Variables defined in the env file are used
# for CDK configuration and secret creation. If the file doesn't exist, the
# script falls back to interactive prompts for required secrets.

ENV_FILE=".env.${ENV}"

if [[ -f "$ENV_FILE" ]]; then
  echo -e "${CYAN}  Loading environment file: ${ENV_FILE}${NC}"
  set -a  # Auto-export all variables
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  # Also check for a generic .env as fallback
  if [[ -f ".env" ]]; then
    echo -e "${YELLOW}  No ${ENV_FILE} found, loading generic .env${NC}"
    set -a
    # shellcheck disable=SC1091
    source ".env"
    set +a
  else
    echo -e "${YELLOW}  No ${ENV_FILE} or .env found - will prompt for required values${NC}"
  fi
fi

# ─── Configuration ────────────────────────────────────────────────────────────

STACK_PREFIX="TradeWizard-$(echo "$ENV" | sed 's/./\U&/')"  # TradeWizard-Dev or TradeWizard-Prod
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-2")}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")

PLATFORM_WALLET_SECRET="tw-${ENV}-platform-wallet-key"
MAGIC_SDK_SECRET="tw-${ENV}-magic-secret-key"
CLOB_CREDENTIALS_SECRET="tw-${ENV}-clob-credentials"
RESEND_API_KEY_SECRET="tw-${ENV}-resend-api-key"
NEBIUS_API_KEY_SECRET="tw-${ENV}-nebius-api-key"
DB_SECRET="tw-${ENV}-db-credentials"

echo -e "\n${BOLD}TradeWizard V2 - ${ACTION^^} ${ENV^^}${NC}"
echo -e "${CYAN}  Region:  ${REGION}${NC}"
echo -e "${CYAN}  Account: ${ACCOUNT_ID}${NC}"
echo -e "${CYAN}  Stacks:  ${STACK_PREFIX}-*${NC}\n"

# ─── Prerequisite Checks ─────────────────────────────────────────────────────

check_prerequisites() {
  log_step "Checking Prerequisites"

  local missing=0

  # AWS CLI
  if command -v aws &>/dev/null; then
    log_ok "AWS CLI: $(aws --version 2>&1 | head -1)"
  else
    log_err "AWS CLI not found - install from https://aws.amazon.com/cli/"
    missing=$((missing + 1))
  fi

  # Node.js
  if command -v node &>/dev/null; then
    log_ok "Node.js: $(node --version)"
  else
    log_err "Node.js not found - install v18+ from https://nodejs.org/"
    missing=$((missing + 1))
  fi

  # CDK CLI
  if command -v cdk &>/dev/null; then
    log_ok "CDK CLI: $(cdk --version 2>&1)"
  else
    log_err "CDK CLI not found - install with: npm i -g aws-cdk"
    missing=$((missing + 1))
  fi

  # python3 (for JSON parsing)
  if command -v python3 &>/dev/null; then
    log_ok "python3: $(python3 --version)"
  else
    log_warn "python3 not found - some JSON parsing may fail"
  fi

  # psql (required for DB migration - auto-install if missing)
  if command -v psql &>/dev/null; then
    log_ok "psql: $(psql --version | head -1)"
  else
    log_warn "psql not found - installing postgresql-client..."
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null 2>&1
    elif command -v yum &>/dev/null; then
      sudo yum install -y -q postgresql >/dev/null 2>&1
    elif command -v brew &>/dev/null; then
      brew install --quiet libpq && brew link --force libpq >/dev/null 2>&1
    fi

    if command -v psql &>/dev/null; then
      log_ok "psql installed: $(psql --version | head -1)"
    else
      log_err "Failed to install psql - DB migration will be skipped"
    fi
  fi

  # AWS credentials check
  if aws sts get-caller-identity &>/dev/null; then
    log_ok "AWS credentials valid"
  else
    log_err "AWS credentials not configured or expired"
    missing=$((missing + 1))
  fi

  if [[ $missing -gt 0 ]]; then
    echo ""
    log_err "$missing prerequisite(s) missing. Fix the above and retry."
    exit 1
  fi
}

# ─── Helper Functions ─────────────────────────────────────────────────────────

secret_exists() {
  aws secretsmanager describe-secret --secret-id "$1" --region "$REGION" &>/dev/null 2>&1
}

create_or_update_secret() {
  local secret_name="$1"
  local secret_value="$2"
  local description="$3"

  if secret_exists "$secret_name"; then
    log_info "Secret '$secret_name' already exists - updating value"
    aws secretsmanager put-secret-value \
      --secret-id "$secret_name" \
      --secret-string "$secret_value" \
      --region "$REGION" >/dev/null
  else
    log_info "Creating secret '$secret_name'"
    aws secretsmanager create-secret \
      --name "$secret_name" \
      --description "$description" \
      --secret-string "$secret_value" \
      --region "$REGION" >/dev/null
  fi
}

# Returns 0 when the value looks like a populated Resend key (JSON {"apiKey"}
# or a raw re_... string). CDK creates the secret with a generated placeholder
# value, so a non-empty secret is not sufficient.
resend_secret_has_key() {
  local value="$1"
  [[ -n "$value" ]] || return 1

  local has_key
  has_key=$(RESEND_EXISTING="$value" python3 -c '
import json, os
v = os.environ.get("RESEND_EXISTING", "").strip()
if v.startswith("{"):
    try:
        v = json.loads(v).get("apiKey", "")
    except Exception:
        v = ""
print("true" if v.strip().startswith("re_") else "false")
' 2>/dev/null || echo "false")

  [[ "$has_key" == "true" ]]
}

# Nebius keys have no known prefix, so only the JSON {"apiKey": "..."} shape is
# accepted. This avoids mistaking CDK's random placeholder for a real key.
nebius_secret_has_key() {
  local value="$1"
  [[ -n "$value" ]] || return 1

  local has_key
  has_key=$(NEBIUS_EXISTING="$value" python3 -c '
import json, os
v = os.environ.get("NEBIUS_EXISTING", "").strip()
if v.startswith("{"):
    try:
        v = json.loads(v).get("apiKey", "")
    except Exception:
        v = ""
print("true" if v.strip() else "false")
' 2>/dev/null || echo "false")

  [[ "$has_key" == "true" ]]
}

get_stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text \
    --region "$REGION" 2>/dev/null || echo ""
}

get_db_connection() {
  # Retrieve DB credentials from Secrets Manager
  local secret_json
  secret_json=$(aws secretsmanager get-secret-value \
    --secret-id "$DB_SECRET" \
    --query SecretString \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

  if [[ -z "$secret_json" ]]; then
    log_warn "DB credentials secret not found - skipping DB migration"
    return 1
  fi

  DB_HOST=$(echo "$secret_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['host'])" 2>/dev/null || echo "")
  DB_PORT=$(echo "$secret_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('port', '5432'))" 2>/dev/null || echo "5432")
  DB_NAME=$(echo "$secret_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['dbname'])" 2>/dev/null || echo "tradewizard")
  DB_USER=$(echo "$secret_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])" 2>/dev/null || echo "")
  DB_PASS=$(echo "$secret_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])" 2>/dev/null || echo "")

  if [[ -z "$DB_HOST" || -z "$DB_USER" ]]; then
    log_warn "Could not parse DB credentials"
    return 1
  fi

  return 0
}

# ─── Deploy (up) ─────────────────────────────────────────────────────────────

deploy_up() {
  check_prerequisites

  # ── Step 1: Wallet & API Secrets ──────────────────────────────────────────
  log_step "Step 1/6 - Wallet & API Secrets"

  # Platform Wallet private key
  if secret_exists "$PLATFORM_WALLET_SECRET"; then
    log_ok "Platform Wallet secret '$PLATFORM_WALLET_SECRET' already exists"
  else
    # Try to read from env file first, then prompt interactively
    local wallet_key="${PLATFORM_WALLET_PRIVATE_KEY:-}"
    if [[ -z "$wallet_key" ]]; then
      echo -e "  ${YELLOW}The Platform Wallet private key is required for automatic subscription renewals.${NC}"
      echo -e "  ${YELLOW}This key allows the Renewal Lambda to call transferFrom on the USDC.e contract.${NC}"
      echo -e "  ${YELLOW}Tip: Set PLATFORM_WALLET_PRIVATE_KEY in ${ENV_FILE} to avoid this prompt.${NC}"
      echo ""
      read -rp "  Enter Platform Wallet private key (0x...): " wallet_key
    else
      log_info "Using PLATFORM_WALLET_PRIVATE_KEY from ${ENV_FILE}"
    fi
    if [[ -z "$wallet_key" ]]; then
      log_err "Platform Wallet private key is required. Aborting."
      exit 1
    fi
    create_or_update_secret "$PLATFORM_WALLET_SECRET" "$wallet_key" "TradeWizard ${ENV} Platform Wallet private key for USDC.e transferFrom renewals"
    log_ok "Platform Wallet secret created: $PLATFORM_WALLET_SECRET"
  fi

  # Magic SDK secret key
  if secret_exists "$MAGIC_SDK_SECRET"; then
    log_ok "Magic SDK secret '$MAGIC_SDK_SECRET' already exists"
  else
    # Try to read from env file first, then prompt interactively
    local magic_key="${MAGIC_SECRET_KEY:-}"
    if [[ -z "$magic_key" ]]; then
      echo -e "  ${YELLOW}The Magic SDK secret key is required for wallet authentication.${NC}"
      echo -e "  ${YELLOW}Tip: Set MAGIC_SECRET_KEY in ${ENV_FILE} to avoid this prompt.${NC}"
      echo ""
      read -rp "  Enter Magic SDK secret key: " magic_key
    else
      log_info "Using MAGIC_SECRET_KEY from ${ENV_FILE}"
    fi
    if [[ -z "$magic_key" ]]; then
      log_err "Magic SDK secret key is required. Aborting."
      exit 1
    fi
    create_or_update_secret "$MAGIC_SDK_SECRET" "$magic_key" "TradeWizard ${ENV} Magic SDK secret key for wallet auth"
    log_ok "Magic SDK secret created: $MAGIC_SDK_SECRET"
  fi

  # ── Step 2: CDK Deploy ────────────────────────────────────────────────────
  log_step "Step 2/6 - CDK Deploy (all stacks)"

  # Export wallet config vars so CDK config.ts can read them via process.env
  export PLATFORM_WALLET_ADDRESS="${PLATFORM_WALLET_ADDRESS:-}"
  export USDC_CONTRACT_ADDRESS="${USDC_CONTRACT_ADDRESS:-0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174}"
  export POLYGON_RPC_URL="${POLYGON_RPC_URL:-https://polygon-rpc.com}"
  export SAFE_FACTORY_ADDRESS="${SAFE_FACTORY_ADDRESS:-}"

  # Ensure the environment is bootstrapped (idempotent - safe to run repeatedly)
  log_info "Ensuring CDK bootstrap (account: ${ACCOUNT_ID}, region: ${REGION})..."
  if npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" --context env="$ENV" 2>&1 | tail -3; then
    log_ok "CDK bootstrap confirmed"
  else
    log_err "CDK bootstrap failed - check IAM permissions (requires cloudformation:*, s3:*, iam:*, ssm:*, ecr:*)"
    exit 1
  fi

  log_info "Synthesizing CDK stacks..."
  npx cdk synth --context env="$ENV" --quiet 2>/dev/null || npx cdk synth --context env="$ENV"

  log_info "Deploying all stacks: ${STACK_PREFIX}-*"
  npx cdk deploy "${STACK_PREFIX}-*" \
    --context env="$ENV" \
    --require-approval never \
    --outputs-file cdk-outputs-${ENV}.json

  log_ok "CDK deployment complete"

  # ── Step 3: API Credentials (CLOB + Resend + Nebius) ──────────────────────
  # CDK creates the ClobCredentialsSecret, ResendApiKeySecret, and
  # NebiusApiKeySecret resources as empty shells. The portfolio Lambdas
  # lazy-load CLOB credentials at invocation time via shared/clob-credentials.ts
  # and refuse to place/cancel orders if the secret is empty. Email Lambdas
  # lazy-load the Resend key via shared/email.ts. Analysis and portfolio
  # Lambdas lazy-load the Nebius key via shared/ai-provider.ts when
  # AI_PROVIDER=nebius. We populate all three here from env vars so the first
  # deploy is functional without manual secret edits.
  log_step "Step 3/6 - API Credentials (CLOB + Resend + Nebius)"

  if secret_exists "$CLOB_CREDENTIALS_SECRET"; then
    # Read current value to decide whether we need to populate it
    local clob_existing
    clob_existing=$(aws secretsmanager get-secret-value \
      --secret-id "$CLOB_CREDENTIALS_SECRET" \
      --query SecretString \
      --output text \
      --region "$REGION" 2>/dev/null || echo "")

    local clob_has_key="false"
    if [[ -n "$clob_existing" ]] && command -v python3 &>/dev/null; then
      clob_has_key=$(echo "$clob_existing" | python3 -c "import sys,json;
try:
    d=json.load(sys.stdin)
    print('true' if d.get('apiKey') else 'false')
except Exception:
    print('false')
" 2>/dev/null || echo "false")
    fi

    if [[ "$clob_has_key" == "true" ]]; then
      log_ok "CLOB credentials secret '$CLOB_CREDENTIALS_SECRET' already populated"
    elif [[ -n "$CLOB_API_KEY" && -n "$CLOB_API_SECRET" && -n "$CLOB_API_PASSPHRASE" ]]; then
      log_info "Populating CLOB credentials secret from ${ENV_FILE}"
      local clob_payload
      clob_payload=$(python3 -c "
import json
print(json.dumps({
  'apiUrl':       '${CLOB_API_URL:-https://clob.polymarket.com}',
  'apiKey':       '${CLOB_API_KEY}',
  'apiSecret':    '${CLOB_API_SECRET}',
  'apiPassphrase':'${CLOB_API_PASSPHRASE}',
}))" 2>/dev/null)
      aws secretsmanager put-secret-value \
        --secret-id "$CLOB_CREDENTIALS_SECRET" \
        --secret-string "$clob_payload" \
        --region "$REGION" >/dev/null
      log_ok "CLOB credentials populated: $CLOB_CREDENTIALS_SECRET"
    else
      log_warn "CLOB_API_KEY/SECRET/PASSPHRASE not set in ${ENV_FILE} - skipping"
      log_warn "Portfolio Manager will refuse to place orders until the secret is populated."
      log_warn "Populate manually with:"
      log_warn "  aws secretsmanager put-secret-value \\"
      log_warn "    --secret-id $CLOB_CREDENTIALS_SECRET \\"
      log_warn "    --secret-string '{\"apiUrl\":\"https://clob.polymarket.com\",\"apiKey\":\"...\",\"apiSecret\":\"...\",\"apiPassphrase\":\"...\"}'"
    fi
  else
    log_warn "CLOB credentials secret '$CLOB_CREDENTIALS_SECRET' not found - CDK may not have deployed the compute stack yet"
  fi

  # Resend API key (transactional email)
  local email_provider="${EMAIL_PROVIDER:-resend}"
  if secret_exists "$RESEND_API_KEY_SECRET"; then
    if [[ -n "${RESEND_API_KEY:-}" ]]; then
      if [[ "$RESEND_API_KEY" != re_* ]]; then
        log_warn "RESEND_API_KEY does not look like a Resend key (expected re_...) - email delivery may fail"
      fi
      log_info "Populating Resend API key secret from ${ENV_FILE}"
      local resend_payload
      if resend_payload=$(RESEND_API_KEY="$RESEND_API_KEY" python3 -c 'import json, os; print(json.dumps({"apiKey": os.environ["RESEND_API_KEY"]}))' 2>/dev/null); then
        if aws secretsmanager put-secret-value \
          --secret-id "$RESEND_API_KEY_SECRET" \
          --secret-string "$resend_payload" \
          --region "$REGION" >/dev/null 2>&1; then
          log_ok "Resend API key populated: $RESEND_API_KEY_SECRET"
        else
          log_warn "Failed to populate Resend API key secret - email delivery will fail until it is set"
        fi
      else
        log_warn "Could not encode RESEND_API_KEY (python3 unavailable?) - populate the secret manually"
      fi
    else
      local resend_existing=""
      resend_existing=$(aws secretsmanager get-secret-value \
        --secret-id "$RESEND_API_KEY_SECRET" \
        --query SecretString \
        --output text \
        --region "$REGION" 2>/dev/null || echo "")

      if resend_secret_has_key "$resend_existing"; then
        log_ok "Resend API key secret '$RESEND_API_KEY_SECRET' already populated"
      elif [[ "$email_provider" == "resend" ]]; then
        log_warn "RESEND_API_KEY not set in ${ENV_FILE} - Resend email delivery will fail until populated"
        log_warn "Populate manually with:"
        log_warn "  aws secretsmanager put-secret-value \\"
        log_warn "    --secret-id $RESEND_API_KEY_SECRET \\"
        log_warn "    --secret-string '{\"apiKey\":\"re_...\"}'"
      else
        log_info "EMAIL_PROVIDER=${email_provider} - Resend key not required"
      fi
    fi
  else
    log_warn "Resend API key secret '$RESEND_API_KEY_SECRET' not found - CDK may not have deployed the compute stack yet"
  fi

  # Nebius API key (optional AI provider; AI_PROVIDER=bedrock by default)
  local ai_provider="${AI_PROVIDER:-bedrock}"
  if secret_exists "$NEBIUS_API_KEY_SECRET"; then
    if [[ -n "${NEBIUS_API_KEY:-}" ]]; then
      log_info "Populating Nebius API key secret from ${ENV_FILE}"
      local nebius_payload
      if nebius_payload=$(NEBIUS_API_KEY="$NEBIUS_API_KEY" python3 -c 'import json, os; print(json.dumps({"apiKey": os.environ["NEBIUS_API_KEY"]}))' 2>/dev/null); then
        if aws secretsmanager put-secret-value \
          --secret-id "$NEBIUS_API_KEY_SECRET" \
          --secret-string "$nebius_payload" \
          --region "$REGION" >/dev/null 2>&1; then
          log_ok "Nebius API key populated: $NEBIUS_API_KEY_SECRET"
        else
          log_warn "Failed to populate Nebius API key secret - AI_PROVIDER=nebius will fail until it is set"
        fi
      else
        log_warn "Could not encode NEBIUS_API_KEY (python3 unavailable?) - populate the secret manually"
      fi
    else
      local nebius_existing=""
      nebius_existing=$(aws secretsmanager get-secret-value \
        --secret-id "$NEBIUS_API_KEY_SECRET" \
        --query SecretString \
        --output text \
        --region "$REGION" 2>/dev/null || echo "")

      if nebius_secret_has_key "$nebius_existing"; then
        log_ok "Nebius API key secret '$NEBIUS_API_KEY_SECRET' already populated"
      elif [[ "$ai_provider" == "nebius" ]]; then
        log_warn "NEBIUS_API_KEY not set in ${ENV_FILE} - AI_PROVIDER=nebius will fail until populated"
        log_warn "Populate manually with:"
        log_warn "  aws secretsmanager put-secret-value \\"
        log_warn "    --secret-id $NEBIUS_API_KEY_SECRET \\"
        log_warn "    --secret-string '{\"apiKey\":\"...\"}'"
      else
        log_info "AI_PROVIDER=${ai_provider} - Nebius key not required"
      fi
    fi
  else
    log_warn "Nebius API key secret '$NEBIUS_API_KEY_SECRET' not found - CDK may not have deployed the compute stack yet"
  fi

  if [[ "$ai_provider" == "nebius" ]]; then
    local missing_nebius_models=()
    for capability in FAST ANALYTICAL AGENTIC REASONING DEEP_REASONING NON_TOOL DEFAULT; do
      local model_var="NEBIUS_MODEL_${capability}"
      if [[ -z "${!model_var:-}" ]]; then
        missing_nebius_models+=("$model_var")
      fi
    done
    if [[ ${#missing_nebius_models[@]} -gt 0 ]]; then
      log_warn "AI_PROVIDER=nebius but these model env vars are missing: ${missing_nebius_models[*]}"
      log_warn "Set them in ${ENV_FILE} before deploying; the Lambda will fail fast otherwise."
    fi
  fi

  # ── Step 4: Database Migration ────────────────────────────────────────────
  if [[ "$SKIP_DB" == "true" ]]; then
    log_step "Step 4/6 - Database Migration"
    log_skip "Database migration (--skip-db)"
  else
    log_step "Step 4/6 - Database Migration"

    if get_db_connection; then
      log_info "Running SQL migrations against ${DB_HOST}:${DB_PORT}/${DB_NAME}"

      export PGPASSWORD="$DB_PASS"

      local migration_count=0
      for f in sql/*.sql; do
        if [[ -f "$f" ]]; then
          log_info "Applying migration: $f"
          psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$f" 2>&1 | tail -5
          migration_count=$((migration_count + 1))
        fi
      done

      unset PGPASSWORD

      if [[ $migration_count -eq 0 ]]; then
        log_warn "No SQL migration files found in sql/"
      else
        log_ok "Applied $migration_count migration(s) successfully"
      fi
    else
      log_warn "Skipping DB migration - could not retrieve credentials"
    fi
  fi

  # ── Step 5: SES Email Verification ────────────────────────────────────────
  log_step "Step 5/6 - SES Email Verification"

  local ses_email="${SES_FROM_EMAIL:-noreply@tradewizard.ai}"
  local ses_status
  ses_status=$(aws ses get-identity-verification-attributes \
    --identities "$ses_email" \
    --query "VerificationAttributes.\"${ses_email}\".VerificationStatus" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "NotFound")

  if [[ "$ses_status" == "Success" ]]; then
    log_ok "SES identity '$ses_email' already verified"
  elif [[ "$ses_status" == "Pending" ]]; then
    log_warn "SES identity '$ses_email' verification pending - check inbox"
  else
    log_info "Requesting SES verification for '$ses_email'"
    aws ses verify-email-identity --email-address "$ses_email" --region "$REGION" 2>/dev/null || true
    log_warn "Verification email sent to $ses_email - click the link to verify"
  fi

  # ── Step 6: Amplify Frontend Build ─────────────────────────────────────────
  log_step "Step 6/6 - Amplify Frontend Build"

  # Trigger a build so the env vars set by CDK take effect
  local amplify_app_id
  amplify_app_id=$(python3 -c "
import json
with open('cdk-outputs-${ENV}.json') as f:
    data = json.load(f)
for k, v in data.items():
    if 'Hosting' in k:
        print(v.get('AmplifyAppId', ''))
        break
" 2>/dev/null || echo "")

  if [[ -n "$amplify_app_id" ]]; then
    local amplify_branch
    amplify_branch=$(python3 -c "
env='$ENV'
print('prod' if env == 'prod' else 'main')
" 2>/dev/null || echo "main")

    log_info "Triggering Amplify build for app ${amplify_app_id} branch ${amplify_branch}"
    if aws amplify start-job \
      --app-id "$amplify_app_id" \
      --branch-name "$amplify_branch" \
      --job-type RELEASE \
      --region "$REGION" >/dev/null 2>&1; then
      log_ok "Amplify build triggered - monitor at Amplify Console"
    else
      log_warn "Could not trigger Amplify build - the branch may not be connected yet"
      log_warn "Connect the repo in the Amplify Console and push to trigger the first build"
    fi
  else
    log_warn "Amplify app not found in cdk-outputs-${ENV}.json - hosting stack may not have deployed"
  fi

  # ── Summary ───────────────────────────────────────────────────────────────
  echo ""
  log_step "🎉 Deployment Complete - ${ENV^^}"
  echo -e "  ${GREEN}All steps completed successfully.${NC}"
  echo ""
  echo -e "  ${BOLD}Secrets:${NC}"
  echo -e "    Platform Wallet Key: ${PLATFORM_WALLET_SECRET}"
  echo -e "    Magic SDK Key:       ${MAGIC_SDK_SECRET}"
  echo -e "    CLOB Credentials:    ${CLOB_CREDENTIALS_SECRET}"
  echo -e "    Resend API Key:      ${RESEND_API_KEY_SECRET}"
  echo -e "    Nebius API Key:      ${NEBIUS_API_KEY_SECRET}"
  echo ""
  echo -e "  ${BOLD}AI Provider:${NC}"
  echo -e "    Provider:            ${AI_PROVIDER:-bedrock}"
  echo ""
  echo -e "  ${BOLD}Email:${NC}"
  echo -e "    Provider:            ${EMAIL_PROVIDER:-resend}"
  echo -e "    Resend Sender:       ${RESEND_FROM_EMAIL:-notifications@tradewizard.live}"
  echo -e "    SES Fallback:        ${SES_FROM_EMAIL:-noreply@tradewizard.ai}"
  echo ""

  if [[ -f cdk-outputs-${ENV}.json ]]; then
    echo -e "  ${BOLD}Stack Outputs:${NC}"
    echo -e "    See cdk-outputs-${ENV}.json for API endpoints and resource ARNs"

    # Show Amplify URL if available
    local amplify_url
    amplify_url=$(python3 -c "
import json
with open('cdk-outputs-${ENV}.json') as f:
    data = json.load(f)
for k, v in data.items():
    if 'Hosting' in k:
        print(v.get('AmplifyAppUrl', ''))
        break
" 2>/dev/null || echo "")
    if [[ -n "$amplify_url" ]]; then
      echo -e "    ${BOLD}Frontend URL:${NC} ${amplify_url}"
    fi
  fi
  echo ""
}

# ─── Destroy (down) ──────────────────────────────────────────────────────────

deploy_down() {
  log_step "⚠️  Destroying ${ENV^^} Environment"

  echo -e "  ${RED}This will destroy ALL infrastructure for ${ENV}.${NC}"
  echo -e "  ${RED}This action is IRREVERSIBLE for data in RDS, DynamoDB, and S3.${NC}"
  echo ""
  read -rp "  Type '${ENV}' to confirm destruction: " confirm

  if [[ "$confirm" != "$ENV" ]]; then
    log_err "Confirmation failed. Aborting."
    exit 1
  fi

  # ── Step 1: Disable deletion protection on RDS ────────────────────────────
  log_step "Disabling deletion protection on RDS instances"

  local db_instance="tw-${ENV}-postgres"
  if aws rds describe-db-instances --db-instance-identifier "$db_instance" --region "$REGION" &>/dev/null; then
    log_info "Disabling deletion protection on $db_instance"
    aws rds modify-db-instance \
      --db-instance-identifier "$db_instance" \
      --no-deletion-protection \
      --apply-immediately \
      --region "$REGION" >/dev/null 2>&1 || true
    log_ok "Deletion protection disabled on $db_instance"
  else
    log_info "No RDS instance '$db_instance' found - skipping"
  fi

  # Also handle legacy Aurora cluster if it exists
  local aurora_cluster="tw-${ENV}-aurora-postgres"
  if aws rds describe-db-clusters --db-cluster-identifier "$aurora_cluster" --region "$REGION" &>/dev/null 2>&1; then
    log_info "Disabling deletion protection on Aurora cluster $aurora_cluster"
    aws rds modify-db-cluster \
      --db-cluster-identifier "$aurora_cluster" \
      --no-deletion-protection \
      --region "$REGION" >/dev/null 2>&1 || true
    log_ok "Deletion protection disabled on $aurora_cluster"
  fi

  # ── Step 2: CDK Destroy ───────────────────────────────────────────────────
  log_step "Destroying CDK stacks: ${STACK_PREFIX}-*"

  npx cdk destroy "${STACK_PREFIX}-*" \
    --context env="$ENV" \
    --force || true

  # Handle DELETE_FAILED stacks by retaining problematic resources
  local failed_stacks
  failed_stacks=$(aws cloudformation list-stacks \
    --stack-status-filter DELETE_FAILED \
    --query "StackSummaries[?starts_with(StackName, '${STACK_PREFIX}')].StackName" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

  if [[ -n "$failed_stacks" ]]; then
    log_warn "Some stacks failed to delete - retrying with --retain-resources"
    for stack in $failed_stacks; do
      local failed_resources
      failed_resources=$(aws cloudformation describe-stack-events \
        --stack-name "$stack" \
        --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].LogicalResourceId" \
        --output text \
        --region "$REGION" 2>/dev/null | tr '\t' ' ' | xargs -n1 | sort -u | xargs)

      if [[ -n "$failed_resources" ]]; then
        log_info "Retrying delete of $stack, retaining: $failed_resources"
        aws cloudformation delete-stack \
          --stack-name "$stack" \
          --retain-resources $failed_resources \
          --region "$REGION" 2>/dev/null || true
        aws cloudformation wait stack-delete-complete \
          --stack-name "$stack" \
          --region "$REGION" 2>/dev/null || true
      fi
    done
  fi

  log_ok "CDK stacks destroyed"

  # ── Step 3: Clean up retained/orphaned resources ──────────────────────────
  log_step "Cleaning up retained resources (S3, DynamoDB, SQS, Log Groups)"

  local prefix="tw-${ENV}"
  local account_id
  account_id=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

  # S3 Buckets (empty + delete, handles versioned buckets)
  local buckets
  buckets=$(aws s3api list-buckets --query "Buckets[?contains(Name, '${prefix}')].Name" --output text 2>/dev/null || echo "")
  for bucket in $buckets; do
    log_info "Emptying and deleting S3 bucket: $bucket"

    # Delete all object versions (required for versioned buckets)
    local versions
    versions=$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
      --query '{Objects: [Versions,DeleteMarkers][].{Key:Key,VersionId:VersionId}}' \
      --output json 2>/dev/null || echo '{"Objects": []}')

    # Only call delete-objects if there are objects to delete
    local obj_count
    obj_count=$(echo "$versions" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('Objects',None) or []))" 2>/dev/null || echo "0")

    if [[ "$obj_count" -gt "0" ]]; then
      echo "$versions" | aws s3api delete-objects --bucket "$bucket" --region "$REGION" --delete file:///dev/stdin >/dev/null 2>&1 || true
    fi

    # Also do a regular rm in case of non-versioned objects
    aws s3 rm "s3://${bucket}" --recursive --region "$REGION" 2>/dev/null || true

    # Now delete the empty bucket
    aws s3 rb "s3://${bucket}" --force --region "$REGION" 2>/dev/null || true
    log_ok "Deleted bucket: $bucket"
  done

  # DynamoDB Tables
  local tables
  tables=$(aws dynamodb list-tables --query "TableNames[?contains(@, '${prefix}')]" --output text --region "$REGION" 2>/dev/null || echo "")
  for table in $tables; do
    log_info "Deleting DynamoDB table: $table"
    aws dynamodb delete-table --table-name "$table" --region "$REGION" 2>/dev/null || true
    log_ok "Deleted table: $table"
  done

  # SQS Queues
  local queues
  queues=$(aws sqs list-queues --queue-name-prefix "$prefix" --region "$REGION" --query "QueueUrls[]" --output text 2>/dev/null || echo "")
  for queue_url in $queues; do
    log_info "Deleting SQS queue: $queue_url"
    aws sqs delete-queue --queue-url "$queue_url" --region "$REGION" 2>/dev/null || true
    log_ok "Deleted queue: $(basename "$queue_url")"
  done

  # CloudWatch Log Groups
  local log_groups
  log_groups=$(aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/${prefix}" --query "logGroups[].logGroupName" --output text --region "$REGION" 2>/dev/null || echo "")
  log_groups="$log_groups $(aws logs describe-log-groups --log-group-name-prefix "/aws/apigateway/${prefix}" --query "logGroups[].logGroupName" --output text --region "$REGION" 2>/dev/null || echo "")"
  for lg in $log_groups; do
    if [[ -n "$lg" && "$lg" != "None" ]]; then
      log_info "Deleting log group: $lg"
      aws logs delete-log-group --log-group-name "$lg" --region "$REGION" 2>/dev/null || true
    fi
  done

  log_ok "Retained resources cleaned up"

  # ── Step 4: Optionally clean up Secrets Manager secrets ───────────────────
  echo ""
  read -rp "  Delete Secrets Manager secrets? (y/N): " del_secrets
  if [[ "$del_secrets" == "y" || "$del_secrets" == "Y" ]]; then
    local all_secrets
    all_secrets=$(aws secretsmanager list-secrets --query "SecretList[?contains(Name, '${prefix}')].Name" --output text --region "$REGION" 2>/dev/null || echo "")
    for secret in $all_secrets; do
      log_info "Deleting secret: $secret"
      aws secretsmanager delete-secret \
        --secret-id "$secret" \
        --force-delete-without-recovery \
        --region "$REGION" 2>/dev/null || true
      log_ok "Deleted secret: $secret"
    done
  else
    log_info "Secrets retained in Secrets Manager"
  fi

  echo ""
  log_ok "Environment ${ENV^^} fully destroyed"
}

# ─── Status ──────────────────────────────────────────────────────────────────

deploy_status() {
  log_step "Deployment Status - ${ENV^^}"

  echo -e "  ${BOLD}CDK Stacks:${NC}"
  local stacks
  stacks=$(aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --query "StackSummaries[?starts_with(StackName, '${STACK_PREFIX}')].{Name:StackName,Status:StackStatus,Updated:LastUpdatedTime}" \
    --output table \
    --region "$REGION" 2>/dev/null || echo "  (none found)")
  echo "$stacks"

  echo ""
  echo -e "  ${BOLD}Secrets:${NC}"
  for secret in "$PLATFORM_WALLET_SECRET" "$MAGIC_SDK_SECRET" "$CLOB_CREDENTIALS_SECRET" "$RESEND_API_KEY_SECRET" "$NEBIUS_API_KEY_SECRET" "$DB_SECRET"; do
    if secret_exists "$secret"; then
      log_ok "$secret"
    else
      log_warn "$secret - not found"
    fi
  done

  # Report whether the Resend key has been populated without printing it.
  if secret_exists "$RESEND_API_KEY_SECRET"; then
    local resend_value=""
    resend_value=$(aws secretsmanager get-secret-value \
      --secret-id "$RESEND_API_KEY_SECRET" \
      --query SecretString \
      --output text \
      --region "$REGION" 2>/dev/null || echo "")
    if resend_secret_has_key "$resend_value"; then
      echo -e "    Resend key: populated"
    else
      echo -e "    Resend key: empty"
    fi
  fi

  # Report whether the Nebius key has been populated without printing it.
  if secret_exists "$NEBIUS_API_KEY_SECRET"; then
    local nebius_value=""
    nebius_value=$(aws secretsmanager get-secret-value \
      --secret-id "$NEBIUS_API_KEY_SECRET" \
      --query SecretString \
      --output text \
      --region "$REGION" 2>/dev/null || echo "")
    if nebius_secret_has_key "$nebius_value"; then
      echo -e "    Nebius key: populated"
    else
      echo -e "    Nebius key: empty"
    fi
  fi

  echo ""
  echo -e "  ${BOLD}AI Configuration:${NC}"
  echo -e "    Provider:      ${AI_PROVIDER:-bedrock}"
  echo -e "    Nebius models: ${NEBIUS_MODEL_FAST:-unset} / ${NEBIUS_MODEL_AGENTIC:-unset} / ${NEBIUS_MODEL_REASONING:-unset}"
  echo ""
  echo -e "  ${BOLD}Email Configuration:${NC}"
  echo -e "    Provider:      ${EMAIL_PROVIDER:-resend}"
  echo -e "    Resend Sender: ${RESEND_FROM_EMAIL:-notifications@tradewizard.live}"
  echo ""

  echo -e "  ${BOLD}SES Identity (retained fallback):${NC}"
  local ses_email="${SES_FROM_EMAIL:-noreply@tradewizard.ai}"
  local ses_status
  ses_status=$(aws ses get-identity-verification-attributes \
    --identities "$ses_email" \
    --query "VerificationAttributes.\"${ses_email}\".VerificationStatus" \
    --output text \
    --region "$REGION" 2>/dev/null || echo "NotFound")
  echo -e "    $ses_email: $ses_status"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "$ACTION" in
  up)     deploy_up ;;
  down)   deploy_down ;;
  status) deploy_status ;;
  *)
    log_err "Unknown action: $ACTION"
    exit 1
    ;;
esac
