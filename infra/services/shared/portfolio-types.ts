/**
 * Shared types and Zod schemas for the Autonomous Portfolio Manager.
 *
 * Requirements: 2.1, 4.2, 10.5
 */

import { z } from 'zod';

// ============================================================================
// ENUMS & LITERALS
// ============================================================================

export const RiskLevel = z.enum(['conservative', 'moderate', 'aggressive']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const SessionStatus = z.enum(['active', 'paused', 'exiting', 'completed', 'terminated']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const TradeDirection = z.enum(['YES', 'NO']);
export type TradeDirection = z.infer<typeof TradeDirection>;

export const TradeSide = z.enum(['BUY', 'SELL']);
export type TradeSide = z.infer<typeof TradeSide>;

export const OrderType = z.enum(['limit', 'market']);
export type OrderType = z.infer<typeof OrderType>;

export const TradeStatus = z.enum(['pending', 'filled', 'partially_filled', 'cancelled', 'failed']);
export type TradeStatus = z.infer<typeof TradeStatus>;

export const TradePurpose = z.enum([
  'entry',
  'exit',
  'stop_loss',
  'take_profit',
  'partial_exit',
  'emergency_exit',
]);
export type TradePurpose = z.infer<typeof TradePurpose>;

export const ExitReason = z.enum([
  'target_reached',
  'stop_loss',
  'regime_shift',
  'stale_market',
  'contradicting_analysis',
  'risk_limit',
  'user_stop',
  'market_resolved',
]);
export type ExitReason = z.infer<typeof ExitReason>;

export const DecisionAction = z.enum(['enter', 'hold', 'exit', 'no_action', 'skip']);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const SkipReason = z.enum([
  'insufficient_data',
  'cooldown',
  'risk_limit',
  'paused',
  'kill_switch',
  'pipeline_failure',
]);
export type SkipReason = z.infer<typeof SkipReason>;

export const TerminationReason = z.enum([
  'user_stopped',
  'market_resolved',
  'capital_depleted',
  'kill_switch',
  'subscription_downgrade',
  'risk_limit',
  'profit_target_reached',
]);
export type TerminationReason = z.infer<typeof TerminationReason>;

// ============================================================================
// PERSONA
// ============================================================================

export const EntryRulesSchema = z.object({
  minEdge: z.number().min(0).max(100),
  minSignalAlignment: z.number().min(0).max(1),
  minConvictionScore: z.number().min(0).max(1),
  additionalCriteria: z.record(z.string(), z.any()).optional(),
});
export type EntryRules = z.infer<typeof EntryRulesSchema>;

export const SizingRulesSchema = z.object({
  minAllocationPct: z.number().min(0).max(100),
  maxAllocationPct: z.number().min(0).max(100),
  scalingFactor: z.number().min(0),
});
export type SizingRules = z.infer<typeof SizingRulesSchema>;

export const ExitRulesSchema = z.object({
  patienceWindowMinutes: z.number().int().min(1),
});
export type ExitRules = z.infer<typeof ExitRulesSchema>;

export const MonitoringRulesSchema = z.object({
  analysisIntervalMinutes: z.number().int().min(1),
  positionGuardIntervalMinutes: z.number().int().min(1),
});
export type MonitoringRules = z.infer<typeof MonitoringRulesSchema>;

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  riskLevel: RiskLevel,
  entryRules: EntryRulesSchema,
  sizingRules: SizingRulesSchema,
  exitRules: ExitRulesSchema,
  monitoringRules: MonitoringRulesSchema,
});
export type Persona = z.infer<typeof PersonaSchema>;

// ============================================================================
// CONVICTION SCORE
// ============================================================================

export const ConvictionScoreComponentsSchema = z.object({
  consensusConfidence: z.number().min(0).max(1),
  edgeMagnitude: z.number().min(0).max(1),
  signalAlignment: z.number().min(0).max(1),
});
export type ConvictionScoreComponents = z.infer<typeof ConvictionScoreComponentsSchema>;

export const ConvictionScoreSchema = z.object({
  value: z.number().min(0).max(1),
  components: ConvictionScoreComponentsSchema,
});
export type ConvictionScore = z.infer<typeof ConvictionScoreSchema>;

// ============================================================================
// PORTFOLIO SESSION
// ============================================================================

export const CurrentPositionSchema = z.object({
  direction: TradeDirection,
  size: z.number().min(0),
  entryPrice: z.number().min(0),
  entryTimestamp: z.string(),
  stopLossOrderId: z.string().optional(),
  takeProfitOrderId: z.string().optional(),
});
export type CurrentPosition = z.infer<typeof CurrentPositionSchema>;

