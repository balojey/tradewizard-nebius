/**
 * News_Tool - Strands tool wrapping NewsData.io API
 *
 * Provides fetchLatestNews and fetchArchiveNews actions for news-focused
 * intelligence agents (breaking_news, media_sentiment, event_impact,
 * social_sentiment, narrative_velocity, catalyst_identification, tail_risk).
 *
 * Features:
 * - API key rotation via comma-separated NEWSDATA_API_KEY env var
 * - 15-second timeout per request
 * - Max 50 articles per request
 * - Per-agent call limit via NEWS_TOOL_MAX_CALLS env var (default: 5)
 * - In-memory result cache (shared across agents within single analysis)
 * - Structured error return (never throws)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';

// ============================================================================
// NewsArticle Interface
// ============================================================================

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: {
    id: string;
    name: string;
    priority: number;
  };
  content: {
    description?: string;
    fullContent?: string;
    keywords?: string[];
  };
  metadata: {
    publishedAt: string;
    language: string;
    countries?: string[];
    categories?: string[];
  };
  ai?: {
    sentiment?: 'positive' | 'negative' | 'neutral';
    sentimentStats?: {
      positive: number;
      negative: number;
      neutral: number;
    };
    tags?: string[];
    summary?: string;
  };
}

// ============================================================================
// API Key Rotation
// ============================================================================

/**
 * API key rotator for handling rate-limited keys.
 *
 * Reads comma-separated keys from NEWSDATA_API_KEY env var.
 * On HTTP 429, rotates to the next key without counting as a retry.
 * Cycles through all N keys before repeating.
 */
export class ApiKeyRotator {
  private keys: string[];
  private currentIndex: number;

  constructor(envValue: string) {
    this.keys = envValue
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (this.keys.length === 0) {
      this.keys = [''];
    }

    this.currentIndex = 0;
  }

  /** Get the current active API key */
  getCurrentKey(): string {
    return this.keys[this.currentIndex];
  }

  /** Rotate to the next key. Returns false if we've cycled through all keys. */
  rotate(): boolean {
    const startIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    // If we've cycled back to the start, all keys have been tried
    return this.currentIndex !== startIndex;
  }

  /** Get number of available keys */
  get keyCount(): number {
    return this.keys.length;
  }

  /** Reset rotation to the starting index */
  reset(): void {
    this.currentIndex = 0;
  }
}

// Module-level rotator (cached per container lifetime)
let keyRotator: ApiKeyRotator | null = null;

function getKeyRotator(): ApiKeyRotator {
  if (!keyRotator) {
    keyRotator = new ApiKeyRotator(process.env.NEWSDATA_API_KEY || '');
  }
  return keyRotator;
}

// ============================================================================
// Transform Function
// ============================================================================

/**
 * Transform a raw NewsData.io API article object into a structured NewsArticle.
 *
 * Maps API response fields to the NewsArticle interface:
 * - article_id → id
 * - title → title
 * - link → url
 * - source_id → source.id
 * - source_name → source.name
 * - source_priority → source.priority
 * - description → content.description
 * - content → content.fullContent
 * - keywords → content.keywords
 * - pubDate → metadata.publishedAt
 * - language → metadata.language
 * - country → metadata.countries
 * - category → metadata.categories
 * - sentiment → ai.sentiment
 * - sentiment_stats → ai.sentimentStats
 * - ai_tag → ai.tags
 * - ai_summary → ai.summary
 *
 * Requirement: 6.5
 */
export function transformArticle(article: Record<string, unknown>): NewsArticle {
  const transformed: NewsArticle = {
    id: String(article.article_id ?? ''),
    title: String(article.title ?? ''),
    url: String(article.link ?? ''),
    source: {
      id: String(article.source_id ?? ''),
      name: String(article.source_name ?? ''),
      priority: typeof article.source_priority === 'number' ? article.source_priority : 0,
    },
    content: {
      description: article.description != null ? String(article.description) : undefined,
      fullContent: article.content != null ? String(article.content) : undefined,
      keywords: Array.isArray(article.keywords) ? article.keywords as string[] : undefined,
    },
    metadata: {
      publishedAt: String(article.pubDate ?? ''),
      language: String(article.language ?? ''),
      countries: Array.isArray(article.country) ? article.country as string[] : undefined,
      categories: Array.isArray(article.category) ? article.category as string[] : undefined,
    },
  };

  // Add AI-enhanced fields only if any are present
  const hasSentiment = article.sentiment != null;
  const hasSentimentStats = article.sentiment_stats != null;
  const hasAiTags = Array.isArray(article.ai_tag);
  const hasAiSummary = article.ai_summary != null;

  if (hasSentiment || hasSentimentStats || hasAiTags || hasAiSummary) {
    transformed.ai = {};
    if (hasSentiment) {
      transformed.ai.sentiment = article.sentiment as 'positive' | 'negative' | 'neutral';
    }
    if (hasSentimentStats && typeof article.sentiment_stats === 'object') {
      const stats = article.sentiment_stats as Record<string, number>;
      transformed.ai.sentimentStats = {
        positive: stats.positive ?? 0,
        negative: stats.negative ?? 0,
        neutral: stats.neutral ?? 0,
      };
    }
    if (hasAiTags) {
      transformed.ai.tags = article.ai_tag as string[];
    }
    if (hasAiSummary) {
      transformed.ai.summary = String(article.ai_summary);
    }
  }

  return transformed;
}

