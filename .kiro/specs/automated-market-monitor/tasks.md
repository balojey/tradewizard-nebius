# Implementation Plan: Automated Market Monitor

## Overview

This implementation plan creates a production-ready background service that continuously monitors prediction markets, schedules analysis workflows, and persists results to Supabase PostgreSQL. The plan follows an incremental approach: build core infrastructure first, then add scheduling, then integrate with the existing Market Intelligence Engine.

## Tasks

- [x] 1. Set up Supabase PostgreSQL integration
  - Install Supabase client library (@supabase/supabase-js)
  - Create Supabase client configuration module
  - Implement connection management with retry logic
  - Create database schema migration script (markets, recommendations, agent_signals, analysis_history, langgraph_checkpoints tables)
  - Implement schema creation/migration on startup
  - Add connection health check function
  - _Requirements: 5.1, 5.5, 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 1.1 Write unit tests for Supabase integration
  - Test connection establishment
  - Test connection retry logic
  - Test schema creation
  - Test connection health check
  - _Requirements: 5.1, 5.5_

- [x] 2. Implement database persistence layer
  - Create DatabasePersistence interface
  - Implement upsertMarket function
  - Implement storeRecommendation function
  - Implement storeAgentSignals function
  - Implement recordAnalysis function
  - Implement getMarketsForUpdate function
  - Implement markMarketResolved function
  - Implement getLatestRecommendation function
  - Add error handling and logging for all database operations
  - _Requirements: 5.2, 5.3, 5.4, 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 2.1 Write unit tests for database persistence
  - Test upsertMarket with new and existing markets
  - Test storeRecommendation
  - Test storeAgentSignals with multiple signals
  - Test recordAnalysis
  - Test getMarketsForUpdate with various timestamps
  - Test markMarketResolved
  - Test error handling for database failures
  - _Requirements: 5.2, 5.3, 5.4, 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 2.2 Write property test for database persistence completeness
  - **Property 3: Database persistence completeness**
  - **Validates: Requirements 5.2, 5.3, 5.4**

- [x] 3. Integrate LangGraph with PostgreSQL checkpointer
  - Install @langchain/langgraph-checkpoint-postgres
  - Create PostgreSQL checkpointer configuration
  - Modify Market Intelligence Engine to use PostgreSQL checkpointer
  - Test checkpoint creation and retrieval
  - Test workflow resumption from checkpoint
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 3.1 Write unit tests for LangGraph checkpointing
  - Test checkpoint creation in PostgreSQL
  - Test checkpoint retrieval
  - Test workflow resumption
  - Test checkpoint cleanup
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4. Implement API quota manager
  - Create APIQuotaManager interface
  - Implement QuotaManager class with usage tracking
  - Implement canMakeRequest function
  - Implement recordUsage function
  - Implement getUsage function
  - Implement resetUsage function
  - Implement getRecommendedMarketCount function
  - Add quota configuration loading from environment
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 4.1 Write unit tests for quota manager
  - Test usage tracking
  - Test quota enforcement
  - Test recommended market count calculation
  - Test quota reset
  - Test configuration loading
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 4.2 Write property test for API quota respect
  - **Property 2: API quota respect**
  - **Validates: Requirements 4.2, 4.4**

- [x] 5. Implement market discovery engine
  - Create MarketDiscoveryEngine interface
  - Implement fetchPoliticalMarkets function using Polymarket client
  - Implement filterPoliticalMarkets function with keyword matching
  - Implement calculateTrendingScore function
  - Implement calculateRecencyScore function
  - Implement rankMarkets function
  - Implement discoverMarkets function (fetch, filter, rank, select top N)
  - Add error handling and retry logic for Polymarket API
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 5.1 Write unit tests for market discovery
  - Test fetchPoliticalMarkets with mocked Polymarket API
  - Test filterPoliticalMarkets with various market types
  - Test calculateTrendingScore with different market metrics
  - Test rankMarkets with sample markets
  - Test discoverMarkets end-to-end
  - Test error handling and retry logic
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 5.2 Write property test for market selection count
  - **Property 1: Market selection count enforcement**
  - **Validates: Requirements 1.4, 4.3**

- [x] 6. Implement scheduler
  - Create Scheduler interface
  - Implement CronScheduler class
  - Implement start function with configurable interval
  - Implement stop function with graceful shutdown
  - Implement triggerNow function for manual triggers
  - Implement getNextRun function
  - Add runAnalysisCycle function
  - Add concurrent execution prevention
  - _Requirements: 2.1, 2.2, 2.6, 7.3_

- [x] 6.1 Write unit tests for scheduler
  - Test scheduler start and stop
  - Test interval timing
  - Test manual trigger
  - Test concurrent execution prevention
  - Test graceful shutdown
  - _Requirements: 2.1, 2.2, 2.6, 7.3_

