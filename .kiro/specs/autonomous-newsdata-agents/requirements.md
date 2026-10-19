# Requirements Document: Autonomous NewsData Agents

## Introduction

The Autonomous NewsData Agents feature transforms three existing TradeWizard agents from passive news consumers into active, tool-using agents capable of autonomously fetching and researching news data. This enhancement applies the proven autonomous polling agent pattern to the Breaking News Agent, Media Sentiment Agent, and Market Microstructure Agent, enabling them to intelligently decide what news queries to make based on market context and synthesize information from multiple news sources.

Currently, these agents rely on pre-fetched news data injected into the workflow state by the EnhancedAgentFactory. By giving them direct access to NewsData API tools through LangChain's tool-calling capabilities, they can perform deep, context-aware analysis that adapts to each market's unique characteristics, similar to how the autonomous polling agent fetches its own Polymarket data.

## Glossary

- **Autonomous_Agent**: An AI agent that can independently decide which tools to use and when to use them
- **Tool**: A function that the agent can invoke to fetch data or perform operations
- **NewsDataClient**: The existing client class that provides methods for fetching news from NewsData.io API
- **Breaking_News_Agent**: Agent that analyzes breaking news for immediate market impact
- **Media_Sentiment_Agent**: Agent that analyzes media sentiment from news articles
- **Market_Microstructure_Agent**: Agent that uses market news for microstructure analysis
- **Tool_Call**: An invocation of a tool by the agent with specific parameters
- **Tool_Result**: The data returned by a tool after execution
- **LangChain_Tool**: A LangChain-compatible tool definition with schema and execution function
- **Structured_Tool**: A LangChain tool created with input schema validation
- **Agent_Executor**: LangChain component that manages tool-calling workflow for an agent
- **Market_Briefing_Document**: Input data structure containing market context (MBD)
- **Rate_Limiting**: Mechanism to prevent exceeding API rate limits
- **Tool_Cache**: Storage mechanism to avoid redundant API calls for the same data
- **Audit_Trail**: Log of all tool calls and their results for debugging and analysis
- **Keyword_Extraction**: Process of identifying relevant search terms from market context
- **Query_Construction**: Process of building NewsData API queries from keywords and context
- **News_Tool**: A tool that fetches news articles from NewsData.io API
- **Latest_News**: News articles from the past 48 hours
- **Archive_News**: Historical news articles with date range filtering
- **Crypto_News**: Cryptocurrency and blockchain related news
- **Market_News**: Financial market and company news
- **Sentiment_Analysis**: Process of determining positive/negative/neutral tone of news
- **Breaking_News_Detection**: Identification of time-sensitive news events
- **News_Relevance_Score**: Metric indicating how relevant a news article is to the market
- **Multi_Query_Strategy**: Approach where agent makes multiple news queries to gather comprehensive data
- **Query_Refinement**: Process of adjusting search parameters based on initial results

## Requirements

### Requirement 1: Tool Infrastructure for News Agents

**User Story:** As a system architect, I want a robust tool infrastructure for news-using agents, so that they can reliably fetch and use external news data.

#### Acceptance Criteria

1. THE System SHALL provide a set of LangChain_Tools that news agents can invoke
2. WHEN a tool is invoked, THE System SHALL validate input parameters against the tool's schema
3. THE System SHALL log all Tool_Calls to the Audit_Trail with timestamp, tool name, parameters, and result
4. WHEN a tool execution fails, THE System SHALL return a structured error to the agent without crashing
5. THE System SHALL implement Rate_Limiting awareness in all tools that call NewsData APIs
6. THE System SHALL implement Tool_Cache to avoid redundant API calls within the same analysis session

### Requirement 2: Latest News Tool

**User Story:** As a news analyst, I want to fetch the latest news articles, so that I can analyze breaking developments and immediate market impact.

#### Acceptance Criteria

1. THE System SHALL provide a `fetchLatestNews` tool that accepts query, timeframe, and filtering parameters
2. THE `fetchLatestNews` tool SHALL support timeframe values: '1h', '6h', '12h', '24h', '48h'
3. THE tool SHALL support keyword search in title, content, and metadata
4. THE tool SHALL support filtering by country, category, language, domain, and sentiment
5. THE tool SHALL return articles with title, description, url, source, publishedAt, and sentiment fields
6. WHEN no articles match the query, THE tool SHALL return an empty array with a warning message
7. THE tool SHALL limit results to a maximum of 50 articles per query

