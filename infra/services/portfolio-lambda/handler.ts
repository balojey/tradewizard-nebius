/**
 * Portfolio_Lambda - Self-contained TypeScript Lambda for portfolio trade decisions.
 *
 * Validates incoming payload, constructs a persona-specific Strands Agent with
 * read-only tools, invokes the agent for reasoning, parses the response as a
 * PortfolioDecision, and returns a structured decision.
 *
 * Error strategy:
 * - Invalid payload → skip decision with reasoning indicating invalid fields
 * - Unknown persona → skip decision with "invalid persona" reasoning
 * - Agent failure/timeout → skip decision with failure reasoning
 * - Unparseable response → skip decision with parse failure reasoning
 *
 * Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.5, 3.6, 3.7, 14.2, 14.6
 */

import type {
  PortfolioDecision,
  PortfolioPayload,
  PortfolioAction,
  PortfolioDirection,
  OrderType,
  ExitReason,
} from './lib/types';
import {
  VALID_PERSONAS,
  VALID_DECISION_TYPES,
  VALID_ACTIONS,
  VALID_DIRECTIONS,
  VALID_ORDER_TYPES,
  VALID_EXIT_REASONS,
  buildSkipDecision,
} from './lib/types';
import { extractJson } from './lib/json-extractor';
import {
  assertAiProviderCredentials,
  validateAiProviderConfiguration,
} from '../shared/ai-provider';

// ─── Required Environment Variables (validated on cold start) ────────────────

const REQUIRED_ENV_VARS = [
  'BEDROCK_MODEL_ID',
  'DB_SECRET_ARN',
  'DB_HOST',
  'ANALYSIS_RESULTS_BUCKET',
] as const;

// ─── Cold-Start Validation ───────────────────────────────────────────────────

const missingEnvVars: string[] = [];
for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar] || process.env[envVar]!.trim() === '') {
    console.error(`Missing required environment variable: ${envVar}`);
    missingEnvVars.push(envVar);
  }
}

