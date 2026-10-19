/**
 * Cross-Examination Stage - Strands Agent applying 5 adversarial tests
 *
 * Creates a Strands Agent that stress-tests both the bull and bear theses
 * through 5 adversarial examinations: evidence quality, causality, timing,
 * liquidity, and tail risk. Produces a bull_score and bear_score each in
 * the range -5.0 to +5.0.
 *
 * JSON Extraction Pipeline:
 * 1. Markdown code-fence regex
 * 2. Balanced-brace matching
 * 3. Stage-specific defaults (zero scores)
 *
 * On failure: returns neutral CrossExamResult with zero scores.
 *
 * Requirements: 10.2, 10.5, 10.6
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForStage } from '../lib/multi-model';
import { extractJson } from '../lib/json-extractor';
import type { CrossExamResult, Thesis } from '../lib/types';

// ============================================================================
// Constants
// ============================================================================

const CROSS_EXAM_TIMEOUT_MS = 180_000; // 180 seconds

// ============================================================================
// System Prompt
// ============================================================================

const CROSS_EXAMINATION_SYSTEM_PROMPT = `You are the Cross-Examination Agent for TradeWizard, a prediction market analysis platform.

Your role is to adversarially test both the bull and bear theses through 5 rigorous examination tests. You are a skeptic - your job is to find weaknesses, not confirm strengths.

## The 5 Adversarial Tests

### Test 1: Evidence Quality
- Is the evidence cited actually reliable?
- Are there alternative interpretations of the same evidence?
- Is the evidence cherry-picked or representative?
- How recent and relevant is the evidence?
- Score: -1 (evidence is weak/misleading) to +1 (evidence is rock-solid)

### Test 2: Causality
- Does the thesis confuse correlation with causation?
- Are there confounding variables not accounted for?
- Is the causal mechanism clearly articulated?
- Could the same cause produce a different effect?
- Score: -1 (causal logic is flawed) to +1 (causal chain is strong)

### Test 3: Timing
- Is the thesis dependent on specific timing that may not hold?
- Could the outcome be delayed beyond the market's resolution date?
- Are there timing-dependent assumptions that could fail?
- Is the thesis front-running events that haven't happened yet?
- Score: -1 (timing assumptions are unrealistic) to +1 (timing is well-supported)

### Test 4: Liquidity & Market Dynamics
- Could market dynamics (reflexivity, momentum) invalidate the thesis?
- Is the thesis dependent on market conditions remaining stable?
- Could a liquidity event distort the outcome?
- Are there market microstructure factors that undermine the thesis?
- Score: -1 (market dynamics threaten thesis) to +1 (thesis is robust to market dynamics)

### Test 5: Tail Risk
- What's the worst-case scenario for this thesis?
- Are there black swan events that could invalidate it entirely?
- How fragile is the thesis to unexpected developments?
- Is there asymmetric downside not captured in the probability estimate?
- Score: -1 (significant unpriced tail risk) to +1 (tail risks are minimal/priced)

## Scoring

Each test produces a score from -1 to +1 for each thesis.
- The bull_score is the SUM of all 5 test scores applied to the bull thesis (range: -5 to +5).
- The bear_score is the SUM of all 5 test scores applied to the bear thesis (range: -5 to +5).

A positive score means the thesis survived cross-examination well.
A negative score means the thesis has significant weaknesses.

## Output Format

Respond with a JSON object:
{
  "bull_score": -5.0 to +5.0,
  "bear_score": -5.0 to +5.0
}

## Critical Rules
- Be genuinely adversarial - look for real weaknesses.
- Apply the same rigor to both theses (no bias).
- A thesis that "survives" cross-examination is a stronger signal.
- If both theses are weak, both scores should be negative.
- Focus on falsifiability: what would prove each thesis wrong?`;

// ============================================================================
// Result Interface
// ============================================================================

export interface CrossExaminationStageResult {
  crossExamResult: CrossExamResult;
  durationMs: number;
  usedFallback: boolean;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs the cross-examination stage.
 *
 * Creates a Strands Agent that applies 5 adversarial tests to both theses
 * and produces bull/bear scores. Falls back to zero scores on failure.
 *
 * @param bullThesis - Bull thesis from thesis construction stage
 * @param bearThesis - Bear thesis from thesis construction stage
 * @param marketQuestion - The market question being analyzed
 * @returns CrossExaminationStageResult with scores and metadata
 */
