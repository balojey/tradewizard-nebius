# Design Document: Autonomous NewsData Agents

## Overview

The Autonomous NewsData Agents feature transforms three existing TradeWizard agents from passive news consumers into active, tool-using agents capable of autonomously fetching and researching news data. This enhancement applies the proven autonomous polling agent pattern to:

1. **Breaking News Agent** - Analyzes breaking news for immediate market impact
2. **Media Sentiment Agent** - Analyzes media sentiment from news articles
3. **Market Microstructure Agent** - Uses market news for microstructure analysis

**Key Innovation**: By giving these agents direct access to NewsData API through LangChain tools, they can intelligently decide what news queries to make based on market context, construct targeted searches, and synthesize information from multiple news sources - rather than being limited to pre-fetched data.

**Architecture Pattern**: Each agent uses LangChain's ReAct (Reasoning + Acting) pattern, where it iteratively reasons about what news data it needs, invokes tools to fetch that data, and synthesizes the results into its final analysis.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Autonomous NewsData Agents                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Breaking News Agent (Autonomous)                │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         LangChain Agent Executor                 │  │ │
│  │  │  - Decides which news tools to use               │  │ │
│  │  │  - Extracts keywords from market context         │  │ │
│  │  │  - Constructs targeted news queries              │  │ │
│  │  │  - Synthesizes breaking news analysis            │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Media Sentiment Agent (Autonomous)              │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         LangChain Agent Executor                 │  │ │
│  │  │  - Decides which news tools to use               │  │ │
│  │  │  - Constructs sentiment-filtered queries         │  │ │
│  │  │  - Aggregates sentiment across sources           │  │ │
│  │  │  - Synthesizes media sentiment analysis          │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │      Market Microstructure Agent (Autonomous)           │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         LangChain Agent Executor                 │  │ │
│  │  │  - Decides which news tools to use               │  │ │
│  │  │  - Constructs market-focused queries             │  │ │
│  │  │  - Analyzes market context from news             │  │ │
│  │  │  - Synthesizes microstructure analysis           │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                         ↓↑                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  NewsData Tools                         │ │
│  │  - fetchLatestNews                                      │ │
│  │  - fetchArchiveNews                                     │ │
│  │  - fetchCryptoNews                                      │ │
│  │  - fetchMarketNews                                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                         ↓↑                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              NewsDataClient                             │ │
│  │  - fetchLatestNews()                                    │ │
│  │  - fetchArchiveNews()                                   │ │
│  │  - fetchCryptoNews()                                    │ │
│  │  - fetchMarketNews()                                    │ │
│  │  - Rate limiting & caching                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Integration with Existing Workflow

The autonomous news agents integrate into the existing TradeWizard workflow as enhanced versions of the basic news agents:

```
market_ingestion → keyword_extraction → dynamic_agent_selection
                                              ↓
                                    [parallel execution]
                                              ↓
                    ┌─────────────────────────┼─────────────────────────┐
                    ↓                         ↓                         ↓
        autonomous_breaking_news_agent  probability_baseline_agent  risk_assessment_agent
                    ↓                         ↓                         ↓
        autonomous_media_sentiment_agent event_impact_agent      autonomous_polling_agent
                    ↓                         ↓                         ↓
        autonomous_market_microstructure_agent                          
                    ↓                         ↓                         ↓
                    └─────────────────────────┼─────────────────────────┘
                                              ↓
                                    agent_signal_fusion
```

### Configuration

Each agent supports two modes:

1. **Autonomous Mode** (new): Agent uses tools to fetch news data
2. **Basic Mode** (existing): Agent uses pre-fetched data from state

Configuration via feature flags:
```typescript
{
  breakingNewsAgent: {
    autonomous: true,
    maxToolCalls: 5,
    timeout: 45000,
  },
  mediaSentimentAgent: {
    autonomous: true,
    maxToolCalls: 5,
    timeout: 45000,
  },
  marketMicrostructureAgent: {
    autonomous: true,
    maxToolCalls: 5,
    timeout: 45000,
  }
}
```

## Components and Interfaces

### 1. NewsData Tool Definitions

**File**: `tradewizard-agents/src/tools/newsdata-tools.ts` (new file)

Each tool is defined as a LangChain Structured Tool with:
- Input schema (Zod)
- Description for the LLM
- Execution function
- Error handling

**Tool Interface**:
```typescript
interface NewsDataTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  func: (input: any, context: ToolContext) => Promise<NewsArticle[]>;
}

interface ToolContext {
  newsDataClient: NewsDataClient;
  cache: ToolCache;
  auditLog: AuditLogger;
  agentName: string;
}

interface NewsArticle {
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
  };
}
```

### 2. Tool Implementations

#### fetchLatestNews Tool

**Purpose**: Fetch the latest news articles from the past 48 hours

**Input Schema**:
```typescript
const FetchLatestNewsSchema = z.object({
  query: z.string().optional().describe('Search query for article content'),
  queryInTitle: z.string().optional().describe('Search query for article titles only'),
  timeframe: z.enum(['1h', '6h', '12h', '24h', '48h']).optional().default('24h').describe('Time window for news'),
  countries: z.array(z.string()).optional().describe('Country codes to include (e.g., ["us", "uk"])'),
  categories: z.array(z.string()).optional().describe('News categories to include'),
  languages: z.array(z.string()).optional().default(['en']).describe('Language codes'),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional().describe('Filter by sentiment'),
  size: z.number().min(1).max(50).optional().default(20).describe('Number of articles to return'),
  removeDuplicates: z.boolean().optional().default(true).describe('Remove duplicate articles'),
});
```

