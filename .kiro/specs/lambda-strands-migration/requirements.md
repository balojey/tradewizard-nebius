# Requirements Document

## Introduction

This specification defines the requirements for migrating TradeWizard's AI agent workflows from Amazon Bedrock AgentCore (Python/Strands SDK) to self-hosted AWS Lambda functions using the Strands SDK in TypeScript. The migration eliminates AgentCore as a dependency entirely, giving the team direct control over agent execution, tool availability, and runtime behavior. The two core runtimes - the Analysis Orchestrator (11-stage workflow with 14 intelligence agents) and the Portfolio Manager (persona-based trade decisions) - each become standalone Lambda functions running TypeScript with the Strands Agents SDK.

Key drivers for this migration:
- AgentCore reliability issues (code interpreter and browser tools failing intermittently)
- Desire for direct control over Lambda execution environment and tool configuration
- Consolidation on TypeScript as the single language for the entire platform
- Ability to use proven V1 tool implementations (NewsData.io, Serper) directly

## Glossary

- **Analysis_Lambda**: The AWS Lambda function hosting the self-contained analysis orchestrator workflow using Strands SDK in TypeScript
- **Portfolio_Lambda**: The AWS Lambda function hosting the self-contained portfolio manager agent using Strands SDK in TypeScript
- **Strands_SDK**: The Strands Agents SDK for TypeScript - provides Agent class, tool definitions, and model integrations for building agentic workflows
- **Intelligence_Agent**: One of 14 specialized sub-agents within the analysis workflow that produces an AgentSignal (direction, confidence, fair probability, key drivers, risk factors)
- **AgentSignal**: Structured output from each intelligence agent containing direction (YES/NO/NEUTRAL), confidence (0-1), fair_probability (0-1), key_drivers, and risk_factors
- **Shell_Analysis_Tool**: The Strands community bash tool that enables agents to run shell commands for data analysis on CSV/JSON files written to the Lambda /tmp directory
- **News_Tool**: A custom Strands tool wrapping NewsData.io for fetching breaking news, headlines, and historical articles
- **Search_Tool**: A custom Strands tool wrapping Serper API for web search and webpage scraping
- **Price_History_Data**: CSV file containing full Polymarket CLOB price history written to /tmp for agent shell analysis
- **Related_Markets_Data**: JSON file containing sibling market data written to /tmp for agent shell analysis
- **Dispatcher_Lambda**: The existing TypeScript Lambda (analysis-orchestrator/handler.ts) that currently invokes AgentCore - to be modified to invoke the new Analysis_Lambda directly
- **Orchestrator_Workflow**: The 11-stage sequential/parallel analysis pipeline producing a TradeRecommendation
- **TradeRecommendation**: The structured output of the analysis workflow containing action, entry/exit zones, explanation, and metadata
- **PortfolioDecision**: The structured output of the portfolio manager containing action, direction, size, price, reasoning, and conviction

## Requirements

### Requirement 1: Analysis Lambda Function Setup

**User Story:** As a platform operator, I want the analysis orchestrator to run as a self-contained TypeScript Lambda function using Strands SDK, so that I have direct control over the execution environment without AgentCore dependencies.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL be implemented as a TypeScript AWS Lambda function using the Strands Agents SDK
2. THE Analysis_Lambda SHALL accept a payload containing marketId (string), userId (string), and requestId (string) fields, where all three fields are required and non-empty
3. IF the Analysis_Lambda receives a payload missing any required field or containing an empty-string value for marketId, userId, or requestId, THEN THE Analysis_Lambda SHALL return a NO_TRADE fallback recommendation with the explanation field indicating which fields failed validation
4. THE Analysis_Lambda SHALL return a TradeRecommendation JSON object containing at minimum: marketId, action (LONG_YES | LONG_NO | NO_TRADE), entryZone, targetZone, stopLoss, expectedValue, winProbability, liquidityRisk, explanation, and metadata fields
5. THE Analysis_Lambda SHALL use the /tmp directory as a working directory for price history CSV and related markets JSON files created via tempfile during the 11-stage workflow
6. THE Analysis_Lambda SHALL be configured with a minimum of 1024MB memory and 900-second (15-minute) timeout to accommodate the full 11-stage workflow
7. THE Analysis_Lambda SHALL remove all files created in the /tmp working directory after workflow completion, regardless of whether the workflow succeeded or failed
8. IF the Analysis_Lambda encounters an unrecoverable error during workflow execution, THEN THE Analysis_Lambda SHALL return a NO_TRADE fallback recommendation with action set to NO_TRADE, liquidityRisk set to high, and the explanation.summary field describing the error that occurred

