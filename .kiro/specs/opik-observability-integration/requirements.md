# Requirements Document

## Introduction

This document specifies the requirements for integrating Opik observability into the DOA (Debate-Oriented Agents) Python project. The integration will provide comprehensive LLM tracing, cost tracking, and performance monitoring for the multi-agent market analysis workflow, following the same patterns established in the tradewizard-agents TypeScript implementation.

## Glossary

- **DOA**: Debate-Oriented Agents - Python-based multi-agent system for market analysis
- **Opik**: LLM observability platform for tracking, monitoring, and analyzing LLM applications
- **OpikCallbackHandler**: LangChain callback handler from opik-langchain package that automatically tracks LLM invocations
- **OpikMonitorIntegration**: Custom integration class for tracking analysis cycles, agent performance, and cost metrics
- **Analysis_Cycle**: A complete execution of the market analysis workflow from ingestion to recommendation
- **Agent_Signal**: Output from a single specialized intelligence agent during analysis
- **LangGraph**: Framework for building multi-agent workflows with state management
- **Trace**: Opik's record of a complete workflow execution with all LLM calls and metadata
- **Span**: Individual operation within a trace (e.g., single agent execution, LLM call)
- **Gradient_AI**: DigitalOcean's LLM inference platform used by DOA

## Requirements

### Requirement 1: Environment Configuration

**User Story:** As a developer, I want to configure Opik integration through environment variables, so that I can easily enable/disable observability and customize settings without code changes.

#### Acceptance Criteria

1. WHEN the .env file is loaded, THE Configuration_System SHALL read OPIK_API_KEY for authentication
2. WHEN the .env file is loaded, THE Configuration_System SHALL read OPIK_PROJECT_NAME for project identification
3. WHEN the .env file is loaded, THE Configuration_System SHALL read OPIK_WORKSPACE for workspace identification
4. WHEN the .env file is loaded, THE Configuration_System SHALL read OPIK_URL_OVERRIDE for custom Opik instance URLs
5. WHEN the .env file is loaded, THE Configuration_System SHALL read OPIK_TRACK_COSTS as a boolean flag
6. WHEN OPIK_API_KEY is not provided, THE Configuration_System SHALL disable Opik tracking gracefully
7. WHEN OPIK_PROJECT_NAME is not provided, THE Configuration_System SHALL use a default project name "doa-market-analysis"

### Requirement 2: Configuration Data Model

**User Story:** As a developer, I want a structured configuration model for Opik settings, so that configuration is type-safe and validated.

#### Acceptance Criteria

1. THE Configuration_System SHALL define an OpikConfig dataclass with all Opik settings
2. WHEN OpikConfig is instantiated, THE Configuration_System SHALL validate that api_key is a non-empty string if provided
3. WHEN OpikConfig is instantiated, THE Configuration_System SHALL validate that project_name is a non-empty string
4. WHEN OpikConfig is instantiated, THE Configuration_System SHALL validate that base_url is a valid URL if provided
5. THE Configuration_System SHALL include OpikConfig in the main EngineConfig dataclass
6. WHEN EngineConfig.validate() is called, THE Configuration_System SHALL validate the OpikConfig section

### Requirement 3: OpikCallbackHandler Integration

**User Story:** As a developer, I want automatic LLM invocation tracking, so that all LangChain/LangGraph LLM calls are traced without manual instrumentation.

#### Acceptance Criteria

1. WHEN the workflow graph is compiled, THE Workflow_System SHALL create an OpikCallbackHandler instance
2. WHEN OpikCallbackHandler is created, THE Workflow_System SHALL pass the project_name from configuration
3. WHEN the workflow is invoked, THE Workflow_System SHALL pass the OpikCallbackHandler in the config parameter
4. WHEN an LLM is invoked within the workflow, THE OpikCallbackHandler SHALL automatically create a trace
5. WHEN an LLM invocation completes, THE OpikCallbackHandler SHALL record token counts, latency, and model information
6. WHEN Opik tracking is disabled in configuration, THE Workflow_System SHALL not create an OpikCallbackHandler

### Requirement 4: OpikMonitorIntegration Class

**User Story:** As a developer, I want a Python equivalent of the TypeScript OpikMonitorIntegration class, so that I can track custom metrics beyond automatic LLM tracing.

#### Acceptance Criteria

