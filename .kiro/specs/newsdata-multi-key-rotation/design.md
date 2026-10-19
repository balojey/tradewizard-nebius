# Design Document: NewsData Multi-Key Rotation

## Overview

This feature adds intelligent API key rotation to the NewsData.io client implementations in both Python (doa) and Node.js (tradewizard-agents). When a rate limit is detected on the current API key, the system automatically rotates to the next available key, enabling higher throughput and preventing workflow interruptions.

The design maintains backward compatibility with single-key configurations while adding sophisticated multi-key management including:
- Automatic rate limit detection via HTTP 429 responses
- Intelligent key selection using least-recently-used (LRU) strategy
- Time-based key state management with automatic expiry
- Graceful degradation when all keys are exhausted
- Comprehensive observability integration

This feature is critical for production deployments where the monitor service runs continuously and multiple agents fetch news data in parallel, potentially exceeding the rate limit of a single API key (1800 requests per 15 minutes for paid plans).

## Architecture

### High-Level Design

The key rotation system is implemented entirely within the NewsDataClient class in both codebases, requiring no changes to calling code. The architecture follows these principles:

1. **Encapsulation**: All rotation logic is internal to the client; external APIs remain unchanged
2. **Stateful Management**: Each client instance maintains in-memory state for all configured keys
3. **Fail-Fast Detection**: Rate limits are detected immediately via HTTP 429 responses
4. **Automatic Recovery**: Keys automatically become available again after their rate limit window expires
5. **Zero-Downtime**: Rotation happens transparently during request retry logic

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NewsDataClient                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Configuration Parser                        │    │
│  │  - Parse comma-separated keys from env var         │    │
│  │  - Trim whitespace and validate                    │    │
│  │  - Initialize key state records                    │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Key State Manager                           │    │
│  │  - Track rate limit status per key                 │    │
│  │  - Maintain expiry timestamps                      │    │
│  │  - Record usage statistics                         │    │
│  │  - Auto-expire rate-limited keys                   │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Request Handler                             │    │
│  │  - Make HTTP requests with current key             │    │
│  │  - Detect rate limit responses (429)               │    │
│  │  - Extract Retry-After headers                     │    │
│  │  - Trigger rotation on rate limit                  │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Key Rotation Engine                         │    │
│  │  - Mark current key as rate-limited                │    │
│  │  - Select next available key (LRU)                 │    │
│  │  - Update key state timestamps                     │    │
│  │  - Retry request with new key                      │    │
│  │  - Handle exhaustion gracefully                    │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Observability Layer                         │    │
│  │  - Log rotation events                             │    │
│  │  - Track key usage metrics                         │    │
│  │  - Integrate with Opik/audit logger                │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Integration Points

The feature integrates with existing systems at these points:

1. **Environment Configuration**: Reads `NEWSDATA_API_KEY` from environment variables
2. **HTTP Client**: Wraps existing request logic in both Python (httpx) and Node.js (fetch)
3. **Logging Systems**: Uses existing loggers (Python: logging module, Node.js: console/audit logger)
4. **Observability**: Integrates with Opik for metrics tracking
5. **Agent Workflow**: Transparent to agents; they continue using the same client methods

## Components and Interfaces

### Configuration Parser

**Purpose**: Parse and validate API key configuration from environment variables.

**Python Implementation** (`doa/tools/newsdata_client.py`):

```python
class NewsDataClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://newsdata.io/api/1",
        timeout: int = 30
    ):
        # Parse comma-separated keys
        self.api_keys: List[str] = [
            key.strip() 
            for key in api_key.split(',') 
            if key.strip()
        ]
        
        if not self.api_keys:
            raise ValueError("At least one API key must be provided")
        
        # Initialize key state management
        self.key_states: Dict[str, KeyState] = {}
        for key in self.api_keys:
            self.key_states[self._get_key_id(key)] = KeyState(
                key=key,
                key_id=self._get_key_id(key),
                is_rate_limited=False,
                rate_limit_expiry=None,
                total_requests=0,
                last_used=None
            )
        
        self.current_key_index: int = 0
        # ... existing initialization
```

**Node.js Implementation** (`tradewizard-agents/src/utils/newsdata-client.ts`):

```typescript
export class NewsDataClient {
  private apiKeys: string[];
  private keyStates: Map<string, KeyState>;
  private currentKeyIndex: number;

  constructor(config: NewsDataConfig) {
    // Parse comma-separated keys
    const apiKeyString = config.apiKey || process.env.NEWSDATA_API_KEY || '';
    this.apiKeys = apiKeyString
      .split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0);
    
    if (this.apiKeys.length === 0) {
      throw new Error('At least one API key must be provided');
    }
    
    // Initialize key state management
    this.keyStates = new Map();
    for (const key of this.apiKeys) {
      const keyId = this.getKeyId(key);
      this.keyStates.set(keyId, {
        key,
        keyId,
        isRateLimited: false,
        rateLimitExpiry: null,
        totalRequests: 0,
        lastUsed: null
      });
    }
    
    this.currentKeyIndex = 0;
    // ... existing initialization
  }
}
```

**Interface Contract**:
- Input: Comma-separated string of API keys (may contain whitespace)
- Output: Array of validated, trimmed API keys
- Errors: Throws configuration error if no valid keys provided
- Side Effects: Initializes key state records for all keys

