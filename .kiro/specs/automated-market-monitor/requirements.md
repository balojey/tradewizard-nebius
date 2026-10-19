# Requirements Document

## Introduction

The Automated Market Monitor transforms TradeWizard from a manual CLI tool into an autonomous intelligence platform that continuously monitors prediction markets, generates analysis, and updates recommendations. This system runs as a long-lived background service that discovers trending markets, schedules analysis workflows, manages API quota budgets, and persists all data to Supabase PostgreSQL for frontend consumption.

The monitor operates within strict cost constraints by limiting analysis to the top 1-3 trending political markets per day, ensuring the system stays within free-tier API quotas for external data sources (NewsAPI, Twitter, Reddit, etc.).

## Glossary

- **Automated Market Monitor**: The background service that continuously discovers and analyzes prediction markets
- **Market Discovery**: The process of fetching and filtering trending political markets from Polymarket
- **Analysis Schedule**: The configured interval (default: 24 hours) between market analyses
- **Market Ranking**: The algorithm that determines which markets are "top trending" based on volume, activity, and recency
- **Recommendation Update**: The process of re-analyzing a previously analyzed market to update the recommendation
- **API Quota Budget**: The daily limit on external API calls to stay within free-tier quotas
- **Supabase Integration**: PostgreSQL database hosted on Supabase for persistent storage
- **Market State**: The stored analysis results, recommendations, and metadata for each market
- **Scheduler**: The component that manages timing of market discovery and analysis
- **Health Check**: Periodic verification that the monitor service is running correctly

## Requirements

### Requirement 1: Market Discovery and Ranking

**User Story:** As a system operator, I want the monitor to automatically discover trending political markets, so that the system analyzes the most relevant opportunities without manual intervention.

#### Acceptance Criteria

1. WHEN the monitor starts THEN the system SHALL fetch all active political markets from Polymarket
2. WHEN markets are fetched THEN the system SHALL filter for political event types (election, court, policy, geopolitical)
3. WHEN markets are filtered THEN the system SHALL rank markets by trending score (volume24h, liquidity, recency)
4. WHEN markets are ranked THEN the system SHALL select the top N markets (configurable, default: 3)
5. WHEN market selection is complete THEN the system SHALL log the selected markets with ranking scores
6. WHEN market discovery fails THEN the system SHALL retry with exponential backoff and log the error

### Requirement 2: Scheduled Market Analysis

**User Story:** As a system operator, I want the monitor to analyze selected markets on a schedule, so that recommendations stay current without exceeding API quotas.

#### Acceptance Criteria

1. WHEN the monitor initializes THEN the system SHALL load the analysis schedule from configuration (default: 24 hours)
2. WHEN the schedule interval elapses THEN the system SHALL trigger market discovery and analysis
3. WHEN a market is selected for analysis THEN the system SHALL run the full Market Intelligence Engine workflow
4. WHEN analysis completes THEN the system SHALL store results in Supabase PostgreSQL
5. WHEN analysis fails THEN the system SHALL log the error, skip that market, and continue with remaining markets
6. WHEN all markets are analyzed THEN the system SHALL wait for the next scheduled interval

### Requirement 3: Recommendation Updates

**User Story:** As a trader, I want existing recommendations to be updated periodically, so that I have current information as markets evolve.

#### Acceptance Criteria

1. WHEN a market has been previously analyzed THEN the system SHALL track the last analysis timestamp
2. WHEN the update interval elapses (configurable, default: 24 hours) THEN the system SHALL re-analyze the market
3. WHEN re-analyzing a market THEN the system SHALL fetch fresh external data (news, polling, sentiment)
4. WHEN re-analysis completes THEN the system SHALL update the stored recommendation in Supabase
5. WHEN a market resolves THEN the system SHALL mark it as resolved and stop updating it
6. WHEN a market becomes inactive (low volume) THEN the system SHALL deprioritize it in future updates

### Requirement 4: API Quota Management

**User Story:** As a system operator, I want the monitor to respect API quota limits, so that the system stays within free-tier budgets for external data sources.

