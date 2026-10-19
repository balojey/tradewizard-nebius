# Implementation Plan: TradeWizard Agents Cleanup

## Overview

This implementation plan outlines the steps to clean up the tradewizard-agents directory by making autonomous agents the default configuration and removing unnecessary documentation. The work focuses on:

1. **Configuration Updates**: Making autonomous mode the default for polling and news agents
2. **Duplicate Code Removal**: Removing non-autonomous versions of agents that have autonomous counterparts (polling, breaking news, media sentiment, market microstructure)
3. **Preservation**: Keeping all agents without autonomous versions (probability baseline, risk assessment, event impact, social sentiment, narrative velocity, and all others)
4. **Documentation Cleanup**: Removing outdated AWS, NOVA, and E2E documentation files

The work is organized into discrete tasks that build incrementally, with testing integrated throughout.

## Tasks

- [x] 1. Update polling agent configuration defaults
  - Modify `src/config/polling-agent-config.ts` to set autonomous: true by default
  - Update DEFAULT_POLLING_AGENT_CONFIG constant to have autonomous: true
  - Change loadPollingAgentConfig() to use opt-out logic (autonomous !== 'false')
  - Update documentation comments to reflect autonomous-first approach
  - _Requirements: 1.1, 1.3, 5.1, 5.3_

- [ ]* 1.1 Write unit tests for polling agent configuration
  - Test DEFAULT_POLLING_AGENT_CONFIG has autonomous: true
  - Test loadPollingAgentConfig() defaults to true when env var not set
  - Test loadPollingAgentConfig() respects explicit false value
  - _Requirements: 1.1, 1.3, 5.1, 7.1_

- [ ]* 1.2 Write property test for polling agent configuration
  - **Property 1: Configuration Defaults to Autonomous Mode (Polling Agent)**
  - **Validates: Requirements 1.3**

- [x] 2. Update news agents configuration defaults
  - Modify `src/config/news-agents-config.ts` to set autonomous: true by default
  - Update DEFAULT_NEWS_AGENT_CONFIG constant to have autonomous: true
  - Change loadNewsAgentsConfig() to use opt-out logic for all three agents
  - Update documentation comments to reflect autonomous-first approach
  - _Requirements: 1.2, 1.3, 5.2, 5.4_

- [ ]* 2.1 Write unit tests for news agents configuration
  - Test DEFAULT_NEWS_AGENT_CONFIG has autonomous: true
  - Test all three agents in DEFAULT_NEWS_AGENTS_CONFIG have autonomous: true
  - Test loadNewsAgentsConfig() defaults to true for all agents when env vars not set
  - Test loadNewsAgentsConfig() respects explicit false values per agent
  - _Requirements: 1.2, 1.5, 5.2, 7.2_

- [ ]* 2.2 Write property test for news agents configuration
  - **Property 1: Configuration Defaults to Autonomous Mode (News Agents)**
  - **Property 3: Configuration Loader Respects Explicit Opt-Out**
  - **Validates: Requirements 1.3, 7.2**

- [x] 3. Update main configuration file
  - Verify `src/config/index.ts` correctly uses updated config loaders
  - Update getDefaultConfig() to reflect autonomous: true defaults
  - Ensure configuration schema validation handles new defaults
  - _Requirements: 5.5_

- [ ]* 3.1 Write unit tests for main configuration
  - Test loadConfig() succeeds with no environment variables
  - Test configuration validation passes with new defaults
  - Test getDefaultConfig() returns autonomous: true for all agents
  - _Requirements: 10.1, 10.4_

- [ ]* 3.2 Write property test for configuration validation
  - **Property 4: Configuration Validation Accepts Boolean Values**
  - **Property 5: Configuration Loading with Missing Environment Variables**
  - **Validates: Requirements 7.4, 5.1, 5.2**

