# Web Research Agent Design Document

## Overview

The Web Research Agent is an autonomous intelligence agent that provides real-world context about prediction markets by searching the web for relevant information. This agent integrates into the existing LangGraph workflow between memory_retrieval and dynamic_agent_selection, using the Serper API for both web search and webpage scraping capabilities.

### Purpose

Currently, the multi-agent analysis system lacks sufficient context about the events, conflicts, and circumstances that drive market creation. The Web Research Agent addresses this gap by:

- Gathering comprehensive background information about market subjects
- Providing current events and contextual data
- Synthesizing information from multiple web sources into coherent research documents
- Enabling other agents to make more informed analyses

### Key Features

- Autonomous web search using Serper API
- Full webpage content extraction via Serper scrape endpoint
- Multi-key API rotation for automatic failover on rate limits
- Intelligent query formulation based on market characteristics
- Research document synthesis for downstream consumption
- Tool caching to avoid duplicate API calls
- Comprehensive audit logging

## Architecture

### Workflow Integration


The Web Research Agent is inserted into the LangGraph workflow as follows:

```
Market Ingestion
      ↓
Memory Retrieval
      ↓
Web Research Agent (NEW)  ← Executes here
      ↓
Dynamic Agent Selection
      ↓
Parallel Agent Execution
      ↓
... (rest of workflow)
```

**Rationale for Placement**:
- After memory_retrieval: Has access to historical context and market data
- Before dynamic_agent_selection: Research document available to all downstream agents
- Early in pipeline: Provides foundational context for all subsequent analysis

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Web Research Agent Node                     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Autonomous Agent (ReAct Pattern)           │    │
│  │                                                     │    │
│  │  • Analyzes market question                        │    │
│  │  • Formulates search queries                       │    │
│  │  • Decides which URLs to scrape                    │    │
│  │  • Synthesizes research document                   │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Tool Layer (LangChain)                │    │
│  │                                                     │    │
│  │  • search_web tool                                 │    │
│  │  • scrape_webpage tool                             │    │
│  │  • Tool caching                                    │    │
│  │  • Audit logging                                   │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Serper API Client                       │    │
│  │                                                     │    │
│  │  • Multi-key rotation                              │    │
│  │  • Search endpoint integration                     │    │
│  │  • Scrape endpoint integration                     │    │
│  │  • Error handling & retries                        │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Input**: GraphState containing MBD (Market Briefing Document)
2. **Processing**:
   - Agent analyzes market question and metadata
   - Agent formulates search queries autonomously
   - Agent invokes search_web tool (cached if duplicate)
   - Agent reviews search results
   - Agent selects URLs to scrape for deeper context
   - Agent invokes scrape_webpage tool (cached if duplicate)
   - Agent synthesizes all information into research document
3. **Output**: Agent signal with research document in key_drivers field



## Components and Interfaces

### 1. Serper API Client

The Serper API client provides a unified interface for both search and scraping operations with multi-key rotation support.

#### TypeScript Implementation

**File**: `tradewizard-agents/src/utils/serper-client.ts`

```typescript
// Key State Management
interface KeyState {
  key: string;                    // Full API key
  keyId: string;                  // First 8 chars for logging
  isRateLimited: boolean;         // Currently rate-limited?
  rateLimitExpiry: Date | null;   // When rate limit expires
  totalRequests: number;          // Lifetime request count
  lastUsed: Date | null;          // Last request timestamp
}

// Configuration
interface SerperConfig {
  apiKey: string;                 // Comma-separated keys
  searchUrl?: string;             // Default: https://google.serper.dev
  scrapeUrl?: string;             // Default: https://scrape.serper.dev
  timeout?: number;               // Default: 30000ms
  retryAttempts?: number;         // Default: 3
  retryDelay?: number;            // Default: 1000ms
}

// Search Parameters
interface SerperSearchParams {
  q: string;                      // Search query (required)
  num?: number;                   // Number of results (default: 10, max: 20)
  tbs?: string;                   // Time range filter (qdr:h, qdr:d, qdr:w, qdr:m, qdr:y)
  gl?: string;                    // Country code (e.g., "us")
  hl?: string;                    // Language code (e.g., "en")
}

// Search Response
interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  position: number;
}

interface SerperSearchResponse {
  searchParameters: {
    q: string;
    gl?: string;
    hl?: string;
    num?: number;
    type?: string;
  };
  organic: SerperSearchResult[];
  answerBox?: any;
  knowledgeGraph?: any;
}

// Scrape Parameters
interface SerperScrapeParams {
  url: string;                    // URL to scrape (required)
}

// Scrape Response
interface SerperScrapeResponse {
  url: string;
  title?: string;
  text?: string;                  // Full webpage text content
  metadata?: {
    description?: string;
    keywords?: string;
    author?: string;
    publishedDate?: string;
  };
}

// Client Class
class SerperClient {
  private config: SerperConfig;
  private apiKeys: string[];
  private keyStates: Map<string, KeyState>;
  private currentKeyIndex: number;
  
  constructor(config: SerperConfig);
  
  // Core Methods
  async search(params: SerperSearchParams): Promise<SerperSearchResponse>;
  async scrape(params: SerperScrapeParams): Promise<SerperScrapeResponse>;
  
  // Key Rotation Methods (following NewsData pattern exactly)
  private getKeyId(key: string): string;
  private isRateLimitError(response: Response): boolean;
  private isBlockingError(response: Response): boolean;
  private extractRetryAfter(response: Response): number;
  private getAvailableKeys(): string[];
  private rotateApiKey(retryAfterSeconds: number, context?: any): string | null;
  private updateUrlApiKey(url: string, apiKey: string): string;
  
  // Observability
  getKeyRotationStats(): KeyRotationStats;
}
```

#### Python Implementation

**File**: `doa/tools/serper_client.py`

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import requests

@dataclass
class KeyState:
    """State tracking for a single API key"""
    key: str
    key_id: str
    is_rate_limited: bool
    rate_limit_expiry: Optional[datetime]
    total_requests: int
    last_used: Optional[datetime]

@dataclass
class SerperConfig:
    """Serper API client configuration"""
    api_key: str  # Comma-separated keys
    search_url: str = "https://google.serper.dev"
    scrape_url: str = "https://scrape.serper.dev"
    timeout: int = 30
    retry_attempts: int = 3
    retry_delay: int = 1

@dataclass
class SerperSearchParams:
    """Parameters for Serper search API"""
    q: str
    num: int = 10
    tbs: Optional[str] = None
    gl: Optional[str] = None
    hl: Optional[str] = None

@dataclass
class SerperSearchResult:
    """Single search result"""
    title: str
    link: str
    snippet: str
    date: Optional[str]
    position: int

@dataclass
class SerperSearchResponse:
    """Serper search API response"""
    search_parameters: Dict[str, Any]
    organic: List[SerperSearchResult]
    answer_box: Optional[Dict[str, Any]] = None
    knowledge_graph: Optional[Dict[str, Any]] = None

@dataclass
class SerperScrapeParams:
    """Parameters for Serper scrape API"""
    url: str

@dataclass
class SerperScrapeResponse:
    """Serper scrape API response"""
    url: str
    title: Optional[str]
    text: Optional[str]
    metadata: Optional[Dict[str, Any]]

