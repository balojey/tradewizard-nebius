# Implementation Plan: Polling Agent

## Overview

This implementation plan adds a new polling intelligence agent to the TradeWizard multi-agent system. The agent interprets market prices as real-time polling data, analyzing sentiment shifts, crowd wisdom signals, and comparing market-implied probabilities with historical polling baselines. The implementation follows the established agent pattern and integrates seamlessly into the existing LangGraph workflow.

## Tasks

- [x] 1. Add polling agent system prompt and LLM configuration
  - Add `pollingIntelligence` system prompt to `AGENT_PROMPTS` constant in `src/nodes/agents.ts`
  - Update `createLLMInstances()` return type to include `pollingIntelligence: LLMInstance`
  - Add LLM instance creation for polling agent (primary: Google, fallbacks: Anthropic, OpenAI, Nova)
  - _Requirements: 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ]* 1.1 Write property test for LLM configuration
  - **Property: For any engine configuration, createLLMInstances() returns valid LLM instance for polling agent**
  - **Validates: Requirements 1.5**

- [x] 2. Implement polling agent node function
  - [x] 2.1 Create `createPollingIntelligenceAgentNode()` function in `src/nodes/agents.ts`
    - Use `createAgentNode()` factory with polling agent name and system prompt
    - Follow existing agent pattern (market_microstructure, probability_baseline, risk_assessment)
    - _Requirements: 1.1, 1.3, 1.4, 1.6_
  
  - [ ]* 2.2 Write unit test for successful analysis
    - Test with complete MBD containing all required fields
    - Verify output conforms to AgentSignal schema
    - _Requirements: 1.1, 1.3_
  
  - [ ]* 2.3 Write unit test for missing MBD error handling
    - Test with null/undefined MBD
    - Verify returns AgentError with type EXECUTION_FAILED
    - _Requirements: 1.4, 10.1, 10.2, 10.4_
  
  - [ ]* 2.4 Write property test for schema compliance
    - **Property 1: Schema Compliance**
    - **Validates: Requirements 1.1**
  
  - [ ]* 2.5 Write property test for bounds validation
    - **Property 2: Bounds Validation**
    - **Validates: Requirements 6.6, 7.6**
  
  - [ ]* 2.6 Write property test for audit trail completeness
    - **Property 3: Audit Trail Completeness**
    - **Validates: Requirements 1.6, 10.3, 10.5**

- [x] 3. Integrate polling agent into workflow
  - [x] 3.1 Export polling agent node from `src/nodes/index.ts`
    - Add export for `createPollingIntelligenceAgentNode`
    - _Requirements: 1.2_
  
  - [x] 3.2 Update workflow in `src/workflow.ts`
    - Import `createPollingIntelligenceAgentNode` from nodes
    - Create polling agent node instance
    - Add node to StateGraph: `.addNode('polling_intelligence_agent', pollingIntelligenceAgent)`
    - Add parallel edge from dynamic selection: `.addEdge('dynamic_agent_selection', 'polling_intelligence_agent')`
    - Add edge to signal fusion: `.addEdge('polling_intelligence_agent', 'agent_signal_fusion')`
    - _Requirements: 1.2_
  
  - [ ]* 3.3 Write integration test for workflow execution
    - Test that polling agent executes in parallel with other agents
    - Test that polling agent signal reaches consensus engine
    - Verify workflow completes successfully
    - _Requirements: 1.2_

- [x] 4. Checkpoint - Ensure basic integration works
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Implement polling analysis logic in system prompt
  - [x] 5.1 Add price movement analysis instructions to system prompt
    - Instruct LLM to calculate price movements across time horizons (1h, 24h, 7d)
    - Define sentiment shift thresholds (3% for 1h, 10% for 24h)
    - Specify metadata fields: sentimentShift with magnitude, direction, timeHorizon
    - _Requirements: 2.2, 2.3, 2.6, 5.1, 5.2, 5.3, 5.5, 5.6_
  
  - [ ]* 5.2 Write property test for sentiment shift detection
    - **Property 5: Sentiment Shift Detection**
    - **Validates: Requirements 2.3, 5.1, 5.2, 5.3, 5.5**
  
  - [ ]* 5.3 Write property test for direction alignment
    - **Property 25: Direction Alignment with Sentiment**
    - **Validates: Requirements 5.6**

