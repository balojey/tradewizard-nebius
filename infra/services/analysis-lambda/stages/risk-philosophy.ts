/**
 * Risk Philosophy Stage - 3 sequential Strands Agents for position sizing
 *
 * Creates 3 Strands Agents sequentially (aggressive, conservative, neutral)
 * to stay within Bedrock RPM limits. Each returns a risk perspective containing
 * position sizing, Kelly fraction, entry strategy, stop-loss/take-profit distances,
 * reasoning, and max drawdown tolerance.
 *
 * JSON Extraction Pipeline:
 * 1. Markdown code-fence regex
 * 2. Balanced-brace matching
 * 3. "unavailable" text fallback for individual perspectives
 *
 * On failure of individual perspective: use "unavailable" text for that perspective.
 *
 * Requirements: 10.3, 10.5, 10.6
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForStage } from '../lib/multi-model';
import { extractJson } from '../lib/json-extractor';
import type { ConsensusResult, FusedSignal, Thesis } from '../lib/types';
import type { ConsensusEngineOutput } from './consensus-engine';

// ============================================================================
// Constants
// ============================================================================

const RISK_TIMEOUT_MS = 180_000; // 180 seconds

// ============================================================================
// System Prompts
// ============================================================================

const AGGRESSIVE_SYSTEM_PROMPT = `You are the Aggressive Risk Philosophy Agent for TradeWizard, a prediction market analysis platform.

Your role is to provide position sizing and risk management guidance from an AGGRESSIVE perspective. You maximize expected value and are willing to accept higher variance for higher returns.

## Philosophy
- Maximize expected value (EV) above all else.
- Use Kelly criterion or fractional Kelly for position sizing.
- Concentrated positions when edge is clear.
- Accept higher drawdowns for higher long-term returns.
- Time in market matters - deploy capital quickly when edge exists.

## Position Sizing Framework
- Full Kelly when confidence is high and edge is large.
- Half Kelly as a baseline for moderate-confidence trades.
- Consider correlation with existing positions.
- Maximum single position: up to 25-50% of bankroll for high-conviction trades.

## Risk Management (Aggressive Style)
- Wider stop-losses to avoid being shaken out by noise.
- Let winners run - don't take profit too early.
- Add to winning positions (pyramid) when thesis strengthens.
- Accept temporary drawdowns if thesis remains intact.

## Output Format
Provide your risk perspective as JSON:
{
  "position_size_pct": 0.XX,
  "kelly_fraction": X.X,
  "entry_strategy": "market|limit|scale_in",
  "stop_loss_distance": 0.XX,
  "take_profit_distance": 0.XX,
  "reasoning": "...",
  "max_drawdown_tolerance": 0.XX
}

Be bold but not reckless. Positive EV is still required.`;

const CONSERVATIVE_SYSTEM_PROMPT = `You are the Conservative Risk Philosophy Agent for TradeWizard, a prediction market analysis platform.

Your role is to provide position sizing and risk management guidance from a CONSERVATIVE perspective. You prioritize capital preservation and risk-adjusted returns over raw EV maximization.

## Philosophy
- Capital preservation is the primary objective.
- Risk-adjusted returns (Sharpe ratio) matter more than raw returns.
- Small, diversified positions to limit single-trade impact.
- Tight stop-losses to limit downside.
- Only trade when edge is clear AND risk is well-defined.

## Position Sizing Framework
- Quarter Kelly or less for most trades.
- Maximum single position: 5-10% of bankroll.
- Scale in gradually rather than full position at once.
- Reduce size when uncertainty is high.
- Consider worst-case scenario for position sizing.

## Risk Management (Conservative Style)
- Tight stop-losses (limit max loss to 2-5% of bankroll per trade).
- Take partial profits at intermediate targets.
- Hedge when possible (opposing positions in correlated markets).
- Reduce exposure ahead of known volatility events.
- Cash is a position - being flat is acceptable.

## Output Format
Provide your risk perspective as JSON:
{
  "position_size_pct": 0.XX,
  "kelly_fraction": X.X,
  "entry_strategy": "limit|scale_in",
  "stop_loss_distance": 0.XX,
  "take_profit_distance": 0.XX,
  "reasoning": "...",
  "max_drawdown_tolerance": 0.XX
}

Protect capital first. Only risk what you can afford to lose entirely.`;

const NEUTRAL_SYSTEM_PROMPT = `You are the Neutral Risk Philosophy Agent for TradeWizard, a prediction market analysis platform.

Your role is to provide position sizing and risk management guidance from a BALANCED perspective. You seek optimal risk/reward without extreme aggression or excessive caution.

## Philosophy
- Balance expected value with risk management.
- Moderate position sizes that allow for error.
- Systematic approach - consistent sizing rules.
- Adapt to market conditions (tighter in volatile markets, looser in stable ones).
- Focus on process over outcome for any single trade.

## Position Sizing Framework
- Half Kelly as the standard sizing approach.
- Maximum single position: 10-20% of bankroll.
- Adjust for confidence level (higher confidence = larger size).
- Adjust for liquidity (less liquid = smaller size).
- Consider portfolio-level risk (correlation with other positions).

## Risk Management (Neutral Style)
- Moderate stop-losses (balance between noise tolerance and loss limitation).
- Take profits at target but leave a runner for upside.
- Re-evaluate position if thesis changes materially.
- Time-based stops (exit if thesis hasn't played out within expected timeframe).
- Regular portfolio review and rebalancing.

## Output Format
Provide your risk perspective as JSON:
{
  "position_size_pct": 0.XX,
  "kelly_fraction": X.X,
  "entry_strategy": "limit|scale_in|market",
  "stop_loss_distance": 0.XX,
  "take_profit_distance": 0.XX,
  "reasoning": "...",
  "max_drawdown_tolerance": 0.XX
}

Be balanced and systematic. Good risk management is about consistency.`;

// ============================================================================
// Interfaces
// ============================================================================

/** Single risk perspective output from one philosophy agent */
export interface RiskPerspective {
  positionSizePct: number;
  kellyFraction: number;
  entryStrategy: string;
  stopLossDistance: number;
  takeProfitDistance: number;
  reasoning: string;
  maxDrawdownTolerance: number;
}

