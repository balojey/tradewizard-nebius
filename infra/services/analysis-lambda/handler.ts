/**
 * Analysis_Lambda handler - entry point for the 11-stage analysis workflow.
 *
 * Accepts an AnalysisPayload (marketId, userId, requestId) and returns a TradeRecommendation.
 * Orchestrates: data preparation → historical context → web research → intelligence agents →
 * signal fusion → thesis construction → cross-examination → consensus engine →
 * risk philosophy → recommendation generation.
 */
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import type { AnalysisPayload, TradeRecommendation } from './lib/types';
import {
  prepareData,
  fetchMarketInfo,
  computePriceVolatility,
  deriveLiquidityRisk,
  type MarketBriefing,
} from './stages/data-preparation';
import { fetchHistoricalContext, fetchAgentPerformanceWeights } from './stages/historical-context';
import { runWebResearch } from './stages/web-research';
import { runIntelligenceAgents, ALL_AGENT_NAMES } from './stages/intelligence-agents';
import { fuseSignals } from './stages/signal-fusion';
import { runThesisConstruction } from './stages/thesis-construction';
import { runCrossExamination } from './stages/cross-examination';
import { runConsensusEngine } from './stages/consensus-engine';
import { runRiskPhilosophy } from './stages/risk-philosophy';
import { runRecommendation } from './stages/recommendation';
import { resetNewsToolCache } from './tools/news-tool';
import { resetSearchToolCache } from './tools/search-tool';
import { resetAllSharedCaches } from './tools/tool-factory';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  assertAiProviderCredentials,
  validateAiProviderConfiguration,
} from '../shared/ai-provider';

// ─── EventBridge client for progress reporting ───────────────────────────────
const eventBridgeClient = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

/**
 * Stage definitions for progress reporting.
 * Maps stage number → human-readable name shown in the frontend pipeline UI.
 */
const STAGE_NAMES: Record<number, string> = {
  1: 'Data Preparation',
  2: 'Historical Context',
  3: 'Web Research',
  4: 'Agent Selection',
  5: 'Intelligence Agents',
  6: 'Signal Fusion',
  7: 'Thesis Construction',
  8: 'Cross-Examination',
  9: 'Consensus Engine',
  10: 'Risk Philosophy',
  11: 'Recommendation',
};

const TOTAL_STAGES = 11;

/**
 * Publish an AnalysisProgress event to EventBridge for real-time frontend updates.
 * Best-effort - failures are logged but don't block the workflow.
 */
async function publishProgress(
  userId: string,
  requestId: string,
  marketId: string,
  stage: number,
  status: 'running' | 'completed' | 'failed' = 'running',
): Promise<void> {
  const progress = Math.round((stage / TOTAL_STAGES) * 100);
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [{
          Source: 'tradewizard.analysis',
          DetailType: 'AnalysisProgress',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            userId,
            analysisId: requestId,
            marketId,
            stage,
            totalStages: TOTAL_STAGES,
            stageName: STAGE_NAMES[stage] || `Stage ${stage}`,
            status,
            progress,
            timestamp: new Date().toISOString(),
          }),
        }],
      })
    );
  } catch (error) {
    // Best-effort - don't block the workflow for progress reporting
    console.warn(`[Analysis_Lambda] Failed to publish progress (stage ${stage}):`, error);
  }
}

/** Required environment variables validated on cold start */
const REQUIRED_ENV_VARS = [
  'BEDROCK_MODEL_ID',
  'AWS_REGION',
  'ANALYSIS_HISTORY_DEPTH',
  'DB_SECRET_ARN',
  'DB_HOST',
  'EVENT_BUS_NAME',
] as const;

/**
 * Cold-start environment variable validation.
 * Logs a warning for each missing/empty variable but does not crash the Lambda.
 * This runs once when the module is first loaded (container cold start).
 */
function validateEnvironment(): void {
  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      console.warn(
        `[Analysis_Lambda] WARNING: Required environment variable ${varName} is missing or empty`
      );
    }
  }

  // Fail fast when Nebius is selected but its model IDs are incomplete.
  validateAiProviderConfiguration([
    'fast',
    'analytical',
    'agentic',
    'reasoning',
    'deep_reasoning',
    'non_tool',
  ]);
}

// Perform cold-start validation when the module loads
validateEnvironment();

/**
 * Creates a NO_TRADE fallback recommendation for error/validation failure scenarios.
 */
