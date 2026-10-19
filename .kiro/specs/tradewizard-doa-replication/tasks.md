# Implementation Plan: TradeWizard DOA Replication

## Overview

This implementation plan breaks down the replication of TradeWizard's multi-agent prediction market analysis system into the DOA directory using Python and Digital Ocean's Gradient AI Platform. The implementation follows a bottom-up approach: foundational infrastructure first, then data models, then individual agents, then workflow orchestration, and finally CLI and observability.

## Tasks

- [x] 1. Set up project foundation and configuration
  - Create directory structure following DOA patterns (models/, agents/, nodes/, tools/, database/, utils/)
  - Implement configuration management in config.py with Pydantic dataclasses
  - Create .env.example with all required environment variables
  - Set up requirements.txt with core dependencies (langgraph, langchain-gradient, pydantic, httpx, supabase, opik, click, pytest, hypothesis)
  - _Requirements: 1.5, 12.2, 12.3_

- [x] 2. Implement core data models
  - [x] 2.1 Create Pydantic models in models/types.py
    - Implement MarketBriefingDocument, AgentSignal, Thesis, DebateRecord, ConsensusProbability, TradeRecommendation
    - Implement error types: IngestionError, AgentError, RecommendationError
    - Implement supporting types: EventContext, StreamlinedEventMetadata, TradeExplanation, TradeMetadata
    - _Requirements: 1.4, 2.4, 3.8_
  
  - [ ]* 2.2 Write property test for data model validation
    - **Property 3: Agent Signal Structure Validation**
    - **Validates: Requirements 3.8**
  
  - [x] 2.3 Create LangGraph state definition in models/state.py
    - Implement GraphState TypedDict with all state fields
    - Add Annotated reducers for agent_signals, agent_errors, audit_log
    - _Requirements: 1.2, 1.3_

- [x] 3. Implement Polymarket integration
  - [x] 3.1 Create Polymarket client in tools/polymarket_client.py
    - Implement PolymarketClient class with fetch_market_data and fetch_event_data methods
    - Implement transform_to_mbd function to convert API responses to MarketBriefingDocument
    - Implement error handling with structured IngestionError types
    - Add retry logic with exponential backoff for rate limits
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 13.5_
  
  - [ ]* 3.2 Write property test for market data ingestion pipeline
    - **Property 1: Market Data Ingestion Pipeline**
    - **Validates: Requirements 2.2, 2.3, 2.4**
  
  - [ ]* 3.3 Write property test for API error handling
    - **Property 2: API Error Handling**
    - **Validates: Requirements 2.5**
  
  - [ ]* 3.4 Write unit tests for Polymarket client
    - Test successful market data fetch
    - Test event data fetch
    - Test MBD transformation
    - Test rate limit handling
    - Test invalid condition ID handling
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement database persistence layer
  - [x] 5.1 Create Supabase client in database/supabase_client.py
    - Implement SupabaseClient class with connection management
    - Add connection pooling and error handling
    - Support both Supabase Cloud and local PostgreSQL
    - _Requirements: 6.1, 6.5_
  
  - [x] 5.2 Create database schema in database/migrations/001_initial_schema.sql
    - Create markets, agent_signals, recommendations, analysis_history tables
    - Add indexes for performance
    - _Requirements: 6.3_
  
  - [x] 5.3 Implement persistence layer in database/persistence.py
    - Implement save_market_data, save_agent_signals, save_recommendation methods
    - Implement get_historical_signals for memory retrieval
    - Add fallback to in-memory storage on database errors
    - _Requirements: 5.4, 6.2, 6.4, 13.3_
  
  - [ ]* 5.4 Write property test for data persistence round-trip
    - **Property 7: Data Persistence Round-Trip**
    - **Validates: Requirements 5.4**
  
  - [ ]* 5.5 Write property test for complete analysis storage
    - **Property 8: Complete Analysis Storage**
    - **Validates: Requirements 6.2**
  
  - [ ]* 5.6 Write property test for database fallback
    - **Property 26: Database Fallback**
    - **Validates: Requirements 13.3**

- [x] 6. Implement memory retrieval system
  - [x] 6.1 Create memory retrieval service in database/memory_retrieval.py
    - Implement query_agent_memory function to fetch historical signals
    - Implement memory context formatting
    - Add timeout handling for slow queries
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 6.2 Create memory retrieval node in nodes/memory_retrieval.py
    - Implement memory_retrieval_node that queries history for all agents
    - Populate memory_context in state
    - _Requirements: 5.5_
  
  - [ ]* 6.3 Write property test for memory context provision
    - **Property 6: Memory Context Provision**
    - **Validates: Requirements 5.2, 5.3**

