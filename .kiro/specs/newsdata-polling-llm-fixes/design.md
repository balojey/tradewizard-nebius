# NewsData, Polling, and LLM Fixes Bugfix Design

## Overview

This design addresses three critical bugs that impact API integration reliability, agent selection completeness, and LLM resilience:

1. **NewsData API Free Tier Parameters**: The NewsData client passes `size` and `timeframe` parameters that cause API failures for free tier users. The fix will detect tier status and conditionally exclude unsupported parameters.

2. **Polling Agent Not Selected**: The polling intelligence agent is incorrectly excluded from non-election market analyses despite providing valuable insights for all market types. The fix will ensure polling agent is always included in agent selection.

3. **LLM Rate Limit Causes Workflow Termination**: Rate limit errors from LLM providers terminate the entire workflow instead of rotating to alternative models. The fix will implement automatic LLM model rotation similar to the existing NewsData API key rotation pattern.

The fixes follow established patterns in the codebase: NewsData key rotation for LLM rotation, and simple agent list modification for polling inclusion.

## Glossary

- **Bug_Condition (C)**: The condition that triggers each bug
- **Property (P)**: The desired behavior when the bug condition is met
- **Preservation**: Existing functionality that must remain unchanged
- **NewsData Free Tier**: API plan limited to 10 articles per credit, does not support `size` or `timeframe` parameters
- **NewsData Paid Tier**: API plan supporting `size` (1-50) and `timeframe` (1h, 6h, 12h, 24h, 48h) parameters
- **Polling Agent**: `polling_intelligence` agent that analyzes polling data and statistical patterns
- **LLM Rate Limit**: HTTP 429 error or rate limit exception from LLM provider indicating temporary throttling
- **Model Rotation**: Switching from rate-limited LLM model to next available model using LRU strategy
- **KeyState Pattern**: State tracking pattern used in NewsData client for managing multiple API keys with rate limit expiry

## Bug Details

### Bug 1: NewsData API Free Tier Parameters

#### Fault Condition

The bug manifests when the NewsData client makes API requests using free tier credentials. The client unconditionally passes `size` and `timeframe` parameters that are not supported by the free tier plan, causing API errors.

**Formal Specification:**
```
FUNCTION isBugCondition_NewsData(request)
  INPUT: request of type NewsDataAPIRequest
  OUTPUT: boolean
  
  RETURN request.api_key_tier == 'free'
         AND (request.params.contains('size') OR request.params.contains('timeframe'))
         AND request.api_call_fails_with_unsupported_parameter_error
END FUNCTION
```

#### Examples

- **fetch_latest_news with free tier**: Passes `size=20` and `timeframe="24h"` → API returns error "Parameter not supported for free tier"
- **fetch_archive_news with free tier**: Passes `size=20` → API returns error "Parameter not supported for free tier"
- **fetch_crypto_news with free tier**: Passes `size=20` and `timeframe="1h"` → API returns error
- **fetch_market_news with paid tier**: Passes `size=20` and `timeframe="24h"` → API succeeds (expected behavior)

### Bug 2: Polling Agent Selection

#### Fault Condition

The bug manifests when dynamic agent selection runs for non-election market types (court, policy, geopolitical). The `select_agents_by_market_type` function only includes `polling_intelligence` in the agent list for election, court, economic, and "other" market types, but excludes it from policy and geopolitical markets despite polling data being valuable for all market types.

**Formal Specification:**
```
FUNCTION isBugCondition_PollingAgent(market)
  INPUT: market of type MarketBriefingDocument
  OUTPUT: boolean
  
  RETURN market.event_type IN ['policy', 'geopolitical']
         AND 'polling_intelligence' NOT IN selected_agents
         AND polling_agent_would_provide_valuable_insights
END FUNCTION
```

#### Examples

- **Policy market**: Event type = "policy" → selected agents = [breaking_news, event_impact, media_sentiment, social_sentiment, narrative_velocity, catalyst, tail_risk] → polling_intelligence excluded
- **Geopolitical market**: Event type = "geopolitical" → selected agents = [breaking_news, event_impact, media_sentiment, social_sentiment, narrative_velocity, catalyst, tail_risk] → polling_intelligence excluded
- **Election market**: Event type = "election" → selected agents include polling_intelligence (expected behavior)
- **Court market**: Event type = "court" → selected agents include polling_intelligence (expected behavior)