- [x] 4. Update environment variable example files
  - Update `.env.example` to show autonomous variables set to true
  - Update `.env.development.example` to show autonomous variables set to true
  - Update `.env.production.example` to show autonomous variables set to true
  - Update `.env.staging.example` to show autonomous variables set to true
  - Add comments explaining autonomous mode is now the default
  - Add comments showing how to disable autonomous mode if needed
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ]* 4.1 Write unit tests for environment file content
  - Parse .env.example and verify autonomous variables are true
  - Parse .env.development.example and verify autonomous variables are true
  - Parse .env.production.example and verify autonomous variables are true
  - Parse .env.staging.example and verify autonomous variables are true
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Checkpoint - Verify configuration changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Analyze agent files for duplicate implementations
  - Read `src/nodes/agents.ts` to identify polling and market microstructure agent implementations
  - Read `src/nodes/event-intelligence.ts` to identify breaking news agent implementation
  - Read `src/nodes/sentiment-narrative.ts` to identify media sentiment agent implementation
  - Verify which agents have autonomous counterparts (polling, breaking news, media sentiment, market microstructure)
  - Verify which agents do NOT have autonomous counterparts (probability baseline, risk assessment, etc.)
  - Create a list of functions to remove (only those with autonomous versions)
  - Create a list of functions to keep (shared utilities and agents without autonomous versions)
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 7. Remove duplicate polling agent implementation from agents.ts
  - Remove `createPollingIntelligenceAgentNode()` function from agents.ts
  - Remove `pollingIntelligenceAgent` property from `createAgentNodes()` return type
  - Remove `pollingIntelligenceAgent` implementation from `createAgentNodes()` function body
  - Keep `probabilityBaselineAgent` and `riskAssessmentAgent` in `createAgentNodes()`
  - Keep `createAgentNode()` and `createLLMInstances()` shared utilities
  - _Requirements: 3.1, 3.5, 3.6_

- [x] 8. Remove duplicate news agent implementations
  - Remove `createBreakingNewsAgentNode()` function from event-intelligence.ts
  - Remove `createMediaSentimentAgentNode()` function from sentiment-narrative.ts
  - Keep `createEventImpactAgentNode()` in event-intelligence.ts (no autonomous version)
  - Keep `createSocialSentimentAgentNode()` and `createNarrativeVelocityAgentNode()` in sentiment-narrative.ts (no autonomous versions)
  - Remove `marketMicrostructureAgent` from `createAgentNodes()` in agents.ts
  - _Requirements: 3.2, 3.3, 3.5_

- [x] 9. Update agent exports in index.ts
  - Remove export of `createPollingIntelligenceAgentNode` from agents.ts
  - Remove export of `createBreakingNewsAgentNode` from event-intelligence.ts
  - Remove export of `createMediaSentimentAgentNode` from sentiment-narrative.ts
  - Keep all other exports including `createAgentNodes`, `createAgentNode`, `createLLMInstances`
  - _Requirements: 3.7_

- [x] 10. Update workflow.ts to use autonomous agents
  - Update polling agent creation to always use `createAutonomousPollingAgentNode()`
  - Update breaking news agent creation to always use `createAutonomousBreakingNewsAgentNode()`
  - Update media sentiment agent creation to always use `createAutonomousMediaSentimentAgentNode()`
  - Update market microstructure agent creation to always use `createAutonomousMarketMicrostructureAgentNode()`
  - Add warning logs when config has autonomous=false for these agents
  - Remove conditional fallback logic for these four agents
  - Keep all other agent creation logic unchanged
  - _Requirements: 3.8, 7.5_

- [ ]* 10.1 Write unit tests for agent code cleanup
  - Verify autonomous agent files are unchanged (file hash comparison)
  - Verify agent node exports only include autonomous implementations for polling and news agents
  - Verify agent node exports still include non-autonomous implementations for other agents
  - Verify workflow.ts uses only autonomous agent nodes for polling and news agents
  - Verify probability baseline and risk assessment agents are preserved
  - _Requirements: 3.4, 3.5, 3.7, 3.8_

- [ ]* 10.2 Write integration test for agent initialization
  - Test agents initialize successfully with autonomous mode enabled
  - Test warning is logged when autonomous mode is disabled for polling/news agents
  - Test system uses autonomous versions even when config has autonomous=false
  - _Requirements: 10.5, 7.3, 7.5_