validateAiProviderConfiguration(['default']);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Portfolio_Lambda initialization failed: missing environment variables: ${missingEnvVars.join(', ')}`,
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: unknown): Promise<PortfolioDecision> {
  try {
    // Validate payload
    const validation = validatePayload(event);
    if (!validation.valid) {
      return buildSkipDecision(validation.reason!);
    }

    const payload = validation.payload!;

    // Validate persona
    if (!isValidPersona(payload.persona)) {
      return buildSkipDecision(
        `Invalid persona: "${payload.persona}". Valid personas: ${VALID_PERSONAS.join(', ')}`,
      );
    }

    // Fail fast if the active AI provider's credentials are missing.
    await assertAiProviderCredentials();

    // Dynamically import and invoke the agent
    // This allows the handler to work even if tools/personas aren't loaded yet
    const { createModel } = await import('./lib/model');
    const { Agent } = await import('@strands-agents/sdk');
    const { getPersonaPrompt } = await import('./personas');
    const { getPortfolioTools } = await import('./tools/index');

    const model = createModel();
    const systemPrompt = getPersonaPrompt(payload.persona, payload.decisionType);
    const tools = getPortfolioTools();

    const agent = new Agent({
      model,
      systemPrompt,
      tools,
      printer: false, // Lambda - no console streaming
    });

    // Build the agent input prompt
    const agentPrompt = buildAgentPrompt(payload);

    // Invoke the agent with timeout protection
    const result = await Promise.race([
      agent.invoke(agentPrompt),
      timeoutReject(110_000), // 110s - leave 10s buffer before Lambda 120s timeout
    ]);

    // Parse agent response as PortfolioDecision
    const decision = parseDecision(String(result));
    return decision;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Portfolio_Lambda handler error:', message);
    return buildSkipDecision(`Agent invocation failed: ${message.slice(0, 400)}`);
  }
}

// ─── Payload Validation ──────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  reason?: string;
  payload?: PortfolioPayload;
}

/**
 * Validate the incoming event against the PortfolioPayload schema.
 * Returns validation result with reason on failure.
 */
export function validatePayload(event: unknown): ValidationResult {
  if (!event || typeof event !== 'object') {
    return { valid: false, reason: 'Payload is missing or not an object' };
  }

  const payload = event as Record<string, unknown>;
  const invalidFields: string[] = [];

  // Validate persona
  if (!payload.persona || typeof payload.persona !== 'string') {
    invalidFields.push('persona');
  } else if (!VALID_PERSONAS.includes(payload.persona as any)) {
    invalidFields.push(`persona (invalid value: "${payload.persona}")`);
  }

  // Validate analysisResult (required for entry decisions, optional for exit_evaluation)
  const isExitEvaluation = payload.decisionType === 'exit_evaluation';
  if (!isExitEvaluation) {
    if (!payload.analysisResult || typeof payload.analysisResult !== 'object') {
      invalidFields.push('analysisResult');
    } else {
      const ar = payload.analysisResult as Record<string, unknown>;
      const requiredArFields = [
        'analysisResultId', 'marketId', 'action', 'entryZone',
        'targetZone', 'stopLoss', 'liquidityRisk', 'signalAlignment',
        'confidence', 'explanation',
      ];
      for (const field of requiredArFields) {
        if (ar[field] === undefined || ar[field] === null) {
          invalidFields.push(`analysisResult.${field}`);
        }
      }
    }
  }

  // Validate portfolioState
  if (!payload.portfolioState || typeof payload.portfolioState !== 'object') {
    invalidFields.push('portfolioState');
  } else {
    const ps = payload.portfolioState as Record<string, unknown>;
    if (!ps.session || typeof ps.session !== 'object') invalidFields.push('portfolioState.session');
    if (!Array.isArray(ps.positions)) invalidFields.push('portfolioState.positions');
    // Accept both camelCase and snake_case for capitalBreakdown
    const cb = ps.capitalBreakdown || ps.capital_breakdown;
    if (!cb || typeof cb !== 'object') invalidFields.push('portfolioState.capitalBreakdown');
  }

  // Validate marketData
  if (!payload.marketData || typeof payload.marketData !== 'object') {
    invalidFields.push('marketData');
  } else {
    const md = payload.marketData as Record<string, unknown>;
    if (!md.marketId || typeof md.marketId !== 'string') invalidFields.push('marketData.marketId');
    if (typeof md.currentPrice !== 'number') invalidFields.push('marketData.currentPrice');
    if (typeof md.edge !== 'number') invalidFields.push('marketData.edge');
    if (typeof md.signalAlignment !== 'number') invalidFields.push('marketData.signalAlignment');
  }

  // Validate decisionType
  if (!payload.decisionType || typeof payload.decisionType !== 'string') {
    invalidFields.push('decisionType');
  } else if (!VALID_DECISION_TYPES.includes(payload.decisionType as any)) {
    invalidFields.push(`decisionType (invalid value: "${payload.decisionType}")`);
  }

  if (invalidFields.length > 0) {
    return {
      valid: false,
      reason: `Invalid payload: missing or malformed fields: ${invalidFields.join(', ')}`,
    };
  }

  return { valid: true, payload: event as unknown as PortfolioPayload };
}

// ─── Decision Parsing ────────────────────────────────────────────────────────

/**
 * Parse an agent response string into a validated PortfolioDecision.
 * Uses the JSON extractor for robustness against markdown-wrapped responses.
 * Falls back to skip decision if parsing fails.
 */
export function parseDecision(responseText: string): PortfolioDecision {
  const extracted = extractJson(responseText);

  if (!extracted) {
    return buildSkipDecision('Failed to extract JSON from agent response');
  }

  // Validate and coerce fields with safe defaults
  const action = coerceAction(extracted.action);
  const direction = coerceDirection(extracted.direction);
  const sizePct = coerceNumber(extracted.sizePct ?? extracted.size_pct, 0, 0, 1);
  const price = extracted.price != null ? Number(extracted.price) : null;
  const stopLossPrice = (extracted.stopLossPrice ?? extracted.stop_loss_price) != null
    ? Number(extracted.stopLossPrice ?? extracted.stop_loss_price)
    : null;
  const takeProfitPrice = (extracted.takeProfitPrice ?? extracted.take_profit_price) != null
    ? Number(extracted.takeProfitPrice ?? extracted.take_profit_price)
    : null;
  const orderType = coerceOrderType(extracted.orderType ?? extracted.order_type);
  const rawReasoning = String(extracted.reasoning || '');
  const reasoning = rawReasoning.slice(0, 500);
  const conviction = coerceNumber(extracted.conviction, 0, 0, 1);
  const exitReason = coerceExitReason(extracted.exitReason ?? extracted.exit_reason);
  const isPyramid = Boolean(extracted.isPyramid ?? extracted.is_pyramid ?? false);

  return {
    action,
    direction,
    sizePct,
    price: price !== null && !isNaN(price) ? price : null,
    stopLossPrice: stopLossPrice !== null && !isNaN(stopLossPrice)
      ? Math.max(0.01, Math.min(0.99, stopLossPrice))
      : null,
    takeProfitPrice: takeProfitPrice !== null && !isNaN(takeProfitPrice)
      ? Math.max(0.01, Math.min(0.99, takeProfitPrice))
      : null,
    orderType,
    reasoning,
    conviction,
    exitReason,
    isPyramid,
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function isValidPersona(persona: string): boolean {
  return VALID_PERSONAS.includes(persona as any);
}

function coerceAction(value: unknown): PortfolioAction {
  if (typeof value === 'string' && VALID_ACTIONS.includes(value as any)) {
    return value as PortfolioAction;
  }
  return 'skip';
}

function coerceDirection(value: unknown): PortfolioDirection {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && VALID_DIRECTIONS.includes(value as any)) {
    return value as PortfolioDirection;
  }
  return null;
}

function coerceOrderType(value: unknown): OrderType {
  if (typeof value === 'string' && VALID_ORDER_TYPES.includes(value as any)) {
    return value as OrderType;
  }
  return 'market';
}

function coerceExitReason(value: unknown): ExitReason {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && VALID_EXIT_REASONS.includes(value as any)) {
    return value as ExitReason;
  }
  return null;
}

function coerceNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  if (typeof value !== 'number' || isNaN(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the agent input prompt from the validated payload.
 */
function buildAgentPrompt(payload: PortfolioPayload): string {
  const { analysisResult, portfolioState, marketData, decisionType } = payload;

  // For exit_evaluation, analysisResult may be absent (Position Guard invocations)
  const analysisSection = analysisResult
    ? `## Analysis Result