- [x] 7. Implement agent factory and LLM integration
  - [x] 7.1 Create LLM factory in utils/llm_factory.py
    - Implement create_llm_instance function for Gradient AI
    - Support structured output with Pydantic models
    - Add Opik callback integration
    - _Requirements: 3.7, 8.1, 8.2_
  
  - [x] 7.2 Create agent factory in agents/agent_factory.py
    - Implement create_agent_node factory function
    - Add memory context formatting and injection into prompts
    - Implement timeout handling and error recovery
    - Add retry logic for invalid structured output
    - _Requirements: 3.8, 13.4_
  
  - [ ]* 7.3 Write property test for timeout handling
    - **Property 27: Timeout Handling**
    - **Validates: Requirements 13.4**

- [x] 8. Implement MVP agents
  - [x] 8.1 Create agent prompts in prompts.py
    - Write MARKET_MICROSTRUCTURE_PROMPT
    - Write PROBABILITY_BASELINE_PROMPT
    - Write RISK_ASSESSMENT_PROMPT
    - _Requirements: 3.1_
  
  - [x] 8.2 Create MVP agent modules
    - Create agents/market_microstructure.py with AGENT_NAME and SYSTEM_PROMPT
    - Create agents/probability_baseline.py with AGENT_NAME and SYSTEM_PROMPT
    - Create agents/risk_assessment.py with AGENT_NAME and SYSTEM_PROMPT
    - _Requirements: 3.1, 3.9_
  
  - [ ]* 8.3 Write unit tests for MVP agents
    - Test agent signal generation with mock LLM
    - Test memory context injection
    - Test error handling
    - _Requirements: 3.8_

- [x] 9. Implement Event Intelligence agents
  - [x] 9.1 Create Event Intelligence prompts in prompts.py
    - Write BREAKING_NEWS_PROMPT
    - Write EVENT_IMPACT_PROMPT
    - _Requirements: 3.2_
  
  - [x] 9.2 Create Event Intelligence agent modules
    - Create agents/breaking_news.py
    - Create agents/event_impact.py
    - _Requirements: 3.2, 3.9_

- [x] 10. Implement Polling & Statistical agents
  - [x] 10.1 Create Polling & Statistical prompts in prompts.py
    - Write POLLING_INTELLIGENCE_PROMPT
    - Write HISTORICAL_PATTERN_PROMPT
    - _Requirements: 3.3_
  
  - [x] 10.2 Create Polling & Statistical agent modules
    - Create agents/polling_intelligence.py
    - Create agents/historical_pattern.py
    - _Requirements: 3.3, 3.9_

- [x] 11. Implement Sentiment & Narrative agents
  - [x] 11.1 Create Sentiment & Narrative prompts in prompts.py
    - Write MEDIA_SENTIMENT_PROMPT
    - Write SOCIAL_SENTIMENT_PROMPT
    - Write NARRATIVE_VELOCITY_PROMPT
    - _Requirements: 3.4_
  
  - [x] 11.2 Create Sentiment & Narrative agent modules
    - Create agents/media_sentiment.py
    - Create agents/social_sentiment.py
    - Create agents/narrative_velocity.py
    - _Requirements: 3.4, 3.9_

- [x] 12. Implement Price Action agents
  - [x] 12.1 Create Price Action prompts in prompts.py
    - Write MOMENTUM_PROMPT
    - Write MEAN_REVERSION_PROMPT
    - _Requirements: 3.5_
  
  - [x] 12.2 Create Price Action agent modules
    - Create agents/momentum.py
    - Create agents/mean_reversion.py
    - _Requirements: 3.5, 3.9_

- [x] 13. Implement Event Scenario agents
  - [x] 13.1 Create Event Scenario prompts in prompts.py
    - Write CATALYST_PROMPT
    - Write TAIL_RISK_PROMPT
    - _Requirements: 3.6_
  
  - [x] 13.2 Create Event Scenario agent modules
    - Create agents/catalyst.py
    - Create agents/tail_risk.py
    - _Requirements: 3.6, 3.9_

