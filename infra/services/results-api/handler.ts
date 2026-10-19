/**
 * Analysis Results API - Lambda handler.
 *
 * Serves paginated analysis history and full result detail from S3.
 *
 * Routes:
 *   GET /analysis/history?cursor=X&limit=20 → paginated list of analysis deliveries
 *   GET /analysis/{analysisId}              → full result payload from S3
 *
 * Triggered by: API Gateway REST
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getConnectionString } from '../shared/db';

const s3Client = new S3Client({});

const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';

interface ApiGatewayEvent {
  body: string | null;
  requestContext: {
    authorizer: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  httpMethod: string;
  path: string;
  resource: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface AnalysisHistoryItem {
  analysisId: string;
  marketId: string;
  marketQuestion: string;
  recommendation: string;
  consensusProbability: number;
  confidence: number;
  executedAt: string;
  wasCachedDelivery: boolean;
}

interface PaginatedResponse {
  items: AnalysisHistoryItem[];
  nextCursor: string | null;
  totalCount: number;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/**
 * Main Lambda handler.
 */
export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  try {
    const userId = event.requestContext.authorizer.claims.sub;

    // Route based on path
    if (event.path.match(/\/analysis\/spotlight/) && event.httpMethod === 'GET') {
      return await handleGetSpotlight(event.queryStringParameters);
    }

    if (event.path.match(/\/analysis\/agent-accuracy/) && event.httpMethod === 'GET') {
      return await handleGetAgentAccuracy(event.queryStringParameters);
    }

    if (event.path.match(/\/analysis\/market-performance/) && event.httpMethod === 'GET') {
      return await handleGetMarketPerformance(event.queryStringParameters);
    }

    if (event.path.match(/\/analysis\/history/) && event.httpMethod === 'GET') {
      return await handleGetHistory(userId, event.queryStringParameters);
    }

    if (event.pathParameters?.analysisId && event.httpMethod === 'GET') {
      return await handleGetAnalysisDetail(userId, event.pathParameters.analysisId);
    }

    return respond(404, { error: 'Not found' });
  } catch (error) {
    console.error('Results API error:', error);
    return respond(500, { error: 'Internal server error' });
  }
}

/**
 * GET /analysis/spotlight?limit=5
 *
 * Returns the highest-edge recent analyses across ALL users (public discovery).
 * Surfaces markets where the AI found a significant edge (≥5¢) in the last 24h.
 * Results are ordered by absolute edge descending - biggest opportunities first.
 *
 * No ownership check: this is a global "what's hot" feed to drive engagement.
 */
async function handleGetSpotlight(
  queryParams: Record<string, string> | null | undefined
): Promise<ApiResponse> {
  const limit = Math.min(Math.max(parseInt(queryParams?.limit || '5', 10) || 5, 1), 20);

  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Fetch the most recent high-edge analyses from the last 24 hours.
    // Only include actionable recommendations (LONG_YES or LONG_NO) with ≥5¢ edge.
    // DISTINCT ON market_id ensures each market appears at most once (most recent wins).
    const result = await client.query(
      `SELECT DISTINCT ON (res.market_id)
         res.id AS analysis_id,
         res.market_id,
         m.question AS market_question,
         res.recommendation,
         res.consensus_probability,
         res.confidence_score,
         res.edge,
         res.market_probability_at_execution,
         res.executed_at
       FROM analysis_results res
       LEFT JOIN markets m ON m.condition_id = res.market_id
       WHERE res.executed_at > NOW() - INTERVAL '24 hours'
         AND res.recommendation IN ('LONG_YES', 'LONG_NO')
         AND res.edge IS NOT NULL
         AND ABS(res.edge) >= 0.05
       ORDER BY res.market_id, res.executed_at DESC`,
      []
    );

    interface SpotlightRow {
      analysis_id: string;
      market_id: string;
      market_question: string | null;
      recommendation: string;
      consensus_probability: string | null;
      confidence_score: string | null;
      edge: string | null;
      market_probability_at_execution: string | null;
      executed_at: Date;
    }

    // Sort by absolute edge descending and apply the limit after dedup
    const items = result.rows
      .map((row: SpotlightRow) => ({
        analysisId: row.analysis_id,
        marketId: row.market_id,
        marketQuestion: row.market_question || 'Unknown market',
        recommendation: row.recommendation,
        consensusProbability: parseFloat(String(row.consensus_probability)) || 0,
        confidence: parseFloat(String(row.confidence_score)) || 0,
        edge: parseFloat(String(row.edge)) || 0,
        marketProbability: parseFloat(String(row.market_probability_at_execution)) || 0,
        executedAt: row.executed_at.toISOString(),
      }))
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge) || b.confidence - a.confidence)
      .slice(0, limit);

    return respond(200, { items });
  } finally {
    await client.end();
  }
}