### Requirement 2: Portfolio Manager Lambda Function Setup

**User Story:** As a platform operator, I want the portfolio manager to run as a self-contained TypeScript Lambda function using Strands SDK, so that trade decisions are made reliably without AgentCore dependency.

#### Acceptance Criteria

1. THE Portfolio_Lambda SHALL be implemented as a TypeScript AWS Lambda function using the Strands Agents SDK for JavaScript/TypeScript
2. WHEN invoked, THE Portfolio_Lambda SHALL validate the incoming payload against a schema requiring all of the following fields: persona (string, one of the 6 defined persona identifiers), analysis_result (object containing analysisResultId, marketId, action, entryZone, targetZone, stopLoss, liquidityRisk, signalAlignment, confidence, and explanation), portfolio_state (object containing session, positions array, and capital_breakdown), market_data (object containing market_id, current_price, edge, and signal_alignment), and decision_type (string, either "entry" or "exit_evaluation")
3. WHEN the agent completes reasoning, THE Portfolio_Lambda SHALL return a PortfolioDecision JSON object containing: action (one of "enter", "hold", "exit", "scale", "skip"), direction ("YES", "NO", or null), size_pct (number 0.0–1.0), price (number or null), stop_loss_price (number or null), take_profit_price (number or null), order_type ("limit" or "market"), reasoning (string, maximum 500 characters), conviction (number 0.0–1.0), exit_reason (string or null), and is_pyramid (boolean)
4. WHEN invoked with a valid persona, THE Portfolio_Lambda SHALL construct a Strands Agent configured with the persona-specific system prompt and the read-only tool set (get_market_data, get_order_book, read_full_analysis, get_trade_history, get_session_performance)
5. THE Portfolio_Lambda SHALL be configured with a minimum of 512MB memory and a 120-second timeout
6. IF the Strands Agent invocation throws an exception or returns an unparseable response, THEN THE Portfolio_Lambda SHALL return a default skip decision with action "skip", size_pct 0.0, conviction 0.0, and a reasoning string indicating the nature of the failure
7. IF the payload fails schema validation, THEN THE Portfolio_Lambda SHALL return a default skip decision with reasoning indicating which required fields are missing or malformed

### Requirement 3: Strands SDK Agent Configuration

**User Story:** As a developer, I want all agents to be configured using Strands SDK's TypeScript Agent class with consistent model selection, so that agent behavior is predictable and maintainable.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL create Strands Agent instances using the Agent class from the Strands Agents SDK for TypeScript
2. WHEN creating an intelligence agent, THE Analysis_Lambda SHALL configure the agent with a system prompt, a tool list, and a model provider
3. THE Analysis_Lambda SHALL use Amazon Bedrock as the model provider via the Strands SDK Bedrock integration, configured with the AWS_REGION environment variable (defaulting to us-east-1)
4. THE Analysis_Lambda SHALL use the model ID specified by the BEDROCK_MODEL_ID environment variable (defaulting to amazon.nova-2-lite-v1:0) and the max tokens value specified by the BEDROCK_MAX_TOKENS environment variable (defaulting to 5120)
5. THE Portfolio_Lambda SHALL create a single Strands Agent instance per invocation configured with a persona-specific system prompt and tools that do not mutate portfolio state or place orders
6. THE Portfolio_Lambda SHALL read model configuration from the same environment variables (BEDROCK_MODEL_ID and AWS_REGION) as the Analysis_Lambda
7. IF the Portfolio_Lambda receives a request with an unrecognized or missing persona identifier, THEN THE Portfolio_Lambda SHALL skip agent invocation and return a default decision with action "skip", conviction 0.0, and reasoning indicating the invalid persona
8. IF the BEDROCK_MODEL_ID environment variable is not set, THEN THE Analysis_Lambda and Portfolio_Lambda SHALL each use their configured default model ID without failing to start

### Requirement 4: Data Preparation Stage (Price History and Related Markets)

**User Story:** As a developer, I want price history and related market data to be fetched deterministically at the start of analysis and written to /tmp, so that agents can analyze the data via shell commands.

