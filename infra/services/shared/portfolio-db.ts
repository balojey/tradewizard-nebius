/**
 * Shared database query helpers for the Autonomous Portfolio Manager.
 * Provides parameterized SQL queries for session CRUD, trade recording,
 * decision logging, capital tracking, and session statistics aggregation.
 *
 * Requirements: 1.7, 4.9, 7.7, 10.5
 */

import type {
  SessionStatus,
  TradeDirection,
  TradeSide,
  OrderType,
  TradePurpose,
  TradeStatus,
  ExitReason,
  DecisionAction,
  SkipReason,
  TerminationReason,
  Persona,
  CapitalBreakdown,
  PortfolioSession,
  PortfolioTrade,
  PortfolioDecision,
} from './portfolio-types';

// ============================================================================
// SESSION CRUD
// ============================================================================

export const SESSION_QUERIES = {
  /**
   * Create a new portfolio manager session.
   * Params: $1=userId, $2=marketId, $3=recurringAnalysisId, $4=personaId,
   *         $5=personaConfig (JSONB), $6=investmentAmount, $7=amountAvailable,
   *         $8=profitTargetPct (nullable)
   */
  createSession: `
    INSERT INTO portfolio_manager_sessions (
      user_id, market_id, recurring_analysis_id, persona_id,
      persona_config, investment_amount, status, amount_available,
      profit_target_pct
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
    RETURNING id, user_id, market_id, recurring_analysis_id, persona_id,
              persona_config, investment_amount, status, amount_available,
              profit_target_pct, created_at, updated_at
  `,

  /**
   * Get a session by ID.
   * Params: $1=sessionId
   */
  getSessionById: `
    SELECT id, user_id, market_id, recurring_analysis_id, persona_id,
           persona_config, investment_amount, status,
           position_direction, position_size, position_entry_price,
           position_entry_at, position_stop_loss_order_id, position_take_profit_order_id,
           total_trades, winning_trades, realized_pnl, unrealized_pnl,
           total_hold_duration_minutes,
           amount_in_positions, amount_in_pending_orders, amount_available,
           position_guard_schedule_arn,
           cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active,
           profit_target_pct,
           termination_reason, created_at, updated_at, terminated_at
    FROM portfolio_manager_sessions
    WHERE id = $1
  `,

  /**
   * Get all sessions for a user, ordered by most recent first.
   * Params: $1=userId
   */
  getSessionsByUser: `
    SELECT id, user_id, market_id, recurring_analysis_id, persona_id,
           persona_config, investment_amount, status,
           position_direction, position_size, position_entry_price,
           position_entry_at, position_stop_loss_order_id, position_take_profit_order_id,
           total_trades, winning_trades, realized_pnl, unrealized_pnl,
           total_hold_duration_minutes,
           amount_in_positions, amount_in_pending_orders, amount_available,
           position_guard_schedule_arn,
           cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active,
           profit_target_pct,
           termination_reason, created_at, updated_at, terminated_at
    FROM portfolio_manager_sessions
    WHERE user_id = $1
    ORDER BY created_at DESC
  `,

  /**
   * Get active sessions for a specific market (active, paused, or exiting).
   * Params: $1=marketId
   */
  getActiveSessionsForMarket: `
    SELECT id, user_id, market_id, recurring_analysis_id, persona_id,
           persona_config, investment_amount, status,
           position_direction, position_size, position_entry_price,
           position_entry_at, position_stop_loss_order_id, position_take_profit_order_id,
           total_trades, winning_trades, realized_pnl, unrealized_pnl,
           total_hold_duration_minutes,
           amount_in_positions, amount_in_pending_orders, amount_available,
           position_guard_schedule_arn,
           cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active,
           termination_reason, created_at, updated_at, terminated_at
    FROM portfolio_manager_sessions
    WHERE market_id = $1 AND status IN ('active', 'paused', 'exiting')
  `,

  /**
   * Get active sessions for a specific (market, user) - preferred entry-decision
   * lookup since the orchestrator emits one AnalysisCompleted event per
   * delivered subscriber, so the trade-executor only needs that user's
   * sessions on the market. Avoids fetching unrelated users' sessions.
   * Params: $1=marketId, $2=userId
   */
  getActiveSessionsForMarketAndUser: `
    SELECT id, user_id, market_id, recurring_analysis_id, persona_id,
           persona_config, investment_amount, status,
           position_direction, position_size, position_entry_price,
           position_entry_at, position_stop_loss_order_id, position_take_profit_order_id,
           total_trades, winning_trades, realized_pnl, unrealized_pnl,
           total_hold_duration_minutes,
           amount_in_positions, amount_in_pending_orders, amount_available,
           position_guard_schedule_arn,
           cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active,
           termination_reason, created_at, updated_at, terminated_at
    FROM portfolio_manager_sessions
    WHERE market_id = $1 AND user_id = $2
      AND status IN ('active', 'paused', 'exiting')
  `,

  /**
   * Update session status.
   * Params: $1=status, $2=sessionId
   */
  updateSessionStatus: `
    UPDATE portfolio_manager_sessions
    SET status = $1
    WHERE id = $2
    RETURNING id, status, updated_at
  `,

  /**
   * Update session current position.
   * Params: $1=positionDirection, $2=positionSize, $3=positionEntryPrice,
   *         $4=positionEntryAt, $5=stopLossOrderId, $6=takeProfitOrderId, $7=sessionId
   */
  updateSessionPosition: `
    UPDATE portfolio_manager_sessions
    SET position_direction = $1,
        position_size = $2,
        position_entry_price = $3,
        position_entry_at = $4,
        position_stop_loss_order_id = $5,
        position_take_profit_order_id = $6
    WHERE id = $7
    RETURNING id, position_direction, position_size, position_entry_price,
              position_entry_at, updated_at
  `,

  /**
   * Terminate a session with reason and timestamp.
   * Params: $1=terminationReason, $2=terminatedAt, $3=sessionId
   */
  terminateSession: `
    UPDATE portfolio_manager_sessions
    SET status = 'terminated',
        termination_reason = $1,
        terminated_at = $2,
        position_direction = NULL,
        position_size = NULL,
        position_entry_price = NULL,
        position_entry_at = NULL,
        position_stop_loss_order_id = NULL,
        position_take_profit_order_id = NULL
    WHERE id = $3
    RETURNING id, status, termination_reason, terminated_at, updated_at
  `,
} as const;

