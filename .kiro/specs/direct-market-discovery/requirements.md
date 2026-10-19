# Requirements Document: Direct Market Discovery

## Introduction

This feature refactors the market discovery process to fetch trending markets directly from the Polymarket `/markets` API endpoint instead of fetching events and extracting markets from them. The change simplifies the codebase, reduces API complexity, and potentially improves performance by eliminating the need to process nested event structures.

## Glossary

- **Market**: A prediction market on Polymarket with binary or multi-outcome questions
- **Event**: A container grouping related markets (e.g., "2024 Presidential Election" event contains multiple markets)
- **Gamma_API**: Polymarket's public API for market data (https://gamma-api.polymarket.com)
- **CLOB**: Central Limit Order Book - Polymarket's trading infrastructure
- **Backend**: The tradewizard-agents Node.js application
- **Frontend**: The tradewizard-frontend Next.js web application
- **Market_Discovery_Engine**: Backend service responsible for finding and ranking markets
- **API_Proxy**: Frontend Next.js API route that proxies requests to Polymarket
- **Evergreen_Tag**: Special market tags (politics, elections, etc.) that allow lower liquidity thresholds
- **Tradeable_Price**: Market price between 0.05 and 0.95 (5% to 95%)

## Requirements

### Requirement 1: Backend Market Discovery Refactoring

**User Story:** As a backend developer, I want to fetch markets directly from the `/markets` endpoint, so that the code is simpler and more maintainable.

#### Acceptance Criteria

1. WHEN the Backend fetches trending markets, THE Market_Discovery_Engine SHALL call the `/markets` endpoint with appropriate query parameters
2. WHEN constructing the API URL, THE Market_Discovery_Engine SHALL include `closed=false`, `order=volume24hr`, `ascending=false`, `tag_id`, `limit`, and `offset` parameters
3. WHEN processing the API response, THE Market_Discovery_Engine SHALL handle markets directly without extracting from event structures
4. WHEN a market lacks event context, THE Market_Discovery_Engine SHALL gracefully handle missing `eventTitle`, `eventSlug`, `eventId`, and `eventIcon` fields
5. THE Market_Discovery_Engine SHALL maintain backward compatibility with existing market filtering logic (liquidity thresholds, evergreen tags, tradeable prices)

### Requirement 2: Frontend API Proxy Refactoring

**User Story:** As a frontend developer, I want the API proxy to fetch markets directly, so that the application loads faster and uses fewer resources.

#### Acceptance Criteria

1. WHEN the Frontend requests markets, THE API_Proxy SHALL call the `/markets` endpoint instead of `/events`
2. WHEN constructing the API URL, THE API_Proxy SHALL include `closed`, `order`, `ascending`, `tag_id`, `limit`, and `offset` parameters
3. WHEN the `include_closed` parameter is true, THE API_Proxy SHALL set `closed=true` in the Gamma_API request
4. WHEN processing the API response, THE API_Proxy SHALL handle markets directly without extracting from event structures
5. THE API_Proxy SHALL maintain the same filtering logic for liquidity thresholds, evergreen tags, and tradeable prices

### Requirement 3: Event Context Enrichment

**User Story:** As a user, I want to see event context for markets when available, so that I understand the broader context of each prediction.

#### Acceptance Criteria

1. WHEN a market includes an `events` array in the API response, THE System SHALL extract event metadata from the first event
2. WHEN enriching market data, THE System SHALL populate `eventTitle`, `eventSlug`, `eventId`, and `eventIcon` fields from the event
3. WHEN a market has no associated events, THE System SHALL leave event context fields undefined or null
4. WHEN displaying markets in the UI, THE Frontend SHALL gracefully handle markets with or without event context

### Requirement 4: Query Parameter Mapping

**User Story:** As a developer, I want consistent query parameter handling, so that the API behaves predictably across different use cases.

#### Acceptance Criteria