/**
 * GET /analysis/agent-accuracy?marketId=X (optional)
 *
 * Returns the accuracy leaderboard computed from recommendation outcomes
 * in the last 30 days. When marketId is provided, scopes to that market only.
 *
 * Joins agent_memory with analysis_results to determine which agents
 * contributed to successful vs failed recommendations.
 *
 * An agent is "correct" if:
 * - It was aligned with a successful recommendation (TP hit), OR
 * - It dissented from a failed recommendation (SL hit)
 *
 * Minimum 3 scored signals required for global, 2 for per-market.
 */
async function handleGetAgentAccuracy(
  queryParams: Record<string, string> | null | undefined
): Promise<ApiResponse> {
  const marketId = queryParams?.marketId || null;
  const minSignals = marketId ? 1 : 3;

  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Build market filter clause
    const marketFilter = marketId ? 'AND ar.market_id = $1' : '';
    const params = marketId ? [marketId] : [];

    // Compute agent accuracy from scored recommendations.
    const result = await client.query(
      `WITH scored_signals AS (
         SELECT
           am.agent_name,
           am.direction,
           am.confidence,
           ar.recommendation,
           ar.outcome_status
         FROM agent_memory am
         JOIN analysis_results ar ON ar.id = am.result_id
         WHERE ar.outcome_status IN ('success', 'failure')
           AND ar.outcome_resolved_at > NOW() - INTERVAL '30 days'
           AND am.direction != 'NEUTRAL'
           ${marketFilter}
       ),
       agent_stats AS (
         SELECT
           agent_name,
           COUNT(*) AS total_signals,
           SUM(CASE
             WHEN (direction = CASE WHEN recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                   AND outcome_status = 'success')
               OR (direction != CASE WHEN recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                   AND outcome_status = 'failure')
             THEN 1 ELSE 0
           END) AS correct_signals,
           AVG(confidence) AS avg_confidence
         FROM scored_signals
         GROUP BY agent_name
         HAVING COUNT(*) >= ${minSignals}
       )
       SELECT
         agent_name,
         total_signals,
         correct_signals,
         ROUND((correct_signals::NUMERIC / total_signals) * 100, 2) AS accuracy_pct,
         ROUND(avg_confidence::NUMERIC, 4) AS avg_confidence
       FROM agent_stats
       ORDER BY accuracy_pct DESC, total_signals DESC
       LIMIT 20`,
      params
    );

    interface AgentAccuracyRow {
      agent_name: string;
      accuracy_pct: string;
      total_signals: string;
      correct_signals: string;
      avg_confidence: string;
    }

    const agents = result.rows.map((row: AgentAccuracyRow) => ({
      name: formatAgentName(row.agent_name),
      accuracy: parseFloat(String(row.accuracy_pct)),
      totalSignals: parseInt(String(row.total_signals), 10),
      correctSignals: parseInt(String(row.correct_signals), 10),
      avgConfidence: parseFloat(String(row.avg_confidence)),
      lastUpdatedAt: new Date().toISOString(),
    }));

    return respond(200, { agents, marketId });
  } finally {
    await client.end();
  }
}

/**
 * Format agent name from snake_case to Title Case for display.
 */
function formatAgentName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * GET /analysis/market-performance?marketId=X
 *
 * Returns trade recommendation outcomes (TP/SL results) for a specific market.
 * Shows win rate, average edge captured, and per-recommendation outcomes.
 * Public data - no user-specific filtering.
 */