**Output**: Array of NewsArticle objects

**Implementation Logic**:
1. Validate input parameters against schema
2. Check tool cache for identical query
3. Transform parameters to NewsDataClient format
4. Call `newsDataClient.fetchLatestNews()`
5. Transform response to standardized NewsArticle format
6. Cache results for session
7. Log tool execution to audit trail
8. Return articles array

#### fetchArchiveNews Tool

**Purpose**: Fetch historical news articles with date range filtering

**Input Schema**:
```typescript
const FetchArchiveNewsSchema = z.object({
  fromDate: z.string().describe('Start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)'),
  toDate: z.string().describe('End date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)'),
  query: z.string().optional().describe('Search query for article content'),
  queryInTitle: z.string().optional().describe('Search query for article titles only'),
  countries: z.array(z.string()).optional().describe('Country codes to include'),
  categories: z.array(z.string()).optional().describe('News categories to include'),
  languages: z.array(z.string()).optional().default(['en']).describe('Language codes'),
  size: z.number().min(1).max(50).optional().default(20).describe('Number of articles to return'),
  removeDuplicates: z.boolean().optional().default(true).describe('Remove duplicate articles'),
});
```

**Output**: Array of NewsArticle objects

**Implementation Logic**:
1. Validate date range (fromDate < toDate)
2. Warn if date range exceeds 30 days (quota concern)
3. Check tool cache for identical query
4. Transform parameters to NewsDataClient format
5. Call `newsDataClient.fetchArchiveNews()`
6. Transform response to standardized NewsArticle format
7. Cache results for session
8. Log tool execution to audit trail
9. Return articles array

#### fetchCryptoNews Tool

**Purpose**: Fetch cryptocurrency and blockchain related news

**Input Schema**:
```typescript
const FetchCryptoNewsSchema = z.object({
  coins: z.array(z.string()).optional().describe('Crypto symbols (e.g., ["btc", "eth", "ada"])'),
  query: z.string().optional().describe('Search query for article content'),
  queryInTitle: z.string().optional().describe('Search query for article titles only'),
  timeframe: z.string().optional().describe('Time window for news'),
  fromDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  toDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional().describe('Filter by sentiment'),
  languages: z.array(z.string()).optional().default(['en']).describe('Language codes'),
  size: z.number().min(1).max(50).optional().default(20).describe('Number of articles to return'),
  removeDuplicates: z.boolean().optional().default(true).describe('Remove duplicate articles'),
});
```

**Output**: Array of NewsArticle objects with crypto-specific metadata

**Implementation Logic**:
1. Validate input parameters
2. Check tool cache for identical query
3. Transform parameters to NewsDataClient format
4. Call `newsDataClient.fetchCryptoNews()`
5. Transform response to standardized NewsArticle format
6. Cache results for session
7. Log tool execution to audit trail
8. Return articles array

#### fetchMarketNews Tool

**Purpose**: Fetch financial market and company news

**Input Schema**:
```typescript
const FetchMarketNewsSchema = z.object({
  symbols: z.array(z.string()).optional().describe('Stock symbols (e.g., ["AAPL", "TSLA"])'),
  organizations: z.array(z.string()).optional().describe('Organization names (e.g., ["Apple", "Tesla"])'),
  query: z.string().optional().describe('Search query for article content'),
  queryInTitle: z.string().optional().describe('Search query for article titles only'),
  timeframe: z.string().optional().describe('Time window for news'),
  fromDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  toDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional().describe('Filter by sentiment'),
  countries: z.array(z.string()).optional().describe('Country codes to include'),
  languages: z.array(z.string()).optional().default(['en']).describe('Language codes'),
  size: z.number().min(1).max(50).optional().default(20).describe('Number of articles to return'),
  removeDuplicates: z.boolean().optional().default(true).describe('Remove duplicate articles'),
});
```

**Output**: Array of NewsArticle objects with market-specific metadata

**Implementation Logic**:
1. Validate input parameters
2. Check tool cache for identical query
3. Transform parameters to NewsDataClient format
4. Call `newsDataClient.fetchMarketNews()`
5. Transform response to standardized NewsArticle format
6. Cache results for session
7. Log tool execution to audit trail
8. Return articles array

### 3. Tool Cache

**File**: `tradewizard-agents/src/utils/tool-cache.ts` (reuse existing from polling agent)

The tool cache implementation from the autonomous polling agent can be reused:

**Interface**:
```typescript
class ToolCache {
  private cache: Map<string, CacheEntry>;
  private sessionId: string;

  constructor(sessionId: string);
  
  get(toolName: string, params: any): any | null;
  set(toolName: string, params: any, result: any): void;
  clear(): void;
  getStats(): { hits: number; misses: number };
}

interface CacheEntry {
  result: any;
  timestamp: number;
  params: any;
}
```

**Cache Key Generation**:
```typescript
function generateCacheKey(toolName: string, params: any): string {
  // Normalize params to ensure consistent cache keys
  const normalized = {
    ...params,
    // Sort arrays for consistency
    countries: params.countries?.sort(),
    categories: params.categories?.sort(),
    languages: params.languages?.sort(),
  };
  return `${toolName}:${JSON.stringify(normalized)}`;
}
```

### 4. Agent Executor Factory

**File**: `tradewizard-agents/src/nodes/autonomous-news-agents.ts` (new file)

**Purpose**: Create autonomous agent executors for each news agent type