class SerperClient:
    """Serper API client with multi-key rotation"""
    
    def __init__(self, config: SerperConfig):
        self.config = config
        self.api_keys = [k.strip() for k in config.api_key.split(',') if k.strip()]
        self.key_states = {
            self._get_key_id(key): KeyState(
                key=key,
                key_id=self._get_key_id(key),
                is_rate_limited=False,
                rate_limit_expiry=None,
                total_requests=0,
                last_used=None
            )
            for key in self.api_keys
        }
        self.current_key_index = 0
    
    async def search(self, params: SerperSearchParams) -> SerperSearchResponse:
        """Execute web search"""
        pass
    
    async def scrape(self, params: SerperScrapeParams) -> SerperScrapeResponse:
        """Scrape webpage content"""
        pass
    
    def _get_key_id(self, key: str) -> str:
        """Get key identifier (first 8 characters)"""
        return key[:8] if len(key) >= 8 else key
    
    def _is_rate_limit_error(self, response: requests.Response) -> bool:
        """Check if response indicates rate limit"""
        return response.status_code == 429
    
    def _is_blocking_error(self, response: requests.Response) -> bool:
        """Check if response indicates blocking error"""
        return response.status_code in [401, 403, 402]
    
    def _extract_retry_after(self, response: requests.Response) -> int:
        """Extract retry-after duration from response"""
        pass
    
    def _get_available_keys(self) -> List[str]:
        """Get list of available key IDs (LRU sorted)"""
        pass
    
    def _rotate_api_key(self, retry_after_seconds: int, context: Optional[Dict] = None) -> Optional[str]:
        """Rotate to next available API key"""
        pass
    
    def get_key_rotation_stats(self) -> Dict[str, Any]:
        """Get key rotation statistics"""
        pass
```



### 2. Tool Implementations

Tools provide the interface between the autonomous agent and the Serper API client.

#### search_web Tool

**TypeScript**: `tradewizard-agents/src/tools/serper-tools.ts`

```typescript
import { z } from 'zod';
import type { SerperClient } from '../utils/serper-client.js';
import type { ToolCache } from '../utils/tool-cache.js';

// Tool Context
interface ToolContext {
  serperClient: SerperClient;
  cache: ToolCache;
  auditLog: ToolAuditEntry[];
  agentName: string;
}

// Input Schema
const SearchWebInputSchema = z.object({
  query: z.string().describe('Search query string'),
  numResults: z.number().min(1).max(20).optional().default(10)
    .describe('Number of results to return (1-20)'),
  timeRange: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional()
    .describe('Time range filter: hour, day, week, month, year, or all'),
});

type SearchWebInput = z.infer<typeof SearchWebInputSchema>;

// Tool Implementation
async function searchWeb(
  input: SearchWebInput,
  context: ToolContext
): Promise<SerperSearchResult[] | ToolError> {
  return executeToolWithWrapper<SearchWebInput, SerperSearchResult[]>(
    'search_web',
    input,
    context,
    async (params, ctx) => {
      // Validate input
      const validation = validateToolInput(SearchWebInputSchema, params);
      if (!validation.success) {
        throw new Error(validation.error);
      }
      
      const validatedParams = validation.data;
      
      // Transform time range to Serper format
      const tbs = validatedParams.timeRange 
        ? `qdr:${validatedParams.timeRange[0]}` // 'hour' -> 'qdr:h'
        : undefined;
      
      // Call Serper API
      const response = await ctx.serperClient.search({
        q: validatedParams.query,
        num: validatedParams.numResults,
        tbs,
      });
      
      // Return organic results
      return response.organic || [];
    }
  );
}

// LangChain Tool Factory
function createSearchWebTool(context: ToolContext) {
  return {
    name: 'search_web',
    description: `Search the web for information using Google search.

Use this tool to:
- Find recent news and articles about market subjects
- Gather background information on events, people, or organizations
- Discover current developments and breaking news
- Identify authoritative sources for deeper research

Parameters:
- query: Search query string (required)
- numResults: Number of results (1-20, default: 10)
- timeRange: Filter by time - 'hour', 'day', 'week', 'month', 'year', or 'all'

Returns: Array of search results with title, link, snippet, and date.

Example usage:
- Recent news: { query: "Ukraine conflict latest", timeRange: "day" }
- Background: { query: "candidate biography policy positions" }
- Breaking news: { query: "Federal Reserve announcement", timeRange: "hour" }`,
    schema: SearchWebInputSchema,
    func: async (input: SearchWebInput) => {
      const result = await searchWeb(input, context);
      
      if (isToolError(result)) {
        return JSON.stringify({
          error: true,
          message: result.message,
        });
      }
      
      return JSON.stringify({
        success: true,
        resultCount: result.length,
        results: result,
      });
    },
  };
}
```

#### scrape_webpage Tool

**TypeScript**: `tradewizard-agents/src/tools/serper-tools.ts`

```typescript
// Input Schema
const ScrapeWebpageInputSchema = z.object({
  url: z.string().url().describe('URL to scrape'),
});

type ScrapeWebpageInput = z.infer<typeof ScrapeWebpageInputSchema>;

// Tool Implementation
async function scrapeWebpage(
  input: ScrapeWebpageInput,
  context: ToolContext
): Promise<SerperScrapeResponse | ToolError> {
  return executeToolWithWrapper<ScrapeWebpageInput, SerperScrapeResponse>(
    'scrape_webpage',
    input,
    context,
    async (params, ctx) => {
      // Validate input
      const validation = validateToolInput(ScrapeWebpageInputSchema, params);
      if (!validation.success) {
        throw new Error(validation.error);
      }
      
      const validatedParams = validation.data;
      
      // Call Serper scrape API
      const response = await ctx.serperClient.scrape({
        url: validatedParams.url,
      });
      
      return response;
    }
  );
}

// LangChain Tool Factory
function createScrapeWebpageTool(context: ToolContext) {
  return {
    name: 'scrape_webpage',
    description: `Extract full content from a webpage URL.

Use this tool to:
- Get complete article text from news URLs
- Extract detailed information from authoritative sources
- Read full policy documents or official statements
- Gather comprehensive context from specific pages

Parameters:
- url: Full URL to scrape (required, must be valid URL)

Returns: Webpage content including title, full text, and metadata.

Example usage:
- News article: { url: "https://example.com/article" }
- Official document: { url: "https://gov.example.com/policy" }
- Research paper: { url: "https://journal.example.com/paper" }

Note: Only scrape URLs from search results or known authoritative sources.`,
    schema: ScrapeWebpageInputSchema,
    func: async (input: ScrapeWebpageInput) => {
      const result = await scrapeWebpage(input, context);
      
      if (isToolError(result)) {
        return JSON.stringify({
          error: true,
          message: result.message,
        });
      }
      
      return JSON.stringify({
        success: true,
        url: result.url,
        title: result.title,
        textLength: result.text?.length || 0,
        text: result.text,
        metadata: result.metadata,
      });
    },
  };
}
```

**Python**: `doa/tools/serper_tools.py`

```python
from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List, Dict, Any, Union
from .serper_client import SerperClient, SerperSearchResult, SerperScrapeResponse

class ToolContext:
    """Tool execution context"""
    serper_client: SerperClient
    cache: Any  # ToolCache
    audit_log: List[Dict[str, Any]]
    agent_name: str

class SearchWebInput(BaseModel):
    """Input schema for search_web tool"""
    query: str = Field(..., description="Search query string")
    num_results: int = Field(10, ge=1, le=20, description="Number of results (1-20)")
    time_range: Optional[str] = Field(None, description="Time range: hour, day, week, month, year, all")

class ScrapeWebpageInput(BaseModel):
    """Input schema for scrape_webpage tool"""
    url: HttpUrl = Field(..., description="URL to scrape")

async def search_web(input: SearchWebInput, context: ToolContext) -> Union[List[SerperSearchResult], Dict]:
    """Execute web search"""
    # Implementation similar to TypeScript version
    pass

async def scrape_webpage(input: ScrapeWebpageInput, context: ToolContext) -> Union[SerperScrapeResponse, Dict]:
    """Scrape webpage content"""
    # Implementation similar to TypeScript version
    pass