### Bug 3: LLM Rate Limit Handling

#### Fault Condition

The bug manifests when an LLM provider returns a rate limit error (HTTP 429 or rate limit exception) during agent execution. The system terminates the entire workflow instead of rotating to an alternative LLM model from the configured model list.

**Formal Specification:**
```
FUNCTION isBugCondition_LLMRateLimit(llm_response)
  INPUT: llm_response of type LLMResponse
  OUTPUT: boolean
  
  RETURN (llm_response.status_code == 429 OR llm_response.is_rate_limit_exception)
         AND alternative_llm_models_available
         AND workflow_terminates_prematurely
END FUNCTION
```

#### Examples

- **Single model configured, rate limited**: LLM_MODEL_NAME="llama-3.3-70b-instruct" → rate limit error → workflow terminates (current behavior)
- **Multiple models configured, rate limited**: LLM_MODEL_NAME="llama-3.3-70b-instruct,llama3-8b-instruct" → rate limit on first model → should rotate to second model
- **All models rate limited**: All configured models exhausted → workflow should gracefully degrade with low-confidence signals
- **No rate limit**: LLM responds successfully → continues using primary model (expected behavior)

## Expected Behavior

### Preservation Requirements

#### Bug 1: NewsData API Free Tier Parameters

**Unchanged Behaviors:**
- Paid tier API requests must continue to pass `size` and `timeframe` parameters as configured
- NewsData API key rotation logic must continue to work exactly as before
- Successful API responses must continue to be parsed and returned correctly
- All other NewsData parameters (query, qInTitle, country, category, language, sentiment) must continue to work

**Scope:**
All NewsData API requests using paid tier credentials should be completely unaffected by this fix. The fix only modifies parameter inclusion logic for free tier requests.

#### Bug 2: Polling Agent Selection

**Unchanged Behaviors:**
- All other agents must continue to be selected appropriately for each market type
- Agent execution must continue to produce individual agent signals with confidence scores
- Consensus engine must continue to calculate unified probability estimates correctly
- Configuration-based agent filtering must continue to work (enable/disable agent groups)

**Scope:**
All agent selection logic except the inclusion of polling_intelligence should remain unchanged. The fix only adds polling_intelligence to the agent lists for policy and geopolitical market types.

#### Bug 3: LLM Rate Limit Handling

**Unchanged Behaviors:**
- Successful LLM invocations must continue to use the primary configured model
- LLM response parsing must continue to work correctly
- Workflow completion must continue to generate recommendations with proper structure
- Audit logging must continue to capture all LLM invocations
- Single-model configurations must continue to work (graceful degradation when rate limited)

**Scope:**
All LLM invocations that succeed without rate limits should be completely unaffected. The fix only adds rotation logic when rate limit errors are detected.

## Hypothesized Root Cause

### Bug 1: NewsData API Free Tier Parameters

Based on the bug description and code analysis, the root causes are:

1. **No Tier Detection**: The NewsData client does not detect whether an API key is free tier or paid tier
   - No configuration flag for tier status
   - No API response inspection to detect tier
   - No environment variable to specify tier

2. **Unconditional Parameter Inclusion**: The `fetch_latest_news`, `fetch_archive_news`, `fetch_crypto_news`, and `fetch_market_news` methods always include `size` and `timeframe` parameters in the request
   - Parameters are added to the params dict without checking tier status
   - No conditional logic to exclude parameters for free tier

3. **Affects Both Codebases**: The issue exists in both Python (`doa/tools/newsdata_client.py`) and TypeScript (`tradewizard-agents/src/tools/newsdata-tools.ts`)

### Bug 2: Polling Agent Selection

Based on the code analysis, the root causes are:

1. **Incomplete Agent Lists**: In `doa/nodes/dynamic_agent_selection.py` and `tradewizard-agents/src/nodes/dynamic-agent-selection.ts`, the `select_agents_by_market_type` function does not include `POLLING_STATISTICAL_AGENTS` for policy and geopolitical market types
   - Policy markets: Only includes EVENT_INTELLIGENCE_AGENTS, SENTIMENT_NARRATIVE_AGENTS, EVENT_SCENARIO_AGENTS
   - Geopolitical markets: Only includes EVENT_INTELLIGENCE_AGENTS, SENTIMENT_NARRATIVE_AGENTS, EVENT_SCENARIO_AGENTS

