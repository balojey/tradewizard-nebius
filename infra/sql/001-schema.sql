-- ============================================================================
-- TradeWizard V2 - Complete Database Schema
--
-- Combined from migrations 001-005. Idempotent - safe to run on both fresh
-- databases and existing deployments.
--
-- Covers: users, subscriptions, credits, markets, analysis requests,
--         analysis results, agent memory, notification preferences,
--         wallet payments, portfolio manager, and idempotency hardening.
-- ============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ============================================================================
-- USERS & AUTH
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  portfolio_persona_id TEXT NOT NULL DEFAULT 'scalper',
  portfolio_persona_params JSONB,
  has_used_paid_plan BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add portfolio columns if they don't exist (for existing deployments)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN portfolio_persona_id TEXT NOT NULL DEFAULT 'scalper';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN portfolio_persona_params JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================================
-- SUBSCRIPTIONS & BILLING
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  credits_remaining INTEGER NOT NULL DEFAULT 20,
  credits_monthly_limit INTEGER NOT NULL DEFAULT 20,
  billing_cycle_start TIMESTAMPTZ NOT NULL,
  billing_cycle_end TIMESTAMPTZ NOT NULL,
  wallet_address TEXT,
  grace_period_start TIMESTAMPTZ,
  grace_period_end TIMESTAMPTZ,
  eventbridge_schedule_arn TEXT,
  is_trial BOOLEAN NOT NULL DEFAULT FALSE,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT one_active_subscription_per_user UNIQUE (user_id)
);

-- Ensure defaults are current (idempotent ALTER)
ALTER TABLE subscriptions
  ALTER COLUMN credits_remaining SET DEFAULT 20,
  ALTER COLUMN credits_monthly_limit SET DEFAULT 20;

-- Add wallet columns if missing (from migration 002)
DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN wallet_address TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN grace_period_start TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN grace_period_end TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN eventbridge_schedule_arn TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Remove legacy Stripe columns if present
ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_subscription_id;

-- Add trial columns if missing (for existing deployments)
DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN is_trial BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ADD COLUMN trial_end TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add has_used_paid_plan to users if missing (for existing deployments)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN has_used_paid_plan BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================================
-- CREDIT TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  reference_type TEXT,
  credit_source TEXT DEFAULT 'plan' CHECK (credit_source IN ('plan', 'credit_pack')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add credit_source column if missing (from migration 002)
DO $$ BEGIN
  ALTER TABLE credit_transactions ADD COLUMN credit_source TEXT DEFAULT 'plan'
    CHECK (credit_source IN ('plan', 'credit_pack'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================================
-- PAYMENT TRANSACTIONS (on-chain USDC.e)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('subscription_payment', 'credit_pack_purchase', 'renewal_payment', 'proration_credit')
  ),
  amount_usdc NUMERIC(10, 6) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  source_address TEXT NOT NULL,
  plan TEXT,
  credit_pack_id TEXT,
  credits_added INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_type ON payment_transactions(user_id, transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_tx_hash ON payment_transactions(tx_hash);

-- ============================================================================
-- MARKETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  description TEXT,
  resolution_criteria TEXT,
  event_type TEXT,
  expiry_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  current_probability NUMERIC(5, 4),
  volume_24h NUMERIC(12, 2),
  liquidity_score NUMERIC(4, 2),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ANALYSIS REQUESTS & SCHEDULING
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  interval_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  eventbridge_schedule_arn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT valid_interval CHECK (
    (request_type = 'one_time' AND interval_seconds IS NULL) OR
    (request_type = 'recurring' AND interval_seconds IS NOT NULL AND interval_seconds >= 3600)
  )
);

CREATE TABLE IF NOT EXISTS market_analysis_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL UNIQUE,
  shortest_interval_seconds INTEGER NOT NULL,
  next_scheduled_run TIMESTAMPTZ NOT NULL,
  last_completed_at TIMESTAMPTZ,
  last_result_id UUID,
  is_executing BOOLEAN NOT NULL DEFAULT false,
  execution_started_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_request_id UUID NOT NULL REFERENCES analysis_requests(id) ON DELETE CASCADE,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  CONSTRAINT unique_user_market_subscription UNIQUE (market_id, user_id, analysis_request_id)
);

-- ============================================================================
-- ANALYSIS RESULTS & DELIVERY
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_duration_ms INTEGER,
  total_llm_calls INTEGER,
  model_costs_usd NUMERIC(10, 6),
  result_payload_s3_key TEXT NOT NULL,
  consensus_probability NUMERIC(5, 4),
  recommendation TEXT,
  confidence_score NUMERIC(5, 4),
  edge NUMERIC(5, 4),
  market_probability_at_execution NUMERIC(5, 4),
  -- Recommendation outcome tracking (TP/SL hit detection)
  entry_price NUMERIC(5, 4),        -- actual entry midpoint from entryZone
  target_price NUMERIC(5, 4),       -- midpoint of targetZone
  stop_loss_price NUMERIC(5, 4),    -- stopLoss level
  outcome_status TEXT NOT NULL DEFAULT 'pending',
  outcome_hit_price NUMERIC(5, 4),  -- price at which TP or SL was hit
  outcome_resolved_at TIMESTAMPTZ,  -- when TP/SL was hit
  agents_scored BOOLEAN NOT NULL DEFAULT false, -- whether agent_performance was updated
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_outcome_status CHECK (outcome_status IN ('pending', 'success', 'failure', 'expired', 'no_trade'))
);

