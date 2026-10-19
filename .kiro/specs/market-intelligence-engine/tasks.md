# Implementation Plan

- [x] 1. Set up project structure and core infrastructure
  - Initialize TypeScript Node.js project with proper configuration
  - Set up ESLint, Prettier, and TypeScript strict mode
  - Install core dependencies: @langchain/langgraph, @langchain/core, @langchain/openai, @langchain/anthropic, @langchain/google-genai, Polymarket SDK, opik (for observability), fast-check, zod
  - Create directory structure: src/{nodes, models, utils, config, schemas}
  - Set up environment configuration for API keys (Polymarket, OpenAI, Anthropic, Google, Opik)
  - Configure Opik for tracing (run `npx opik-ts configure` or set OPIK_API_KEY)
  - _Requirements: All - foundational setup_

- [x] 2. Implement core data models and LangGraph state
  - Define TypeScript interfaces for MarketBriefingDocument, AgentSignal, Thesis, DebateRecord, ConsensusProbability, TradeRecommendation
  - Define LangGraph GraphState using Annotation API with all state fields and reducers
  - Implement Result<T, E> type for error handling
  - Create error type definitions (IngestionError, AgentError, RecommendationError)
  - Define EngineConfig interface with validation
  - Create Zod schemas for structured LLM outputs (AgentSignalSchema, ThesisSchema, etc.)
  - _Requirements: 2.1, 2.4, 11.1, 11.2_

- [x] 2.1 Write property test for data model validation
  - **Property 2: Market Briefing Document validity**
  - **Validates: Requirements 2.1, 2.3, 2.4**

- [x] 3. Build Polymarket API integration layer
  - Implement Polymarket API client wrapper with Gamma API and CLOB API
  - Create API client with rate limiting and retry logic
  - Implement exponential backoff with jitter for failed requests
  - Add circuit breaker pattern for API failures
  - Implement health check endpoint
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.1_

- [x] 3.1 Write unit tests for API integration
  - Test successful market data fetch with mocked Polymarket APIs
  - Test invalid market ID handling
  - Test rate limit detection and backoff behavior
  - Test API unavailability scenarios
  - _Requirements: 1.1, 1.3, 1.5_

- [x] 3.2 Write property test for market data retrieval
  - **Property 1: Market data retrieval completeness**
  - **Validates: Requirements 1.2**

- [x] 4. Implement market ingestion LangGraph node
  - Create marketIngestionNode function that reads conditionId from state
  - Fetch and transform market data into MBD using Polymarket client
  - Implement volatility regime calculation from historical prices
  - Add ambiguity detection for resolution criteria
  - Write MBD to graph state or ingestionError on failure
  - Add audit log entry to state
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 11.2_

- [x] 4.1 Write unit tests for market ingestion node
  - Test node with mocked Polymarket APIs
  - Test MBD creation from sample market data
  - Test ambiguous resolution criteria flagging
  - Test volatility regime classification
  - Test state updates (MBD written to state)
  - _Requirements: 2.2, 2.3, 11.2_

- [x] 5. Build intelligence agent nodes with LangChain LLM integration
  - Create agent node factory function that accepts LLM instance and system prompt
  - Create LLM configuration factory that supports both single-provider and multi-provider modes
  - Implement single-provider mode: use one LLM for all agents (budget-friendly)
  - Implement multi-provider mode: use different LLMs per agent (optimal quality)
  - Implement Market Microstructure Agent node (default: ChatOpenAI with GPT-4-turbo)
  - Implement Probability Baseline Agent node (default: ChatGoogleGenerativeAI with Gemini-1.5-flash)
  - Implement Risk Assessment Agent node (default: ChatAnthropic with Claude-3-sonnet)
  - Use withStructuredOutput() with Zod schemas for type-safe agent signal generation
  - Each agent reads MBD from state and writes AgentSignal to state
  - Add error handling that writes to agentErrors in state
  - Add audit logging to state for each agent execution
  - _Requirements: 3.1, 3.2, 11.1, 11.3, 11.9, 11.10_

- [x] 5.1 Write unit tests for individual agent nodes
  - Test each agent node with sample MBD in state
  - Verify agent signal structure and content
  - Test agent error handling and state updates
  - Test with single-provider mode (one LLM for all agents)
  - Test with multi-provider mode (different LLMs per agent)
  - Test structured output parsing
  - _Requirements: 3.2, 11.3, 11.9, 11.10_

- [x] 5.2 Write property test for agent signal structure
  - **Property 4: Agent signal structure validity**
  - **Validates: Requirements 3.2, 3.4**

- [x] 6. Build thesis construction LangGraph node
  - Create thesisConstructionNode function
  - Read agentSignals from state and check minimum threshold
  - Use LLM instance (supports both single-provider and multi-provider modes) with withStructuredOutput(ThesisSchema) for bull thesis generation
  - Use LLM instance (supports both single-provider and multi-provider modes) with withStructuredOutput(ThesisSchema) for bear thesis generation
  - In single-provider mode: use the configured LLM for thesis generation
  - In multi-provider mode: use default LLM (ChatOpenAI with GPT-4-turbo) for thesis generation
  - Implement weighted fair probability calculation from agent signals
  - Calculate market edge (fairProbability - marketProbability)
  - Detect fairly priced markets (edge < 2%)
  - Write bullThesis and bearThesis to state
  - Add audit log entry
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 11.3, 11.9, 11.10_

