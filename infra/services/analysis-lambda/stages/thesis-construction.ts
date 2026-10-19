/**
 * Thesis Construction Stage - Strands Agent producing bull/bear theses
 *
 * Creates a Strands Agent that analyzes the fused signal data and individual
 * agent signals to generate competing bull and bear theses. Each thesis contains
 * a direction, fair probability, key arguments, and confidence level.
 *
 * JSON Extraction Pipeline:
 * 1. Markdown code-fence regex
 * 2. Balanced-brace matching
 * 3. Stage-specific defaults (neutral theses with 0.3 confidence)
 *
 * On failure: returns neutral theses with fused signal probability and 0.3 confidence.
 *
 * Requirements: 10.1, 10.5, 10.6
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForStage } from '../lib/multi-model';
import { extractJson } from '../lib/json-extractor';
import type { AgentSignal, FusedSignal, Thesis } from '../lib/types';

// ============================================================================
// Constants
// ============================================================================

const THESIS_TIMEOUT_MS = 180_000; // 180 seconds

// ============================================================================
// System Prompt
// ============================================================================

const THESIS_CONSTRUCTION_SYSTEM_PROMPT = `You are the Thesis Construction Agent for TradeWizard, a prediction market analysis platform.

Your role is to construct two competing theses - one BULL (favoring YES resolution) and one BEAR (favoring NO resolution) - from the fused signal data and individual agent intelligence.

## Instructions

Analyze the provided fused signal, individual agent signals, and market context to:
1. **Bull Thesis**: Build the strongest possible case for YES resolution. Identify the key arguments, assign a fair probability, and rate your confidence.
2. **Bear Thesis**: Build the strongest possible case for NO resolution. Identify the key arguments, assign a fair probability, and rate your confidence.

Both theses should be well-reasoned and internally consistent, even if one side is clearly stronger. The goal is adversarial completeness - each thesis should be the best possible version of its case.

## Guidelines

- fair_probability: The probability that the **YES outcome** occurs, as assessed from this thesis's perspective.
  - **CRITICAL**: BOTH theses must express fair_probability as the chance of YES happening (a number between 0.0 and 1.0).
  - Report your **honest** P(YES) given the evidence. Do NOT inflate or deflate it because of the role you are playing.
  - A bull thesis does not have to produce a high number, and a bear thesis does not have to produce a low number. If the evidence is overwhelmingly bearish, the bull thesis should still acknowledge a low P(YES).
  - Example: If the bear believes there's only a 25% chance the event happens, fair_probability = 0.25 (NOT 0.75).
  - NEVER output the probability of your thesis being correct. Always output the YES outcome probability.
- confidence: How confident you are in the strength of this thesis (0.0–1.0)
- key_arguments: 3-5 strongest arguments supporting this thesis direction
- Be specific and cite evidence from the agent signals provided
- Don't artificially balance - one thesis may be much stronger than the other

## Output Format

Respond with a JSON object:
{
  "bull_thesis": {
    "direction": "bull",
    "fair_probability": 0.0-1.0,
    "key_arguments": ["argument1", "argument2", "argument3"],
    "confidence": 0.0-1.0
  },
  "bear_thesis": {
    "direction": "bear",
    "fair_probability": 0.0-1.0,
    "key_arguments": ["argument1", "argument2", "argument3"],
    "confidence": 0.0-1.0
  }
}

## IMPORTANT REMINDER
The bear_thesis fair_probability is the probability of YES happening (which should be LOW for a bearish view).
Do NOT put the probability of NO happening in the bear_thesis fair_probability field.`;

// ============================================================================
// Result Interface
// ============================================================================

export interface ThesisConstructionResult {
  bullThesis: Thesis;
  bearThesis: Thesis;
  durationMs: number;
  usedFallback: boolean;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs the thesis construction stage.
 *
 * Creates a Strands Agent that generates bull/bear theses from the fused signal
 * and individual agent signals. Falls back to neutral theses on failure.
 *
 * @param fusedSignal - The output of signal fusion stage
 * @param signals - All 14 agent signals (real + fallback)
 * @param marketQuestion - The market question being analyzed
 * @returns ThesisConstructionResult with bull and bear theses
 */