### Key State Manager

**Purpose**: Track the state of each API key including rate limit status, expiry times, and usage statistics.

**Data Structure** (Python):

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class KeyState:
    """State tracking for a single API key."""
    key: str
    key_id: str  # First 8 characters for logging
    is_rate_limited: bool
    rate_limit_expiry: Optional[datetime]
    total_requests: int
    last_used: Optional[datetime]
```

**Data Structure** (TypeScript):

```typescript
interface KeyState {
  key: string;
  keyId: string;  // First 8 characters for logging
  isRateLimited: boolean;
  rateLimitExpiry: Date | null;
  totalRequests: number;
  lastUsed: Date | null;
}
```

**Key Operations**:

1. **Mark Key as Rate-Limited**:
   - Set `is_rate_limited = true`
   - Set `rate_limit_expiry` based on Retry-After header or default (15 minutes)
   - Log warning with key ID and expiry time

2. **Check Key Availability**:
   - If not rate-limited, return true
   - If rate-limited but expiry time passed, auto-expire and return true
   - Otherwise return false

3. **Update Usage Statistics**:
   - Increment `total_requests` on each use
   - Update `last_used` timestamp
   - Used for LRU selection strategy

4. **Get Available Keys**:
   - Filter keys where `is_rate_limited = false` or expiry time passed
   - Sort by `last_used` timestamp (ascending)
   - Return least recently used key

### Rate Limit Detector

**Purpose**: Detect rate limit responses from the NewsData API and extract retry information.

**Python Implementation**:

```python
def _is_rate_limit_error(self, response: httpx.Response) -> bool:
    """Check if response indicates rate limit."""
    if response.status_code != 429:
        return False
    
    # Check response body for rate limit vs quota exceeded
    try:
        data = response.json()
        # Rate limit: temporary, will reset
        # Quota exceeded: daily limit reached, won't reset until next day
        if 'results' in data and 'message' in data['results']:
            message = data['results']['message'].lower()
            return 'rate limit' in message or 'too many requests' in message
    except:
        pass
    
    # Default: treat all 429 as rate limit
    return True

def _extract_retry_after(self, response: httpx.Response) -> int:
    """Extract Retry-After header value in seconds."""
    retry_after = response.headers.get('Retry-After')
    if retry_after:
        try:
            return int(retry_after)
        except ValueError:
            # Could be HTTP date format, parse it
            pass
    
    # Default: 15 minutes (900 seconds)
    return 900
```

**Node.js Implementation**:

```typescript
private isRateLimitError(response: Response): boolean {
  if (response.status !== 429) {
    return false;
  }
  
  // Check response body for rate limit vs quota exceeded
  // Rate limit: temporary, will reset
  // Quota exceeded: daily limit reached, won't reset until next day
  try {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      // Response body already consumed, check for error patterns
      // This is a simplified check; actual implementation may vary
      return true;
    }
  } catch {
    // Ignore parsing errors
  }
  
  // Default: treat all 429 as rate limit
  return true;
}

private extractRetryAfter(response: Response): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }
    // Could be HTTP date format, would need parsing
  }
  
  // Default: 15 minutes (900 seconds)
  return 900;
}
```

**Detection Logic**:
1. Check HTTP status code for 429
2. Optionally parse response body to distinguish rate limit from quota exceeded
3. Extract Retry-After header if present
4. Default to 15-minute window if no header provided

### Key Rotation Engine

**Purpose**: Orchestrate the rotation process when rate limits are detected.

**Python Implementation**:

```python
def _rotate_api_key(self, retry_after_seconds: int) -> Optional[str]:
    """
    Rotate to next available API key.
    
    Args:
        retry_after_seconds: How long current key should be marked unavailable
        
    Returns:
        Next available API key, or None if all keys exhausted
    """
    current_key = self.api_keys[self.current_key_index]
    current_key_id = self._get_key_id(current_key)
    
    # Mark current key as rate-limited
    expiry_time = datetime.now() + timedelta(seconds=retry_after_seconds)
    self.key_states[current_key_id].is_rate_limited = True
    self.key_states[current_key_id].rate_limit_expiry = expiry_time
    
    logger.warning(
        f"Rate limit detected for key {current_key_id}, "
        f"marked unavailable until {expiry_time.isoformat()}"
    )
    
    # Find next available key
    available_keys = self._get_available_keys()
    
    if not available_keys:
        # All keys exhausted
        earliest_expiry = min(
            state.rate_limit_expiry 
            for state in self.key_states.values() 
            if state.rate_limit_expiry
        )
        logger.error(
            f"All API keys exhausted. Next available: {earliest_expiry.isoformat()}"
        )
        return None
    
    # Select least recently used key
    next_key_id = available_keys[0]
    next_key = self.key_states[next_key_id].key
    
    # Update index
    self.current_key_index = self.api_keys.index(next_key)
    
    # Log rotation
    if len(self.api_keys) > 1:  # Only log if multiple keys
        logger.info(
            f"Rotated API key: {current_key_id} -> {next_key_id}"
        )
    
    return next_key