async function handleGetMarketPerformance(
  queryParams: Record<string, string> | null | undefined
): Promise<ApiResponse> {
  const marketId = queryParams?.marketId;
  if (!marketId) {
    return respond(400, { error: 'marketId query parameter is required' });
  }

  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Fetch all recommendations for this market that were fully scored
    // (agents_scored = true ensures the recommendation scorer completed the full pipeline
    // including agent performance updates, not just price-based TP/SL detection)
    const result = await client.query(
      `SELECT
         id,
         recommendation,
         consensus_probability,
         market_probability_at_execution,
         edge,
         entry_price,
         target_price,
         stop_loss_price,
         outcome_status,
         outcome_hit_price,
         outcome_resolved_at,
         executed_at
       FROM analysis_results
       WHERE market_id = $1
         AND recommendation IN ('LONG_YES', 'LONG_NO')
         AND (
           (outcome_status IN ('success', 'failure') AND agents_scored = true)
           OR outcome_status IN ('expired', 'pending')
         )
       ORDER BY executed_at DESC
       LIMIT 50`,
      [marketId]
    );

    interface PerformanceRow {
      id: string;
      recommendation: string;
      consensus_probability: string | null;
      market_probability_at_execution: string | null;
      edge: string | null;
      entry_price: string | null;
      target_price: string | null;
      stop_loss_price: string | null;
      outcome_status: string;
      outcome_hit_price: string | null;
      outcome_resolved_at: Date | null;
      executed_at: Date;
    }

    const recommendations = result.rows.map((row: PerformanceRow) => ({
      analysisId: row.id,
      recommendation: row.recommendation,
      consensusProbability: parseFloat(String(row.consensus_probability)) || 0,
      marketProbability: parseFloat(String(row.market_probability_at_execution)) || 0,
      edge: parseFloat(String(row.edge)) || 0,
      entryPrice: row.entry_price ? parseFloat(String(row.entry_price)) : null,
      targetPrice: row.target_price ? parseFloat(String(row.target_price)) : null,
      stopLossPrice: row.stop_loss_price ? parseFloat(String(row.stop_loss_price)) : null,
      outcomeStatus: row.outcome_status,
      outcomeHitPrice: row.outcome_hit_price ? parseFloat(String(row.outcome_hit_price)) : null,
      outcomeResolvedAt: row.outcome_resolved_at?.toISOString() ?? null,
      executedAt: row.executed_at.toISOString(),
    }));

    // Calculate aggregate stats
    const resolved = recommendations.filter((r) => r.outcomeStatus === 'success' || r.outcomeStatus === 'failure');
    const successes = resolved.filter((r) => r.outcomeStatus === 'success');
    const failures = resolved.filter((r) => r.outcomeStatus === 'failure');
    const expired = recommendations.filter((r) => r.outcomeStatus === 'expired');
    const pending = recommendations.filter((r) => r.outcomeStatus === 'pending');

    const winRate = resolved.length > 0 ? successes.length / resolved.length : null;

    // Average edge captured on successful trades
    const avgEdgeCaptured = successes.length > 0
      ? successes.reduce((sum, r) => {
          if (r.entryPrice !== null && r.outcomeHitPrice !== null) {
            return sum + Math.abs(r.outcomeHitPrice - r.entryPrice);
          }
          return sum + Math.abs(r.edge);
        }, 0) / successes.length
      : null;

    return respond(200, {
      marketId,
      summary: {
        totalRecommendations: recommendations.length,
        resolved: resolved.length,
        successes: successes.length,
        failures: failures.length,
        expired: expired.length,
        pending: pending.length,
        winRate,
        avgEdgeCaptured,
      },
      recommendations,
    });
  } finally {
    await client.end();
  }
}

/**
 * GET /analysis/history?cursor=X&limit=20
 *
 * Returns paginated analysis deliveries for the authenticated user,
 * ordered by delivered_at DESC. Uses cursor-based pagination with
 * base64-encoded delivered_at timestamp.
 */
