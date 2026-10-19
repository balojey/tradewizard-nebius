# Implementation Plan: Lambda Strands Migration

## Overview

Migrate TradeWizard's Analysis Orchestrator and Portfolio Manager from Amazon Bedrock AgentCore (Python) to self-hosted AWS Lambda functions using the Strands Agents SDK for TypeScript. This involves creating two new Lambda functions (Analysis_Lambda and Portfolio_Lambda), modifying three existing dispatchers, updating CDK infrastructure, and removing all AgentCore dependencies.

## Tasks

- [x] 1. Set up Analysis_Lambda project structure and shared libraries
  - [x] 1.1 Create Analysis_Lambda directory structure and shared library modules
    - Create `infra/services/analysis-lambda/` directory with handler.ts entry point
    - Create `infra/services/analysis-lambda/lib/model.ts` - BedrockModel factory reading BEDROCK_MODEL_ID, AWS_REGION, BEDROCK_MAX_TOKENS env vars with defaults
    - Create `infra/services/analysis-lambda/lib/json-extractor.ts` - robust JSON extraction from LLM responses (plain JSON, markdown-fenced, balanced-brace matching, null on failure)
    - Create `infra/services/analysis-lambda/lib/types.ts` - shared TypeScript interfaces (TradeRecommendation, AgentSignal, FusedSignal, ConsensusResult, Thesis, CrossExamResult, AnalysisPayload)
    - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.4, 14.1_

  - [x]* 1.2 Write property test for JSON extraction robustness
    - **Property 16: JSON extraction robustness**
    - Test with valid JSON, markdown code-fenced JSON, text with embedded JSON, strings with no JSON, and empty strings
    - Verify extraction returns parsed object or null without throwing
    - Verify markdown-fenced content is preferred when present
    - **Validates: Requirements 10.5, 10.6**

  - [x] 1.3 Implement Analysis_Lambda handler with payload validation and fallback
    - Implement `handler(event)` that validates marketId, userId, requestId are present and non-empty
    - Return NO_TRADE fallback (action: NO_TRADE, liquidityRisk: high, explanation.summary containing invalid field names) on validation failure
    - Implement top-level try/catch returning NO_TRADE fallback on unrecoverable errors
    - Implement /tmp cleanup in finally block regardless of success/failure
    - Validate required env vars on cold start (BEDROCK_MODEL_ID, AWS_REGION, ANALYSIS_HISTORY_DEPTH, DB_SECRET_ARN, DB_HOST, EVENT_BUS_NAME)
    - _Requirements: 1.2, 1.3, 1.5, 1.7, 1.8, 14.5_

  - [x]* 1.4 Write property tests for Analysis payload validation and output structure
    - **Property 1: Analysis payload validation produces correct fallback**
    - **Property 2: Analysis output structure invariant**
    - Test that missing/empty fields produce NO_TRADE with field names in explanation
    - Test that all executions return valid TradeRecommendation with all required fields
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.8**

- [x] 2. Implement Analysis_Lambda tools
  - [x] 2.1 Implement News_Tool (NewsData.io) as Strands tool definition
    - Create `infra/services/analysis-lambda/tools/news-tool.ts`
    - Define Strands `tool()` with Zod schema for fetchLatestNews and fetchArchiveNews parameters
    - Implement API key rotation via comma-separated NEWSDATA_API_KEY env var (cycle on 429, don't count as retry)
    - Implement 15-second timeout per request, max 50 articles per request
    - Return structured error object `{ error: true, toolName, message }` on failure - never throw
    - Implement `transformArticle()` function mapping API response fields to NewsArticle interface
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x]* 2.2 Write property test for news article transformation
    - **Property 8: News article transformation preserves fields**
    - Generate arbitrary valid article objects and verify field mapping (article_id→id, title→title, link→url, source_name→source.name, pubDate→metadata.publishedAt, language→metadata.language)
    - **Validates: Requirements 6.5**

  - [x] 2.3 Implement Search_Tool (Serper) as Strands tool definition
    - Create `infra/services/analysis-lambda/tools/search-tool.ts`
    - Define Strands `tool()` with Zod schema for search (query, num results 1-20, time range, country) and scrape (url) actions
    - Implement API key rotation via comma-separated SERPER_API_KEY env var (cycle on 429, don't count as retry)
    - Implement 30-second timeout per request
    - Return structured error object on failure - never throw
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x]* 2.4 Write property tests for API key rotation and tool error handling
    - **Property 7: API key rotation on rate limit**
    - **Property 9: Tool error handling returns structured error**
    - Test rotation cycles through N keys before repeating, rotation doesn't count toward retry limit
    - Test HTTP errors and timeouts return `{ error: true, toolName, message }` without throwing
    - **Validates: Requirements 6.6, 6.9, 7.6, 7.8**

  - [x] 2.5 Implement Shell_Analysis_Tool using Strands community bash tool
    - Create `infra/services/analysis-lambda/tools/shell-tool.ts`
    - Configure Strands community bash tool scoped to /tmp working directory
    - Implement 30-second command timeout
    - Return structured error on timeout
    - _Requirements: 5.1, 5.4, 5.5_

