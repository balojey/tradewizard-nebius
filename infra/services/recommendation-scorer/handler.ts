/**
 * Recommendation Scorer - Lambda handler.
 *
 * Runs every 5 minutes via EventBridge Scheduler. Checks all pending
 * trade recommendations against current market prices to detect TP/SL hits.
 *
 * Scoring logic:
 * - TP hit → recommendation SUCCESS → aligned agents get +1 correct, dissenters +1 incorrect
 * - SL hit → recommendation FAILURE → aligned agents get +1 incorrect, dissenters +1 correct
 * - Expired (>7 days old, no hit) → EXPIRED, no agent scoring
 *
 * "Aligned" means the agent's direction matched the recommendation action:
 *   - LONG_YES recommendation: agents with direction=YES are aligned
 *   - LONG_NO recommendation: agents with direction=NO are aligned
 *   - NEUTRAL agents are excluded from scoring
 *
 * Triggered by: EventBridge Scheduler (every 5 minutes)
 */

import { getConnectionString } from '../shared/db';

const EXPIRY_HOURS = parseInt(process.env.RECOMMENDATION_EXPIRY_HOURS || '168', 10); // 7 days default

interface PendingRecommendation {
  id: string;
  market_id: string;
  recommendation: string;
  target_price: number;
  stop_loss_price: number;
  executed_at: string;
}

interface AgentMemoryRow {
  agent_name: string;
  direction: string;
  confidence: number;
  fair_probability: number;
}

