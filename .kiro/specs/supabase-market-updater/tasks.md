# Implementation Plan: Supabase Market Updater

## Overview

This implementation plan creates a Supabase Edge Function that runs hourly via pg_cron to update active market data from Polymarket. The function will be implemented in TypeScript using Deno runtime, with comprehensive error handling and property-based testing.

## Tasks

- [x] 1. Set up Edge Function structure and dependencies
  - Create `supabase/functions/market-updater/` directory
  - Create `index.ts` with basic Deno serve handler
  - Define TypeScript interfaces for MarketRecord, UpdateResult, ExecutionSummary
  - Set up import maps for @supabase/supabase-js and @polymarket/clob-client
  - _Requirements: 1.1, 1.4_

- [x] 2. Implement client initialization and configuration
  - [x] 2.1 Create Supabase client initialization function
    - Read SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment
    - Return configured Supabase client with service role
    - _Requirements: 1.3, 8.1, 8.2_
  
  - [x] 2.2 Create Polymarket client initialization function
    - Configure ClobClient with chainId from environment
    - Set up read-only client (no private key needed)
    - _Requirements: 1.4, 8.3_
  
  - [x] 2.3 Implement configuration validation
    - Check for required environment variables
    - Return error response if any are missing
    - _Requirements: 8.4_

- [x] 3. Implement active market discovery
  - [x] 3.1 Create fetchActiveMarkets function
    - Query markets table with status = 'active'
    - Select id, condition_id, question, status, market_probability, volume_24h, liquidity
    - Return array of MarketRecord objects
    - _Requirements: 2.1, 2.2_
  
  - [ ]* 3.2 Write property test for active market filtering
    - **Property 1: Active Market Filtering**
    - **Validates: Requirements 2.1, 2.2**
  
  - [x] 3.3 Handle empty market list edge case
    - Return early with success status if no active markets
    - Include zero counts in execution summary
    - _Requirements: 2.3_

- [x] 4. Implement Polymarket data fetching
  - [x] 4.1 Create fetchPolymarketData function
    - Accept ClobClient and condition_id as parameters
    - Call getMarket() method on CLOB client
    - Extract probability, volume24h, liquidity from response
    - Detect resolution status and outcome
    - Return structured PolymarketMarketData object
    - _Requirements: 3.1, 3.2, 5.1_
  
  - [ ]* 4.2 Write property test for data completeness
    - **Property 3: Market Data Completeness**
    - **Validates: Requirements 3.2**
  
  - [x] 4.3 Implement error handling for API failures
    - Catch and log individual market fetch errors
    - Return null for failed fetches
    - Allow processing to continue
    - _Requirements: 3.3_
  
  - [ ]* 4.4 Write property test for graceful failure handling
    - **Property 4: Graceful Failure Handling**
    - **Validates: Requirements 3.3**
  
  - [x] 4.5 Implement exponential backoff retry logic
    - Retry failed requests with 1s, 2s, 4s delays
    - Maximum 3 attempts per market
    - _Requirements: 3.5_

- [x] 5. Checkpoint - Ensure data fetching works correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement market update logic
  - [x] 6.1 Create updateMarket function
    - Accept Supabase client, Polymarket client, and MarketRecord
    - Call fetchPolymarketData to get current state
    - Compare fetched data with database record
    - Build update payload with changed fields
    - Execute database update via Supabase client
    - Return UpdateResult with success status and updated fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ]* 6.2 Write property test for complete market updates
    - **Property 5: Complete Market Updates**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
  
  - [x] 6.3 Implement resolution detection and update
    - Check if marketData.resolved is true
    - Add status = 'resolved' to update payload
    - Add resolved_outcome to update payload
    - _Requirements: 5.2, 5.3_
  
  - [ ]* 6.4 Write property test for resolution detection
    - **Property 6: Resolution Detection and Recording**
    - **Validates: Requirements 5.1, 5.2, 5.3**
  
  - [x] 6.5 Optimize update logic to skip unchanged records
    - Only execute database update if fields have changed
    - Track which fields were updated in UpdateResult
    - _Requirements: 4.1_

- [x] 7. Implement main execution handler
  - [x] 7.1 Create main serve handler function
    - Initialize execution summary with zero counts
    - Record start time
    - Initialize Supabase and Polymarket clients
    - Call fetchActiveMarkets
    - Loop through markets and call updateMarket for each
    - Aggregate results into execution summary
    - Calculate total duration
    - Return JSON response with summary
    - _Requirements: 1.5, 6.6_
  
  - [ ]* 7.2 Write property test for execution summary structure
    - **Property 7: Execution Summary Structure**
    - **Validates: Requirements 1.5, 6.6**
  
  - [x] 7.3 Implement top-level error handling
    - Wrap entire execution in try-catch
    - Return 500 status for fatal errors
    - Include error message in summary
    - _Requirements: 6.1, 6.2_
  
  - [ ]* 7.4 Write unit tests for error scenarios
    - Test missing environment variables
    - Test database connection failure
    - Test Polymarket API unavailable
    - _Requirements: 6.2, 6.3, 8.4_

- [x] 8. Checkpoint - Ensure edge function works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Create database migration for pg_cron
  - [x] 9.1 Create migration file for pg_cron setup
    - Create file: `supabase/migrations/[timestamp]_market_updater_cron.sql`
    - Enable pg_cron extension
    - Grant necessary permissions to postgres role
    - _Requirements: 7.1, 7.6_
  
  - [x] 9.2 Configure cron job schedule
    - Use cron.schedule() to create hourly job
    - Set cron expression to '0 * * * *'
    - Name job 'market-updater-hourly'
    - _Requirements: 7.2, 7.3_
  
  - [x] 9.3 Configure HTTP invocation
    - Use net.http_post to invoke edge function
    - Build Supabase Edge Functions URL
    - Include Authorization header with service role key
    - Store service role key in database settings
    - _Requirements: 7.4, 7.5_
  
  - [x] 9.4 Add migration documentation
    - Document how to set service role key in database settings
    - Document how to verify cron job is running
    - Document how to check cron job logs
    - _Requirements: 7.1_

- [x] 10. Create deployment and testing documentation
  - [x] 10.1 Create README for edge function
    - Document function purpose and architecture
    - List environment variables required
    - Provide local testing instructions
    - Provide deployment commands
    - _Requirements: 8.5_
  
  - [x] 10.2 Add monitoring queries
    - Create SQL queries to check cron job status
    - Create SQL queries to view recent market updates
    - Create SQL queries to track resolution detection
    - Document in README
    - _Requirements: 7.1_

- [ ] 11. Final checkpoint - Complete testing and validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- The edge function uses Deno runtime with TypeScript
- All database operations use Supabase client with service role credentials
- Polymarket integration uses @polymarket/clob-client library
