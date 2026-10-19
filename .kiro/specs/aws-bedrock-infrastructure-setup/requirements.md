# Requirements Document

## Introduction

This document specifies the requirements for migrating TradeWizard from the legacy Amazon Bedrock Agents API to Amazon Bedrock AgentCore. The migration replaces managed instruction-string agents with full Python agent applications (Strands SDK) deployed to isolated microVMs, enabling autonomous web browsing, custom tool integration, and complete control over the agent execution loop. It also introduces a hybrid Portfolio Manager architecture where an AI agent handles reasoning while deterministic guardrails enforce safety invariants.

## Glossary

- **AgentCore_Runtime**: Amazon Bedrock AgentCore serverless hosting platform that runs custom Python agent code in isolated Firecracker microVMs
- **Strands_SDK**: Python multi-agent framework (`strands-agents`) used to build agent applications for AgentCore
- **Dispatcher_Lambda**: Thin AWS Lambda function that invokes AgentCore Runtime and handles pre/post-processing
- **Signal_Fusion**: Deterministic weighted aggregation of AgentSignal outputs from intelligence agents (no LLM involvement)
- **Consensus_Engine**: Deterministic calculation of final probability from thesis scores and fused signals (no LLM involvement)
- **Portfolio_Agent**: Read-only AgentCore application that reasons about trading decisions but never executes orders
- **Kill_Switch**: Atomic DynamoDB flag that immediately halts all portfolio trading activity
- **Persona**: One of six trading strategy profiles (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider)
- **Capital_Conservation_Invariant**: The rule that positions + pending + available ≤ investment_amount at all times
- **AgentSignal**: Structured output from each intelligence agent containing direction, confidence, fair_probability, key_drivers, and risk_factors
- **BedrockAgentCoreApp**: Python SDK class that wraps agent code for deployment to AgentCore Runtime
- **InvokeAgentRuntimeCommand**: AWS SDK command to invoke an AgentCore Runtime application
- **StopRuntimeSession**: AWS SDK command to terminate an AgentCore session to prevent idle billing

## Requirements

### Requirement 1: Legacy Infrastructure Removal

**User Story:** As a platform engineer, I want to remove the legacy Bedrock Agents infrastructure, so that the codebase no longer depends on the deprecated `@aws-sdk/client-bedrock-agent` API.

#### Acceptance Criteria

1. WHEN the migration is complete, THE System SHALL NOT contain the file `infra/agents/deploy-agents.ts`
2. WHEN the migration is complete, THE System SHALL NOT contain the file `infra/agents/agent-definitions.ts`
3. WHEN the migration is complete, THE System SHALL NOT import from `@aws-sdk/client-bedrock-agent` or `@aws-sdk/client-bedrock-agent-runtime` in any production code
4. WHEN the migration is complete, THE Bedrock_Stack SHALL NOT create IAM roles trusting `bedrock.amazonaws.com` as a service principal

### Requirement 2: AgentCore IAM Configuration

**User Story:** As a platform engineer, I want the CDK stack to provision correct IAM roles for AgentCore, so that the runtime and Lambda functions have appropriate permissions.

#### Acceptance Criteria

1. THE Bedrock_Stack SHALL create an execution role that trusts `bedrock-agentcore.amazonaws.com` as the service principal
2. THE execution role SHALL have permissions for `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`
3. THE execution role SHALL have permissions for `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents`
4. THE Dispatcher_Lambda role SHALL have permissions for `bedrock-agentcore:InvokeAgentRuntime` and `bedrock-agentcore:StopRuntimeSession`
5. WHEN the Bedrock_Stack is deployed, THE System SHALL output the AgentCore execution role ARN for use during agent deployment

### Requirement 3: Analysis Orchestrator Lambda (Thin Dispatcher)

**User Story:** As a platform engineer, I want the analysis orchestrator Lambda to be a thin dispatcher that invokes AgentCore Runtime, so that all agent logic runs inside the AgentCore microVM.

#### Acceptance Criteria

1. WHEN an analysis request arrives from SQS, THE Dispatcher_Lambda SHALL invoke the AgentCore Runtime using `InvokeAgentRuntimeCommand` with the market ID and user ID in the payload
2. WHEN the AgentCore Runtime returns a response, THE Dispatcher_Lambda SHALL parse the response as a TradeRecommendation JSON object
3. WHEN the AgentCore invocation completes (success or failure), THE Dispatcher_Lambda SHALL call `StopRuntimeSession` in a finally block to prevent idle billing
4. WHEN the AgentCore invocation succeeds, THE Dispatcher_Lambda SHALL store the result in S3 and publish an AnalysisCompleted event to EventBridge
5. IF the AgentCore invocation fails, THEN THE Dispatcher_Lambda SHALL refund the user's credit and publish an AnalysisFailed event
6. IF the AgentCore response is unparseable, THEN THE Dispatcher_Lambda SHALL use a fallback NO_TRADE recommendation and log a warning

### Requirement 4: AgentCore Analysis Application