// ============================================================================
// TRADE RECORDING
// ============================================================================

export const TRADE_QUERIES = {
  /**
   * Create a new trade record.
   * Params: $1=sessionId, $2=analysisResultId, $3=direction, $4=side,
   *         $5=orderType, $6=sizeUsdc, $7=price, $8=status, $9=clobOrderId,
   *         $10=tradePurpose, $11=reasoning, $12=convictionScore, $13=patienceExpiresAt
   */
  createTrade: `
    INSERT INTO portfolio_manager_trades (
      session_id, analysis_result_id, direction, side, order_type,
      size_usdc, price, status, clob_order_id, trade_purpose,
      reasoning, conviction_score, patience_expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, session_id, direction, side, order_type, size_usdc, price,
              status, clob_order_id, trade_purpose, reasoning, conviction_score,
              patience_expires_at, created_at
  `,

  /**
   * Update trade status and fill details.
   * Params: $1=status, $2=fillPrice, $3=shares, $4=filledAt, $5=cancelledAt,
   *         $6=realizedPnl, $7=holdDurationMinutes, $8=exitReason, $9=tradeId
   */
  updateTradeStatus: `
    UPDATE portfolio_manager_trades
    SET status = $1,
        fill_price = $2,
        shares = $3,
        filled_at = $4,
        cancelled_at = $5,
        realized_pnl = $6,
        hold_duration_minutes = $7,
        exit_reason = $8
    WHERE id = $9
    RETURNING id, session_id, status, fill_price, shares, filled_at,
              cancelled_at, realized_pnl, hold_duration_minutes, exit_reason
  `,

  /**
   * Get trades for a session with pagination (most recent first).
   * Params: $1=sessionId, $2=limit, $3=offset
   */
  getTradesBySession: `
    SELECT id, session_id, analysis_result_id, direction, side, order_type,
           size_usdc, price, fill_price, shares, status, clob_order_id,
           trade_purpose, reasoning, conviction_score, patience_expires_at,
           created_at, filled_at, cancelled_at, realized_pnl,
           hold_duration_minutes, exit_reason
    FROM portfolio_manager_trades
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,

  /**
   * Count total trades for a session (for pagination metadata).
   * Params: $1=sessionId
   */
  countTradesBySession: `
    SELECT COUNT(*)::int AS total
    FROM portfolio_manager_trades
    WHERE session_id = $1
  `,
} as const;

// ============================================================================
// DECISION LOGGING
// ============================================================================

export const DECISION_QUERIES = {
  /**
   * Check whether a decision has already been recorded for a given
   * (session, analysis_result) pair. Used by the trade-executor as an
   * idempotency guard so SQS retries that re-trigger AnalysisCompleted
   * events for the same result don't produce duplicate decisions or
   * trades.
   * Params: $1=sessionId, $2=analysisResultId
   */
  hasDecisionForAnalysis: `
    SELECT 1
    FROM portfolio_manager_decisions
    WHERE session_id = $1 AND analysis_result_id = $2::uuid
    LIMIT 1
  `,

  /**
   * Create a new decision record.
   * Params: $1=sessionId, $2=analysisResultId, $3=action, $4=edgeMet,
   *         $5=alignmentMet, $6=convictionScore, $7=additionalCriteriaMet,
   *         $8=hadPosition, $9=positionDirection, $10=positionUnrealizedPnl,
   *         $11=reasoning, $12=skipReason
   */
  createDecision: `
    INSERT INTO portfolio_manager_decisions (
      session_id, analysis_result_id, action, edge_met, alignment_met,
      conviction_score, additional_criteria_met, had_position,
      position_direction, position_unrealized_pnl, reasoning, skip_reason
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, session_id, action, edge_met, alignment_met,
              conviction_score, additional_criteria_met, had_position,
              position_direction, position_unrealized_pnl, reasoning,
              skip_reason, created_at
  `,

  /**
   * Get decisions for a session with pagination (most recent first).
   * Params: $1=sessionId, $2=limit, $3=offset
   */
  getDecisionsBySession: `
    SELECT id, session_id, analysis_result_id, action, edge_met, alignment_met,
           conviction_score, additional_criteria_met, had_position,
           position_direction, position_unrealized_pnl, reasoning,
           skip_reason, created_at
    FROM portfolio_manager_decisions
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,

  /**
   * Count total decisions for a session (for pagination metadata).
   * Params: $1=sessionId
   */
  countDecisionsBySession: `
    SELECT COUNT(*)::int AS total
    FROM portfolio_manager_decisions
    WHERE session_id = $1
  `,
} as const;

// ============================================================================
// CAPITAL TRACKING
// ============================================================================

export const CAPITAL_QUERIES = {
  /**
   * Update capital breakdown for a session.
   * Params: $1=amountInPositions, $2=amountInPendingOrders, $3=amountAvailable, $4=sessionId
   */
  updateCapitalBreakdown: `
    UPDATE portfolio_manager_sessions
    SET amount_in_positions = $1,
        amount_in_pending_orders = $2,
        amount_available = $3
    WHERE id = $4
    RETURNING id, investment_amount, amount_in_positions, amount_in_pending_orders,
              amount_available, realized_pnl
  `,

  /**
   * Get capital breakdown for a session.
   * Params: $1=sessionId
   */
  getCapitalBreakdown: `
    SELECT investment_amount, amount_in_positions, amount_in_pending_orders,
           amount_available, realized_pnl
    FROM portfolio_manager_sessions
    WHERE id = $1
  `,
} as const;

// ============================================================================
// SESSION STATISTICS
// ============================================================================

export const STATS_QUERIES = {
  /**
   * Update session cumulative statistics after a trade completes.
   * Params: $1=totalTrades, $2=winningTrades, $3=realizedPnl, $4=unrealizedPnl,
   *         $5=totalHoldDurationMinutes, $6=sessionId
   */
  updateSessionStats: `
    UPDATE portfolio_manager_sessions
    SET total_trades = $1,
        winning_trades = $2,
        realized_pnl = $3,
        unrealized_pnl = $4,
        total_hold_duration_minutes = $5
    WHERE id = $6
    RETURNING id, total_trades, winning_trades, realized_pnl, unrealized_pnl,
              total_hold_duration_minutes
  `,

  /**
   * Get aggregate portfolio statistics for a user.
   * Returns total invested, total realized P&L, total unrealized P&L, and active session count.
   * Params: $1=userId
   */
  getAggregateStats: `
    SELECT
      COALESCE(SUM(investment_amount), 0)::numeric AS total_invested,
      COALESCE(SUM(realized_pnl), 0)::numeric AS total_realized_pnl,
      COALESCE(SUM(unrealized_pnl), 0)::numeric AS total_unrealized_pnl,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_session_count
    FROM portfolio_manager_sessions
    WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')
  `,

  /**
   * Get total capital committed to active portfolio sessions for a user.
   * Used to calculate available balance (wallet balance - committed).
   * Params: $1=userId
   */
  getTotalCommittedCapital: `
    SELECT COALESCE(SUM(investment_amount), 0)::numeric AS total_committed
    FROM portfolio_manager_sessions
    WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')
  `,
} as const;

// ============================================================================
// UTILITY QUERIES
// ============================================================================

export const UTILITY_QUERIES = {
  /**
   * Count active sessions for a user (active, paused, or exiting).
   * Used for concurrent session limit enforcement.
   * Params: $1=userId
   */
  countActiveSessionsByUser: `
    SELECT COUNT(*)::int AS active_count
    FROM portfolio_manager_sessions
    WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')
  `,

  /**
   * Check if user already has an active session for a specific market.
   * Returns the session ID if one exists, null otherwise.
   * Params: $1=userId, $2=marketId
   */
  checkExistingActiveSession: `
    SELECT id, status
    FROM portfolio_manager_sessions
    WHERE user_id = $1 AND market_id = $2 AND status IN ('active', 'paused', 'exiting')
    LIMIT 1
  `,

  /**
   * Update risk state for a session.
   * Params: $1=cumulativeLossPct, $2=lastLossExitAt, $3=positionSizeReductionActive, $4=sessionId
   */
  updateRiskState: `
    UPDATE portfolio_manager_sessions
    SET cumulative_loss_pct = $1,
        last_loss_exit_at = $2,
        position_size_reduction_active = $3
    WHERE id = $4
    RETURNING id, cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active
  `,

  /**
   * Update the position guard schedule ARN for a session.
   * Params: $1=positionGuardScheduleArn, $2=sessionId
   */
  updateScheduleArn: `
    UPDATE portfolio_manager_sessions
    SET position_guard_schedule_arn = $1
    WHERE id = $2
    RETURNING id, position_guard_schedule_arn
  `,

  /**
   * Get pending trades for a session (for cancellation on stop/kill switch).
   * Params: $1=sessionId
   */
  getPendingTradesBySession: `
    SELECT id, clob_order_id, direction, side, size_usdc, price, trade_purpose
    FROM portfolio_manager_trades
    WHERE session_id = $1 AND status = 'pending'
  `,

  /**
   * Get all active sessions for a user (for kill switch propagation).
   * Params: $1=userId
   */
  getAllActiveSessionsForUser: `
    SELECT id, market_id, position_direction, position_size,
           position_guard_schedule_arn, amount_in_positions, amount_in_pending_orders
    FROM portfolio_manager_sessions
    WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')
  `,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build pagination metadata from total count and current page params.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number
): { offset: number; hasMore: boolean } {
  const offset = (page - 1) * pageSize;
  const hasMore = offset + pageSize < total;
  return { offset, hasMore };
}

/**
 * Map a database row to a PortfolioSession object.
 * Converts snake_case columns to camelCase TypeScript fields.
 */
export function mapRowToSession(row: Record<string, unknown>): PortfolioSession {
  const currentPosition: PortfolioSession['currentPosition'] = row.position_direction
    ? {
        direction: row.position_direction as TradeDirection,
        size: Number(row.position_size),
        entryPrice: Number(row.position_entry_price),
        entryTimestamp: (row.position_entry_at as Date)?.toISOString() ?? '',
        stopLossOrderId: row.position_stop_loss_order_id as string | undefined,
        takeProfitOrderId: row.position_take_profit_order_id as string | undefined,
      }
    : undefined;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    marketId: row.market_id as string,
    personaId: row.persona_id as string,
    personaConfig: row.persona_config as Persona,
    investmentAmount: Number(row.investment_amount),
    profitTargetPct: row.profit_target_pct != null ? Number(row.profit_target_pct) : null,
    status: row.status as SessionStatus,
    currentPosition,
    stats: {
      totalTrades: Number(row.total_trades),
      winningTrades: Number(row.winning_trades),
      realizedPnl: Number(row.realized_pnl),
      unrealizedPnl: Number(row.unrealized_pnl),
      avgHoldDurationMinutes:
        Number(row.total_trades) > 0
          ? Number(row.total_hold_duration_minutes) / Number(row.total_trades)
          : 0,
    },
    schedules: {
      positionGuardScheduleArn: row.position_guard_schedule_arn as string | undefined,
    },
    createdAt: (row.created_at as Date)?.toISOString() ?? '',
    updatedAt: (row.updated_at as Date)?.toISOString() ?? '',
    terminatedAt: row.terminated_at
      ? (row.terminated_at as Date).toISOString()
      : undefined,
    terminationReason: row.termination_reason as TerminationReason | undefined,
  };
}