2. **Incorrect Assumption**: The original implementation assumed polling data is only relevant for elections, courts, and economic markets, but polling intelligence can provide valuable insights for all market types (public opinion on policies, geopolitical sentiment, etc.)

### Bug 3: LLM Rate Limit Handling

Based on the code analysis, the root causes are:

1. **No Model Rotation Logic**: The `doa/utils/llm_factory.py` creates a single LLM instance without rotation capability
   - `create_llm_instance` function creates one ChatOpenAI instance
   - No state tracking for multiple models
   - No rate limit detection or retry logic

2. **Single Model Configuration**: The `config.py` reads `LLM_MODEL_NAME` as a single string, not a comma-separated list
   - No parsing of multiple model names
   - No model state management

3. **No Error Handling in Agent Execution**: When LLM invocation fails with rate limit, the exception propagates up and terminates the workflow
   - No try-catch for rate limit errors
   - No fallback to alternative models

## Correctness Properties

Property 1: Fault Condition - NewsData Free Tier Parameter Exclusion

_For any_ NewsData API request where the API key is free tier (isBugCondition_NewsData returns true), the fixed NewsData client SHALL exclude the `size` and `timeframe` parameters from the request, allowing the API call to succeed and return up to 10 articles per credit.

**Validates: Requirements 2.1, 2.2**

Property 2: Fault Condition - Polling Agent Always Selected

_For any_ market analysis where the event type is policy or geopolitical (isBugCondition_PollingAgent returns true), the fixed agent selection logic SHALL include the polling_intelligence agent in the selected agent set, ensuring comprehensive analysis with polling-based insights.

**Validates: Requirements 2.3, 2.4**

Property 3: Fault Condition - LLM Model Rotation on Rate Limit

_For any_ LLM invocation where a rate limit error is returned and alternative models are available (isBugCondition_LLMRateLimit returns true), the fixed LLM factory SHALL automatically rotate to the next available LLM model and retry the request, allowing the workflow to continue without termination.

**Validates: Requirements 2.5, 2.6**

Property 4: Preservation - NewsData Paid Tier Unchanged

_For any_ NewsData API request where the API key is paid tier (NOT isBugCondition_NewsData), the fixed NewsData client SHALL continue to pass `size` and `timeframe` parameters exactly as before, preserving all existing paid tier functionality.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 5: Preservation - Other Agent Selection Unchanged

_For any_ market analysis regardless of event type, the fixed agent selection logic SHALL continue to select all other appropriate agents (breaking_news, event_impact, sentiment agents, etc.) exactly as before, preserving all existing agent selection behavior.

**Validates: Requirements 3.4, 3.5, 3.6**

Property 6: Preservation - LLM Success Path Unchanged

_For any_ LLM invocation that succeeds without rate limit errors, the fixed LLM factory SHALL continue to use the primary configured model and process responses exactly as before, preserving all existing successful invocation behavior.

**Validates: Requirements 3.7, 3.8, 3.9**

## Fix Implementation

### Bug 1: NewsData API Free Tier Parameters

Assuming our root cause analysis is correct:

**Files**: 
- `doa/tools/newsdata_client.py` (Python)
- `tradewizard-agents/src/tools/newsdata-tools.ts` (TypeScript)

**Specific Changes**:

1. **Add Tier Detection Configuration**:
   - Add `NEWSDATA_FREE_TIER` environment variable (boolean, default: false)
   - Parse in NewsDataClient constructor
   - Store as instance variable `self.is_free_tier` (Python) / `this.isFreeTier` (TypeScript)

2. **Modify fetch_latest_news Method**:
   - Before adding `size` parameter: Check `if not self.is_free_tier: params["size"] = min(size, 50)`
   - Before adding `timeframe` parameter: Check `if not self.is_free_tier: params["timeframe"] = timeframe`
   - Free tier will receive default 10 articles per credit

3. **Modify fetch_archive_news Method**:
   - Before adding `size` parameter: Check `if not self.is_free_tier: params["size"] = min(size, 50)`
   - Free tier will receive default 10 articles per credit