#### Acceptance Criteria

1. WHEN the analysis workflow starts and the market briefing contains a YES token ID, THE Analysis_Lambda SHALL fetch the full price history from the Polymarket CLOB API at 60-minute (hourly) fidelity with a 30-second HTTP timeout
2. WHEN price history is fetched, THE Analysis_Lambda SHALL write it to a CSV file in /tmp with columns: timestamp, datetime_utc, price, and include metadata comment lines listing the market question, token ID, data point count, date range, and price range
3. WHEN the analysis workflow starts, THE Analysis_Lambda SHALL fetch up to 50 related sibling markets from the Polymarket Gamma API using the target market's condition ID
4. WHEN related markets are fetched, THE Analysis_Lambda SHALL write the data to a JSON file in /tmp including aggregate metrics: average_probability, volume_weighted_probability, sentiment_direction (bullish if weighted_prob > 0.55, bearish if < 0.45, else neutral), total_volume, and total_liquidity
5. WHEN at least one related sibling market is found, THE Analysis_Lambda SHALL fetch price history for the top 5 siblings ranked by volume in parallel using the same 60-minute fidelity and 30-second timeout per request
6. IF price history fetch fails, THEN THE Analysis_Lambda SHALL continue the workflow with an empty price history (csv_path set to empty string), provide a fallback summary indicating unavailability, and log a warning
7. IF related markets fetch fails, THEN THE Analysis_Lambda SHALL continue the workflow with an empty related markets list, provide a fallback summary indicating unavailability, and log a warning
8. WHEN the analysis workflow completes or fails, THE Analysis_Lambda SHALL delete the temporary working directory and all data files written during the data preparation stage

### Requirement 5: Shell Analysis Tool Integration

**User Story:** As a developer, I want price-aware agents to have access to a bash shell tool, so that they can run arbitrary data analysis commands on the price history CSV and related markets JSON files.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL provide the Strands community shell tool to price-aware intelligence agents (market_microstructure, probability_baseline, risk_assessment, polling_intelligence, momentum, mean_reversion)
2. WHEN a price-aware agent is invoked, THE Analysis_Lambda SHALL include the file path to the price history CSV in the agent's prompt text, along with an example code snippet demonstrating how to read and analyze the file
3. WHEN the polling_intelligence agent is invoked and related markets data is available, THE Analysis_Lambda SHALL include the file path to the related markets JSON in the agent's prompt text
4. THE Shell_Analysis_Tool SHALL execute commands within the working directory containing the prepared data files, with access to standard Unix utilities (awk, sed, grep, sort, head, tail, wc, bc, python3) and the Python standard library (csv, json, statistics, math)
5. IF a shell command exceeds 30 seconds, THEN THE Shell_Analysis_Tool SHALL terminate the command and return a timeout error to the agent
6. IF price history data is unavailable due to a fetch failure, THEN THE Analysis_Lambda SHALL invoke the price-aware agent without code execution tools and without a file path reference in the prompt, allowing the agent to produce a signal from prompt context alone

### Requirement 6: News Tool Integration (NewsData.io)

**User Story:** As a developer, I want news-focused agents to have access to a NewsData.io tool, so that they can fetch breaking news, recent headlines, and historical articles relevant to the market being analyzed.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL provide a custom News_Tool to news-focused intelligence agents (breaking_news, media_sentiment, event_impact, social_sentiment, narrative_velocity, catalyst_identification, tail_risk)
2. THE News_Tool SHALL integrate with the NewsData.io API using the NEWSDATA_API_KEY environment variable, supporting one or more comma-separated API keys for rotation
3. THE News_Tool SHALL support a fetchLatestNews function accepting parameters: query (optional, content search), queryInTitle (optional, title-only search), timeframe (one of 1h|6h|12h|24h|48h, default 24h), countries (optional, array of ISO country codes), categories (optional, array from business|entertainment|environment|food|health|politics|science|sports|technology|top|tourism|world), languages (optional, array, default ["en"]), sentiment (optional, one of positive|negative|neutral), size (1–50, default 20), and removeDuplicates (boolean, default true)
4. THE News_Tool SHALL support a fetchArchiveNews function accepting parameters: fromDate (required, YYYY-MM-DD), toDate (required, YYYY-MM-DD), query (optional), queryInTitle (optional), countries (optional), categories (optional), languages (optional), size (1–50, default 20), and removeDuplicates (boolean, default true)
5. THE News_Tool SHALL return articles in a structured format including: article_id (string), title (string), url (string), source name (string), source priority (number), description (string), content (string), published date (ISO 8601 string), language (string), categories (array), countries (array), and optional AI-enhanced fields (sentiment, sentiment_stats, ai_tags, ai_summary)
6. IF the NewsData.io API returns an error or does not respond within 15 seconds, THEN THE News_Tool SHALL return a structured error object containing an error flag, the originating tool name, a message indicating the failure reason, and the original query parameters, without crashing the agent
7. THE News_Tool SHALL enforce a maximum of 50 articles per request to stay within NewsData.io response limits
8. IF the NewsData.io API returns zero matching articles, THEN THE News_Tool SHALL return an empty articles array with a total_results count of 0
9. IF a NEWSDATA_API_KEY is rate-limited (HTTP 429), THEN THE News_Tool SHALL rotate to the next available API key and retry the request