- [x] 6.2 Write property test for scheduled execution reliability
  - **Property 4: Scheduled execution reliability**
  - **Validates: Requirements 2.1, 2.2**

- [x] 7. Implement monitor service orchestrator
  - Create MonitorService interface
  - Implement AutomatedMarketMonitor class
  - Implement initialize function (connect database, setup engine, signal handlers)
  - Implement start function (start scheduler, quota reset)
  - Implement stop function (graceful shutdown)
  - Implement getHealth function
  - Implement analyzeMarket function (run engine, store results)
  - Implement discoverAndAnalyze function (discovery + analysis cycle)
  - Implement updateExistingMarkets function
  - Add comprehensive error handling and logging
  - _Requirements: 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 7.1 Write unit tests for monitor service
  - Test initialization
  - Test start and stop
  - Test analyzeMarket with mocked engine
  - Test discoverAndAnalyze cycle
  - Test updateExistingMarkets
  - Test error handling
  - Test graceful shutdown
  - _Requirements: 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4_

- [x] 7.2 Write property test for error isolation
  - **Property 7: Error isolation**
  - **Validates: Requirements 10.4**
  - **Status: PASSING** (100 runs, 704ms)

- [x] 7.3 Write property test for graceful shutdown
  - **Property 5: Graceful shutdown completeness**
  - **Validates: Requirements 7.3**
  - **Status: PASSING** (20 runs, 20316ms)

- [x] 8. Implement health check endpoint
  - Create Express server for health check
  - Implement /health endpoint
  - Return service status, uptime, last analysis, next run, database status, quota status
  - Add error handling for health check failures
  - Configure health check port from environment
  - _Requirements: 7.5, 7.6_

- [x] 8.1 Write unit tests for health check
  - Test health endpoint returns correct status
  - Test health endpoint with database disconnected
  - Test health endpoint with scheduler stopped
  - _Requirements: 7.5, 7.6_

- [x] 8.2 Write property test for health check accuracy
  - **Property 9: Health check accuracy**
  - **Validates: Requirements 7.5, 7.6**

- [x] 9. Implement configuration management
  - Create MonitorConfig interface
  - Implement loadConfiguration function from environment variables
  - Implement validateConfiguration function
  - Add default values for optional configuration
  - Add configuration logging (excluding secrets)
  - Add configuration error handling
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9.1 Write unit tests for configuration
  - Test configuration loading
  - Test configuration validation
  - Test default values
  - Test invalid configuration handling
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9.2 Write property test for configuration validation
  - **Property 10: Configuration validation**
  - **Validates: Requirements 8.3**

- [x] 10. Implement manual trigger support
  - Add POST /trigger endpoint to health check server
  - Accept market condition ID in request body
  - Validate request parameters
  - Queue manual analysis request
  - Return recommendation on completion
  - Add authentication for manual triggers (optional)
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 10.1 Write unit tests for manual triggers
  - Test manual trigger endpoint
  - Test request validation
  - Test queuing logic
  - Test response format
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 11. Implement quota reset scheduler
  - Create daily quota reset scheduler
  - Schedule reset at midnight UTC
  - Call quotaManager.resetUsage()
  - Log quota reset events
  - _Requirements: 4.5_

- [x] 11.1 Write unit tests for quota reset
  - Test quota reset timing
  - Test quota reset execution
  - _Requirements: 4.5_

- [x] 11.2 Write property test for quota reset timing
  - **Property 8: Quota reset timing**
  - **Validates: Requirements 4.5**

- [x] 12. Implement market update logic
  - Implement getMarketsForUpdate query
  - Filter markets by status (active only)
  - Filter markets by last_analyzed_at timestamp
  - Sort by priority (trending score, staleness)
  - Limit to quota-allowed count
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 12.1 Write unit tests for market updates
  - Test getMarketsForUpdate with various timestamps
  - Test filtering by status
  - Test sorting by priority
  - Test quota-based limiting
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 12.2 Write property test for update interval enforcement
  - **Property 6: Market update interval enforcement**
  - **Validates: Requirements 3.2**

- [x] 13. Add comprehensive logging
  - Implement structured logging with Winston or Pino
  - Log all major operations (discovery, analysis, storage)
  - Log errors with full context and stack traces
  - Log quota usage and limits
  - Log scheduler events
  - Configure log levels from environment
  - Add log rotation for production
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13.1 Write unit tests for logging
  - Test log message structure
  - Test log levels
  - Test error logging with context
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 14. Integrate with Opik for observability
  - Ensure Opik tracing is enabled for all analysis workflows
  - Add custom Opik spans for monitor operations
  - Track costs per analysis cycle
  - Track agent performance across cycles
  - Add Opik dashboard links to logs
  - _Requirements: 9.6_