- [x] 3. Implement Analysis_Lambda data preparation stage
  - [x] 3.1 Implement data preparation (price history CSV and related markets JSON)
    - Create `infra/services/analysis-lambda/stages/data-preparation.ts`
    - Fetch full price history from Polymarket CLOB API at 60-min fidelity with 30s timeout
    - Write CSV to /tmp with columns: timestamp, datetime_utc, price; include metadata comment lines (# market question, token ID, data point count, date range, price range)
    - Fetch up to 50 related sibling markets from Gamma API using condition ID
    - Calculate aggregate metrics: average_probability, volume_weighted_probability, sentiment_direction, total_volume, total_liquidity
    - Write related markets JSON to /tmp with aggregate metrics
    - Fetch price history for top 5 siblings by volume in parallel (60-min fidelity, 30s timeout each)
    - Continue with empty data on fetch failures (log warning, set csv_path to empty string)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x]* 3.2 Write property tests for CSV structure and related markets aggregation
    - **Property 5: Price history CSV structure**
    - **Property 6: Related markets aggregate metric calculation**
    - Test CSV has header row, one data row per point, and correct metadata comments
    - Test aggregate metrics: average_probability = arithmetic mean, volume_weighted_probability = sum(prob*vol)/sum(vol), sentiment_direction logic, total_volume = sum
    - **Validates: Requirements 4.2, 4.4**

