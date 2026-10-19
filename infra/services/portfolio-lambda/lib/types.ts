/**
 * Portfolio_Lambda type definitions.
 *
 * Defines the PortfolioDecision output interface and PortfolioPayload input schema
 * used for validation and type safety throughout the Portfolio_Lambda service.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.6, 2.7
 */

// ─── Valid Personas ──────────────────────────────────────────────────────────

export const VALID_PERSONAS = [
  'sniper',
  'scalper',
  'contrarian',
  'catalyst-hunter',
  'hedge-architect',
  'momentum-rider',
] as const;

export type PersonaId = typeof VALID_PERSONAS[number];

// ─── Decision Types ──────────────────────────────────────────────────────────

export const VALID_DECISION_TYPES = ['entry', 'exit_evaluation'] as const;
export type DecisionType = typeof VALID_DECISION_TYPES[number];

// ─── Portfolio Decision (output) ─────────────────────────────────────────────

export const VALID_ACTIONS = ['enter', 'hold', 'exit', 'scale', 'skip'] as const;
export type PortfolioAction = typeof VALID_ACTIONS[number];

export const VALID_DIRECTIONS = ['YES', 'NO'] as const;
export type PortfolioDirection = typeof VALID_DIRECTIONS[number] | null;

export const VALID_ORDER_TYPES = ['limit', 'market'] as const;
export type OrderType = typeof VALID_ORDER_TYPES[number];

export const VALID_EXIT_REASONS = [
  'regime_shift',
  'stale_market',
  'contradicting_analysis',
  'target_reached',
] as const;
export type ExitReason = typeof VALID_EXIT_REASONS[number] | null;

export interface PortfolioDecision {
  action: PortfolioAction;
  direction: PortfolioDirection;
  sizePct: number;          // 0.0–1.0
  price: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  orderType: OrderType;
  reasoning: string;         // max 500 chars
  conviction: number;        // 0.0–1.0
  exitReason: ExitReason;
  isPyramid: boolean;
}

// ─── Portfolio Payload (input) ───────────────────────────────────────────────

export interface AnalysisResultPayload {
  analysisResultId: string;
  marketId: string;
  action: string;
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  liquidityRisk: string;
  signalAlignment: number;
  confidence: number;
  explanation: Record<string, unknown>;
}

export interface PortfolioStatePayload {
  session: Record<string, unknown>;
  positions: Array<Record<string, unknown>>;
  capitalBreakdown: Record<string, unknown>;
}

export interface MarketDataPayload {
  marketId: string;
  currentPrice: number;
  edge: number;
  signalAlignment: number;
}

export interface PortfolioPayload {
  persona: PersonaId;
  analysisResult?: AnalysisResultPayload;
  portfolioState: PortfolioStatePayload;
  marketData: MarketDataPayload;
  decisionType: DecisionType;
}

// ─── Default Skip Decision ───────────────────────────────────────────────────

export function buildSkipDecision(reasoning: string): PortfolioDecision {
  return {
    action: 'skip',
    direction: null,
    sizePct: 0,
    price: null,
    stopLossPrice: null,
    takeProfitPrice: null,
    orderType: 'market',
    reasoning: reasoning.slice(0, 500),
    conviction: 0,
    exitReason: null,
    isPyramid: false,
  };
}