### Requirement 3: Archive News Tool

**User Story:** As a news analyst, I want to fetch historical news articles, so that I can analyze longer-term trends and patterns.

#### Acceptance Criteria

1. THE System SHALL provide a `fetchArchiveNews` tool that accepts fromDate, toDate, query, and filtering parameters
2. THE `fetchArchiveNews` tool SHALL validate that fromDate is before toDate
3. THE tool SHALL support date formats: 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS'
4. THE tool SHALL support the same filtering options as fetchLatestNews
5. THE tool SHALL return articles in the same format as fetchLatestNews
6. WHEN the date range exceeds 30 days, THE tool SHALL log a warning about potential quota usage
7. THE tool SHALL limit results to a maximum of 50 articles per query

### Requirement 4: Crypto News Tool

**User Story:** As a crypto analyst, I want to fetch cryptocurrency-related news, so that I can analyze crypto market sentiment and events.

#### Acceptance Criteria

1. THE System SHALL provide a `fetchCryptoNews` tool that accepts coin symbols, query, and filtering parameters
2. THE tool SHALL support coin symbol filtering (e.g., 'btc', 'eth', 'ada')
3. THE tool SHALL support timeframe and date range filtering
4. THE tool SHALL return articles with crypto-specific metadata including coin tags
5. THE tool SHALL support sentiment filtering for crypto news
6. WHEN no coin symbols are specified, THE tool SHALL return general crypto news
7. THE tool SHALL limit results to a maximum of 50 articles per query

### Requirement 5: Market News Tool

**User Story:** As a market analyst, I want to fetch financial market news, so that I can analyze market sentiment and company-specific events.

#### Acceptance Criteria

1. THE System SHALL provide a `fetchMarketNews` tool that accepts symbols, organizations, query, and filtering parameters
2. THE tool SHALL support stock symbol filtering (e.g., 'AAPL', 'TSLA', 'MSFT')
3. THE tool SHALL support organization name filtering (e.g., 'Apple', 'Tesla', 'Microsoft')
4. THE tool SHALL return articles with market-specific metadata including symbol tags
5. THE tool SHALL support sentiment filtering for market news
6. WHEN no symbols or organizations are specified, THE tool SHALL return general market news
7. THE tool SHALL limit results to a maximum of 50 articles per query

### Requirement 6: Autonomous Breaking News Agent

**User Story:** As a trader, I want the breaking news agent to autonomously fetch relevant breaking news, so that I can identify immediate market-moving events.

#### Acceptance Criteria

1. THE Breaking_News_Agent SHALL be configured as a tool-using agent with access to all news tools
2. THE agent SHALL receive tool definitions in its system prompt
3. WHEN analyzing a market, THE agent SHALL autonomously decide which news tools to invoke
4. THE agent SHALL prioritize fetchLatestNews with short timeframes (1h, 6h) for breaking news
5. THE agent SHALL extract relevant keywords from the Market_Briefing_Document for query construction
6. THE agent SHALL be able to invoke multiple tools in sequence to gather comprehensive breaking news
7. THE agent SHALL synthesize information from multiple tool results in its final analysis
8. THE agent SHALL include tool usage summary in its metadata output

### Requirement 7: Autonomous Media Sentiment Agent

**User Story:** As a trader, I want the media sentiment agent to autonomously fetch relevant news for sentiment analysis, so that I can understand media narrative and tone.

#### Acceptance Criteria

1. THE Media_Sentiment_Agent SHALL be configured as a tool-using agent with access to all news tools
2. THE agent SHALL receive tool definitions in its system prompt
3. WHEN analyzing a market, THE agent SHALL autonomously decide which news tools to invoke
4. THE agent SHALL prioritize sentiment-filtered queries to gather positive, negative, and neutral articles
5. THE agent SHALL extract relevant keywords from the Market_Briefing_Document for query construction
6. THE agent SHALL be able to invoke multiple tools with different sentiment filters to compare coverage
7. THE agent SHALL synthesize sentiment patterns from multiple tool results in its final analysis
8. THE agent SHALL include tool usage summary in its metadata output

### Requirement 8: Autonomous Market Microstructure Agent

**User Story:** As a trader, I want the market microstructure agent to autonomously fetch relevant market news, so that I can understand market dynamics and liquidity patterns.

