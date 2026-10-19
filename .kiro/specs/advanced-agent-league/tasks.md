# Implementation Plan: Advanced Agent League

## Overview

This implementation plan expands the Market Intelligence Engine with 10+ specialized agents organized into 6 agent groups. The plan follows an incremental approach: build infrastructure first, then add agent groups one at a time, ensuring each group integrates properly before moving to the next.

## Tasks

- [x] 1. Set up external data integration infrastructure
  - Create data integration layer with caching and rate limiting
  - Implement NewsAPI client for breaking news data
  - Implement polling data aggregator (FiveThirtyEight, RealClearPolitics APIs)
  - Implement social media API clients (Twitter/X, Reddit)
  - Add Redis or in-memory caching with configurable TTL
  - Implement rate limiting using token bucket algorithm
  - Add data freshness validation and staleness flagging
  - Create fallback logic to use cached data when sources unavailable
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 1.1 Write unit tests for data integration layer
  - Test news API client with mocked responses
  - Test polling API client with sample data
  - Test social API client with mock data
  - Test caching behavior (hits, misses, TTL expiration)
  - Test rate limiting logic
  - Test data validation and error handling
  - Test fallback to cached data
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 1.2 Write property test for data caching consistency
  - **Property 2: External data caching consistency**
  - **Validates: Requirements 7.2, 13.2**

- [x] 2. Extend graph state and configuration for advanced agents
  - Extend GraphState with activeAgents, externalData, fusedSignal, riskPhilosophySignals fields
  - Add AdvancedEngineConfig interface with agent group toggles
  - Add external data source configuration (API keys, TTLs, providers)
  - Add signal fusion configuration (weights, thresholds, bonuses)
  - Add cost optimization configuration
  - Add performance tracking configuration
  - Create Zod schemas for new configuration sections
  - Implement configuration validation
  - _Requirements: 11.2, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 2.1 Write unit tests for extended configuration
  - Test configuration loading and validation
  - Test agent group enable/disable logic
  - Test external data source configuration
  - Test invalid configuration handling
  - Test configuration defaults
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 2.2 Write property test for configuration validation
  - **Property 16: Configuration validation**
  - **Validates: Requirements 12.5**

- [x] 3. Implement dynamic agent selection node
  - Create dynamicAgentSelectionNode LangGraph node
  - Implement market type-based agent selection logic
  - Add data availability checking for each agent
  - Implement cost optimization agent filtering
  - Add configuration-based agent filtering
  - Write selected agents to graph state
  - Add audit logging for agent selection decisions
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 13.3_

- [x] 3.1 Write unit tests for dynamic agent selection
  - Test agent selection for each market type
  - Test data availability filtering
  - Test configuration-based filtering
  - Test cost optimization filtering
  - Test audit logging
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 3.2 Write property test for agent selection completeness
  - **Property 1: Dynamic agent selection completeness**
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**


- [x] 4. Build Event Intelligence Agents
  - [x] 4.1 Implement Breaking News Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for breaking news analysis
    - Implement BreakingNewsSignal schema with Zod
    - Fetch news data from data integration layer
    - Analyze news relevance and probability impact
    - Flag regime-changing events
    - Write signal to graph state
    - _Requirements: 1.1, 1.2_

  - [x] 4.2 Implement Event Impact Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for event impact modeling
    - Implement EventImpactSignal schema with Zod
    - Fetch historical event data
    - Generate scenario trees for upcoming events
    - Identify historical analogs
    - Write signal to graph state
    - _Requirements: 1.3, 1.4_

  - [x] 4.3 Write unit tests for Event Intelligence Agents
    - Test Breaking News Agent with sample news data
    - Test Event Impact Agent with historical data
    - Test signal structure and content
    - Test error handling
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 4.4 Write property test for event intelligence relevance filtering
    - **Property 12: Event intelligence relevance filtering**
    - **Validates: Requirements 1.2**