export function createFallbackRecommendation(
  marketId: string,
  summary: string,
  metadata?: Partial<TradeRecommendation['metadata']>
): TradeRecommendation {
  return {
    marketId: marketId || 'unknown',
    action: 'NO_TRADE',
    entryZone: [0, 0],
    targetZone: [0, 0],
    stopLoss: 0,
    expectedValue: 0,
    winProbability: 0,
    liquidityRisk: 'high',
    explanation: {
      summary,
      coreThesis: '',
      keyCatalysts: [],
      failureScenarios: [],
      uncertaintyNote: 'Analysis could not be completed.',
      riskPerspectives: '',
    },
    metadata: {
      consensusProbability: 0,
      marketProbability: 0,
      edge: 0,
      confidenceBand: [0, 0],
      totalLlmCalls: metadata?.totalLlmCalls ?? 0,
      executionDurationMs: metadata?.executionDurationMs ?? 0,
      agentsUsed: metadata?.agentsUsed ?? [],
      marketQuestion: metadata?.marketQuestion ?? '',
    },
  };
}

/**
 * Validates the incoming payload. Returns an array of invalid field names (empty if valid).
 */
export function validatePayload(event: unknown): { valid: boolean; invalidFields: string[] } {
  const invalidFields: string[] = [];

  if (!event || typeof event !== 'object') {
    return { valid: false, invalidFields: ['marketId', 'userId', 'requestId'] };
  }

  const payload = event as Record<string, unknown>;

  if (!payload.marketId || typeof payload.marketId !== 'string' || payload.marketId.trim() === '') {
    invalidFields.push('marketId');
  }
  if (!payload.userId || typeof payload.userId !== 'string' || payload.userId.trim() === '') {
    invalidFields.push('userId');
  }
  if (!payload.requestId || typeof payload.requestId !== 'string' || payload.requestId.trim() === '') {
    invalidFields.push('requestId');
  }

  return { valid: invalidFields.length === 0, invalidFields };
}

/**
 * Cleans up all files created in /tmp during workflow execution.
 * Removes files matching the analysis working directory pattern.
 * Logs but does not throw on cleanup failures.
 */
