/**
 * Search_Tool - Strands tool wrapping Serper API for web search and page scraping.
 *
 * Supports two actions:
 * - search: Google web search via Serper /search endpoint
 * - scrape: Page content extraction via Serper /scrape endpoint
 *
 * Features:
 * - API key rotation via comma-separated SERPER_API_KEY env var
 * - 30-second timeout per request
 * - Max 3 retries for non-blocking errors (key rotation on 429 doesn't count)
 * - In-memory result cache (shared across agents within single analysis)
 * - Structured error responses - never throws
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const SERPER_SCRAPE_URL = 'https://scrape.serper.dev';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

// ============================================================================
// API Key Rotation
// ============================================================================

interface KeyState {
  key: string;
  isRateLimited: boolean;
  rateLimitExpiry: number | null;
}

/**
 * Manages API key rotation for Serper.
 * Cycles through comma-separated keys when 429 is encountered.
 */
class ApiKeyRotator {
  private keys: KeyState[];
  private currentIndex: number;

  constructor(apiKeyEnv: string) {
    const rawKeys = apiKeyEnv
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (rawKeys.length === 0) {
      throw new Error('SERPER_API_KEY env var is empty or not set');
    }

    this.keys = rawKeys.map((key) => ({
      key,
      isRateLimited: false,
      rateLimitExpiry: null,
    }));
    this.currentIndex = 0;
  }

  /** Get the current available key, or null if all are rate-limited. */
  getCurrentKey(): string | null {
    const now = Date.now();

    // Try from current index, cycling through all keys once
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const state = this.keys[idx];

      // Auto-expire rate limits
      if (state.isRateLimited && state.rateLimitExpiry && state.rateLimitExpiry <= now) {
        state.isRateLimited = false;
        state.rateLimitExpiry = null;
      }

      if (!state.isRateLimited) {
        this.currentIndex = idx;
        return state.key;
      }
    }

    return null;
  }

  /** Mark the current key as rate-limited and rotate to the next available key. */
  rotateOnRateLimit(): string | null {
    const state = this.keys[this.currentIndex];
    state.isRateLimited = true;
    // Default 15-minute expiry
    state.rateLimitExpiry = Date.now() + 900_000;

    // Move to next
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return this.getCurrentKey();
  }

  get keyCount(): number {
    return this.keys.length;
  }
}

// Module-level rotator - cached across invocations in the same Lambda container
let cachedRotator: ApiKeyRotator | null = null;

function getRotator(): ApiKeyRotator {
  if (!cachedRotator) {
    const envKey = process.env.SERPER_API_KEY || '';
    cachedRotator = new ApiKeyRotator(envKey);
  }
  return cachedRotator;
}

// ============================================================================
// HTTP Helpers
// ============================================================================

/**
 * Make a single HTTP request to the Serper API with timeout.
 * Returns the response or throws on network/timeout errors.
 */