- [x] 5. Build Polling & Statistical Agents
  - [x] 5.1 Implement Polling Intelligence Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for polling analysis
    - Implement PollingIntelligenceSignal schema with Zod
    - Fetch polling data from data integration layer
    - Apply pollster bias adjustments
    - Calculate weighted aggregated probability
    - Detect momentum shifts
    - Write signal to graph state
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.2 Implement Historical Pattern Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for historical pattern analysis
    - Implement HistoricalPatternSignal schema with Zod
    - Identify analogous past events
    - Calculate pattern similarity scores
    - Assess pattern applicability
    - Write signal to graph state
    - _Requirements: 2.4, 2.5_

  - [x] 5.3 Write unit tests for Polling & Statistical Agents
    - Test Polling Intelligence Agent with sample polling data
    - Test bias adjustment logic
    - Test Historical Pattern Agent with historical data
    - Test signal structure and content
    - Test error handling when polling data unavailable
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 5.4 Write property test for polling bias adjustment
    - **Property 11: Polling agent bias adjustment**
    - **Validates: Requirements 2.2**

- [x] 6. Build Sentiment & Narrative Agents
  - [x] 6.1 Implement Media Sentiment Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for media sentiment analysis
    - Implement MediaSentimentSignal schema with Zod
    - Fetch news data from data integration layer
    - Analyze sentiment and framing
    - Identify dominant narratives
    - Calculate coverage velocity
    - Write signal to graph state
    - _Requirements: 3.1, 3.2_

  - [x] 6.2 Implement Social Sentiment Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for social sentiment analysis
    - Implement SocialSentimentSignal schema with Zod
    - Fetch social data from data integration layer
    - Analyze sentiment across platforms
    - Detect viral narratives
    - Assess crowd psychology
    - Write signal to graph state
    - _Requirements: 3.3, 3.4_

  - [x] 6.3 Implement Narrative Velocity Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for narrative velocity analysis
    - Implement NarrativeVelocitySignal schema with Zod
    - Fetch media and social data
    - Measure narrative spread rates
    - Predict next cycle dominance
    - Detect emerging narratives
    - Write signal to graph state
    - _Requirements: 3.5, 3.6_

  - [x] 6.4 Write unit tests for Sentiment & Narrative Agents
    - Test Media Sentiment Agent with sample news data
    - Test Social Sentiment Agent with mock social data
    - Test Narrative Velocity Agent with time-series data
    - Test signal structure and content
    - Test error handling when sentiment data unavailable
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.5 Write property test for sentiment platform aggregation
    - **Property 14: Sentiment agent platform aggregation**
    - **Validates: Requirements 3.4**

- [x] 7. Build Price Action & Timing Agents
  - [x] 7.1 Implement Momentum Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for momentum analysis
    - Implement MomentumSignal schema with Zod
    - Fetch price history from MBD
    - Calculate momentum indicators
    - Identify breakout patterns
    - Determine timing windows
    - Write signal to graph state
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Implement Mean Reversion Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for mean reversion analysis
    - Implement MeanReversionSignal schema with Zod
    - Fetch price history from MBD
    - Calculate overextension indicators
    - Identify fade opportunities
    - Determine reversion targets
    - Write signal to graph state
    - _Requirements: 4.3, 4.4_

  - [x] 7.3 Write unit tests for Price Action Agents
    - Test Momentum Agent with sample price history
    - Test Mean Reversion Agent with overextended prices
    - Test signal structure and content
    - Test skipping when insufficient history
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.4 Write property test for price action activation condition
    - **Property 13: Price action agent activation condition**
    - **Validates: Requirements 4.5**

- [x] 8. Build Event Scenario Agents
  - [x] 8.1 Implement Catalyst Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for catalyst analysis
    - Implement CatalystSignal schema with Zod
    - Identify upcoming catalysts from MBD and external data
    - Model pre-event and post-event strategies
    - Calculate optimal entry timing
    - Write signal to graph state
    - _Requirements: 5.1, 5.2_

  - [x] 8.2 Implement Shock & Tail-Risk Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for tail-risk analysis
    - Implement TailRiskSignal schema with Zod
    - Identify underpriced tail scenarios
    - Calculate asymmetric payoff structures
    - Identify convex opportunities
    - Write signal to graph state
    - _Requirements: 5.3, 5.4_

  - [x] 8.3 Write unit tests for Event Scenario Agents
    - Test Catalyst Agent with upcoming events
    - Test Tail-Risk Agent with extreme scenarios
    - Test signal structure and content
    - Test error handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 9. Implement Agent Signal Fusion Node
  - Create agentSignalFusionNode LangGraph node
  - Implement dynamic weight calculation based on agent type and context
  - Implement signal conflict detection
  - Implement signal alignment calculation
  - Calculate fusion confidence with alignment bonus and quality penalty
  - Create FusedSignal schema with Zod
  - Write fused signal to graph state
  - Add audit logging for fusion process
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9.1 Write unit tests for signal fusion
  - Test weight calculation with various agent combinations
  - Test conflict detection with divergent signals
  - Test alignment bonus calculation
  - Test data quality penalty
  - Test fusion confidence calculation
  - Test state updates
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9.2 Write property test for fusion weight validity
  - **Property 3: Agent signal fusion weight validity**
  - **Validates: Requirements 8.2**

