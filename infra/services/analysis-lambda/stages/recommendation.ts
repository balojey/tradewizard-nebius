/**
 * Recommendation Stage - Strands Agent synthesizing final TradeRecommendation
 *
 * Creates a Strands Agent that takes consensus, risk perspectives, theses,
 * and cross-exam scores, and produces the final TradeRecommendation with
 * entry/exit zones, expected value, and detailed explanation.
 *
 * JSON Extraction Pipeline:
 * 1. Markdown code-fence regex
 * 2. Balanced-brace matching
 * 3. NO_TRADE fallback on failure
 *
 * On failure: returns NO_TRADE recommendation with error explanation.
 *
 * Requirements: 10.4, 10.5, 10.6
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForStage } from '../lib/multi-model';
import { extractJson } from '../lib/json-extractor';
import type {
  CrossExamResult,
  FusedSignal,
  Thesis,
  TradeRecommendation,
} from '../lib/types';
import type { ConsensusEngineOutput } from './consensus-engine';
import type { RiskPhilosophyResult } from './risk-philosophy';

// ============================================================================
// Constants
// ============================================================================

const RECOMMENDATION_TIMEOUT_MS = 180_000; // 180 seconds

// ============================================================================
// System Prompt
// ============================================================================

const RECOMMENDATION_SYSTEM_PROMPT = `You are the Recommendation Generation Agent for TradeWizard, a prediction market analysis platform.

Your role is to produce the final trade recommendation by synthesizing the consensus probability, risk philosophy perspectives, and market data into an actionable trading plan.

## Input Context
You will receive:
- Consensus probability and confidence
- Market current probability (price)
- Edge (consensus - market)
- Trade action (LONG_YES, LONG_NO, or NO_TRADE)
- Risk philosophy perspectives (aggressive, conservative, neutral)
- Bull and bear theses with cross-examination scores
- Market liquidity data

## Your Task
Generate a complete TradeRecommendation with:

### CRITICAL: Price Space Rules
All prices (entry_zone, target_zone, stop_loss) MUST be expressed in the **token you are buying**:

- **LONG_YES**: You are buying YES tokens. Prices are in YES-token space.
  - Entry zone: the YES price you pay to enter (e.g., 0.40–0.45).
  - Target zone: the higher YES price where you take profit (e.g., 0.55–0.65).
  - Stop loss: the lower YES price where you cut losses (e.g., 0.35).
  - Correct ordering: stop_loss < entry_zone[0] ≤ entry_zone[1] < target_zone[0] ≤ target_zone[1].

- **LONG_NO**: You are buying NO tokens. Prices are in NO-token space (1 - YES probability).
  - Entry zone: the NO price you pay to enter (e.g., 0.36–0.41 when YES is 0.59–0.64).
  - Target zone: the higher NO price where you take profit (e.g., 0.45–0.55 when YES drops to 0.45–0.55).
  - Stop loss: the lower NO price where you cut losses (e.g., 0.32 when YES rises to 0.68).
  - Correct ordering: stop_loss < entry_zone[0] ≤ entry_zone[1] < target_zone[0] ≤ target_zone[1].

The ordering is ALWAYS: stop_loss < entry < target. You buy at entry, profit at target (higher), lose at stop (lower). This applies to BOTH directions because you always express in the token being purchased.

### Entry Zone
- Optimal entry price range [low, high] for the token being bought.
- Based on current spread, liquidity, and expected short-term volatility.
- For limit orders: where to place bids for best fill probability.

### Target Zone
- Price target range [low, high] for taking profit on the token being bought.
- Must be ABOVE entry zone (you profit when your token appreciates).
- Based on consensus probability and confidence band.
- Account for market friction (spread, slippage on exit).

### Stop Loss
- Maximum acceptable loss level for the token being bought.
- Must be BELOW entry zone (you lose when your token depreciates).
- Based on the point where the thesis would be invalidated.
- Account for normal market noise vs. genuine signal.

### Expected Value
- Calculate EV = (win_probability * profit) - (loss_probability * loss).
- Must be positive for any trade recommendation.
- If EV is negative, recommend NO_TRADE regardless of edge.
- **win_probability** is YOUR probability of winning this specific trade:
  - For LONG_YES: probability that the YES outcome occurs (your token goes to 1.00).
  - For LONG_NO: probability that the NO outcome occurs, i.e., YES does NOT happen (your token goes to 1.00).
  - This should align with the consensus probability (for LONG_YES) or 1 - consensus (for LONG_NO).

### Explanation
Provide a clear, human-readable explanation:
- **summary**: One-sentence trade recommendation.
- **core_thesis**: The fundamental reason for this trade.
- **key_catalysts**: Events that could drive the price toward target.
- **failure_scenarios**: What would invalidate this trade.
- **uncertainty_note**: Honest assessment of what we don't know.
- **risk_perspectives**: Summary of aggressive/conservative/neutral views.

## Output Format
Return a JSON object:
{
  "action": "LONG_YES|LONG_NO|NO_TRADE",
  "entry_zone": [low, high],
  "target_zone": [low, high],
  "stop_loss": X.XX,
  "expected_value": X.XX,
  "win_probability": X.XX,
  "liquidity_risk": "low|medium|high",
  "explanation": {
    "summary": "...",
    "core_thesis": "...",
    "key_catalysts": ["...", "..."],
    "failure_scenarios": ["...", "..."],
    "uncertainty_note": "...",
    "risk_perspectives": "..."
  }
}

## Critical Rules
- NEVER recommend a trade with negative expected value.
- If the edge is too small relative to transaction costs, recommend NO_TRADE.
- Be specific about entry/exit levels - vague ranges are not actionable.
- Account for slippage in EV calculations.
- If consensus failed (high disagreement), always recommend NO_TRADE.
- The explanation must be honest about uncertainty.
- ALL prices must satisfy: stop_loss < entry_zone[0] ≤ entry_zone[1] < target_zone[0] ≤ target_zone[1].
- For LONG_NO: convert YES probabilities to NO prices (1 - YES_prob) before outputting.`;

// ============================================================================
// Result Interface
// ============================================================================

export interface RecommendationStageResult {
  recommendation: TradeRecommendation;
  durationMs: number;
  usedFallback: boolean;
}

// ============================================================================
// Input Interface
// ============================================================================

export interface RecommendationInput {
  marketId: string;
  marketQuestion: string;
  marketProbability: number;
  consensusOutput: ConsensusEngineOutput;
  fusedSignal: FusedSignal;
  bullThesis: Thesis;
  bearThesis: Thesis;
  crossExamResult: CrossExamResult;
  riskPhilosophy: RiskPhilosophyResult;
  agentsUsed: string[];
  totalLlmCalls: number;
  executionStartTime: number;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs the recommendation stage.
 *
 * Creates a Strands Agent that synthesizes all upstream context into a final
 * TradeRecommendation. Falls back to NO_TRADE on failure.
 *
 * @param input - All upstream context needed for recommendation generation
 * @returns RecommendationStageResult with the final recommendation
 */