#### Acceptance Criteria

1. THE Market_Microstructure_Agent SHALL be configured as a tool-using agent with access to all news tools
2. THE agent SHALL receive tool definitions in its system prompt
3. WHEN analyzing a market, THE agent SHALL autonomously decide which news tools to invoke
4. THE agent SHALL prioritize fetchMarketNews for financial market context
5. THE agent SHALL extract relevant keywords from the Market_Briefing_Document for query construction
6. THE agent SHALL be able to invoke multiple tools to gather both recent and historical market news
7. THE agent SHALL synthesize market context from multiple tool results in its final analysis
8. THE agent SHALL include tool usage summary in its metadata output

### Requirement 9: Intelligent Keyword Extraction

**User Story:** As a system architect, I want agents to intelligently extract keywords from market context, so that news queries are relevant and targeted.

#### Acceptance Criteria

1. WHEN analyzing a market, THE agent SHALL extract keywords from the market question
2. THE agent SHALL extract keywords from market metadata (event title, description, tags)
3. THE agent SHALL identify entity names (people, organizations, locations) as high-priority keywords
4. THE agent SHALL identify topic keywords (policy areas, event types) as medium-priority keywords
5. THE agent SHALL remove stop words and common terms from keyword lists
6. THE agent SHALL limit keyword extraction to the top 10 most relevant terms
7. THE agent SHALL document keyword extraction strategy in keyDrivers

### Requirement 10: Intelligent Query Construction

**User Story:** As a system architect, I want agents to intelligently construct news queries, so that results are relevant and comprehensive.

#### Acceptance Criteria

1. WHEN constructing a query, THE agent SHALL combine multiple keywords using boolean logic
2. THE agent SHALL prioritize queryInTitle parameter for high-precision searches
3. THE agent SHALL use query parameter for broader content searches
4. THE agent SHALL apply appropriate timeframe based on market characteristics
5. WHEN a market is election-related, THE agent SHALL include country and category filters
6. WHEN a market is crypto-related, THE agent SHALL use fetchCryptoNews with coin symbols
7. THE agent SHALL document query construction strategy in keyDrivers

### Requirement 11: Multi-Query Strategy

**User Story:** As an analyst, I want agents to make multiple complementary news queries, so that analysis is comprehensive and covers different angles.

#### Acceptance Criteria

1. WHEN initial query returns fewer than 5 articles, THE agent SHALL make additional queries with broader parameters
2. WHEN analyzing sentiment, THE agent SHALL make separate queries for positive, negative, and neutral articles
3. WHEN analyzing breaking news, THE agent SHALL make queries for multiple timeframes (1h, 6h, 24h)
4. THE agent SHALL limit total tool calls to a maximum of 5 per analysis to control latency
5. THE agent SHALL prioritize high-value queries over low-value queries when approaching limit
6. THE agent SHALL document multi-query strategy in keyDrivers

### Requirement 12: News Relevance Filtering

**User Story:** As an analyst, I want agents to filter news by relevance, so that analysis focuses on the most pertinent articles.

#### Acceptance Criteria

1. WHEN processing news results, THE agent SHALL calculate a News_Relevance_Score for each article
2. THE agent SHALL prioritize articles with keywords in the title over keywords in content
3. THE agent SHALL prioritize articles from high-priority sources
4. THE agent SHALL prioritize recent articles over older articles for breaking news analysis
5. THE agent SHALL filter out duplicate articles based on title similarity
6. THE agent SHALL include only the top 20 most relevant articles in its analysis

### Requirement 13: Sentiment Aggregation

**User Story:** As a trader, I want agents to aggregate sentiment across multiple articles, so that I can understand overall media tone.

#### Acceptance Criteria

1. WHEN analyzing multiple articles, THE agent SHALL calculate aggregate sentiment distribution
2. THE agent SHALL weight sentiment by source priority and recency
3. THE agent SHALL identify sentiment shifts when recent articles differ from older articles
4. THE agent SHALL calculate sentiment confidence based on article count and consistency
5. THE agent SHALL include sentiment distribution (positive %, negative %, neutral %) in metadata
6. THE agent SHALL flag polarized sentiment when positive and negative percentages are both high

### Requirement 14: Breaking News Detection

**User Story:** As a trader, I want agents to detect breaking news events, so that I can identify time-sensitive market opportunities.