def _get_available_keys(self) -> List[str]:
    """Get list of available key IDs, sorted by least recently used."""
    now = datetime.now()
    available = []
    
    for key_id, state in self.key_states.items():
        # Auto-expire if time has passed
        if state.is_rate_limited and state.rate_limit_expiry:
            if now >= state.rate_limit_expiry:
                state.is_rate_limited = False
                state.rate_limit_expiry = None
                logger.info(f"Key {key_id} rate limit expired, now available")
        
        if not state.is_rate_limited:
            available.append(key_id)
    
    # Sort by last used (None sorts first, then oldest first)
    available.sort(key=lambda kid: self.key_states[kid].last_used or datetime.min)
    
    return available

def _get_key_id(self, key: str) -> str:
    """Get key identifier (first 8 characters) for logging."""
    return key[:8] if len(key) >= 8 else key
```

**Node.js Implementation**:

```typescript
private rotateApiKey(retryAfterSeconds: number): string | null {
  const currentKey = this.apiKeys[this.currentKeyIndex];
  const currentKeyId = this.getKeyId(currentKey);
  
  // Mark current key as rate-limited
  const expiryTime = new Date(Date.now() + retryAfterSeconds * 1000);
  const state = this.keyStates.get(currentKeyId)!;
  state.isRateLimited = true;
  state.rateLimitExpiry = expiryTime;
  
  console.warn(
    `Rate limit detected for key ${currentKeyId}, ` +
    `marked unavailable until ${expiryTime.toISOString()}`
  );
  
  // Find next available key
  const availableKeys = this.getAvailableKeys();
  
  if (availableKeys.length === 0) {
    // All keys exhausted
    const earliestExpiry = Array.from(this.keyStates.values())
      .filter(s => s.rateLimitExpiry)
      .map(s => s.rateLimitExpiry!)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    
    console.error(
      `All API keys exhausted. Next available: ${earliestExpiry.toISOString()}`
    );
    return null;
  }
  
  // Select least recently used key
  const nextKeyId = availableKeys[0];
  const nextKey = this.keyStates.get(nextKeyId)!.key;
  
  // Update index
  this.currentKeyIndex = this.apiKeys.indexOf(nextKey);
  
  // Log rotation (only if multiple keys)
  if (this.apiKeys.length > 1) {
    console.info(`Rotated API key: ${currentKeyId} -> ${nextKeyId}`);
  }
  
  return nextKey;
}

private getAvailableKeys(): string[] {
  const now = new Date();
  const available: string[] = [];
  
  for (const [keyId, state] of this.keyStates.entries()) {
    // Auto-expire if time has passed
    if (state.isRateLimited && state.rateLimitExpiry) {
      if (now >= state.rateLimitExpiry) {
        state.isRateLimited = false;
        state.rateLimitExpiry = null;
        console.info(`Key ${keyId} rate limit expired, now available`);
      }
    }
    
    if (!state.isRateLimited) {
      available.push(keyId);
    }
  }
  
  // Sort by last used (null sorts first, then oldest first)
  available.sort((a, b) => {
    const aTime = this.keyStates.get(a)!.lastUsed?.getTime() ?? 0;
    const bTime = this.keyStates.get(b)!.lastUsed?.getTime() ?? 0;
    return aTime - bTime;
  });
  
  return available;
}

private getKeyId(key: string): string {
  return key.length >= 8 ? key.substring(0, 8) : key;
}
```

**Rotation Algorithm**:
1. Mark current key as rate-limited with expiry timestamp
2. Query for available keys (auto-expiring stale rate limits)
3. If no keys available, log error and return null
4. Select least recently used available key
5. Update current key index
6. Log rotation event (if multiple keys configured)
7. Return new key for immediate retry

### Request Handler Integration

**Purpose**: Integrate rotation logic into existing request methods.

**Python Integration** (modify `_make_request` method):

```python
async def _make_request(
    self,
    endpoint: str,
    params: Dict[str, Any]
) -> Dict[str, Any]:
    """Make HTTP request with automatic key rotation on rate limit."""
    last_exception = None
    
    for attempt in range(self.max_retries):
        try:
            # Get current API key
            current_key = self.api_keys[self.current_key_index]
            current_key_id = self._get_key_id(current_key)
            params['apikey'] = current_key
            
            # Update usage stats
            self.key_states[current_key_id].total_requests += 1
            self.key_states[current_key_id].last_used = datetime.now()
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(endpoint, params=params)
                
                # Handle rate limiting with rotation
                if response.status_code == 429 and self._is_rate_limit_error(response):
                    retry_after = self._extract_retry_after(response)
                    
                    # Attempt rotation
                    next_key = self._rotate_api_key(retry_after)
                    
                    if next_key is None:
                        # All keys exhausted - graceful degradation
                        logger.warning(
                            "All API keys exhausted, returning empty result set"
                        )
                        return {
                            'status': 'ok',
                            'totalResults': 0,
                            'results': []
                        }
                    
                    # Retry with new key (don't count as retry attempt)
                    continue
                
                # Raise for other HTTP errors
                response.raise_for_status()
                
                # Parse and return JSON
                return response.json()
                
        except httpx.HTTPStatusError as e:
            # Handle non-rate-limit errors
            last_exception = e
            if 400 <= e.response.status_code < 500:
                raise  # Don't retry client errors
            # Retry server errors
            if attempt == self.max_retries - 1:
                raise
            await asyncio.sleep(self.base_backoff * (2 ** attempt))
            
        # ... existing exception handling