/**
 * Map a database row to a PortfolioTrade object.
 */
export function mapRowToTrade(row: Record<string, unknown>): PortfolioTrade {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    analysisResultId: row.analysis_result_id as string | undefined,
    direction: row.direction as TradeDirection,
    side: row.side as TradeSide,
    orderType: row.order_type as OrderType,
    size: Number(row.size_usdc),
    price: Number(row.price),
    fillPrice: row.fill_price != null ? Number(row.fill_price) : undefined,
    status: row.status as TradeStatus,
    clobOrderId: row.clob_order_id as string | undefined,
    reasoning: (row.reasoning as string) ?? '',
    tradePurpose: row.trade_purpose as TradePurpose,
    convictionScore: row.conviction_score != null ? Number(row.conviction_score) : undefined,
    patienceExpiresAt: row.patience_expires_at
      ? (row.patience_expires_at as Date).toISOString()
      : undefined,
    createdAt: (row.created_at as Date)?.toISOString() ?? '',
    filledAt: row.filled_at ? (row.filled_at as Date).toISOString() : undefined,
    cancelledAt: row.cancelled_at ? (row.cancelled_at as Date).toISOString() : undefined,
    realizedPnl: row.realized_pnl != null ? Number(row.realized_pnl) : undefined,
    holdDurationMinutes: row.hold_duration_minutes != null
      ? Number(row.hold_duration_minutes)
      : undefined,
    exitReason: row.exit_reason as ExitReason | undefined,
  };
}