export const SessionStatsSchema = z.object({
  totalTrades: z.number().int().min(0),
  winningTrades: z.number().int().min(0),
  realizedPnl: z.number(),
  unrealizedPnl: z.number(),
  avgHoldDurationMinutes: z.number().min(0),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

export const SessionSchedulesSchema = z.object({
  positionGuardScheduleArn: z.string().optional(),
});
export type SessionSchedules = z.infer<typeof SessionSchedulesSchema>;

export const PortfolioSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  marketId: z.string(),
  personaId: z.string(),
  personaConfig: PersonaSchema,
  investmentAmount: z.number().min(5),
  profitTargetPct: z.number().nullable().optional(),
  status: SessionStatus,
  currentPosition: CurrentPositionSchema.optional(),
  stats: SessionStatsSchema,
  schedules: SessionSchedulesSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  terminatedAt: z.string().optional(),
  terminationReason: TerminationReason.optional(),
});
export type PortfolioSession = z.infer<typeof PortfolioSessionSchema>;

// ============================================================================
// PORTFOLIO TRADE
// ============================================================================

export const PortfolioTradeSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  analysisResultId: z.string().uuid().optional(),
  direction: TradeDirection,
  side: TradeSide,
  orderType: OrderType,
  size: z.number().min(0),
  price: z.number().min(0),
  fillPrice: z.number().min(0).optional(),
  status: TradeStatus,
  clobOrderId: z.string().optional(),
  reasoning: z.string().max(500),
  tradePurpose: TradePurpose,
  convictionScore: z.number().min(0).max(1).optional(),
  patienceExpiresAt: z.string().optional(),
  createdAt: z.string(),
  filledAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  realizedPnl: z.number().optional(),
  holdDurationMinutes: z.number().int().min(0).optional(),
  exitReason: ExitReason.optional(),
});
export type PortfolioTrade = z.infer<typeof PortfolioTradeSchema>;

// ============================================================================
// PORTFOLIO DECISION
// ============================================================================

export const EntryEvaluationSchema = z.object({
  edgeMet: z.boolean(),
  alignmentMet: z.boolean(),
  convictionScore: z.number().min(0).max(1),
  additionalCriteriaMet: z.boolean(),
});
export type EntryEvaluation = z.infer<typeof EntryEvaluationSchema>;

export const PositionStateAtDecisionSchema = z.object({
  hasPosition: z.boolean(),
  direction: TradeDirection.optional(),
  unrealizedPnl: z.number().optional(),
});
export type PositionStateAtDecision = z.infer<typeof PositionStateAtDecisionSchema>;

export const PortfolioDecisionSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  analysisResultId: z.string().uuid().optional(),
  action: DecisionAction,
  entryEvaluation: EntryEvaluationSchema,
  positionStateAtDecision: PositionStateAtDecisionSchema,
  reasoning: z.string().max(500),
  skipReason: SkipReason.optional(),
  createdAt: z.string(),
});
export type PortfolioDecision = z.infer<typeof PortfolioDecisionSchema>;

// ============================================================================
// CAPITAL TRACKING
// ============================================================================

export const CapitalBreakdownSchema = z.object({
  investmentAmount: z.number().min(5),
  amountInPositions: z.number().min(0),
  amountInPendingOrders: z.number().min(0),
  amountAvailable: z.number().min(0),
  realizedPnl: z.number(),
});
export type CapitalBreakdown = z.infer<typeof CapitalBreakdownSchema>;

// ============================================================================
// RISK STATE
// ============================================================================

export const SessionRiskStateSchema = z.object({
  cumulativeLossPct: z.number().min(0).max(1),
  lastLossExitAt: z.string().optional(),
  positionSizeReductionActive: z.boolean(),
});
export type SessionRiskState = z.infer<typeof SessionRiskStateSchema>;

export const KillSwitchStateSchema = z.object({
  active: z.boolean(),
  triggeredAt: z.string().optional(),
  reason: z.string().optional(),
});
export type KillSwitchState = z.infer<typeof KillSwitchStateSchema>;

// ============================================================================
// API REQUEST / RESPONSE SCHEMAS
// ============================================================================

export const ActivateSessionRequestSchema = z.object({
  marketId: z.string().min(1),
  investmentAmount: z.number().min(5),
  profitTargetPct: z.number().min(1).max(10000).optional(), // e.g., 100 = 2x (100% return on investment)
});
export type ActivateSessionRequest = z.infer<typeof ActivateSessionRequestSchema>;

export const ActivateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: SessionStatus,
  profitTargetPct: z.number().nullable(),
  committedCapital: z.number().min(0),
});
export type ActivateSessionResponse = z.infer<typeof ActivateSessionResponseSchema>;

