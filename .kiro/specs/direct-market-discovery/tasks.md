# Implementation Plan: Direct Market Discovery

## Overview

This implementation refactors the market discovery system to fetch markets directly from the Polymarket `/markets` API endpoint instead of fetching events and extracting markets. The work is split between backend (tradewizard-agents) and frontend (tradewizard-frontend) changes, with comprehensive testing for both.

## Tasks

- [x] 1. Backend: Implement direct market fetching
  - [x] 1.1 Create `fetchTrendingMarketsDirectly()` method in `PolymarketDiscoveryEngine`
    - Replace event-based fetching with direct `/markets` endpoint call
    - Build URL with query parameters: `closed=false&order=volume24hr&ascending=false&tag_id&limit&offset`
    - Implement 15-second timeout using `AbortSignal.timeout(15000)`
    - Parse and validate API response as array of markets
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.2 Create `enrichMarketWithEventContext()` helper method
    - Check if market has non-empty `events` array
    - Extract event metadata from first event: `title`, `slug`, `id`, `image/icon`
    - Populate market fields: `eventTitle`, `eventSlug`, `eventId`, `eventIcon`
    - Handle markets without event context gracefully
    - Map field names for backend compatibility (`conditionId`, `condition_id`, etc.)
    - _Requirements: 1.4, 3.1, 3.2, 3.3_
  
  - [x] 1.3 Implement filtering logic in `fetchTrendingMarketsDirectly()`
    - Filter out markets where `acceptingOrders === false`
    - Filter out markets without `clobTokenIds`
    - Validate tradeable prices (at least one price between 0.05 and 0.95)
    - Apply liquidity thresholds: $1,000 for evergreen tags, $5,000 otherwise
    - Use evergreen tag IDs: [2, 21, 120, 596, 1401, 100265, 100639]
    - _Requirements: 1.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  
  - [x] 1.4 Implement sorting logic in `fetchTrendingMarketsDirectly()`
    - Sort open markets by combined score (liquidity + volume24hr) descending
    - Sort closed markets by end date (most recent first), then by volume
    - Prioritize open markets over closed markets in mixed arrays
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 1.5 Implement error handling and retry logic
    - Throw descriptive errors for non-200 status codes
    - Throw error for invalid response structure (non-array)
    - Skip markets with invalid JSON in fields, continue processing
    - Implement exponential backoff retry (max 3 attempts) for transient failures
    - Do not retry on 400 or 404 errors
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 1.6 Update `fetchPoliticalMarkets()` to use new method
    - Replace call to `fetchTrendingMarketsFromEvents()` with `fetchTrendingMarketsDirectly()`
    - Maintain same return type and interface
    - Add logging for metrics (markets received, valid markets, final sorted)
    - _Requirements: 1.1, 9.1, 9.2_

- [ ]* 2. Backend: Write property tests for market discovery
  - [ ]* 2.1 Write property test for URL construction
    - **Property 1: URL Construction with Required Parameters**
    - Generate random query parameters
    - Verify all parameters appear in constructed URL
    - **Validates: Requirements 1.2, 2.2**
  
  - [ ]* 2.2 Write property test for event context enrichment
    - **Property 2: Event Context Enrichment**
    - Generate markets with random events arrays
    - Verify event metadata is extracted correctly
    - **Validates: Requirements 3.1, 3.2**
  
  - [ ]* 2.3 Write property test for missing event context
    - **Property 3: Missing Event Context Handling**
    - Generate markets without events arrays
    - Verify event fields remain undefined/null
    - **Validates: Requirements 1.4, 3.3**
  
  - [ ]* 2.4 Write property test for tradeable price validation
    - **Property 9: Tradeable Price Validation**
    - Generate markets with random price arrays
    - Verify filtering based on 0.05-0.95 range
    - **Validates: Requirements 5.3**
  
  - [ ]* 2.5 Write property test for liquidity threshold filtering
    - **Property 10: Liquidity Threshold Filtering**
    - Generate markets with random liquidity and tags
    - Verify $1,000 threshold for evergreen, $5,000 for others
    - **Validates: Requirements 5.4, 5.5**
  
  - [ ]* 2.6 Write property test for open market sorting
    - **Property 11: Open Market Sorting**
    - Generate random open markets with various scores
    - Verify descending order by combined score
    - **Validates: Requirements 6.1**
  
  - [ ]* 2.7 Write property test for closed market sorting
    - **Property 12: Closed Market Sorting**
    - Generate random closed markets with dates and volumes
    - Verify sorting by end date, then volume
    - **Validates: Requirements 6.2**
  
  - [ ]* 2.8 Write property test for mixed market sorting
    - **Property 13: Mixed Market Sorting Precedence**
    - Generate mixed open and closed markets
    - Verify open markets appear before closed markets
    - **Validates: Requirements 6.3**

