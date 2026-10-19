# Requirements Document

## Introduction

The Supabase Market Updater is a lightweight serverless function that maintains fresh market data in the TradeWizard database. Unlike the full AI-powered monitoring service, this function focuses solely on keeping market metadata current by periodically fetching updated information from Polymarket APIs. The function runs hourly via a PostgreSQL cron job, ensuring that market prices, volumes, liquidity, and resolution status remain accurate without the overhead of running full AI analysis.

## Glossary

- **Edge_Function**: A Supabase serverless function that runs on Deno runtime at the edge
- **Polymarket_API**: The Polymarket CLOB (Central Limit Order Book) API that provides market data
- **Active_Market**: A market with status 'active' in the database that has not been resolved
- **Market_Resolution**: The final outcome determination of a prediction market
- **pg_cron**: PostgreSQL extension for scheduling recurring database jobs
- **CLOB_Client**: The @polymarket/clob-client library for interacting with Polymarket APIs
- **Condition_ID**: Unique identifier for a Polymarket market condition

## Requirements

### Requirement 1: Edge Function Implementation

**User Story:** As a system administrator, I want a Supabase Edge Function that updates market data, so that the database stays current without running full AI analysis.

#### Acceptance Criteria

1. THE Edge_Function SHALL be implemented using Deno runtime with TypeScript
2. THE Edge_Function SHALL be deployed to Supabase Edge Functions infrastructure
3. WHEN the Edge_Function is invoked, THE Edge_Function SHALL authenticate with Supabase using service role credentials
4. THE Edge_Function SHALL use the @polymarket/clob-client library for Polymarket API integration
5. WHEN the Edge_Function completes execution, THE Edge_Function SHALL return a JSON response with execution summary

### Requirement 2: Active Market Discovery

**User Story:** As the system, I want to identify which markets need updating, so that I can efficiently process only active markets.

#### Acceptance Criteria

1. WHEN the Edge_Function executes, THE Edge_Function SHALL query the markets table for all records with status 'active'
2. THE Edge_Function SHALL retrieve the condition_id for each active market
3. IF no active markets exist, THEN THE Edge_Function SHALL return early with a success status
4. THE Edge_Function SHALL log the count of active markets discovered

### Requirement 3: Market Data Fetching

**User Story:** As the system, I want to fetch current market data from Polymarket, so that I can update the database with fresh information.

#### Acceptance Criteria

1. FOR ALL active markets, THE Edge_Function SHALL fetch current market data from Polymarket API using the condition_id
2. WHEN fetching market data, THE Edge_Function SHALL retrieve market_probability, volume_24h, and liquidity
3. IF a market fetch fails, THEN THE Edge_Function SHALL log the error and continue processing remaining markets
4. THE Edge_Function SHALL respect Polymarket API rate limits
5. WHEN API rate limits are encountered, THE Edge_Function SHALL implement exponential backoff retry logic

### Requirement 4: Market Status Updates

**User Story:** As the system, I want to update market records with fresh data, so that users see current market information.

#### Acceptance Criteria

1. FOR ALL successfully fetched markets, THE Edge_Function SHALL update the markets table with new data
2. WHEN updating a market, THE Edge_Function SHALL set market_probability to the current probability
3. WHEN updating a market, THE Edge_Function SHALL set volume_24h to the current 24-hour volume
4. WHEN updating a market, THE Edge_Function SHALL set liquidity to the current liquidity value
5. WHEN updating a market, THE Edge_Function SHALL set updated_at to the current timestamp
6. THE Edge_Function SHALL use upsert operations to handle concurrent updates safely

### Requirement 5: Market Resolution Detection

**User Story:** As the system, I want to detect when markets have been resolved, so that I can mark them as inactive and stop monitoring them.

#### Acceptance Criteria

1. FOR ALL active markets, THE Edge_Function SHALL check if the market has been resolved on Polymarket
2. WHEN a market is detected as resolved, THE Edge_Function SHALL update the status field to 'resolved'
3. WHEN a market is detected as resolved, THE Edge_Function SHALL store the resolved_outcome in the database
4. WHEN a market is detected as resolved, THE Edge_Function SHALL set updated_at to the current timestamp
5. THE Edge_Function SHALL log each market resolution detection

### Requirement 6: Error Handling and Logging

**User Story:** As a system administrator, I want comprehensive error handling and logging, so that I can diagnose issues when they occur.

#### Acceptance Criteria

1. WHEN any error occurs during execution, THE Edge_Function SHALL log the error with context information
2. IF database connection fails, THEN THE Edge_Function SHALL return an error response with status 500
3. IF Polymarket API is unavailable, THEN THE Edge_Function SHALL log the failure and continue with remaining markets
4. THE Edge_Function SHALL log execution start time, end time, and total duration
5. THE Edge_Function SHALL log the count of markets processed, updated, and failed
6. WHEN execution completes, THE Edge_Function SHALL return a summary including success count and error count

### Requirement 7: PostgreSQL Cron Job Configuration

**User Story:** As a system administrator, I want an automated hourly schedule for market updates, so that data stays fresh without manual intervention.

#### Acceptance Criteria

1. THE System SHALL create a pg_cron job that invokes the Edge_Function hourly
2. THE pg_cron job SHALL be configured using a database migration script
3. THE pg_cron job SHALL use the cron expression '0 * * * *' for hourly execution
4. THE pg_cron job SHALL invoke the Edge_Function using the Supabase Edge Functions URL
5. THE pg_cron job SHALL include authentication credentials for invoking the Edge_Function
6. THE System SHALL provide a migration script to enable the pg_cron extension if not already enabled

### Requirement 8: Configuration Management

**User Story:** As a developer, I want environment-based configuration, so that the function works across development and production environments.

#### Acceptance Criteria

1. THE Edge_Function SHALL read the Supabase URL from environment variables
2. THE Edge_Function SHALL read the Supabase service role key from environment variables
3. THE Edge_Function SHALL read the Polymarket API configuration from environment variables
4. WHERE environment variables are missing, THE Edge_Function SHALL return an error response
5. THE Edge_Function SHALL support local development using Supabase CLI

### Requirement 9: Performance and Efficiency

**User Story:** As a system administrator, I want efficient execution, so that the function completes quickly and minimizes costs.

#### Acceptance Criteria

1. THE Edge_Function SHALL process markets in batches to optimize database queries
2. THE Edge_Function SHALL use connection pooling for database connections
3. THE Edge_Function SHALL complete execution within 60 seconds for up to 100 active markets
4. THE Edge_Function SHALL minimize memory usage by processing markets in streams where possible
5. WHEN processing large numbers of markets, THE Edge_Function SHALL implement pagination