1. THE Opik_Integration_Module SHALL define an OpikMonitorIntegration class
2. WHEN OpikMonitorIntegration is instantiated, THE Class SHALL accept an EngineConfig parameter
3. THE OpikMonitorIntegration SHALL provide a create_opik_handler() method that returns an OpikCallbackHandler
4. THE OpikMonitorIntegration SHALL provide a start_cycle() method that initializes cycle tracking
5. THE OpikMonitorIntegration SHALL provide a record_analysis() method that records individual market analysis
6. THE OpikMonitorIntegration SHALL provide an end_cycle() method that finalizes cycle metrics
7. THE OpikMonitorIntegration SHALL provide a get_trace_url() method that generates Opik dashboard URLs

### Requirement 5: Analysis Cycle Tracking

**User Story:** As a system operator, I want to track complete analysis cycles, so that I can monitor overall system performance and costs.

#### Acceptance Criteria

1. WHEN start_cycle() is called, THE OpikMonitorIntegration SHALL create a new AnalysisCycleMetrics object
2. WHEN start_cycle() is called, THE OpikMonitorIntegration SHALL generate a unique cycle_id
3. WHEN record_analysis() is called, THE OpikMonitorIntegration SHALL increment markets_analyzed counter
4. WHEN record_analysis() is called, THE OpikMonitorIntegration SHALL accumulate total_duration
5. WHEN record_analysis() is called, THE OpikMonitorIntegration SHALL accumulate total_cost
6. WHEN record_analysis() is called with success=True, THE OpikMonitorIntegration SHALL increment success_count
7. WHEN record_analysis() is called with success=False, THE OpikMonitorIntegration SHALL increment error_count
8. WHEN end_cycle() is called, THE OpikMonitorIntegration SHALL store the cycle metrics in history
9. WHEN end_cycle() is called, THE OpikMonitorIntegration SHALL log a cycle summary

### Requirement 6: Agent Performance Tracking

**User Story:** As a system operator, I want to track individual agent performance, so that I can identify slow or expensive agents.

#### Acceptance Criteria

1. WHEN record_analysis() is called with agent_signals, THE OpikMonitorIntegration SHALL update agent-specific metrics
2. FOR ALL agent signals, THE OpikMonitorIntegration SHALL track execution_count per agent
3. FOR ALL agent signals, THE OpikMonitorIntegration SHALL track total_duration per agent
4. FOR ALL agent signals, THE OpikMonitorIntegration SHALL track total_cost per agent
5. FOR ALL agent signals, THE OpikMonitorIntegration SHALL calculate average_duration per agent
6. FOR ALL agent signals, THE OpikMonitorIntegration SHALL calculate average_cost per agent
7. FOR ALL agent signals, THE OpikMonitorIntegration SHALL track average_confidence per agent
8. WHEN end_cycle() is called, THE OpikMonitorIntegration SHALL include agent metrics in the cycle summary

### Requirement 7: Cost Tracking

**User Story:** As a system operator, I want accurate cost tracking for LLM usage, so that I can monitor and optimize spending.

#### Acceptance Criteria

1. WHEN an LLM invocation completes, THE Cost_Tracking_System SHALL calculate input token cost
2. WHEN an LLM invocation completes, THE Cost_Tracking_System SHALL calculate output token cost
3. WHEN an LLM invocation completes, THE Cost_Tracking_System SHALL calculate total invocation cost
4. THE Cost_Tracking_System SHALL support Gradient AI pricing models
5. WHEN record_analysis() is called, THE OpikMonitorIntegration SHALL accept a cost parameter
6. WHEN multiple analyses occur in a cycle, THE OpikMonitorIntegration SHALL sum all costs
7. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL return total_cost across all cycles

### Requirement 8: Trace URL Generation

**User Story:** As a developer, I want to generate Opik trace URLs, so that I can quickly navigate to specific analysis traces in the Opik dashboard.

#### Acceptance Criteria

1. WHEN get_trace_url() is called with a condition_id, THE OpikMonitorIntegration SHALL construct a valid Opik trace URL
2. THE Trace_URL SHALL include the workspace from configuration
3. THE Trace_URL SHALL include the project_name from configuration
4. THE Trace_URL SHALL include the condition_id as the trace identifier
5. WHEN OPIK_URL_OVERRIDE is set, THE Trace_URL SHALL use the custom base URL
6. WHEN OPIK_URL_OVERRIDE is not set, THE Trace_URL SHALL use the default Opik cloud URL
7. WHEN record_analysis() is called, THE OpikMonitorIntegration SHALL log the trace URL

### Requirement 9: Metadata and Tagging

**User Story:** As a developer, I want to attach metadata to traces, so that I can filter and analyze traces in the Opik dashboard.

