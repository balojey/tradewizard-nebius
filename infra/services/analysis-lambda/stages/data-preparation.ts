/**
 * Data Preparation Stage - Price History CSV and Related Markets JSON
 *
 * Fetches market data deterministically at the start of analysis and writes
 * to /tmp for agent shell analysis. Handles:
 * 1. Full price history from Polymarket CLOB API (60-min fidelity)
 * 2. Related sibling markets from Polymarket Gamma API (up to 50)
 * 3. Aggregate metrics calculation for related markets
 * 4. Price history for top 5 siblings by volume (parallel fetch)
 *
 * On failure: continues with empty data, logs warning, sets csv_path to empty string.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import { writeFile } from 'fs/promises';

const CLOB_API_URL = 'https://clob.polymarket.com';
const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const FETCH_TIMEOUT_MS = 30_000;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PricePoint {
  timestamp: number;
  datetimeUtc: string;
  price: number;
}

export interface PriceHistoryResult {
  tokenId: string;
  points: PricePoint[];
  csvPath: string;
  summary: string;
}

export interface RelatedMarket {
  conditionId: string;
  question: string;
  probability: number;
  volume: number;
  liquidity: number;
  active: boolean;
  endDate: string;
}

export interface AggregateMetrics {
  average_probability: number;
  volume_weighted_probability: number;
  sentiment_direction: 'bullish' | 'bearish' | 'neutral';
  total_volume: number;
  total_liquidity: number;
}

export interface RelatedMarketsResult {
  eventTitle: string;
  targetConditionId: string;
  markets: RelatedMarket[];
  jsonPath: string;
  summary: string;
  aggregate: AggregateMetrics;
}

export interface DataPreparationResult {
  priceHistory: PriceHistoryResult;
  relatedMarkets: RelatedMarketsResult;
}

export interface MarketBriefing {
  marketId: string;
  conditionId: string;
  tokenId: string;
  question: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Performs a fetch with timeout using AbortController.
 */