4. **Modify fetch_crypto_news Method**:
   - Before adding `size` parameter: Check `if not self.is_free_tier: params["size"] = min(size, 50)`
   - Before adding `timeframe` parameter: Check `if timeframe and not self.is_free_tier: params["timeframe"] = timeframe`

5. **Modify fetch_market_news Method**:
   - Before adding `size` parameter: Check `if not self.is_free_tier: params["size"] = min(size, 50)`
   - Before adding `timeframe` parameter: Check `if timeframe and not self.is_free_tier: params["timeframe"] = timeframe`

6. **Add Logging**:
   - Log INFO message when free tier is detected: "NewsData free tier detected, excluding size and timeframe parameters"

### Bug 2: Polling Agent Selection

Assuming our root cause analysis is correct:

**Files**:
- `doa/nodes/dynamic_agent_selection.py` (Python)
- `tradewizard-agents/src/nodes/dynamic-agent-selection.ts` (TypeScript)

**Function**: `select_agents_by_market_type` / `selectAgentsByMarketType`

**Specific Changes**:

1. **Python - Modify policy case**:
   ```python
   elif event_type == 'policy':
       # Policy markets benefit from event intelligence, sentiment, catalysts, and polling
       agents.extend(EVENT_INTELLIGENCE_AGENTS)
       agents.extend(POLLING_STATISTICAL_AGENTS)  # ADD THIS LINE
       agents.extend(SENTIMENT_NARRATIVE_AGENTS)
       agents.extend(EVENT_SCENARIO_AGENTS)
   ```

2. **Python - Modify geopolitical case**:
   ```python
   elif event_type == 'geopolitical':
       # Geopolitical markets benefit from event intelligence, sentiment, catalysts, and polling
       agents.extend(EVENT_INTELLIGENCE_AGENTS)
       agents.extend(POLLING_STATISTICAL_AGENTS)  # ADD THIS LINE
       agents.extend(SENTIMENT_NARRATIVE_AGENTS)
       agents.extend(EVENT_SCENARIO_AGENTS)
   ```

3. **TypeScript - Modify policy case**:
   ```typescript
   case 'policy':
     // Policy markets benefit from event intelligence, sentiment, catalysts, and polling
     agents.push(
       ...EVENT_INTELLIGENCE_AGENTS,
       ...POLLING_STATISTICAL_AGENTS,  // ADD THIS LINE
       ...SENTIMENT_NARRATIVE_AGENTS,
       ...EVENT_SCENARIO_AGENTS
     );
     break;
   ```

4. **TypeScript - Modify geopolitical case**:
   ```typescript
   case 'geopolitical':
     // Geopolitical markets benefit from event intelligence, sentiment, catalysts, and polling
     agents.push(
       ...EVENT_INTELLIGENCE_AGENTS,
       ...POLLING_STATISTICAL_AGENTS,  // ADD THIS LINE
       ...SENTIMENT_NARRATIVE_AGENTS,
       ...EVENT_SCENARIO_AGENTS
     );
     break;
   ```

5. **Update Comments**: Modify the docstring comments to reflect that polling is valuable for all market types

### Bug 3: LLM Rate Limit Handling

Assuming our root cause analysis is correct, implement model rotation following the NewsData key rotation pattern:

**File**: `doa/utils/llm_factory.py`

**Specific Changes**:

1. **Add ModelState Class** (similar to KeyState):
   ```python
   @dataclass
   class ModelState:
       """State tracking for a single LLM model."""
       model_name: str
       model_id: str  # First 20 characters for logging
       is_rate_limited: bool
       rate_limit_expiry: Optional[datetime]
       total_requests: int
       last_used: Optional[datetime]
   ```

2. **Create LLMRotationManager Class**:
   - Parse comma-separated model names from `LLM_MODEL_NAME` env variable
   - Initialize `model_states: Dict[str, ModelState]` for each model
   - Implement `_get_available_models()` method (similar to `_get_available_keys`)
   - Implement `_is_rate_limit_error(exception)` method to detect rate limit errors
   - Implement `_extract_retry_after(exception)` method (default: 900 seconds)
   - Implement `_rotate_model(retry_after_seconds)` method (similar to `_rotate_api_key`)
   - Implement `get_model_rotation_stats()` method for observability