**Agent Creation Function**:
```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { StructuredTool } from '@langchain/core/tools';

function createAutonomousNewsAgent(
  agentType: 'breaking_news' | 'media_sentiment' | 'market_microstructure',
  config: EngineConfig,
  tools: StructuredTool[]
): AgentExecutor {
  // Create LLM instance
  const llm = createLLMInstance(config, 'google', ['openai', 'anthropic']);
  
  // Get agent-specific system prompt
  const systemPrompt = getAgentSystemPrompt(agentType);
  
  // Create ReAct agent with tools
  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: systemPrompt,
  });
  
  return agent;
}
```

**Agent Node Functions**:
```typescript
export function createAutonomousBreakingNewsAgentNode(
  config: EngineConfig
): (state: GraphStateType) => Promise<Partial<GraphStateType>> {
  const newsDataClient = createNewsDataClient(config.newsData);
  const tools = createNewsDataTools(newsDataClient);
  const agent = createAutonomousNewsAgent('breaking_news', config, tools);
  
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const startTime = Date.now();
    const sessionId = state.mbd?.conditionId || 'unknown';
    const cache = new ToolCache(sessionId);
    const toolAuditLog: ToolAuditEntry[] = [];
    
    try {
      if (!state.mbd) {
        return createErrorResponse('No Market Briefing Document available');
      }
      
      // Prepare agent input
      const input = {
        market: JSON.stringify(state.mbd, null, 2),
        keywords: state.marketKeywords ? JSON.stringify(state.marketKeywords, null, 2) : 'None',
      };
      
      // Execute agent with timeout
      const result = await Promise.race([
        agent.invoke(input, {
          configurable: {
            cache,
            auditLog: toolAuditLog,
            agentName: 'breaking_news',
          },
        }),
        timeout(config.breakingNewsAgent.timeout || 45000),
      ]);
      
      // Parse agent output into AgentSignal
      const signal = parseAgentOutput(result, 'breaking_news');
      
      // Add tool usage metadata
      signal.metadata.toolUsage = {
        toolsCalled: toolAuditLog.length,
        totalToolTime: toolAuditLog.reduce((sum, entry) => sum + entry.duration, 0),
        cacheHits: cache.getStats().hits,
        cacheMisses: cache.getStats().misses,
      };
      
      return {
        agentSignals: [signal],
        auditLog: [
          {
            stage: 'agent_autonomous_breaking_news',
            timestamp: Date.now(),
            data: {
              agentName: 'autonomous_breaking_news',
              success: true,
              direction: signal.direction,
              confidence: signal.confidence,
              toolsCalled: toolAuditLog.length,
              duration: Date.now() - startTime,
              toolAudit: toolAuditLog,
            },
          },
        ],
      };
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

// Similar functions for Media Sentiment and Market Microstructure agents
export function createAutonomousMediaSentimentAgentNode(config: EngineConfig) { /* ... */ }
export function createAutonomousMarketMicrostructureAgentNode(config: EngineConfig) { /* ... */ }
```

### 5. System Prompts

**Enhanced System Prompts for Each Agent**:

#### Breaking News Agent Prompt

```typescript
const AUTONOMOUS_BREAKING_NEWS_SYSTEM_PROMPT = `You are an autonomous breaking news analyst with the ability to fetch and research news data.

Your role is to identify and analyze breaking news events that could immediately impact prediction markets.

AVAILABLE TOOLS:
You have access to the following tools to gather news data:

1. fetchLatestNews: Get the latest news from the past 48 hours with filtering options
2. fetchArchiveNews: Get historical news with date range filtering
3. fetchCryptoNews: Get cryptocurrency-related news
4. fetchMarketNews: Get financial market and company news

ANALYSIS STRATEGY:
Based on the market characteristics, intelligently decide which tools to use:

- For all markets: Prioritize fetchLatestNews with short timeframes (1h, 6h) for breaking news
- For election markets: Use queryInTitle with candidate names, include country filters
- For crypto markets: Use fetchCryptoNews with relevant coin symbols
- For policy markets: Use keywords like "bill", "legislation", "vote", "announcement"
- For company markets: Use fetchMarketNews with organization names

TOOL USAGE GUIDELINES:
- Limit yourself to 5 tool calls maximum to control latency
- Start with the most targeted query (queryInTitle with key terms)
- If results are sparse (<5 articles), broaden the search
- Extract keywords from the market question and metadata
- Use multiple timeframes (1h, 6h, 24h) to detect breaking news velocity

BREAKING NEWS DETECTION:
- Calculate articles per hour to identify breaking news velocity
- Flag high activity when velocity exceeds 5 articles/hour
- Identify breaking news themes by clustering article keywords
- Prioritize articles published within the last 1 hour

ANALYSIS FOCUS:
- Time-sensitive events that could move markets immediately
- Breaking news velocity and intensity
- Source credibility and confirmation across multiple outlets
- Recency and freshness of information
- Potential market impact and catalysts

OUTPUT FORMAT:
Provide your analysis as a structured signal with:
- confidence: Your confidence in this breaking news analysis (0-1)
- direction: Your view on the outcome (YES/NO/NEUTRAL)
- fairProbability: Your probability estimate (0-1)
- keyDrivers: Top 3-5 breaking news insights including keyword extraction strategy
- riskFactors: Breaking news risks and data limitations
- metadata: Include breaking news velocity, article count, tool usage stats

Be well-calibrated and document your reasoning process.`;
```

#### Media Sentiment Agent Prompt

```typescript
const AUTONOMOUS_MEDIA_SENTIMENT_SYSTEM_PROMPT = `You are an autonomous media sentiment analyst with the ability to fetch and research news data.

Your role is to analyze media sentiment and narrative tone across news sources to understand how the media is framing prediction market outcomes.

