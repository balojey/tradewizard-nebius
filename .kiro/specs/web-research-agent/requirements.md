# Requirements Document

## Introduction

The Web Research Agent is a new autonomous intelligence agent that provides real-world context about prediction markets by searching the web for relevant information. Currently, the multi-agent analysis system lacks sufficient context about the events, conflicts, and circumstances that drive market creation. This agent will use the Serper API to gather comprehensive background information, current events, and contextual data that other agents can leverage to improve their analysis quality.

## Glossary

- **Web_Research_Agent**: An autonomous LangGraph node that uses web search tools to gather contextual information about prediction markets
- **Serper_API**: A web search API service that provides Google search results programmatically and webpage scraping capabilities
- **Serper_Scrape_Endpoint**: The scrape.serper.dev endpoint that extracts full webpage content from URLs
- **Market_Context**: Background information, current events, and relevant data about the subject of a prediction market
- **Search_Query**: A formulated question or keyword phrase used to retrieve relevant web results
- **Context_Synthesis**: The process of combining multiple search results and scraped webpage content into a coherent, comprehensive research document
- **Research_Document**: A well-organized, factual, and comprehensive synthesis of web research that is easily readable by other agents without requiring follow-up questions
- **GraphState**: The shared state object that flows through the LangGraph workflow containing market data and agent outputs
- **MBD**: Market Briefing Document containing structured market data from Polymarket
- **Autonomous_Agent**: An agent that uses the ReAct pattern to autonomously decide which tools to call based on context
- **Tool_Context**: Shared context object containing API clients, caches, and audit logs for tool execution
- **Agent_Signal**: Structured output from an agent containing confidence, direction, probability estimate, and reasoning
- **KeyState**: State tracking object for a single API key containing key, keyId, isRateLimited, rateLimitExpiry, totalRequests, and lastUsed fields
- **Key_Rotation**: The process of switching from one API key to another when rate limits or blocking errors are detected
- **LRU_Strategy**: Least Recently Used strategy for selecting the next API key, prioritizing keys that haven't been used recently
- **Rate_Limit_Expiry**: Timestamp when a rate-limited API key becomes available again for use
- **Blocking_Error**: HTTP error responses (401, 403, 402, 429) that indicate the API key is temporarily or permanently unavailable

## Requirements

### Requirement 1: Web Research Agent Node Creation

**User Story:** As a system architect, I want to create a Web Research Agent node in both codebases, so that the workflow can gather web context about prediction markets.

#### Acceptance Criteria

1. THE Web_Research_Agent SHALL be implemented as a LangGraph node in both tradewizard-agents (Node.js) and doa (Python)
2. THE Web_Research_Agent SHALL follow the autonomous agent pattern used by Breaking_News_Agent and Media_Sentiment_Agent
3. THE Web_Research_Agent SHALL be created using the autonomous agent factory functions in both codebases
4. THE Web_Research_Agent SHALL accept GraphState as input and return a state update dictionary
5. THE Web_Research_Agent SHALL execute after memory_retrieval and before dynamic_agent_selection in the workflow

### Requirement 2: Serper API Integration

**User Story:** As a developer, I want to integrate the Serper API with both search and scraping capabilities and multi-key support, so that the agent can search the web and extract full webpage content for deeper analysis with automatic failover when rate limits are hit.

#### Acceptance Criteria

1. THE System SHALL create a Serper_API client module in both tradewizard-agents/src/tools/serper-client.ts and doa/tools/serper_client.py
2. THE Serper_API client SHALL support search queries with configurable parameters (query, num results, time range)
3. THE Serper_API client SHALL support webpage scraping via the Serper_Scrape_Endpoint (scrape.serper.dev)
4. THE Serper_API client SHALL handle rate limiting and timeout errors gracefully for both search and scrape operations
5. THE Serper_API client SHALL support multiple API keys via comma-separated SERPER_API_KEY environment variable
6. THE Serper_API client SHALL automatically rotate to the next available key when rate limits or blocking errors are detected
7. WHEN SERPER_API_KEY is not configured, THEN THE Web_Research_Agent SHALL return a low-confidence neutral signal with graceful degradation