async function cleanupTmp(): Promise<void> {
  const tmpDir = '/tmp';
  try {
    const entries = await readdir(tmpDir);
    const analysisFiles = entries.filter(
      (entry) =>
        entry.startsWith('analysis-') ||
        entry.endsWith('.csv') ||
        entry.endsWith('.json') ||
        entry.startsWith('price-history-') ||
        entry.startsWith('related-markets-')
    );

    await Promise.all(
      analysisFiles.map((file) =>
        rm(join(tmpDir, file), { recursive: true, force: true }).catch((err) => {
          console.warn(`[Analysis_Lambda] Failed to remove /tmp/${file}:`, err.message);
        })
      )
    );

    if (analysisFiles.length > 0) {
      console.log(`[Analysis_Lambda] Cleaned up ${analysisFiles.length} file(s) from /tmp`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[Analysis_Lambda] /tmp cleanup failed: ${message}`);
  }
}

/**
 * Lambda handler entry point.
 *
 * Validates the payload, orchestrates the 11-stage workflow, and returns a TradeRecommendation.
 * Tracks total LLM calls and execution duration in metadata.
 * Cleans up /tmp in the finally block regardless of success or failure.
 */
export async function handler(event: unknown): Promise<TradeRecommendation> {
  const startTime = Date.now();
  let totalLlmCalls = 0;

  try {
    // Validate payload
    const { valid, invalidFields } = validatePayload(event);
    if (!valid) {
      const fieldList = invalidFields.join(', ');
      return createFallbackRecommendation(
        (event as AnalysisPayload)?.marketId || 'unknown',
        `Payload validation failed: missing or empty fields: ${fieldList}`,
        { executionDurationMs: Date.now() - startTime }
      );
    }

    const payload = event as AnalysisPayload;

    // Fail fast if the active AI provider's credentials are missing.
    await assertAiProviderCredentials();

    // ── Stage 1-2: Data Preparation & Historical Context (parallel) ──────────
    console.log(`[Analysis_Lambda] Starting analysis for market=${payload.marketId}`);

    // Reset tool result caches for this analysis execution (warm-container safety)
    resetNewsToolCache();
    resetSearchToolCache();
    resetAllSharedCaches();

    await publishProgress(payload.userId, payload.requestId, payload.marketId, 1);

    // We need market briefing info - resolve tokenId and question from CLOB API for price history.
    // The condition_id is typically the same as market_id on Polymarket.
    const marketInfo = await fetchMarketInfo(payload.marketId);
    if (marketInfo?.tokenId) {
      console.log(`[Analysis_Lambda] Resolved tokenId=${marketInfo.tokenId.slice(0, 16)}... question="${marketInfo.question.slice(0, 60)}" for market=${payload.marketId.slice(0, 16)}`);
    } else {
      console.warn(`[Analysis_Lambda] Could not resolve tokenId for market=${payload.marketId.slice(0, 16)} - price history will be unavailable`);
    }

    const briefing: MarketBriefing = {
      marketId: payload.marketId,
      conditionId: payload.marketId,
      tokenId: marketInfo?.tokenId || '',
      question: marketInfo?.question || '',
      endDate: marketInfo?.endDate,
      liquidity: marketInfo?.liquidity,
      spread: marketInfo?.spread,
      bestBid: marketInfo?.bestBid,
      bestAsk: marketInfo?.bestAsk,
      volume24h: marketInfo?.volume24h,
    };

    // Run data preparation and historical context in parallel
    const [dataResult, historicalEntries, agentPerformanceWeights] = await Promise.all([
      prepareData(briefing),
      fetchHistoricalContext(payload.marketId),
      fetchAgentPerformanceWeights(payload.marketId),
    ]);
    totalLlmCalls += 0; // No LLM calls in these stages
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 2);

    // ── Deterministic market context (used as the fusion prior and by agents) ─
    const pricePoints = dataResult.priceHistory.points;
    const lastTradePrice =
      pricePoints.length > 0 ? pricePoints[pricePoints.length - 1].price : undefined;
    const midpoint =
      marketInfo?.bestBid !== undefined && marketInfo?.bestAsk !== undefined
        ? (marketInfo.bestBid + marketInfo.bestAsk) / 2
        : undefined;
    // Prefer the live order-book midpoint; fall back to the last traded price.
    const marketProbability = midpoint ?? lastTradePrice ?? 0.5;
    const priceVolatility = computePriceVolatility(pricePoints);
    const liquidityRisk = deriveLiquidityRisk({
      liquidity: marketInfo?.liquidity,
      spread: marketInfo?.spread,
    });

    console.log(
      `[Analysis_Lambda] Market prior P(YES)=${marketProbability.toFixed(3)}, ` +
      `volatility=${priceVolatility.toFixed(4)}, liquidityRisk=${liquidityRisk}, ` +
      `endDate=${marketInfo?.endDate ?? 'unknown'}`,
    );

    // ── Stage 3: Web Research Agent ──────────────────────────────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 3);
    const webResearch = await runWebResearch(
      briefing.question || dataResult.priceHistory.summary || `Market: ${payload.marketId}`
    );
    totalLlmCalls += 1 + webResearch.searchCalls; // Agent + tool calls

    // ── Stage 4-5: Parallel Intelligence Agents (14 agents) ──────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 5);
    const agentContext = {
      marketQuestion: briefing.question || `Market ${payload.marketId}`,
      csvPath: dataResult.priceHistory.csvPath,
      relatedMarketsJsonPath: dataResult.relatedMarkets.jsonPath,
      priceHistorySummary: dataResult.priceHistory.summary,
      relatedMarketsSummary: dataResult.relatedMarkets.summary,
      webResearchBrief: webResearch.brief,
      historicalEntries,
      currentMarketProbability: marketProbability,
      marketEndDate: marketInfo?.endDate,
      liquidity: marketInfo?.liquidity,
      spread: marketInfo?.spread,
      volume24h: marketInfo?.volume24h,
      priceVolatility,
      marketBriefing: `Market ID: ${payload.marketId}\nPrice Summary: ${dataResult.priceHistory.summary}\nRelated Markets: ${dataResult.relatedMarkets.summary}`,
    };

    const agentsResult = await runIntelligenceAgents(agentContext);
    totalLlmCalls += 14; // 14 agent invocations

    // If >10 agents failed, abort with NO_TRADE
    if (agentsResult.aborted) {
      return createFallbackRecommendation(payload.marketId, agentsResult.abortReason || 'Insufficient intelligence coverage', {
        totalLlmCalls,
        executionDurationMs: Date.now() - startTime,
        agentsUsed: agentsResult.successfulAgents,
        marketQuestion: briefing.question,
      });
    }

    // ── Stage 6: Signal Fusion (pure deterministic - no LLM) ─────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 6);
    const fusedSignal = fuseSignals(
      agentsResult.signals,
      agentPerformanceWeights,
      marketProbability,
    );

    // ── Stage 7: Thesis Construction ─────────────────────────────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 7);
    const thesisResult = await runThesisConstruction(
      fusedSignal,
      agentsResult.signals,
      briefing.question || `Market ${payload.marketId}`
    );
    totalLlmCalls += 1;

    // ── Stage 8: Cross-Examination ───────────────────────────────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 8);
    const crossExamResult = await runCrossExamination(
      thesisResult.bullThesis,
      thesisResult.bearThesis,
      briefing.question || `Market ${payload.marketId}`
    );
    totalLlmCalls += 1;

    // ── Stage 9: Consensus Engine (pure deterministic - no LLM) ──────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 9);

    const consensusOutput = runConsensusEngine(
      fusedSignal,
      thesisResult.bullThesis,
      thesisResult.bearThesis,
      crossExamResult.crossExamResult,
      marketProbability,
      liquidityRisk,
    );

    // If consensus failed or NO_TRADE, we still run risk philosophy and recommendation
    // for completeness (the recommendation stage respects the consensus action)

    // ── Stage 10: Risk Philosophy Agents (3 parallel) ────────────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 10);
    const riskResult = await runRiskPhilosophy(
      consensusOutput,
      fusedSignal,
      briefing.question || `Market ${payload.marketId}`
    );
    totalLlmCalls += 3;

    // ── Stage 11: Recommendation Generation ──────────────────────────────────
    await publishProgress(payload.userId, payload.requestId, payload.marketId, 11);
    const recommendationResult = await runRecommendation({
      marketId: payload.marketId,
      marketQuestion: briefing.question || `Market ${payload.marketId}`,
      marketProbability,
      consensusOutput,
      fusedSignal,
      bullThesis: thesisResult.bullThesis,
      bearThesis: thesisResult.bearThesis,
      crossExamResult: crossExamResult.crossExamResult,
      riskPhilosophy: riskResult,
      agentsUsed: [...ALL_AGENT_NAMES],
      totalLlmCalls,
      executionStartTime: startTime,
      volatility: priceVolatility,
      marketEndDate: marketInfo?.endDate,
      liquidityRisk,
      liquidity: marketInfo?.liquidity,
      spread: marketInfo?.spread,
    });
    totalLlmCalls += 1;

    // Attach _analysisDetail for downstream storage (agent_memory, S3 detail)
    const recommendation = recommendationResult.recommendation;
    (recommendation as TradeRecommendation & { _analysisDetail?: unknown })._analysisDetail = {
      agentSignals: agentsResult.signals,
      fusedSignal,
      bullThesis: thesisResult.bullThesis,
      bearThesis: thesisResult.bearThesis,
      crossExamination: crossExamResult.crossExamResult,
      consensus: consensusOutput.consensusResult,
      riskPerspectives: riskResult.summary,
      webResearchSummary: webResearch.brief,
    };

    // Update metadata with final counts
    recommendation.metadata.totalLlmCalls = totalLlmCalls;
    recommendation.metadata.executionDurationMs = Date.now() - startTime;
    recommendation.metadata.agentsUsed = [...ALL_AGENT_NAMES];
    recommendation.metadata.marketQuestion = briefing.question || `Market ${payload.marketId}`;

    console.log(
      `[Analysis_Lambda] Workflow complete: action=${recommendation.action}, ` +
      `edge=${recommendation.metadata.edge.toFixed(3)}, ` +
      `llmCalls=${totalLlmCalls}, duration=${Date.now() - startTime}ms`
    );

    return recommendation;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Analysis_Lambda] Unrecoverable error:', message);
    return createFallbackRecommendation(
      (event as AnalysisPayload)?.marketId || 'unknown',
      `Unrecoverable error during analysis: ${message}`,
      {
        totalLlmCalls,
        executionDurationMs: Date.now() - startTime,
      }
    );
  } finally {
    const duration = Date.now() - startTime;
    console.log(`[Analysis_Lambda] Execution completed in ${duration}ms`);
    await cleanupTmp();
  }
}
