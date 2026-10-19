# Implementation Plan: Amazon Nova Integration

## Overview

This implementation plan breaks down the Amazon Nova integration into discrete, incremental tasks. Each task builds on previous work, with testing integrated throughout to catch errors early. The implementation follows TradeWizard's established patterns for multi-provider LLM support while adding AWS Bedrock-specific functionality.

## Tasks

- [x] 1. Set up AWS SDK dependencies and project configuration
  - Install @aws-sdk/client-bedrock-runtime and @aws-sdk/credential-providers packages
  - Install @langchain/community for BedrockChat integration
  - Update package.json with new dependencies
  - Add Nova-specific environment variables to .env.example with documentation
  - _Requirements: 1.1, 4.1, 4.2, 8.2_

- [x] 2. Implement Bedrock client module
  - [x] 2.1 Create BedrockClient class with AWS authentication
    - Implement constructor accepting NovaModelConfig
    - Set up BedrockRuntimeClient with region and credentials
    - Handle both explicit credentials and AWS default credential chain
    - _Requirements: 1.1, 1.4_
  
  - [x] 2.2 Implement model instantiation method
    - Create createChatModel() method returning BaseChatModel
    - Integrate with LangChain's BedrockChat wrapper
    - Apply configuration parameters (temperature, maxTokens, topP)
    - _Requirements: 1.5, 2.1, 2.2, 2.3_
  
  - [x] 2.3 Add connection validation
    - Implement validateConnection() method with AWS API health check
    - Return descriptive errors for authentication failures
    - Handle region availability checks
    - _Requirements: 1.2, 7.5_
  
  - [x] 2.4 Add model metadata utilities
    - Implement getAvailableModels() static method with pricing data
    - Implement validateModelId() static method
    - Define NovaModelVariant interface with pricing information
    - _Requirements: 2.4, 2.5, 6.2_
  
  - [ ]* 2.5 Write unit tests for BedrockClient
    - Test successful authentication with valid credentials
    - Test error handling for invalid credentials
    - Test model instantiation for all three variants (Micro, Lite, Pro)
    - Test connection validation
    - Use mock Bedrock responses to avoid API costs
    - _Requirements: 9.1, 9.2, 9.5_
  
  - [ ]* 2.6 Write property test for AWS authentication
    - **Property 1: AWS Authentication Success**
    - **Validates: Requirements 1.1**
  
  - [ ]* 2.7 Write property test for invalid credentials rejection
    - **Property 2: Invalid Credentials Rejection**
    - **Validates: Requirements 1.2**
  
  - [ ]* 2.8 Write property test for request format compliance
    - **Property 3: Request Format Compliance**
    - **Validates: Requirements 1.5**

- [x] 3. Implement error handling module
  - [x] 3.1 Create BedrockError class and error codes
    - Define BedrockErrorCode enum with all error types
    - Implement BedrockError class extending Error
    - Add getUserMessage() method with troubleshooting steps
    - Add shouldRetry() method for retry logic determination
    - _Requirements: 7.3, 7.4, 7.5_
  
  - [x] 3.2 Implement BedrockErrorHandler utilities
    - Create withErrorHandling() wrapper for Bedrock operations
    - Implement retryWithBackoff() with exponential backoff
    - Implement fromAWSError() to convert AWS SDK errors
    - Define retry configuration with sensible defaults
    - _Requirements: 7.1, 7.2_
  
  - [ ]* 3.3 Write unit tests for error handling
    - Test error classification (transient vs permanent)
    - Test retry logic with mock failures
    - Test exponential backoff timing
    - Test error message generation
    - _Requirements: 9.1_
  
  - [ ]* 3.4 Write property test for exponential backoff
    - **Property 18: Exponential Backoff Implementation**
    - **Validates: Requirements 7.1**
  
  - [ ]* 3.5 Write property test for error classification
    - **Property 20: Error Classification Correctness**
    - **Validates: Requirements 7.4**