- [x] 6.1 Write property test for thesis generation
  - **Property 5: Thesis generation completeness**
  - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 6.2 Write unit tests for thesis construction node
  - Test thesis generation from sample agent signals in state
  - Test fairly priced market detection (edge < 2%)
  - Test edge calculation accuracy
  - Test state updates (theses written to state)
  - Test with single-provider mode (one LLM for thesis generation)
  - Test with multi-provider mode (default LLM for thesis generation)
  - _Requirements: 4.4, 11.2, 11.9, 11.10_

- [x] 7. Implement cross-examination LangGraph node
  - Create crossExaminationNode function
  - Read bullThesis and bearThesis from state
  - Implement evidence test using LLM (verify factual claims)
  - Implement causality test using LLM (correlation vs causation)
  - Implement timing test (catalyst timeline validation)
  - Implement liquidity test (execution feasibility)
  - Implement tail risk test (low-probability scenarios)
  - Generate scored DebateRecord
  - Write debateRecord to state
  - Add audit log entry
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.3_

- [x] 7.1 Write property test for cross-examination execution
  - **Property 6: Cross-examination execution**
  - **Validates: Requirements 5.1, 5.4**

- [x] 7.2 Write property test for factual claim verification
  - **Property 7: Factual claim verification**
  - **Validates: Requirements 5.2**

- [x] 7.3 Write property test for causality testing
  - **Property 8: Causality testing**
  - **Validates: Requirements 5.3**

- [x] 7.4 Write unit tests for cross-examination node
  - Test each examination test type with sample theses
  - Test debate scoring logic
  - Test argument survival determination
  - Test state updates
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.2_

- [x] 8. Build consensus engine LangGraph node
  - Create consensusEngineNode function
  - Read debateRecord and agentSignals from state
  - Calculate weighted consensus probability from debate scores
  - Compute standard deviation across agent signals
  - Calculate confidence bands based on disagreement
  - Classify probability regime (high-confidence, moderate, high-uncertainty)
  - Detect efficiently priced markets (edge < 3%)
  - Handle consensus failure for high disagreement (> 0.30)
  - Write consensus to state or consensusError on failure
  - Add audit log entry
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 10.4, 11.2_

- [x] 8.1 Write property test for consensus probability structure
  - **Property 9: Consensus probability structure**
  - **Validates: Requirements 6.1, 6.3**

- [x] 8.2 Write unit tests for consensus engine node
  - Test consensus calculation with sample debate outcomes
  - Test high disagreement confidence band widening
  - Test efficient market classification (edge < 3%)
  - Test consensus failure handling
  - Test state updates
  - _Requirements: 6.2, 6.4, 10.4, 11.2_

- [x] 9. Implement recommendation generation LangGraph node
  - Create recommendationGenerationNode function
  - Read consensus, bullThesis, bearThesis, and mbd from state
  - Calculate expected value from consensus probability
  - Implement edge threshold check (minimum 5%)
  - Implement negative EV rejection logic
  - Determine trade direction (LONG_YES, LONG_NO, NO_TRADE)
  - Calculate entry and target zones
  - Flag liquidity risk for low liquidity scores (< 5.0)
  - Generate natural language explanation using LLM
  - Include catalysts, failure scenarios, and uncertainty notes in explanation
  - Write recommendation to state
  - Add audit log entry
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 11.3_

- [x] 9.1 Write property test for recommendation structure
  - **Property 10: Trade recommendation structure validity**
  - **Validates: Requirements 7.2**

- [x] 9.2 Write property test for negative EV rejection
  - **Property 11: Negative expected value rejection**
  - **Validates: Requirements 7.3**

- [x] 9.3 Write property test for explanation completeness
  - **Property 12: Explanation completeness**
  - **Validates: Requirements 7.5, 8.1, 8.2, 8.3, 8.4**

- [x] 9.4 Write unit tests for recommendation generator node
  - Test edge threshold boundary (5%)
  - Test liquidity risk flagging (< 5.0)
  - Test NO_TRADE for negative EV
  - Test explanation generation with various scenarios
  - Test state updates
  - _Requirements: 7.1, 7.4, 7.3, 11.2_

- [x] 10. Build LangGraph workflow and compile graph with Opik tracing
  - Create StateGraph instance with GraphState
  - Add all nodes to graph (ingestion, 3 agents, thesis, cross-exam, consensus, recommendation)
  - Define entry edge from START to market_ingestion
  - Add conditional edge from ingestion (error handling)
  - Add parallel edges from ingestion to all 3 agent nodes
  - Add edges from all agents to thesis_construction
  - Add sequential edges through debate protocol (thesis → cross-exam → consensus → recommendation)
  - Add edge from recommendation to END
  - Compile graph with MemorySaver checkpointer for audit trail
  - Initialize OpikTracer with project name and tags
  - Wrap compiled graph with track_langgraph() for automatic tracing
  - Create analyzeMarket() entry point function with thread_id support
  - _Requirements: 11.1, 11.2, 11.4, 11.6, 11.7_