-- Add FK for market_analysis_schedule.last_result_id (idempotent)
DO $$ BEGIN
  ALTER TABLE market_analysis_schedule
    ADD CONSTRAINT fk_last_result
    FOREIGN KEY (last_result_id) REFERENCES analysis_results(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add recommendation outcome tracking columns (idempotent for existing deployments)
DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN entry_price NUMERIC(5, 4);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN target_price NUMERIC(5, 4);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN stop_loss_price NUMERIC(5, 4);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'pending';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN outcome_hit_price NUMERIC(5, 4);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN outcome_resolved_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE analysis_results ADD COLUMN agents_scored BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add CHECK constraint separately (idempotent)
DO $$ BEGIN
  ALTER TABLE analysis_results ADD CONSTRAINT chk_outcome_status
    CHECK (outcome_status IN ('pending', 'success', 'failure', 'expired', 'no_trade'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill existing rows: mark old NO_TRADE recommendations as 'no_trade',
-- and expire old actionable recommendations that are beyond the scoring window.
-- This prevents the scorer from attempting to check stale historical entries.
UPDATE analysis_results
SET outcome_status = 'no_trade'
WHERE outcome_status = 'pending'
  AND (recommendation = 'NO_TRADE' OR recommendation IS NULL);

UPDATE analysis_results
SET outcome_status = 'expired'
WHERE outcome_status = 'pending'
  AND recommendation IN ('LONG_YES', 'LONG_NO')
  AND executed_at < NOW() - INTERVAL '7 days';

CREATE TABLE IF NOT EXISTS analysis_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_request_id UUID NOT NULL REFERENCES analysis_requests(id) ON DELETE CASCADE,
  was_cached_delivery BOOLEAN NOT NULL DEFAULT false,
  delivery_channel TEXT NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_duplicate_delivery UNIQUE (result_id, user_id, analysis_request_id)
);

-- ============================================================================
-- AGENT MEMORY & PERFORMANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  result_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  fair_probability NUMERIC(5, 4) NOT NULL,
  key_drivers JSONB NOT NULL DEFAULT '[]',
  risk_factors JSONB NOT NULL DEFAULT '[]',
  signal_timestamp TIMESTAMPTZ NOT NULL,
  was_correct BOOLEAN,
  accuracy_score NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL UNIQUE,
  total_signals INTEGER NOT NULL DEFAULT 0,
  correct_signals INTEGER NOT NULL DEFAULT 0,
  accuracy_pct NUMERIC(5, 2) NOT NULL DEFAULT 50.00,
  avg_confidence NUMERIC(5, 4) NOT NULL DEFAULT 0.5000,
  avg_execution_time_ms INTEGER,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- DEVICE ENDPOINTS (Push Notification Registration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform_endpoint_arn TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_token TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_endpoints_user ON device_endpoints(user_id) WHERE is_active = true;

-- ============================================================================
-- NOTIFICATION PREFERENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id TEXT,
  channel_in_app BOOLEAN NOT NULL DEFAULT true,
  channel_email BOOLEAN NOT NULL DEFAULT false,
  channel_push BOOLEAN NOT NULL DEFAULT false,
  channel_webhook BOOLEAN NOT NULL DEFAULT false,
  webhook_url TEXT,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  min_probability_shift NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_market_pref UNIQUE (user_id, market_id)
);

-- ============================================================================
-- PORTFOLIO MANAGER SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_manager_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  recurring_analysis_id UUID NOT NULL,
  persona_id TEXT NOT NULL,
  persona_config JSONB NOT NULL,
  investment_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',

  -- Current position (null when not positioned)
  position_direction TEXT,
  position_size NUMERIC(12, 6),
  position_entry_price NUMERIC(8, 6),
  position_entry_at TIMESTAMPTZ,
  position_stop_loss_order_id TEXT,
  position_take_profit_order_id TEXT,

  -- Cumulative stats
  total_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  realized_pnl NUMERIC(12, 6) NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_hold_duration_minutes INTEGER NOT NULL DEFAULT 0,

  -- Capital tracking
  amount_in_positions NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_in_pending_orders NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_available NUMERIC(12, 2) NOT NULL,

  -- Scheduling
  position_guard_schedule_arn TEXT,

  -- Risk state
  cumulative_loss_pct NUMERIC(5, 4) NOT NULL DEFAULT 0,
  last_loss_exit_at TIMESTAMPTZ,
  position_size_reduction_active BOOLEAN NOT NULL DEFAULT false,

  -- Profit target
  profit_target_pct NUMERIC(6, 2),

  -- Lifecycle
  termination_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminated_at TIMESTAMPTZ,

  CONSTRAINT valid_pm_status CHECK (status IN ('active', 'paused', 'exiting', 'completed', 'terminated')),
  CONSTRAINT valid_pm_direction CHECK (position_direction IN ('YES', 'NO') OR position_direction IS NULL),
  CONSTRAINT positive_investment CHECK (investment_amount >= 5),
  CONSTRAINT valid_profit_target CHECK (profit_target_pct IS NULL OR profit_target_pct > 0)
);

-- ============================================================================
-- PORTFOLIO MANAGER TRADES
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_manager_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES portfolio_manager_sessions(id) ON DELETE CASCADE,
  analysis_result_id UUID REFERENCES analysis_results(id),

  direction TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  size_usdc NUMERIC(12, 6) NOT NULL,
  price NUMERIC(8, 6) NOT NULL,
  fill_price NUMERIC(8, 6),
  shares NUMERIC(12, 6),

  status TEXT NOT NULL DEFAULT 'pending',
  clob_order_id TEXT,

  trade_purpose TEXT NOT NULL,
  reasoning TEXT,
  conviction_score NUMERIC(5, 4),

  patience_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  realized_pnl NUMERIC(12, 6),
  hold_duration_minutes INTEGER,
  exit_reason TEXT,

  CONSTRAINT valid_trade_direction CHECK (direction IN ('YES', 'NO')),
  CONSTRAINT valid_trade_side CHECK (side IN ('BUY', 'SELL')),
  CONSTRAINT valid_trade_order_type CHECK (order_type IN ('limit', 'market')),
  CONSTRAINT valid_trade_status CHECK (status IN ('pending', 'filled', 'partially_filled', 'cancelled', 'failed')),
  CONSTRAINT valid_trade_purpose CHECK (trade_purpose IN ('entry', 'exit', 'stop_loss', 'take_profit', 'partial_exit', 'emergency_exit'))
);

