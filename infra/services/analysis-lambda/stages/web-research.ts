/**
 * Web Research Agent Stage - Autonomous news research
 *
 * Creates a Strands Agent equipped with the news search tool that performs
 * autonomous multi-step research:
 *   1. Search for recent news about the market topic
 *   2. Identify key findings from news articles
 *   3. Synthesize findings into a concise research brief
 *
 * Constraints:
 * - 180-second overall timeout (Promise.race)
 * - Max 5 news search calls (tracked via tool wrapper)
 * - Output: text research brief ≤ 4000 characters
 *
 * On failure: returns "Web research unavailable.", logs warning, continues workflow.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForStage } from '../lib/multi-model';
import { createNewsTool, createSearchTool } from '../tools/tool-factory';

// ============================================================================
// Constants
// ============================================================================

const WEB_RESEARCH_TIMEOUT_MS = 180_000;
const MAX_BRIEF_LENGTH = 4000;
const FALLBACK_BRIEF = 'Web research unavailable.';

// ============================================================================
// System Prompt
// ============================================================================

const WEB_RESEARCH_SYSTEM_PROMPT = `You are a news research agent for a prediction market analysis platform. Your job is to gather recent news and information about a market topic using the news search tool and the web search/scrape tool.

## Research Process

1. **Search**: Use the news_search tool with fetchLatestNews action to find recent articles about the topic.
2. **Broaden**: Use the search_web tool with action "search" to find broader web coverage, expert analysis, and official sources.
3. **Deep Dive**: Use the search_web tool with action "scrape" to extract full content from important pages.
4. **Synthesize**: Combine findings into a concise research brief.

## Guidelines

- Focus on recent, factual information relevant to predicting the market outcome
- Prioritize official sources, reputable news outlets, and expert analysis
- Look for concrete data points: dates, numbers, poll results, official statements
- Note any conflicting information or uncertainty
- Be efficient - aim for 2-3 news searches and 2-3 web searches total
- Use scrape sparingly (max 2-3 pages) - only for high-value sources
- If a tool returns errors, continue with whatever information you gathered

## Output Format

Produce a research brief as plain text that includes:
- Key findings relevant to the market question
- Important dates, events, or deadlines
- Notable data points or statistics
- Source attribution (mention where key info came from)
- Any conflicting signals or uncertainties

Keep the brief concise and factual. Maximum 4000 characters.`;

// ============================================================================
// Main Entry Point
// ============================================================================

export interface WebResearchResult {
  brief: string;
  searchCalls: number;
  scrapeCalls: number;
  durationMs: number;
}

/**
 * Runs the web research agent stage.
 *
 * Creates a Strands Agent with the news tool and instructs it to research
 * the given market topic. Enforces a 180-second timeout.
 *
 * @param marketQuestion - The market question/topic to research
 * @returns A WebResearchResult with the research brief and usage stats
 */
export async function runWebResearch(marketQuestion: string): Promise<WebResearchResult> {
  const startTime = Date.now();

  try {
    const model = getModelForStage('web_research');

    // Create dedicated tool instances for web research (isolated counters, generous budget)
    const newsToolInstance = createNewsTool('web_research');
    const searchToolInstance = createSearchTool('web_research');

    const agent = new Agent({
      model,
      systemPrompt: WEB_RESEARCH_SYSTEM_PROMPT,
      tools: [newsToolInstance, searchToolInstance],
      printer: false, // Lambda - no console streaming
    });

    const agentPrompt = buildResearchPrompt(marketQuestion);

    // Enforce 180-second overall timeout
    const result = await Promise.race([
      agent.invoke(agentPrompt),
      timeoutReject(WEB_RESEARCH_TIMEOUT_MS),
    ]);

    const rawBrief = String(result) || '';
    const brief = truncateBrief(rawBrief);
    const durationMs = Date.now() - startTime;

    console.log(
      `[WebResearch] Completed in ${durationMs}ms - brief length: ${brief.length} chars`,
    );

    return {
      brief: brief || FALLBACK_BRIEF,
      searchCalls: 0,
      scrapeCalls: 0,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WebResearch] Failed after ${durationMs}ms: ${message}`);

    return {
      brief: FALLBACK_BRIEF,
      searchCalls: 0,
      scrapeCalls: 0,
      durationMs,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds the user prompt for the research agent.
 */
function buildResearchPrompt(marketQuestion: string): string {
  return `Research the following prediction market question and provide a comprehensive research brief with the latest relevant information:

**Market Question:** ${marketQuestion}

Search for recent news, official statements, data, expert analysis, and any other relevant information that could help predict the outcome of this market. Focus on factual, verifiable information from the past few days to weeks.

Provide your findings as a concise research brief.`;
}

/**
 * Truncates the research brief to the maximum allowed length.
 * Tries to truncate at a sentence boundary when possible.
 */
function truncateBrief(text: string): string {
  if (text.length <= MAX_BRIEF_LENGTH) {
    return text.trim();
  }

  // Try to find a sentence boundary near the limit
  const truncated = text.slice(0, MAX_BRIEF_LENGTH);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > MAX_BRIEF_LENGTH * 0.8) {
    return truncated.slice(0, breakPoint + 1).trim();
  }

  return truncated.trim();
}

/**
 * Creates a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Web research timed out after ${ms / 1000} seconds`)), ms);
  });
}