```

**Node.js Integration** (modify `makeDirectRequest` method):

```typescript
private async makeDirectRequest(
  url: string,
  endpoint?: string,
  agentName?: string
): Promise<NewsDataResponse> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < this.maxRetries; attempt++) {
    try {
      // Get current API key
      const currentKey = this.apiKeys[this.currentKeyIndex];
      const currentKeyId = this.getKeyId(currentKey);
      
      // Update URL with current key
      const urlWithKey = this.updateUrlApiKey(url, currentKey);
      
      // Update usage stats
      const state = this.keyStates.get(currentKeyId)!;
      state.totalRequests++;
      state.lastUsed = new Date();
      
      const response = await fetch(urlWithKey, this.getHttpConfig());
      
      // Handle rate limiting with rotation
      if (response.status === 429 && this.isRateLimitError(response)) {
        const retryAfter = this.extractRetryAfter(response);
        
        // Attempt rotation
        const nextKey = this.rotateApiKey(retryAfter);
        
        if (nextKey === null) {
          // All keys exhausted - graceful degradation
          console.warn('All API keys exhausted, returning empty result set');
          return {
            status: 'ok',
            totalResults: 0,
            results: []
          };
        }
        
        // Retry with new key (don't count as retry attempt)
        continue;
      }
      
      // Handle other errors
      if (!response.ok) {
        throw new NewsDataError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }
      
      // Parse and return JSON
      const data = await response.json();
      return data as NewsDataResponse;
      
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on client errors
      if (error instanceof NewsDataError) {
        throw error;
      }
      
      // Retry on network errors
      if (attempt === this.maxRetries - 1) {
        throw error;
      }
      
      await this.sleep(this.baseBackoff * Math.pow(2, attempt));
    }
  }
  
  throw lastError || new Error('Request failed after retries');
}

private updateUrlApiKey(url: string, apiKey: string): string {
  const urlObj = new URL(url);
  urlObj.searchParams.set('apikey', apiKey);
  return urlObj.toString();
}
```

**Integration Points**:
- Inject current API key into request parameters
- Update key usage statistics before each request
- Detect rate limit responses
- Trigger rotation and retry with new key
- Return empty results if all keys exhausted
- Maintain existing error handling for non-rate-limit errors

## Data Models

### KeyState Model

**Purpose**: Represent the runtime state of a single API key.

**Python**:
```python
@dataclass
class KeyState:
    """Runtime state for a single API key."""
    key: str                              # Full API key
    key_id: str                           # First 8 chars for logging
    is_rate_limited: bool                 # Currently rate-limited?
    rate_limit_expiry: Optional[datetime] # When rate limit expires
    total_requests: int                   # Lifetime request count
    last_used: Optional[datetime]         # Last request timestamp
```

**TypeScript**:
```typescript
interface KeyState {
  key: string;                    // Full API key
  keyId: string;                  // First 8 chars for logging
  isRateLimited: boolean;         // Currently rate-limited?
  rateLimitExpiry: Date | null;   // When rate limit expires
  totalRequests: number;          // Lifetime request count
  lastUsed: Date | null;          // Last request timestamp
}
```

**Field Descriptions**:
- `key`: The complete API key string used in requests
- `key_id`: Truncated identifier for safe logging (first 8 characters)
- `is_rate_limited`: Boolean flag indicating if key is currently unavailable
- `rate_limit_expiry`: Timestamp when the key becomes available again (null if not rate-limited)
- `total_requests`: Counter for observability and debugging
- `last_used`: Timestamp of most recent use, for LRU selection

### Configuration Model

**Python** (extends existing `__init__` parameters):
```python
# No new external parameters - uses existing api_key parameter
# Internally parses comma-separated keys
```

**TypeScript** (extends existing `NewsDataConfig` interface):
```typescript
// No changes to NewsDataConfig interface
// Internally parses comma-separated keys from config.apiKey
```

The design intentionally avoids adding new configuration parameters to maintain backward compatibility. The existing `api_key` parameter accepts both single keys and comma-separated lists.

## Algorithms

### LRU Key Selection Algorithm

**Purpose**: Select the least recently used available key to distribute load evenly.

**Pseudocode**:
```
function selectNextKey():
  available_keys = []
  current_time = now()
  
  for each key_state in key_states:
    // Auto-expire stale rate limits
    if key_state.is_rate_limited and key_state.rate_limit_expiry:
      if current_time >= key_state.rate_limit_expiry:
        key_state.is_rate_limited = false
        key_state.rate_limit_expiry = null
        log("Key {key_id} rate limit expired")
    
    // Collect available keys
    if not key_state.is_rate_limited:
      available_keys.append(key_state)
  
  if available_keys is empty:
    return null  // All keys exhausted
  
  // Sort by last_used timestamp (null first, then oldest)
  sort available_keys by last_used ascending
  
  return available_keys[0].key
