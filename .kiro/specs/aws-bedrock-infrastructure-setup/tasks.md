# Implementation Plan: Bedrock AgentCore Migration

## Overview

Migrate TradeWizard from legacy Bedrock Agents API to Amazon Bedrock AgentCore in 5 phases. Python (Strands SDK) for AgentCore applications, TypeScript for CDK infrastructure and Lambda handlers. Each phase builds incrementally - legacy removal first, then new Python apps, deployment, primitives integration, and finally the Portfolio Manager agent.

## Tasks

- [x] 1. Phase 1: Remove legacy infrastructure and rewrite Bedrock stack
  - [x] 1.1 Delete legacy agent deployment files and update package.json
    - Delete `infra/agents/deploy-agents.ts`
    - Delete `infra/agents/agent-definitions.ts`
    - Remove `deploy-agents:dev` and `deploy-agents:prod` npm scripts from `infra/package.json`
    - Remove `@aws-sdk/client-bedrock-agent` and `@aws-sdk/client-bedrock-agent-runtime` from `infra/package.json` dependencies
    - Add `@aws-sdk/client-bedrock-agentcore` to `infra/package.json` dependencies
    - Add `fast-check` to `infra/package.json` devDependencies (for property-based tests)
    - Add new npm scripts: `agentcore:dev`, `agentcore:deploy`, `agentcore:invoke`, `agentcore:status`, `agentcore:logs`, `agentcore:destroy`
    - Run `npm install` to update lock file
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Rewrite `infra/lib/bedrock-stack.ts` with AgentCore IAM
    - Replace `bedrock.amazonaws.com` trust principal with `bedrock-agentcore.amazonaws.com`
    - Create `agentExecutionRole` with `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, and CloudWatch Logs permissions
    - Create orchestrator Lambda role with `bedrock-agentcore:InvokeAgentRuntime` and `bedrock-agentcore:StopRuntimeSession` permissions
    - Export execution role ARN as CDK output
    - Add `AGENTCORE_RUNTIME_ARN` and `PORTFOLIO_AGENTCORE_RUNTIME_ARN` environment variables to relevant Lambdas
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 14.4_

  - [x] 1.3 Rewrite analysis orchestrator Lambda as thin dispatcher
    - Rewrite `infra/services/analysis-orchestrator/handler.ts` to use `@aws-sdk/client-bedrock-agentcore`
    - Implement `InvokeAgentRuntimeCommand` with marketId and userId payload
    - Implement `StopRuntimeSession` in finally block (always called on success or failure)
    - Parse response as TradeRecommendation JSON, use NO_TRADE fallback on parse failure
    - Store result in S3, publish AnalysisCompleted to EventBridge on success
    - Refund credit and publish AnalysisFailed on invocation failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 11.1, 11.2, 11.3_

  - [ ]* 1.4 Write property tests for session stop guarantee
    - **Property 10: Session Stop Always Called**
    - **Validates: Requirements 3.3, 8.11, 9.6, 11.1, 11.2**
    - Mock AgentCore client, simulate success/failure/timeout, verify StopRuntimeSession always called

- [x] 2. Checkpoint - Verify CDK synth and legacy removal
  - Run `cdk synth` to verify no compilation errors
  - Verify no imports from `@aws-sdk/client-bedrock-agent` or `@aws-sdk/client-bedrock-agent-runtime` remain
  - Verify synthesized template trusts `bedrock-agentcore.amazonaws.com` not `bedrock.amazonaws.com`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Phase 2: Build Python AgentCore analysis application
  - [x] 3.1 Create project structure for analysis orchestrator
    - Create `infra/agentcore/` directory with AgentCore project layout
    - Create `agentcore.json` and `aws-targets.json` configuration files
    - Create `pyproject.toml` with dependencies: `strands-agents`, `bedrock-agentcore`, `strands-agents-tools`, `boto3`, `httpx`, and dev dependency `hypothesis` (for property-based tests)
    - Create `app/TradeWizardOrchestrator/` directory structure with `agents/`, `tools/`, `fusion/`, `models/` subdirectories
    - _Requirements: 14.1, 14.5_

  - [x] 3.2 Implement data models (`app/TradeWizardOrchestrator/models/types.py`)
    - Define `AgentSignal` dataclass with all required fields (agent_name, direction, confidence, fair_probability, key_drivers, risk_factors, timestamp)
    - Define `FusedSignal`, `Thesis`, `CrossExamResult`, `ConsensusResult`, `TradeRecommendation` dataclasses
    - Implement confidence clamping (clamp values outside [0, 1])
    - Implement JSON serialization/deserialization for all models
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 3.3 Write property tests for AgentSignal serialization round-trip
    - **Property 8: AgentSignal Serialization Round-Trip**
    - **Validates: Requirements 12.2**
    - Use hypothesis to generate random valid AgentSignals, verify serialize → deserialize produces equivalent object

  - [ ]* 3.4 Write property test for confidence clamping
    - **Property 11: Confidence Clamping**
    - **Validates: Requirements 12.3**
    - Use hypothesis to generate signals with confidence outside [0, 1], verify clamped to valid range

  - [x] 3.5 Implement deterministic signal fusion (`app/TradeWizardOrchestrator/fusion/signal_fusion.py`)
    - Port `fuseSignals()` from `infra/agents/orchestrator.ts` to Python
    - Implement type weights, performance weights, confidence weighting
    - Implement signal alignment calculation (inverse of standard deviation)
    - Implement conflict map detection (divergence > 0.2)
    - Implement extreme divergence penalty (50% confidence reduction when max divergence > 0.7)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 3.6 Write property tests for signal fusion
    - **Property 1: Signal Fusion Output Bounds**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - Use hypothesis to generate random valid AgentSignals, verify all outputs in [0, 1]

  - [ ]* 3.7 Write property test for high divergence penalty
    - **Property 3: High Divergence Penalizes Confidence**
    - **Validates: Requirements 5.4**
    - Generate signals with max divergence > 0.7, verify confidence reduced by 50%

  - [x] 3.8 Implement deterministic consensus engine (`app/TradeWizardOrchestrator/fusion/consensus_engine.py`)
    - Port `calculateConsensus()` from `infra/agents/orchestrator.ts` to Python
    - Implement 60/40 thesis-signal blend formula
    - Implement disagreement index calculation and failure threshold (> 0.3)
    - Port `determineAction()` with edge threshold (5%) and liquidity risk adjustment (50% increase for high risk)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 3.9 Write property tests for consensus engine
    - **Property 2: Consensus Bounded by Inputs**
    - **Validates: Requirements 6.1**
    - Generate random valid inputs, verify consensus probability in [0, 1]

  - [ ]* 3.10 Write property test for consensus failure
    - **Property 4: Consensus Failure on High Disagreement**
    - **Validates: Requirements 6.2, 6.3**
    - Generate inputs with disagreement > 0.3, verify failed=True and determine_action returns NO_TRADE

  - [ ]* 3.11 Write property test for deterministic action
    - **Property 9: Deterministic Action from Consensus**
    - **Validates: Requirements 6.5, 6.6**
    - Call determine_action with same inputs multiple times, verify identical output; verify high liquidity increases threshold by 50%

  - [x] 3.12 Implement Polymarket tools (`app/TradeWizardOrchestrator/tools/polymarket.py`)
    - Implement `fetch_market_briefing()` using Polymarket Gamma API (market question, probability, spread, volume, liquidity)
    - Implement CLOB order book depth fetching
    - _Requirements: 4.2_

  - [x] 3.13 Implement agent definitions (`app/TradeWizardOrchestrator/agents/`)
    - Create `web_research.py` - Web Research Agent with browser tool
    - Create `market_microstructure.py` - Market Microstructure Agent
    - Create `probability_baseline.py` - Probability Baseline Agent
    - Create `risk_assessment.py` - Risk Assessment Agent
    - Create `breaking_news.py` - Breaking News Agent
    - Create `polling_intelligence.py` - Polling Intelligence Agent
    - Create `media_sentiment.py` - Media Sentiment Agent
    - Create `thesis_construction.py` - Thesis Construction Agent
    - Create `cross_examination.py` - Cross-Examination Agent
    - Create `recommendation.py` - Recommendation Generation Agent
    - Create `risk_philosophy.py` - Risk Philosophy Agents (aggressive, conservative, neutral)
    - Each agent uses `strands.Agent` with appropriate system prompt and tools
    - _Requirements: 4.3, 4.4_

  - [x] 3.14 Implement orchestrator workflow (`app/TradeWizardOrchestrator/orchestrator.py`)
    - Implement `run_analysis_workflow(market_id, user_id)` executing all 11 stages
    - Stage 1: Market ingestion via Polymarket API (no LLM)
    - Stage 2: Memory retrieval (placeholder for AgentCore Memory)
    - Stage 3: Web research using AgentCore Browser
    - Stage 4: Dynamic agent selection based on market type
    - Stage 5: Parallel intelligence agents via `asyncio.gather`
    - Stage 6: Signal fusion (deterministic)
    - Stage 7: Thesis construction (LLM)
    - Stage 8: Cross-examination (LLM)
    - Stage 9: Consensus engine (deterministic)
    - Stage 10: Risk philosophy agents (LLM, parallel)
    - Stage 11: Recommendation generation (LLM)
    - Return structured TradeRecommendation dict
    - _Requirements: 4.2, 4.5, 4.6_

  - [x] 3.15 Implement main entrypoint (`app/TradeWizardOrchestrator/main.py`)
    - Create `BedrockAgentCoreApp` instance
    - Implement `@app.entrypoint` decorated `handle_analysis(payload, context)` function
    - Extract marketId and userId from payload, call `run_analysis_workflow`
    - Add `if __name__ == "__main__": app.run()`
    - _Requirements: 4.1_

- [x] 4. Checkpoint - Verify Python application structure
  - Verify all Python files are syntactically valid
  - Run pytest on signal fusion and consensus engine unit tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Phase 3: Deploy to AgentCore and wire into CDK
  - [x] 5.1 Configure AgentCore project for deployment
    - Ensure `agentcore.json` has correct project name and agent configuration
    - Ensure `aws-targets.json` references correct AWS account and region
    - Verify `pyproject.toml` lists all required dependencies
    - _Requirements: 14.3_

  - [x] 5.2 Wire Runtime ARN into CDK compute stack
    - Add `AGENTCORE_RUNTIME_ARN` environment variable to the analysis orchestrator Lambda in `infra/lib/compute-stack.ts`
    - Reference the ARN from CDK context or SSM parameter (set after `agentcore deploy`)
    - _Requirements: 14.4_

- [x] 6. Phase 4: Integrate AgentCore primitives
  - [x] 6.1 Integrate AgentCore Browser into web research agent
    - Configure browser tool in `agents/web_research.py` using AgentCore Browser built-in
    - Remove any references to Serper or NewsData API keys for the web research agent
    - _Requirements: 4.4_

  - [x] 6.2 Add AgentCore Memory integration (placeholder)
    - Add memory retrieval stub in orchestrator Stage 2
    - Document future integration with `agentcore add memory` command
    - _Requirements: 4.2_

- [x] 7. Phase 5: Build Portfolio Manager AgentCore application
  - [x] 7.1 Create project structure for portfolio manager
    - Create `infra/agentcore-portfolio/` directory with AgentCore project layout
    - Create `pyproject.toml` with dependencies: `strands-agents`, `bedrock-agentcore`, `boto3`, `httpx`
    - Create `app/PortfolioManager/` directory structure
    - _Requirements: 14.2, 14.5_

  - [x] 7.2 Implement persona system prompts and exit evaluation prompt (`app/PortfolioManager/personas.py`)
    - Define `PERSONA_PROMPTS` dict with system prompts for all 6 personas: Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider
    - Define `PERSONA_CONFIGS` dict with numeric parameters (min_edge, max_allocation_pct, monitoring_interval, etc.)
    - Define `POSITION_GUARD_PROMPT` template for exit evaluation (regime shifts, stale markets, contradicting analysis, stop adjustment)
    - Implement `build_persona_prompt(persona_name)` function
    - Implement `build_exit_evaluation_prompt(position_context)` function
    - _Requirements: 7.2_

  - [x] 7.3 Implement read-only agent tools (`app/PortfolioManager/tools.py`)
    - Implement `get_market_data` tool (Polymarket Gamma API - current price, spread, volume)
    - Implement `get_order_book` tool (Polymarket CLOB - depth, slippage estimates)
    - Implement `read_full_analysis` tool (S3 fetch - full analysis result)
    - Implement `get_trade_history` tool (RDS query - recent trades for session)
    - Implement `get_session_performance` tool (RDS query - session P&L, win rate, capital breakdown)
    - All tools decorated with `@tool` from Strands SDK
    - _Requirements: 7.3, 7.5_

  - [x] 7.4 Implement Portfolio Manager main entrypoint (`app/PortfolioManager/main.py`)
    - Create `BedrockAgentCoreApp` instance
    - Implement `@app.entrypoint` decorated `handle_trade_decision(payload, context)` function
    - Build persona-specific Agent with read-only tools and persona system prompt
    - Build decision prompt from payload (analysis result, portfolio state, market data)
    - Parse agent response into structured PortfolioDecision JSON
    - Include `conviction` field (0.0-1.0) in output
    - _Requirements: 7.1, 7.4, 13.2_

  - [x] 7.5 Rewrite Trade Executor Lambda as thin dispatcher
    - Rewrite `infra/services/portfolio-trade-executor/handler.ts`
    - Implement safety gate sequence: kill switch check → session status check → cooldown check → acquire lock
    - Invoke Portfolio AgentCore Runtime with `InvokeAgentRuntimeCommand`
    - Implement `validateAgentDecision()`: size ≤ 50% total capital, size ≤ persona max, size ≥ $5, capital conservation invariant
    - Execute validated order on Polymarket CLOB API
    - Record decision and trade in RDS
    - Release lock and call StopRuntimeSession in finally block
    - Reject and log if validation fails (no order placed)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 10.1, 10.3, 10.4_

  - [ ]* 7.6 Write property tests for decision validation
    - **Property 5: Decision Validation Rejects Oversized Positions**
    - **Validates: Requirements 8.5, 8.6, 8.7**
    - Use fast-check to generate random decisions and session states, verify rejection when size exceeds limits

  - [ ]* 7.7 Write property test for capital conservation
    - **Property 6: Capital Conservation Invariant**
    - **Validates: Requirements 8.8**
    - Use fast-check to generate sequences of validated decisions, verify positions + pending + available = investment_amount

  - [ ]* 7.8 Write property test for kill switch totality
    - **Property 7: Kill Switch Totality**
    - **Validates: Requirements 10.1, 10.2, 10.3**
    - Mock DynamoDB with kill switch active, verify no AgentCore invocation for any event payload

  - [x] 7.9 Rewrite Position Guard Lambda as thin dispatcher
    - Rewrite `infra/services/portfolio-position-guard/handler.ts`
    - Implement safety gate sequence: kill switch check → acquire lock
    - Invoke Portfolio AgentCore Runtime with decision_type "exit_evaluation"
    - Validate exit decision before executing
    - Execute exit order on CLOB if warranted
    - Release lock and call StopRuntimeSession in finally block
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2_

  - [x] 7.10 Remove conviction-score.ts
    - Delete `infra/services/shared/conviction-score.ts`
    - Remove any imports of conviction-score from other files
    - Verify Trade Executor uses agent's conviction field for logging only
    - _Requirements: 13.1, 13.3_

  - [x] 7.11 Wire Portfolio Runtime ARN into CDK
    - Add `PORTFOLIO_AGENTCORE_RUNTIME_ARN` environment variable to trade executor and position guard Lambdas
    - _Requirements: 14.4_

  - [x] 7.12 Decide on `infra/agents/orchestrator.ts` retention
    - The deterministic logic (fuseSignals, calculateConsensus) has been ported to Python in Phase 2
    - If no other Lambda still references this file, delete it
    - If the analysis orchestrator Lambda still uses it for response parsing, keep it
    - Update imports in any remaining consumers
    - _Requirements: 1.3_

- [x] 8. Final checkpoint - Full verification
  - Run `cdk synth` to verify all stacks compile
  - Run all TypeScript tests (Vitest) for Lambda handlers
  - Run all Python tests (pytest + hypothesis) for AgentCore applications
  - Verify no references to legacy `@aws-sdk/client-bedrock-agent` remain
  - Verify `conviction-score.ts` is deleted
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update steering files and documentation
  - [x] 9.1 Update `.kiro/steering/tech.md`
    - Remove references to `@aws-sdk/client-bedrock-agent` and `@aws-sdk/client-bedrock-agent-runtime`
    - Update "AI & Agent Framework" section to reflect actual AgentCore usage with Strands SDK
    - Add `agentcore` CLI commands to Common Commands section
    - Update "Adding New Agents" pattern to reference Python agent files in `infra/agentcore/app/TradeWizardOrchestrator/agents/`
    - Change IAM trust principal documentation from `bedrock.amazonaws.com` to `bedrock-agentcore.amazonaws.com`
    - Update "Modifying the Analysis Workflow" to reference new Python orchestrator

  - [x] 9.2 Update `.kiro/steering/structure.md`
    - Add `infra/agentcore/` and `infra/agentcore-portfolio/` to the project structure
    - Update `infra/agents/` section to reflect only `orchestrator.ts` remains (or removal)
    - Add Python test file locations for AgentCore applications

## Task Dependency Graph

```json
{
  "waves": [
    { "tasks": ["1"] },
    { "tasks": ["2"] },
    { "tasks": ["3"] },
    { "tasks": ["4"] },
    { "tasks": ["5"] },
    { "tasks": ["6"] },
    { "tasks": ["7"] },
    { "tasks": ["8"] },
    { "tasks": ["9"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Python (Strands SDK) is used for AgentCore applications; TypeScript for CDK and Lambda handlers
- The `@aws/agentcore` CLI handles deployment (`agentcore deploy`) - this is run manually, not automated in CDK
- Deterministic logic (signal fusion, consensus engine) is ported from TypeScript to Python but keeps identical behavior
- The Portfolio Agent is strictly read-only - all order execution happens in the TypeScript dispatcher Lambda
- Always call `StopRuntimeSession` in finally blocks to prevent idle billing