AVAILABLE TOOLS:
You have access to the following tools to gather news data:

1. fetchLatestNews: Get the latest news from the past 48 hours with filtering options
2. fetchArchiveNews: Get historical news with date range filtering
3. fetchCryptoNews: Get cryptocurrency-related news
4. fetchMarketNews: Get financial market and company news

ANALYSIS STRATEGY:
Based on the market characteristics, intelligently decide which tools to use:

- For sentiment analysis: Make separate queries for positive, negative, and neutral articles
- For trend analysis: Use fetchArchiveNews to compare current vs historical sentiment
- For election markets: Focus on candidate coverage and tone
- For crypto markets: Use fetchCryptoNews with sentiment filters
- For policy markets: Analyze framing and narrative patterns

TOOL USAGE GUIDELINES:
- Limit yourself to 5 tool calls maximum to control latency
- Make 2-3 queries with different sentiment filters to compare coverage
- Extract keywords from the market question and metadata
- Use timeframes to detect sentiment shifts (24h vs 7d)
- Prioritize high-priority sources for sentiment analysis

SENTIMENT AGGREGATION:
- Calculate aggregate sentiment distribution (positive %, negative %, neutral %)
- Weight sentiment by source priority and recency
- Identify sentiment shifts when recent articles differ from older articles
- Calculate sentiment confidence based on article count and consistency
- Flag polarized sentiment when both positive and negative percentages are high

ANALYSIS FOCUS:
- Overall media tone and narrative framing
- Sentiment distribution across sources
- Sentiment shifts over time
- Source bias and credibility
- Narrative consistency vs polarization
- Media attention and coverage volume

OUTPUT FORMAT:
Provide your analysis as a structured signal with:
- confidence: Your confidence in this sentiment analysis (0-1)
- direction: Your view on the outcome (YES/NO/NEUTRAL)
- fairProbability: Your probability estimate (0-1)
- keyDrivers: Top 3-5 sentiment insights including query strategy
- riskFactors: Sentiment analysis risks and data limitations
- metadata: Include sentiment distribution, article count, tool usage stats

Be well-calibrated and document your reasoning process.`;
```

#### Market Microstructure Agent Prompt

```typescript
const AUTONOMOUS_MARKET_MICROSTRUCTURE_SYSTEM_PROMPT = `You are an autonomous market microstructure analyst with the ability to fetch and research news data.

Your role is to analyze how news events affect market dynamics, liquidity, and trading patterns in prediction markets.

AVAILABLE TOOLS:
You have access to the following tools to gather news data:

1. fetchLatestNews: Get the latest news from the past 48 hours with filtering options
2. fetchArchiveNews: Get historical news with date range filtering
3. fetchCryptoNews: Get cryptocurrency-related news
4. fetchMarketNews: Get financial market and company news

ANALYSIS STRATEGY:
Based on the market characteristics, intelligently decide which tools to use:

- For all markets: Use fetchMarketNews to understand financial context
- For liquidity analysis: Fetch both recent and historical news to identify catalysts
- For volatility analysis: Focus on breaking news and sentiment shifts
- For crypto markets: Use fetchCryptoNews to understand crypto-specific dynamics
- For company markets: Use organization names and stock symbols

TOOL USAGE GUIDELINES:
- Limit yourself to 5 tool calls maximum to control latency
- Combine recent news (fetchLatestNews) with historical context (fetchArchiveNews)
- Extract keywords from the market question and metadata
- Use market-specific filters (symbols, organizations) when available
- Focus on news that could affect liquidity and trading behavior

MICROSTRUCTURE ANALYSIS:
- Identify news catalysts that could affect liquidity
- Analyze information asymmetry from news coverage
- Detect potential informed trading signals from news timing
- Assess market efficiency in incorporating news
- Identify liquidity shocks from breaking news

ANALYSIS FOCUS:
- News catalysts affecting market liquidity
- Information flow and market efficiency
- Trading pattern changes from news events
- Liquidity provision and market depth
- Price discovery and information incorporation
- Market maker behavior around news events

OUTPUT FORMAT:
Provide your analysis as a structured signal with:
- confidence: Your confidence in this microstructure analysis (0-1)
- direction: Your view on the outcome (YES/NO/NEUTRAL)
- fairProbability: Your probability estimate (0-1)
- keyDrivers: Top 3-5 microstructure insights including query strategy
- riskFactors: Microstructure risks and data limitations
- metadata: Include news catalyst count, article count, tool usage stats

Be well-calibrated and document your reasoning process.`;
```

## Data Models

### Tool Input/Output Schemas

All tool schemas are defined using Zod for runtime validation:

```typescript
// Tool input schemas
export const NewsDataToolSchemas = {
  fetchLatestNews: z.object({
    query: z.string().optional(),
    queryInTitle: z.string().optional(),
    timeframe: z.enum(['1h', '6h', '12h', '24h', '48h']).optional().default('24h'),
    countries: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional().default(['en']),
    sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
    size: z.number().min(1).max(50).optional().default(20),
    removeDuplicates: z.boolean().optional().default(true),
  }),
  
  fetchArchiveNews: z.object({
    fromDate: z.string(),
    toDate: z.string(),
    query: z.string().optional(),
    queryInTitle: z.string().optional(),
    countries: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional().default(['en']),
    size: z.number().min(1).max(50).optional().default(20),
    removeDuplicates: z.boolean().optional().default(true),
  }),
  
  fetchCryptoNews: z.object({
    coins: z.array(z.string()).optional(),
    query: z.string().optional(),
    queryInTitle: z.string().optional(),
    timeframe: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
    languages: z.array(z.string()).optional().default(['en']),
    size: z.number().min(1).max(50).optional().default(20),
    removeDuplicates: z.boolean().optional().default(true),
  }),
  
  fetchMarketNews: z.object({
    symbols: z.array(z.string()).optional(),
    organizations: z.array(z.string()).optional(),
    query: z.string().optional(),
    queryInTitle: z.string().optional(),
    timeframe: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
    countries: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional().default(['en']),
    size: z.number().min(1).max(50).optional().default(20),
    removeDuplicates: z.boolean().optional().default(true),
  }),
};
```