### Requirement 7: Web Search Tool Integration (Serper)

**User Story:** As a developer, I want research-oriented agents to have access to a Serper web search tool, so that they can search the web and scrape pages for real-time information.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL provide a custom Search_Tool to all browser-capable intelligence agents (breaking_news, media_sentiment, event_impact, historical_patterns, social_sentiment, narrative_velocity, catalyst_identification, tail_risk)
2. THE Search_Tool SHALL integrate with the Serper API using the SERPER_API_KEY environment variable, supporting one or more comma-separated API keys for rotation
3. WHEN invoked for web search, THE Search_Tool SHALL call the Serper /search endpoint and return organic results where each result contains a title, URL, snippet, and position, defaulting to 10 results when no count is specified
4. WHEN invoked for page scraping, THE Search_Tool SHALL call the Serper /scrape endpoint and return the page title and text content, returning empty strings for title and text if the page yields no extractable content
5. THE Search_Tool SHALL support optional parameters: number of results (integer, 1-20), time range filter (one of: hour, day, week, month, year), and country filter (ISO 3166-1 alpha-2 country code)
6. IF the Serper API returns an error, THEN THE Search_Tool SHALL return a structured error object containing an error flag, the originating tool name, and a descriptive message to the agent without crashing the agent execution
7. IF the Serper API does not respond within 30 seconds, THEN THE Search_Tool SHALL abort the request and return a timeout error to the agent
8. IF a Serper API key is rate-limited (HTTP 429), THEN THE Search_Tool SHALL rotate to the next available API key and retry the request without counting the rotation as a retry attempt, up to a maximum of 3 retry attempts for non-blocking errors

### Requirement 8: Parallel Intelligence Agent Execution

**User Story:** As a developer, I want all 14 intelligence agents to execute in parallel within the Analysis Lambda, so that the full analysis completes within acceptable time bounds.

#### Acceptance Criteria

1. WHEN the intelligence agent stage begins, THE Analysis_Lambda SHALL invoke all 14 intelligence agents concurrently using Promise.all or equivalent parallel execution mechanism
2. IF an individual intelligence agent raises an exception or fails to return a parseable AgentSignal, THEN THE Analysis_Lambda SHALL capture the error and produce a fallback NEUTRAL signal with confidence 0.3 and fair_probability 0.5 for that agent
3. IF 10 or fewer of the 14 intelligence agents fail, THEN THE Analysis_Lambda SHALL continue the workflow using the fallback NEUTRAL signals for failed agents and valid signals for successful agents
4. IF more than 10 of the 14 intelligence agents fail, THEN THE Analysis_Lambda SHALL abort the workflow and return a NO_TRADE recommendation with an explanation indicating insufficient intelligence coverage
5. WHEN all 14 agent tasks have resolved (either successfully or via fallback), THE Analysis_Lambda SHALL collect all 14 AgentSignal results and pass the complete list to the signal fusion stage
6. THE Analysis_Lambda SHALL enforce a per-agent timeout of 120 seconds, treating any agent that exceeds this duration as a failed agent subject to the fallback behavior defined in criterion 2

### Requirement 9: Deterministic Fusion and Consensus Stages