- [x] 4. Checkpoint - Verify Bedrock client functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement configuration management
  - [x] 5.1 Create LLMConfigManager class
    - Implement loadFromEnvironment() to read all LLM provider configs
    - Implement validate() for complete configuration validation
    - Implement getAgentConfig() for agent-specific config resolution
    - Implement isNovaConfigured() and getMissingVariables() helpers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  
  - [x] 5.2 Define Zod schemas for Nova configuration
    - Create NovaModelVariantSchema with three model options
    - Create NovaConfigSchema with all Nova-specific fields
    - Extend LLMConfigSchema to include Nova as discriminated union
    - Create AgentLLMConfigSchema for multi-agent configurations
    - _Requirements: 2.5, 4.5_
  
  - [ ]* 5.3 Write unit tests for configuration management
    - Test environment variable loading
    - Test configuration validation with valid inputs
    - Test missing required variable detection
    - Test default value application
    - Test agent-specific config resolution
    - _Requirements: 9.1, 9.3_
  
  - [ ]* 5.4 Write property test for configuration validation
    - **Property 10: Configuration Validation Before Instantiation**
    - **Validates: Requirements 3.5**
  
  - [ ]* 5.5 Write property test for default parameters
    - **Property 11: Default Parameter Application**
    - **Validates: Requirements 4.4**
  
  - [ ]* 5.6 Write property test for missing configuration detection
    - **Property 12: Missing Required Configuration Detection**
    - **Validates: Requirements 4.5**

- [x] 6. Extend LLM factory to support Nova
  - [x] 6.1 Add Nova provider to LLMFactory
    - Add "nova" to LLMProvider type union
    - Add Nova case to createLLM() switch statement
    - Delegate Nova instantiation to BedrockClient
    - Validate Nova configuration before instantiation
    - _Requirements: 3.1, 3.5_
  
  - [x] 6.2 Implement parameter application for Nova models
    - Apply temperature, maxTokens, topP from configuration
    - Handle optional parameters with defaults
    - Ensure parameters are passed to BedrockChat correctly
    - _Requirements: 3.2, 4.4_
  
  - [x] 6.3 Add multi-provider support for Nova
    - Update createAgentLLMs() to handle Nova in agent configs
    - Support mixed configurations (Nova + other providers)
    - Maintain backward compatibility with existing providers
    - _Requirements: 3.3, 3.4, 5.2, 10.1, 10.3_
  
  - [ ]* 6.4 Write unit tests for LLM factory Nova integration
    - Test Nova model instantiation for all variants
    - Test parameter application
    - Test mixed-provider configurations
    - Test backward compatibility with existing providers
    - _Requirements: 9.1_
  
  - [ ]* 6.5 Write property test for factory model mapping
    - **Property 4: Factory Model Mapping**
    - **Validates: Requirements 2.4**
  
  - [ ]* 6.6 Write property test for invalid model rejection
    - **Property 5: Invalid Model Name Rejection**
    - **Validates: Requirements 2.5**
  
  - [ ]* 6.7 Write property test for LangChain interface compliance
    - **Property 6: LangChain Interface Compliance**
    - **Validates: Requirements 3.1**
  
  - [ ]* 6.8 Write property test for parameter application
    - **Property 7: Parameter Application**
    - **Validates: Requirements 3.2**
  
  - [ ]* 6.9 Write property test for backward compatibility
    - **Property 8: Backward Compatibility Preservation**
    - **Validates: Requirements 3.3**
  
  - [ ]* 6.10 Write property test for mixed provider support
    - **Property 9: Mixed Provider Support**
    - **Validates: Requirements 3.4, 5.2, 10.3**

- [x] 7. Checkpoint - Verify factory integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Extend cost tracking for Nova
  - [x] 8.1 Add Nova pricing data to CostTracker
    - Define pricing constants for Nova Micro, Lite, Pro
    - Implement getNovaPricing() static method
    - Update calculateCost() to handle Nova provider
    - _Requirements: 6.2_
  
  - [x] 8.2 Implement Nova usage recording
    - Update recordUsage() to accept Nova provider
    - Capture Nova-specific metadata (model variant, agent name)
    - Calculate costs using Nova pricing tiers
    - _Requirements: 6.1, 6.4_
  
  - [x] 8.3 Add Nova cost reporting
    - Update getCostsByProvider() to include Nova
    - Add Nova-specific cost breakdown by model variant
    - Include Nova in analysis history queries
    - _Requirements: 6.5_
  
  - [ ]* 8.4 Write unit tests for Nova cost tracking
    - Test cost calculation for each Nova variant
    - Test usage recording with Nova metadata
    - Test cost reporting and aggregation
    - _Requirements: 9.1_
  
  - [ ]* 8.5 Write property test for token usage recording
    - **Property 15: Token Usage Recording**
    - **Validates: Requirements 6.1**
  
  - [ ]* 8.6 Write property test for cost calculation accuracy
    - **Property 16: Cost Calculation Accuracy**
    - **Validates: Requirements 6.2**
  
  - [ ]* 8.7 Write property test for observability metadata
    - **Property 17: Observability Metadata Completeness**
    - **Validates: Requirements 6.4**

