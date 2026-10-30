/**
 * Shared TypeScript interfaces for Analysis_Lambda
 */

/** Structured output from each intelligence agent */
export interface AgentSignal {
  agentName: string;
  direction: 'YES' | 'NO' | 'NEUTRAL';
  confidence: number; // 0.0–1.0
  /** Probability of YES outcome occurring. ALWAYS P(YES), never P(direction). Range: 0.0–1.0 */
  fairProbability: number;
  keyDrivers: string[];
  riskFactors: string[];
  timestamp: string; // ISO 8601
}

/** Signal fusion output - market-anchored aggregation of agent signals */
export interface FusedSignal {
  /** Final P(YES) after market anchoring and evidence-scaled pass-through. */
  weightedFairProbability: number;
  /** Unshrunk ensemble estimate, useful for observability/replay. */
  rawFairProbability?: number;
  /** Market prior used for anchoring. */
  marketProbability?: number;
  /** Effective pass-through applied to the ensemble's raw edge (0..1). */
  shrinkage?: number;
  /** Explicit alias for the evidence-scaled pass-through. */
  passThrough?: number;
  fusionConfidence: number;
  signalAlignment: number;
  /** Dispersion of directional views, normalized to 0..1. */
  signalDisagreement?: number;
  /**
   * Standard error of the fused probability estimate, in probability points.
   *
   * This is the ensemble's noise floor: how far the aggregate can drift from the
   * market purely from agent disagreement, given how many (effectively
   * independent) agents voted. An edge smaller than this is not a signal.
   */
  fairValueStandardError?: number;
  /** Effective number of independent agent votes (Kish sample size). */
  effectiveSampleSize?: number;
  conflictMap: Array<{ agent1: string; agent2: string; divergence: number }>;
}

/** Consensus engine output */
export interface ConsensusResult {
  probability: number;
  confidence: number;
  disagreementIndex: number;
  failed: boolean;
}

/** Bull or bear thesis produced by thesis construction agent */
export interface Thesis {
  direction: 'bull' | 'bear';
  /** Probability of YES outcome occurring. ALWAYS P(YES) for both bull AND bear theses.
   *  Bull thesis should have HIGH fairProbability, bear thesis should have LOW fairProbability. */
  fairProbability: number;
  keyArguments: string[];
  confidence: number;
}

/** Cross-examination result - adversarial scoring of theses */
export interface CrossExamResult {
  bullScore: number; // -5.0 to +5.0
  bearScore: number; // -5.0 to +5.0
}

/** Input payload for Analysis_Lambda */
export interface AnalysisPayload {
  marketId: string; // non-empty
  userId: string; // non-empty
  requestId: string; // non-empty
}

/** Final output of the analysis workflow */
export interface TradeRecommendation {
  marketId: string;
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  expectedValue: number;
  winProbability: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  explanation: {
    summary: string;
    coreThesis: string;
    keyCatalysts: string[];
    failureScenarios: string[];
    uncertaintyNote: string;
    riskPerspectives: string;
  };
  metadata: {
    consensusProbability: number;
    marketProbability: number;
    edge: number;
    confidenceBand: [number, number];
    totalLlmCalls: number;
    executionDurationMs: number;
    agentsUsed: string[];
    marketQuestion: string;
    disagreementIndex?: number;
    /** Deterministic risk/reward check result. */
    riskRewardRatio?: number;
    /** Annualized or raw price volatility used for level generation. */
    volatility?: number;
    /** Market resolution date (ISO 8601) if available. */
    marketEndDate?: string;
    /** Whether the divergence circuit breaker blocked the trade. */
    divergenceGuardTriggered?: boolean;
    /** Whether the winning thesis vetoed the trade direction. */
    thesisVetoTriggered?: boolean;
    /**
     * Machine-readable gate that produced a NO_TRADE verdict.
     * Lets a run be diagnosed without parsing the explanation prose.
     */
    noTradeReason?:
      | 'consensus_failed'
      | 'divergence_cap'
      | 'edge_below_threshold'
      | 'edge_below_significance'
      | 'thesis_veto';
  };
  _analysisDetail?: unknown;
}
