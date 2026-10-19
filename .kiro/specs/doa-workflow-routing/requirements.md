# Requirements Document

## Introduction

This document specifies the requirements for integrating Digital Ocean Agent (DOA) workflow execution into the TradeWizard backend system. The feature enables the system to execute market analysis workflows via HTTP requests to a remote service URL, abstracting away whether the workflow runs locally or remotely.

## Glossary

- **DOA**: Digital Ocean Agent - A remote service that executes the TradeWizard market analysis workflow
- **Workflow_Client**: HTTP client that sends analysis requests to a workflow service URL
- **CLI**: Command-line interface for manual market analysis
- **Monitor_Service**: Automated service that continuously discovers and analyzes markets
- **Analysis_Result**: The output from market analysis containing recommendation, agent signals, and cost
- **Bearer_Token**: Authentication token passed in Authorization header for workflow requests
- **Workflow_URL**: The HTTP endpoint where workflow execution requests are sent

## Requirements

### Requirement 1: Workflow URL Configuration

**User Story:** As a system administrator, I want to configure a workflow service URL, so that the system can send analysis requests to any workflow endpoint.

#### Acceptance Criteria

1. THE Configuration SHALL include a workflow URL field that accepts valid HTTP/HTTPS URLs
2. WHEN the workflow URL is not set, THE System SHALL execute workflows using the existing local implementation
3. WHEN the workflow URL is set, THE System SHALL send all analysis requests to that URL via HTTP
4. THE Configuration SHALL validate that the workflow URL is a valid URL format before accepting it
5. THE Configuration SHALL load the workflow URL from the WORKFLOW_SERVICE_URL environment variable

### Requirement 2: Workflow HTTP Client Implementation

**User Story:** As a developer, I want a robust HTTP client for workflow communication, so that the system can reliably send analysis requests to the workflow service.

#### Acceptance Criteria

1. THE Workflow_Client SHALL send HTTP POST requests to the configured workflow service URL
2. WHEN sending requests, THE Workflow_Client SHALL include the Bearer token from DIGITALOCEAN_API_TOKEN in the Authorization header
3. THE Workflow_Client SHALL send the condition ID in the request body as JSON with the field name "conditionId"
4. THE Workflow_Client SHALL parse the response body as JSON containing the Analysis_Result
5. WHEN the workflow service returns a 2xx status code, THE Workflow_Client SHALL return the parsed Analysis_Result
6. WHEN the workflow service returns a non-2xx status code, THE Workflow_Client SHALL throw an error with the status code and response body
7. WHEN the request times out, THE Workflow_Client SHALL throw a timeout error
8. THE Workflow_Client SHALL set a configurable timeout for requests with a default of 120 seconds
9. THE Workflow_Client SHALL include appropriate Content-Type headers (application/json) in requests

### Requirement 3: CLI Integration

**User Story:** As a user, I want the CLI analyze command to use the configured workflow service, so that I can manually trigger analysis regardless of where the workflow runs.

#### Acceptance Criteria

1. WHEN a workflow URL is configured and the user runs the analyze command, THE CLI SHALL send the request to the workflow URL
2. WHEN no workflow URL is configured and the user runs the analyze command, THE CLI SHALL execute the local workflow
3. WHEN using a workflow URL and the request succeeds, THE CLI SHALL display the recommendation exactly as it does for local execution
4. WHEN using a workflow URL and the request fails, THE CLI SHALL display a clear error message indicating the workflow service is unavailable
5. THE CLI SHALL log whether it is using a workflow URL or local execution at the start of analysis

### Requirement 4: Monitor Service Integration

**User Story:** As a system operator, I want the monitoring service to use the configured workflow service, so that automated market analysis works regardless of where the workflow runs.

#### Acceptance Criteria

1. WHEN a workflow URL is configured, THE Monitor_Service SHALL send all analysis requests to the workflow URL
2. WHEN no workflow URL is configured, THE Monitor_Service SHALL execute the local workflow
3. WHEN using a workflow URL and a request fails, THE Monitor_Service SHALL log the error and continue monitoring other markets
4. THE Monitor_Service SHALL track workflow request failures in its health status metrics
5. WHEN a workflow URL is configured, THE Monitor_Service SHALL include workflow service connectivity status in its health check endpoint