- [x] 9.3 Write property test for signal conflict detection
  - **Property 4: Signal conflict detection**
  - **Validates: Requirements 8.3**

- [x] 10. Build Risk Philosophy Agents
  - [x] 10.1 Implement Aggressive Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for aggressive risk philosophy
    - Implement AggressiveSignal schema with Zod
    - Calculate Kelly criterion position sizing
    - Advocate for concentrated exposure
    - Write signal to graph state
    - _Requirements: 6.1, 6.2_

  - [x] 10.2 Implement Conservative Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for conservative risk philosophy
    - Implement ConservativeSignal schema with Zod
    - Recommend hedging strategies
    - Calculate conservative position sizing
    - Write signal to graph state
    - _Requirements: 6.3, 6.4_

  - [x] 10.3 Implement Neutral Agent node
    - Create agent node using existing agent factory pattern
    - Write system prompt for neutral risk philosophy
    - Implement NeutralSignal schema with Zod
    - Identify spread trade opportunities
    - Recommend market-neutral structures
    - Write signal to graph state
    - _Requirements: 6.5, 6.6_

  - [x] 10.4 Write unit tests for Risk Philosophy Agents
    - Test Aggressive Agent position sizing
    - Test Conservative Agent hedging strategies
    - Test Neutral Agent spread identification
    - Test signal structure and content
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 10.5 Write property test for risk philosophy completeness
    - **Property 5: Risk philosophy signal completeness**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**

- [x] 11. Update thesis construction to use fused signals
  - Modify thesisConstructionNode to read fusedSignal from state
  - Use fused signal instead of raw agent signals for thesis generation
  - Maintain backward compatibility (fall back to raw signals if no fusion)
  - Update audit logging
  - _Requirements: 8.5, 11.2_

- [x] 11.1 Write unit tests for updated thesis construction
  - Test thesis generation with fused signals
  - Test backward compatibility with raw signals
  - Test state updates
  - _Requirements: 8.5, 11.2_

- [x] 12. Update recommendation generation to include risk philosophy
  - Modify recommendationGenerationNode to read riskPhilosophySignals from state
  - Include risk philosophy perspectives in recommendation explanation
  - Add position sizing guidance from risk philosophy agents
  - Maintain backward compatibility (work without risk philosophy signals)
  - Update audit logging
  - _Requirements: 6.7, 11.2_

- [x] 12.1 Write unit tests for updated recommendation generation
  - Test recommendation with risk philosophy signals
  - Test backward compatibility without risk philosophy
  - Test explanation includes risk perspectives
  - Test state updates
  - _Requirements: 6.7, 11.2_

- [x] 13. Implement agent performance tracking
  - Create AgentPerformanceMetrics schema
  - Implement performance tracking on agent execution
  - Implement accuracy calculation on market resolution
  - Store performance metrics in graph state
  - Create performance dashboard query functions
  - Add performance-based weight adjustments to signal fusion
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 13.1 Write unit tests for performance tracking
  - Test performance metric calculation
  - Test accuracy evaluation on resolution
  - Test performance-based weight adjustments
  - Test performance dashboard queries
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 13.2 Write property test for performance tracking accuracy
  - **Property 7: Agent performance tracking accuracy**
  - **Validates: Requirements 10.2, 10.3**