**User Story:** As a platform engineer, I want a Python application deployed to AgentCore Runtime that executes the full 11-stage analysis workflow using Strands SDK, so that agents have full control over their execution loop.

#### Acceptance Criteria

1. THE AgentCore analysis application SHALL expose a `handle_analysis` entrypoint decorated with `@app.entrypoint` that accepts a payload containing `marketId` and `userId`
2. THE application SHALL execute the 11-stage workflow: market ingestion, memory retrieval, web research, dynamic agent selection, parallel intelligence agents, signal fusion, thesis construction, cross-examination, consensus engine, risk philosophy, and recommendation generation
3. THE application SHALL use Strands SDK `Agent` class to create sub-agents for each intelligence stage
4. THE application SHALL use AgentCore Browser for autonomous web research without requiring external API keys
5. THE application SHALL return a structured TradeRecommendation JSON object containing action, entry/target zones, stop-loss, expected value, explanation, and metadata
6. WHILE executing parallel intelligence agents, THE application SHALL use `asyncio.gather` to run agents concurrently within the microVM

### Requirement 5: Deterministic Signal Fusion

**User Story:** As a platform engineer, I want signal fusion to remain deterministic and LLM-free after migration, so that the same inputs always produce the same fused output.

#### Acceptance Criteria

1. THE Signal_Fusion function SHALL compute a weighted fair probability in the range [0, 1] from all AgentSignal inputs
2. THE Signal_Fusion function SHALL compute fusion confidence in the range [0, 1]
3. THE Signal_Fusion function SHALL compute signal alignment in the range [0, 1] where 1.0 indicates perfect agreement
4. WHEN the maximum divergence between any two agents exceeds 0.7, THE Signal_Fusion function SHALL reduce confidence by 50%
5. THE Signal_Fusion function SHALL identify all agent pairs with divergence exceeding 0.2 in the conflict map
6. THE Signal_Fusion function SHALL weight agents by type weight, individual confidence, and historical performance score

### Requirement 6: Deterministic Consensus Engine

**User Story:** As a platform engineer, I want the consensus engine to remain deterministic and LLM-free after migration, so that trade action decisions are reproducible.

#### Acceptance Criteria

1. THE Consensus_Engine SHALL compute a consensus probability as 60% thesis-weighted probability plus 40% signal fusion probability
2. WHEN the disagreement index exceeds 0.3, THE Consensus_Engine SHALL mark consensus as failed
3. WHEN consensus has failed, THE `determine_action` function SHALL return NO_TRADE regardless of edge size
4. WHEN the edge exceeds the minimum threshold (5%, adjusted for liquidity), THE `determine_action` function SHALL return LONG_YES or LONG_NO based on edge direction
5. WHEN liquidity risk is high, THE `determine_action` function SHALL increase the minimum edge threshold by 50%
6. THE `determine_action` function SHALL be purely deterministic with no randomness or LLM involvement

### Requirement 7: AgentCore Portfolio Manager Application

**User Story:** As a platform engineer, I want a separate Python application deployed to AgentCore Runtime that makes persona-specific trading decisions, so that portfolio management benefits from AI reasoning while remaining read-only.

#### Acceptance Criteria

1. THE Portfolio_Agent application SHALL expose a `handle_trade_decision` entrypoint that accepts persona, analysis result, portfolio state, market data, and decision type
2. THE Portfolio_Agent SHALL build persona-specific system prompts based on the 6 defined personas (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider)
3. THE Portfolio_Agent SHALL have access to read-only tools only: `get_market_data`, `get_order_book`, `read_full_analysis`, `get_trade_history`, `get_session_performance`
4. THE Portfolio_Agent SHALL return a structured PortfolioDecision JSON containing action, direction, size_pct, price, order_type, reasoning (500+ chars), and conviction
5. THE Portfolio_Agent SHALL NOT have any tool that executes orders, modifies positions, or writes to the trading API

### Requirement 8: Portfolio Trade Executor (Dispatcher Rewrite)

**User Story:** As a platform engineer, I want the trade executor Lambda rewritten as a thin dispatcher with deterministic safety gates, so that the agent's decisions are always validated before execution.

#### Acceptance Criteria

1. WHEN an analysis-complete event arrives, THE Trade_Executor SHALL check the kill switch in DynamoDB before any processing
2. WHEN the kill switch is active, THE Trade_Executor SHALL reject processing immediately without invoking AgentCore
3. THE Trade_Executor SHALL verify session status is active and no cooldown is in effect before invoking AgentCore
4. THE Trade_Executor SHALL acquire a DynamoDB distributed lock before invoking the Portfolio_Agent
5. WHEN the Portfolio_Agent returns a decision, THE Trade_Executor SHALL validate that `size_pct * available_capital` does not exceed 50% of total session capital
6. WHEN the Portfolio_Agent returns a decision, THE Trade_Executor SHALL validate that `size_pct * available_capital` does not exceed the persona's max allocation percentage
7. WHEN the Portfolio_Agent returns a decision, THE Trade_Executor SHALL validate that `size_pct * available_capital` is at least $5
8. WHEN the Portfolio_Agent returns a decision, THE Trade_Executor SHALL verify the capital conservation invariant holds after the proposed trade
9. IF the agent decision fails validation, THEN THE Trade_Executor SHALL reject the decision, log the reasoning, and skip order execution
10. WHEN validation passes, THE Trade_Executor SHALL execute the order on the Polymarket CLOB API and record the decision in RDS
11. WHEN processing completes (success or failure), THE Trade_Executor SHALL release the distributed lock and call StopRuntimeSession