**User Story:** As a developer, I want the signal fusion and consensus engine to be implemented as pure TypeScript functions (no LLM calls), so that they produce consistent, deterministic results.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL implement signal fusion as a deterministic function that accepts an array of 1 to 14 AgentSignals and an agent performance map, and produces a FusedSignal containing weighted_fair_probability, fusion_confidence, signal_alignment, and conflict_map
2. THE signal fusion function SHALL calculate each agent's weight as the product of its type weight (from a fixed lookup table per agent name), its confidence value (0 to 1), and its historical performance score (defaulting to 1.0 if unavailable)
3. IF the maximum divergence between any two agent fair probabilities exceeds 0.70, THEN THE signal fusion function SHALL reduce the fusion_confidence by 50%
4. THE Analysis_Lambda SHALL implement the consensus engine as a deterministic function that accepts the FusedSignal, CrossExamResult (bull_score and bear_score each in the range negative 5 to 5), and bull and bear Thesis objects
5. THE consensus engine SHALL calculate the disagreement index as the standard deviation of the bull thesis fair probability, bear thesis fair probability, and fused signal weighted fair probability, and SHALL flag consensus as failed when the disagreement index exceeds 0.30
6. IF consensus is flagged as failed, THEN THE consensus engine SHALL return NO_TRADE regardless of edge calculation
7. THE consensus engine SHALL determine the trade action by comparing the edge (consensus probability minus market probability) against a minimum edge threshold of 0.05, returning LONG_YES when edge exceeds the threshold, LONG_NO when edge is below negative threshold, and NO_TRADE otherwise
8. IF the liquidity risk is "high", THEN THE consensus engine SHALL increase the minimum edge threshold by 50% (from 0.05 to 0.075) before comparing against the calculated edge

### Requirement 10: Thesis, Cross-Examination, and Risk Philosophy Stages

**User Story:** As a developer, I want the thesis construction, cross-examination, and risk philosophy stages to use Strands agents, so that they produce structured reasoning within the analysis workflow.

#### Acceptance Criteria

1. WHEN the thesis construction stage runs, THE Analysis_Lambda SHALL create a Strands Agent that generates a JSON object containing a bull_thesis (direction, fair_probability, key_arguments, confidence) and a bear_thesis (direction, fair_probability, key_arguments, confidence) from the fused signal and individual agent signals
2. WHEN the cross-examination stage runs, THE Analysis_Lambda SHALL create a Strands Agent that applies 5 adversarial tests (evidence quality, causality, timing, liquidity, tail risk) to both theses and produces a JSON object containing a bull_score and bear_score each in the range -5.0 to +5.0
3. WHEN the risk philosophy stage runs, THE Analysis_Lambda SHALL create 3 Strands Agents concurrently via Promise.all (aggressive, conservative, neutral) that each return a JSON object containing position_size_pct, kelly_fraction, entry_strategy, stop_loss_distance, take_profit_distance, reasoning, and max_drawdown_tolerance
4. WHEN the recommendation stage runs and consensus has not failed, THE Analysis_Lambda SHALL create a Strands Agent that synthesizes the consensus probability, risk perspectives, theses, and cross-examination scores into a TradeRecommendation containing action, entry_zone, target_zone, stop_loss, expected_value, win_probability, liquidity_risk, and explanation
5. IF any thesis/cross-exam/risk/recommendation agent fails to produce parseable JSON, THEN THE Analysis_Lambda SHALL attempt extraction first via markdown code-fence regex, then via outermost balanced-brace matching, and if both strategies fail SHALL use stage-specific defaults: neutral theses with 0.3 confidence for thesis, zero scores for cross-exam, "unavailable" text for risk perspectives, and a NO_TRADE recommendation for recommendation
6. IF the thesis construction or cross-examination stage throws an unhandled exception, THEN THE Analysis_Lambda SHALL log the error, substitute fallback values (fallback theses with fused signal probability and 0.3 confidence, or neutral CrossExamResult with zero scores), and continue the workflow without aborting

### Requirement 11: Dispatcher Lambda Modification

**User Story:** As a platform operator, I want the existing dispatcher Lambda to invoke the new Analysis Lambda directly instead of AgentCore, so that the migration is transparent to the rest of the platform.

#### Acceptance Criteria