### Requirement 3: Web Search and Scraping Tools Creation

**User Story:** As an autonomous agent, I want access to web search and webpage scraping tools, so that I can gather both broad context and deep content from relevant sources.

#### Acceptance Criteria

1. THE System SHALL create a search_web tool that queries Serper_API with a search query string
2. THE System SHALL create a scrape_webpage tool that extracts full content from a given URL using Serper_Scrape_Endpoint
3. THE search_web tool SHALL return structured results containing title, snippet, link, and date for each result
4. THE scrape_webpage tool SHALL return full webpage text content, title, and metadata
5. THE search_web tool SHALL support a num_results parameter (default: 10, max: 20)
6. THE search_web tool SHALL support a time_range parameter (e.g., "day", "week", "month", "year", "all")
7. THE scrape_webpage tool SHALL handle scraping failures gracefully and return error information
8. BOTH tools SHALL implement caching using Tool_Context to avoid duplicate API calls within the same analysis session
9. BOTH tools SHALL log all invocations to the audit_log in Tool_Context

### Requirement 4: Autonomous Search and Scraping Strategy

**User Story:** As a Web Research Agent, I want to autonomously formulate search queries and decide when to scrape webpages, so that I can gather the most relevant and comprehensive context about the market.

#### Acceptance Criteria

1. THE Web_Research_Agent SHALL receive the MBD containing market question and metadata
2. THE Web_Research_Agent SHALL autonomously decide which search queries to execute based on the market question
3. THE Web_Research_Agent SHALL autonomously decide which search result URLs to scrape for deeper context
4. THE Web_Research_Agent SHALL have a maximum of 8 tool calls per analysis (combining search and scrape operations)
5. THE Web_Research_Agent SHALL formulate queries that extract key entities, events, and timeframes from the market question
6. THE Web_Research_Agent SHALL prioritize scraping authoritative sources (news sites, official documents, research papers) over low-quality sources
7. WHEN the market involves geopolitical events, THEN THE Web_Research_Agent SHALL search for current conflicts, diplomatic relations, and recent developments
8. WHEN the market involves elections, THEN THE Web_Research_Agent SHALL search for candidate information, polling data, and campaign events
9. WHEN the market involves policy decisions, THEN THE Web_Research_Agent SHALL search for legislative status, committee votes, and stakeholder positions
10. WHEN the market involves companies, THEN THE Web_Research_Agent SHALL search for recent news, financial performance, and regulatory filings
11. WHEN search results contain highly relevant sources, THEN THE Web_Research_Agent SHALL scrape those webpages to extract comprehensive information

### Requirement 5: Research Document Synthesis and Output

**User Story:** As a downstream agent, I want to receive a comprehensive, well-structured research document, so that I can immediately understand the market context without needing to ask follow-up questions or interpret raw search results.

#### Acceptance Criteria

1. THE Web_Research_Agent SHALL produce a Research_Document that synthesizes all gathered information into a coherent narrative
2. THE Research_Document SHALL be plain and factual with no ambiguous language or speculation
3. THE Research_Document SHALL be highly informative and comprehensive, covering all relevant aspects of the market context
4. THE Research_Document SHALL be easily readable and understandable by all other agents without requiring domain expertise
5. THE Research_Document SHALL be structured with clear sections (e.g., Background, Current Status, Key Events, Stakeholders, Recent Developments)
6. THE Research_Document SHALL NOT be a list of raw search results, snippets, or URLs
7. THE Research_Document SHALL synthesize information from multiple sources into unified insights
8. THE Research_Document SHALL identify key themes, events, and contextual factors that are relevant to the market outcome
9. THE Research_Document SHALL include relevant URLs and sources as citations within the narrative, not as a separate list
10. THE Research_Document SHALL assess information recency and flag stale or outdated context
11. THE Research_Document SHALL identify conflicting information across sources and explain discrepancies
12. THE Web_Research_Agent SHALL generate an Agent_Signal containing the Research_Document in the key_drivers field
13. THE Web_Research_Agent SHALL provide a confidence score based on information quality, recency, source credibility, and comprehensiveness

