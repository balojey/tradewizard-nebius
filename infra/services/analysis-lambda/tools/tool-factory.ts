/**
 * Tool Factory - Creates per-agent tool instances with isolated call counters.
 *
 * When agents run in parallel, each agent needs its own call budget (e.g., max 5
 * news calls, max 10 search calls, max 15 shell calls). However, the result caches
 * are shared - if two parallel agents make the same news query, the second one
 * gets a cache hit. This is safe because Node.js is single-threaded (no race conditions
 * on Map operations).
 *
 * This factory creates fresh tool instances that:
 * - Have their own call counters (isolated per agent)
 * - Share the module-level result caches (for deduplication benefit)
 * - Share the module-level API key rotators (for key rotation across agents)
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import { exec } from 'child_process';

// Re-export the original tools and their reset/cache functions for backward compatibility
export { newsTool, resetNewsToolCallCount, resetNewsToolCache } from './news-tool';
export { searchTool, resetSearchToolCallCount, resetSearchToolCache } from './search-tool';
export { shellAnalysisTool, resetShellToolCallCount } from './shell-tool';

// ============================================================================
// Per-Agent Shell Tool Factory
// ============================================================================

const SHELL_TIMEOUT_MS = 30_000;
const WORKING_DIRECTORY = '/tmp';
const SHELL_TOOL_MAX_CALLS = parseInt(process.env.SHELL_TOOL_MAX_CALLS || '15', 10);

/**
 * Creates a shell analysis tool instance with its own isolated call counter.
 * Each parallel agent gets its own budget of SHELL_TOOL_MAX_CALLS.
 */
export function createShellTool(agentName: string) {
  let callCount = 0;

  return tool({
    name: 'shell_analysis',
    description:
      'Execute a shell command in the /tmp working directory for data analysis. ' +
      'Use this to analyze price history CSV files and related markets JSON files. ' +
      'Available utilities: awk, sed, grep, sort, head, tail, wc, bc. ' +
      'NOTE: python3 is NOT available - use awk for calculations (statistics, moving averages, etc). ' +
      'Commands have a 30-second timeout.',
    inputSchema: z.object({
      command: z
        .string()
        .describe('The shell command to execute in /tmp working directory'),
    }),
    callback: async (input): Promise<JSONValue> => {
      callCount++;
      if (callCount > SHELL_TOOL_MAX_CALLS) {
        return {
          error: true,
          toolName: 'shell_analysis',
          message: `Shell tool call limit reached (${SHELL_TOOL_MAX_CALLS} max). Produce your signal with the data you already have.`,
        } as JSONValue;
      }

      try {
        const result = await executeShellCommand(input.command);
        return result as JSONValue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: true,
          toolName: 'shell_analysis',
          message,
        } as JSONValue;
      }
    },
  });
}

// ============================================================================
// Per-Agent News Tool Factory
// ============================================================================

const NEWS_TOOL_MAX_CALLS = parseInt(process.env.NEWS_TOOL_MAX_CALLS || '5', 10);

// Shared result cache across all agents (deduplication benefit)
const sharedNewsCache = new Map<string, JSONValue>();

/** Reset the shared news cache. Call at the start of each analysis. */
export function resetSharedNewsCache(): void {
  sharedNewsCache.clear();
}

/**
 * Creates a news search tool instance with its own isolated call counter.
 * Each parallel agent gets its own budget of NEWS_TOOL_MAX_CALLS.
 * Result cache is shared across agents for deduplication.
 */
export function createNewsTool(agentName: string) {
  let callCount = 0;

  // Import the actual news fetching logic from the news-tool module
  // We use dynamic import pattern to avoid circular dependencies
  const { handleNewsRequest } = getNewsHandler();

  return tool({
    name: 'news_search',
    description:
      'Search for news articles about a topic. Use action "fetchLatestNews" to get recent articles, or "fetchArchiveNews" to search historical articles within a date range.',
    inputSchema: z.object({
      action: z
        .enum(['fetchLatestNews', 'fetchArchiveNews'])
        .describe('The action to perform'),
      query: z
        .string()
        .optional()
        .describe('Search query string (searches article content)'),
      queryInTitle: z
        .string()
        .optional()
        .describe('Search only in article titles (more specific than query)'),
      category: z
        .string()
        .optional()
        .describe('News category filter (e.g., politics, business, technology, science, sports)'),
      language: z
        .string()
        .optional()
        .describe('Language filter (ISO 639-1 code, default "en")'),
      timeWindow: z
        .enum(['1h', '6h', '12h', '24h', '48h'])
        .optional()
        .describe('Time window for latest news (default 24h)'),
      sentiment: z
        .enum(['positive', 'negative', 'neutral'])
        .optional()
        .describe('Filter by article sentiment'),
      fromDate: z
        .string()
        .optional()
        .describe('Start date for archive search (YYYY-MM-DD)'),
      toDate: z
        .string()
        .optional()
        .describe('End date for archive search (YYYY-MM-DD)'),
    }),
    callback: async (input): Promise<JSONValue> => {
      // Check shared cache first
      const cacheKey = buildCacheKey(input as unknown as Record<string, unknown>);
      const cached = sharedNewsCache.get(cacheKey);
      if (cached !== undefined) {
        console.log(`[News_Tool:${agentName}] Cache HIT`);
        return cached;
      }

      // Enforce per-agent call limit
      callCount++;
      if (callCount > NEWS_TOOL_MAX_CALLS) {
        return {
          error: true,
          toolName: 'news_search',
          message: `News tool call limit reached (${NEWS_TOOL_MAX_CALLS} max). Proceed with the information you already have.`,
        };
      }

      try {
        const result = await handleNewsRequest(input);

        // Cache successful results
        const isError = typeof result === 'object' && result !== null && (result as Record<string, unknown>).error === true;
        if (!isError) {
          sharedNewsCache.set(cacheKey, result);
        }

        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          error: true,
          toolName: 'news_search',
          message: `News search failed: ${message}`,
        };
      }
    },
  });
}