1. THE Dispatcher_Lambda SHALL invoke the Analysis_Lambda using the AWS Lambda Invoke API (aws-sdk/client-lambda) with the function ARN specified by the ANALYSIS_LAMBDA_ARN environment variable, instead of BedrockAgentCore InvokeAgentRuntimeCommand
2. THE Dispatcher_Lambda SHALL pass the payload as a JSON object containing marketId, userId, and requestId fields to the Analysis_Lambda
3. THE Dispatcher_Lambda SHALL parse the Analysis_Lambda response directly as a TradeRecommendation JSON object without snake_case to camelCase normalization (TypeScript produces camelCase natively)
4. THE Dispatcher_Lambda SHALL remove all AgentCore-specific code (BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand, cold-start retry loop, and runtimeSessionId session management) while preserving all other existing behavior including idempotency checks, S3 storage, RDS result storage, delivery tracking, dedup cache updates, and EventBridge event publishing
5. IF the Analysis_Lambda invocation returns a FunctionError (unhandled exception in the target function), THEN THE Dispatcher_Lambda SHALL treat it as a failed analysis: refund credits to all subscribers for that market, publish an AnalysisFailed event to EventBridge, and re-throw to allow SQS retry
6. WHEN invoking the Analysis_Lambda, THE Dispatcher_Lambda SHALL use the RequestResponse invocation type to receive the result synchronously
7. IF the Analysis_Lambda returns a valid response with action NO_TRADE due to an internal fallback, THEN THE Dispatcher_Lambda SHALL process it as a normal successful result (store, deliver, publish AnalysisCompleted)

### Requirement 12: Portfolio Manager Dispatcher Modification

**User Story:** As a platform operator, I want the portfolio trade executor to invoke the new Portfolio Lambda directly instead of AgentCore, so that trade decisions continue flowing correctly.

#### Acceptance Criteria

1. THE portfolio trade executor Lambda SHALL invoke the Portfolio_Lambda using the AWS Lambda Invoke API (@aws-sdk/client-lambda InvokeCommand) with RequestResponse invocation type instead of BedrockAgentCoreClient InvokeAgentRuntimeCommand
2. THE portfolio trade executor Lambda SHALL pass the same payload format (persona, analysis_result, portfolio_state, market_data, decision_type) to the Portfolio_Lambda
3. THE portfolio trade executor Lambda SHALL parse the Portfolio_Lambda response as a PortfolioDecision JSON, validating that action, size_pct, and reasoning fields are present before accepting the decision
4. THE portfolio trade executor Lambda SHALL remove all AgentCore-specific code including: BedrockAgentCoreClient instantiation, InvokeAgentRuntimeCommand usage, StopRuntimeSessionCommand usage, runtimeSessionId tracking, PORTFOLIO_AGENTCORE_RUNTIME_ARN configuration, and the stopSession helper function
5. THE portfolio position guard Lambda SHALL invoke the Portfolio_Lambda using the same AWS Lambda Invoke API mechanism with decision_type set to "exit_evaluation" and SHALL parse the response using the same PortfolioDecision validation logic
6. IF the Portfolio_Lambda invocation fails or returns a non-200 status code (FunctionError present in response), THEN THE portfolio trade executor Lambda SHALL return null from the invocation function so that the existing skip-decision logic records a pipeline_failure
7. IF the Portfolio_Lambda invocation fails or returns a non-200 status code within the position guard, THEN THE portfolio position guard Lambda SHALL default to a hold decision with conviction 0 to preserve the existing position

### Requirement 13: Historical Context (Agent Memory) Integration

**User Story:** As a developer, I want intelligence agents to receive their own historical signals from previous runs, so that agents can maintain consistency and detect drift in their own analysis.

#### Acceptance Criteria

1. WHEN the analysis workflow starts, THE Analysis_Lambda SHALL fetch historical agent signals for the target market from the RDS agent_memory table, querying by market_id and ordering by executed_at descending
2. THE Analysis_Lambda SHALL retrieve database credentials from the Secrets Manager secret identified by the DB_SECRET_ARN environment variable, falling back to the DB_HOST environment variable for the RDS endpoint if the host is not present in the secret
3. WHEN building agent prompts, THE Analysis_Lambda SHALL filter memory entries to include only signals matching the current agent's agent_name, so that each agent receives only its own historical signals without cross-agent anchoring
4. THE Analysis_Lambda SHALL fetch the most recent N analyses where N is configured via the ANALYSIS_HISTORY_DEPTH environment variable (default 5, minimum 1, maximum 20), and IF ANALYSIS_HISTORY_DEPTH is set to a value outside the 1–20 range, THEN THE Analysis_Lambda SHALL clamp it to the nearest bound
5. IF the database connection fails or the credentials cannot be retrieved from Secrets Manager, THEN THE Analysis_Lambda SHALL continue the workflow without historical context, passing an empty history list to all agents, and log a warning-level message indicating the failure reason
6. IF no historical analyses exist in the agent_memory table for the target market, THEN THE Analysis_Lambda SHALL proceed with an empty history list and not treat the absence as an error