- [x] 10.1 Write property test for LangGraph state flow
  - **Property 16: LangGraph state flow**
  - **Validates: Requirements 11.1, 11.2, 11.4**

- [x] 10.2 Write property test for parallel agent execution
  - **Property 17: LangGraph parallel agent execution**
  - **Validates: Requirements 11.2**

- [x] 10.3 Write property test for agent failure isolation
  - **Property 15: Agent failure isolation**
  - **Validates: Requirements 3.3, 10.2**

- [x] 10.4 Write integration tests for full LangGraph workflow with Opik
  - Test end-to-end flow with mocked Polymarket APIs
  - Test workflow with various market scenarios
  - Test error propagation through graph
  - Test graceful degradation (agent failures)
  - Test with different LLM provider configurations
  - Test state checkpointing and audit trail
  - Verify Opik traces are created for each execution
  - Verify graph visualization appears in Opik
  - Verify cost tracking is accurate
  - _Requirements: 10.3, 10.5, 11.2, 11.4, 11.6, 11.7, 11.8_

- [x] 11. Add configuration and environment management
  - Implement EngineConfig loading from environment variables
  - Add configuration validation using Zod
  - Create default configuration values
  - Support single-provider LLM mode (one LLM for all agents via singleProvider field)
  - Support multi-provider LLM mode (different LLMs per agent, default for optimal quality)
  - Support LLM provider configuration (OpenAI, Anthropic, Google API keys and models)
  - Support LangGraph configuration (checkpointer type, recursion limit)
  - Support Opik configuration (API key, project name, workspace, base URL for self-hosted)
  - Add configuration documentation with examples for both LLM modes
  - Implement configuration override mechanism
  - _Requirements: All, 11.5, 11.6, 11.9, 11.10_

- [x] 12. Implement audit logging with Opik and LangGraph checkpointing
  - Configure LangGraph checkpointer (MemorySaver for dev, SqliteSaver for production)
  - Implement audit trail retrieval from checkpointer by thread_id (market ID)
  - Verify Opik automatically logs all LLM calls via LangChain integration
  - Verify Opik logs graph structure and execution flow
  - Add structured logging for all graph executions
  - Implement log retention and rotation
  - Create utility functions to inspect graph state at any checkpoint
  - Create utility functions to query Opik traces by market ID (thread_id)
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 11.5, 11.6, 11.7, 11.8_

- [x] 12.1 Write property test for audit trail completeness
  - **Property 13: Audit trail completeness**
  - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 12.2 Write property test for error logging
  - **Property 14: Error logging**
  - **Validates: Requirements 9.4**

- [x] 12.3 Write unit tests for audit logging and Opik integration
  - Test checkpoint creation for each graph step
  - Test audit trail retrieval by market ID
  - Test error logging with context
  - Test Opik trace creation and retrieval
  - Test cost tracking via Opik
  - Test graph visualization extraction
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 11.6, 11.7, 11.8_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Create CLI interface for testing with Opik integration
  - Build simple CLI to analyze markets by condition ID
  - Display formatted trade recommendations
  - Show debug information and graph state
  - Add option to visualize LangGraph workflow (using LangGraph Studio or mermaid)
  - Add option to open Opik trace in browser for detailed inspection
  - Add command-line options for configuration overrides
  - Add option to select LLM mode (single-provider vs multi-provider)
  - Add option to select specific LLM provider for single-provider mode
  - Display LLM cost tracking from Opik
  - Add option to replay from checkpoint
  - Add option to query historical traces from Opik by market ID
  - _Requirements: All, 11.5, 11.6, 11.8, 11.9, 11.10_

- [x] 14.1 Write end-to-end tests using CLI
  - Test CLI with real Polymarket API calls (integration test)
  - Verify output formatting
  - Test error handling in CLI
  - Test CLI with single-provider mode
  - Test CLI with multi-provider mode
  - Test graph visualization output
  - _Requirements: All, 11.9, 11.10_

- [x] 15. Documentation and deployment preparation
  - Write README with setup instructions
  - Document LangGraph workflow architecture with diagram
  - Document GraphState schema and data flow
  - Create example usage code
  - Document configuration options (including single-provider vs multi-provider LLM modes, LangGraph settings, and Opik configuration)
  - Document single-provider mode for budget-conscious deployments
  - Document multi-provider mode for optimal quality
  - Add deployment guide for Node.js environments
  - Document LLM provider setup for OpenAI, Anthropic, and Gemini
  - Add troubleshooting guide for common LangGraph issues
  - Document how to use LangGraph Studio for debugging
  - Document how to use Opik for observability and debugging
  - Add guide for setting up Opik (cloud vs self-hosted)
  - Document how to query and analyze traces in Opik
  - _Requirements: All, 11.9, 11.10_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