- [x] 14. Update LangGraph workflow to integrate advanced agents
  - Add dynamicAgentSelectionNode to workflow after market ingestion
  - Add all new agent nodes to workflow as parallel nodes
  - Add agentSignalFusionNode after all agents complete
  - Add risk philosophy agent nodes after consensus engine
  - Update conditional edges for agent selection
  - Ensure backward compatibility (workflow works with MVP agents only)
  - Update Opik tracing to include new nodes
  - _Requirements: 11.1, 11.2, 11.4, 11.5_

- [x] 14.1 Write property test for backward compatibility
  - **Property 6: Backward compatibility with MVP agents**
  - **Validates: Requirements 11.1, 11.4**

- [x] 14.2 Write property test for agent signal schema consistency
  - **Property 15: Agent signal schema consistency**
  - **Validates: Requirements 11.3**

- [x] 15. Implement cost optimization
  - Add cost estimation before agent activation
  - Implement agent skipping when cost threshold exceeded
  - Prioritize MVP and high-value agents
  - Add cost tracking via Opik for all agents
  - Log cost optimization decisions
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 15.1 Write unit tests for cost optimization
  - Test cost estimation accuracy
  - Test agent skipping logic
  - Test agent prioritization
  - Test cost tracking integration
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 15.2 Write property test for cost threshold enforcement
  - **Property 8: Cost optimization threshold enforcement**
  - **Validates: Requirements 13.3, 13.4**

- [x] 16. Implement comprehensive error handling
  - Add error handling for external data unavailability
  - Add error handling for agent timeouts
  - Add error handling for agent execution failures
  - Add error handling for signal fusion failures
  - Add error handling for configuration errors
  - Ensure graceful degradation throughout
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 16.1 Write unit tests for error handling
  - Test external data unavailability handling
  - Test agent timeout handling
  - Test agent execution failure handling
  - Test signal fusion error handling
  - Test configuration error handling
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 16.2 Write property test for data unavailability graceful degradation
  - **Property 9: External data unavailability graceful degradation**
  - **Validates: Requirements 1.5, 2.6, 3.7, 7.4, 14.2**

- [x] 16.3 Write property test for agent timeout isolation
  - **Property 10: Agent timeout isolation**
  - **Validates: Requirements 14.3**

- [x] 17. Add comprehensive observability and audit logging
  - Add Opik tracing for all new nodes
  - Log agent selection decisions
  - Log external data fetching with freshness
  - Log signal fusion process with weights and conflicts
  - Log cost optimization decisions
  - Log performance tracking updates
  - Ensure complete audit trail for advanced agent executions
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 17.1 Write unit tests for observability
  - Test Opik trace creation for new nodes
  - Test audit log completeness
  - Test cost tracking accuracy
  - Test performance metric logging
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 17.2 Write property test for audit trail completeness
  - **Property 17: Audit trail completeness for advanced agents**
  - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**

- [x] 18. Write integration tests for full advanced agent workflow
  - Test end-to-end with all agent groups enabled
  - Test with selective agent groups (budget configuration)
  - Test with MVP agents only (backward compatibility)
  - Test with various market types
  - Test with external data unavailability
  - Test with agent failures and timeouts
  - Test cost optimization under budget constraints
  - Verify Opik traces include all advanced agents
  - _Requirements: All_

- [x] 19. Update CLI to support advanced agent configuration
  - Add CLI flags for enabling/disabling agent groups
  - Add CLI flag for cost budget
  - Add CLI option to display agent selection decisions
  - Add CLI option to display signal fusion details
  - Add CLI option to display risk philosophy perspectives
  - Add CLI option to query agent performance metrics
  - Update help text and examples
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 19.1 Write end-to-end tests for CLI with advanced agents
  - Test CLI with all agents enabled
  - Test CLI with selective agents
  - Test CLI with MVP only
  - Test CLI output formatting
  - Test CLI error handling
  - _Requirements: All_

- [x] 20. Documentation and deployment
  - Document Advanced Agent League architecture
  - Document each agent group and their signals
  - Document dynamic agent selection logic
  - Document signal fusion algorithm
  - Document external data source setup
  - Document configuration options for agent groups
  - Document cost optimization strategies
  - Document performance tracking and evaluation
  - Add examples for budget-conscious and premium configurations
  - Update deployment guide
  - _Requirements: All_

- [x] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