- [x] 6. Implement crowd wisdom detection logic in system prompt
  - [x] 6.1 Add crowd wisdom signal instructions to system prompt
    - Define crowd wisdom conditions (liquidityScore > 7, volume above median, bidAskSpread < 2, low volatility)
    - Instruct LLM to calculate crowdWisdomScore (0-1)
    - Specify confidence boost when crowd wisdom detected
    - _Requirements: 3.1, 3.2, 3.5, 6.1_
  
  - [ ]* 6.2 Write property test for crowd wisdom classification
    - **Property 6: Crowd Wisdom Classification**
    - **Validates: Requirements 3.1**
  
  - [ ]* 6.3 Write property test for crowd wisdom confidence boost
    - **Property 15: Confidence Calibration - Crowd Wisdom**
    - **Validates: Requirements 6.1**

- [x] 7. Implement market momentum and noise detection in system prompt
  - [x] 7.1 Add momentum detection instructions to system prompt
    - Define momentum as consistent price direction across time horizons
    - Instruct LLM to include momentum insights in keyDrivers
    - _Requirements: 3.3_
  
  - [x] 7.2 Add noise indicator instructions to system prompt
    - Define noise conditions (high volatility + low volume)
    - Instruct LLM to flag noise in riskFactors
    - Specify confidence penalty for noise
    - _Requirements: 3.4, 3.6, 6.2_
  
  - [ ]* 7.3 Write property test for momentum detection
    - **Property 7: Market Momentum Detection**
    - **Validates: Requirements 3.3**
  
  - [ ]* 7.4 Write property test for noise indicator detection
    - **Property 8: Noise Indicator Detection**
    - **Validates: Requirements 3.4, 3.6**
  
  - [ ]* 7.5 Write property test for noise confidence penalty
    - **Property 16: Confidence Calibration - Noise**
    - **Validates: Requirements 6.2**

- [x] 8. Implement polling baseline comparison logic in system prompt
  - [x] 8.1 Add polling baseline instructions to system prompt
    - Define baseline accuracy rates by eventType (election: 0.75, policy: 0.60, court: 0.70, geopolitical: 0.55, economic: 0.65, other: 0.50)
    - Instruct LLM to calculate marketDeviation from baseline
    - Specify flagging threshold (deviation > 10%)
    - Instruct LLM to include pollingBaseline and marketDeviation in metadata
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_
  
  - [ ]* 8.2 Write property test for polling baseline availability
    - **Property 9: Polling Baseline Availability**
    - **Validates: Requirements 4.1**
  
  - [ ]* 8.3 Write unit test for election baseline comparison
    - Test with election market
    - Verify baseline comparison in metadata
    - _Requirements: 4.2_
  
  - [ ]* 8.4 Write property test for baseline deviation detection
    - **Property 10: Baseline Deviation Detection**
    - **Validates: Requirements 4.3**
  
  - [ ]* 8.5 Write unit test for unknown eventType handling
    - Test with synthetic eventType
    - Verify uses neutral baseline (0.5)
    - _Requirements: 4.6_

- [x] 9. Implement fair probability estimation logic in system prompt
  - [x] 9.1 Add fair probability calculation instructions to system prompt
    - Instruct LLM to blend market price with polling baseline based on crowdWisdomScore
    - Define momentum adjustment rules
    - Define noise regression rules
    - Ensure fairProbability bounds [0, 1]
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ]* 9.2 Write property test for fair probability adjustment
    - **Property 11: Fair Probability Adjustment**
    - **Validates: Requirements 4.4, 7.3**
  
  - [ ]* 9.3 Write property test for momentum-based adjustment
    - **Property 12: Momentum-Based Probability Adjustment**
    - **Validates: Requirements 7.2**
  
  - [ ]* 9.4 Write property test for crowd wisdom weighting
    - **Property 13: Crowd Wisdom Weighting**
    - **Validates: Requirements 7.4**
  
  - [ ]* 9.5 Write property test for noise regression
    - **Property 14: Noise Regression**
    - **Validates: Requirements 7.5**

