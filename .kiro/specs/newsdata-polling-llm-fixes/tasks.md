# Implementation Plan

## Bug 1: NewsData API Free Tier Parameters

- [x] 1. Write bug condition exploration test for NewsData free tier
  - **Property 1: Fault Condition** - NewsData Free Tier Parameter Exclusion
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: free tier API calls with size/timeframe parameters
  - Test that NewsData client with free tier flag calling fetch_latest_news(size=20, timeframe="24h") fails with "Parameter not supported for free tier" error (from Fault Condition in design)
  - Test that fetch_archive_news, fetch_crypto_news, and fetch_market_news also fail with size parameter on free tier
  - Run test on UNFIXED code - expect FAILURE (this confirms the bug exists)
  - Document counterexamples found (e.g., "fetch_latest_news with size=20 returns API error instead of excluding parameter")
  - _Requirements: 2.1_

- [x] 2. Write preservation property tests for NewsData paid tier (BEFORE implementing fix)
  - **Property 2: Preservation** - NewsData Paid Tier Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: fetch_latest_news with paid tier and size=20, timeframe="24h" succeeds on unfixed code
  - Observe: All fetch methods continue to pass size and timeframe parameters for paid tier
  - Write property-based test: for all paid tier requests, size and timeframe parameters are included and API calls succeed (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Fix NewsData API free tier parameter handling

  - [x] 3.1 Implement tier detection and conditional parameter exclusion (Python)
    - Add `NEWSDATA_FREE_TIER` environment variable to config.py (boolean, default: false)
    - Modify `doa/tools/newsdata_client.py` constructor to parse and store `self.is_free_tier`
    - Modify `fetch_latest_news`: Check `if not self.is_free_tier` before adding size and timeframe parameters
    - Modify `fetch_archive_news`: Check `if not self.is_free_tier` before adding size parameter
    - Modify `fetch_crypto_news`: Check `if not self.is_free_tier` before adding size and timeframe parameters
    - Modify `fetch_market_news`: Check `if not self.is_free_tier` before adding size and timeframe parameters
    - Add INFO logging when free tier detected: "NewsData free tier detected, excluding size and timeframe parameters"
    - _Bug_Condition: isBugCondition_NewsData(request) where request.api_key_tier == 'free' AND request.params.contains('size' OR 'timeframe')_
    - _Expected_Behavior: Free tier requests exclude size and timeframe parameters, API calls succeed_
    - _Preservation: Paid tier requests continue to include size and timeframe parameters exactly as before_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [x] 3.2 Implement tier detection and conditional parameter exclusion (TypeScript)
    - Add `NEWSDATA_FREE_TIER` environment variable to config (boolean, default: false)
    - Modify `tradewizard-agents/src/tools/newsdata-tools.ts` constructor to parse and store `this.isFreeTier`
    - Modify `fetchLatestNews`: Check `if (!this.isFreeTier)` before adding size and timeframe parameters
    - Modify `fetchArchiveNews`: Check `if (!this.isFreeTier)` before adding size parameter
    - Modify `fetchCryptoNews`: Check `if (!this.isFreeTier)` before adding size and timeframe parameters
    - Modify `fetchMarketNews`: Check `if (!this.isFreeTier)` before adding size and timeframe parameters
    - Add INFO logging when free tier detected
    - _Bug_Condition: isBugCondition_NewsData(request) where request.api_key_tier == 'free' AND request.params.contains('size' OR 'timeframe')_
    - _Expected_Behavior: Free tier requests exclude size and timeframe parameters, API calls succeed_
    - _Preservation: Paid tier requests continue to include size and timeframe parameters exactly as before_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - NewsData Free Tier Parameter Exclusion
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: Expected Behavior Properties from design_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - NewsData Paid Tier Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

## Bug 2: Polling Agent Selection

- [x] 4. Write bug condition exploration test for polling agent selection
  - **Property 1: Fault Condition** - Polling Agent Always Selected
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: policy and geopolitical market types
  - Test that select_agents_by_market_type("policy") excludes polling_intelligence (from Fault Condition in design)
  - Test that select_agents_by_market_type("geopolitical") excludes polling_intelligence
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "policy market returns agents without polling_intelligence")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.3_