- [x] 14. Checkpoint - Ensure all agent tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement workflow nodes
  - [x] 15.1 Create market ingestion node in nodes/market_ingestion.py
    - Implement market_ingestion_node that fetches market and event data
    - Transform to MBD and extract keywords
    - Handle ingestion errors gracefully
    - _Requirements: 1.2, 2.2, 2.3, 2.4_
  
  - [x] 15.2 Create keyword extraction node in nodes/keyword_extraction.py
    - Implement keyword_extraction_node that extracts keywords from MBD
    - Support event-level and market-level keywords
    - _Requirements: 1.2_
  
  - [x] 15.3 Create dynamic agent selection node in nodes/dynamic_agent_selection.py
    - Implement dynamic_agent_selection_node that determines active agents
    - Always include MVP agents, conditionally include advanced agents
    - _Requirements: 1.2, 4.2_
  
  - [x] 15.4 Create agent signal fusion node in nodes/agent_signal_fusion.py
    - Implement agent_signal_fusion_node that aggregates agent signals
    - Apply dynamic weighting based on confidence and historical accuracy
    - Calculate signal alignment and detect conflicts
    - _Requirements: 1.2, 4.3, 10.5_
  
  - [ ]* 15.5 Write property test for parallel agent dispatch
    - **Property 4: Parallel Agent Dispatch**
    - **Validates: Requirements 4.2**
  
  - [ ]* 15.6 Write property test for agent signal aggregation
    - **Property 5: Agent Signal Aggregation**
    - **Validates: Requirements 4.3**
  
  - [ ]* 15.7 Write property test for agent failure isolation
    - **Property 25: Agent Failure Isolation**
    - **Validates: Requirements 13.2**

- [x] 16. Implement debate protocol nodes
  - [x] 16.1 Create thesis construction prompts in prompts.py
    - Write THESIS_CONSTRUCTION_PROMPT
    - _Requirements: 9.1_
  
  - [x] 16.2 Create thesis construction node in nodes/thesis_construction.py
    - Implement thesis_construction_node that builds bull and bear theses
    - Aggregate supporting signals for each thesis
    - Calculate edge (|fair_probability - market_probability|)
    - _Requirements: 1.2, 9.1_
  
  - [ ]* 16.3 Write property test for thesis construction
    - **Property 12: Thesis Construction**
    - **Validates: Requirements 9.1**
  
  - [x] 16.4 Create cross-examination prompts in prompts.py
    - Write CROSS_EXAMINATION_PROMPT
    - _Requirements: 9.2_
  
  - [x] 16.5 Create cross-examination node in nodes/cross_examination.py
    - Implement cross_examination_node that tests theses
    - Execute all five test types: evidence, causality, timing, liquidity, tail-risk
    - Score each thesis based on test outcomes
    - Generate key disagreements list
    - _Requirements: 1.2, 9.2, 9.3, 9.4_
  
  - [ ]* 16.6 Write property test for thesis scoring
    - **Property 13: Thesis Scoring**
    - **Validates: Requirements 9.3**
  
  - [ ]* 16.7 Write property test for debate record completeness
    - **Property 14: Debate Record Completeness**
    - **Validates: Requirements 9.4**

- [x] 17. Implement consensus engine
  - [x] 17.1 Create consensus engine prompts in prompts.py
    - Write CONSENSUS_ENGINE_PROMPT
    - _Requirements: 10.1_
  
  - [x] 17.2 Create consensus engine node in nodes/consensus_engine.py
    - Implement consensus_engine_node that calculates consensus probability
    - Weight signals by confidence and historical accuracy
    - Incorporate debate scores into consensus
    - Calculate disagreement index from signal variance
    - Generate confidence bands based on disagreement
    - Classify probability regime (high-confidence, moderate-confidence, high-uncertainty)
    - _Requirements: 1.2, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_
  
  - [ ]* 17.3 Write property test for consensus probability generation
    - **Property 16: Consensus Probability Generation**
    - **Validates: Requirements 10.1**
  
  - [ ]* 17.4 Write property test for disagreement index calculation
    - **Property 17: Disagreement Index Calculation**
    - **Validates: Requirements 10.2**
  
  - [ ]* 17.5 Write property test for confidence band provision
    - **Property 18: Confidence Band Provision**
    - **Validates: Requirements 10.3**
  
  - [ ]* 17.6 Write property test for regime classification
    - **Property 19: Regime Classification**
    - **Validates: Requirements 10.4**
  
  - [ ]* 17.7 Write property test for signal weighting
    - **Property 20: Signal Weighting**
    - **Validates: Requirements 10.5**
  
  - [ ]* 17.8 Write property test for debate influence on consensus
    - **Property 15: Debate Influence on Consensus**
    - **Validates: Requirements 9.5**

- [x] 18. Implement recommendation generation
  - [x] 18.1 Create recommendation generation prompts in prompts.py
    - Write RECOMMENDATION_GENERATION_PROMPT
    - _Requirements: 11.1_
  
  - [x] 18.2 Create recommendation generation node in nodes/recommendation_generation.py
    - Implement recommendation_generation_node that creates trade recommendations
    - Determine action (LONG_YES, LONG_NO, NO_TRADE) based on edge and consensus
    - Calculate entry zone, target zone, expected value, win probability
    - Assess liquidity risk from market data
    - Generate explanation with summary, core thesis, catalysts, failure scenarios
    - Include metadata with consensus probability, market probability, edge, confidence bands
    - _Requirements: 1.2, 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [ ]* 18.3 Write property test for recommendation action validity
    - **Property 21: Recommendation Action Validity**
    - **Validates: Requirements 11.1**
  
  - [ ]* 18.4 Write property test for recommendation completeness
    - **Property 22: Recommendation Completeness**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5**