### Requirement 14: Environment Configuration and Secrets

**User Story:** As a platform operator, I want all API keys and configuration to be sourced from environment variables and AWS Secrets Manager, so that sensitive credentials are managed securely.

#### Acceptance Criteria

1. THE Analysis_Lambda SHALL read BEDROCK_MODEL_ID, AWS_REGION, NEWSDATA_API_KEY, SERPER_API_KEY, ANALYSIS_HISTORY_DEPTH, DB_SECRET_ARN, DB_HOST, EVENT_BUS_NAME, and BYPASS_TOOL_CONSENT from environment variables
2. THE Portfolio_Lambda SHALL read BEDROCK_MODEL_ID, AWS_REGION, RDS_CLUSTER_ARN, RDS_SECRET_ARN, RDS_DATABASE, and ANALYSIS_RESULTS_BUCKET from environment variables
3. WHERE API keys are stored in AWS Secrets Manager, WHEN the Lambda function performs a cold start, THE Lambda function SHALL retrieve the secret value and cache it in memory for reuse across subsequent invocations within the same container lifetime
4. IF retrieval from AWS Secrets Manager fails during cold start, THEN THE Lambda function SHALL log an error message identifying the secret ARN that failed and the error category, and SHALL terminate initialization within 5 seconds
5. WHEN the Analysis_Lambda performs a cold start, THE Analysis_Lambda SHALL validate that all required environment variables (BEDROCK_MODEL_ID, AWS_REGION, ANALYSIS_HISTORY_DEPTH, DB_SECRET_ARN, DB_HOST, EVENT_BUS_NAME) are present and non-empty, and SHALL log one error message per missing variable identifying the variable name before failing initialization
6. WHEN the Portfolio_Lambda performs a cold start, THE Portfolio_Lambda SHALL validate that all required environment variables (BEDROCK_MODEL_ID, AWS_REGION, RDS_CLUSTER_ARN, RDS_SECRET_ARN, RDS_DATABASE, ANALYSIS_RESULTS_BUCKET) are present and non-empty, and SHALL log one error message per missing variable identifying the variable name before failing initialization
7. THE Lambda functions SHALL NOT log or expose secret values in any log output, error messages, or API responses

### Requirement 15: CDK Infrastructure for New Lambda Functions

**User Story:** As a platform operator, I want the new Lambda functions to be provisioned via CDK, so that deployment is repeatable and infrastructure is managed as code.

#### Acceptance Criteria

1. THE CDK compute stack SHALL define the Analysis_Lambda with Node.js 20 runtime, 1024MB memory, 900-second timeout, bedrock:InvokeModel permission, events:PutEvents permission for the event bus, and secretsmanager:GetSecretValue permission for the database secret
2. THE CDK compute stack SHALL define the Portfolio_Lambda with Node.js 20 runtime, 512MB memory, 120-second timeout, bedrock:InvokeModel permission, events:PutEvents permission for the event bus, and secretsmanager:GetSecretValue permission for the database secret
3. THE CDK compute stack SHALL grant both Lambda functions bedrock:InvokeModel and bedrock:InvokeModelWithResponseStream permissions scoped to all Bedrock model resources in the deployment region
4. THE CDK compute stack SHALL grant both the Analysis_Lambda and Portfolio_Lambda secretsmanager:GetSecretValue permission for the RDS database secret so they can connect to the publicly accessible RDS endpoint over SSL
5. THE CDK compute stack SHALL pass the following environment variables to the Analysis_Lambda: BEDROCK_MODEL_ID, NEWSDATA_API_KEY, SERPER_API_KEY, DB_SECRET_ARN, DB_HOST, ANALYSIS_HISTORY_DEPTH, ANALYSIS_BUCKET, EVENT_BUS_NAME, and ENVIRONMENT; and to the Portfolio_Lambda: BEDROCK_MODEL_ID, DB_SECRET_ARN, DB_HOST, EVENT_BUS_NAME, and ENVIRONMENT
6. THE CDK compute stack SHALL configure the Dispatcher_Lambda with lambda:InvokeFunction permission scoped to the Analysis_Lambda function ARN
7. THE CDK compute stack SHALL configure the portfolio trade executor and position guard Lambdas with lambda:InvokeFunction permission scoped to the Portfolio_Lambda function ARN
8. THE CDK compute stack SHALL grant the Analysis_Lambda read-write access to the analysis results S3 bucket for storing analysis payloads
9. THE CDK compute stack SHALL grant the Analysis_Lambda read-write access to the dedup cache DynamoDB table for in-flight tracking