#### Acceptance Criteria

1. WHEN analyzing news, THE agent SHALL identify articles published within the last 1 hour as breaking
2. THE agent SHALL calculate breaking news velocity (articles per hour) for the market
3. WHEN breaking news velocity exceeds 5 articles per hour, THE agent SHALL flag high activity
4. THE agent SHALL identify breaking news themes by clustering article keywords
5. THE agent SHALL prioritize breaking news in keyDrivers when velocity is high
6. THE agent SHALL adjust confidence based on breaking news presence and relevance

### Requirement 15: Tool Error Handling

**User Story:** As a system operator, I want robust error handling for tool failures, so that agents can continue analysis even when some tools fail.

#### Acceptance Criteria

1. WHEN a tool invocation fails, THE agent SHALL receive a structured error message
2. THE agent SHALL be able to continue analysis with partial data when some tools fail
3. THE System SHALL log all tool errors to the Audit_Trail
4. WHEN a critical tool fails (e.g., fetchLatestNews), THE agent SHALL adjust confidence downward
5. THE agent SHALL include tool failure information in riskFactors when it impacts analysis
6. THE System SHALL NOT crash the entire workflow when a tool fails

### Requirement 16: Rate Limiting and Caching

**User Story:** As a system operator, I want efficient API usage, so that we don't exceed rate limits or make redundant calls.

#### Acceptance Criteria

1. THE System SHALL check NewsDataClient rate limit status before making tool calls
2. WHEN rate limit is approaching, THE System SHALL delay tool execution
3. THE System SHALL cache tool results within an analysis session (same conditionId)
4. WHEN the same tool is called with identical parameters, THE System SHALL return cached result
5. THE cache SHALL expire after the analysis session completes
6. THE System SHALL log cache hits and misses to the Audit_Trail

### Requirement 17: Performance Requirements

**User Story:** As a system operator, I want autonomous agents to execute efficiently, so that they don't significantly slow down the workflow.

#### Acceptance Criteria

1. THE Breaking_News_Agent SHALL complete analysis within 45 seconds for 95% of requests
2. THE Media_Sentiment_Agent SHALL complete analysis within 45 seconds for 95% of requests
3. THE Market_Microstructure_Agent SHALL complete analysis within 45 seconds for 95% of requests
4. THE agents SHALL limit tool calls to a maximum of 5 per analysis to control latency
5. THE agents SHALL execute tool calls in parallel when possible to reduce total time
6. THE System SHALL log total tool execution time separately from LLM time

### Requirement 18: Backward Compatibility

**User Story:** As a system architect, I want autonomous agents to be backward compatible, so that existing workflows continue to work.

#### Acceptance Criteria

1. THE autonomous agents SHALL accept the same Market_Briefing_Document input as the basic agents
2. THE autonomous agents SHALL produce the same AgentSignal output schema as the basic agents
3. THE autonomous agents SHALL be configurable via feature flags to enable/disable autonomous mode
4. WHEN autonomous mode is disabled, THE agents SHALL fall back to basic analysis with pre-fetched data
5. THE System SHALL support gradual rollout of autonomous agents alongside basic agents
6. THE autonomous agents SHALL integrate with existing workflow nodes without modification

### Requirement 19: Tool Usage Audit

**User Story:** As a system operator, I want detailed audit logs of tool usage, so that I can debug issues and optimize performance.

#### Acceptance Criteria

1. THE System SHALL log every tool invocation with timestamp, tool name, and parameters
2. THE System SHALL log tool execution time for each invocation
3. THE System SHALL log tool results (or error messages) for each invocation
4. THE System SHALL log cache hits and misses for each tool call
5. THE System SHALL include tool usage summary in the agent's audit log entry
6. THE audit log SHALL include total number of tools called and total tool execution time

### Requirement 20: Testing Requirements

**User Story:** As a developer, I want comprehensive tests for autonomous news agents, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE System SHALL have unit tests for each news tool covering success and error scenarios
2. THE System SHALL have integration tests verifying agent tool-calling workflow
3. THE System SHALL have property-based tests verifying tool output schemas
4. THE System SHALL have tests verifying rate limiting and caching behavior
5. THE System SHALL have tests verifying keyword extraction and query construction
6. THE System SHALL have tests verifying multi-query strategies and relevance filtering
7. THE System SHALL have performance tests verifying 45-second execution time target