- [x] 19. Checkpoint - Ensure all workflow node tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Implement main workflow orchestration
  - [x] 20.1 Create workflow graph in main.py
    - Implement build_market_analysis_graph function
    - Add all nodes to StateGraph
    - Define edges: START → market_ingestion → memory_retrieval → keyword_extraction → dynamic_agent_selection
    - Add conditional edges for parallel agent dispatch using Send API
    - Add edges from all agents to signal_fusion
    - Add sequential edges: signal_fusion → thesis_construction → cross_examination → consensus_engine → recommendation_generation → END
    - Compile graph with checkpointer (MemorySaver or PostgreSQL)
    - _Requirements: 1.1, 1.2, 4.1, 4.4, 4.5_
  
  - [x] 20.2 Implement analyze_market function in main.py
    - Create workflow graph
    - Initialize Opik callback handler
    - Invoke graph with condition_id and config
    - Flush Opik traces after completion
    - Return AnalysisResult with recommendation and agent signals
    - _Requirements: 1.2, 8.2, 8.3_
  
  - [ ]* 20.3 Write integration test for full workflow execution
    - Test end-to-end market analysis with mock external services
    - Verify all workflow stages execute in correct order
    - Verify final recommendation is generated
    - _Requirements: 1.2, 4.5_

- [ ] 21. Implement CLI interface
  - [ ] 21.1 Create CLI commands in cli.py
    - Implement analyze command that takes condition_id argument
    - Implement history command that queries past analyses
    - Implement monitor command for continuous monitoring
    - Add progress indicators during analysis
    - Format output as human-readable text with structured data
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ]* 21.2 Write property test for CLI workflow execution
    - **Property 9: CLI Workflow Execution**
    - **Validates: Requirements 7.2**
  
  - [ ]* 21.3 Write property test for output formatting
    - **Property 10: Output Formatting**
    - **Validates: Requirements 7.6**
  
  - [ ]* 21.4 Write unit tests for CLI commands
    - Test analyze command with valid condition ID
    - Test analyze command with invalid condition ID
    - Test history command
    - Test monitor command initialization
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 22. Implement observability integration
  - [x] 22.1 Create Opik integration in utils/opik_integration.py
    - Implement Opik callback handler initialization
    - Add trace flushing logic
    - Implement cost tracking extraction from traces
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  
  - [ ]* 22.2 Write property test for observability completeness
    - **Property 11: Observability Completeness**
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [x] 23. Implement configuration validation
  - [x] 23.1 Add configuration validation in config.py
    - Validate required fields on startup
    - Provide clear error messages for missing configuration
    - Support multiple LLM provider configurations
    - _Requirements: 12.1, 12.2, 12.4, 12.5_
  
  - [ ]* 23.2 Write property test for configuration validation
    - **Property 23: Configuration Validation**
    - **Validates: Requirements 12.4**

- [x] 24. Implement error handling utilities
  - [x] 24.1 Create Result type in utils/result.py
    - Implement Ok and Err classes for functional error handling
    - _Requirements: 13.1_
  
  - [x] 24.2 Create audit logger in utils/audit_logger.py
    - Implement structured logging for workflow stages
    - Add audit log entry creation
    - _Requirements: 1.2_
  
  - [ ]* 24.3 Write property test for structured error handling
    - **Property 24: Structured Error Handling**
    - **Validates: Requirements 13.1**
  
  - [ ]* 24.4 Write property test for exponential backoff
    - **Property 28: Exponential Backoff**
    - **Validates: Requirements 13.5**

- [x] 25. Create documentation
  - [x] 25.1 Write README.md
    - Add project overview and purpose
    - Add setup instructions (dependencies, environment variables, database setup)
    - Add usage examples (CLI commands, expected outputs)
    - Add architecture diagram (workflow graph structure)
    - Document all agent types and their analysis focus
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  
  - [x] 25.2 Add inline code documentation
    - Add docstrings to all public functions
    - Add type hints to all function signatures
    - Add module-level docstrings
    - _Requirements: 15.5_

- [x] 26. Final checkpoint - Ensure all tests pass
  - Run full test suite (unit, integration, property tests)
  - Verify all property tests pass with 100+ iterations
  - Verify CLI commands work end-to-end
  - Verify database persistence and retrieval
  - Verify Opik tracing captures all LLM calls
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties with randomized inputs
- Unit tests validate specific examples and edge cases
- The implementation follows a bottom-up approach: infrastructure → data models → agents → workflow → CLI → observability