```

**Time Complexity**: O(n log n) where n is the number of keys (due to sorting)
**Space Complexity**: O(n) for the available keys list

**Optimization Note**: For typical deployments with 2-5 keys, the sorting overhead is negligible. If needed, this could be optimized to O(n) by tracking the LRU key directly.

### Rate Limit Detection Algorithm

**Purpose**: Distinguish between rate limit errors and other 429 responses.

**Pseudocode**:
```
function isRateLimitError(response):
  if response.status_code != 429:
    return false
  
  // Try to parse response body
  try:
    body = response.json()
    
    // Check for quota exceeded vs rate limit
    if body contains error message:
      message = body.error_message.lowercase()
      
      // Quota exceeded: daily limit reached (permanent until reset)
      if "quota exceeded" in message or "daily limit" in message:
        return false
      
      // Rate limit: temporary throttling (will reset)
      if "rate limit" in message or "too many requests" in message:
        return true
  
  catch parsing_error:
    // If we can't parse, assume rate limit
    pass
  
  // Default: treat all 429 as rate limit
  return true
```

**Rationale**: NewsData API may return 429 for both temporary rate limiting and daily quota exhaustion. We attempt to distinguish these by parsing the error message, but default to treating all 429s as rate limits (which triggers rotation).

### Graceful Degradation Algorithm

**Purpose**: Handle the case when all API keys are exhausted without crashing.

**Pseudocode**:
```
function handleAllKeysExhausted():
  // Find earliest expiry time
  expiry_times = [
    state.rate_limit_expiry 
    for state in key_states.values() 
    if state.rate_limit_expiry is not null
  ]
  
  earliest_expiry = min(expiry_times)
  
  // Log error with recovery time
  log_error(
    "All API keys exhausted. " +
    "Next available: {earliest_expiry.isoformat()}"
  )
  
  // Return empty result set (not an error)
  return {
    status: "ok",
    totalResults: 0,
    results: []
  }