#### Acceptance Criteria

1. WHEN the monitor initializes THEN the system SHALL load API quota budgets from configuration
2. WHEN external data is fetched THEN the system SHALL track API usage per source (NewsAPI, Twitter, Reddit)
3. WHEN API usage approaches quota limit (>80%) THEN the system SHALL reduce the number of markets analyzed
4. WHEN API quota is exceeded THEN the system SHALL skip external data fetching and use cached data
5. WHEN the quota reset period elapses (daily) THEN the system SHALL reset usage counters
6. WHEN quota limits are configured THEN the system SHALL validate limits are positive integers

### Requirement 5: Supabase PostgreSQL Integration

**User Story:** As a developer, I want all market data and recommendations stored in Supabase PostgreSQL, so that the frontend can query and display analysis results.

#### Acceptance Criteria

1. WHEN the monitor initializes THEN the system SHALL connect to Supabase PostgreSQL using connection string
2. WHEN a market is analyzed THEN the system SHALL store the Market Briefing Document in the markets table
3. WHEN analysis completes THEN the system SHALL store the trade recommendation in the recommendations table
4. WHEN agent signals are generated THEN the system SHALL store all agent signals in the agent_signals table
5. WHEN the database connection fails THEN the system SHALL retry with exponential backoff and log the error
6. WHEN storing data fails THEN the system SHALL log the error and continue processing

### Requirement 6: LangGraph Checkpointing with Supabase

**User Story:** As a developer, I want LangGraph to use Supabase PostgreSQL for checkpointing, so that workflow state is persisted and recoverable.

#### Acceptance Criteria

1. WHEN the monitor initializes THEN the system SHALL configure LangGraph to use PostgreSQL checkpointer
2. WHEN a workflow executes THEN the system SHALL store checkpoints in Supabase PostgreSQL
3. WHEN a workflow is interrupted THEN the system SHALL be able to resume from the last checkpoint
4. WHEN checkpoints are stored THEN the system SHALL use the market condition ID as the thread_id
5. WHEN checkpoint storage fails THEN the system SHALL log the error and continue without checkpointing

### Requirement 7: Service Lifecycle Management

**User Story:** As a system operator, I want the monitor to run as a reliable long-lived service, so that it operates continuously without manual intervention.

#### Acceptance Criteria

1. WHEN the monitor starts THEN the system SHALL initialize all components (database, scheduler, API clients)
2. WHEN initialization completes THEN the system SHALL log startup success and begin scheduled operations
3. WHEN a graceful shutdown signal is received (SIGTERM, SIGINT) THEN the system SHALL complete current analysis and exit cleanly
4. WHEN an unhandled error occurs THEN the system SHALL log the error, attempt recovery, and continue running
5. WHEN the monitor is running THEN the system SHALL expose a health check endpoint
6. WHEN the health check is queried THEN the system SHALL return service status and last successful analysis timestamp

### Requirement 8: Configuration Management

**User Story:** As a system operator, I want to configure the monitor's behavior via environment variables, so that I can tune it for different deployment scenarios.

#### Acceptance Criteria

1. WHEN the monitor starts THEN the system SHALL load configuration from environment variables
2. WHEN configuration is loaded THEN the system SHALL validate all required variables are present
3. WHEN configuration is invalid THEN the system SHALL log validation errors and exit with error code
4. WHEN configuration is valid THEN the system SHALL log loaded configuration (excluding secrets)
5. WHEN configuration includes optional variables THEN the system SHALL use defaults for missing values

### Requirement 9: Logging and Observability

**User Story:** As a system operator, I want comprehensive logging and monitoring, so that I can debug issues and track system health.

#### Acceptance Criteria

1. WHEN any operation occurs THEN the system SHALL log structured messages with timestamp, level, and context
2. WHEN market discovery runs THEN the system SHALL log discovered markets, ranking scores, and selected markets
3. WHEN analysis starts THEN the system SHALL log the market being analyzed and estimated cost
4. WHEN analysis completes THEN the system SHALL log success, duration, and actual cost
5. WHEN errors occur THEN the system SHALL log full error details with stack traces
6. WHEN the monitor is running THEN the system SHALL integrate with Opik for distributed tracing