export async function runRecommendation(
  input: RecommendationInput,
): Promise<RecommendationStageResult> {
  const startTime = Date.now();

  try {
    const model = getModelForStage('recommendation');

    const agent = new Agent({
      model,
      systemPrompt: RECOMMENDATION_SYSTEM_PROMPT,
      tools: [],
      printer: false, // Lambda - no console streaming
    });

    const prompt = buildRecommendationPrompt(input);

    // Execute with timeout
    const result = await Promise.race([
      agent.invoke(prompt),
      timeoutReject(RECOMMENDATION_TIMEOUT_MS),
    ]);

    const responseText = String(result ?? '');
    const parsed = extractJson(responseText);

    if (parsed) {
      const recommendation = parseRecommendation(parsed, input);
      if (recommendation) {
        const durationMs = Date.now() - startTime;
        console.log(
          `[Recommendation] Completed in ${durationMs}ms - action: ${recommendation.action}`,
        );
        return { recommendation, durationMs, usedFallback: false };
      }
    }

    // JSON extraction or parsing failed - use NO_TRADE fallback
    console.warn('[Recommendation] Failed to parse recommendation - using NO_TRADE fallback');
    return createFallbackResult(input, startTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Recommendation] Failed: ${message} - using NO_TRADE fallback`);
    return createFallbackResult(input, startTime);
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the user prompt for the recommendation agent.
 */
function buildRecommendationPrompt(input: RecommendationInput): string {
  const sections: string[] = [];

  sections.push(`## Market Question\n${input.marketQuestion}`);

  sections.push(
    `## Consensus Result\n` +
      `- Trade Action: ${input.consensusOutput.action}\n` +
      `- Consensus Probability: ${input.consensusOutput.consensusResult.probability.toFixed(3)}\n` +
      `- Market Probability: ${input.marketProbability.toFixed(3)}\n` +
      `- Edge: ${input.consensusOutput.edge.toFixed(3)}\n` +
      `- Confidence: ${input.consensusOutput.consensusResult.confidence.toFixed(3)}\n` +
      `- Disagreement Index: ${input.consensusOutput.consensusResult.disagreementIndex.toFixed(3)}\n` +
      `- Consensus Failed: ${input.consensusOutput.consensusResult.failed}`,
  );

  sections.push(
    `## Bull Thesis\n` +
      `- Fair Probability: ${input.bullThesis.fairProbability.toFixed(3)}\n` +
      `- Confidence: ${input.bullThesis.confidence.toFixed(3)}\n` +
      `- Key Arguments: ${input.bullThesis.keyArguments.join('; ')}\n` +
      `- Cross-Exam Score: ${input.crossExamResult.bullScore.toFixed(1)}/5.0`,
  );

  sections.push(
    `## Bear Thesis\n` +
      `- Fair Probability: ${input.bearThesis.fairProbability.toFixed(3)}\n` +
      `- Confidence: ${input.bearThesis.confidence.toFixed(3)}\n` +
      `- Key Arguments: ${input.bearThesis.keyArguments.join('; ')}\n` +
      `- Cross-Exam Score: ${input.crossExamResult.bearScore.toFixed(1)}/5.0`,
  );

  sections.push(`## Risk Philosophy Perspectives\n${input.riskPhilosophy.summary}`);

  sections.push(
    `## Fused Signal\n` +
      `- Weighted Fair Probability: ${input.fusedSignal.weightedFairProbability.toFixed(3)}\n` +
      `- Fusion Confidence: ${input.fusedSignal.fusionConfidence.toFixed(3)}\n` +
      `- Signal Alignment: ${input.fusedSignal.signalAlignment.toFixed(3)}`,
  );

  sections.push(
    `## Task\nSynthesize all the above information into a final trade recommendation. ` +
      `The consensus engine has determined the action is ${input.consensusOutput.action}. ` +
      `Provide specific entry/exit zones, expected value, and a complete explanation.\n\n` +
      (input.consensusOutput.action === 'LONG_NO'
        ? `IMPORTANT: Since the action is LONG_NO, you are buying NO tokens. ` +
          `The current NO token price is ${(1 - input.marketProbability).toFixed(3)} ` +
          `(which is 1 - ${input.marketProbability.toFixed(3)} YES probability). ` +
          `Express ALL prices (entry_zone, target_zone, stop_loss) in NO-token price space. ` +
          `Your entry should be near ${(1 - input.marketProbability).toFixed(3)}, ` +
          `your target should be HIGHER (NO token appreciates as YES drops), ` +
          `and your stop_loss should be LOWER (NO token depreciates as YES rises). ` +
          `Ordering: stop_loss < entry_zone[0] ≤ entry_zone[1] < target_zone[0] ≤ target_zone[1].`
        : input.consensusOutput.action === 'LONG_YES'
          ? `IMPORTANT: Since the action is LONG_YES, you are buying YES tokens. ` +
            `The current YES token price is ${input.marketProbability.toFixed(3)}. ` +
            `Express ALL prices (entry_zone, target_zone, stop_loss) in YES-token price space. ` +
            `Your entry should be near ${input.marketProbability.toFixed(3)}, ` +
            `your target should be HIGHER (YES token appreciates), ` +
            `and your stop_loss should be LOWER (YES token depreciates). ` +
            `Ordering: stop_loss < entry_zone[0] ≤ entry_zone[1] < target_zone[0] ≤ target_zone[1].`
          : `IMPORTANT: The consensus engine determined NO_TRADE. ` +
            `The edge (${input.consensusOutput.edge.toFixed(3)}) is insufficient or consensus failed ` +
            `(disagreement: ${input.consensusOutput.consensusResult.disagreementIndex.toFixed(3)}). ` +
            `You MUST output action "NO_TRADE". Set entry_zone and target_zone to [0, 0] and stop_loss to 0. ` +
            `Set expected_value to 0 and win_probability to 0. ` +
            `Focus your explanation on WHY this market is not tradeable right now: ` +
            `insufficient edge, high uncertainty, conflicting signals, poor liquidity, or thesis invalidation. ` +
            `Be specific about what conditions would need to change for a trade to become viable.`),
  );

  return sections.join('\n\n');
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a TradeRecommendation from the extracted JSON object.
 * Returns null if required fields cannot be extracted.
 *
 * Includes direction-aware validation:
 * - All prices must be in traded-token space (NO-price for LONG_NO, YES-price for LONG_YES).
 * - Enforces ordering: stopLoss < entryZone[0] ≤ entryZone[1] < targetZone[0] ≤ targetZone[1].
 * - If LLM outputs in wrong space (detected by inverted ordering), auto-converts.
 */
function parseRecommendation(
  json: Record<string, unknown>,
  input: RecommendationInput,
): TradeRecommendation | null {
  // Action - must match consensus action (agent can't override consensus)
  const action = input.consensusOutput.action;

  // For NO_TRADE, entry/target/stop can be null - use defaults
  const isNoTrade = action === 'NO_TRADE';

  // Entry zone
  let entryZone = parseNumberTuple(json.entry_zone ?? json.entryZone);
  if (!entryZone && !isNoTrade) return null;

  // Target zone
  let targetZone = parseNumberTuple(json.target_zone ?? json.targetZone);
  if (!targetZone && !isNoTrade) return null;

  // Stop loss
  let stopLoss = normalizeNumber(json.stop_loss ?? json.stopLoss, 0, 1);
  if (stopLoss === null && !isNoTrade) return null;

  // ── Direction-aware validation & auto-correction ──
  if (!isNoTrade && entryZone && targetZone && stopLoss !== null) {
    const corrected = validateAndCorrectPrices(action, entryZone, targetZone, stopLoss, input.marketProbability);
    if (corrected) {
      entryZone = corrected.entryZone;
      targetZone = corrected.targetZone;
      stopLoss = corrected.stopLoss;
    } else {
      // Prices are unsalvageable - reject
      console.warn(
        `[Recommendation] Price validation failed and could not auto-correct. ` +
        `action=${action}, entry=${JSON.stringify(entryZone)}, target=${JSON.stringify(targetZone)}, sl=${stopLoss}`,
      );
      return null;
    }

    // ── Entry zone proximity check ──
    // Ensure entry is within ±30% of the current token price.
    const currentTokenPrice = action === 'LONG_NO'
      ? 1 - input.marketProbability
      : input.marketProbability;

    if (!validateEntryProximity(entryZone, currentTokenPrice, action)) {
      console.warn(
        `[Recommendation] Rejecting recommendation: entry zone too far from market price.`,
      );
      return null;
    }
  }

  // Expected value
  const expectedValue = normalizeNumber(json.expected_value ?? json.expectedValue, -10, 10);
  if (expectedValue === null && !isNoTrade) return null;

  // ── Negative EV rejection ──
  // A trade with negative expected value should NEVER be recommended.
  // If the LLM output LONG_YES/LONG_NO with EV <= 0, reject to NO_TRADE fallback.
  if (!isNoTrade && expectedValue !== null && expectedValue <= 0) {
    console.warn(
      `[Recommendation] Rejecting ${action}: expected value ${expectedValue.toFixed(4)} <= 0. ` +
      `Negative EV trades are never actionable.`,
    );
    return null;
  }

  // Win probability
  const winProbability = normalizeNumber(json.win_probability ?? json.winProbability, 0, 1);
  if (winProbability === null && !isNoTrade) return null;

  // ── Win probability sanity check ──
  // The LLM's win_probability should not wildly disagree with the consensus probability.
  // Allow ±25% absolute deviation from consensus - beyond that, the LLM is hallucinating.
  if (!isNoTrade && winProbability !== null) {
    const consensusProb = input.consensusOutput.consensusResult.probability;
    // For LONG_NO, the "win" probability is the chance the NO side wins (1 - consensus)
    const expectedWinProb = action === 'LONG_NO' ? 1 - consensusProb : consensusProb;
    const winProbDeviation = Math.abs(winProbability - expectedWinProb);
    if (winProbDeviation > 0.25) {
      console.warn(
        `[Recommendation] Win probability ${winProbability.toFixed(3)} deviates ${(winProbDeviation * 100).toFixed(1)}% ` +
        `from expected ${expectedWinProb.toFixed(3)} (consensus-derived). Clamping to consensus value.`,
      );
      // Don't reject - just override with the consensus-derived value
    }
  }

  // Liquidity risk
  const liquidityRiskRaw = json.liquidity_risk ?? json.liquidityRisk;
  const liquidityRisk = parseLiquidityRisk(liquidityRiskRaw);

  // Explanation
  const explanation = parseExplanation(json.explanation, input);

  // Build metadata from upstream context
  const executionDurationMs = Date.now() - input.executionStartTime;
  const metadata = {
    consensusProbability: input.consensusOutput.consensusResult.probability,
    marketProbability: input.marketProbability,
    edge: input.consensusOutput.edge,
    confidenceBand: calculateConfidenceBand(
      input.consensusOutput.consensusResult.probability,
      input.consensusOutput.consensusResult.confidence,
    ),
    totalLlmCalls: input.totalLlmCalls,
    executionDurationMs,
    agentsUsed: input.agentsUsed,
    marketQuestion: input.marketQuestion,
    disagreementIndex: input.consensusOutput.consensusResult.disagreementIndex,
  };

  return {
    marketId: input.marketId,
    action,
    entryZone: isNoTrade ? [0, 0] : (entryZone ?? [0, 0]),
    targetZone: isNoTrade ? [0, 0] : (targetZone ?? [0, 0]),
    stopLoss: isNoTrade ? 0 : (stopLoss ?? 0),
    expectedValue: isNoTrade ? 0 : (expectedValue ?? 0),
    winProbability: (() => {
      if (isNoTrade) return 0;
      if (winProbability === null) return input.consensusOutput.consensusResult.probability;
      // Use consensus-derived value if LLM's win_probability deviates >25%
      const consensusProb = input.consensusOutput.consensusResult.probability;
      const expectedWinProb = action === 'LONG_NO' ? 1 - consensusProb : consensusProb;
      const deviation = Math.abs(winProbability - expectedWinProb);
      return deviation > 0.25 ? expectedWinProb : winProbability;
    })(),
    liquidityRisk,
    explanation,
    metadata,
  };
}

/**
 * Parse explanation from a JSON object. Falls back to defaults from input context.
 */
function parseExplanation(
  raw: unknown,
  input: RecommendationInput,
): TradeRecommendation['explanation'] {
  const defaults: TradeRecommendation['explanation'] = {
    summary: `Trade recommendation: ${input.consensusOutput.action} based on ${input.consensusOutput.edge.toFixed(3)} edge.`,
    coreThesis: input.bullThesis.keyArguments[0] ?? 'See thesis construction for details.',
    keyCatalysts: [],
    failureScenarios: [],
    uncertaintyNote: 'See full analysis for uncertainty assessment.',
    riskPerspectives: input.riskPhilosophy.summary,
  };

  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const obj = raw as Record<string, unknown>;

  return {
    summary: typeof obj.summary === 'string' && obj.summary.trim().length > 0
      ? obj.summary.trim()
      : defaults.summary,
    coreThesis: typeof (obj.core_thesis ?? obj.coreThesis) === 'string'
      ? String(obj.core_thesis ?? obj.coreThesis).trim()
      : defaults.coreThesis,
    keyCatalysts: normalizeStringArray(obj.key_catalysts ?? obj.keyCatalysts, defaults.keyCatalysts),
    failureScenarios: normalizeStringArray(obj.failure_scenarios ?? obj.failureScenarios, defaults.failureScenarios),
    uncertaintyNote: typeof (obj.uncertainty_note ?? obj.uncertaintyNote) === 'string'
      ? String(obj.uncertainty_note ?? obj.uncertaintyNote).trim()
      : defaults.uncertaintyNote,
    riskPerspectives: typeof (obj.risk_perspectives ?? obj.riskPerspectives) === 'string'
      ? String(obj.risk_perspectives ?? obj.riskPerspectives).trim()
      : defaults.riskPerspectives,
  };
}

// ============================================================================
// Fallback
// ============================================================================

/**
 * Creates a NO_TRADE fallback recommendation when the agent fails.
 * Requirements: 10.5, 10.6
 */
function createFallbackResult(
  input: RecommendationInput,
  startTime: number,
): RecommendationStageResult {
  const executionDurationMs = Date.now() - input.executionStartTime;

  // Generate an intelligent explanation based on WHY no trade was issued
  const isConsensusFailed = input.consensusOutput.consensusResult.failed;
  const isNoTradeAction = input.consensusOutput.action === 'NO_TRADE';
  const edge = input.consensusOutput.edge;
  const disagreement = input.consensusOutput.consensusResult.disagreementIndex;

  let summary: string;
  let coreThesis: string;
  let uncertaintyNote: string;

  if (isConsensusFailed) {
    summary = `NO_TRADE: Consensus failed with ${(disagreement * 100).toFixed(1)}% disagreement among agents. Too much uncertainty to take a position.`;
    coreThesis = `Agent disagreement index (${disagreement.toFixed(3)}) exceeds the 30% threshold, indicating fundamentally conflicting views on this market's direction.`;
    uncertaintyNote = `High disagreement suggests the market is in a genuinely uncertain state where different analytical frameworks reach opposing conclusions. Wait for clarity before entering.`;
  } else if (isNoTradeAction && Math.abs(edge) < 0.05) {
    summary = `NO_TRADE: Edge of ${(edge * 100).toFixed(1)}% is below the minimum ${5}% threshold. Insufficient mispricing to justify transaction costs.`;
    coreThesis = `The market price (${input.marketProbability.toFixed(3)}) is close to our consensus fair value (${input.consensusOutput.consensusResult.probability.toFixed(3)}). No exploitable mispricing exists.`;
    uncertaintyNote = `The market appears efficiently priced for this event. A significant catalyst or new information would be needed to create a tradeable edge.`;
  } else {
    summary = 'Recommendation generation failed - NO_TRADE issued as safety fallback.';
    coreThesis = 'Unable to synthesize a valid recommendation from upstream data.';
    uncertaintyNote = 'Full analysis could not be completed. No trade recommended.';
  }

  const recommendation: TradeRecommendation = {
    marketId: input.marketId,
    action: 'NO_TRADE',
    entryZone: [0, 0],
    targetZone: [0, 0],
    stopLoss: 0,
    expectedValue: 0,
    winProbability: 0,
    liquidityRisk: 'high',
    explanation: {
      summary,
      coreThesis,
      keyCatalysts: [],
      failureScenarios: isConsensusFailed
        ? ['Agent disagreement too high', 'Conflicting directional signals']
        : isNoTradeAction
          ? ['Insufficient edge to cover transaction costs', 'Market efficiently priced']
          : ['Recommendation agent failure'],
      uncertaintyNote,
      riskPerspectives: input.riskPhilosophy.summary,
    },
    metadata: {
      consensusProbability: input.consensusOutput.consensusResult.probability,
      marketProbability: input.marketProbability,
      edge: input.consensusOutput.edge,
      confidenceBand: calculateConfidenceBand(
        input.consensusOutput.consensusResult.probability,
        input.consensusOutput.consensusResult.confidence,
      ),
      totalLlmCalls: input.totalLlmCalls,
      executionDurationMs,
      agentsUsed: input.agentsUsed,
      marketQuestion: input.marketQuestion,
      disagreementIndex: input.consensusOutput.consensusResult.disagreementIndex,
    },
  };

  return {
    recommendation,
    durationMs: Date.now() - startTime,
    usedFallback: true,
  };
}

// ============================================================================
// Direction-Aware Price Validation & Correction
// ============================================================================

interface CorrectedPrices {
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
}

/**
 * Validates that prices follow correct ordering for the trade direction and
 * auto-corrects if the LLM output them in the wrong price space.
 *
 * Correct ordering (for both LONG_YES and LONG_NO in their respective token space):
 *   stopLoss < entryZone[0] ≤ entryZone[1] < targetZone[0] ≤ targetZone[1]
 *
 * Detection heuristics for wrong-space output:
 * - LONG_NO with entry > 0.5 and target < entry: LLM used YES-space → flip all via (1 - x)
 * - LONG_YES with entry < 0.5 and target > entry but stopLoss > entry: LLM confused SL → clamp
 *
 * @returns Corrected prices, or null if prices are unsalvageable.
 */
function validateAndCorrectPrices(
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE',
  entryZone: [number, number],
  targetZone: [number, number],
  stopLoss: number,
  marketProbability: number,
): CorrectedPrices | null {
  // Ensure entry zone is ordered [low, high]
  const entry: [number, number] = entryZone[0] <= entryZone[1]
    ? entryZone
    : [entryZone[1], entryZone[0]];

  // Ensure target zone is ordered [low, high]
  const target: [number, number] = targetZone[0] <= targetZone[1]
    ? targetZone
    : [targetZone[1], targetZone[0]];

  const entryMid = (entry[0] + entry[1]) / 2;
  const targetMid = (target[0] + target[1]) / 2;

  if (action === 'LONG_NO') {
    // Expected NO-token space: entry near (1 - marketProb), target > entry, sl < entry

    // When market is near 0.50, YES-space and NO-space are nearly identical.
    // Skip auto-correction heuristics and rely only on ordering validation.
    const isAmbiguousMarket = Math.abs(marketProbability - 0.5) < 0.08;

    // Heuristic: If entry is close to marketProbability (YES space) and target < entry,
    // the LLM output in YES-space. Convert everything via (1 - x).
    // Only applies when market is clearly NOT near 0.50.
    const looksLikeYesSpace =
      !isAmbiguousMarket &&
      Math.abs(entryMid - marketProbability) < 0.15 &&
      targetMid < entryMid &&
      stopLoss > entry[1];

    if (looksLikeYesSpace) {
      // Convert from YES-space to NO-space: price_NO = 1 - price_YES
      const correctedEntry: [number, number] = [
        clampPrice(1 - entry[1]),  // lower NO price from higher YES price
        clampPrice(1 - entry[0]),  // higher NO price from lower YES price
      ];
      const correctedTarget: [number, number] = [
        clampPrice(1 - target[1]),
        clampPrice(1 - target[0]),
      ];
      const correctedStopLoss = clampPrice(1 - stopLoss);

      console.log(
        `[Recommendation] Auto-corrected LONG_NO from YES-space to NO-space: ` +
        `entry [${entry[0].toFixed(3)},${entry[1].toFixed(3)}] → [${correctedEntry[0].toFixed(3)},${correctedEntry[1].toFixed(3)}], ` +
        `target [${target[0].toFixed(3)},${target[1].toFixed(3)}] → [${correctedTarget[0].toFixed(3)},${correctedTarget[1].toFixed(3)}], ` +
        `sl ${stopLoss.toFixed(3)} → ${correctedStopLoss.toFixed(3)}`,
      );

      // Validate corrected ordering
      if (correctedStopLoss < correctedEntry[0] && correctedEntry[1] < correctedTarget[0]) {
        return { entryZone: correctedEntry, targetZone: correctedTarget, stopLoss: correctedStopLoss };
      }

      // Even after conversion, ordering is off - try to salvage with relaxed check
      if (correctedStopLoss < correctedEntry[1] && correctedEntry[0] < correctedTarget[1]) {
        return { entryZone: correctedEntry, targetZone: correctedTarget, stopLoss: correctedStopLoss };
      }

      // Conversion didn't fix it - unsalvageable
      console.warn(
        `[Recommendation] LONG_NO auto-correction failed ordering check: ` +
        `sl=${correctedStopLoss.toFixed(3)}, entry=[${correctedEntry[0].toFixed(3)},${correctedEntry[1].toFixed(3)}], ` +
        `target=[${correctedTarget[0].toFixed(3)},${correctedTarget[1].toFixed(3)}]`,
      );
      return null;
    }

    // Already in NO-space or close enough - validate ordering
    if (stopLoss < entry[0] && entry[1] < target[0]) {
      // Perfect ordering
      return { entryZone: entry, targetZone: target, stopLoss };
    }

    // Relaxed: allow slight overlap but still directionally correct
    if (stopLoss < entry[1] && entry[0] < target[1] && targetMid > entryMid && stopLoss < entryMid) {
      return { entryZone: entry, targetZone: target, stopLoss };
    }

    // Check if it's completely inverted (entry > target, sl > entry) - YES-space
    // Only attempt force-convert when market is not ambiguous (near 0.50)
    if (!isAmbiguousMarket && entryMid > targetMid && stopLoss > entryMid) {
      // Force convert
      const correctedEntry: [number, number] = [clampPrice(1 - entry[1]), clampPrice(1 - entry[0])];
      const correctedTarget: [number, number] = [clampPrice(1 - target[1]), clampPrice(1 - target[0])];
      const correctedStopLoss = clampPrice(1 - stopLoss);

      console.log(
        `[Recommendation] Force-converted inverted LONG_NO prices from YES-space: ` +
        `sl ${stopLoss.toFixed(3)} → ${correctedStopLoss.toFixed(3)}`,
      );

      if (correctedStopLoss < correctedEntry[1] && correctedEntry[0] < correctedTarget[1]) {
        return { entryZone: correctedEntry, targetZone: correctedTarget, stopLoss: correctedStopLoss };
      }
      return null;
    }

    console.warn(
      `[Recommendation] LONG_NO price ordering invalid and not auto-correctable: ` +
      `sl=${stopLoss.toFixed(3)}, entry=[${entry[0].toFixed(3)},${entry[1].toFixed(3)}], ` +
      `target=[${target[0].toFixed(3)},${target[1].toFixed(3)}]`,
    );
    return null;
  }

  if (action === 'LONG_YES') {
    // Expected YES-token space: entry near marketProb, target > entry, sl < entry
    if (stopLoss < entry[0] && entry[1] < target[0]) {
      // Perfect ordering
      return { entryZone: entry, targetZone: target, stopLoss };
    }

    // Relaxed: allow slight overlap but still directionally correct
    if (stopLoss < entry[1] && entry[0] < target[1] && targetMid > entryMid && stopLoss < entryMid) {
      return { entryZone: entry, targetZone: target, stopLoss };
    }

    // When market is near 0.50, skip space-conversion heuristics
    const isAmbiguousMarketYes = Math.abs(marketProbability - 0.5) < 0.08;

    // Heuristic: LLM might have output in NO-space (everything flipped)
    // Check 3 conditions: entry near (1-market), target < entry, AND sl > entry
    const looksLikeNoSpace =
      !isAmbiguousMarketYes &&
      Math.abs(entryMid - (1 - marketProbability)) < 0.15 &&
      targetMid < entryMid &&
      stopLoss > entry[1];

    if (looksLikeNoSpace) {
      const correctedEntry: [number, number] = [clampPrice(1 - entry[1]), clampPrice(1 - entry[0])];
      const correctedTarget: [number, number] = [clampPrice(1 - target[1]), clampPrice(1 - target[0])];
      const correctedStopLoss = clampPrice(1 - stopLoss);

      console.log(
        `[Recommendation] Auto-corrected LONG_YES from NO-space to YES-space: ` +
        `sl ${stopLoss.toFixed(3)} → ${correctedStopLoss.toFixed(3)}`,
      );

      if (correctedStopLoss < correctedEntry[1] && correctedEntry[0] < correctedTarget[1]) {
        return { entryZone: correctedEntry, targetZone: correctedTarget, stopLoss: correctedStopLoss };
      }
      return null;
    }

    // Stop loss above entry - common LLM mistake. Clamp it below entry.
    if (stopLoss >= entry[0] && targetMid > entryMid) {
      const correctedStopLoss = clampPrice(entry[0] * 0.85);
      console.log(
        `[Recommendation] LONG_YES stop-loss ${stopLoss.toFixed(3)} was above entry ${entry[0].toFixed(3)} - ` +
        `corrected to ${correctedStopLoss.toFixed(3)} (15% below entry low)`,
      );
      if (correctedStopLoss < entry[0] && entry[1] < target[0]) {
        return { entryZone: entry, targetZone: target, stopLoss: correctedStopLoss };
      }
      // Relaxed check
      if (correctedStopLoss < entry[1] && entry[0] < target[1]) {
        return { entryZone: entry, targetZone: target, stopLoss: correctedStopLoss };
      }
    }

    console.warn(
      `[Recommendation] LONG_YES price ordering invalid and not auto-correctable: ` +
      `sl=${stopLoss.toFixed(3)}, entry=[${entry[0].toFixed(3)},${entry[1].toFixed(3)}], ` +
      `target=[${target[0].toFixed(3)},${target[1].toFixed(3)}]`,
    );
    return null;
  }

  // NO_TRADE - no validation needed (shouldn't reach here due to early return)
  return { entryZone: entry, targetZone: target, stopLoss };
}

/**
 * Validates that the entry zone is within a reasonable distance of the current token price.
 * Rejects entries that are unrealistically far from the market (>30% away from current price).
 *
 * This catches cases where the LLM generates an entry zone for a completely different price level,
 * e.g., entry at [0.10, 0.15] when the token is trading at 0.40.
 *
 * @param entryZone - The entry zone [low, high] in traded-token space.
 * @param currentTokenPrice - The current price of the token being traded.
 * @param action - Trade direction (for logging).
 * @returns true if entry is within acceptable proximity, false if too far.
 */
function validateEntryProximity(
  entryZone: [number, number],
  currentTokenPrice: number,
  action: string,
): boolean {
  const MAX_ENTRY_DEVIATION = 0.30; // 30% max distance from current price

  const entryMid = (entryZone[0] + entryZone[1]) / 2;

  // Use absolute deviation for very low token prices (< 0.10) to avoid
  // percentage-based amplification. At 0.05 token price, a 0.02 absolute
  // difference is normal but would be 40% relative.
  if (currentTokenPrice < 0.10) {
    const absoluteDeviation = Math.abs(entryMid - currentTokenPrice);
    const maxAbsolute = 0.08; // 8 cents max absolute for low-priced tokens
    if (absoluteDeviation > maxAbsolute) {
      console.warn(
        `[Recommendation] Entry zone [${entryZone[0].toFixed(3)}, ${entryZone[1].toFixed(3)}] ` +
        `(mid: ${entryMid.toFixed(3)}) is ${absoluteDeviation.toFixed(3)} away from low-priced token ` +
        `${currentTokenPrice.toFixed(3)} for ${action}. Max allowed: ${maxAbsolute}.`,
      );
      return false;
    }
    return true;
  }

  const deviation = Math.abs(entryMid - currentTokenPrice) / currentTokenPrice;

  if (deviation > MAX_ENTRY_DEVIATION) {
    console.warn(
      `[Recommendation] Entry zone [${entryZone[0].toFixed(3)}, ${entryZone[1].toFixed(3)}] ` +
      `(mid: ${entryMid.toFixed(3)}) is ${(deviation * 100).toFixed(1)}% away from current token price ` +
      `${currentTokenPrice.toFixed(3)} for ${action}. Max allowed: ${(MAX_ENTRY_DEVIATION * 100).toFixed(0)}%.`,
    );
    return false;
  }

  return true;
}

/**
 * Clamp a price to valid CLOB range [0.01, 0.99].
 */
function clampPrice(price: number): number {
  return Math.max(0.01, Math.min(0.99, price));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a 2-element number array (e.g., entry_zone, target_zone).
 * Returns null if not a valid 2-element array of numbers.
 */
function parseNumberTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const first = typeof value[0] === 'number' ? value[0] : parseFloat(String(value[0]));
  const second = typeof value[1] === 'number' ? value[1] : parseFloat(String(value[1]));

  if (isNaN(first) || isNaN(second)) return null;

  return [Math.max(0, Math.min(1, first)), Math.max(0, Math.min(1, second))];
}

/**
 * Normalize a number field, clamping to [min, max].
 */
function normalizeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    return Math.max(min, Math.min(max, value));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return null;
}

/**
 * Normalize a string array, falling back to default if empty.
 */
function normalizeStringArray(value: unknown, defaults: string[]): string[] {
  if (!Array.isArray(value)) return defaults;
  const filtered = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return filtered.length > 0 ? filtered : defaults;
}

/**
 * Parse liquidity risk level, defaulting to "medium" for unknown values.
 */
function parseLiquidityRisk(value: unknown): 'low' | 'medium' | 'high' {
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'low' || lower === 'medium' || lower === 'high') {
      return lower;
    }
  }
  return 'medium';
}

/**
 * Calculate confidence band from consensus probability and confidence.
 * Returns [low, high] symmetric band around the consensus probability.
 */
function calculateConfidenceBand(
  probability: number,
  confidence: number,
): [number, number] {
  // Width inversely proportional to confidence (lower confidence = wider band)
  const halfWidth = (1 - confidence) * 0.15;
  const low = Math.max(0, probability - halfWidth);
  const high = Math.min(1, probability + halfWidth);
  return [low, high];
}

/**
 * Creates a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Recommendation timed out after ${ms / 1000} seconds`)),
      ms,
    );
  });
}