```

**Design Decision**: Returning an empty result set instead of throwing an error allows the workflow to continue. Agents that receive empty news data will simply have no news-based signals, but other agents can still contribute to the analysis.


## Error Handling

### Configuration Errors

**Scenario**: Invalid or missing API key configuration

**Handling**:
- **Empty key list**: Throw `ValueError` (Python) or `Error` (TypeScript) during initialization
- **All whitespace keys**: Filtered out during parsing; if none remain, throw configuration error
- **Missing environment variable**: Throw configuration error with helpful message

**Example Error Messages**:
```
Python: "At least one API key must be provided in NEWSDATA_API_KEY"
Node.js: "At least one API key must be provided in NEWSDATA_API_KEY"
```

**Recovery**: None - this is a fatal configuration error that must be fixed before startup

### Rate Limit Errors

**Scenario**: API returns HTTP 429 indicating rate limit exceeded

**Handling**:
1. Extract Retry-After header (default to 900 seconds if missing)
2. Mark current key as rate-limited with expiry timestamp
3. Attempt to rotate to next available key
4. If rotation succeeds, retry request immediately with new key
5. If all keys exhausted, return empty result set (graceful degradation)

**Logging**:
```
WARNING: Rate limit detected for key abc12345, marked unavailable until 2024-01-15T10:30:00Z
INFO: Rotated API key: abc12345 -> def67890
```

**Recovery**: Automatic via key rotation or graceful degradation

### Network Errors

**Scenario**: Connection failures, timeouts, DNS errors

**Handling**:
- Maintain existing retry logic with exponential backoff
- Do NOT trigger key rotation (these are not rate limit errors)
- After max retries, propagate error to caller

**Logging**:
```
ERROR: NewsData API request timeout after 3 attempts
```

**Recovery**: Existing retry mechanism with exponential backoff

### HTTP Errors (Non-429)

**Scenario**: 4xx client errors (400, 401, 403, 404) or 5xx server errors

**Handling**:
- **4xx errors**: Do not retry, throw immediately (likely configuration or API issue)
- **5xx errors**: Retry with exponential backoff (temporary server issue)
- Do NOT trigger key rotation for these errors

**Logging**:
```
ERROR: NewsData API returned 401 Unauthorized - check API key validity
ERROR: NewsData API returned 503 Service Unavailable - retrying in 2s
```

**Recovery**: 
- 4xx: None - requires manual intervention
- 5xx: Automatic retry with backoff

### JSON Parsing Errors

**Scenario**: API returns malformed JSON or unexpected response structure

**Handling**:
- Do not retry (parsing errors are not transient)
- Throw `ValueError` (Python) or `Error` (TypeScript) immediately
- Include original response in error message for debugging

**Logging**:
```
ERROR: Failed to parse NewsData API response: Unexpected token < in JSON at position 0
```

**Recovery**: None - indicates API issue or breaking change

### All Keys Exhausted

**Scenario**: All configured API keys are rate-limited simultaneously

**Handling**:
1. Calculate earliest expiry time across all keys
2. Log error message with recovery time
3. Return empty result set: `{status: "ok", totalResults: 0, results: []}`
4. Do NOT throw error or crash workflow

**Logging**:
```
ERROR: All API keys exhausted. Next available: 2024-01-15T10:45:00Z
WARNING: All API keys exhausted, returning empty result set
```

**Recovery**: Automatic when first key expires; workflow continues with empty data

### Error Propagation Strategy

The feature follows a layered error handling approach:

1. **Configuration Layer**: Fail fast on invalid configuration (startup errors)
2. **Request Layer**: Retry transient errors, rotate on rate limits
3. **Client Layer**: Return empty results on exhaustion, propagate fatal errors
4. **Workflow Layer**: Continue execution with empty data (graceful degradation)

This ensures that rate limit issues do not crash the entire multi-agent workflow, while still surfacing genuine errors that require attention.


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Configuration Parsing and Validation

For any comma-separated string of API keys (with arbitrary whitespace), parsing should produce a list of trimmed, non-empty keys, and reject configurations with no valid keys.

**Validates: Requirements 1.1, 1.2, 1.3, 1.5**

### Property 2: Retry-After Header Extraction

For any HTTP 429 response with a Retry-After header containing a valid integer, the extracted value should equal the header value in seconds.

**Validates: Requirements 2.3**

### Property 3: Rate Limit State Transition

For any API key, when a rate limit error is detected, the key's state should transition to rate-limited with an expiry timestamp set to current time plus the retry-after duration.

**Validates: Requirements 3.1**

### Property 4: Available Key Selection

For any list of configured keys where at least one is not rate-limited, selecting the next key should return a key that is not currently marked as rate-limited.

**Validates: Requirements 3.2, 3.3**

### Property 5: Retry-After Expiry Timing

For any API key marked as rate-limited with a specific Retry-After value, the key should remain unavailable for exactly that duration and become available again once the time has elapsed.

**Validates: Requirements 3.4, 4.3**

### Property 6: Request Retry After Rotation

For any request that fails with a rate limit error, if key rotation succeeds (returns a new key), the request should be retried immediately with the new key without counting against the retry limit.

**Validates: Requirements 3.6**

### Property 7: Key State Completeness

For any configured API key, there should exist a corresponding state record containing all required fields: key identifier, rate limit status, expiry timestamp, total requests, and last used timestamp.

**Validates: Requirements 4.1, 4.2**

### Property 8: LRU Key Selection

For any set of available (non-rate-limited) keys, the selected key should be the one with the oldest last-used timestamp (or never used).

**Validates: Requirements 4.4**

### Property 9: Graceful Degradation on Exhaustion

For any configuration where all API keys are currently rate-limited, making a request should return an empty result set `{status: "ok", totalResults: 0, results: []}` instead of throwing an error.

**Validates: Requirements 5.1**

### Property 10: Workflow Continuation

For any workflow execution where all API keys are exhausted, the workflow should continue to completion without crashing, using empty news data for affected agents.

**Validates: Requirements 5.4, 5.5**

### Property 11: Backward Compatibility

For any existing code that uses the NewsDataClient with a single API key, all method signatures and return types should remain unchanged and function identically to the pre-rotation implementation.

**Validates: Requirements 7.5, 8.5**

### Property 12: Rotation Event Logging

For any key rotation that occurs, the log should contain the old key identifier, new key identifier, and reason for rotation (rate limit detected).

**Validates: Requirements 3.7, 9.2**

### Property 13: Rate Limit Detection Logging

For any rate limit error detected, the system should log a WARNING level message containing the affected key identifier and the expiry timestamp.

**Validates: Requirements 2.4, 9.1**

### Property 14: Key Availability Logging

For any rate-limited key whose expiry time has passed, when the key is checked for availability, the system should log an INFO level message indicating the key is now available.

**Validates: Requirements 9.4**

### Property 15: Context-Rich Logging

For any rotation-related log message, the log should include request context such as endpoint, agent name (if provided), and relevant parameters.

**Validates: Requirements 9.5**

### Property 16: Observability Integration

For any key rotation event, the system should emit metrics to the configured observability system (Opik/audit logger) including key identifiers, rotation count, and timestamp.

**Validates: Requirements 9.6**


## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests to ensure comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs using randomized testing

Both approaches are complementary and necessary. Unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across a wide range of inputs.

### Property-Based Testing

**Framework Selection**:
- **Python**: Hypothesis library for property-based testing
- **Node.js**: fast-check library for property-based testing

**Configuration**:
- Minimum 100 iterations per property test (due to randomization)
- Each property test must reference its design document property
- Tag format: `Feature: newsdata-multi-key-rotation, Property {number}: {property_text}`

**Property Test Coverage**:

1. **Configuration Parsing (Property 1)**:
   - Generate random lists of API keys with varying whitespace
   - Verify parsing produces correct trimmed list
   - Generate invalid inputs (empty, all whitespace) and verify rejection

2. **Retry-After Extraction (Property 2)**:
   - Generate random integer values for Retry-After header
   - Verify extracted value matches header value
   - Test missing header defaults to 900 seconds

3. **State Transitions (Property 3)**:
   - Generate random API keys and retry-after durations
   - Verify state transitions to rate-limited with correct expiry
   - Verify state includes all required fields

4. **Key Selection (Property 4, 8)**:
   - Generate random key lists with mixed rate-limit states
   - Verify selected key is always available
   - Verify LRU selection when multiple keys available

5. **Expiry Timing (Property 5)**:
   - Generate random expiry durations
   - Verify keys remain unavailable for exact duration
   - Verify keys become available after expiry

6. **Request Retry (Property 6)**:
   - Generate random request parameters
   - Simulate rate limit on first attempt
   - Verify retry occurs with new key

7. **Graceful Degradation (Property 9, 10)**:
   - Generate configurations where all keys are exhausted
   - Verify empty result set returned
   - Verify no exceptions thrown

8. **Backward Compatibility (Property 11)**:
   - Generate random single-key configurations
   - Verify all methods work identically to original implementation
   - Verify method signatures unchanged

9. **Logging Properties (Properties 12-16)**:
   - Generate random rotation scenarios
   - Verify all required log fields present
   - Verify correct log levels used
   - Verify observability integration called

**Example Property Test (Python)**:

```python
from hypothesis import given, strategies as st
import pytest