async function handleGetHistory(
  userId: string,
  queryParams: Record<string, string> | null | undefined
): Promise<ApiResponse> {
  const limit = Math.min(Math.max(parseInt(queryParams?.limit || '20', 10) || 20, 1), 100);
  const cursor = queryParams?.cursor || null;
  const marketIdFilter = queryParams?.marketId || null;

  let cursorTimestamp: string | null = null;
  if (cursor) {
    try {
      cursorTimestamp = Buffer.from(cursor, 'base64').toString('utf-8');
      // Validate it's a parseable date
      if (isNaN(Date.parse(cursorTimestamp))) {
        return respond(400, { error: 'Invalid cursor token' });
      }
    } catch {
      return respond(400, { error: 'Invalid cursor token' });
    }
  }

  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Resolve Cognito sub → internal user ID
    const userResult = await client.query(
      'SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return respond(200, { items: [], nextCursor: null, totalCount: 0 });
    }
    const internalUserId = userResult.rows[0].id;

    // Get total count for this user (deduplicated by result_id to match the history query)
    const countQuery = marketIdFilter
      ? 'SELECT COUNT(DISTINCT ad.result_id) as total FROM analysis_deliveries ad JOIN analysis_requests ar ON ar.id = ad.analysis_request_id WHERE ad.user_id = $1 AND ar.market_id = $2'
      : 'SELECT COUNT(DISTINCT result_id) as total FROM analysis_deliveries WHERE user_id = $1';
    const countParams = marketIdFilter ? [internalUserId, marketIdFilter] : [internalUserId];
    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    // Build paginated query
    let query: string;
    let params: (string | number)[];

    if (cursorTimestamp) {
      query = `
        SELECT DISTINCT ON (ad.result_id)
          ad.result_id,
          ar.market_id,
          m.question AS market_question,
          res.recommendation,
          res.consensus_probability,
          res.confidence_score,
          res.executed_at,
          ad.was_cached_delivery,
          ad.delivered_at
        FROM analysis_deliveries ad
        JOIN analysis_results res ON res.id = ad.result_id
        JOIN analysis_requests ar ON ar.id = ad.analysis_request_id
        LEFT JOIN markets m ON m.condition_id = ar.market_id
        WHERE ad.user_id = $1
          AND ad.delivered_at < $2
          ${marketIdFilter ? 'AND ar.market_id = $4' : ''}
        ORDER BY ad.result_id, ad.delivered_at DESC
      `;
      params = marketIdFilter
        ? [internalUserId, cursorTimestamp, limit, marketIdFilter]
        : [internalUserId, cursorTimestamp, limit];
    } else {
      query = `
        SELECT DISTINCT ON (ad.result_id)
          ad.result_id,
          ar.market_id,
          m.question AS market_question,
          res.recommendation,
          res.consensus_probability,
          res.confidence_score,
          res.executed_at,
          ad.was_cached_delivery,
          ad.delivered_at
        FROM analysis_deliveries ad
        JOIN analysis_results res ON res.id = ad.result_id
        JOIN analysis_requests ar ON ar.id = ad.analysis_request_id
        LEFT JOIN markets m ON m.condition_id = ar.market_id
        WHERE ad.user_id = $1
          ${marketIdFilter ? 'AND ar.market_id = $3' : ''}
        ORDER BY ad.result_id, ad.delivered_at DESC
      `;
      params = marketIdFilter
        ? [internalUserId, limit, marketIdFilter]
        : [internalUserId, limit];
    }

    // Wrap in a subquery to apply ORDER BY delivered_at DESC + LIMIT
    // (DISTINCT ON requires ordering by the distinct column first)
    const wrappedQuery = `
      SELECT * FROM (${query}) AS deduped
      ORDER BY deduped.delivered_at DESC
      LIMIT $${cursorTimestamp ? '3' : '2'}
    `;

    const result = await client.query(wrappedQuery, params);

    const items: AnalysisHistoryItem[] = result.rows.map((row: Record<string, unknown>) => ({
      analysisId: row.result_id as string,
      marketId: row.market_id as string,
      marketQuestion: (row.market_question as string) || 'Unknown market',
      recommendation: (row.recommendation as string) || 'NO_TRADE',
      consensusProbability: parseFloat(String(row.consensus_probability)) || 0,
      confidence: parseFloat(String(row.confidence_score)) || 0,
      executedAt: (row.executed_at as Date).toISOString(),
      wasCachedDelivery: row.was_cached_delivery as boolean,
    }));

    // Generate next cursor from the last item's delivered_at
    let nextCursor: string | null = null;
    if (items.length === limit && result.rows.length > 0) {
      const lastDeliveredAt = (result.rows[result.rows.length - 1].delivered_at as Date).toISOString();
      nextCursor = Buffer.from(lastDeliveredAt).toString('base64');
    }

    const responseBody: PaginatedResponse = {
      items,
      nextCursor,
      totalCount,
    };

    return respond(200, responseBody);
  } finally {
    await client.end();
  }
}