- [x] 9. Integrate Nova with Opik observability
  - [x] 9.1 Extend Opik tracing for Nova
    - Add Nova provider tag to Opik traces
    - Include Nova model variant in trace metadata
    - Track Nova-specific metrics (latency, token counts, costs)
    - _Requirements: 6.3, 6.4_
  
  - [x] 9.2 Implement trackNovaInvocation helper
    - Create utility function for Nova-specific Opik tracking
    - Include all required metadata fields
    - Calculate and include cost information
    - _Requirements: 6.3_
  
  - [ ]* 9.3 Write unit tests for Opik integration
    - Test trace creation with Nova metadata
    - Test cost calculation in traces
    - Test trace filtering by Nova provider
    - _Requirements: 9.1_

- [x] 10. Update agent nodes to support Nova
  - [x] 10.1 Update workflow.ts to use LLMConfigManager
    - Replace hardcoded provider logic with LLMConfigManager
    - Load agent-specific configurations from environment
    - Pass correct LLM instances to each agent node
    - _Requirements: 5.1, 5.3_
  
  - [x] 10.2 Verify agent node compatibility
    - Test each agent node (News, Polling, Market, Sentiment, Risk) with Nova
    - Ensure input/output interfaces remain consistent
    - Verify state management works across providers
    - _Requirements: 5.1, 5.3, 5.5_
  
  - [ ]* 10.3 Write property test for provider interface consistency
    - **Property 13: Provider Interface Consistency**
    - **Validates: Requirements 5.3**
  
  - [ ]* 10.4 Write property test for state consistency
    - **Property 14: State Consistency Across Providers**
    - **Validates: Requirements 5.5**

- [x] 11. Checkpoint - Verify end-to-end workflow
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Add CLI support for Nova
  - [x] 12.1 Update CLI to support Nova configuration
    - Add Nova-specific command-line flags
    - Update help text to include Nova options
    - Maintain consistent CLI interface across providers
    - _Requirements: 10.5_
  
  - [x] 12.2 Add Nova status command
    - Implement command to check Nova configuration
    - Display available Nova models and pricing
    - Show current Nova usage statistics
    - _Requirements: 8.2, 8.3_
  
  - [ ]* 12.3 Write property test for CLI interface consistency
    - **Property 22: CLI Interface Consistency**
    - **Validates: Requirements 10.5**

- [x] 13. Create documentation
  - [x] 13.1 Create LLM_PROVIDERS.md documentation
    - Document all supported providers including Nova
    - Include setup instructions for AWS Bedrock
    - Provide configuration examples for each provider
    - Document pricing comparison
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 13.2 Update .env.example with Nova variables
    - Add all Nova environment variables with comments
    - Provide example values for each variable
    - Document optional vs required variables
    - Include multi-provider configuration examples
    - _Requirements: 8.2_
  
  - [x] 13.3 Create troubleshooting guide
    - Document common Nova integration issues
    - Provide solutions for authentication errors
    - Include IAM permission requirements
    - Add debugging tips for configuration problems
    - _Requirements: 8.4, 8.5_
  
  - [x] 13.4 Update README.md and DEPLOYMENT.md
    - Add Nova to supported providers list in README
    - Add AWS Bedrock setup section to DEPLOYMENT.md
    - Include migration guide for existing deployments
    - Document cost optimization strategies
    - _Requirements: 8.1, 8.3_

- [ ] 14. Integration and end-to-end testing
  - [ ]* 14.1 Write integration tests for Nova workflow
    - Test complete analysis workflow using Nova models
    - Test mixed-provider workflow (Nova + other providers)
    - Test error recovery and retry logic
    - Use mock Bedrock responses to avoid API costs
    - _Requirements: 9.2, 9.4, 9.5_
  
  - [ ]* 14.2 Write property test for structured error response
    - **Property 19: Structured Error Response**
    - **Validates: Requirements 7.3**
  
  - [ ]* 14.3 Write property test for authentication error messages
    - **Property 21: Authentication Error Actionability**
    - **Validates: Requirements 7.5**
  
  - [ ]* 14.4 Create end-to-end test script with real AWS credentials
    - Create script for testing with actual Bedrock API
    - Test all three Nova model variants
    - Verify cost tracking accuracy
    - Document test account setup requirements
    - _Requirements: 9.4_

- [x] 15. Final checkpoint - Complete integration verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify documentation is complete and accurate
  - Confirm backward compatibility with existing configurations
  - Validate cost tracking and observability

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples, edge cases, and error conditions
- Mock Bedrock responses are used in tests to avoid AWS API costs
- Integration tests with real AWS credentials should run in a dedicated test account
- All Nova-specific code follows TradeWizard's existing patterns for multi-provider support