- [x] 4. Implement Analysis_Lambda historical context and web research stages
  - [x] 4.1 Implement historical context retrieval stage
    - Create `infra/services/analysis-lambda/stages/historical-context.ts`
    - Connect to RDS using DB_SECRET_ARN credentials (cache on cold start)
    - Query agent_memory table by market_id ordered by executed_at DESC
    - Implement `clampHistoryDepth()` - read ANALYSIS_HISTORY_DEPTH, clamp to [1, 20]
    - Implement `filterMemoryForAgent(entries, agentName)` - return only entries matching target agent
    - Continue with empty history on DB connection failure (log warning)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x]* 4.2 Write property tests for memory filtering and history depth clamping
    - **Property 14: Memory filtering returns only matching agent signals**
    - **Property 15: Analysis history depth clamping**
    - Test filtering returns only entries where agentName matches, count ≤ input count
    - Test clamping: any integer N → Math.max(1, Math.min(20, N)) for all values including negatives, zero, >20
    - **Validates: Requirements 13.3, 13.4**

  - [x] 4.3 Implement web research agent stage
    - Create `infra/services/analysis-lambda/stages/web-research.ts`
    - Create Strands Agent with search and scrape tools
    - System prompt instructs autonomous multi-step research (search → identify → scrape → synthesize)
    - Enforce 60-second overall timeout, max 10 search calls, max 5 scrape calls
    - Produce text research brief ≤ 4000 characters
    - On failure: set research brief to "Web research unavailable.", log warning, continue
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Analysis_Lambda intelligence agents and signal fusion
  - [x] 6.1 Implement parallel intelligence agent execution
    - Create `infra/services/analysis-lambda/stages/intelligence-agents.ts`
    - Define system prompts for all 14 agents (market_microstructure, probability_baseline, risk_assessment, breaking_news, event_impact, polling_intelligence, historical_patterns, media_sentiment, social_sentiment, narrative_velocity, momentum, mean_reversion, catalyst_identification, tail_risk)
    - Assign tools per agent type: price-aware agents get shell tool + CSV path; news agents get news tool; browser-capable agents get search tool
    - Execute all 14 via Promise.all with 120-second per-agent timeout
    - On agent failure: produce fallback NEUTRAL signal (confidence: 0.3, fairProbability: 0.5)
    - If >10 agents fail: abort and return NO_TRADE with "insufficient intelligence coverage"
    - If ≤10 fail: continue with mix of real + fallback signals
    - Parse AgentSignal from each response (direction, confidence, fairProbability, keyDrivers, riskFactors)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 5.1, 5.2, 5.3, 5.6, 6.1, 7.1_

  - [x]* 6.2 Write property tests for intelligence agent failure threshold
    - **Property 10: Intelligence agent fallback signal on failure**
    - **Property 11: Agent failure threshold determines workflow continuation**
    - Test failed agents produce NEUTRAL signal with confidence 0.3, fairProbability 0.5
    - Test K ≤ 10 failures → continue with 14 signals; K > 10 → abort with NO_TRADE
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.6**

  - [x] 6.3 Implement signal fusion as pure deterministic function
    - Create `infra/services/analysis-lambda/stages/signal-fusion.ts`
    - Accept array of 1-14 AgentSignals and agent performance map
    - Calculate weight per agent = type_weight × confidence × performance_score (default 1.0)
    - Calculate weighted_fair_probability, fusion_confidence, signal_alignment, conflict_map
    - Apply divergence penalty: if max divergence between any two fair_probabilities > 0.70, reduce fusion_confidence by 50%
    - Return FusedSignal
    - _Requirements: 9.1, 9.2, 9.3_

  - [x]* 6.4 Write property test for signal fusion
    - **Property 12: Signal fusion produces valid output with divergence penalty**
    - Generate arrays of 1-14 signals with confidence in [0,1] and fairProbability in [0,1]
    - Verify weighted_fair_probability ∈ [0,1], fusion_confidence ∈ [0,1], signal_alignment ∈ [0,1]
    - Verify divergence > 0.70 → confidence reduced by exactly 50%
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 7. Implement Analysis_Lambda thesis, consensus, and recommendation stages
  - [x] 7.1 Implement thesis construction and cross-examination stages
    - Create `infra/services/analysis-lambda/stages/thesis-construction.ts` - Strands Agent producing bull/bear theses (direction, fair_probability, key_arguments, confidence)
    - Create `infra/services/analysis-lambda/stages/cross-examination.ts` - Strands Agent applying 5 adversarial tests, producing bull_score and bear_score (-5.0 to +5.0)
    - Apply JSON extraction pipeline: first markdown code-fence regex, then balanced-brace matching, then stage-specific defaults
    - Fallback on failure: neutral theses (0.3 confidence, fused signal probability) for thesis; zero scores for cross-exam
    - _Requirements: 10.1, 10.2, 10.5, 10.6_

  - [x] 7.2 Implement consensus engine as pure deterministic function
    - Create `infra/services/analysis-lambda/stages/consensus-engine.ts`
    - Calculate disagreement_index = std_dev(bull_thesis.fair_probability, bear_thesis.fair_probability, fused.weighted_fair_probability)
    - Flag consensus as failed when disagreement_index > 0.30 → return NO_TRADE
    - Calculate edge = consensus_probability - market_probability
    - Apply minimum edge threshold: 0.05 (low/medium liquidity) or 0.075 (high liquidity)
    - Return LONG_YES if edge > threshold, LONG_NO if edge < -threshold, NO_TRADE otherwise
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x]* 7.3 Write property test for consensus engine action determination
    - **Property 13: Consensus engine action determination**
    - Generate valid inputs (consensus_prob, market_prob, consensus_failed, liquidity_risk)
    - Verify: consensus_failed=true → NO_TRADE always; threshold = 0.05 or 0.075 for high liquidity; action = LONG_YES/LONG_NO/NO_TRADE based on edge vs threshold
    - **Validates: Requirements 9.5, 9.6, 9.7, 9.8**

  - [x] 7.4 Implement risk philosophy and recommendation stages
    - Create `infra/services/analysis-lambda/stages/risk-philosophy.ts` - 3 parallel Strands Agents (aggressive, conservative, neutral) via Promise.all, each returning position_size_pct, kelly_fraction, entry_strategy, stop_loss_distance, take_profit_distance, reasoning, max_drawdown_tolerance
    - Create `infra/services/analysis-lambda/stages/recommendation.ts` - Strands Agent synthesizing final TradeRecommendation from consensus, risk perspectives, theses, and cross-exam scores
    - Apply JSON extraction with fallbacks: "unavailable" text for risk, NO_TRADE for recommendation
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Set up Portfolio_Lambda
  - [x] 9.1 Create Portfolio_Lambda directory structure and handler
    - Create `infra/services/portfolio-lambda/` directory
    - Create `infra/services/portfolio-lambda/handler.ts` - payload validation, agent creation, response parsing, error fallback
    - Create `infra/services/portfolio-lambda/lib/model.ts` - shared BedrockModel factory (same pattern as Analysis_Lambda)
    - Create `infra/services/portfolio-lambda/lib/json-extractor.ts` - shared JSON extraction (same implementation)
    - Create `infra/services/portfolio-lambda/lib/types.ts` - PortfolioDecision, PortfolioPayload schemas
    - Validate payload schema: persona (one of 6 identifiers), analysis_result, portfolio_state, market_data, decision_type
    - Return skip decision on invalid payload (action: skip, sizePct: 0, conviction: 0, reasoning indicating invalid fields)
    - Return skip decision on unknown/missing persona
    - Validate required env vars on cold start (BEDROCK_MODEL_ID, AWS_REGION, RDS_CLUSTER_ARN, RDS_SECRET_ARN, RDS_DATABASE, ANALYSIS_RESULTS_BUCKET)
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.5, 3.6, 3.7, 14.2, 14.6_

  - [x]* 9.2 Write property tests for Portfolio payload validation and decision parsing
    - **Property 3: Portfolio payload validation produces skip fallback**
    - **Property 4: Portfolio decision parsing invariant**
    - Test invalid payloads return skip decision with correct fields and reasoning
    - Test all raw text inputs (valid JSON, markdown-wrapped, malformed, empty) produce valid PortfolioDecision with bounded fields
    - **Validates: Requirements 2.2, 2.3, 2.6, 2.7, 3.7**

  - [x] 9.3 Implement Portfolio_Lambda persona system prompts and read-only tools
    - Create `infra/services/portfolio-lambda/personas.ts` - 6 persona system prompts (sniper, scalper, contrarian, catalyst_hunter, hedge_architect, momentum_rider) + exit evaluation prompt
    - Create `infra/services/portfolio-lambda/tools/market-data.ts` - get_market_data Strands tool (Polymarket CLOB)
    - Create `infra/services/portfolio-lambda/tools/order-book.ts` - get_order_book Strands tool
    - Create `infra/services/portfolio-lambda/tools/analysis-reader.ts` - read_full_analysis Strands tool (S3)
    - Create `infra/services/portfolio-lambda/tools/trade-history.ts` - get_trade_history Strands tool (RDS)
    - Create `infra/services/portfolio-lambda/tools/session-performance.ts` - get_session_performance Strands tool (RDS)
    - All tools are read-only - no state mutation or order placement
    - _Requirements: 2.4, 3.5_