### Requirement 5: Error Handling and Resilience

**User Story:** As a system operator, I want graceful error handling for workflow service failures, so that temporary service issues don't crash the system.

#### Acceptance Criteria

1. WHEN the workflow service is unreachable, THE System SHALL log a descriptive error message
2. WHEN the workflow service returns an error response, THE System SHALL log the error details including status code and message
3. WHEN authentication fails (401/403), THE System SHALL log that the Bearer token may be invalid
4. WHEN the request times out, THE System SHALL log a timeout error with the configured timeout duration
5. THE System SHALL NOT automatically fall back to local execution when a workflow URL is configured
6. WHEN a workflow service request fails, THE System SHALL propagate the error to the caller for appropriate handling

### Requirement 6: Authentication

**User Story:** As a security-conscious administrator, I want all workflow service requests to be authenticated, so that only authorized systems can execute workflows.

#### Acceptance Criteria

1. THE Workflow_Client SHALL read the authentication token from the DIGITALOCEAN_API_TOKEN environment variable
2. WHEN DIGITALOCEAN_API_TOKEN is not set and a workflow URL is configured, THE System SHALL log an error and fail the request
3. THE Workflow_Client SHALL format the Authorization header as "Bearer {token}"
4. THE Workflow_Client SHALL NOT log or expose the authentication token in error messages or logs

### Requirement 7: Response Format Compatibility

**User Story:** As a developer, I want workflow service responses to match local workflow output, so that the rest of the system works identically regardless of execution mode.

#### Acceptance Criteria

1. THE workflow service response SHALL contain a recommendation object matching the TradeRecommendation type
2. THE workflow service response SHALL contain an agentSignals array matching the AgentSignal type
3. THE workflow service response SHALL contain a cost number representing the analysis cost
4. WHEN the workflow service response is missing required fields, THE Workflow_Client SHALL throw a validation error
5. THE Workflow_Client SHALL validate the response structure before returning it to the caller

### Requirement 8: Configuration Schema

**User Story:** As a developer, I want workflow service configuration to follow the existing configuration patterns, so that it integrates seamlessly with the rest of the system.

#### Acceptance Criteria

1. THE Configuration SHALL add a new "workflowService" section to the EngineConfig schema
2. THE "workflowService" section SHALL include a "url" string field that is optional
3. THE "workflowService" section SHALL include a "timeoutMs" number field with a default value of 120000
4. THE Configuration SHALL load workflow service settings from environment variables (WORKFLOW_SERVICE_URL, WORKFLOW_SERVICE_TIMEOUT_MS)
5. WHEN the workflow service URL is set, THE Configuration SHALL validate it is a valid HTTP/HTTPS URL

### Requirement 9: Logging and Observability

**User Story:** As a system operator, I want clear logging for workflow execution, so that I can troubleshoot issues and monitor system behavior.

#### Acceptance Criteria

1. WHEN a workflow URL is configured, THE System SHALL log "Using workflow service at {url}" at startup
2. WHEN no workflow URL is configured, THE System SHALL log "Using local workflow execution" at startup
3. WHEN sending a workflow service request, THE System SHALL log the condition ID being analyzed
4. WHEN a workflow service request succeeds, THE System SHALL log the response time and success status
5. WHEN a workflow service request fails, THE System SHALL log the error type, status code (if applicable), and error message
6. THE System SHALL include workflow service status in the Monitor_Service health check response

### Requirement 10: Backward Compatibility

**User Story:** As an existing user, I want the system to continue working exactly as before when no workflow URL is configured, so that I don't need to change my setup.

#### Acceptance Criteria

1. WHEN no workflow URL is configured in environment variables, THE System SHALL default to local workflow execution
2. THE System SHALL behave identically to the current implementation when no workflow URL is set
3. THE System SHALL NOT require any code changes to existing workflow, CLI, or monitor implementations beyond routing logic
4. THE local workflow execution path SHALL remain unchanged and fully functional
5. THE System SHALL NOT introduce any new required environment variables for users who don't use a workflow service URL