// ============================================================================
// HTTP Request Helper
// ============================================================================

const NEWSDATA_BASE_URL = 'https://newsdata.io/api/1';
const REQUEST_TIMEOUT_MS = 15_000; // 15-second timeout per request
const MAX_ARTICLES = 50;

interface NewsDataApiResponse {
  status: 'success' | 'error';
  totalResults?: number;
  results?: Array<Record<string, unknown>>;
  nextPage?: string;
  code?: string;
  message?: string;
}

/**
 * Make a request to the NewsData.io API with timeout and key rotation.
 *
 * On HTTP 429, rotates to the next API key and retries.
 * Key rotation does NOT count as a retry attempt.
 * Max 3 actual retries for non-429 transient errors.
 *
 * Requirements: 6.6, 6.9
 */
async function makeNewsDataRequest(
  endpoint: string,
  params: Record<string, string | number | boolean>,
): Promise<NewsDataApiResponse> {
  const rotator = getKeyRotator();
  let keysAttempted = 0;
  const maxKeyAttempts = rotator.keyCount;

  while (keysAttempted < maxKeyAttempts) {
    const apiKey = rotator.getCurrentKey();
    if (!apiKey) {
      return {
        status: 'error',
        code: 'NO_API_KEY',
        message: 'NEWSDATA_API_KEY environment variable is not configured',
      };
    }

    const url = new URL(`${NEWSDATA_BASE_URL}/${endpoint}`);
    url.searchParams.set('apikey', apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TradeWizard-AnalysisLambda/2.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting - rotate key and retry (doesn't count as retry)
      if (response.status === 429) {
        console.warn(
          `[News_Tool] HTTP 429 rate limit on key ${apiKey.substring(0, 6)}..., rotating`,
        );
        const hasMore = rotator.rotate();
        keysAttempted++;
        if (!hasMore || keysAttempted >= maxKeyAttempts) {
          return {
            status: 'error',
            code: 'RATE_LIMIT_ALL_KEYS',
            message: 'All NewsData.io API keys are rate-limited',
          };
        }
        continue;
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorMessage = `NewsData.io API returned HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) errorMessage = errorJson.message;
        } catch {
          // keep default error message
        }
        return {
          status: 'error',
          code: `HTTP_${response.status}`,
          message: errorMessage,
        };
      }

      // Parse successful response
      const data = (await response.json()) as NewsDataApiResponse;

      if (data.status === 'error') {
        return {
          status: 'error',
          code: data.code || 'API_ERROR',
          message: data.message || 'NewsData.io API returned an error',
        };
      }

      return data;
    } catch (error: unknown) {
      // Handle timeout / abort
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          status: 'error',
          code: 'TIMEOUT',
          message: 'NewsData.io request timed out after 15 seconds',
        };
      }

      // Network or other fetch error
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: `NewsData.io request failed: ${message}`,
      };
    }
  }

  // Should not reach here, but safety fallback
  return {
    status: 'error',
    code: 'RATE_LIMIT_ALL_KEYS',
    message: 'All NewsData.io API keys are rate-limited',
  };
}

// ============================================================================
// Call Limiting
// ============================================================================

const NEWS_TOOL_MAX_CALLS = parseInt(process.env.NEWS_TOOL_MAX_CALLS || '5', 10);
let newsToolCallCount = 0;

/**
 * Reset the news tool call counter.
 * Called before each agent execution to give each agent a fresh budget.
 */
export function resetNewsToolCallCount(): void {
  newsToolCallCount = 0;
}

// ============================================================================
// In-Memory Result Cache (per-analysis execution)
// ============================================================================

/**
 * Caches tool results by serialized input arguments within a single Lambda
 * invocation. When agents run sequentially, subsequent agents making the same
 * news query get the cached result instantly - saving API calls and latency.
 *
 * The cache is automatically cleared between Lambda invocations (cold start
 * creates a new module scope). Call resetNewsToolCache() at analysis start
 * for warm-container safety.
 */
const newsResultCache = new Map<string, JSONValue>();

/** Reset the news tool result cache. Call at the start of each analysis. */
export function resetNewsToolCache(): void {
  newsResultCache.clear();
}

/** Build a deterministic cache key from tool input. */
function buildNewsCacheKey(input: Record<string, unknown>): string {
  // Sort keys for determinism, stringify
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const val = input[key];
      // Normalize undefined/null/empty to omit from key
      if (val === undefined || val === null || val === '') return acc;
      acc[key] = val;
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// ============================================================================
// Strands Tool Definition
// ============================================================================

/**
 * News_Tool - Strands tool for fetching news from NewsData.io
 *
 * Supports two actions:
 * - fetchLatestNews: Fetch recent articles within a time window (1h to 48h)
 * - fetchArchiveNews: Fetch historical articles within a date range
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */
export const newsTool = tool({
  name: 'news_search',
  description: `Search for news articles using NewsData.io. Supports two actions:

1. fetchLatestNews - Fetch recent articles within a time window (1h to 48h).
   Parameters: action="fetchLatestNews", query, queryInTitle, timeframe, countries, categories, languages, sentiment, size, removeDuplicates

2. fetchArchiveNews - Fetch historical articles within a specific date range.
   Parameters: action="fetchArchiveNews", fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD), query, queryInTitle, countries, categories, languages, size, removeDuplicates

Returns an array of news articles with title, url, source, content, and metadata. Returns an error object if the request fails.

Examples:
- Breaking news: { action: "fetchLatestNews", queryInTitle: "election", timeframe: "1h" }
- Recent market news: { action: "fetchLatestNews", query: "Federal Reserve", timeframe: "24h", categories: ["business"] }
- Historical: { action: "fetchArchiveNews", fromDate: "2024-01-01", toDate: "2024-01-15", query: "policy" }`,
  inputSchema: z.object({
    action: z
      .enum(['fetchLatestNews', 'fetchArchiveNews'])
      .describe('The type of news search to perform'),
    // Common parameters
    query: z.string().optional().describe('Search query for article content'),
    queryInTitle: z.string().optional().describe('Search query for article titles only'),
    countries: z
      .array(z.string())
      .optional()
      .describe('ISO country codes to filter (e.g., ["us", "uk"])'),
    categories: z
      .array(
        z.enum([
          'business',
          'entertainment',
          'environment',
          'food',
          'health',
          'politics',
          'science',
          'sports',
          'technology',
          'top',
          'tourism',
          'world',
        ]),
      )
      .optional()
      .describe('News categories to filter'),
    languages: z
      .array(z.string())
      .optional()
      .describe('Language codes (default: ["en"])'),
    size: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Number of articles to return (1-50, default 20)'),
    removeDuplicates: z
      .boolean()
      .optional()
      .describe('Remove duplicate articles (default true)'),
    // fetchLatestNews-specific
    timeframe: z
      .enum(['1h', '6h', '12h', '24h', '48h'])
      .optional()
      .describe('Time window for latest news (default 24h)'),
    sentiment: z
      .enum(['positive', 'negative', 'neutral'])
      .optional()
      .describe('Filter by article sentiment'),
    // fetchArchiveNews-specific
    fromDate: z
      .string()
      .optional()
      .describe('Start date for archive search (YYYY-MM-DD, required for fetchArchiveNews)'),
    toDate: z
      .string()
      .optional()
      .describe('End date for archive search (YYYY-MM-DD, required for fetchArchiveNews)'),
  }),
  callback: async (input): Promise<JSONValue> => {
    // Check cache first - same query from a different agent gets free result
    const cacheKey = buildNewsCacheKey(input as unknown as Record<string, unknown>);
    const cached = newsResultCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`[News_Tool] Cache HIT for: ${input.action} (${input.query || input.queryInTitle || 'no query'})`);
      return cached;
    }

    // Enforce per-agent call limit
    newsToolCallCount++;
    if (newsToolCallCount > NEWS_TOOL_MAX_CALLS) {
      return {
        error: true,
        toolName: 'news_search',
        message: `News tool call limit reached (${NEWS_TOOL_MAX_CALLS} max). Proceed with the information you already have.`,
      };
    }

    try {
      let result: JSONValue;
      if (input.action === 'fetchLatestNews') {
        result = await handleFetchLatestNews(input);
      } else if (input.action === 'fetchArchiveNews') {
        result = await handleFetchArchiveNews(input);
      } else {
        result = {
          error: true,
          toolName: 'news_search',
          message: `Unknown action: ${input.action}`,
        };
      }

      // Cache successful results (don't cache errors)
      const isError = typeof result === 'object' && result !== null && (result as Record<string, unknown>).error === true;
      if (!isError) {
        newsResultCache.set(cacheKey, result);
        console.log(`[News_Tool] Cache STORE for: ${input.action} (${input.query || input.queryInTitle || 'no query'})`);
      }

      return result;
    } catch (error: unknown) {
      // Safety catch - should never throw, but belt and suspenders
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: true,
        toolName: 'news_search',
        message: `Unexpected error: ${message}`,
      };
    }
  },
});

// ============================================================================
// Action Handlers
// ============================================================================

export async function handleFetchLatestNews(input: {
  query?: string;
  queryInTitle?: string;
  timeframe?: string;
  countries?: string[];
  categories?: string[];
  languages?: string[];
  sentiment?: string;
  size?: number;
  removeDuplicates?: boolean;
}): Promise<JSONValue> {
  const params: Record<string, string | number | boolean> = {};

  // Build API parameters
  if (input.query) params.q = input.query;
  if (input.queryInTitle) params.qInTitle = input.queryInTitle;

  // NOTE: timeframe parameter is NOT supported on free/basic plans
  // Omitting it - the API will return the most recent articles available

  if (input.countries && input.countries.length > 0) {
    // Only send single country - free/basic plans may not support multi-country filtering
    params.country = input.countries[0];
  }
  // Only send single category - free/basic plans don't support multi-category filtering
  if (input.categories && input.categories.length > 0) {
    params.category = input.categories[0];
  }
  if (input.languages && input.languages.length > 0) {
    params.language = input.languages.join(',');
  } else {
    params.language = 'en';
  }
  // NOTE: sentiment filter is NOT available on free plans - skip it
  // if (input.sentiment) params.sentiment = input.sentiment;

  // NOTE: On free plan, size is capped at 10. Don't send size > 10.
  const size = Math.min(input.size ?? 10, 10);
  params.size = size;

  // Make API request
  const response = await makeNewsDataRequest('latest', params);

  // Handle API errors
  if (response.status === 'error') {
    return {
      error: true,
      toolName: 'news_search',
      message: response.message || 'NewsData.io API error',
    };
  }

  // Handle empty results (Requirement 6.8)
  if (!response.results || response.results.length === 0) {
    return {
      totalResults: 0,
      articles: [],
    };
  }

  // Transform and return articles (Requirement 6.5, 6.7)
  const articles = response.results
    .slice(0, MAX_ARTICLES)
    .map(transformArticle);

  return {
    totalResults: response.totalResults ?? articles.length,
    articles: articles as unknown as JSONValue,
  };
}

export async function handleFetchArchiveNews(input: {
  fromDate?: string;
  toDate?: string;
  query?: string;
  queryInTitle?: string;
  countries?: string[];
  categories?: string[];
  languages?: string[];
  size?: number;
  removeDuplicates?: boolean;
}): Promise<JSONValue> {
  // Validate required date parameters
  if (!input.fromDate || !input.toDate) {
    return {
      error: true,
      toolName: 'news_search',
      message: 'fetchArchiveNews requires both fromDate and toDate parameters (YYYY-MM-DD)',
    };
  }

  const params: Record<string, string | number | boolean> = {};

  // Date range
  params.from_date = input.fromDate;
  params.to_date = input.toDate;

  // Build API parameters
  if (input.query) params.q = input.query;
  if (input.queryInTitle) params.qInTitle = input.queryInTitle;

  if (input.countries && input.countries.length > 0) {
    params.country = input.countries[0];
  }
  // Only send single category - free/basic plans don't support multi-category filtering
  if (input.categories && input.categories.length > 0) {
    params.category = input.categories[0];
  }
  if (input.languages && input.languages.length > 0) {
    params.language = input.languages.join(',');
  }

  const size = Math.min(input.size ?? 20, MAX_ARTICLES);
  params.size = size;

  // Make API request
  const response = await makeNewsDataRequest('archive', params);

  // Handle API errors
  if (response.status === 'error') {
    return {
      error: true,
      toolName: 'news_search',
      message: response.message || 'NewsData.io API error',
    };
  }

  // Handle empty results (Requirement 6.8)
  if (!response.results || response.results.length === 0) {
    return {
      totalResults: 0,
      articles: [],
    };
  }

  // Transform and return articles (Requirement 6.5, 6.7)
  const articles = response.results
    .slice(0, MAX_ARTICLES)
    .map(transformArticle);

  return {
    totalResults: response.totalResults ?? articles.length,
    articles: articles as unknown as JSONValue,
  };
}