export const UpdateInvestmentRequestSchema = z.object({
  amount: z.number(),
  action: z.enum(['increase', 'decrease']),
});
export type UpdateInvestmentRequest = z.infer<typeof UpdateInvestmentRequestSchema>;

export const UpdatePersonaRequestSchema = z.object({
  personaId: z.string().min(1),
  customParams: z
    .object({
      exitSensitivity: z.number().int().min(1).max(5).optional(),
      monitoringFrequencyMinutes: z.number().int().min(5).max(60).optional(),
      positionSizingMultiplier: z.number().min(0.5).max(2.0).optional(),
    })
    .optional(),
});
export type UpdatePersonaRequest = z.infer<typeof UpdatePersonaRequestSchema>;

export const PaginationParamsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    hasMore: z.boolean(),
  });

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const PortfolioStatsResponseSchema = z.object({
  totalInvested: z.number().min(0),
  totalCommittedCapital: z.number().min(0),
  totalUnrealizedPnl: z.number(),
  totalRealizedPnl: z.number(),
  activeSessionCount: z.number().int().min(0),
});
export type PortfolioStatsResponse = z.infer<typeof PortfolioStatsResponseSchema>;

export const KillSwitchRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type KillSwitchRequest = z.infer<typeof KillSwitchRequestSchema>;

export const KillSwitchResponseSchema = z.object({
  sessionsTerminated: z.number().int().min(0),
});
export type KillSwitchResponse = z.infer<typeof KillSwitchResponseSchema>;

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export const PortfolioWebSocketEventType = z.enum([
  'portfolio.session.updated',
  'portfolio.trade.executed',
  'portfolio.position.exited',
  'portfolio.risk.alert',
  'portfolio.kill_switch.triggered',
]);
export type PortfolioWebSocketEventType = z.infer<typeof PortfolioWebSocketEventType>;

export const RiskAlertLevel = z.enum(['warning', 'critical']);
export type RiskAlertLevel = z.infer<typeof RiskAlertLevel>;

export interface SessionUpdatedEvent {
  type: 'portfolio.session.updated';
  sessionId: string;
  status: SessionStatus;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface TradeExecutedEvent {
  type: 'portfolio.trade.executed';
  sessionId: string;
  trade: {
    direction: TradeDirection;
    orderType: OrderType;
    size: number;
    price: number;
    reasoning: string;
  };
}

export interface PositionExitedEvent {
  type: 'portfolio.position.exited';
  sessionId: string;
  exitReason: ExitReason;
  pnl: number;
  holdDuration: number;
}

export interface RiskAlertEvent {
  type: 'portfolio.risk.alert';
  level: RiskAlertLevel;
  message: string;
  sessionsAffected: string[];
}

export interface KillSwitchTriggeredEvent {
  type: 'portfolio.kill_switch.triggered';
  reason: string;
  sessionsAffected: string[];
}

export type PortfolioWebSocketEvent =
  | SessionUpdatedEvent
  | TradeExecutedEvent
  | PositionExitedEvent
  | RiskAlertEvent
  | KillSwitchTriggeredEvent;

// ============================================================================
// PERSONA CUSTOMIZATION (Elite)
// ============================================================================

export const PersonaCustomParamsSchema = z.object({
  exitSensitivity: z.number().int().min(1).max(5).optional(),
  monitoringFrequencyMinutes: z.number().int().min(5).max(60).optional(),
  positionSizingMultiplier: z.number().min(0.5).max(2.0).optional(),
});
export type PersonaCustomParams = z.infer<typeof PersonaCustomParamsSchema>;

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum concurrent sessions per plan */
export const SESSION_LIMITS = {
  pro: 3,
  elite: 10,
} as const;

/** Minimum investment amount in USDC.e */
export const MIN_INVESTMENT_AMOUNT = 5;

/** Maximum position size as fraction of available investment */
export const MAX_POSITION_SIZE_PCT = 0.5;

/** Loss thresholds */
export const LOSS_THRESHOLDS = {
  /** Warning notification + 50% position size reduction */
  warningPct: 0.3,
  /** Approach threshold - initiate exit sequence */
  approachPct: 0.45,
  /** Hard limit - session terminated */
  maxPct: 0.5,
  /** Cross-session total loss - triggers kill switch */
  crossSessionPct: 0.4,
} as const;

/** Cooldown after loss exit in minutes */
export const LOSS_EXIT_COOLDOWN_MINUTES = 30;

/** Conviction score component weights */
export const CONVICTION_WEIGHTS = {
  consensusConfidence: 0.4,
  edgeMagnitude: 0.35,
  signalAlignment: 0.25,
} as const;