- [ ]* 3. Backend: Write unit tests for market discovery
  - [ ]* 3.1 Write unit tests for specific examples
    - Test fetching with known query parameters
    - Test enriching market with specific event data
    - Test filtering market with specific liquidity values
    - _Requirements: 1.1, 1.2, 3.1, 5.4_
  
  - [ ]* 3.2 Write unit tests for edge cases
    - Test empty markets array from API
    - Test market with missing optional fields
    - Test market with malformed JSON in outcomePrices
    - Test API returning exactly requested limit (pagination boundary)
    - _Requirements: 7.3, 8.2_
  
  - [ ]* 3.3 Write unit tests for error conditions
    - Test API returning 404 error (no retry)
    - Test API returning 500 error (with retry)
    - Test network timeout (with retry)
    - Test invalid response structure (object instead of array)
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

- [x] 4. Checkpoint - Backend implementation complete
  - Ensure all backend tests pass
  - Verify direct market fetching works with real Polymarket API
  - Ask the user if questions arise

- [x] 5. Frontend: Update API proxy to use direct market endpoint
  - [x] 5.1 Modify GET handler in `app/api/polymarket/markets/route.ts`
    - Change URL from `/events` to `/markets` endpoint
    - Build URL with parameters: `closed`, `order`, `ascending`, `tag_id`, `limit`, `offset`
    - Map `include_closed` parameter to `closed` in Gamma API request
    - Support `order` parameter from query string (default to `volume24hr`)
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 4.5_
  
  - [x] 5.2 Implement event context enrichment in API proxy
    - Map over markets array after receiving API response
    - Check each market for non-empty `events` array
    - Extract event metadata and add to market object
    - Handle markets without events gracefully
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [x] 5.3 Maintain filtering logic in API proxy
    - Keep existing filtering for `clobTokenIds`, `acceptingOrders`, tradeable prices
    - Keep liquidity threshold logic (evergreen tags vs. non-evergreen)
    - Apply same evergreen tag IDs constant
    - Handle closed markets with relaxed validation
    - _Requirements: 2.5, 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 5.4 Maintain sorting logic in API proxy
    - Keep existing sorting for open markets (liquidity + volume score)
    - Keep existing sorting for closed markets (end date, then volume)
    - Keep precedence of open over closed markets
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 5.5 Maintain pagination logic in API proxy
    - Keep over-fetching strategy (3x requested limit)
    - Apply client-side pagination after filtering and sorting
    - Return slice of results based on requested offset and limit
    - _Requirements: 8.1, 8.4_
  
  - [x] 5.6 Update error handling in API proxy
    - Return 500 status with error message for Gamma API errors
    - Return 500 status for invalid response structure
    - Log errors to console for debugging
    - _Requirements: 7.1, 7.2_