### Requirement 16: AgentCore Removal

**User Story:** As a platform operator, I want all AgentCore dependencies removed from the platform, so that there are no unused infrastructure costs or orphaned resources.

#### Acceptance Criteria

1. WHEN migration is complete, THE CDK stacks SHALL not contain any IAM role or policy that grants permissions to bedrock-agentcore actions (InvokeAgentRuntime, StopRuntimeSession, CreateCodeInterpreter, StartBrowserSession, or any action prefixed with bedrock-agentcore:) and SHALL not reference the bedrock-agentcore.amazonaws.com service principal in any trust policy
2. WHEN migration is complete, THE Dispatcher_Lambda (analysis-orchestrator/handler.ts) and portfolio Lambdas (portfolio-trade-executor/handler.ts, portfolio-position-guard/handler.ts) SHALL have no import of @aws-sdk/client-bedrock-agentcore and SHALL not instantiate BedrockAgentCoreClient, InvokeAgentRuntimeCommand, or StopRuntimeSessionCommand
3. WHEN migration is complete, THE platform package.json SHALL not list @aws-sdk/client-bedrock-agentcore in dependencies or devDependencies, and running `npm ls @aws-sdk/client-bedrock-agentcore` SHALL exit with a non-zero status indicating the package is not installed
4. THE CDK compute stack (lib/compute-stack.ts) SHALL remove the AGENTCORE_RUNTIME_ARN and PORTFOLIO_AGENTCORE_RUNTIME_ARN environment variables from all Lambda function definitions, and no Lambda function in the synthesized CloudFormation template SHALL contain an environment variable whose key includes "AGENTCORE"
5. WHEN migration is complete, THE deploy.sh script SHALL not accept a --skip-agents flag, SHALL not invoke the `agentcore` CLI, SHALL not reference the `tradewizardAgents/agentcore/` directory, and SHALL not execute the deploy_agents function or any step that resolves or wires AgentCore runtime ARNs into Lambda configurations
6. WHEN migration is complete, THE platform SHALL not contain any `agentcore.json`, `aws-targets.json`, or AgentCore CDK construct files under the `tradewizardAgents/agentcore/` directory, and the `infra/package.json` scripts section SHALL not include any npm script prefixed with `agentcore:`
7. IF a `cdk synth` is executed after migration, THEN THE synthesized CloudFormation templates SHALL produce zero references to the string "bedrock-agentcore" across all stack templates

### Requirement 17: Web Research Agent Implementation

**User Story:** As a developer, I want the web research agent to use the Serper search and scrape tools instead of AgentCore Browser, so that web research is reliable and under our direct control.

#### Acceptance Criteria

1. THE web research agent SHALL be implemented as a Strands Agent with access to a Serper-based search tool (google.serper.dev/search) and a Serper-based scrape tool (scrape.serper.dev) for retrieving web page content
2. WHEN invoked, THE web research agent SHALL perform autonomous multi-step research by iterating: search → identify relevant results based on recency and topical relevance to the market question → scrape selected pages → synthesize findings, completing within a maximum of 60 seconds
3. THE web research agent SHALL produce a text research brief of no more than 4000 characters that is provided to all 14 downstream intelligence agents via the orchestrator prompt context
4. THE web research agent SHALL be limited to a maximum of 10 search calls and 5 scrape calls per invocation to control cost and latency
5. IF the web research agent raises an exception or returns an empty string, THEN THE orchestrator SHALL continue the workflow with the research brief set to "Web research unavailable." and log a warning
6. IF the Serper API returns an error response or times out on an individual call, THEN THE web research agent SHALL skip that call, continue with remaining research steps, and include only successfully retrieved information in the research brief