### Requirement 9: Portfolio Position Guard (Dispatcher Rewrite)

**User Story:** As a platform engineer, I want the position guard Lambda rewritten as a thin dispatcher that invokes AgentCore for exit reasoning, so that exit decisions benefit from AI judgment while safety gates remain deterministic.

#### Acceptance Criteria

1. WHEN a scheduled evaluation triggers, THE Position_Guard SHALL check the kill switch before processing
2. WHEN the kill switch is active, THE Position_Guard SHALL reject processing immediately without invoking AgentCore
3. THE Position_Guard SHALL acquire a DynamoDB distributed lock before invoking the Portfolio_Agent
4. THE Position_Guard SHALL invoke the Portfolio_Agent with decision_type "exit_evaluation" and current position context
5. WHEN the Portfolio_Agent returns an exit decision, THE Position_Guard SHALL validate the decision before executing
6. WHEN processing completes, THE Position_Guard SHALL release the lock and call StopRuntimeSession

### Requirement 10: Kill Switch Totality

**User Story:** As a platform engineer, I want the kill switch to be an absolute, atomic safety mechanism, so that when activated, ALL trading activity stops immediately regardless of agent state.

#### Acceptance Criteria

1. WHEN the kill switch is active, THE Trade_Executor SHALL reject all processing without invoking AgentCore
2. WHEN the kill switch is active, THE Position_Guard SHALL reject all processing without invoking AgentCore
3. WHEN the kill switch is activated during an agent invocation, THE Dispatcher_Lambda SHALL discard the agent's response after receiving it and not execute any orders
4. THE kill switch check SHALL occur BEFORE acquiring distributed locks to minimize resource contention

### Requirement 11: Session Cost Management

**User Story:** As a platform engineer, I want AgentCore sessions to be stopped immediately after use, so that idle microVM billing is eliminated.

#### Acceptance Criteria

1. WHEN an AgentCore invocation completes successfully, THE Dispatcher_Lambda SHALL call StopRuntimeSession
2. WHEN an AgentCore invocation fails with an error, THE Dispatcher_Lambda SHALL call StopRuntimeSession in the finally block
3. IF StopRuntimeSession itself fails, THEN THE System SHALL log a warning and rely on the idle timeout as a fallback

### Requirement 12: AgentSignal Data Model

**User Story:** As a platform engineer, I want a well-defined AgentSignal data model shared between Python agents and TypeScript Lambdas, so that signals can be serialized and deserialized reliably across language boundaries.

#### Acceptance Criteria

1. THE AgentSignal model SHALL contain: agent_name (string), direction (YES|NO|NEUTRAL), confidence (float 0-1), fair_probability (float 0-1), key_drivers (list of strings), risk_factors (list of strings), and timestamp (ISO string)
2. FOR ALL valid AgentSignal objects, serializing to JSON and deserializing back SHALL produce an equivalent object with all fields preserved
3. WHEN an agent returns a signal with confidence outside [0, 1], THE System SHALL clamp the value to the valid range

### Requirement 13: Conviction Score Removal

**User Story:** As a platform engineer, I want to remove the deterministic conviction-score.ts module, so that conviction reasoning is handled naturally by the Portfolio Agent instead of a fixed formula.

#### Acceptance Criteria

1. WHEN the migration is complete, THE System SHALL NOT contain the file `infra/services/shared/conviction-score.ts`
2. THE Portfolio_Agent SHALL include a `conviction` field (0.0-1.0) in its decision output representing its self-assessed conviction
3. THE Trade_Executor SHALL use the agent's conviction value for logging and notification purposes only, not for overriding position sizing validation

### Requirement 14: Project Structure and Deployment

**User Story:** As a platform engineer, I want the AgentCore applications to follow a standard project structure compatible with the `@aws/agentcore` CLI, so that deployment is straightforward.

#### Acceptance Criteria

1. THE analysis orchestrator application SHALL reside in `infra/agentcore/` with a `main.py` entrypoint
2. THE portfolio manager application SHALL reside in `infra/agentcore-portfolio/` with a `main.py` entrypoint
3. WHEN `agentcore deploy` is run from the project directory, THE application SHALL be packaged and deployed to AgentCore Runtime
4. THE CDK stack SHALL reference the deployed Runtime ARN via environment variables (`AGENTCORE_RUNTIME_ARN` and `PORTFOLIO_AGENTCORE_RUNTIME_ARN`)
5. THE Python applications SHALL declare dependencies in `pyproject.toml` including `strands-agents`, `bedrock-agentcore`, `strands-agents-tools`, `boto3`, and `httpx`