/**
 * Map a database row to a PortfolioDecision object.
 */
export function mapRowToDecision(row: Record<string, unknown>): PortfolioDecision {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    analysisResultId: row.analysis_result_id as string | undefined,
    action: row.action as DecisionAction,
    entryEvaluation: {
      edgeMet: row.edge_met as boolean,
      alignmentMet: row.alignment_met as boolean,
      convictionScore: Number(row.conviction_score ?? 0),
      additionalCriteriaMet: row.additional_criteria_met as boolean,
    },
    positionStateAtDecision: {
      hasPosition: row.had_position as boolean,
      direction: row.position_direction as TradeDirection | undefined,
      unrealizedPnl: row.position_unrealized_pnl != null
        ? Number(row.position_unrealized_pnl)
        : undefined,
    },
    reasoning: row.reasoning as string,
    skipReason: row.skip_reason as SkipReason | undefined,
    createdAt: (row.created_at as Date)?.toISOString() ?? '',
  };
}

/**
 * Map a database row to a CapitalBreakdown object.
 */
export function mapRowToCapitalBreakdown(row: Record<string, unknown>): CapitalBreakdown {
  return {
    investmentAmount: Number(row.investment_amount),
    amountInPositions: Number(row.amount_in_positions),
    amountInPendingOrders: Number(row.amount_in_pending_orders),
    amountAvailable: Number(row.amount_available),
    realizedPnl: Number(row.realized_pnl),
  };
}