# Feature: newsdata-multi-key-rotation, Property 1: Configuration parsing
@given(
    keys=st.lists(
        st.text(alphabet=st.characters(whitelist_categories=('Lu', 'Ll', 'Nd')), 
                min_size=8, max_size=32),
        min_size=1,
        max_size=10
    ),
    whitespace=st.lists(st.sampled_from(['', ' ', '  ', '\t', '\n']), min_size=1)
)
def test_config_parsing_property(keys, whitespace):
    """For any list of keys with arbitrary whitespace, parsing should produce trimmed keys."""
    # Add random whitespace to keys
    keys_with_whitespace = [
        f"{whitespace[i % len(whitespace)]}{key}{whitespace[(i+1) % len(whitespace)]}"
        for i, key in enumerate(keys)
    ]
    
    # Join with commas
    config_string = ','.join(keys_with_whitespace)
    
    # Parse
    client = NewsDataClient(api_key=config_string)
    
    # Verify: parsed keys should equal original keys (trimmed)
    assert len(client.api_keys) == len(keys)
    assert all(parsed == original.strip() for parsed, original in zip(client.api_keys, keys))
```

**Example Property Test (TypeScript)**:

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// Feature: newsdata-multi-key-rotation, Property 1: Configuration parsing
describe('NewsDataClient Configuration', () => {
  it('should parse comma-separated keys with arbitrary whitespace', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 8, maxLength: 32 }), { minLength: 1, maxLength: 10 }),
        fc.array(fc.constantFrom('', ' ', '  ', '\t', '\n'), { minLength: 1 }),
        (keys, whitespace) => {
          // Add random whitespace to keys
          const keysWithWhitespace = keys.map((key, i) => 
            `${whitespace[i % whitespace.length]}${key}${whitespace[(i + 1) % whitespace.length]}`
          );
          
          // Join with commas
          const configString = keysWithWhitespace.join(',');
          
          // Parse
          const client = new NewsDataClient({ apiKey: configString });
          
          // Verify: parsed keys should equal original keys (trimmed)
          expect(client['apiKeys'].length).toBe(keys.length);
          client['apiKeys'].forEach((parsed, i) => {
            expect(parsed).toBe(keys[i].trim());
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Testing

Unit tests focus on specific examples, edge cases, and integration scenarios:

**Configuration Tests**:
- Single key configuration (backward compatibility)
- Multiple keys with various whitespace patterns
- Empty string configuration (should throw)
- All whitespace configuration (should throw)
- Keys with special characters

**Rate Limit Detection Tests**:
- HTTP 429 with Retry-After header
- HTTP 429 without Retry-After header (default to 900s)
- HTTP 429 with rate limit message in body
- HTTP 429 with quota exceeded message in body
- Non-429 errors (should not trigger rotation)

**Key Rotation Tests**:
- Rotation with 2 keys
- Rotation with 5 keys
- Rotation when all keys exhausted
- Rotation with expired keys (auto-recovery)
- Multiple consecutive rotations

**State Management Tests**:
- Initial state after configuration
- State updates after requests
- State updates after rate limits
- State expiry and auto-recovery
- LRU selection with various usage patterns

**Graceful Degradation Tests**:
- All keys exhausted returns empty results
- Workflow continues with empty results
- Monitor service continues running
- Earliest expiry time calculated correctly

**Backward Compatibility Tests**:
- Single key behaves identically to old implementation
- No rotation logs with single key
- All existing method signatures work
- All existing return types unchanged

**Integration Tests**:
- Mock NewsData API with rate limit responses
- Simulate multi-key rotation scenario
- Verify request retry with new key
- Verify observability integration
- End-to-end workflow with key exhaustion

**Example Unit Test (Python)**:

```python
import pytest
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

def test_single_key_backward_compatibility():
    """Single key configuration should work identically to original implementation."""
    client = NewsDataClient(api_key="test_key_12345678")
    
    assert len(client.api_keys) == 1
    assert client.api_keys[0] == "test_key_12345678"
    assert len(client.key_states) == 1

def test_all_keys_exhausted_returns_empty():
    """When all keys are exhausted, should return empty result set."""
    client = NewsDataClient(api_key="key1,key2,key3")
    
    # Mark all keys as rate-limited
    for key_id in client.key_states:
        client.key_states[key_id].is_rate_limited = True
        client.key_states[key_id].rate_limit_expiry = datetime.now() + timedelta(minutes=15)
    
    # Attempt rotation
    next_key = client._rotate_api_key(900)
    
    assert next_key is None