- [x] 5. Write preservation property tests for other agent selection (BEFORE implementing fix)
  - **Property 2: Preservation** - Other Agent Selection Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for election, court, economic, and other market types
  - Observe: Election markets include polling_intelligence on unfixed code
  - Observe: All market types include appropriate agents (breaking_news, event_impact, sentiment agents, etc.)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.4, 3.5, 3.6_

- [x] 6. Fix polling agent selection for policy and geopolitical markets

  - [x] 6.1 Add polling agent to policy and geopolitical market types (Python)
    - Modify `doa/nodes/dynamic_agent_selection.py` function `select_agents_by_market_type`
    - In policy case: Add `agents.extend(POLLING_STATISTICAL_AGENTS)` after EVENT_INTELLIGENCE_AGENTS
    - In geopolitical case: Add `agents.extend(POLLING_STATISTICAL_AGENTS)` after EVENT_INTELLIGENCE_AGENTS
    - Update docstring comments to reflect polling is valuable for all market types
    - _Bug_Condition: isBugCondition_PollingAgent(market) where market.event_type IN ['policy', 'geopolitical'] AND 'polling_intelligence' NOT IN selected_agents_
    - _Expected_Behavior: polling_intelligence included in selected agents for all market types_
    - _Preservation: All other agents continue to be selected appropriately for each market type_
    - _Requirements: 2.3, 2.4, 3.4, 3.5, 3.6_

  - [x] 6.2 Add polling agent to policy and geopolitical market types (TypeScript)
    - Modify `tradewizard-agents/src/nodes/dynamic-agent-selection.ts` function `selectAgentsByMarketType`
    - In policy case: Add `...POLLING_STATISTICAL_AGENTS,` to agents.push() after EVENT_INTELLIGENCE_AGENTS
    - In geopolitical case: Add `...POLLING_STATISTICAL_AGENTS,` to agents.push() after EVENT_INTELLIGENCE_AGENTS
    - Update comments to reflect polling is valuable for all market types
    - _Bug_Condition: isBugCondition_PollingAgent(market) where market.event_type IN ['policy', 'geopolitical'] AND 'polling_intelligence' NOT IN selected_agents_
    - _Expected_Behavior: polling_intelligence included in selected agents for all market types_
    - _Preservation: All other agents continue to be selected appropriately for each market type_
    - _Requirements: 2.3, 2.4, 3.4, 3.5, 3.6_

  - [x] 6.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Polling Agent Always Selected
    - **IMPORTANT**: Re-run the SAME test from task 4 - do NOT write a new test
    - The test from task 4 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 4
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: Expected Behavior Properties from design_

  - [x] 6.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Other Agent Selection Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 5 - do NOT write new tests
    - Run preservation property tests from step 5
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

## Bug 3: LLM Rate Limit Handling

- [x] 7. Write bug condition exploration test for LLM rate limit rotation
  - **Property 1: Fault Condition** - LLM Model Rotation on Rate Limit
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: LLM invocations with rate limit errors and multiple models configured
  - Test that LLM invocation with rate limit error (HTTP 429) terminates workflow instead of rotating to next model (from Fault Condition in design)
  - Mock rate limit exception from first model, verify workflow terminates on unfixed code
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "LLM rate limit raises exception instead of rotating to llama3-8b-instruct")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.5_

- [x] 8. Write preservation property tests for LLM success path (BEFORE implementing fix)
  - **Property 2: Preservation** - LLM Success Path Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for successful LLM invocations
  - Observe: Successful LLM calls use primary configured model on unfixed code
  - Observe: LLM responses are parsed correctly and workflow completes
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.7, 3.8, 3.9_