def create_search_web_tool(context: ToolContext):
    """Create LangChain-compatible search_web tool"""
    pass

def create_scrape_webpage_tool(context: ToolContext):
    """Create LangChain-compatible scrape_webpage tool"""
    pass
```



### 3. Autonomous Agent Implementation

The Web Research Agent follows the same autonomous pattern as the Breaking News and Media Sentiment agents.

#### Agent System Prompt

```typescript
const WEB_RESEARCH_AGENT_SYSTEM_PROMPT = `Current date and time: ${new Date().toISOString()}

You are an autonomous web research analyst with the ability to search the web and extract webpage content.

Your role is to gather comprehensive, factual context about prediction markets by researching the web for relevant information about the events, people, organizations, and circumstances that drive market outcomes.

AVAILABLE TOOLS:
You have access to the following tools:

1. search_web: Search the web using Google search with time range filtering
2. scrape_webpage: Extract full content from specific webpage URLs

RESEARCH STRATEGY:
Based on the market question, intelligently formulate search queries and decide which sources to scrape:

QUERY FORMULATION:
- Extract key entities (people, organizations, locations, events) from the market question
- Identify the core event or decision being predicted
- Determine relevant timeframes (election dates, policy deadlines, event dates)
- Formulate 2-3 targeted search queries covering different aspects

SEARCH PRIORITIZATION:
- For geopolitical markets: Search for "conflict status", "diplomatic relations", "recent developments"
- For election markets: Search for "candidate polling", "campaign events", "endorsements"
- For policy markets: Search for "legislative status", "committee votes", "stakeholder positions"
- For company markets: Search for "recent news", "financial performance", "regulatory filings"
- For sports/entertainment: Search for "recent performance", "injury reports", "expert predictions"

SOURCE SELECTION FOR SCRAPING:
- Prioritize authoritative sources: major news outlets, official government sites, research institutions
- Scrape 2-4 highly relevant URLs that provide comprehensive information
- Avoid low-quality sources, social media posts, or opinion blogs
- Focus on recent sources (within relevant timeframe for the market)

TOOL USAGE LIMITS:
- Maximum 8 tool calls total (combining search and scrape operations)
- Typical pattern: 2-3 searches, 2-4 scrapes
- Start with broad search, then scrape most relevant sources
- If initial search yields poor results, reformulate query

RESEARCH DOCUMENT SYNTHESIS:
Your final output MUST be a comprehensive, well-structured research document that synthesizes all gathered information.

CRITICAL REQUIREMENTS:
- DO NOT output raw search results or lists of URLs
- DO NOT output snippets or fragments
- DO synthesize information from multiple sources into a coherent narrative
- DO organize information into clear sections
- DO include inline citations with URLs
- DO assess information recency and flag stale data
- DO identify conflicting information and explain discrepancies

DOCUMENT STRUCTURE:
Your research document should include:

1. Background: Historical context and foundational information
2. Current Status: Present state of affairs as of latest information
3. Key Events: Timeline of significant developments
4. Stakeholders: Relevant people, organizations, and their positions
5. Recent Developments: Latest news and changes (with dates)
6. Information Quality Assessment: Recency, source credibility, conflicts

WRITING STYLE:
- Plain, factual language with no speculation or ambiguous terms
- Highly informative and comprehensive
- Easily readable by other AI agents without domain expertise
- Include specific dates, numbers, and concrete facts
- Cite sources inline: "According to [Source Name](URL), ..."

OUTPUT FORMAT:
Provide your analysis as a structured signal with:
- confidence: Your confidence in research quality (0-1, based on source credibility, recency, comprehensiveness)
- direction: NEUTRAL (research agents don't predict outcomes)
- fairProbability: 0.5 (research agents don't estimate probabilities)
- keyDrivers: Your comprehensive research document (NOT raw search results)
- riskFactors: Information gaps, stale data, conflicting sources, or research limitations
- metadata: Include source count, search queries used, URLs scraped, information recency

Be thorough and document your research process.`;
```

#### Agent Node Implementation

**TypeScript**: `tradewizard-agents/src/nodes/web-research-agent.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createLLMInstance } from '../utils/llm-factory.js';
import { SerperClient } from '../utils/serper-client.js';
import { ToolCache } from '../utils/tool-cache.js';
import { createSearchWebTool, createScrapeWebpageTool } from '../tools/serper-tools.js';
import type { GraphStateType } from '../models/state.js';
import type { AgentSignal } from '../models/types.js';
import type { EngineConfig } from '../config/index.js';

/**
 * Create Web Research Agent node
 * 
 * This node creates an autonomous agent that searches the web and scrapes
 * webpages to gather comprehensive context about prediction markets.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1-2.7, 3.1-3.11, 4.1-4.11, 5.1-5.13
 */
export function createWebResearchAgentNode(
  config: EngineConfig
): (state: GraphStateType) => Promise<Partial<GraphStateType>> {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const startTime = Date.now();
    const agentName = 'web_research';
    
    let toolAuditLog: ToolAuditEntry[] = [];
    let cache: ToolCache | null = null;
    
    try {
      // Check for MBD availability
      if (!state.mbd) {
        console.error(`[${agentName}] No Market Briefing Document available`);
        return {
          agentErrors: [{
            type: 'EXECUTION_FAILED',
            agentName,
            error: new Error('No Market Briefing Document available'),
          }],
        };
      }
      
      // Check for Serper configuration
      if (!config.serper || !config.serper.apiKey) {
        console.warn(`[${agentName}] Serper API not configured, returning graceful degradation`);
        
        // Return low-confidence neutral signal
        const signal: AgentSignal = {
          agentName,
          confidence: 0.1,
          direction: 'NEUTRAL',
          fairProbability: 0.5,
          keyDrivers: [
            'Web research unavailable: Serper API key not configured',
            'Unable to gather external context for this market',
            'Other agents will proceed without web research context',
          ],
          riskFactors: [
            'No web research performed',
            'Limited external context available',
          ],
          metadata: {
            webResearchAvailable: false,
            reason: 'API key not configured',
          },
        };
        
        return {
          agentSignals: [signal],
          auditLog: [{
            stage: `agent_${agentName}`,
            timestamp: Date.now(),
            data: {
              agentName,
              success: true,
              gracefulDegradation: true,
              duration: Date.now() - startTime,
            },
          }],
        };
      }
      
      // Initialize Serper client
      const serperClient = new SerperClient({
        apiKey: config.serper.apiKey,
        searchUrl: config.serper.searchUrl,
        scrapeUrl: config.serper.scrapeUrl,
        timeout: config.serper.timeout || 30000,
      });
      
      // Initialize tool cache
      cache = new ToolCache();
      toolAuditLog = [];
      
      // Create tool context
      const toolContext: ToolContext = {
        serperClient,
        cache,
        auditLog: toolAuditLog,
        agentName,
      };
      
      // Create tools
      const tools = [
        createSearchWebTool(toolContext),
        createScrapeWebpageTool(toolContext),
      ];
      
      // Create LLM instance
      const llm = createLLMInstance(config, 'google', ['openai', 'anthropic']);
      
      // Create ReAct agent
      const agent = createReactAgent({
        llm,
        tools,
        messageModifier: WEB_RESEARCH_AGENT_SYSTEM_PROMPT,
      });
      
      // Prepare agent input
      const agentInput = {
        messages: [{
          role: 'user',
          content: `Analyze this prediction market and gather comprehensive web research:

Market Question: ${state.mbd.question}
Market Description: ${state.mbd.description || 'N/A'}
Market Category: ${state.mbd.category || 'N/A'}
Market Tags: ${state.mbd.tags?.join(', ') || 'N/A'}

Please search the web and scrape relevant sources to provide comprehensive context about this market.`,
        }],
      };
      
      // Execute agent with timeout
      const maxToolCalls = config.webResearch?.maxToolCalls || 8;
      const timeout = config.webResearch?.timeout || 60000;
      
      const agentResult = await Promise.race([
        agent.invoke(agentInput, {
          recursionLimit: maxToolCalls + 5, // Allow for reasoning steps
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Agent timeout')), timeout)
        ),
      ]);
      
      // Extract final message
      const finalMessage = agentResult.messages[agentResult.messages.length - 1];
      const agentOutput = finalMessage.content;
      
      // Parse agent output as signal
      let signal: AgentSignal;
      try {
        signal = JSON.parse(agentOutput);
      } catch {
        // If parsing fails, create signal from text output
        signal = {
          agentName,
          confidence: 0.7,
          direction: 'NEUTRAL',
          fairProbability: 0.5,
          keyDrivers: [agentOutput],
          riskFactors: ['Unable to parse structured output'],
          metadata: {
            parseError: true,
          },
        };
      }
      
      // Add tool usage metadata
      const toolUsage = getToolUsageSummary(toolAuditLog);
      signal.metadata = {
        ...signal.metadata,
        toolsCalled: toolUsage.toolsCalled,
        totalToolTime: toolUsage.totalToolTime,
        cacheHits: toolUsage.cacheHits,
        cacheMisses: toolUsage.cacheMisses,
        toolBreakdown: toolUsage.toolBreakdown,
      };
      
      return {
        agentSignals: [signal],
        auditLog: [{
          stage: `agent_${agentName}`,
          timestamp: Date.now(),
          data: {
            agentName,
            success: true,
            duration: Date.now() - startTime,
            toolUsage,
          },
        }],
      };
      
    } catch (error) {
      console.error(`[${agentName}] Error:`, error);
      
      return {
        agentErrors: [{
          type: 'EXECUTION_FAILED',
          agentName,
          error: error instanceof Error ? error : new Error(String(error)),
        }],
        auditLog: [{
          stage: `agent_${agentName}`,
          timestamp: Date.now(),
          data: {
            agentName,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - startTime,
          },
        }],
      };
    }
  };
}
```

**Python**: `doa/nodes/web_research_agent.py`

```python
from langgraph.prebuilt import create_react_agent
from typing import Dict, Any
from ..tools.serper_client import SerperClient
from ..tools.serper_tools import create_search_web_tool, create_scrape_webpage_tool
from ..models.state import GraphState
from ..models.types import AgentSignal
from ..config import Config
import json
import time