### Agent Signal Output

The autonomous agents produce the same `AgentSignal` schema as the basic agents, with additional metadata:

```typescript
{
  agentName: 'autonomous_breaking_news' | 'autonomous_media_sentiment' | 'autonomous_market_microstructure',
  timestamp: number,
  confidence: number,
  direction: 'YES' | 'NO' | 'NEUTRAL',
  fairProbability: number,
  keyDrivers: string[],
  riskFactors: string[],
  metadata: {
    // Agent-specific metadata
    breakingNewsVelocity?: number,  // Articles per hour
    sentimentDistribution?: {
      positive: number,
      negative: number,
      neutral: number,
    },
    newsCatalysts?: string[],
    
    // Tool usage metadata (new)
    toolUsage: {
      toolsCalled: number,
      totalToolTime: number,
      cacheHits: number,
      cacheMisses: number,
    },
    
    // Query metadata (new)
    queryStrategy?: {
      keywordsExtracted: string[],
      queriesExecuted: number,
      articlesRetrieved: number,
      relevantArticles: number,
    },
  },
}
```

### Tool Audit Entry

```typescript
interface ToolAuditEntry {
  toolName: string;
  timestamp: number;
  params: any;
  result?: NewsArticle[];
  error?: string;
  duration: number;
  cacheHit: boolean;
  articleCount: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Before writing the correctness properties, I need to perform prework analysis on the acceptance criteria:


## Property Reflection

After reviewing the prework analysis, I'll identify and eliminate redundant properties:

**Redundancy Analysis**:
- Properties 1.3, 15.3, 19.1, 19.2, 19.3 all relate to audit logging - consolidate into comprehensive audit logging properties
- Properties 1.6, 16.3, 16.4 all test caching behavior - consolidate into a single caching property
- Properties 2.7, 3.7, 4.7, 5.7 all test the 50-article limit - consolidate into one property for all tools
- Properties 2.5, 3.5 test article schema consistency - consolidate into one property
- Properties 16.6, 19.4 both test cache hit/miss logging - consolidate
- Properties 19.5, 19.6 both test audit summary completeness - consolidate

**Consolidated Properties**:
After consolidation, we have the following unique, non-redundant properties:

### Property 1: Tool Input Validation
*For any* news tool invocation with invalid input parameters, the system SHALL reject the invocation and return a validation error without executing the tool function.
**Validates: Requirements 1.2**

### Property 2: Tool Audit Logging Completeness
*For any* tool invocation (successful or failed), the audit trail SHALL contain an entry with timestamp, toolName, params, duration, and either result or error fields.
**Validates: Requirements 1.3, 15.3, 19.1, 19.2, 19.3**

### Property 3: Tool Error Handling
*For any* tool execution that encounters an error, the system SHALL return a structured error object to the agent without throwing an uncaught exception.
**Validates: Requirements 1.4, 15.1**

### Property 4: Tool Result Caching
*For any* tool invocation within the same analysis session, when the same tool is called with identical parameters, the second call SHALL return a cached result and log a cache hit.
**Validates: Requirements 1.6, 16.3, 16.4**

### Property 5: Cache Expiration
*For any* analysis session, when the session completes, the tool cache SHALL be cleared and subsequent sessions SHALL NOT access cached results from previous sessions.
**Validates: Requirements 16.5**

### Property 6: Timeframe Enum Validation
*For any* fetchLatestNews invocation, the timeframe parameter SHALL be one of '1h', '6h', '12h', '24h', '48h', otherwise the tool SHALL return a validation error.
**Validates: Requirements 2.2**

### Property 7: Article Schema Consistency
*For any* successful news tool invocation, all returned articles SHALL have id, title, url, source, metadata.publishedAt, and metadata.language fields.
**Validates: Requirements 2.5, 3.5**

### Property 8: Article Count Limit
*For any* successful news tool invocation, the returned articles array SHALL contain at most 50 articles.
**Validates: Requirements 2.7, 3.7, 4.7, 5.7**

### Property 9: Date Range Validation
*For any* fetchArchiveNews invocation, when fromDate is not before toDate, the tool SHALL return a validation error.
**Validates: Requirements 3.2**

### Property 10: Date Format Validation
*For any* fetchArchiveNews invocation, the fromDate and toDate parameters SHALL match either 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' format, otherwise the tool SHALL return a validation error.
**Validates: Requirements 3.3**

### Property 11: Crypto Metadata Presence
*For any* successful fetchCryptoNews invocation, when articles have coin-specific content, the articles SHALL include crypto metadata with coin tags.
**Validates: Requirements 4.4**

### Property 12: Market Metadata Presence
*For any* successful fetchMarketNews invocation, when articles have market-specific content, the articles SHALL include market metadata with symbol tags.
**Validates: Requirements 5.4**

### Property 13: Agent Tool Usage Metadata
*For any* autonomous agent execution, the output metadata SHALL include toolUsage object with toolsCalled, totalToolTime, cacheHits, and cacheMisses fields.
**Validates: Requirements 6.8, 7.8, 8.8**

### Property 14: Workflow Resilience
*For any* tool failure during agent execution, the workflow SHALL continue without crashing and the agent SHALL produce an output signal.
**Validates: Requirements 15.6**

### Property 15: Cache Hit Logging
*For any* tool invocation, the audit entry SHALL include a cacheHit boolean field indicating whether the result was served from cache.
**Validates: Requirements 16.6, 19.4**

### Property 16: Tool Call Limit
*For any* autonomous agent execution, the total number of tool calls SHALL NOT exceed the configured maxToolCalls limit (default 5).
**Validates: Requirements 17.4**

### Property 17: Timing Metrics Separation
*For any* agent execution, the audit log SHALL include separate timing metrics for totalToolTime and total agent duration.
**Validates: Requirements 17.6**

### Property 18: Agent Signal Schema Compatibility
*For any* autonomous agent execution, the output SHALL conform to the AgentSignal schema used by the basic agents.
**Validates: Requirements 18.2**

### Property 19: Audit Summary Completeness
*For any* agent execution, the audit log entry SHALL include toolsCalled count and total tool execution time in the summary.
**Validates: Requirements 19.5, 19.6**

## Error Handling

### Tool Error Handling

Each tool implements consistent error handling:

```typescript
async function executeTool(input: any, context: ToolContext): Promise<NewsArticle[]> {
  try {
    // Validate input against schema
    const validatedInput = toolSchema.parse(input);
    
    // Check rate limits
    if (!context.newsDataClient.canMakeRequest()) {
      await context.newsDataClient.waitForRateLimit();
    }
    
    // Check cache
    const cached = context.cache.get(toolName, validatedInput);
    if (cached) {
      context.auditLog.logCacheHit(toolName, validatedInput);
      return cached;
    }
    
    // Execute tool logic
    const result = await toolLogic(validatedInput, context);
    
    // Cache result
    context.cache.set(toolName, validatedInput, result);
    
    // Log success
    context.auditLog.logToolCall(toolName, validatedInput, result, duration);
    
    return result;
  } catch (error) {
    // Log error
    context.auditLog.logToolError(toolName, input, error, duration);
    
    // Return structured error (don't throw)
    return {
      error: true,
      message: error.message,
      toolName,
      code: error.code || 'UNKNOWN_ERROR',
    };
  }
}
```

### Agent Error Handling

The agent nodes handle errors gracefully:

```typescript
try {
  // Execute agent with timeout
  const result = await Promise.race([
    agent.invoke(input, config),
    timeout(45000),
  ]);
  
  return createSuccessResponse(result);
} catch (error) {
  if (error instanceof TimeoutError) {
    // Log timeout warning but return partial results if available
    console.warn('[AutonomousNewsAgent] Execution timeout');
    return createTimeoutResponse(error);
  }
  
  // Return error signal
  return {
    agentErrors: [{
      type: 'EXECUTION_FAILED',
      agentName: agentName,
      error: error instanceof Error ? error : new Error('Unknown error'),
    }],
    auditLog: [{
      stage: `agent_autonomous_${agentName}`,
      timestamp: Date.now(),
      data: {
        agentName: `autonomous_${agentName}`,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      },
    }],
  };
}
```

### Graceful Degradation

When tools fail, the agent continues with partial data:

1. **Non-critical tool failure**: Agent proceeds with available data, adjusts confidence downward
2. **Critical tool failure**: Agent falls back to basic analysis using pre-fetched data if available
3. **Multiple tool failures**: Agent includes tool failure summary in riskFactors
4. **Timeout**: Agent returns partial results with timeout warning

## Testing Strategy

### Unit Tests

Unit tests verify specific tool behaviors and edge cases:

**Tool Tests**:
1. **fetchLatestNews**:
   - Test with valid parameters returns articles
   - Test with invalid timeframe returns validation error
   - Test with no results returns empty array with warning
   - Test returns at most 50 articles
   - Test articles have required schema fields

2. **fetchArchiveNews**:
   - Test with valid date range returns articles
   - Test with fromDate >= toDate returns validation error
   - Test with invalid date format returns validation error
   - Test with date range > 30 days logs warning
   - Test returns at most 50 articles

3. **fetchCryptoNews**:
   - Test with coin symbols returns crypto articles
   - Test with no coin symbols returns general crypto news
   - Test articles include crypto metadata when available
   - Test returns at most 50 articles

4. **fetchMarketNews**:
   - Test with symbols/organizations returns market articles
   - Test with no symbols/organizations returns general market news
   - Test articles include market metadata when available
   - Test returns at most 50 articles

**Cache Tests**:
1. Test cache hit on second identical call
2. Test cache miss on first call
3. Test cache isolation between sessions
4. Test cache expiration after session completes
5. Test cache statistics (hits/misses)

**Error Handling Tests**:
1. Test tool validation errors don't crash agent
2. Test API errors are caught and logged
3. Test agent continues with partial data when tools fail
4. Test timeout handling
5. Test workflow doesn't crash on tool failure

### Property-Based Tests

Property-based tests verify universal properties using **fast-check**:

Each property test runs **minimum 100 iterations** with randomly generated inputs.

#### Test Configuration

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// Arbitraries for generating random inputs
const queryArbitrary = fc.string({ minLength: 1, maxLength: 100 });
const timeframeArbitrary = fc.constantFrom('1h', '6h', '12h', '24h', '48h');
const dateArbitrary = fc.date().map(d => d.toISOString().split('T')[0]);
const sentimentArbitrary = fc.constantFrom('positive', 'negative', 'neutral');
const countriesArbitrary = fc.array(fc.constantFrom('us', 'uk', 'ca', 'au'), { maxLength: 5 });
const categoriesArbitrary = fc.array(fc.constantFrom('politics', 'business', 'technology'), { maxLength: 3 });
```