- [ ] 9. Fix LLM rate limit handling with model rotation

  - [x] 9.1 Implement ModelState and LLMRotationManager classes
    - Create `doa/utils/llm_rotation_manager.py` following NewsData key rotation pattern
    - Define ModelState dataclass with model_name, model_id, is_rate_limited, rate_limit_expiry, total_requests, last_used
    - Implement LLMRotationManager class with model state tracking
    - Parse comma-separated model names from `LLM_MODEL_NAME` env variable
    - Implement `_get_available_models()` method (similar to NewsData `_get_available_keys`)
    - Implement `_is_rate_limit_error(exception)` method to detect HTTP 429 or rate limit exceptions
    - Implement `_extract_retry_after(exception)` method (default: 900 seconds)
    - Implement `_rotate_model(retry_after_seconds)` method with LRU strategy
    - Implement `get_model_rotation_stats()` method for observability
    - Add logging: WARNING on rate limit, INFO on rotation, ERROR on exhaustion
    - _Bug_Condition: isBugCondition_LLMRateLimit(llm_response) where llm_response.status_code == 429 AND alternative_llm_models_available_
    - _Expected_Behavior: Automatic rotation to next available model, workflow continues_
    - _Preservation: Successful invocations continue to use primary model_
    - _Requirements: 2.5, 2.6, 3.7, 3.8, 3.9_

  - [x] 9.2 Implement LLMWithRotation wrapper class
    - Create wrapper class in `doa/utils/llm_rotation_manager.py`
    - Implement `__init__` to accept rotation_manager and config
    - Implement `_create_llm(model_name)` to create ChatOpenAI instance for specific model
    - Implement `ainvoke` with try-catch for rate limit errors
    - On rate limit: call rotation_manager.rotate_model() and retry with next model
    - On non-rate-limit error: re-raise exception
    - Implement max_retries loop (len(rotation_manager.model_names))
    - Implement `bind` method to pass through to underlying LLM
    - Add logging for each rotation attempt
    - _Bug_Condition: isBugCondition_LLMRateLimit(llm_response) where llm_response.status_code == 429 AND alternative_llm_models_available_
    - _Expected_Behavior: Automatic rotation to next available model, workflow continues_
    - _Preservation: Successful invocations continue to use primary model_
    - _Requirements: 2.5, 2.6, 3.7, 3.8, 3.9_

  - [x] 9.3 Update config.py to parse multiple model names
    - Modify `doa/config.py` to parse `LLM_MODEL_NAME` as comma-separated list
    - Store as `List[str]` in LLMConfig
    - Maintain backward compatibility for single model configuration
    - _Requirements: 2.5, 2.6_

  - [x] 9.4 Update llm_factory.py to use rotation manager
    - Modify `doa/utils/llm_factory.py` function `create_llm_instance`
    - Accept optional `rotation_manager: LLMRotationManager` parameter
    - If rotation_manager provided and multiple models configured, return LLMWithRotation wrapper
    - If single model or no rotation_manager, return standard ChatOpenAI instance (backward compatibility)
    - _Requirements: 2.5, 2.6, 3.7, 3.8, 3.9_

  - [x] 9.5 Update agent creation to use rotation manager
    - Modify agent factory functions to create LLMRotationManager when multiple models configured
    - Pass rotation_manager to create_llm_instance
    - Update `doa/agents/autonomous_agent_factory.py` function `create_autonomous_agent_node`
    - Update `doa/agents/agent_factory.py` for non-autonomous agents if applicable
    - _Requirements: 2.5, 2.6_

  - [x] 9.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - LLM Model Rotation on Rate Limit
    - **IMPORTANT**: Re-run the SAME test from task 7 - do NOT write a new test
    - The test from task 7 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 7
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: Expected Behavior Properties from design_

  - [x] 9.7 Verify preservation tests still pass
    - **Property 2: Preservation** - LLM Success Path Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 8 - do NOT write new tests
    - Run preservation property tests from step 8
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 10. Checkpoint - Ensure all tests pass
  - Run all exploration tests (tasks 1, 4, 7) - should now PASS
  - Run all preservation tests (tasks 2, 5, 8) - should still PASS
  - Run full integration test with all three fixes applied
  - Verify NewsData free tier works without API errors
  - Verify polling agent is selected for policy and geopolitical markets
  - Verify LLM rotation works when rate limits occur
  - Ensure all tests pass, ask the user if questions arise