WEB_RESEARCH_AGENT_SYSTEM_PROMPT = """..."""  # Same as TypeScript

async def web_research_agent_node(state: GraphState, config: Config) -> Dict[str, Any]:
    """Web Research Agent node for LangGraph workflow"""
    start_time = time.time()
    agent_name = "web_research"
    
    try:
        # Check for MBD
        if not state.get("mbd"):
            return {
                "agent_errors": [{
                    "type": "EXECUTION_FAILED",
                    "agent_name": agent_name,
                    "error": "No Market Briefing Document available",
                }]
            }
        
        # Check for Serper configuration
        if not config.serper or not config.serper.api_key:
            # Graceful degradation
            signal = AgentSignal(
                agent_name=agent_name,
                confidence=0.1,
                direction="NEUTRAL",
                fair_probability=0.5,
                key_drivers=[
                    "Web research unavailable: Serper API key not configured",
                ],
                risk_factors=["No web research performed"],
                metadata={"web_research_available": False},
            )
            
            return {
                "agent_signals": [signal],
                "audit_log": [{
                    "stage": f"agent_{agent_name}",
                    "timestamp": time.time(),
                    "data": {
                        "agent_name": agent_name,
                        "success": True,
                        "graceful_degradation": True,
                    },
                }],
            }
        
        # Initialize Serper client
        serper_client = SerperClient(config.serper)
        
        # Create tools
        tool_context = {
            "serper_client": serper_client,
            "cache": {},  # Simple dict cache for Python
            "audit_log": [],
            "agent_name": agent_name,
        }
        
        tools = [
            create_search_web_tool(tool_context),
            create_scrape_webpage_tool(tool_context),
        ]
        
        # Create LLM
        llm = create_llm_instance(config, "google", ["openai", "anthropic"])
        
        # Create ReAct agent
        agent = create_react_agent(
            llm=llm,
            tools=tools,
            system_message=WEB_RESEARCH_AGENT_SYSTEM_PROMPT,
        )
        
        # Execute agent
        agent_input = {
            "messages": [{
                "role": "user",
                "content": f"""Analyze this prediction market and gather comprehensive web research:

Market Question: {state['mbd']['question']}
Market Description: {state['mbd'].get('description', 'N/A')}

Please search the web and scrape relevant sources to provide comprehensive context.""",
            }]
        }
        
        result = await agent.ainvoke(agent_input)
        
        # Parse output
        final_message = result["messages"][-1]
        agent_output = final_message.content
        
        try:
            signal = json.loads(agent_output)
        except:
            signal = {
                "agent_name": agent_name,
                "confidence": 0.7,
                "direction": "NEUTRAL",
                "fair_probability": 0.5,
                "key_drivers": [agent_output],
                "risk_factors": ["Unable to parse structured output"],
                "metadata": {"parse_error": True},
            }
        
        return {
            "agent_signals": [signal],
            "audit_log": [{
                "stage": f"agent_{agent_name}",
                "timestamp": time.time(),
                "data": {
                    "agent_name": agent_name,
                    "success": True,
                    "duration": time.time() - start_time,
                },
            }],
        }
        
    except Exception as e:
        return {
            "agent_errors": [{
                "type": "EXECUTION_FAILED",
                "agent_name": agent_name,
                "error": str(e),
            }],
        }
```



## Data Models

### TypeScript Types

**File**: `tradewizard-agents/src/models/types.ts` (additions)

```typescript
// Serper-specific types
export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  position: number;
}

export interface SerperScrapeResult {
  url: string;
  title?: string;
  text?: string;
  metadata?: {
    description?: string;
    keywords?: string;
    author?: string;
    publishedDate?: string;
  };
}

// Web Research Agent configuration
export interface WebResearchConfig {
  enabled: boolean;
  maxToolCalls: number;
  timeout: number;
}

// Serper configuration
export interface SerperConfig {
  apiKey: string;
  searchUrl?: string;
  scrapeUrl?: string;
  timeout?: number;
}
```

### Python Types

**File**: `doa/models/types.py` (additions)

```python
from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, Any

class SerperSearchResult(BaseModel):
    """Single search result from Serper API"""
    title: str
    link: str
    snippet: str
    date: Optional[str] = None
    position: int

class SerperScrapeResult(BaseModel):
    """Scraped webpage content from Serper API"""
    url: str
    title: Optional[str] = None
    text: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class WebResearchConfig(BaseModel):
    """Web Research Agent configuration"""
    enabled: bool = True
    max_tool_calls: int = 8
    timeout: int = 60

class SerperConfig(BaseModel):
    """Serper API configuration"""
    api_key: str
    search_url: str = "https://google.serper.dev"
    scrape_url: str = "https://scrape.serper.dev"
    timeout: int = 30