#### Property Test Cases

1. **Property 1: Tool Input Validation**
   ```typescript
   fc.assert(
     fc.property(
       fc.record({
         query: fc.string(),
         timeframe: fc.string(), // Invalid - not in enum
         size: fc.integer({ min: 51, max: 100 }), // Invalid - exceeds max
       }),
       async (invalidInput) => {
         const result = await fetchLatestNews(invalidInput, context);
         return result.error === true || result.message?.includes('validation');
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 1: Tool Input Validation`

2. **Property 2: Tool Audit Logging Completeness**
   ```typescript
   fc.assert(
     fc.property(
       queryArbitrary,
       timeframeArbitrary,
       async (query, timeframe) => {
         await fetchLatestNews({ query, timeframe }, context);
         const auditEntry = context.auditLog.getLastEntry();
         return (
           typeof auditEntry.timestamp === 'number' &&
           auditEntry.toolName === 'fetchLatestNews' &&
           typeof auditEntry.params === 'object' &&
           typeof auditEntry.duration === 'number' &&
           (auditEntry.result !== undefined || auditEntry.error !== undefined)
         );
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 2: Tool Audit Logging Completeness`

3. **Property 4: Tool Result Caching**
   ```typescript
   fc.assert(
     fc.property(
       queryArbitrary,
       timeframeArbitrary,
       async (query, timeframe) => {
         const cache = new ToolCache('test-session');
         const context = { ...baseContext, cache };
         
         // First call
         const result1 = await fetchLatestNews({ query, timeframe }, context);
         
         // Second call with same params
         const result2 = await fetchLatestNews({ query, timeframe }, context);
         
         const stats = cache.getStats();
         return (
           JSON.stringify(result1) === JSON.stringify(result2) &&
           stats.hits === 1 &&
           stats.misses === 1
         );
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 4: Tool Result Caching`