function clampProbability(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(): Promise<void> {
  console.log('Recommendation scorer running - checking pending outcomes');

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // 1. Fetch all pending recommendations
    const pendingResult = await client.query<PendingRecommendation>(
      `SELECT id, market_id, recommendation, target_price, stop_loss_price, executed_at
       FROM analysis_results
       WHERE outcome_status = 'pending'
         AND recommendation IN ('LONG_YES', 'LONG_NO')
         AND target_price IS NOT NULL
         AND stop_loss_price IS NOT NULL
       ORDER BY executed_at ASC
       LIMIT 200`
    );

    if (pendingResult.rows.length === 0) {
      console.log('No pending recommendations to check');
      return;
    }

    console.log(`Checking ${pendingResult.rows.length} pending recommendations`);

    // 2. Get unique market IDs and fetch current prices
    const marketIds = [...new Set(pendingResult.rows.map((r) => r.market_id))];
    const priceMap = await fetchCurrentPrices(marketIds);

    const now = new Date();
    let successCount = 0;
    let failureCount = 0;
    let expiredCount = 0;

    // 3. Check each recommendation against current price
    for (const rec of pendingResult.rows) {
      const currentPrice = priceMap.get(rec.market_id);

      // Skip if we can't get a price for this market
      if (currentPrice === undefined || currentPrice === null) {
        continue;
      }

      // Check expiry (7 days default)
      const ageHours = (now.getTime() - new Date(rec.executed_at).getTime()) / (1000 * 60 * 60);
      if (ageHours > EXPIRY_HOURS) {
        await client.query(
          `UPDATE analysis_results
           SET outcome_status = 'expired', outcome_resolved_at = $1
           WHERE id = $2`,
          [now.toISOString(), rec.id]
        );
        expiredCount++;
        continue;
      }

      // Determine if TP or SL has been hit based on recommendation direction
      const isLongYes = rec.recommendation === 'LONG_YES';

      // The stored entry/target/stop prices are in TRADED-TOKEN space:
      // - LONG_YES: prices are YES-token prices (compare directly against YES price)
      // - LONG_NO: prices are NO-token prices (must convert fetched YES price to NO price)
      const relevantPrice = isLongYes ? currentPrice : (1 - currentPrice);

      // In traded-token space, TP is always ABOVE entry, SL is always BELOW entry.
      // So for both directions: target hit when price rises, stop hit when price drops.
      const targetHit = relevantPrice >= rec.target_price;
      const stopHit = relevantPrice <= rec.stop_loss_price;

      if (targetHit) {
        // TP hit - recommendation SUCCESS
        await client.query(
          `UPDATE analysis_results
           SET outcome_status = 'success', outcome_hit_price = $1, outcome_resolved_at = $2
           WHERE id = $3`,
          [relevantPrice, now.toISOString(), rec.id]
        );
        await scoreAgents(client, rec.id, rec.recommendation, 'success');
        successCount++;
      } else if (stopHit) {
        // SL hit - recommendation FAILURE
        await client.query(
          `UPDATE analysis_results
           SET outcome_status = 'failure', outcome_hit_price = $1, outcome_resolved_at = $2
           WHERE id = $3`,
          [relevantPrice, now.toISOString(), rec.id]
        );
        await scoreAgents(client, rec.id, rec.recommendation, 'failure');
        failureCount++;
      }
      // Neither hit - stays pending
    }

    console.log(
      `Scoring complete: ${successCount} success, ${failureCount} failure, ${expiredCount} expired, ${pendingResult.rows.length - successCount - failureCount - expiredCount} still pending`
    );
  } catch (error) {
    console.error('Recommendation scorer failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Agent Scoring ───────────────────────────────────────────────────────────

/**
 * Score each agent that contributed to this recommendation.
 *
 * - Aligned agents (direction matches recommendation): success → correct++, failure → incorrect++
 * - Dissenting agents (direction opposes recommendation): success → incorrect++, failure → correct++
 * - NEUTRAL agents are excluded from scoring
 */
async function scoreAgents(
  client: import('pg').Client,
  resultId: string,
  recommendation: string,
  outcome: 'success' | 'failure'
): Promise<void> {
  // Fetch agent signals from agent_memory for this result
  const signalsResult = await client.query<AgentMemoryRow>(
    `SELECT agent_name, direction, confidence, fair_probability
     FROM agent_memory
     WHERE result_id = $1`,
    [resultId]
  );

  if (signalsResult.rows.length === 0) {
    console.warn(`No agent signals found for result ${resultId} - skipping scoring`);
    return;
  }

  // Determine which direction is "aligned" with the recommendation
  const alignedDirection = recommendation === 'LONG_YES' ? 'YES' : 'NO';

  for (const signal of signalsResult.rows) {
    // Skip neutral agents - they didn't take a side
    if (signal.direction === 'NEUTRAL') continue;

    const isAligned = signal.direction === alignedDirection;

    // Aligned + success = correct. Aligned + failure = incorrect.
    // Dissenting + success = incorrect. Dissenting + failure = correct.
    const isCorrect = (isAligned && outcome === 'success') || (!isAligned && outcome === 'failure');

    // Realized YES/NO direction at the trade horizon. For a LONG_YES success
    // the market moved YES; for a LONG_NO success it moved NO.
    const realizedOutcome =
      recommendation === 'LONG_YES'
        ? outcome === 'success'
          ? 1
          : 0
        : outcome === 'success'
          ? 0
          : 1;

    const probability = clampProbability(Number(signal.fair_probability));
    const brier = (probability - realizedOutcome) ** 2;
    const logLoss = -(
      realizedOutcome * Math.log(probability) +
      (1 - realizedOutcome) * Math.log(1 - probability)
    );

    // Upsert agent_performance with atomic increments and calibration averages.
    await client.query(
      `INSERT INTO agent_performance (
         agent_name, total_signals, correct_signals, accuracy_pct, avg_confidence,
         brier_score, log_loss, calibration_samples, last_updated_at
       )
       VALUES ($1, 1, $2, $3, $4, $5, $6, 1, NOW())
       ON CONFLICT (agent_name) DO UPDATE SET
         total_signals = agent_performance.total_signals + 1,
         correct_signals = agent_performance.correct_signals + $2,
         accuracy_pct = ROUND(
           ((agent_performance.correct_signals + $2)::NUMERIC / (agent_performance.total_signals + 1)) * 100, 2
         ),
         avg_confidence = ROUND(
           (agent_performance.avg_confidence * agent_performance.total_signals + $4) / (agent_performance.total_signals + 1), 4
         ),
         brier_score = ROUND(
           (
             COALESCE(agent_performance.brier_score, $5) * agent_performance.calibration_samples + $5
           ) / (agent_performance.calibration_samples + 1), 6
         ),
         log_loss = ROUND(
           (
             COALESCE(agent_performance.log_loss, $6) * agent_performance.calibration_samples + $6
           ) / (agent_performance.calibration_samples + 1), 6
         ),
         calibration_samples = agent_performance.calibration_samples + 1,
         last_updated_at = NOW()`,
      [
        signal.agent_name,
        isCorrect ? 1 : 0,
        isCorrect ? 100.0 : 0.0,
        signal.confidence,
        brier,
        logLoss,
      ]
    );
  }

  // Mark this result as scored
  await client.query(
    `UPDATE analysis_results SET agents_scored = true WHERE id = $1`,
    [resultId]
  );

  console.log(
    `Scored ${signalsResult.rows.filter((s) => s.direction !== 'NEUTRAL').length} agents for result ${resultId} (${outcome})`
  );
}

// ─── Price Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch current YES token midpoint prices for a batch of markets from
 * Polymarket's CLOB API.
 *
 * Returns a Map<marketId (conditionId), price (0.0–1.0)>.
 */
async function fetchCurrentPrices(marketIds: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();

  // Batch fetch via Polymarket Gamma API (markets endpoint)
  // Each market returns outcomePrices for YES/NO
  for (const marketId of marketIds) {
    try {
      const response = await fetch(
        `https://gamma-api.polymarket.com/markets?condition_ids=${marketId}&limit=1`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!response.ok) continue;

      const markets = await response.json();
      if (!Array.isArray(markets) || markets.length === 0) continue;

      const market = markets[0];
      if (market.outcomePrices) {
        try {
          const prices = typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)
            : market.outcomePrices;
          if (Array.isArray(prices) && prices.length > 0) {
            priceMap.set(marketId, parseFloat(prices[0]));
          }
        } catch {
          // Skip malformed price data
        }
      }
    } catch (error) {
      // Timeout or network error - skip this market
      console.warn(`Failed to fetch price for market ${marketId}:`, error);
    }
  }

  return priceMap;
}