```

### GraphState Updates

The Web Research Agent adds its signal to the existing `agentSignals` array. No changes to GraphState structure are required.

**Agent Signal Format**:
```typescript
{
  agentName: 'web_research',
  confidence: 0.85,  // Based on source quality, recency, comprehensiveness
  direction: 'NEUTRAL',  // Research agents don't predict
  fairProbability: 0.5,  // Research agents don't estimate
  keyDrivers: [
    // Comprehensive research document (NOT raw search results)
    `# Background\n\n[Synthesized background information with inline citations]\n\n# Current Status\n\n[Current state of affairs]...`,
  ],
  riskFactors: [
    'Some sources are 2+ weeks old',
    'Conflicting information found between Source A and Source B regarding X',
    'Limited information available about Y',
  ],
  metadata: {
    toolsCalled: 6,
    totalToolTime: 8500,
    cacheHits: 2,
    cacheMisses: 4,
    toolBreakdown: {
      search_web: 2,
      scrape_webpage: 4,
    },
    searchQueries: ['query1', 'query2'],
    urlsScraped: ['url1', 'url2', 'url3', 'url4'],
    oldestSource: '2024-01-15',
    newestSource: '2024-02-01',
  },
}
```



## Error Handling

### Error Categories

The Web Research Agent implements comprehensive error handling across multiple layers:

#### 1. API Key Rotation Errors

**Blocking Errors** (trigger immediate rotation):
- HTTP 429: Rate limit exceeded
- HTTP 401: Unauthorized (invalid key)
- HTTP 403: Forbidden (blocked key)
- HTTP 402: Payment required (quota exhausted)

**Rotation Logic**:
```typescript
// When blocking error detected:
1. Mark current key as rate-limited with expiry timestamp
2. Log rotation event with context (endpoint, agent, params)
3. Get available keys (auto-expire expired rate limits)
4. Select least recently used (LRU) available key
5. Retry request with new key (doesn't count as retry attempt)
6. If all keys exhausted: return graceful degradation (empty results)
```

**Key State Transitions**:
```
Available → Rate Limited (on 429, with expiry)
Available → Blocked (on 401/403/402, permanent)
Rate Limited → Available (when expiry time passes)
```

#### 2. Network and Timeout Errors

**Timeout Handling**:
- Serper API client: 30 second timeout per request
- Agent execution: 60 second timeout total
- Retry logic: Exponential backoff (1s, 2s, 4s)

**Network Error Handling**:
```typescript
try {
  const response = await fetch(url, { timeout: 30000 });
} catch (error) {
  if (error.name === 'TimeoutError') {
    // Log timeout, retry with backoff
  } else if (error.code === 'ECONNREFUSED') {
    // Log connection error, retry
  } else {
    // Log unknown error, fail gracefully
  }
}
```

#### 3. Tool Execution Errors

**Tool Error Handling**:
- Invalid input: Validate with Zod schema, return validation error
- API error: Log error, return ToolError object
- Parsing error: Log error, return empty results
- Cache error: Log warning, proceed without cache

**Tool Error Format**:
```typescript
interface ToolError {
  error: true;
  message: string;
  toolName: string;
  code?: string;
}
```

#### 4. Agent Execution Errors

**Agent Error Scenarios**:
- Missing MBD: Return error in agentErrors array
- Missing API key: Return graceful degradation signal
- Agent timeout: Return partial results with timeout flag
- LLM error: Log error, return fallback signal
- Parsing error: Wrap raw output in signal structure

**Graceful Degradation Signal**:
```typescript
{
  agentName: 'web_research',
  confidence: 0.1,
  direction: 'NEUTRAL',
  fairProbability: 0.5,
  keyDrivers: [
    'Web research unavailable: [reason]',
    'Unable to gather external context',
  ],
  riskFactors: ['No web research performed'],
  metadata: {
    webResearchAvailable: false,
    reason: 'API key not configured | timeout | error',
  },
}
```

### Error Recovery Strategies

#### Automatic Recovery
- Key rotation: Automatic on rate limits
- Retry with backoff: Automatic on transient errors
- Cache fallback: Use cached results if available
- Partial results: Return what was gathered before error

#### Manual Recovery
- Key exhaustion: Requires waiting for rate limit expiry or adding new keys
- Invalid keys: Requires key replacement in configuration
- API service outage: Requires waiting for service restoration

### Error Logging

All errors are logged with comprehensive context:

```typescript
{
  timestamp: Date.now(),
  agentName: 'web_research',
  errorType: 'RATE_LIMIT' | 'TIMEOUT' | 'API_ERROR' | 'VALIDATION_ERROR',
  errorMessage: string,
  errorContext: {
    endpoint: 'search' | 'scrape',
    params: any,
    keyId: string,
    retryAttempt: number,
    duration: number,
  },
}
```



## Configuration

### Environment Variables

#### TypeScript (tradewizard-agents)

**File**: `.env`

```bash
# Serper API Configuration
SERPER_API_KEY=key1,key2,key3              # Comma-separated API keys
SERPER_SEARCH_URL=https://google.serper.dev # Optional, default shown
SERPER_SCRAPE_URL=https://scrape.serper.dev # Optional, default shown
SERPER_TIMEOUT=30000                        # Optional, default 30 seconds

# Web Research Agent Configuration
WEB_RESEARCH_ENABLED=true                   # Optional, default true
WEB_RESEARCH_MAX_TOOL_CALLS=8              # Optional, default 8
WEB_RESEARCH_TIMEOUT=60000                  # Optional, default 60 seconds
```

**File**: `.env.example` (add these lines)

```bash
# Serper API for web research (optional)
# Get API keys from https://serper.dev
# Multiple keys supported (comma-separated) for automatic rotation
SERPER_API_KEY=your_serper_api_key_here

# Web Research Agent Settings (optional)
WEB_RESEARCH_ENABLED=true
WEB_RESEARCH_MAX_TOOL_CALLS=8
WEB_RESEARCH_TIMEOUT=60000
```

#### Python (doa)

**File**: `.env`

```bash
# Serper API Configuration
SERPER_API_KEY=key1,key2,key3
SERPER_SEARCH_URL=https://google.serper.dev
SERPER_SCRAPE_URL=https://scrape.serper.dev
SERPER_TIMEOUT=30

# Web Research Agent Configuration
WEB_RESEARCH_ENABLED=true
WEB_RESEARCH_MAX_TOOL_CALLS=8
WEB_RESEARCH_TIMEOUT=60
```

### Configuration Loading

#### TypeScript

**File**: `tradewizard-agents/src/config/index.ts` (additions)

```typescript
export interface SerperConfig {
  apiKey: string;
  searchUrl: string;
  scrapeUrl: string;
  timeout: number;
}

export interface WebResearchConfig {
  enabled: boolean;
  maxToolCalls: number;
  timeout: number;
}

export interface EngineConfig {
  // ... existing config
  serper?: SerperConfig;
  webResearch?: WebResearchConfig;
}

export function loadConfig(): EngineConfig {
  // ... existing config loading
  
  // Load Serper configuration
  const serperConfig: SerperConfig | undefined = process.env.SERPER_API_KEY
    ? {
        apiKey: process.env.SERPER_API_KEY,
        searchUrl: process.env.SERPER_SEARCH_URL || 'https://google.serper.dev',
        scrapeUrl: process.env.SERPER_SCRAPE_URL || 'https://scrape.serper.dev',
        timeout: parseInt(process.env.SERPER_TIMEOUT || '30000'),
      }
    : undefined;
  
  // Load Web Research configuration
  const webResearchConfig: WebResearchConfig = {
    enabled: process.env.WEB_RESEARCH_ENABLED !== 'false',
    maxToolCalls: parseInt(process.env.WEB_RESEARCH_MAX_TOOL_CALLS || '8'),
    timeout: parseInt(process.env.WEB_RESEARCH_TIMEOUT || '60000'),
  };
  
  return {
    // ... existing config
    serper: serperConfig,
    webResearch: webResearchConfig,
  };
}
```

#### Python

**File**: `doa/config.py` (additions)

```python
from dataclasses import dataclass
from typing import Optional
import os

@dataclass
class SerperConfig:
    """Serper API configuration"""
    api_key: str
    search_url: str = "https://google.serper.dev"
    scrape_url: str = "https://scrape.serper.dev"
    timeout: int = 30

@dataclass
class WebResearchConfig:
    """Web Research Agent configuration"""
    enabled: bool = True
    max_tool_calls: int = 8
    timeout: int = 60

@dataclass
class Config:
    # ... existing config
    serper: Optional[SerperConfig] = None
    web_research: WebResearchConfig = None

def load_config() -> Config:
    """Load configuration from environment variables"""
    # ... existing config loading
    
    # Load Serper configuration
    serper_config = None
    if os.getenv("SERPER_API_KEY"):
        serper_config = SerperConfig(
            api_key=os.getenv("SERPER_API_KEY"),
            search_url=os.getenv("SERPER_SEARCH_URL", "https://google.serper.dev"),
            scrape_url=os.getenv("SERPER_SCRAPE_URL", "https://scrape.serper.dev"),
            timeout=int(os.getenv("SERPER_TIMEOUT", "30")),
        )
    
    # Load Web Research configuration
    web_research_config = WebResearchConfig(
        enabled=os.getenv("WEB_RESEARCH_ENABLED", "true").lower() == "true",
        max_tool_calls=int(os.getenv("WEB_RESEARCH_MAX_TOOL_CALLS", "8")),
        timeout=int(os.getenv("WEB_RESEARCH_TIMEOUT", "60")),
    )
    
    return Config(
        # ... existing config
        serper=serper_config,
        web_research=web_research_config,
    )
```

### Workflow Integration

#### TypeScript

**File**: `tradewizard-agents/src/workflow.ts` (modifications)

```typescript
import { createWebResearchAgentNode } from './nodes/web-research-agent.js';

export function createWorkflow(config: EngineConfig) {
  const workflow = new StateGraph<GraphStateType>({
    channels: graphStateChannels,
  });
  
  // Add nodes
  workflow.addNode('market_ingestion', marketIngestionNode);
  workflow.addNode('memory_retrieval', memoryRetrievalNode);
  
  // Add Web Research Agent node (conditional)
  if (config.webResearch?.enabled) {
    workflow.addNode('web_research', createWebResearchAgentNode(config));
  }
  
  workflow.addNode('dynamic_agent_selection', dynamicAgentSelectionNode);
  // ... rest of nodes
  
  // Add edges
  workflow.addEdge('__start__', 'market_ingestion');
  workflow.addEdge('market_ingestion', 'memory_retrieval');
  
  // Conditional edge for web research
  if (config.webResearch?.enabled) {
    workflow.addEdge('memory_retrieval', 'web_research');
    workflow.addEdge('web_research', 'dynamic_agent_selection');
  } else {
    workflow.addEdge('memory_retrieval', 'dynamic_agent_selection');
  }
  
  // ... rest of edges
  
  return workflow.compile();
}
```

#### Python

**File**: `doa/main.py` (modifications)

```python
from langgraph.graph import StateGraph
from .nodes.web_research_agent import web_research_agent_node

def create_workflow(config: Config):
    """Create LangGraph workflow"""
    workflow = StateGraph(GraphState)
    
    # Add nodes
    workflow.add_node("market_ingestion", market_ingestion_node)
    workflow.add_node("memory_retrieval", memory_retrieval_node)
    
    # Add Web Research Agent node (conditional)
    if config.web_research.enabled:
        workflow.add_node("web_research", lambda state: web_research_agent_node(state, config))
    
    workflow.add_node("dynamic_agent_selection", dynamic_agent_selection_node)
    # ... rest of nodes
    
    # Add edges
    workflow.set_entry_point("market_ingestion")
    workflow.add_edge("market_ingestion", "memory_retrieval")
    
    # Conditional edge for web research
    if config.web_research.enabled:
        workflow.add_edge("memory_retrieval", "web_research")
        workflow.add_edge("web_research", "dynamic_agent_selection")
    else:
        workflow.add_edge("memory_retrieval", "dynamic_agent_selection")
    
    # ... rest of edges
    
    return workflow.compile()
```

### Default Values Summary

| Configuration | Default Value | Description |
|--------------|---------------|-------------|
| SERPER_API_KEY | (none) | Required for web research, supports comma-separated keys |
| SERPER_SEARCH_URL | https://google.serper.dev | Serper search endpoint |
| SERPER_SCRAPE_URL | https://scrape.serper.dev | Serper scrape endpoint |
| SERPER_TIMEOUT | 30000ms (30s) | Timeout per API request |
| WEB_RESEARCH_ENABLED | true | Enable/disable web research agent |
| WEB_RESEARCH_MAX_TOOL_CALLS | 8 | Maximum tool calls per analysis |
| WEB_RESEARCH_TIMEOUT | 60000ms (60s) | Total agent execution timeout |



## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Agent State Update Structure

*For any* valid GraphState input, when the Web Research Agent executes, it should return a dictionary containing either agentSignals or agentErrors arrays, and an auditLog array.

**Validates: Requirements 1.4, 6.3, 6.4**

### Property 2: API Key Parsing

*For any* comma-separated string of API keys (with or without whitespace), the Serper client should parse them into an array where each element is a trimmed, non-empty key string.

**Validates: Requirements 2.5, 7.8**

### Property 3: Search Parameter Validation

*For any* search request with num_results parameter, the actual number requested from the API should be clamped to the range [1, 20], with a default of 10 if not specified.

**Validates: Requirements 2.2, 3.5**

### Property 4: Scrape Request Validity

*For any* valid URL string, the scrape method should successfully construct and execute a request to the scrape endpoint without throwing validation errors.

**Validates: Requirements 2.3**

### Property 5: Error Handling Resilience

*For any* error that occurs during Serper API calls (rate limits, timeouts, network errors), the client should return an error object rather than throwing an unhandled exception.

**Validates: Requirements 2.4, 3.7, 8.11**

### Property 6: Key Rotation on Rate Limit

*For any* API request that receives an HTTP 429 response, the next request should use a different API key (if multiple keys are available), and the original key should be marked as rate-limited.

**Validates: Requirements 2.6, 8.6, 11.9**

### Property 7: Tool Result Caching

*For any* tool invocation with specific parameters, if the same tool is called again with identical parameters within the same session, the second call should be a cache hit and not make an actual API request.

**Validates: Requirements 3.8**

### Property 8: Tool Audit Logging

*For any* tool invocation (search_web or scrape_webpage), an entry should be added to the audit log containing the tool name, parameters, timestamp, and result or error.

**Validates: Requirements 3.9**

### Property 9: Search Result Structure

*For any* successful search_web tool invocation that returns results, each result object should contain the required fields: title, link, snippet, and position.

**Validates: Requirements 3.3**

### Property 10: Scrape Result Structure

*For any* successful scrape_webpage tool invocation, the response should contain the url field and at least one of: title, text, or metadata.

**Validates: Requirements 3.4**

### Property 11: Tool Call Limit

*For any* Web Research Agent execution, the total number of tool calls (search_web + scrape_webpage) should not exceed the configured maximum (default: 8).

**Validates: Requirements 4.4**

### Property 12: Agent Signal Structure

*For any* successful Web Research Agent execution, the output signal should contain all required AgentSignal fields: agentName, confidence, direction, fairProbability, keyDrivers, riskFactors, and metadata.

**Validates: Requirements 5.12**

### Property 13: Confidence Score Range

*For any* Web Research Agent execution that produces a signal, the confidence score should be a number between 0 and 1 (inclusive).

**Validates: Requirements 5.13**

### Property 14: Research Document Not Raw Results

*For any* Web Research Agent output, the keyDrivers field should not be a JSON array of search results, but rather a synthesized text document.

**Validates: Requirements 5.6**

### Property 15: Inline Citations

*For any* Web Research Agent output that includes URLs, those URLs should appear inline within the text content, not as a separate list structure at the end.

**Validates: Requirements 5.9**

### Property 16: Workflow Error Resilience

*For any* error or timeout in the Web Research Agent, the workflow should continue execution and not terminate, with the error captured in the agentErrors array.

**Validates: Requirements 6.5**

### Property 17: Key ID Generation

*For any* API key string, the getKeyId() method should return the first 8 characters if the key is 8+ characters long, or the full key if shorter.

**Validates: Requirements 11.2**

### Property 18: Retry-After Header Parsing

*For any* HTTP response with a Retry-After header containing an integer, the extractRetryAfter() method should parse it correctly as seconds; if the header is missing or invalid, it should default to 900 seconds (15 minutes).

**Validates: Requirements 11.5**

### Property 19: Available Keys Auto-Expiry

*For any* key marked as rate-limited with an expiry timestamp in the past, the getAvailableKeys() method should include that key in the available keys list (auto-expiry).

**Validates: Requirements 11.6, 11.12**

### Property 20: LRU Key Selection

*For any* key rotation operation when multiple keys are available, the selected key should be the one with the oldest lastUsed timestamp (or null if never used).

**Validates: Requirements 11.7, 11.11**

### Property 21: Key State Update After Success

*For any* successful API request, the used key's lastUsed timestamp should be updated to the current time, and its totalRequests counter should be incremented by 1.

**Validates: Requirements 11.15**

### Property 22: Rotation Retry Exemption

*For any* API request that triggers key rotation, the retry with the new key should not count toward the configured retry limit (e.g., if retry limit is 3, rotation retries are additional).

**Validates: Requirements 11.16**

### Property 23: Key Rotation Logging

*For any* key rotation event (rate limit detected, key rotated, all keys exhausted), an entry should be logged with the event type, key IDs involved, and relevant context.

**Validates: Requirements 11.14**



## Testing Strategy

### Dual Testing Approach

The Web Research Agent requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, error conditions, and integration points
- **Property tests**: Verify universal properties across all inputs through randomization

Both approaches are complementary and necessary. Unit tests catch concrete bugs and validate specific scenarios, while property tests verify general correctness across a wide input space.

### Property-Based Testing Configuration

**Library Selection**:
- TypeScript: `fast-check` (already used in the codebase)
- Python: `hypothesis` (standard for Python PBT)

**Test Configuration**:
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property
- Tag format: `Feature: web-research-agent, Property {number}: {property_text}`

**Example Property Test Structure** (TypeScript):

```typescript
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Web Research Agent - Property Tests', () => {
  it('Property 2: API Key Parsing - should parse comma-separated keys correctly', () => {
    // Feature: web-research-agent, Property 2: API Key Parsing
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
        (keys) => {
          const apiKeyString = keys.join(',');
          const client = new SerperClient({ apiKey: apiKeyString });
          
          const parsedKeys = client.getApiKeys();
          
          // Should have same number of keys
          expect(parsedKeys.length).toBe(keys.length);
          
          // Each key should be trimmed
          parsedKeys.forEach((key, i) => {
            expect(key).toBe(keys[i].trim());
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Testing Strategy

#### 1. Serper API Client Tests

**File**: `tradewizard-agents/src/utils/serper-client.test.ts`

Test categories:
- **Configuration**: API key parsing, default values, multi-key initialization
- **Search endpoint**: Parameter validation, request construction, response parsing
- **Scrape endpoint**: URL validation, request construction, response parsing
- **Key rotation**: Rate limit detection, LRU selection, state updates, expiry handling
- **Error handling**: HTTP errors (401, 403, 402, 429), network errors, timeouts
- **Graceful degradation**: All keys exhausted, missing API key

Example tests:
```typescript
describe('SerperClient - Key Rotation', () => {
  it('should rotate to next key on HTTP 429', async () => {
    const client = new SerperClient({ apiKey: 'key1,key2,key3' });
    
    // Mock first request returns 429
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }));
    // Mock second request succeeds
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ organic: [] })));
    
    await client.search({ q: 'test' });
    
    // Should have made 2 requests with different keys
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstKey = extractKeyFromUrl(mockFetch.mock.calls[0][0]);
    const secondKey = extractKeyFromUrl(mockFetch.mock.calls[1][0]);
    expect(firstKey).not.toBe(secondKey);
  });
  
  it('should return empty results when all keys exhausted', async () => {
    const client = new SerperClient({ apiKey: 'key1,key2' });
    
    // Mock all requests return 429
    mockFetch.mockResolvedValue(new Response(null, { status: 429 }));
    
    const result = await client.search({ q: 'test' });
    
    // Should return graceful degradation
    expect(result.organic).toEqual([]);
  });
});
```

#### 2. Tool Tests

**File**: `tradewizard-agents/src/tools/serper-tools.test.ts`

Test categories:
- **Input validation**: Zod schema validation, parameter defaults
- **Tool execution**: Successful calls, error handling, result formatting
- **Caching**: Cache hits, cache misses, cache key generation
- **Audit logging**: Log entry creation, log content validation

Example tests:
```typescript
describe('search_web Tool', () => {
  it('should validate input parameters', async () => {
    const result = await searchWeb(
      { query: 'test', numResults: 25 }, // exceeds max
      mockContext
    );
    
    expect(isToolError(result)).toBe(true);
    expect(result.message).toContain('numResults');
  });
  
  it('should cache results for duplicate calls', async () => {
    const params = { query: 'test', numResults: 10 };
    
    // First call
    await searchWeb(params, mockContext);
    expect(mockContext.serperClient.search).toHaveBeenCalledTimes(1);
    
    // Second call with same params
    await searchWeb(params, mockContext);
    expect(mockContext.serperClient.search).toHaveBeenCalledTimes(1); // No additional call
    expect(mockContext.auditLog[1].cacheHit).toBe(true);
  });
});
```

#### 3. Agent Node Tests

**File**: `tradewizard-agents/src/nodes/web-research-agent.test.ts`

Test categories:
- **Input validation**: Missing MBD, invalid state
- **Configuration**: Missing API key, disabled agent
- **Agent execution**: Successful execution, timeout handling
- **Output validation**: Signal structure, metadata inclusion
- **Error handling**: Agent errors, tool errors, graceful degradation

Example tests:
```typescript
describe('Web Research Agent Node', () => {
  it('should return graceful degradation when API key not configured', async () => {
    const config = { ...mockConfig, serper: undefined };
    const node = createWebResearchAgentNode(config);
    
    const result = await node(mockState);
    
    expect(result.agentSignals).toHaveLength(1);
    expect(result.agentSignals[0].confidence).toBeLessThan(0.2);
    expect(result.agentSignals[0].metadata.webResearchAvailable).toBe(false);
  });
  
  it('should enforce tool call limit', async () => {
    const config = { ...mockConfig, webResearch: { maxToolCalls: 3 } };
    const node = createWebResearchAgentNode(config);
    
    const result = await node(mockState);
    
    const toolUsage = result.agentSignals[0].metadata.toolsCalled;
    expect(toolUsage).toBeLessThanOrEqual(3);
  });
});
```

#### 4. Integration Tests

**File**: `tradewizard-agents/src/nodes/web-research-agent.integration.test.ts`

Test categories:
- **End-to-end**: Real API calls (when API key available)
- **Workflow integration**: Agent execution within workflow
- **Multi-key rotation**: Real rate limit scenarios
- **Performance**: Response times, timeout behavior

Example tests:
```typescript
describe('Web Research Agent - Integration', () => {
  it('should successfully search and scrape with real API', async () => {
    if (!process.env.SERPER_API_KEY) {
      console.log('Skipping integration test: SERPER_API_KEY not set');
      return;
    }
    
    const config = loadConfig();
    const node = createWebResearchAgentNode(config);
    
    const result = await node(mockStateWithRealMarket);
    
    expect(result.agentSignals).toHaveLength(1);
    expect(result.agentSignals[0].keyDrivers[0]).not.toContain('[');  // Not raw JSON
    expect(result.agentSignals[0].metadata.toolsCalled).toBeGreaterThan(0);
  }, 60000); // 60 second timeout
});
```

### Python Testing Strategy

Similar structure to TypeScript, using pytest and hypothesis:

**Files**:
- `doa/tools/test_serper_client.py`
- `doa/tools/test_serper_tools.py`
- `doa/nodes/test_web_research_agent.py`
- `doa/nodes/test_web_research_agent_integration.py`

**Property Test Example** (Python):

```python
from hypothesis import given, strategies as st
import pytest

@given(st.lists(st.text(min_size=1), min_size=1, max_size=5))
def test_api_key_parsing_property(keys):
    """Property 2: API Key Parsing"""
    # Feature: web-research-agent, Property 2: API Key Parsing
    api_key_string = ','.join(keys)
    client = SerperClient(SerperConfig(api_key=api_key_string))
    
    parsed_keys = client.get_api_keys()
    
    assert len(parsed_keys) == len(keys)
    for i, key in enumerate(parsed_keys):
        assert key == keys[i].strip()
```

### Test Coverage Goals

- **Unit test coverage**: >80% line coverage for all new code
- **Property test coverage**: All 23 correctness properties implemented
- **Integration test coverage**: Key user flows with real API calls
- **Error scenario coverage**: All error codes (401, 403, 402, 429) tested

### Continuous Integration

All tests should run in CI pipeline:
- Unit tests: Run on every commit
- Property tests: Run on every commit (100 iterations)
- Integration tests: Run on PR merge (requires API key secret)
- Performance tests: Run nightly



## Implementation Roadmap

### Phase 1: Core Infrastructure (TypeScript)

1. **Serper API Client** (`src/utils/serper-client.ts`)
   - Implement KeyState management
   - Implement search() and scrape() methods
   - Implement key rotation logic (following NewsData pattern exactly)
   - Add comprehensive error handling
   - Write unit tests

2. **Tool Layer** (`src/tools/serper-tools.ts`)
   - Implement search_web tool with Zod validation
   - Implement scrape_webpage tool with Zod validation
   - Add tool caching support
   - Add audit logging
   - Write unit tests

3. **Agent Node** (`src/nodes/web-research-agent.ts`)
   - Implement autonomous agent with ReAct pattern
   - Create system prompt for research strategy
   - Add graceful degradation for missing API key
   - Add timeout and tool call limit enforcement
   - Write unit and integration tests

4. **Configuration** (`src/config/index.ts`)
   - Add Serper configuration loading
   - Add Web Research configuration loading
   - Update .env.example

5. **Workflow Integration** (`src/workflow.ts`)
   - Add web_research node conditionally
   - Add edges: memory_retrieval → web_research → dynamic_agent_selection
   - Test workflow execution

### Phase 2: Python Implementation

1. **Serper API Client** (`tools/serper_client.py`)
   - Port TypeScript implementation to Python
   - Maintain identical key rotation logic
   - Write unit tests

2. **Tool Layer** (`tools/serper_tools.py`)
   - Port TypeScript tools to Python
   - Use Pydantic for validation
   - Write unit tests

3. **Agent Node** (`nodes/web_research_agent.py`)
   - Port TypeScript agent to Python
   - Maintain identical system prompt
   - Write unit and integration tests

4. **Configuration** (`config.py`)
   - Add Serper configuration loading
   - Add Web Research configuration loading
   - Update .env.example

5. **Workflow Integration** (`main.py`)
   - Add web_research node conditionally
   - Add edges matching TypeScript implementation
   - Test workflow execution

### Phase 3: Testing and Validation

1. **Property-Based Tests**
   - Implement all 23 correctness properties in fast-check (TypeScript)
   - Implement all 23 correctness properties in hypothesis (Python)
   - Run with 100+ iterations each

2. **Integration Tests**
   - Test with real Serper API (when key available)
   - Test multi-key rotation scenarios
   - Test workflow end-to-end

3. **Performance Testing**
   - Measure agent execution time
   - Measure API response times
   - Validate timeout behavior

### Phase 4: Documentation and Deployment

1. **Documentation**
   - Add inline code documentation
   - Create README for Serper setup
   - Document tool usage examples
   - Document research document format

2. **Deployment**
   - Add SERPER_API_KEY to production secrets
   - Configure WEB_RESEARCH_ENABLED in production
   - Monitor agent performance
   - Collect feedback from downstream agents

## Key Design Decisions

### 1. Why Serper API?

- **Comprehensive**: Provides both search and scrape in one API
- **Reliable**: Stable service with good uptime
- **Cost-effective**: Reasonable pricing for API calls
- **Simple**: Clean REST API, easy to integrate

### 2. Why Multi-Key Rotation?

- **Resilience**: Automatic failover on rate limits
- **Throughput**: Maximize API quota utilization
- **Reliability**: No manual intervention needed
- **Consistency**: Follows established NewsData pattern

### 3. Why Autonomous Agent Pattern?

- **Flexibility**: Agent decides which tools to use based on context
- **Intelligence**: LLM reasoning improves query formulation
- **Adaptability**: Works across diverse market types
- **Consistency**: Matches existing agent architecture

### 4. Why Research Document Synthesis?

- **Usability**: Other agents can consume directly without parsing
- **Quality**: Synthesized information is more valuable than raw results
- **Clarity**: Structured narrative is easier to understand
- **Completeness**: Combines multiple sources into unified view

### 5. Why Workflow Placement After Memory Retrieval?

- **Context**: Has access to historical signals for context
- **Timing**: Provides foundation for all downstream agents
- **Efficiency**: Runs once, benefits all agents
- **Isolation**: Doesn't depend on other agent outputs

## Success Criteria

The Web Research Agent implementation will be considered successful when:

1. **Functional**: All 23 correctness properties pass with 100+ iterations
2. **Reliable**: Handles rate limits and errors gracefully without crashes
3. **Performant**: Completes within 60 second timeout for typical markets
4. **Integrated**: Successfully executes in workflow and provides context to downstream agents
5. **Tested**: >80% unit test coverage, all integration tests passing
6. **Documented**: Complete inline documentation and usage examples
7. **Deployed**: Running in production with monitoring and observability

## Appendix: API Reference

### Serper Search API

**Endpoint**: `https://google.serper.dev/search`

**Request**:
```json
{
  "q": "search query",
  "num": 10,
  "tbs": "qdr:d",
  "gl": "us",
  "hl": "en"
}
```

**Response**:
```json
{
  "searchParameters": {
    "q": "search query",
    "num": 10
  },
  "organic": [
    {
      "title": "Result Title",
      "link": "https://example.com",
      "snippet": "Result snippet text...",
      "date": "2 days ago",
      "position": 1
    }
  ]
}
```

### Serper Scrape API

**Endpoint**: `https://scrape.serper.dev`

**Request**:
```json
{
  "url": "https://example.com/article"
}
```

**Response**:
```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "text": "Full article text content...",
  "metadata": {
    "description": "Article description",
    "keywords": "keyword1, keyword2",
    "author": "Author Name",
    "publishedDate": "2024-01-15"
  }
}
```

### Rate Limits

- **Free tier**: 100 searches/month
- **Paid tier**: Varies by plan, typically 1000-10000/month
- **Rate limit**: Varies by plan, typically enforced per minute or per hour
- **HTTP 429**: Returned when rate limit exceeded
- **Retry-After**: Header indicates when to retry (seconds or HTTP date)