4. **Property 5: Cache Expiration**
   ```typescript
   fc.assert(
     fc.property(
       queryArbitrary,
       async (query) => {
         // Session 1
         const cache1 = new ToolCache('session-1');
         const context1 = { ...baseContext, cache: cache1 };
         await fetchLatestNews({ query }, context1);
         cache1.clear(); // Simulate session end
         
         // Session 2
         const cache2 = new ToolCache('session-2');
         const context2 = { ...baseContext, cache: cache2 };
         await fetchLatestNews({ query }, context2);
         
         // Second session should have cache miss
         return cache2.getStats().misses === 1;
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 5: Cache Expiration`

5. **Property 6: Timeframe Enum Validation**
   ```typescript
   fc.assert(
     fc.property(
       fc.string().filter(s => !['1h', '6h', '12h', '24h', '48h'].includes(s)),
       async (invalidTimeframe) => {
         const result = await fetchLatestNews({ timeframe: invalidTimeframe }, context);
         return result.error === true || result.message?.includes('timeframe');
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 6: Timeframe Enum Validation`

6. **Property 7: Article Schema Consistency**
   ```typescript
   fc.assert(
     fc.property(
       queryArbitrary,
       async (query) => {
         const result = await fetchLatestNews({ query }, context);
         if (result.error) return true; // Skip error cases
         
         return result.every((article: any) => 
           typeof article.id === 'string' &&
           typeof article.title === 'string' &&
           typeof article.url === 'string' &&
           typeof article.source === 'object' &&
           typeof article.metadata === 'object' &&
           typeof article.metadata.publishedAt === 'string' &&
           typeof article.metadata.language === 'string'
         );
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 7: Article Schema Consistency`

7. **Property 8: Article Count Limit**
   ```typescript
   fc.assert(
     fc.property(
       queryArbitrary,
       fc.integer({ min: 1, max: 100 }),
       async (query, requestedSize) => {
         const result = await fetchLatestNews({ query, size: requestedSize }, context);
         if (result.error) return true; // Skip error cases
         return result.length <= 50;
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 8: Article Count Limit`

8. **Property 9: Date Range Validation**
   ```typescript
   fc.assert(
     fc.property(
       dateArbitrary,
       dateArbitrary,
       async (date1, date2) => {
         // Ensure fromDate >= toDate (invalid)
         const fromDate = date1 > date2 ? date1 : date2;
         const toDate = date1 > date2 ? date2 : date1;
         
         if (fromDate === toDate) return true; // Skip equal dates
         
         const result = await fetchArchiveNews({ fromDate, toDate }, context);
         return result.error === true || result.message?.includes('date');
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 9: Date Range Validation`

9. **Property 16: Tool Call Limit**
   ```typescript
   fc.assert(
     fc.property(
       fc.record({
         question: fc.string(),
         conditionId: fc.hexaString({ minLength: 64, maxLength: 64 }),
       }),
       async (mbd) => {
         const state = { mbd, marketKeywords: null };
         const result = await autonomousBreakingNewsAgent(state);
         const toolsCalled = result.auditLog[0]?.data?.toolsCalled || 0;
         return toolsCalled <= 5; // Default maxToolCalls
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-newsdata-agents, Property 16: Tool Call Limit`