- [x] 11. Remove unnecessary markdown files from root directory
  - Delete `AWS_SALES_PITCH.md`
  - Delete `AWS_SALES_PITCH_SHORT.md`
  - Delete `AWS_SUPPORT_CASE_TEMPLATE.md`
  - Delete `AWS_SUPPORT_RESPONSE.md`
  - Delete `AWS_SUPPORT_RESPONSE_V2.md`
  - Delete `PRODUCTION_DEPLOYMENT_SUMMARY.md`
  - Verify preserved files still exist (README.md, DEPLOYMENT.md, CLI.md, CLI-MONITOR.md)
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 12. Remove unnecessary markdown files from docs directory
  - Delete all NOVA migration files (NOVA_2_UPGRADE.md, NOVA_MIGRATION_COMPLETE.md, NOVA_TOOL_CALLING_FIX.md, NOVA_TOOL_CALLING_MIGRATION.md, NOVA_TROUBLESHOOTING.md)
  - Delete troubleshooting files (BEDROCK_PERMISSIONS_TROUBLESHOOTING.md, LANGGRAPH_TROUBLESHOOTING.md, DIRECT_MARKET_DISCOVERY_MIGRATION.md)
  - Delete E2E testing files (E2E_DEPLOYMENT_CHECKLIST.md, E2E_QUICK_START.md, E2E_TEST_SUMMARY.md, E2E_TESTING_GUIDE.md)
  - Delete operational files (INCIDENT_RESPONSE.md, LOG_AGGREGATION.md, MONITORING_ALERTS.md, PERFORMANCE_TESTING.md, PRODUCTION_DEPLOYMENT.md, PRODUCTION_READINESS.md, ROLLBACK_PROCEDURE.md)
  - Delete misc files (TIMESTAMP_FORMATTING.md, SUPABASE_CHECKPOINTER.md, MEMORY_SYSTEM_EXAMPLES.md, MEMORY_SYSTEM_QUICK_START.md)
  - Verify preserved files still exist (DEPLOYMENT.md, EXAMPLES.md, RUNBOOK.md, README.md, OPIK_GUIDE.md, LLM_PROVIDERS.md, ADVANCED_AGENT_LEAGUE.md, AUTONOMOUS_NEWS_AGENTS.md, EXTERNAL_DATA_SOURCES.md)
  - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 13. Remove unnecessary markdown files from scripts and supabase directories
  - Delete `scripts/AWS_SUPPORT_ESCALATION_RESPONSE.md`
  - Delete `supabase/DASHBOARD_SETUP.md`
  - Delete `supabase/DEPLOYMENT_COMPLETE.md`
  - Verify `supabase/README.md` still exists
  - _Requirements: 4.10, 4.11, 4.12_

- [ ]* 13.1 Write unit tests for file cleanup verification
  - Verify all files in removal manifest do not exist
  - Verify all files in keep list still exist
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 8.3_

- [x] 14. Add warning logging for explicit autonomous mode disable
  - Update loadPollingAgentConfig() to log warning when POLLING_AGENT_AUTONOMOUS=false
  - Update loadNewsAgentsConfig() to log warning when any news agent autonomous variable is false
  - Use appropriate log level (warn) for the messages
  - Include helpful message about autonomous mode being the recommended default
  - _Requirements: 7.5_

- [ ]* 14.1 Write unit test for warning logging
  - Capture logs and verify warning is emitted when autonomous is set to false
  - Test for polling agent and all three news agents
  - _Requirements: 7.5_

- [ ]* 15. Write property test for environment variable override behavior
  - **Property 2: Environment Variables Override Defaults**
  - Test with randomly generated environment variable combinations
  - Verify any set env var overrides its corresponding default
  - _Requirements: 9.2_

- [x] 16. Final checkpoint - Comprehensive testing
  - Run all unit tests and verify they pass
  - Run all property tests and verify they pass (minimum 100 iterations each)
  - Test configuration loading with no environment variables
  - Test configuration loading with all autonomous variables set to false
  - Verify removed files do not exist
  - Verify preserved files still exist
  - Verify autonomous agent files are unchanged
  - Verify agents initialize successfully with autonomous mode enabled
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster completion
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- Configuration changes are made before code cleanup to ensure smooth transition
- File cleanup is done last to avoid disrupting development workflow
- All changes maintain backward compatibility via environment variable opt-out