/**
 * GET /analysis/{analysisId}
 *
 * Fetches the full analysis result payload from S3.
 * Verifies ownership: only returns results belonging to the requesting user.
 * Returns 404 for non-existent or unauthorized analysis IDs.
 *
 * The response merges the public trade recommendation (results/ prefix) with
 * the full analysis detail (detail/ prefix: agent signals, theses, consensus,
 * risk perspectives) so the frontend gets everything in one call.
 */
async function handleGetAnalysisDetail(
  userId: string,
  analysisId: string
): Promise<ApiResponse> {
  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Resolve Cognito sub → internal user ID
    const userResult = await client.query(
      'SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return respond(404, { error: 'Analysis not found' });
    }
    const internalUserId = userResult.rows[0].id;

    // Verify ownership: check that this user has a delivery for this result
    const ownershipResult = await client.query(
      `SELECT res.result_payload_s3_key
       FROM analysis_deliveries ad
       JOIN analysis_results res ON res.id = ad.result_id
       WHERE ad.user_id = $1 AND ad.result_id = $2
       LIMIT 1`,
      [internalUserId, analysisId]
    );

    if (ownershipResult.rows.length === 0) {
      // Return 404 for both non-existent and unauthorized (don't leak existence)
      return respond(404, { error: 'Analysis not found' });
    }

    const s3Key = ownershipResult.rows[0].result_payload_s3_key as string;

    // Fetch public trade recommendation from S3
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: ANALYSIS_BUCKET,
        Key: s3Key,
      })
    );

    if (!s3Response.Body) {
      console.error(`S3 object body is empty for key: ${s3Key}`);
      return respond(500, { error: 'Failed to retrieve analysis result' });
    }

    const payloadString = await s3Response.Body.transformToString('utf-8');
    const payload = JSON.parse(payloadString);

    // Fetch full analysis detail (agent signals, theses, consensus, risk)
    // from the detail/ prefix. Best-effort - if missing, return the public
    // payload alone (older results pre-date this feature).
    const detailS3Key = s3Key.replace(/^results\//, 'detail/');
    try {
      const detailResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: ANALYSIS_BUCKET,
          Key: detailS3Key,
        })
      );
      if (detailResponse.Body) {
        const detailString = await detailResponse.Body.transformToString('utf-8');
        const detail = JSON.parse(detailString);
        // Merge detail fields into the payload
        payload.agentSignals      = detail.agentSignals      ?? [];
        payload.fusedSignal       = detail.fusedSignal       ?? null;
        payload.bullThesis        = detail.bullThesis        ?? null;
        payload.bearThesis        = detail.bearThesis        ?? null;
        payload.crossExamination  = detail.crossExamination  ?? null;
        payload.consensus         = detail.consensus         ?? null;
        payload.riskPerspectivesRaw = detail.riskPerspectives ?? '';
        payload.webResearchSummary = detail.webResearchSummary ?? '';
      }
    } catch (detailError) {
      // Older results won't have a detail file - return public payload only
      console.info(`No detail file found for ${detailS3Key} (pre-feature result or first run)`);
    }

    return respond(200, payload);
  } finally {
    await client.end();
  }
}

/**
 * Build a standard API response.
 */
function respond(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