async function fetchWithTimeout(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute a Serper API request with retry logic and key rotation.
 *
 * - 429 responses trigger key rotation without counting as a retry
 * - Network errors and 5xx trigger exponential backoff retries (max 3)
 * - Returns parsed JSON on success
 * - Returns structured error on failure (never throws)
 */
async function executeSerperRequest(
  url: string,
  body: Record<string, unknown>,
  action: 'search' | 'scrape',
): Promise<{ success: true; data: unknown } | { success: false; error: string }> {
  const rotator = getRotator();
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    const apiKey = rotator.getCurrentKey();
    if (!apiKey) {
      return {
        success: false,
        error: `All Serper API keys are rate-limited for ${action} request`,
      };
    }

    try {
      const response = await fetchWithTimeout(url, apiKey, body);

      // Handle rate limit - rotate key, don't count as retry
      if (response.status === 429) {
        const nextKey = rotator.rotateOnRateLimit();
        if (!nextKey) {
          return {
            success: false,
            error: `All Serper API keys are rate-limited for ${action} request`,
          };
        }
        // Continue loop without incrementing retryCount
        continue;
      }

      // Success
      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      }

      // Non-recoverable client errors (auth issues)
      if (response.status >= 400 && response.status < 500) {
        return {
          success: false,
          error: `Serper API ${action} failed with HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Server errors (5xx) - retry with backoff
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
      }
    } catch (err) {
      // Network or timeout error
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          error: `Serper API ${action} request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`,
        };
      }

      retryCount++;
      if (retryCount < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
      } else {
        return {
          success: false,
          error: `Serper API ${action} request failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  return {
    success: false,
    error: `Serper API ${action} request failed after ${MAX_RETRIES} retry attempts`,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Per-Agent Call Count Limiting
// ============================================================================

const SEARCH_TOOL_MAX_CALLS = parseInt(process.env.SEARCH_TOOL_MAX_CALLS || '10', 10);
let searchToolCallCount = 0;

/**
 * Reset the search tool call counter.
 * Called before each agent execution to give each agent a fresh budget.
 */
export function resetSearchToolCallCount(): void {
  searchToolCallCount = 0;
}

// ============================================================================
// In-Memory Result Cache (per-analysis execution)
// ============================================================================

/**
 * Caches search/scrape results by serialized input arguments within a single
 * Lambda invocation. When agents run sequentially, subsequent agents making the
 * same search query or scraping the same URL get the cached result instantly -
 * saving Serper API credits and latency.
 *
 * The cache is automatically cleared between Lambda invocations (cold start
 * creates a new module scope). Call resetSearchToolCache() at analysis start
 * for warm-container safety.
 */
const searchResultCache = new Map<string, JSONValue>();

/** Reset the search tool result cache. Call at the start of each analysis. */
export function resetSearchToolCache(): void {
  searchResultCache.clear();
}

/** Build a deterministic cache key from tool input. */
function buildSearchCacheKey(input: Record<string, unknown>): string {
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const val = input[key];
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
 * Strands tool: search_web
 *
 * Provides web search and page scraping capabilities via Serper API.
 * Supports two actions:
 *   - "search": Google web search returning organic results
 *   - "scrape": Extract text content from a URL
 */
export const searchTool = tool({
  name: 'search_web',
  description:
    'Search the web or scrape a webpage. Use action "search" with a query to find information, or action "scrape" with a URL to extract page content. Returns organic search results (title, url, snippet, position) for search, or page title and text for scrape.',
  inputSchema: z.object({
    action: z
      .enum(['search', 'scrape'])
      .describe('The action to perform: "search" for web search, "scrape" for page content extraction'),
    query: z
      .string()
      .optional()
      .describe('Search query string (required for action "search")'),
    url: z
      .string()
      .optional()
      .describe('URL to scrape (required for action "scrape")'),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Number of search results to return (1-20, default 10). Only used with action "search"'),
    timeRange: z
      .enum(['hour', 'day', 'week', 'month', 'year'])
      .optional()
      .describe('Time range filter for search results. Only used with action "search"'),
    country: z
      .string()
      .length(2)
      .optional()
      .describe('ISO 3166-1 alpha-2 country code for search localization (e.g., "us", "gb"). Only used with action "search"'),
  }),
  callback: async (input): Promise<JSONValue> => {
    // Enforce per-agent call limit
    searchToolCallCount++;
    if (searchToolCallCount > SEARCH_TOOL_MAX_CALLS) {
      return {
        error: true,
        toolName: 'search_web',
        message: `Search tool call limit reached (${SEARCH_TOOL_MAX_CALLS} max). Proceed with the information you already have.`,
      };
    }

    // Check cache first - same query/URL from a different agent gets free result
    const cacheKey = buildSearchCacheKey(input as unknown as Record<string, unknown>);
    const cached = searchResultCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`[Search_Tool] Cache HIT for: ${input.action} (${input.query || input.url || 'no query'})`);
      return cached;
    }

    try {
      let result: JSONValue;
      if (input.action === 'search') {
        result = await handleSearch(input);
      } else {
        result = await handleScrape(input);
      }

      // Cache successful results (don't cache errors)
      const isError = typeof result === 'object' && result !== null && (result as Record<string, unknown>).error === true;
      if (!isError) {
        searchResultCache.set(cacheKey, result);
        console.log(`[Search_Tool] Cache STORE for: ${input.action} (${input.query || input.url || 'no query'})`);
      }

      return result;
    } catch (err) {
      // Safety net - should not be reached due to internal error handling,
      // but ensures the tool NEVER throws
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: true,
        toolName: 'search_web',
        message: `Unexpected error: ${message}`,
      };
    }
  },
});

// ============================================================================
// Action Handlers
// ============================================================================

export async function handleSearch(input: {
  query?: string;
  numResults?: number;
  timeRange?: string;
  country?: string;
}): Promise<JSONValue> {
  if (!input.query || input.query.trim().length === 0) {
    return {
      error: true,
      toolName: 'search_web',
      message: 'Parameter "query" is required for action "search"',
    };
  }

  const numResults = input.numResults ?? 10;

  // Build request body
  const body: Record<string, unknown> = {
    q: input.query,
    num: numResults,
  };

  // Map time range to Serper tbs format
  if (input.timeRange) {
    const timeRangeMap: Record<string, string> = {
      hour: 'qdr:h',
      day: 'qdr:d',
      week: 'qdr:w',
      month: 'qdr:m',
      year: 'qdr:y',
    };
    body.tbs = timeRangeMap[input.timeRange];
  }

  // Add country filter
  if (input.country) {
    body.gl = input.country.toLowerCase();
  }

  const result = await executeSerperRequest(SERPER_SEARCH_URL, body, 'search');

  if (!result.success) {
    return {
      error: true,
      toolName: 'search_web',
      message: result.error,
    };
  }

  const data = result.data as Record<string, unknown>;
  const organic = (data.organic as Array<Record<string, unknown>>) || [];

  // Map to structured results
  const results = organic.map((item) => ({
    title: (item.title as string) || '',
    url: (item.link as string) || '',
    snippet: (item.snippet as string) || '',
    position: (item.position as number) || 0,
  }));

  return {
    success: true,
    action: 'search',
    query: input.query,
    resultCount: results.length,
    results,
  };
}

export async function handleScrape(input: { url?: string }): Promise<JSONValue> {
  if (!input.url || input.url.trim().length === 0) {
    return {
      error: true,
      toolName: 'search_web',
      message: 'Parameter "url" is required for action "scrape"',
    };
  }

  const body: Record<string, unknown> = {
    url: input.url,
  };

  const result = await executeSerperRequest(SERPER_SCRAPE_URL, body, 'scrape');

  if (!result.success) {
    return {
      error: true,
      toolName: 'search_web',
      message: result.error,
    };
  }

  const data = result.data as Record<string, unknown>;

  return {
    success: true,
    action: 'scrape',
    url: input.url,
    title: (data.title as string) || '',
    text: (data.text as string) || '',
  };
}