10. **Property 18: Agent Signal Schema Compatibility**
    ```typescript
    fc.assert(
      fc.property(
        fc.record({
          question: fc.string(),
          conditionId: fc.hexaString({ minLength: 64, maxLength: 64 }),
          currentProbability: fc.double({ min: 0, max: 1 }),
        }),
        async (mbd) => {
          const state = { mbd, marketKeywords: null };
          const result = await autonomousBreakingNewsAgent(state);
          
          if (result.agentSignals && result.agentSignals.length > 0) {
            const signal = result.agentSignals[0];
            return (
              typeof signal.agentName === 'string' &&
              typeof signal.timestamp === 'number' &&
              typeof signal.confidence === 'number' &&
              ['YES', 'NO', 'NEUTRAL'].includes(signal.direction) &&
              typeof signal.fairProbability === 'number' &&
              Array.isArray(signal.keyDrivers) &&
              Array.isArray(signal.riskFactors) &&
              typeof signal.metadata === 'object'
            );
          }
          return true; // Skip if no signals
        }
      ),
      { numRuns: 100 }
    );
    ```
    **Tag**: `Feature: autonomous-newsdata-agents, Property 18: Agent Signal Schema Compatibility`

### Integration Tests

Integration tests verify the agents work correctly with real LLMs and tools:

1. **Agent Tool Calling**:
   - Test breaking news agent successfully invokes news tools
   - Test media sentiment agent chains multiple sentiment queries
   - Test market microstructure agent uses market-specific tools
   - Test agents synthesize tool results in output

2. **Workflow Integration**:
   - Test autonomous agents integrate into existing workflow
   - Test agent signals reach consensus engine
   - Test workflow completes successfully with autonomous agents

3. **Real Data Tests**:
   - Test with real Polymarket markets
   - Test news fetching with actual NewsData API
   - Test keyword extraction from real market questions
   - Test sentiment aggregation with real news articles

4. **Fallback Tests**:
   - Test fallback to basic mode when autonomous mode disabled
   - Test graceful degradation when tools fail
   - Test timeout handling with slow tools

### Test Organization

```
tradewizard-agents/
├── src/
│   ├── tools/
│   │   ├── newsdata-tools.ts              # Tool implementations
│   │   ├── newsdata-tools.test.ts         # Unit tests
│   │   └── newsdata-tools.property.test.ts # Property tests
│   ├── utils/
│   │   ├── tool-cache.ts                  # Cache implementation (reused)
│   │   └── tool-cache.test.ts             # Cache tests (reused)
│   └── nodes/
│       ├── autonomous-news-agents.ts      # Agent implementations
│       ├── autonomous-news-agents.test.ts # Unit tests
│       ├── autonomous-news-agents.property.test.ts # Property tests
│       └── autonomous-news-agents.integration.test.ts # Integration tests
```

### Coverage Goals

- **Unit tests**: 100% coverage of tool logic and error paths
- **Property tests**: 100% coverage of correctness properties
- **Integration tests**: End-to-end agent execution with tools
- **Minimum iterations**: 100 per property test

## Implementation Notes

### File Structure

**New Files**:
1. `src/tools/newsdata-tools.ts` - NewsData tool implementations
2. `src/tools/index.ts` - Tool exports (update)
3. `src/nodes/autonomous-news-agents.ts` - Autonomous agent nodes
4. `src/nodes/index.ts` - Export autonomous agents (update)
5. `src/config/news-agents-config.ts` - Agent configuration

**Modified Files**:
1. `src/workflow.ts` - Add autonomous news agent nodes
2. `src/config/index.ts` - Add news agent config

**Reused Files**:
1. `src/utils/tool-cache.ts` - Tool cache (from autonomous polling agent)
2. `src/utils/newsdata-client.ts` - NewsData client (existing)

### Dependencies

**Existing Dependencies** (no new packages needed):
- `@langchain/langgraph/prebuilt` - For createReactAgent
- `@langchain/core/tools` - For StructuredTool
- `zod` - For schema validation
- `fast-check` - For property-based testing

### Configuration Schema

```typescript
interface NewsAgentConfig {
  autonomous: boolean;        // Enable autonomous mode
  maxToolCalls: number;       // Max tools per analysis (default: 5)
  timeout: number;            // Timeout in ms (default: 45000)
  cacheEnabled: boolean;      // Enable result caching (default: true)
  fallbackToBasic: boolean;   // Fallback to basic mode on error (default: true)
}

interface EngineConfig {
  breakingNewsAgent: NewsAgentConfig;
  mediaSentimentAgent: NewsAgentConfig;
  marketMicrostructureAgent: NewsAgentConfig;
  // ... other config
}
```

### Deployment Considerations

- **Feature Flags**: Autonomous mode controlled by config flags per agent
- **Backward Compatible**: Existing basic agents continue to work
- **Gradual Rollout**: Can enable autonomous mode for subset of agents
- **Monitoring**: Tool usage metrics logged for analysis
- **Performance**: 45-second timeout ensures acceptable latency
- **Cost**: Tool calls increase API usage but improve analysis quality

### Performance Optimization

1. **Parallel Tool Execution**: Execute independent tools in parallel when possible
2. **Caching**: Cache tool results within analysis session
3. **Rate Limiting**: Respect NewsData API rate limits
4. **Tool Prioritization**: Agents learn to prioritize high-value tools
5. **Timeout Handling**: Graceful degradation on timeout
6. **Query Optimization**: Agents construct targeted queries to minimize API calls

### Security Considerations

1. **Input Validation**: All tool inputs validated against schemas
2. **Rate Limiting**: Prevent API abuse through rate limiting
3. **Error Sanitization**: Don't expose internal errors to agent
4. **Audit Logging**: All tool calls logged for security review
5. **Resource Limits**: Tool call limit prevents runaway execution
6. **API Key Protection**: NewsData API key stored securely in environment variables