export async function runThesisConstruction(
  fusedSignal: FusedSignal,
  signals: AgentSignal[],
  marketQuestion: string,
): Promise<ThesisConstructionResult> {
  const startTime = Date.now();

  try {
    const model = getModelForStage('thesis');

    const agent = new Agent({
      model,
      systemPrompt: THESIS_CONSTRUCTION_SYSTEM_PROMPT,
      tools: [],
      printer: false, // Lambda - no console streaming
    });

    const prompt = buildThesisPrompt(fusedSignal, signals, marketQuestion);

    // Execute with timeout
    const result = await Promise.race([
      agent.invoke(prompt),
      timeoutReject(THESIS_TIMEOUT_MS),
    ]);

    const responseText = String(result ?? '');
    const parsed = extractJson(responseText);

    if (parsed) {
      const theses = parseTheses(parsed, fusedSignal);
      if (theses) {
        const durationMs = Date.now() - startTime;
        console.log(
          `[ThesisConstruction] Completed in ${durationMs}ms - bull confidence: ${theses.bullThesis.confidence.toFixed(2)}, bear confidence: ${theses.bearThesis.confidence.toFixed(2)}`,
        );
        return { ...theses, durationMs, usedFallback: false };
      }
    }

    // JSON extraction succeeded but parsing of theses failed - use fallback
    console.warn('[ThesisConstruction] Failed to parse theses from response - using fallback');
    return createFallbackResult(fusedSignal, startTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ThesisConstruction] Failed: ${message} - using fallback`);
    return createFallbackResult(fusedSignal, startTime);
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the user prompt for the thesis construction agent.
 */
function buildThesisPrompt(
  fusedSignal: FusedSignal,
  signals: AgentSignal[],
  marketQuestion: string,
): string {
  const sections: string[] = [];

  sections.push(`## Market Question\n${marketQuestion}`);

  sections.push(
    `## Fused Signal Summary\n` +
      `- Weighted Fair Probability: ${fusedSignal.weightedFairProbability.toFixed(3)}\n` +
      `- Fusion Confidence: ${fusedSignal.fusionConfidence.toFixed(3)}\n` +
      `- Signal Alignment: ${fusedSignal.signalAlignment.toFixed(3)}\n` +
      `- Conflicts: ${fusedSignal.conflictMap.length} agent pairs with divergence > 0.30`,
  );

  // Summarize individual agent signals
  const signalSummary = signals
    .map(
      (s) =>
        `- ${s.agentName}: direction=${s.direction}, confidence=${s.confidence.toFixed(2)}, fairProb=${s.fairProbability.toFixed(2)}, drivers: ${s.keyDrivers.slice(0, 3).join('; ')}`,
    )
    .join('\n');

  sections.push(`## Individual Agent Signals\n${signalSummary}`);

  sections.push(
    `## Task\nConstruct a BULL thesis (case for YES) and a BEAR thesis (case for NO). ` +
      `Each should include direction, fair_probability, key_arguments (3-5), and confidence.`,
  );

  return sections.join('\n\n');
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse bull and bear theses from the extracted JSON object.
 * Returns null if required fields cannot be extracted.
 */
function parseTheses(
  json: Record<string, unknown>,
  fusedSignal: FusedSignal,
): { bullThesis: Thesis; bearThesis: Thesis } | null {
  const bullRaw = json.bull_thesis ?? json.bullThesis;
  const bearRaw = json.bear_thesis ?? json.bearThesis;

  if (!bullRaw || typeof bullRaw !== 'object' || !bearRaw || typeof bearRaw !== 'object') {
    return null;
  }

  const bullThesis = parseSingleThesis(bullRaw as Record<string, unknown>, 'bull', fusedSignal);
  const bearThesis = parseSingleThesis(bearRaw as Record<string, unknown>, 'bear', fusedSignal);

  if (!bullThesis || !bearThesis) {
    return null;
  }

  // ── Defensive correction: detect inverted bear probability ──
  // The bear thesis fair_probability should represent P(YES) from a bearish view,
  // meaning it should be LOWER than the bull thesis fair_probability.
  // If bear's probability is higher than bull's, the LLM likely output P(NO) instead
  // of P(YES). Auto-invert to fix.
  if (bearThesis.fairProbability > bullThesis.fairProbability) {
    console.warn(
      `[ThesisConstruction] Bear fair_probability (${bearThesis.fairProbability.toFixed(3)}) > ` +
      `Bull fair_probability (${bullThesis.fairProbability.toFixed(3)}) - inverting bear probability. ` +
      `LLM likely output P(NO) instead of P(YES) for the bear thesis.`
    );
    bearThesis.fairProbability = 1 - bearThesis.fairProbability;
  }

  return { bullThesis, bearThesis };
}

/**
 * Parse a single thesis from a JSON object.
 */
function parseSingleThesis(
  raw: Record<string, unknown>,
  expectedDirection: 'bull' | 'bear',
  fusedSignal: FusedSignal,
): Thesis | null {
  // Fair probability
  const fairProbRaw = raw.fair_probability ?? raw.fairProbability;
  const fairProbability = normalizeNumber(fairProbRaw, 0, 1);
  if (fairProbability === null) return null;

  // Confidence
  const confidenceRaw = raw.confidence;
  const confidence = normalizeNumber(confidenceRaw, 0, 1);
  if (confidence === null) return null;

  // Key arguments
  const argsRaw = raw.key_arguments ?? raw.keyArguments;
  const keyArguments = normalizeStringArray(argsRaw);
  if (keyArguments.length === 0) return null;

  // Direction (allow flexibility - force to expected direction)
  const direction = expectedDirection;

  return {
    direction,
    fairProbability,
    keyArguments,
    confidence,
  };
}

// ============================================================================
// Fallback
// ============================================================================

/**
 * Creates a fallback result with neutral theses using the fused signal probability.
 * Requirements: 10.5, 10.6
 */
function createFallbackResult(fusedSignal: FusedSignal, startTime: number): ThesisConstructionResult {
  const fallbackProbability = fusedSignal.weightedFairProbability;

  return {
    bullThesis: {
      direction: 'bull',
      fairProbability: fallbackProbability,
      keyArguments: ['Thesis unavailable - using fused signal probability as fallback'],
      confidence: 0.3,
    },
    bearThesis: {
      direction: 'bear',
      fairProbability: 1 - fallbackProbability,
      keyArguments: ['Thesis unavailable - using fused signal probability as fallback'],
      confidence: 0.3,
    },
    durationMs: Date.now() - startTime,
    usedFallback: true,
  };
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
 * Normalize an array of strings, filtering non-strings.
 */
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Creates a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Thesis construction timed out after ${ms / 1000} seconds`)),
      ms,
    );
  });
}