### Requirement 10: Error Handling and Recovery

**User Story:** As a system operator, I want the monitor to handle errors gracefully, so that transient failures don't crash the entire service.

#### Acceptance Criteria

1. WHEN Polymarket API fails THEN the system SHALL retry with exponential backoff up to 3 times
2. WHEN external data API fails THEN the system SHALL use cached data if available or skip that data source
3. WHEN Supabase connection fails THEN the system SHALL retry connection and queue writes for retry
4. WHEN analysis workflow fails THEN the system SHALL log the error, skip that market, and continue with others
5. WHEN unrecoverable errors occur THEN the system SHALL log the error and exit with non-zero code

### Requirement 11: Market State Tracking

**User Story:** As a developer, I want to track the state of each market over time, so that the system knows which markets need updates and which are resolved.

#### Acceptance Criteria

1. WHEN a market is first analyzed THEN the system SHALL create a market state record with status "active"
2. WHEN a market is re-analyzed THEN the system SHALL update the market state with new analysis timestamp
3. WHEN a market resolves THEN the system SHALL update the market state with status "resolved" and outcome
4. WHEN a market becomes inactive THEN the system SHALL update the market state with status "inactive"
5. WHEN querying markets for update THEN the system SHALL filter by status and last analysis timestamp

### Requirement 12: Performance Optimization

**User Story:** As a system operator, I want the monitor to be resource-efficient, so that it can run on modest infrastructure.

#### Acceptance Criteria

1. WHEN multiple markets are analyzed THEN the system SHALL process them sequentially (not parallel) to limit memory usage
2. WHEN external data is fetched THEN the system SHALL use caching to minimize redundant API calls
3. WHEN the monitor is idle THEN the system SHALL use minimal CPU and memory resources
4. WHEN analysis completes THEN the system SHALL clean up temporary resources and release memory
5. WHEN the monitor runs for extended periods THEN the system SHALL not exhibit memory leaks

### Requirement 13: Manual Trigger Support

**User Story:** As a system operator, I want to manually trigger analysis of specific markets, so that I can test the system or analyze markets on-demand.

#### Acceptance Criteria

1. WHEN a manual trigger endpoint is called THEN the system SHALL accept a market condition ID
2. WHEN a manual trigger is received THEN the system SHALL immediately analyze the specified market
3. WHEN manual analysis completes THEN the system SHALL return the recommendation to the caller
4. WHEN manual trigger is called during scheduled analysis THEN the system SHALL queue the manual request
5. WHEN manual trigger fails THEN the system SHALL return an error response with details

### Requirement 14: Deployment Readiness

**User Story:** As a system operator, I want the monitor to be production-ready, so that I can deploy it with confidence.

#### Acceptance Criteria

1. WHEN the monitor is deployed THEN the system SHALL include a Dockerfile for containerization
2. WHEN the monitor is deployed THEN the system SHALL include systemd service file for Linux servers
3. WHEN the monitor is deployed THEN the system SHALL include PM2 ecosystem file for Node.js deployments
4. WHEN the monitor is deployed THEN the system SHALL include comprehensive deployment documentation
5. WHEN the monitor is deployed THEN the system SHALL include example environment configuration files

### Requirement 15: Database Schema

**User Story:** As a developer, I want a well-designed database schema in Supabase, so that data is organized efficiently for querying.

#### Acceptance Criteria

1. WHEN the monitor initializes THEN the system SHALL create required database tables if they don't exist
2. WHEN tables are created THEN the system SHALL include proper indexes for query performance
3. WHEN tables are created THEN the system SHALL include foreign key constraints for data integrity
4. WHEN tables are created THEN the system SHALL include timestamps (created_at, updated_at) for all records
5. WHEN schema migrations are needed THEN the system SHALL provide migration scripts