3. **Modify create_llm_instance Function**:
   - Accept optional `rotation_manager: LLMRotationManager` parameter
   - If rotation_manager provided, wrap ChatOpenAI instance with rotation logic
   - Create wrapper class that catches rate limit exceptions and rotates models

4. **Create LLMWithRotation Wrapper Class**:
   ```python
   class LLMWithRotation:
       """Wrapper that adds model rotation to LLM."""
       
       def __init__(self, rotation_manager, config):
           self.rotation_manager = rotation_manager
           self.config = config
           self.current_llm = self._create_llm(rotation_manager.get_current_model())
       
       def _create_llm(self, model_name):
           """Create ChatOpenAI instance for specific model."""
           return ChatOpenAI(
               base_url="https://inference.do-ai.run/v1/",
               api_key=self.config.api_key,
               model=model_name,
               temperature=self.config.temperature,
               max_tokens=self.config.max_tokens,
               timeout=self.config.timeout_ms / 1000
           )
       
       async def ainvoke(self, messages, **kwargs):
           """Async invoke with automatic model rotation on rate limit."""
           max_retries = len(self.rotation_manager.model_names)
           
           for attempt in range(max_retries):
               try:
                   # Update usage stats
                   self.rotation_manager.record_request()
                   
                   # Invoke LLM
                   response = await self.current_llm.ainvoke(messages, **kwargs)
                   return response
                   
               except Exception as e:
                   if self.rotation_manager.is_rate_limit_error(e):
                       retry_after = self.rotation_manager.extract_retry_after(e)
                       next_model = self.rotation_manager.rotate_model(retry_after)
                       
                       if next_model is None:
                           # All models exhausted
                           logger.error("All LLM models exhausted due to rate limits")
                           raise
                       
                       # Create new LLM instance with rotated model
                       self.current_llm = self._create_llm(next_model)
                       continue
                   else:
                       # Non-rate-limit error, re-raise
                       raise
           
           # Exhausted all retries
           raise RuntimeError("All LLM models rate limited")
       
       def bind(self, **kwargs):
           """Pass through bind to underlying LLM."""
           self.current_llm = self.current_llm.bind(**kwargs)
           return self
   ```

5. **Add Logging** (following NewsData pattern):
   - Log WARNING when rate limit detected: "Rate limit detected for model {model_id}, marked unavailable until {expiry_time}"
   - Log INFO when rotating: "Rotated LLM model: {old_model_id} -> {new_model_id}"
   - Log ERROR when all models exhausted: "All LLM models exhausted. Next available: {earliest_expiry}"
   - Log INFO when rate-limited model becomes available: "Model {model_id} rate limit expired, now available"

6. **Update config.py**:
   - Parse `LLM_MODEL_NAME` as comma-separated list
   - Store as `List[str]` in LLMConfig
   - Maintain backward compatibility for single model

7. **Update create_autonomous_agent_node**:
   - Create LLMRotationManager if multiple models configured
   - Pass rotation_manager to create_llm_instance
   - Use LLMWithRotation wrapper for agent LLM

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fixes. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate each bug condition and assert the expected failures. Run these tests on the UNFIXED code to observe failures and understand the root causes.

**Test Cases**:

1. **Bug 1 - NewsData Free Tier Test**: Configure NewsData client with free tier flag, call fetch_latest_news with size=20 and timeframe="24h" (will fail on unfixed code with API error)

2. **Bug 1 - NewsData Paid Tier Test**: Configure NewsData client without free tier flag, call fetch_latest_news with size=20 and timeframe="24h" (should succeed on unfixed code)

3. **Bug 2 - Policy Market Agent Selection**: Create market with event_type="policy", run agent selection (will fail on unfixed code - polling_intelligence not in selected agents)

4. **Bug 2 - Geopolitical Market Agent Selection**: Create market with event_type="geopolitical", run agent selection (will fail on unfixed code - polling_intelligence not in selected agents)

5. **Bug 3 - LLM Rate Limit Single Model**: Configure single LLM model, mock rate limit error (will fail on unfixed code - workflow terminates)

6. **Bug 3 - LLM Rate Limit Multiple Models**: Configure multiple LLM models, mock rate limit on first model (will fail on unfixed code - workflow terminates instead of rotating)