### Requirement 6: Workflow Integration

**User Story:** As a workflow orchestrator, I want the Web Research Agent integrated into the analysis pipeline, so that all agents benefit from web context.

#### Acceptance Criteria

1. THE Web_Research_Agent node SHALL be added to the workflow graph after memory_retrieval
2. THE Web_Research_Agent node SHALL execute before dynamic_agent_selection
3. THE Web_Research_Agent SHALL add its signal to the agent_signals array in GraphState
4. THE Web_Research_Agent SHALL add audit entries to the audit_log in GraphState
5. THE workflow SHALL continue execution even if Web_Research_Agent fails or times out

### Requirement 7: Configuration and Environment Variables

**User Story:** As a system administrator, I want to configure the Web Research Agent, so that I can control its behavior and API usage.

#### Acceptance Criteria

1. THE System SHALL support SERPER_API_KEY environment variable for API authentication with comma-separated format for multiple keys (e.g., "key1,key2,key3")
2. THE System SHALL support SERPER_SEARCH_URL environment variable (default: "https://google.serper.dev")
3. THE System SHALL support SERPER_SCRAPE_URL environment variable (default: "https://scrape.serper.dev")
4. THE System SHALL support SERPER_TIMEOUT environment variable (default: 30 seconds)
5. THE System SHALL support WEB_RESEARCH_ENABLED environment variable to enable/disable the agent (default: true)
6. THE System SHALL support WEB_RESEARCH_MAX_TOOL_CALLS environment variable (default: 8)
7. WHEN WEB_RESEARCH_ENABLED is false, THEN THE workflow SHALL skip the Web_Research_Agent node
8. WHEN multiple API keys are provided in SERPER_API_KEY, THEN THE System SHALL parse them by splitting on commas and trimming whitespace

### Requirement 8: Error Handling and Graceful Degradation

**User Story:** As a system operator, I want robust error handling with automatic key rotation, so that web search or scraping failures don't crash the entire analysis and rate limits are handled transparently.

#### Acceptance Criteria

1. WHEN Serper_API returns an error for search or scrape operations, THEN THE Web_Research_Agent SHALL log the error and continue with available information
2. WHEN Serper_API times out, THEN THE Web_Research_Agent SHALL return a signal with timeout metadata and any partial results gathered
3. WHEN SERPER_API_KEY is missing, THEN THE Web_Research_Agent SHALL return a signal indicating web research is unavailable
4. WHEN search results are empty, THEN THE Web_Research_Agent SHALL indicate insufficient web context in the signal
5. WHEN webpage scraping fails for a specific URL, THEN THE Web_Research_Agent SHALL continue with other sources and note the failure
6. WHEN Serper_API returns HTTP 429 (Rate Limit), THEN THE Serper_API client SHALL rotate to the next available key and retry without counting against retry limit
7. WHEN Serper_API returns HTTP 401 (Unauthorized), THEN THE Serper_API client SHALL mark the key as invalid and rotate to the next available key
8. WHEN Serper_API returns HTTP 403 (Forbidden), THEN THE Serper_API client SHALL mark the key as blocked and rotate to the next available key
9. WHEN Serper_API returns HTTP 402 (Payment Required), THEN THE Serper_API client SHALL mark the key as quota exhausted and rotate to the next available key
10. WHEN all API keys are exhausted or rate-limited, THEN THE Serper_API client SHALL return graceful degradation with empty results
11. THE Web_Research_Agent SHALL never throw unhandled exceptions that terminate the workflow

### Requirement 9: Testing and Validation

**User Story:** As a quality engineer, I want comprehensive tests for the Web Research Agent including key rotation scenarios, so that I can verify its correctness and reliability.

#### Acceptance Criteria