@patch('httpx.AsyncClient')
async def test_rate_limit_triggers_rotation(mock_client):
    """Rate limit response should trigger key rotation."""
    client = NewsDataClient(api_key="key1,key2")
    
    # Mock 429 response
    mock_response = Mock()
    mock_response.status_code = 429
    mock_response.headers = {'Retry-After': '900'}
    
    mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
    
    # Make request
    with pytest.raises(Exception):  # Will eventually fail after retries
        await client._make_request("https://api.newsdata.io/api/1/latest", {})
    
    # Verify rotation occurred
    assert client.current_key_index == 1
```

**Example Unit Test (TypeScript)**:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NewsDataClient } from './newsdata-client';

describe('NewsDataClient Multi-Key Rotation', () => {
  it('should support single key for backward compatibility', () => {
    const client = new NewsDataClient({ apiKey: 'test_key_12345678' });
    
    expect(client['apiKeys'].length).toBe(1);
    expect(client['apiKeys'][0]).toBe('test_key_12345678');
    expect(client['keyStates'].size).toBe(1);
  });
  
  it('should return empty results when all keys exhausted', () => {
    const client = new NewsDataClient({ apiKey: 'key1,key2,key3' });
    
    // Mark all keys as rate-limited
    for (const [keyId, state] of client['keyStates'].entries()) {
      state.isRateLimited = true;
      state.rateLimitExpiry = new Date(Date.now() + 15 * 60 * 1000);
    }
    
    // Attempt rotation
    const nextKey = client['rotateApiKey'](900);
    
    expect(nextKey).toBeNull();
  });
  
  it('should trigger rotation on rate limit', async () => {
    const client = new NewsDataClient({ apiKey: 'key1,key2' });
    
    // Mock fetch to return 429
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 429,
      headers: new Headers({ 'Retry-After': '900' }),
      ok: false
    });
    
    // Make request (will trigger rotation)
    try {
      await client['makeDirectRequest']('https://api.newsdata.io/api/1/latest');
    } catch (error) {
      // Expected to fail eventually
    }
    
    // Verify rotation occurred
    expect(client['currentKeyIndex']).toBe(1);
  });
});
```

### Test Organization

**Python** (`doa/tools/test_newsdata_client.py`):
```
test_newsdata_client.py
├── Configuration Tests
│   ├── test_single_key_config
│   ├── test_multi_key_config
│   ├── test_empty_config_raises_error
│   └── test_whitespace_trimming
├── Rate Limit Detection Tests
│   ├── test_429_detected_as_rate_limit
│   ├── test_retry_after_extraction
│   └── test_quota_vs_rate_limit_distinction
├── Key Rotation Tests
│   ├── test_rotation_marks_key_unavailable
│   ├── test_rotation_selects_next_key
│   ├── test_rotation_with_all_keys_exhausted
│   └── test_lru_selection
├── State Management Tests
│   ├── test_initial_state
│   ├── test_state_updates_on_use
│   └── test_auto_expiry
├── Graceful Degradation Tests
│   ├── test_empty_results_on_exhaustion
│   └── test_workflow_continues
└── Property Tests
    ├── test_config_parsing_property
    ├── test_key_selection_property
    └── test_expiry_timing_property
```

**TypeScript** (`tradewizard-agents/src/utils/newsdata-client.test.ts`):
```
newsdata-client.test.ts
├── Configuration Tests
│   ├── should support single key
│   ├── should parse multiple keys
│   ├── should throw on empty config
│   └── should trim whitespace
├── Rate Limit Detection Tests
│   ├── should detect 429 as rate limit
│   ├── should extract Retry-After header
│   └── should distinguish quota vs rate limit
├── Key Rotation Tests
│   ├── should mark key unavailable on rate limit
│   ├── should select next available key
│   ├── should handle all keys exhausted
│   └── should use LRU selection
├── State Management Tests
│   ├── should initialize state correctly
│   ├── should update state on use
│   └── should auto-expire rate limits
├── Graceful Degradation Tests
│   ├── should return empty results on exhaustion
│   └── should allow workflow to continue
└── Property Tests
    ├── should parse config with arbitrary whitespace
    ├── should select available keys
    └── should respect expiry timing
```

### Testing Priorities

1. **Critical Path**: Configuration parsing, rate limit detection, key rotation
2. **High Priority**: State management, graceful degradation, backward compatibility
3. **Medium Priority**: Logging, observability integration
4. **Low Priority**: Edge cases with unusual whitespace patterns

### Mocking Strategy

**External Dependencies to Mock**:
- HTTP client (httpx in Python, fetch in Node.js)
- Time functions (for testing expiry logic)
- Logging systems (to verify log messages)
- Observability systems (Opik, audit logger)

**Mock Scenarios**:
- 429 responses with various Retry-After values
- 429 responses without Retry-After header
- Network errors and timeouts
- Successful responses after rotation
- Multiple consecutive rate limits

### Continuous Integration

All tests should run in CI/CD pipeline:
- Unit tests: Run on every commit
- Property tests: Run on every commit (100 iterations minimum)
- Integration tests: Run on every PR
- Coverage target: 90%+ for new code