**Expected Counterexamples**:
- Bug 1: API returns "Parameter not supported for free tier" error
- Bug 2: polling_intelligence not in selected_agents list for policy/geopolitical markets
- Bug 3: Workflow terminates with rate limit exception instead of rotating to next model

### Fix Checking

**Goal**: Verify that for all inputs where the bug conditions hold, the fixed functions produce the expected behavior.

**Pseudocode:**

```
# Bug 1: NewsData Free Tier
FOR ALL request WHERE isBugCondition_NewsData(request) DO
  result := newsdata_client_fixed.fetch_latest_news(request)
  ASSERT result.success == true
  ASSERT 'size' NOT IN request.params
  ASSERT 'timeframe' NOT IN request.params
END FOR

# Bug 2: Polling Agent Selection
FOR ALL market WHERE isBugCondition_PollingAgent(market) DO
  agents := select_agents_by_market_type_fixed(market.event_type)
  ASSERT 'polling_intelligence' IN agents
END FOR

# Bug 3: LLM Rate Limit Rotation
FOR ALL llm_call WHERE isBugCondition_LLMRateLimit(llm_call) DO
  result := llm_with_rotation_fixed.ainvoke(llm_call)
  ASSERT result.success == true OR all_models_exhausted
  ASSERT model_rotation_occurred
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, the fixed functions produce the same results as the original functions.

**Pseudocode:**

```
# Bug 1: NewsData Paid Tier Preservation
FOR ALL request WHERE NOT isBugCondition_NewsData(request) DO
  ASSERT newsdata_client_original(request) == newsdata_client_fixed(request)
  ASSERT 'size' IN request.params
  ASSERT 'timeframe' IN request.params
END FOR

# Bug 2: Other Agent Selection Preservation
FOR ALL market WHERE NOT isBugCondition_PollingAgent(market) DO
  agents_original := select_agents_by_market_type_original(market.event_type)
  agents_fixed := select_agents_by_market_type_fixed(market.event_type)
  ASSERT agents_original == agents_fixed OR 'polling_intelligence' IN agents_fixed
END FOR

# Bug 3: LLM Success Path Preservation
FOR ALL llm_call WHERE NOT isBugCondition_LLMRateLimit(llm_call) DO
  ASSERT llm_original(llm_call) == llm_fixed(llm_call)
  ASSERT primary_model_used
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Bug 1 Preservation - Paid Tier Parameters**: Verify paid tier requests continue to include size and timeframe parameters
2. **Bug 1 Preservation - Key Rotation**: Verify API key rotation continues to work correctly
3. **Bug 1 Preservation - Response Parsing**: Verify API responses are parsed correctly

4. **Bug 2 Preservation - Election Markets**: Verify election markets continue to select polling agent
5. **Bug 2 Preservation - Other Agents**: Verify all other agents continue to be selected appropriately
6. **Bug 2 Preservation - Consensus Engine**: Verify consensus calculation continues to work

7. **Bug 3 Preservation - Successful Invocations**: Verify successful LLM calls continue to use primary model
8. **Bug 3 Preservation - Response Parsing**: Verify LLM responses are parsed correctly
9. **Bug 3 Preservation - Audit Logging**: Verify all LLM invocations are logged

### Unit Tests

- Test NewsData free tier parameter exclusion for each fetch method
- Test NewsData paid tier parameter inclusion for each fetch method
- Test agent selection includes polling for all market types
- Test LLM model rotation on rate limit error
- Test LLM model state tracking (rate limited, expiry, usage stats)
- Test LLM rotation exhaustion (all models rate limited)

### Property-Based Tests

- Generate random NewsData requests with free/paid tier flags, verify correct parameter inclusion
- Generate random market types, verify polling agent always included
- Generate random LLM invocations with rate limit patterns, verify rotation behavior
- Generate random successful LLM calls, verify primary model always used

### Integration Tests

- Test full workflow with NewsData free tier configuration
- Test full workflow with policy/geopolitical markets, verify polling agent executes
- Test full workflow with LLM rate limits, verify workflow completes with model rotation
- Test NewsData key rotation continues to work with free tier fix
- Test agent selection with configuration filters (enable/disable groups)
- Test LLM rotation with single model configuration (graceful degradation)