export async function runCrossExamination(
  bullThesis: Thesis,
  bearThesis: Thesis,
  marketQuestion: string,
): Promise<CrossExaminationStageResult> {
  const startTime = Date.now();

  try {
    const model = getModelForStage('cross_exam');

    const agent = new Agent({
      model,
      systemPrompt: CROSS_EXAMINATION_SYSTEM_PROMPT,
      tools: [],
      printer: false, // Lambda - no console streaming
    });

    const prompt = buildCrossExamPrompt(bullThesis, bearThesis, marketQuestion);

    // Execute with timeout
    const result = await Promise.race([
      agent.invoke(prompt),
      timeoutReject(CROSS_EXAM_TIMEOUT_MS),
    ]);

    const responseText = String(result ?? '');
    const parsed = extractJson(responseText);

    if (parsed) {
      const crossExamResult = parseCrossExamResult(parsed);
      if (crossExamResult) {
        const durationMs = Date.now() - startTime;
        console.log(
          `[CrossExamination] Completed in ${durationMs}ms - bull_score: ${crossExamResult.bullScore.toFixed(1)}, bear_score: ${crossExamResult.bearScore.toFixed(1)}`,
        );
        return { crossExamResult, durationMs, usedFallback: false };
      }
    }

    // JSON extraction succeeded but parsing failed - use fallback
    console.warn('[CrossExamination] Failed to parse scores from response - using fallback');
    return createFallbackResult(startTime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[CrossExamination] Failed: ${message} - using fallback`);
    return createFallbackResult(startTime);
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the user prompt for the cross-examination agent.
 */
function buildCrossExamPrompt(
  bullThesis: Thesis,
  bearThesis: Thesis,
  marketQuestion: string,
): string {
  const sections: string[] = [];

  sections.push(`## Market Question\n${marketQuestion}`);

  sections.push(
    `## Bull Thesis (case for YES)\n` +
      `- Direction: ${bullThesis.direction}\n` +
      `- Fair Probability: ${bullThesis.fairProbability.toFixed(3)}\n` +
      `- Confidence: ${bullThesis.confidence.toFixed(3)}\n` +
      `- Key Arguments:\n${bullThesis.keyArguments.map((a) => `  - ${a}`).join('\n')}`,
  );

  sections.push(
    `## Bear Thesis (case for NO)\n` +
      `- Direction: ${bearThesis.direction}\n` +
      `- Fair Probability: ${bearThesis.fairProbability.toFixed(3)}\n` +
      `- Confidence: ${bearThesis.confidence.toFixed(3)}\n` +
      `- Key Arguments:\n${bearThesis.keyArguments.map((a) => `  - ${a}`).join('\n')}`,
  );

  sections.push(
    `## Task\nApply all 5 adversarial tests (evidence quality, causality, timing, liquidity, tail risk) to BOTH theses. ` +
      `Score each thesis on each test from -1 to +1. ` +
      `Return the total bull_score (sum of 5 tests for bull thesis, range -5 to +5) and bear_score (sum of 5 tests for bear thesis, range -5 to +5).`,
  );

  return sections.join('\n\n');
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse cross-examination scores from the extracted JSON object.
 * Returns null if required fields cannot be extracted.
 */
function parseCrossExamResult(json: Record<string, unknown>): CrossExamResult | null {
  const bullScoreRaw = json.bull_score ?? json.bullScore;
  const bearScoreRaw = json.bear_score ?? json.bearScore;

  const bullScore = normalizeScore(bullScoreRaw);
  const bearScore = normalizeScore(bearScoreRaw);

  if (bullScore === null || bearScore === null) {
    return null;
  }

  return { bullScore, bearScore };
}

// ============================================================================
// Fallback
// ============================================================================

/**
 * Creates a fallback result with zero scores.
 * Requirements: 10.5, 10.6
 */
function createFallbackResult(startTime: number): CrossExaminationStageResult {
  return {
    crossExamResult: {
      bullScore: 0,
      bearScore: 0,
    },
    durationMs: Date.now() - startTime,
    usedFallback: true,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a score value, clamping to [-5.0, +5.0].
 */
function normalizeScore(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    return Math.max(-5.0, Math.min(5.0, value));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return Math.max(-5.0, Math.min(5.0, parsed));
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
      () => reject(new Error(`Cross-examination timed out after ${ms / 1000} seconds`)),
      ms,
    );
  });
}