- Action: ${analysisResult.action}
- Entry Zone: ${JSON.stringify(analysisResult.entryZone)}
- Target Zone: ${JSON.stringify(analysisResult.targetZone)}
- Stop Loss: ${analysisResult.stopLoss}
- Liquidity Risk: ${analysisResult.liquidityRisk}
- Signal Alignment: ${analysisResult.signalAlignment}
- Confidence: ${analysisResult.confidence}
- Analysis ID: ${analysisResult.analysisResultId}`
    : `## Analysis Result
No recent analysis available. Use the read_full_analysis and get_market_data tools to gather current context.`;

  // Accept both camelCase and snake_case for capitalBreakdown
  const capitalBreakdown = (portfolioState as any).capitalBreakdown || (portfolioState as any).capital_breakdown;

  // For exit_evaluation, marketData values may be placeholders (0) since the
  // Position Guard doesn't have real-time prices. Instruct agent to use tools.
  const marketDataNote = decisionType === 'exit_evaluation' && marketData.currentPrice === 0
    ? `\n**IMPORTANT**: Market data below contains placeholder values. You MUST use the get_market_data tool to fetch real-time prices before making your decision.`
    : '';

  return `You are evaluating a ${decisionType} decision for market ${marketData.marketId}.
${marketDataNote}
${analysisSection}

## Market Data
- Current Price: ${marketData.currentPrice === 0 ? 'Unknown (use get_market_data tool)' : marketData.currentPrice}
- Edge: ${marketData.edge === 0 && decisionType === 'exit_evaluation' ? 'Unknown (use tools)' : marketData.edge}
- Signal Alignment: ${marketData.signalAlignment === 0 && decisionType === 'exit_evaluation' ? 'Unknown (use tools)' : marketData.signalAlignment}

## Portfolio State
- Session: ${JSON.stringify(portfolioState.session)}
- Positions: ${JSON.stringify(portfolioState.positions)}
- Capital Breakdown: ${JSON.stringify(capitalBreakdown)}

## Instructions
Based on the above data and your persona guidelines, provide your decision as a JSON object with these fields:
- action: one of "enter", "hold", "exit", "scale", "skip"
- direction: "YES", "NO", or null
- sizePct: number between 0.0 and 1.0
- price: number or null
- stopLossPrice: number or null
- takeProfitPrice: number or null
- orderType: "limit" or "market"
- reasoning: brief explanation (max 500 chars)
- conviction: number between 0.0 and 1.0
- exitReason: one of "regime_shift", "stale_market", "contradicting_analysis", "target_reached", or null
- isPyramid: boolean

Respond ONLY with the JSON object.`;
}

/**
 * Create a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent invocation timed out after ${ms}ms`)), ms),
  );
}