- [ ]* 6. Frontend: Write property tests for API proxy
  - [ ]* 6.1 Write property test for parameter mapping
    - **Property 4: Market Status Parameter Mapping**
    - Generate random market status values
    - Verify correct `closed` parameter in URL
    - **Validates: Requirements 2.3, 4.4, 4.5**
  
  - [ ]* 6.2 Write property test for category tag mapping
    - **Property 5: Category Tag Parameter Mapping**
    - Generate random categories with tag IDs
    - Verify correct `tag_id` parameter in URL
    - **Validates: Requirements 4.3**
  
  - [ ]* 6.3 Write property test for filtering consistency
    - **Property 6: Filtering Consistency**
    - Generate random markets
    - Verify filtering produces same results as backend
    - **Validates: Requirements 1.5, 2.5, 9.4**
  
  - [ ]* 6.4 Write property test for pagination parameter forwarding
    - **Property 19: Pagination Parameter Forwarding**
    - Generate random limit and offset values
    - Verify parameters are forwarded with correct multipliers
    - **Validates: Requirements 8.1**
  
  - [ ]* 6.5 Write property test for over-fetching strategy
    - **Property 22: Over-Fetching Strategy**
    - Generate random limit values
    - Verify fetch limit is at least 3x requested limit
    - **Validates: Requirements 8.4**

- [ ]* 7. Frontend: Write unit tests for API proxy
  - [ ]* 7.1 Write unit tests for specific query parameters
    - Test trending markets request (order=volume24hr)
    - Test all markets request (order=liquidity)
    - Test closed markets request (closed=true)
    - _Requirements: 4.1, 4.2, 4.4_
  
  - [ ]* 7.2 Write unit tests for event enrichment
    - Test market with events array
    - Test market without events array
    - Test market with empty events array
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [ ]* 7.3 Write unit tests for error handling
    - Test Gamma API returning error status
    - Test invalid response structure
    - Test network error
    - _Requirements: 7.1, 7.2_

- [ ] 8. Frontend: Update market search utility (optional)
  - [ ] 8.1 Review `lib/market-search.ts` for compatibility
    - Verify `findMarketBySlug()` works with new API proxy
    - Keep event-based fallback search for backward compatibility
    - Test with various slug formats (ID, slug, event slug)
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 9. Checkpoint - Frontend implementation complete
  - Ensure all frontend tests pass
  - Test API proxy with real Polymarket API
  - Verify UI displays markets correctly with and without event context
  - Ask the user if questions arise

- [x] 10. Integration testing and validation
  - [x] 10.1 Test backend with real Polymarket API
    - Fetch trending markets and verify results
    - Verify event context enrichment works
    - Verify filtering removes invalid markets
    - Verify sorting produces expected order
    - _Requirements: 1.1, 1.5, 3.1, 6.1_
  
  - [x] 10.2 Test frontend with real Polymarket API
    - Load markets in browser and verify display
    - Test pagination (infinite scroll)
    - Test filtering by category
    - Test closed markets view
    - _Requirements: 2.1, 8.2, 8.3_
  
  - [x] 10.3 Compare results with old implementation
    - Run both implementations side-by-side
    - Verify same markets are returned
    - Verify same filtering and sorting behavior
    - Document any differences
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [x] 10.4 Performance benchmarking
    - Measure API response times (old vs. new)
    - Measure total processing time
    - Measure memory usage
    - Document performance improvements
    - _Requirements: 10.1, 10.2_

- [x] 11. Documentation and cleanup
  - [x] 11.1 Update code comments
    - Document event enrichment logic
    - Document filtering thresholds and constants
    - Document retry strategy and backoff calculation
    - Document pagination over-fetching strategy
  
  - [x] 11.2 Update README and documentation
    - Update API endpoint references
    - Update architecture diagrams
    - Update developer guide with new examples
    - Document migration from old to new implementation
  
  - [x] 11.3 Remove old event-based implementation (if applicable)
    - Archive `fetchTrendingMarketsFromEvents()` method
    - Remove unused event processing code
    - Clean up imports and dependencies

- [ ] 12. Final checkpoint - Implementation complete
  - Ensure all tests pass (unit and property tests)
  - Verify integration with real Polymarket API
  - Confirm performance improvements
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Backend uses TypeScript with Node.js and fast-check for property testing
- Frontend uses TypeScript with Next.js and fast-check for property testing
- Both implementations maintain backward compatibility with existing code