async function fetchWithTimeout(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Converts a Unix timestamp to UTC datetime string (YYYY-MM-DD HH:MM:SS).
 */
function timestampToUtc(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ─── Price History ─────────────────────────────────────────────────────────────

/**
 * Fetches full price history from Polymarket CLOB API.
 */
export async function fetchPriceHistory(
  tokenId: string,
  fidelity: number = 60,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<PricePoint[]> {
  const url = `${CLOB_API_URL}/prices-history?market=${tokenId}&interval=max&fidelity=${fidelity}`;
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new Error(`CLOB API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const history: Array<{ t: number; p: number }> = (data?.history as Array<{ t: number; p: number }>) ?? [];

  const points: PricePoint[] = history.map((entry) => ({
    timestamp: Number(entry.t) || 0,
    datetimeUtc: timestampToUtc(Number(entry.t) || 0),
    price: Number(entry.p) || 0,
  }));

  // Sort ascending by timestamp
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

/**
 * Writes price history data to a CSV file in /tmp.
 * Includes metadata comment lines at the top.
 */
export async function writePriceHistoryCsv(
  points: PricePoint[],
  tokenId: string,
  marketQuestion: string,
  marketId: string
): Promise<string> {
  const filePath = `/tmp/price-history-${marketId}.csv`;

  const lines: string[] = [];

  // Single comment line with all metadata (agents use NR>1 to skip line 1)
  lines.push(`# Market: ${marketQuestion} | Token: ${tokenId} | Points: ${points.length} | Range: ${points.length > 0 ? `${points[0].datetimeUtc} to ${points[points.length - 1].datetimeUtc}` : 'N/A'} | Price: ${points.length > 0 ? `${Math.min(...points.map(p => p.price)).toFixed(4)} to ${Math.max(...points.map(p => p.price)).toFixed(4)}` : 'N/A'}`);

  // Header row
  lines.push('timestamp,datetime_utc,price');

  // Data rows
  for (const point of points) {
    lines.push(`${point.timestamp},${point.datetimeUtc},${point.price.toFixed(6)}`);
  }

  await writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

/**
 * Generates a brief text summary of the price history for agent context.
 */
export function generatePriceSummary(points: PricePoint[]): string {
  if (points.length === 0) {
    return 'No price history available.';
  }

  const prices = points.map((p) => p.price);
  const current = prices[prices.length - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const first = prices[0];
  const changeFromInception = current - first;

  // Recent trend (last 10% of data points)
  const recentStart = Math.max(0, prices.length - Math.floor(prices.length / 10));
  const recentPrices = prices.slice(recentStart);
  const recentTrend =
    recentPrices.length > 1 ? recentPrices[recentPrices.length - 1] - recentPrices[0] : 0;

  // Volatility (standard deviation)
  const variance = prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / prices.length;
  const volatility = Math.sqrt(variance);

  // ~24h change approximation (last 24 hourly data points)
  const change24h = prices.length > 24 ? current - prices[prices.length - 25] : changeFromInception;

  const summaryLines = [
    `Price History Summary (${points.length} data points)`,
    `  Date range: ${points[0].datetimeUtc} → ${points[points.length - 1].datetimeUtc}`,
    `  Current price: ${current.toFixed(4)}`,
    `  All-time high: ${high.toFixed(4)}`,
    `  All-time low: ${low.toFixed(4)}`,
    `  Mean price: ${mean.toFixed(4)}`,
    `  Volatility (σ): ${volatility.toFixed(4)}`,
    `  Change from inception: ${changeFromInception >= 0 ? '+' : ''}${changeFromInception.toFixed(4)}`,
    `  Recent trend (last 10%): ${recentTrend >= 0 ? '+' : ''}${recentTrend.toFixed(4)}`,
    `  ~24h change: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(4)}`,
  ];

  return summaryLines.join('\n');
}

// ─── Related Markets ───────────────────────────────────────────────────────────

/**
 * Fetches related sibling markets for a given condition ID.
 *
 * Correct flow:
 *   1. CLOB API: GET /markets/{condition_id} → get market_slug
 *   2. Gamma API: GET /markets?slug={market_slug} → get full market details including events[].slug
 *   3. Gamma API: GET /events?slug={event_slug} → get the event with ALL sibling markets
 *
 * Returns sibling markets (excluding the target) and the event title.
 */
export async function fetchRelatedMarkets(
  conditionId: string,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<{ markets: RelatedMarket[]; eventTitle: string }> {
  // Step 1: Get market_slug from CLOB API
  const clobUrl = `${CLOB_API_URL}/markets/${conditionId}`;
  const clobResponse = await fetchWithTimeout(clobUrl, timeoutMs);

  if (!clobResponse.ok) {
    throw new Error(`CLOB API returned ${clobResponse.status} for condition_id=${conditionId.slice(0, 16)}`);
  }

  const clobMarket = (await clobResponse.json()) as Record<string, unknown>;
  const marketSlug = clobMarket.market_slug as string | undefined;

  if (!marketSlug) {
    console.warn(`[DataPreparation] CLOB market has no market_slug - cannot discover siblings`);
    return { markets: [], eventTitle: '' };
  }

  // Step 2: Get full market details from Gamma API by slug (includes parent event info)
  const gammaMarketUrl = `${GAMMA_API_URL}/markets?slug=${marketSlug}`;
  const gammaMarketResponse = await fetchWithTimeout(gammaMarketUrl, timeoutMs);

  if (!gammaMarketResponse.ok) {
    throw new Error(`Gamma API returned ${gammaMarketResponse.status} for market slug="${marketSlug}"`);
  }

  const gammaMarkets = (await gammaMarketResponse.json()) as Array<Record<string, unknown>>;

  if (!Array.isArray(gammaMarkets) || gammaMarkets.length === 0) {
    console.warn(`[DataPreparation] Gamma API returned no results for slug="${marketSlug}"`);
    return { markets: [], eventTitle: '' };
  }

  const gammaMarket = gammaMarkets[0];
  const events = gammaMarket.events as Array<Record<string, unknown>> | undefined;

  if (!events || events.length === 0) {
    // Standalone market with no parent event - no siblings
    return { markets: [], eventTitle: '' };
  }

  const eventSlug = events[0].slug as string | undefined;
  const eventTitle = (events[0].title as string) || '';

  if (!eventSlug) {
    console.warn(`[DataPreparation] Parent event exists but has no slug - cannot fetch siblings`);
    return { markets: [], eventTitle };
  }

  // Step 3: Get the event with all sibling markets from Gamma API
  const gammaEventUrl = `${GAMMA_API_URL}/events?slug=${eventSlug}`;
  const gammaEventResponse = await fetchWithTimeout(gammaEventUrl, timeoutMs);

  if (!gammaEventResponse.ok) {
    throw new Error(`Gamma API returned ${gammaEventResponse.status} for event slug="${eventSlug}"`);
  }

  const gammaEvents = (await gammaEventResponse.json()) as Array<Record<string, unknown>>;

  if (!Array.isArray(gammaEvents) || gammaEvents.length === 0) {
    console.warn(`[DataPreparation] Gamma API returned no results for event slug="${eventSlug}"`);
    return { markets: [], eventTitle };
  }

  const event = gammaEvents[0];
  const rawMarkets = (event.markets as Array<Record<string, unknown>>) || [];

  // Parse all sibling markets, excluding the target market itself
  const markets: RelatedMarket[] = [];
  for (const market of rawMarkets) {
    const marketConditionId =
      (market.conditionId as string) || (market.condition_id as string) || '';

    // Skip the target market
    if (marketConditionId === conditionId) {
      continue;
    }

    // Parse outcome prices (YES price is at index 0)
    const outcomePricesRaw = (market.outcomePrices as string) || (market.outcome_prices as string) || '[]';
    let probability = 0.5;
    try {
      const parsed = typeof outcomePricesRaw === 'string' ? JSON.parse(outcomePricesRaw) : outcomePricesRaw;
      if (Array.isArray(parsed) && parsed.length > 0) {
        probability = parseFloat(parsed[0]) || 0.5;
      }
    } catch {
      probability = 0.5;
    }

    markets.push({
      conditionId: marketConditionId,
      question: (market.groupItemTitle as string) || (market.question as string) || '',
      probability: Math.round(probability * 10000) / 10000,
      volume: Math.round((Number(market.volume) || 0) * 100) / 100,
      liquidity: Math.round((Number(market.liquidity) || 0) * 100) / 100,
      active: Boolean(market.active ?? true),
      endDate: (market.endDateIso as string) || (market.end_date_iso as string) || '',
    });
  }

  return { markets, eventTitle };
}

/**
 * Calculates aggregate metrics across related markets.
 */
export function calculateAggregateMetrics(markets: RelatedMarket[]): AggregateMetrics {
  if (markets.length === 0) {
    return {
      average_probability: 0.5,
      volume_weighted_probability: 0.5,
      sentiment_direction: 'neutral',
      total_volume: 0,
      total_liquidity: 0,
    };
  }

  const probabilities = markets.map((m) => m.probability);
  const volumes = markets.map((m) => m.volume);

  const averageProbability = probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
  const totalVolume = volumes.reduce((s, v) => s + v, 0);
  const totalLiquidity = markets.reduce((s, m) => s + m.liquidity, 0);

  let volumeWeightedProbability: number;
  if (totalVolume > 0) {
    volumeWeightedProbability =
      markets.reduce((sum, m) => sum + m.probability * m.volume, 0) / totalVolume;
  } else {
    volumeWeightedProbability = averageProbability;
  }

  let sentimentDirection: 'bullish' | 'bearish' | 'neutral';
  if (volumeWeightedProbability > 0.55) {
    sentimentDirection = 'bullish';
  } else if (volumeWeightedProbability < 0.45) {
    sentimentDirection = 'bearish';
  } else {
    sentimentDirection = 'neutral';
  }

  return {
    average_probability: Math.round(averageProbability * 10000) / 10000,
    volume_weighted_probability: Math.round(volumeWeightedProbability * 10000) / 10000,
    sentiment_direction: sentimentDirection,
    total_volume: Math.round(totalVolume * 100) / 100,
    total_liquidity: Math.round(totalLiquidity * 100) / 100,
  };
}

/**
 * Writes related markets data to a JSON file in /tmp.
 */
export async function writeRelatedMarketsJson(
  markets: RelatedMarket[],
  eventTitle: string,
  conditionId: string,
  marketId: string,
  aggregate: AggregateMetrics,
  siblingPriceFiles: Record<string, string> = {}
): Promise<string> {
  const filePath = `/tmp/related-markets-${marketId}.json`;

  const data = {
    event_title: eventTitle,
    target_condition_id: conditionId,
    total_related: markets.length,
    markets: markets.map((m) => ({
      condition_id: m.conditionId,
      question: m.question,
      probability: m.probability,
      volume: m.volume,
      liquidity: m.liquidity,
      active: m.active,
      end_date: m.endDate,
      price_history_csv: siblingPriceFiles[m.conditionId] || null,
    })),
    aggregate,
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/**
 * Generates a text summary of related markets for agent context.
 */
export function generateRelatedMarketsSummary(
  markets: RelatedMarket[],
  eventTitle: string,
  aggregate: AggregateMetrics
): string {
  if (markets.length === 0) {
    return 'No related markets found (single-market event or market not in an event).';
  }

  const lines = [
    `Related Markets Summary (Event: ${eventTitle})`,
    `  Sibling markets: ${markets.length}`,
    `  Aggregate sentiment: ${aggregate.sentiment_direction}`,
    `  Average probability: ${aggregate.average_probability.toFixed(4)}`,
    `  Volume-weighted probability: ${aggregate.volume_weighted_probability.toFixed(4)}`,
    `  Total volume across siblings: $${aggregate.total_volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `  Total liquidity across siblings: $${aggregate.total_liquidity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `  Top sibling markets:`,
  ];

  // Show top 5 by volume
  const sorted = [...markets].sort((a, b) => b.volume - a.volume).slice(0, 5);
  for (const m of sorted) {
    lines.push(
      `    - ${m.question.slice(0, 60)}: prob=${m.probability.toFixed(4)}, vol=$${m.volume.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    );
  }

  return lines.join('\n');
}

// ─── Sibling Price History ─────────────────────────────────────────────────────

/**
 * Fetches the token ID for a market from the CLOB API.
 */
export async function fetchTokenIdForMarket(conditionId: string): Promise<string | null> {
  const result = await fetchMarketInfo(conditionId);
  return result?.tokenId || null;
}

/**
 * Fetches market info (tokenId + question) from the CLOB API.
 * Used by the handler to resolve the briefing before calling prepareData.
 */
export async function fetchMarketInfo(conditionId: string): Promise<{ tokenId: string; question: string } | null> {
  try {
    const url = `${CLOB_API_URL}/markets/${conditionId}`;
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const tokens = data?.tokens as Array<{ token_id?: string }> | undefined;
    const tokenId = tokens && tokens.length > 0 ? (tokens[0].token_id || '') : '';
    const question = (data?.question as string) || '';
    return { tokenId, question };
  } catch {
    return null;
  }
}

/**
 * Fetches price history for a sibling market and writes to CSV.
 * Returns the CSV file path or null on failure.
 */
async function fetchSiblingPriceHistory(
  market: RelatedMarket,
  marketId: string,
  index: number
): Promise<{ conditionId: string; csvPath: string } | null> {
  try {
    const tokenId = await fetchTokenIdForMarket(market.conditionId);
    if (!tokenId) return null;

    const points = await fetchPriceHistory(tokenId, 60, FETCH_TIMEOUT_MS);
    if (points.length === 0) return null;

    const filePath = `/tmp/price-history-${marketId}-sibling-${index}.csv`;

    const lines: string[] = [];
    lines.push(`# Market: ${market.question}`);
    lines.push(`# Token ID: ${tokenId}`);
    lines.push(`# Data points: ${points.length}`);
    if (points.length > 0) {
      lines.push(`# Date range: ${points[0].datetimeUtc} to ${points[points.length - 1].datetimeUtc}`);
      const prices = points.map((p) => p.price);
      lines.push(`# Price range: ${Math.min(...prices).toFixed(4)} to ${Math.max(...prices).toFixed(4)}`);
    }
    lines.push('#');
    lines.push('timestamp,datetime_utc,price');
    for (const point of points) {
      lines.push(`${point.timestamp},${point.datetimeUtc},${point.price.toFixed(6)}`);
    }

    await writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
    return { conditionId: market.conditionId, csvPath: filePath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(
      `[DataPreparation] Failed to fetch price history for sibling ${market.conditionId.slice(0, 12)}: ${msg}`
    );
    return null;
  }
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Prepares all data files (price history CSV and related markets JSON) for the analysis workflow.
 *
 * This is the main entry point called by the handler. It:
 * 1. Fetches full price history from Polymarket CLOB API (60-min fidelity, 30s timeout)
 * 2. Writes CSV to /tmp with metadata comment lines
 * 3. Fetches up to 50 related sibling markets from Gamma API
 * 4. Calculates aggregate metrics (average_probability, volume_weighted_probability, sentiment_direction, total_volume, total_liquidity)
 * 5. Fetches price history for top 5 siblings by volume in parallel
 * 6. Writes related markets JSON to /tmp with aggregate metrics
 *
 * On failure: continues with empty data (logs warning, csv_path = empty string).
 */
export async function prepareData(briefing: MarketBriefing): Promise<DataPreparationResult> {
  const { marketId, conditionId, tokenId, question } = briefing;

  // ─── Fetch & Write Price History ─────────────────────────────────────────────
  let priceHistory: PriceHistoryResult;

  if (!tokenId) {
    console.warn('[DataPreparation] No token ID available - skipping price history fetch');
    priceHistory = {
      tokenId: '',
      points: [],
      csvPath: '',
      summary: 'Price history unavailable (no token ID).',
    };
  } else {
    try {
      console.log(`[DataPreparation] Fetching price history for token=${tokenId.slice(0, 16)}`);
      const points = await fetchPriceHistory(tokenId, 60, FETCH_TIMEOUT_MS);

      if (points.length === 0) {
        priceHistory = {
          tokenId,
          points: [],
          csvPath: '',
          summary: 'No price history data returned from API.',
        };
      } else {
        const csvPath = await writePriceHistoryCsv(points, tokenId, question, marketId);
        const summary = generatePriceSummary(points);
        console.log(`[DataPreparation] Price history ready: ${points.length} points, written to ${csvPath}`);
        priceHistory = { tokenId, points, csvPath, summary };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[DataPreparation] Failed to fetch price history: ${msg}`);
      priceHistory = {
        tokenId,
        points: [],
        csvPath: '',
        summary: 'Price history unavailable (fetch failed).',
      };
    }
  }

  // ─── Fetch & Write Related Markets ───────────────────────────────────────────
  let relatedMarkets: RelatedMarketsResult;

  if (!conditionId) {
    console.warn('[DataPreparation] No condition ID available - skipping related markets fetch');
    relatedMarkets = {
      eventTitle: '',
      targetConditionId: '',
      markets: [],
      jsonPath: '',
      summary: 'Related markets unavailable (no condition ID).',
      aggregate: calculateAggregateMetrics([]),
    };
  } else {
    try {
      console.log(`[DataPreparation] Fetching related markets for condition_id=${conditionId.slice(0, 16)}`);
      const { markets, eventTitle } = await fetchRelatedMarkets(conditionId, FETCH_TIMEOUT_MS);

      if (markets.length === 0) {
        const aggregate = calculateAggregateMetrics([]);
        relatedMarkets = {
          eventTitle,
          targetConditionId: conditionId,
          markets: [],
          jsonPath: '',
          summary: generateRelatedMarketsSummary([], eventTitle, aggregate),
          aggregate,
        };
      } else {
        const aggregate = calculateAggregateMetrics(markets);

        // Fetch price history for top 5 siblings by volume in parallel
        const topSiblings = [...markets].sort((a, b) => b.volume - a.volume).slice(0, 5);
        console.log(
          `[DataPreparation] Fetching price history for top ${topSiblings.length} siblings by volume`
        );

        const siblingResults = await Promise.all(
          topSiblings.map((m, i) => fetchSiblingPriceHistory(m, marketId, i))
        );

        // Build mapping of condition_id -> csv_path for successful fetches
        const siblingPriceFiles: Record<string, string> = {};
        for (const result of siblingResults) {
          if (result) {
            siblingPriceFiles[result.conditionId] = result.csvPath;
          }
        }

        console.log(
          `[DataPreparation] Fetched price history for ${Object.keys(siblingPriceFiles).length}/${topSiblings.length} sibling markets`
        );

        const jsonPath = await writeRelatedMarketsJson(
          markets,
          eventTitle,
          conditionId,
          marketId,
          aggregate,
          siblingPriceFiles
        );

        const summary = generateRelatedMarketsSummary(markets, eventTitle, aggregate);
        console.log(
          `[DataPreparation] Related markets ready: ${markets.length} siblings, written to ${jsonPath}`
        );

        relatedMarkets = {
          eventTitle,
          targetConditionId: conditionId,
          markets,
          jsonPath,
          summary,
          aggregate,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[DataPreparation] Failed to fetch related markets: ${msg}`);
      const aggregate = calculateAggregateMetrics([]);
      relatedMarkets = {
        eventTitle: '',
        targetConditionId: conditionId,
        markets: [],
        jsonPath: '',
        summary: 'Related markets unavailable (fetch failed).',
        aggregate,
      };
    }
  }

  return { priceHistory, relatedMarkets };
}