// ============================================================================
// Per-Agent Search Tool Factory
// ============================================================================

const SEARCH_TOOL_MAX_CALLS = parseInt(process.env.SEARCH_TOOL_MAX_CALLS || '10', 10);

// Shared result cache across all agents (deduplication benefit)
const sharedSearchCache = new Map<string, JSONValue>();

/** Reset the shared search cache. Call at the start of each analysis. */
export function resetSharedSearchCache(): void {
  sharedSearchCache.clear();
}

/**
 * Creates a web search tool instance with its own isolated call counter.
 * Each parallel agent gets its own budget of SEARCH_TOOL_MAX_CALLS.
 * Result cache is shared across agents for deduplication.
 */
export function createSearchTool(agentName: string) {
  let callCount = 0;

  const { handleSearchRequest } = getSearchHandler();

  return tool({
    name: 'search_web',
    description:
      'Search the web or scrape a webpage. Use action "search" with a query to find information, or action "scrape" with a URL to extract page content.',
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
        .describe('Number of search results to return (1-20, default 10)'),
      timeRange: z
        .enum(['hour', 'day', 'week', 'month', 'year'])
        .optional()
        .describe('Time range filter for search results'),
      country: z
        .string()
        .length(2)
        .optional()
        .describe('ISO 3166-1 alpha-2 country code (e.g., "us", "gb")'),
    }),
    callback: async (input): Promise<JSONValue> => {
      // Check shared cache first
      const cacheKey = buildCacheKey(input as unknown as Record<string, unknown>);
      const cached = sharedSearchCache.get(cacheKey);
      if (cached !== undefined) {
        console.log(`[Search_Tool:${agentName}] Cache HIT`);
        return cached;
      }

      // Enforce per-agent call limit
      callCount++;
      if (callCount > SEARCH_TOOL_MAX_CALLS) {
        return {
          error: true,
          toolName: 'search_web',
          message: `Search tool call limit reached (${SEARCH_TOOL_MAX_CALLS} max). Proceed with the information you already have.`,
        };
      }

      try {
        const result = await handleSearchRequest(input);

        // Cache successful results
        const isError = typeof result === 'object' && result !== null && (result as Record<string, unknown>).error === true;
        if (!isError) {
          sharedSearchCache.set(cacheKey, result);
        }

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          error: true,
          toolName: 'search_web',
          message: `Unexpected error: ${message}`,
        };
      }
    },
  });
}

// ============================================================================
// Shared Helpers
// ============================================================================

/** Build a deterministic cache key from tool input. */
function buildCacheKey(input: Record<string, unknown>): string {
  const sorted = Object.keys(input)
    .sort()
    .reduce((acc: Record<string, unknown>, key) => {
      const val = input[key];
      if (val === undefined || val === null || val === '') return acc;
      acc[key] = val;
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

/** Execute a shell command in /tmp with 30s timeout. */
function executeShellCommand(command: string): Promise<JSONValue> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: WORKING_DIRECTORY,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB output limit
        shell: '/bin/bash',
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            resolve({
              error: true,
              toolName: 'shell_analysis',
              message: `Command timed out after ${SHELL_TIMEOUT_MS / 1000} seconds`,
            });
          } else {
            resolve({
              error: true,
              toolName: 'shell_analysis',
              message: error.message,
              stderr: stderr?.slice(0, 500) || '',
            });
          }
          return;
        }

        resolve({
          stdout: stdout?.slice(0, 10_000) || '',
          stderr: stderr?.slice(0, 1_000) || '',
          exitCode: 0,
        });
      }
    );
  });
}

// ============================================================================
// Lazy Handler Imports (avoid circular dependencies)
// ============================================================================

// These hold references to the actual handler functions from news-tool and search-tool.
// We lazily import them to avoid circular module dependency issues.

import { handleFetchLatestNews, handleFetchArchiveNews } from './news-tool';
import { handleSearch, handleScrape } from './search-tool';

function getNewsHandler() {
  return {
    handleNewsRequest: async (input: any): Promise<JSONValue> => {
      if (input.action === 'fetchLatestNews') {
        return handleFetchLatestNews(input);
      } else if (input.action === 'fetchArchiveNews') {
        return handleFetchArchiveNews(input);
      }
      return { error: true, toolName: 'news_search', message: `Unknown action: ${input.action}` };
    },
  };
}

function getSearchHandler() {
  return {
    handleSearchRequest: async (input: any): Promise<JSONValue> => {
      if (input.action === 'search') {
        return handleSearch(input);
      } else if (input.action === 'scrape') {
        return handleScrape(input);
      }
      return { error: true, toolName: 'search_web', message: `Unknown action: ${input.action}` };
    },
  };
}

/**
 * Reset all shared caches. Call at the start of each analysis execution.
 */
export function resetAllSharedCaches(): void {
  sharedNewsCache.clear();
  sharedSearchCache.clear();
}