/** Full output of the risk philosophy stage */
export interface RiskPhilosophyResult {
  aggressive: RiskPerspective | null;
  conservative: RiskPerspective | null;
  neutral: RiskPerspective | null;
  summary: string;
  durationMs: number;
  usedFallbacks: string[]; // names of perspectives that used fallbacks
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs the risk philosophy stage.
 *
 * Creates 3 Strands Agents in parallel (aggressive, conservative, neutral).
 * Each produces position sizing guidance. On individual failure, that perspective
 * is set to null and noted as "unavailable" in the summary.
 *
 * @param consensusOutput - Output from the consensus engine stage
 * @param fusedSignal - Output from the signal fusion stage
 * @param marketQuestion - The market question being analyzed
 * @returns RiskPhilosophyResult with all three perspectives
 */
export async function runRiskPhilosophy(
  consensusOutput: ConsensusEngineOutput,
  fusedSignal: FusedSignal,
  marketQuestion: string,
): Promise<RiskPhilosophyResult> {
  const startTime = Date.now();

  const prompt = buildRiskPrompt(consensusOutput, fusedSignal, marketQuestion);

  // Run all 3 risk agents in PARALLEL (Llama 3.3 has 8000 RPM - ample headroom)
  const [aggressive, conservative, neutral] = await Promise.all([
    runSingleRiskAgent('aggressive', AGGRESSIVE_SYSTEM_PROMPT, prompt),
    runSingleRiskAgent('conservative', CONSERVATIVE_SYSTEM_PROMPT, prompt),
    runSingleRiskAgent('neutral', NEUTRAL_SYSTEM_PROMPT, prompt),
  ]);

  const usedFallbacks: string[] = [];
  if (!aggressive) usedFallbacks.push('aggressive');
  if (!conservative) usedFallbacks.push('conservative');
  if (!neutral) usedFallbacks.push('neutral');

  // Build summary text for the recommendation stage
  const summary = buildRiskSummary(aggressive, conservative, neutral);

  const durationMs = Date.now() - startTime;
  console.log(
    `[RiskPhilosophy] Completed in ${durationMs}ms - fallbacks: ${usedFallbacks.length > 0 ? usedFallbacks.join(', ') : 'none'}`,
  );

  return {
    aggressive,
    conservative,
    neutral,
    summary,
    durationMs,
    usedFallbacks,
  };
}

// ============================================================================
// Single Agent Runner
// ============================================================================

/**
 * Run a single risk philosophy agent with timeout and fallback.
 * Returns null on failure (the "unavailable" fallback).
 */
async function runSingleRiskAgent(
  name: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<RiskPerspective | null> {
  try {
    const model = getModelForStage('risk_aggressive');

    const agent = new Agent({
      model,
      systemPrompt,
      tools: [],
      printer: false, // Lambda - no console streaming
    });

    const result = await Promise.race([
      agent.invoke(userPrompt),
      timeoutReject(RISK_TIMEOUT_MS),
    ]);

    const responseText = String(result ?? '');
    const parsed = extractJson(responseText);

    if (parsed) {
      const perspective = parseRiskPerspective(parsed);
      if (perspective) {
        return perspective;
      }
    }

    console.warn(`[RiskPhilosophy:${name}] Failed to parse response - marking as unavailable`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[RiskPhilosophy:${name}] Failed: ${message} - marking as unavailable`);
    return null;
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the user prompt shared by all 3 risk philosophy agents.
 */
function buildRiskPrompt(
  consensusOutput: ConsensusEngineOutput,
  fusedSignal: FusedSignal,
  marketQuestion: string,
): string {
  const sections: string[] = [];

  sections.push(`## Market Question\n${marketQuestion}`);

  sections.push(
    `## Consensus Result\n` +
      `- Action: ${consensusOutput.action}\n` +
      `- Consensus Probability: ${consensusOutput.consensusResult.probability.toFixed(3)}\n` +
      `- Confidence: ${consensusOutput.consensusResult.confidence.toFixed(3)}\n` +
      `- Edge: ${consensusOutput.edge.toFixed(3)}\n` +
      `- Disagreement Index: ${consensusOutput.consensusResult.disagreementIndex.toFixed(3)}`,
  );

  sections.push(
    `## Fused Signal\n` +
      `- Weighted Fair Probability: ${fusedSignal.weightedFairProbability.toFixed(3)}\n` +
      `- Fusion Confidence: ${fusedSignal.fusionConfidence.toFixed(3)}\n` +
      `- Signal Alignment: ${fusedSignal.signalAlignment.toFixed(3)}`,
  );

  sections.push(
    `## Task\nProvide your risk philosophy perspective as a JSON object with fields: ` +
      `position_size_pct, kelly_fraction, entry_strategy, stop_loss_distance, ` +
      `take_profit_distance, reasoning, max_drawdown_tolerance.`,
  );

  return sections.join('\n\n');
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a risk perspective from the extracted JSON object.
 * Returns null if required fields cannot be extracted.
 */
function parseRiskPerspective(json: Record<string, unknown>): RiskPerspective | null {
  const positionSizePct = normalizeNumber(
    json.position_size_pct ?? json.positionSizePct,
    0,
    1,
  );
  const kellyFraction = normalizeNumber(
    json.kelly_fraction ?? json.kellyFraction,
    0,
    5,
  );
  const stopLossDistance = normalizeNumber(
    json.stop_loss_distance ?? json.stopLossDistance,
    0,
    1,
  );
  const takeProfitDistance = normalizeNumber(
    json.take_profit_distance ?? json.takeProfitDistance,
    0,
    1,
  );
  const maxDrawdownTolerance = normalizeNumber(
    json.max_drawdown_tolerance ?? json.maxDrawdownTolerance,
    0,
    1,
  );

  // Entry strategy
  const entryStrategyRaw = json.entry_strategy ?? json.entryStrategy;
  const entryStrategy =
    typeof entryStrategyRaw === 'string' && entryStrategyRaw.trim().length > 0
      ? entryStrategyRaw.trim()
      : null;

  // Reasoning
  const reasoningRaw = json.reasoning;
  const reasoning =
    typeof reasoningRaw === 'string' && reasoningRaw.trim().length > 0
      ? reasoningRaw.trim()
      : null;

  // Require at minimum: position_size_pct and reasoning
  if (positionSizePct === null || reasoning === null) {
    return null;
  }

  return {
    positionSizePct,
    kellyFraction: kellyFraction ?? 0,
    entryStrategy: entryStrategy ?? 'limit',
    stopLossDistance: stopLossDistance ?? 0.1,
    takeProfitDistance: takeProfitDistance ?? 0.2,
    reasoning,
    maxDrawdownTolerance: maxDrawdownTolerance ?? 0.15,
  };
}

// ============================================================================
// Summary Builder
// ============================================================================

/**
 * Builds a text summary of all risk perspectives for the recommendation stage
 * and frontend display. Uses [label] {json} format that the frontend parsers expect.
 */
function buildRiskSummary(
  aggressive: RiskPerspective | null,
  conservative: RiskPerspective | null,
  neutral: RiskPerspective | null,
): string {
  const parts: string[] = [];

  if (aggressive) {
    parts.push(
      `[aggressive] ${JSON.stringify({
        position_size_pct: aggressive.positionSizePct,
        kelly_fraction: aggressive.kellyFraction,
        entry_strategy: aggressive.entryStrategy,
        stop_loss_distance: aggressive.stopLossDistance,
        take_profit_distance: aggressive.takeProfitDistance,
        reasoning: aggressive.reasoning,
        max_drawdown_tolerance: aggressive.maxDrawdownTolerance,
      })}`,
    );
  } else {
    parts.push('[aggressive] unavailable');
  }

  if (conservative) {
    parts.push(
      `[conservative] ${JSON.stringify({
        position_size_pct: conservative.positionSizePct,
        kelly_fraction: conservative.kellyFraction,
        entry_strategy: conservative.entryStrategy,
        stop_loss_distance: conservative.stopLossDistance,
        take_profit_distance: conservative.takeProfitDistance,
        reasoning: conservative.reasoning,
        max_drawdown_tolerance: conservative.maxDrawdownTolerance,
      })}`,
    );
  } else {
    parts.push('[conservative] unavailable');
  }

  if (neutral) {
    parts.push(
      `[neutral] ${JSON.stringify({
        position_size_pct: neutral.positionSizePct,
        kelly_fraction: neutral.kellyFraction,
        entry_strategy: neutral.entryStrategy,
        stop_loss_distance: neutral.stopLossDistance,
        take_profit_distance: neutral.takeProfitDistance,
        reasoning: neutral.reasoning,
        max_drawdown_tolerance: neutral.maxDrawdownTolerance,
      })}`,
    );
  } else {
    parts.push('[neutral] unavailable');
  }

  return parts.join('\n\n');
}

// ============================================================================
// Helpers
// ============================================================================

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
 * Creates a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Risk philosophy timed out after ${ms / 1000} seconds`)),
      ms,
    );
  });
}