- [x] 10. Modify Dispatcher Lambda (analysis-orchestrator)
  - [x] 10.1 Replace AgentCore invocation with Lambda invocation in dispatcher
    - Modify `infra/services/analysis-orchestrator/handler.ts`
    - Remove imports: `@aws-sdk/client-bedrock-agentcore` (BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand)
    - Remove: agentCoreClient instantiation, AGENTCORE_RUNTIME_ARN env var, cold-start retry loop, runtimeSessionId tracking, stopSession() helper
    - Add: `@aws-sdk/client-lambda` LambdaClient + InvokeCommand
    - Add: ANALYSIS_LAMBDA_ARN env var
    - Invoke with InvocationType: 'RequestResponse', payload: { marketId, userId, requestId }
    - Parse response payload directly as TradeRecommendation (no snake_case normalization - TypeScript produces camelCase)
    - Remove `normalizeExplanation()`, `normalizeMetadata()`, and snake_case conversion logic
    - On FunctionError in response: refund credits, publish AnalysisFailed, re-throw for SQS retry
    - On valid NO_TRADE (internal fallback): process as normal success
    - Preserve all existing behavior: idempotency checks, S3 storage, RDS storage, delivery tracking, dedup cache, EventBridge publishing
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [x] 11. Modify Portfolio Lambdas (trade executor and position guard)
  - [x] 11.1 Replace AgentCore invocation with Lambda invocation in trade executor
    - Modify `infra/services/portfolio-trade-executor/handler.ts`
    - Remove imports: `@aws-sdk/client-bedrock-agentcore` (BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand)
    - Remove: agentCoreClient instantiation, PORTFOLIO_AGENTCORE_RUNTIME_ARN env var, runtimeSessionId tracking, stopSession() helper, onSessionId callback pattern
    - Add: `@aws-sdk/client-lambda` LambdaClient + InvokeCommand
    - Add: PORTFOLIO_LAMBDA_ARN env var
    - Invoke with InvocationType: 'RequestResponse', payload: { persona, analysisResult, portfolioState, marketData, decisionType: "entry" }
    - Parse response as PortfolioDecision, validate action + size_pct + reasoning present
    - Return null on invocation failure (existing skip-decision logic handles it)
    - Remove stopSession() call from finally block (no more session management)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_

  - [x] 11.2 Replace AgentCore invocation with Lambda invocation in position guard
    - Modify `infra/services/portfolio-position-guard/handler.ts`
    - Remove imports: `@aws-sdk/client-bedrock-agentcore` (BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand)
    - Remove: agentCoreClient instantiation, PORTFOLIO_AGENTCORE_RUNTIME_ARN env var, runtimeSessionId tracking, stopSession() helper
    - Add: `@aws-sdk/client-lambda` LambdaClient + InvokeCommand
    - Add: PORTFOLIO_LAMBDA_ARN env var
    - Invoke with InvocationType: 'RequestResponse', payload: { persona, portfolioState, marketData, decisionType: "exit_evaluation" }
    - Parse response as exit decision with field validation
    - Default to hold decision with conviction 0 on invocation failure
    - Remove stopSession() call from finally block
    - _Requirements: 12.4, 12.5, 12.7_