-- ============================================================================
-- PORTFOLIO MANAGER DECISIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_manager_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES portfolio_manager_sessions(id) ON DELETE CASCADE,
  analysis_result_id UUID REFERENCES analysis_results(id),

  action TEXT NOT NULL,

  edge_met BOOLEAN,
  alignment_met BOOLEAN,
  conviction_score NUMERIC(5, 4),
  additional_criteria_met BOOLEAN,

  had_position BOOLEAN NOT NULL DEFAULT false,
  position_direction TEXT,
  position_unrealized_pnl NUMERIC(12, 6),

  reasoning TEXT NOT NULL,
  skip_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_decision_action CHECK (action IN ('enter', 'hold', 'exit', 'no_action', 'skip'))
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_results_market_time ON analysis_results(market_id, executed_at DESC);

-- Pending recommendations awaiting TP/SL outcome (used by recommendation-scorer Lambda)
CREATE INDEX IF NOT EXISTS idx_results_pending_outcome ON analysis_results(outcome_status, executed_at DESC)
  WHERE outcome_status = 'pending' AND recommendation IN ('LONG_YES', 'LONG_NO');

CREATE INDEX IF NOT EXISTS idx_schedule_next_run ON market_analysis_schedule(next_scheduled_run)
  WHERE status = 'active' AND is_executing = false;