1. WHEN the Frontend requests trending markets, THE System SHALL use `order=volume24hr&ascending=false`
2. WHEN the Frontend requests all markets, THE System SHALL use `order=liquidity&ascending=false`
3. WHEN filtering by category, THE System SHALL include the appropriate `tag_id` parameter
4. WHEN the `marketStatus` is "closed" or "all", THE System SHALL include `closed=true` in the API request
5. WHEN the `marketStatus` is "active", THE System SHALL include `closed=false` in the API request

### Requirement 5: Filtering and Validation Consistency

**User Story:** As a system architect, I want consistent market filtering across backend and frontend, so that users see the same quality markets regardless of entry point.

#### Acceptance Criteria

1. THE System SHALL filter out markets where `acceptingOrders` is false
2. THE System SHALL filter out markets without `clobTokenIds`
3. WHEN a market has `outcomePrices`, THE System SHALL verify at least one price is between 0.05 and 0.95
4. WHEN a market has evergreen tags, THE System SHALL require minimum liquidity of $1,000
5. WHEN a market lacks evergreen tags, THE System SHALL require minimum liquidity of $5,000
6. THE System SHALL apply the same evergreen tag IDs: [2, 21, 120, 596, 1401, 100265, 100639]

### Requirement 6: Sorting and Ranking Logic

**User Story:** As a user, I want to see the most relevant markets first, so that I can quickly find interesting trading opportunities.

#### Acceptance Criteria

1. WHEN sorting open markets, THE System SHALL calculate a combined score of liquidity plus 24-hour volume
2. WHEN sorting closed markets, THE System SHALL prioritize by end date (most recent first), then by volume
3. WHEN mixing open and closed markets, THE System SHALL prioritize open markets over closed markets
4. THE System SHALL apply sorting after filtering to ensure only valid markets are ranked

### Requirement 7: Error Handling and Resilience

**User Story:** As a system operator, I want robust error handling, so that temporary API issues don't break the application.

#### Acceptance Criteria

1. WHEN the Gamma_API returns a non-200 status code, THE System SHALL throw a descriptive error with the status code
2. WHEN the API response is not a valid array, THE System SHALL throw an error indicating invalid response structure
3. WHEN parsing JSON fields fails, THE System SHALL skip the invalid market and continue processing
4. THE Backend SHALL implement retry logic with exponential backoff for transient failures
5. THE Backend SHALL NOT retry on 400 or 404 errors

### Requirement 8: Pagination Support

**User Story:** As a user, I want to load more markets as I scroll, so that I can explore a large number of trading opportunities.

#### Acceptance Criteria

1. WHEN the Frontend requests a specific page, THE API_Proxy SHALL pass `limit` and `offset` parameters to the Gamma_API
2. WHEN the API returns fewer markets than requested, THE Frontend SHALL recognize this as the end of available data
3. THE System SHALL support infinite scroll by incrementing the offset by the page size for each subsequent request
4. THE API_Proxy SHALL fetch more markets than requested (3x) to account for filtering, then apply client-side pagination

### Requirement 9: Backward Compatibility

**User Story:** As a developer, I want to maintain existing functionality, so that the refactoring doesn't break current features.

#### Acceptance Criteria

1. THE System SHALL maintain the same market data structure returned to the Frontend
2. THE System SHALL preserve all existing market fields including `volume24hr`, `liquidity`, `outcomePrices`, `clobTokenIds`, etc.
3. WHEN event context is available, THE System SHALL include it in the same format as before
4. THE System SHALL maintain the same filtering thresholds and logic
5. THE System SHALL maintain the same sorting behavior for trending and all categories

### Requirement 10: Performance Optimization

**User Story:** As a user, I want fast market loading, so that I can start trading quickly.

#### Acceptance Criteria

1. THE System SHALL reduce the number of API calls by fetching markets directly instead of events
2. THE System SHALL eliminate the nested loop processing of events and their markets
3. THE Backend SHALL use a 15-second timeout for API requests
4. THE Frontend SHALL cache API responses for 60 seconds
5. THE Frontend SHALL refetch market data every 10 seconds when the page is active