- [x] 12. Update CDK compute-stack and remove AgentCore infrastructure
  - [x] 12.1 Add Analysis_Lambda and Portfolio_Lambda to CDK compute-stack
    - Add Analysis_Lambda NodejsFunction: Node.js 20, 1024MB, 900s timeout, entry: services/analysis-lambda/handler.ts
    - Grant: bedrock:InvokeModel + bedrock:InvokeModelWithResponseStream, events:PutEvents, secretsmanager:GetSecretValue (DB secret), s3 read-write (analysis bucket), DynamoDB read-write (dedup cache)
    - Pass env vars: BEDROCK_MODEL_ID, NEWSDATA_API_KEY, SERPER_API_KEY, DB_SECRET_ARN, DB_HOST, ANALYSIS_HISTORY_DEPTH, ANALYSIS_BUCKET, EVENT_BUS_NAME, ENVIRONMENT
    - Add Portfolio_Lambda NodejsFunction: Node.js 20, 512MB, 120s timeout, entry: services/portfolio-lambda/handler.ts
    - Grant: bedrock:InvokeModel + bedrock:InvokeModelWithResponseStream, events:PutEvents, secretsmanager:GetSecretValue (DB secret)
    - Pass env vars: BEDROCK_MODEL_ID, DB_SECRET_ARN, DB_HOST, EVENT_BUS_NAME, ENVIRONMENT
    - Grant orchestrator Lambda: lambda:InvokeFunction for Analysis_Lambda ARN
    - Grant trade executor + position guard: lambda:InvokeFunction for Portfolio_Lambda ARN
    - Add ANALYSIS_LAMBDA_ARN env var to orchestrator Lambda
    - Add PORTFOLIO_LAMBDA_ARN env var to trade executor and position guard Lambdas
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9_

  - [x] 12.2 Remove all AgentCore references from CDK and platform
    - Remove AGENTCORE_RUNTIME_ARN env var from orchestrator Lambda definition
    - Remove PORTFOLIO_AGENTCORE_RUNTIME_ARN env var from trade executor and position guard definitions
    - Remove bedrock-agentcore IAM policies (InvokeAgentRuntime, StopRuntimeSession, etc.)
    - Remove any bedrock-agentcore.amazonaws.com trust policy references
    - Remove `@aws-sdk/client-bedrock-agentcore` from infra/package.json dependencies
    - Remove agentcore-related npm scripts from infra/package.json
    - Remove --skip-agents flag handling from deploy.sh
    - Remove deploy_agents function and agentcore CLI invocations from deploy.sh
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (16 properties total)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout - no language selection needed
- All Strands Agent instances should set `printer: false` (Lambda - no console streaming)
- The existing V1 tool implementations in `tradewizard-agents/src/tools/` serve as reference for News and Search tool logic
- Signal fusion and consensus engine are pure deterministic functions (no LLM) - ideal for property-based testing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "9.2", "9.3"] },
    { "id": 2, "tasks": ["1.4", "2.1", "2.3", "2.5"] },
    { "id": 3, "tasks": ["2.2", "2.4", "3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2", "6.1", "6.3"] },
    { "id": 6, "tasks": ["6.2", "6.4", "7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4"] },
    { "id": 8, "tasks": ["10.1", "11.1", "11.2"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2"] }
  ]
}
```