#### Acceptance Criteria

1. WHEN an analysis starts, THE Workflow_System SHALL attach condition_id as metadata
2. WHEN an analysis starts, THE Workflow_System SHALL attach analysis_timestamp as metadata
3. WHEN an agent executes, THE Agent_System SHALL attach agent_name as metadata
4. WHEN an agent executes, THE Agent_System SHALL attach agent_type as metadata
5. WHEN an LLM is invoked, THE System SHALL attach model_name as metadata
6. WHEN an LLM is invoked, THE System SHALL attach temperature as metadata
7. WHEN an LLM is invoked, THE System SHALL attach max_tokens as metadata

### Requirement 10: Error Handling and Graceful Degradation

**User Story:** As a developer, I want Opik integration to fail gracefully, so that observability issues don't break the core workflow.

#### Acceptance Criteria

1. WHEN OpikCallbackHandler creation fails, THE Workflow_System SHALL log a warning and continue without Opik
2. WHEN Opik API calls fail, THE OpikMonitorIntegration SHALL log errors but not raise exceptions
3. WHEN network connectivity to Opik is lost, THE System SHALL continue workflow execution
4. WHEN OPIK_API_KEY is invalid, THE System SHALL log a warning and disable tracking
5. WHEN OpikMonitorIntegration methods are called without an active cycle, THE System SHALL log warnings
6. WHEN trace URL generation fails, THE System SHALL return a fallback message

### Requirement 11: Logging and Debugging

**User Story:** As a developer, I want comprehensive logging for Opik operations, so that I can debug integration issues.

#### Acceptance Criteria

1. WHEN Opik integration is initialized, THE System SHALL log the configuration status
2. WHEN a cycle starts, THE OpikMonitorIntegration SHALL log the cycle_id
3. WHEN an analysis is recorded, THE OpikMonitorIntegration SHALL log the condition_id and trace URL
4. WHEN a cycle ends, THE OpikMonitorIntegration SHALL log cycle summary statistics
5. WHEN Opik operations fail, THE System SHALL log detailed error messages with stack traces
6. WHEN cost tracking is enabled, THE System SHALL log cost information per analysis
7. THE System SHALL use Python's logging module with appropriate log levels (INFO, WARNING, ERROR)

### Requirement 12: Aggregate Metrics

**User Story:** As a system operator, I want aggregate metrics across all cycles, so that I can analyze long-term trends and performance.

#### Acceptance Criteria

1. THE OpikMonitorIntegration SHALL maintain a history of completed cycles
2. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL return total_cycles
3. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL return total_markets_analyzed
4. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL return total_cost
5. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL calculate average_cost_per_market
6. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL calculate average_duration_per_market
7. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL calculate success_rate
8. WHEN get_aggregate_metrics() is called, THE OpikMonitorIntegration SHALL return top_agents ranked by cost

### Requirement 13: Integration with Existing Workflow

**User Story:** As a developer, I want Opik integration to work seamlessly with the existing DOA workflow, so that minimal code changes are required.

#### Acceptance Criteria

1. WHEN the workflow graph is built, THE System SHALL integrate OpikCallbackHandler without modifying node implementations
2. WHEN analyze_market() is called, THE System SHALL automatically track the analysis with Opik
3. WHEN the Gradient ADK entrypoint is invoked, THE System SHALL include Opik tracking
4. THE Opik_Integration SHALL work with the existing MemorySaver checkpointer
5. THE Opik_Integration SHALL work with the existing SQLite checkpointer
6. THE Opik_Integration SHALL work with the existing PostgreSQL checkpointer
7. WHEN database persistence is enabled, THE System SHALL save analysis results independently of Opik tracking

### Requirement 14: Formatting and Display Utilities

**User Story:** As a developer, I want utility functions for formatting metrics, so that I can easily display Opik data in logs and dashboards.

#### Acceptance Criteria

1. THE Opik_Integration_Module SHALL provide a format_cycle_metrics() function
2. WHEN format_cycle_metrics() is called, THE Function SHALL return a human-readable string with cycle statistics
3. THE Opik_Integration_Module SHALL provide a format_aggregate_metrics() function
4. WHEN format_aggregate_metrics() is called, THE Function SHALL return a human-readable string with aggregate statistics
5. THE Formatted_Output SHALL include cycle_id, timestamp, markets analyzed, duration, cost, and success rate
6. THE Formatted_Output SHALL include agent performance breakdown
7. THE Formatted_Output SHALL be suitable for console logging and monitoring dashboards