CREATE INDEX IF NOT EXISTS idx_requests_user_status ON analysis_requests(user_id, status);

CREATE INDEX IF NOT EXISTS idx_requests_market_status ON analysis_requests(market_id, status)
  WHERE status = 'active';

-- Enforce one active recurring subscription per user per market.
-- Prevents duplicate recurring analysis subscriptions even under race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_recurring_per_user_market
  ON analysis_requests (user_id, market_id)
  WHERE request_type = 'recurring' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscribers_market ON market_subscribers(market_id)
  WHERE unsubscribed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_end ON subscriptions(trial_end)
  WHERE is_trial = TRUE AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_deliveries_user ON analysis_deliveries(user_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_market ON agent_memory(market_id, agent_name, signal_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_markets_condition ON markets(condition_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);

-- Prevent double-refunds: only one refund per user per failed request
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_duplicate_refund
  ON credit_transactions (user_id, reference_id)
  WHERE reason = 'analysis_failure_refund';

-- Portfolio Manager indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_user_market_active_session
  ON portfolio_manager_sessions(user_id, market_id)
  WHERE status IN ('active', 'paused', 'exiting');

CREATE INDEX IF NOT EXISTS idx_pm_sessions_user_status ON portfolio_manager_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_sessions_market ON portfolio_manager_sessions(market_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS idx_pm_trades_session ON portfolio_manager_trades(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_trades_status ON portfolio_manager_trades(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pm_decisions_session ON portfolio_manager_decisions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_sessions_active ON portfolio_manager_sessions(status, updated_at) WHERE status = 'active';

-- Idempotency: at most one decision per (session, analysis)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_decision_per_analysis
  ON portfolio_manager_decisions (session_id, analysis_result_id)
  WHERE analysis_result_id IS NOT NULL;

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers (DROP IF EXISTS + CREATE for idempotency)
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_markets_updated_at ON markets;
CREATE TRIGGER update_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_analysis_requests_updated_at ON analysis_requests;
CREATE TRIGGER update_analysis_requests_updated_at
  BEFORE UPDATE ON analysis_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_market_analysis_schedule_updated_at ON market_analysis_schedule;
CREATE TRIGGER update_market_analysis_schedule_updated_at
  BEFORE UPDATE ON market_analysis_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_device_endpoints_updated_at ON device_endpoints;
CREATE TRIGGER update_device_endpoints_updated_at
  BEFORE UPDATE ON device_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pm_sessions_updated_at ON portfolio_manager_sessions;
CREATE TRIGGER update_pm_sessions_updated_at
  BEFORE UPDATE ON portfolio_manager_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- CREDIT REBALANCE (idempotent - only applies to users on old limits)
-- ============================================================================

-- Free plan: 5 → 20 credits/month
UPDATE subscriptions
SET credits_monthly_limit = 20,
    credits_remaining = credits_remaining + 15,
    updated_at = now()
WHERE plan = 'free'
  AND status = 'active'
  AND credits_monthly_limit < 20;

-- Starter plan: 50 → 100 credits/month
UPDATE subscriptions
SET credits_monthly_limit = 100,
    credits_remaining = credits_remaining + 50,
    updated_at = now()
WHERE plan = 'starter'
  AND status = 'active'
  AND credits_monthly_limit < 100;

-- Pro plan: 200 → 350 credits/month
UPDATE subscriptions
SET credits_monthly_limit = 350,
    credits_remaining = credits_remaining + 150,
    updated_at = now()
WHERE plan = 'pro'
  AND status = 'active'
  AND credits_monthly_limit < 350;