1. THE System SHALL include unit tests for the Serper_API client (both search and scrape functionality) in both codebases
2. THE System SHALL include unit tests for the search_web tool with mocked API responses
3. THE System SHALL include unit tests for the scrape_webpage tool with mocked API responses
4. THE System SHALL include integration tests for the Web_Research_Agent node with real API calls (when API key is available)
5. THE System SHALL include property-based tests for search query formulation
6. THE System SHALL include property-based tests verifying that Research_Document output is always structured and comprehensive (not raw results)
7. THE System SHALL include tests for graceful degradation when API is unavailable or scraping fails
8. THE System SHALL include unit tests for API key rotation on HTTP 429 responses
9. THE System SHALL include unit tests for API key rotation on HTTP 401, 403, and 402 responses
10. THE System SHALL include unit tests verifying LRU (Least Recently Used) key selection strategy
11. THE System SHALL include unit tests for automatic expiry of rate-limited keys
12. THE System SHALL include unit tests for graceful degradation when all keys are exhausted

### Requirement 10: Documentation and Examples

**User Story:** As a developer, I want clear documentation, so that I can understand how to use and extend the Web Research Agent.

#### Acceptance Criteria

1. THE System SHALL include inline code documentation for all Serper_API client methods (search and scrape)
2. THE System SHALL include examples of search query formulation and webpage scraping strategy in the agent system prompt
3. THE System SHALL document the search_web and scrape_webpage tool parameters and return types
4. THE System SHALL include examples of well-structured Research_Document output format in the agent system prompt
5. THE System SHALL include a README explaining Serper API setup and configuration for both endpoints
6. THE System SHALL document the Web_Research_Agent's position in the workflow and its Research_Document output format

### Requirement 11: API Key Rotation and Multi-Key Support

**User Story:** As a system operator, I want automatic API key rotation when rate limits are hit, so that the Web Research Agent can continue operating without manual intervention and maximize API quota utilization across multiple keys.

#### Acceptance Criteria

1. THE Serper_API client SHALL maintain a KeyState interface tracking key status with fields: key, keyId, isRateLimited, rateLimitExpiry, totalRequests, lastUsed
2. THE Serper_API client SHALL implement getKeyId() method returning the first 8 characters of the key for logging purposes
3. THE Serper_API client SHALL implement isRateLimitError() method to detect HTTP 429 responses
4. THE Serper_API client SHALL implement isBlockingError() method to detect HTTP 401, 403, and 402 responses
5. THE Serper_API client SHALL implement extractRetryAfter() method to parse Retry-After header or X-RateLimit-Reset header from rate limit responses
6. THE Serper_API client SHALL implement getAvailableKeys() method that returns non-rate-limited keys and auto-expires rate-limited keys when their expiry time passes
7. THE Serper_API client SHALL implement rotateApiKey() method that marks the current key as rate-limited and selects the next available key using LRU (Least Recently Used) strategy
8. THE Serper_API client SHALL implement getKeyRotationStats() method for observability returning total keys, available keys, rate-limited keys, and per-key statistics
9. WHEN HTTP 429 is detected, THEN THE Serper_API client SHALL mark the current key as rate-limited with expiry timestamp and rotate to the next available key
10. WHEN HTTP 401, 403, or 402 is detected, THEN THE Serper_API client SHALL mark the current key as blocked/invalid and rotate to the next available key
11. WHEN rotating keys, THE Serper_API client SHALL select the least recently used key from available keys
12. WHEN a rate-limited key's expiry time passes, THEN THE getAvailableKeys() method SHALL automatically mark it as available again
13. WHEN all keys are exhausted or rate-limited, THEN THE Serper_API client SHALL return graceful degradation with empty results and log the exhaustion event
14. WHEN key rotation occurs, THEN THE Serper_API client SHALL log the rotation event with context including endpoint, agent name, and request parameters
15. WHEN a request succeeds after rotation, THEN THE Serper_API client SHALL update the new key's lastUsed timestamp and totalRequests counter
16. THE Serper_API client SHALL retry the request with the new key without counting the rotation against the retry limit
17. THE Serper_API client SHALL follow the exact same pattern as the NewsData_API client implementation for consistency