- [x] 14.1 Write unit tests for Opik integration
  - Test Opik span creation
  - Test cost tracking
  - Test performance tracking
  - _Requirements: 9.6_

- [x] 15. Create monitor entry point script
  - Create src/monitor.ts as main entry point
  - Initialize monitor service
  - Start monitor
  - Handle uncaught exceptions
  - Handle unhandled promise rejections
  - Add process exit handlers
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 15.1 Write integration tests for monitor
  - Test full monitor lifecycle (start, run cycle, stop)
  - Test with mocked Polymarket and Supabase
  - Test error recovery
  - Test graceful shutdown
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 16. Create deployment artifacts
  - Create Dockerfile for containerized deployment
  - Create docker-compose.yml for local testing
  - Create systemd service file for Linux servers
  - Create PM2 ecosystem file for Node.js deployments
  - Create .env.example for monitor configuration
  - Update .gitignore for monitor-specific files
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 17. Write deployment documentation
  - Document Supabase setup and configuration
  - Document environment variables for monitor
  - Document deployment options (Docker, systemd, PM2)
  - Document monitoring and health checks
  - Document troubleshooting common issues
  - Add examples for different deployment scenarios
  - _Requirements: 14.4_

- [x] 18. Create database migration scripts
  - Create initial schema migration (001_initial_schema.sql)
  - Create migration runner script
  - Add migration tracking table
  - Document migration process
  - _Requirements: 15.5_

- [x] 19. Add retry and error recovery logic
  - Implement retry logic for Polymarket API calls
  - Implement retry logic for Supabase operations
  - Implement retry logic for external data APIs
  - Add exponential backoff with jitter
  - Add circuit breaker for repeated failures
  - Log all retry attempts
  - _Requirements: 1.6, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 19.1 Write unit tests for retry logic
  - Test exponential backoff
  - Test retry limits
  - Test circuit breaker
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 20. Write end-to-end integration tests
  - Test full discovery and analysis cycle
  - Test with real Supabase instance (test database)
  - Test quota enforcement across multiple cycles
  - Test market updates
  - Test graceful shutdown during analysis
  - Test recovery from database disconnection
  - Test recovery from API failures
  - _Requirements: All_

- [x] 21. Performance testing and optimization
  - Test monitor with 24-hour continuous operation
  - Monitor memory usage over time
  - Monitor CPU usage during analysis
  - Optimize database queries
  - Optimize caching strategy
  - Test with various market counts (1, 3, 10)
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 22. Create monitoring dashboard queries
  - Create SQL queries for market analysis statistics
  - Create SQL queries for agent performance over time
  - Create SQL queries for cost tracking
  - Create SQL queries for quota usage trends
  - Document dashboard setup in Supabase
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 23. Add market resolution detection
  - Implement Polymarket market resolution checking
  - Update market status to "resolved" when detected
  - Store resolution outcome
  - Stop updating resolved markets
  - Log resolution events
  - _Requirements: 3.5, 11.3_

- [x] 23.1 Write unit tests for resolution detection
  - Test resolution detection
  - Test status update
  - Test outcome storage
  - _Requirements: 3.5, 11.3_

- [x] 24. Create CLI commands for monitor management
  - Add `npm run monitor:start` command
  - Add `npm run monitor:stop` command
  - Add `npm run monitor:status` command
  - Add `npm run monitor:trigger <conditionId>` command
  - Add `npm run monitor:health` command
  - Update package.json scripts
  - _Requirements: 13.1, 13.2, 13.3_

- [x] 25. Final checkpoint - End-to-end testing
  - Deploy monitor to staging environment
  - Run for 48 hours continuously
  - Verify markets are discovered and analyzed
  - Verify data is stored correctly in Supabase
  - Verify quota limits are respected
  - Verify service restarts gracefully
  - Verify health checks work correctly
  - Verify manual triggers work
  - Document any issues found
  - _Requirements: All_

- [x] 26. Production deployment preparation
  - Set up production Supabase project
  - Configure production environment variables
  - Set up monitoring alerts (Opik, Supabase)
  - Set up log aggregation
  - Create runbook for common operations
  - Create incident response plan
  - Document rollback procedure
  - _Requirements: All_

## Notes

- All database operations should use transactions where appropriate
- All external API calls should have timeouts
- All errors should be logged with full context
- All configuration should be validated on startup
- The monitor should be designed to run 24/7 without manual intervention
- Cost tracking is critical - monitor API usage closely
- Graceful shutdown is essential - never leave analysis in partial state