- [x] 10. Implement confidence calibration logic in system prompt
  - [x] 10.1 Add confidence calibration instructions to system prompt
    - Define base confidence and adjustment rules
    - Specify crowd wisdom boost (confidence > 0.7)
    - Specify noise penalty (confidence < 0.4)
    - Specify ambiguity penalty (0.1 per flag)
    - Specify liquidity cap (max 0.5 if liquidityScore < 5)
    - Instruct LLM to include confidenceFactors in metadata
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [ ]* 10.2 Write property test for ambiguity confidence penalty
    - **Property 17: Confidence Calibration - Ambiguity**
    - **Validates: Requirements 6.3**
  
  - [ ]* 10.3 Write property test for liquidity confidence cap
    - **Property 18: Confidence Calibration - Liquidity Cap**
    - **Validates: Requirements 6.4**
  
  - [ ]* 10.4 Write property test for metadata completeness
    - **Property 4: Metadata Completeness**
    - **Validates: Requirements 2.2, 2.4, 3.5, 4.5, 6.5**

- [x] 11. Implement risk factor identification logic in system prompt
  - [x] 11.1 Add risk factor instructions to system prompt
    - Define specific risk factor text for each condition:
      - Low liquidity: "Low liquidity - thin polling sample"
      - Wide spread: "Wide spread - polling uncertainty"
      - Low volume: "Low volume - limited participation"
      - High volatility: "High volatility - unstable sentiment"
      - Non-election: "Limited polling baseline for this event type"
    - Specify 5-item limit for riskFactors array
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  
  - [ ]* 11.2 Write property test for risk factor generation
    - **Property 19: Risk Factor Generation**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**
  
  - [ ]* 11.3 Write property test for risk factor limit
    - **Property 20: Risk Factor Limit**
    - **Validates: Requirements 8.6**

- [x] 12. Checkpoint - Ensure core polling logic works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement cross-market sentiment analysis in system prompt
  - [x] 13.1 Add cross-market analysis instructions to system prompt
    - Instruct LLM to check for eventContext in MBD
    - Define cross-market sentiment calculation (when eventContext available)
    - Define series pattern detection (3+ markets with consistent direction)
    - Instruct LLM to include relatedMarketCount and crossMarketAlignment in metadata
    - Define divergence flagging (crossMarketAlignment < 0.3)
    - _Requirements: 12.1, 12.5, 12.6, 12.7_
  
  - [ ]* 13.2 Write unit test for cross-market analysis with eventContext
    - Test with MBD containing eventContext
    - Verify cross-market metadata fields present
    - _Requirements: 12.1, 12.6_
  
  - [ ]* 13.3 Write unit test for single-market analysis without eventContext
    - Test with MBD without eventContext
    - Verify cross-market fields absent or null
    - _Requirements: 12.7_
  
  - [ ]* 13.4 Write property test for cross-market metadata presence
    - **Property 22: Cross-Market Metadata Presence**
    - **Validates: Requirements 12.6**
  
  - [ ]* 13.5 Write property test for cross-market metadata absence
    - **Property 23: Cross-Market Metadata Absence**
    - **Validates: Requirements 12.7**
  
  - [ ]* 13.6 Write property test for cross-market divergence detection
    - **Property 24: Cross-Market Divergence Detection**
    - **Validates: Requirements 12.5**

- [x] 14. Implement error handling and retry logic
  - [x] 14.1 Add error handling to agent node function
    - Catch LLM invocation failures
    - Catch schema validation failures
    - Implement retry logic for invalid structured output (1 retry)
    - Return AgentError instead of throwing exceptions
    - Log all errors to audit trail
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  
  - [ ]* 14.2 Write unit test for LLM failure handling
    - Mock LLM to throw error
    - Verify returns AgentError
    - Verify audit trail contains error
    - _Requirements: 10.1, 10.3_
  
  - [ ]* 14.3 Write unit test for invalid structured output retry
    - Mock LLM to return invalid output first, valid output second
    - Verify retry occurs
    - Verify successful result after retry
    - _Requirements: 10.6_
  
  - [ ]* 14.4 Write property test for error handling without exceptions
    - **Property 21: Error Handling - No Exceptions**
    - **Validates: Requirements 10.4**

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate workflow integration
- The implementation follows the established agent pattern in TradeWizard
- No new dependencies required - uses existing LangGraph, Zod, fast-check, Vitest
- Backward compatible - existing workflows continue to work
