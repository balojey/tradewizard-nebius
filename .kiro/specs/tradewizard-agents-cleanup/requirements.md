# Requirements Document

## Introduction

This specification defines the requirements for cleaning up the tradewizard-agents directory by making autonomous agents the default configuration and removing unnecessary documentation files. The cleanup will streamline the codebase, reduce confusion, and establish autonomous mode as the standard operating mode for all agents.

## Glossary

- **Autonomous Agent**: An agent that uses LangChain's tool-calling capabilities to autonomously fetch and analyze data during execution
- **Non-Autonomous Agent**: A legacy agent implementation that relies only on pre-fetched data from workflow state
- **Polling Agent**: An agent that analyzes polling data and market dynamics
- **News Agent**: One of three agents (Breaking News, Media Sentiment, Market Microstructure) that analyze news data
- **Configuration File**: TypeScript files in src/config/ that define agent behavior settings
- **Environment Variable**: Configuration values loaded from .env files
- **Markdown Documentation**: .md files containing project documentation

## Requirements

### Requirement 1: Default Autonomous Mode in Configuration

**User Story:** As a developer, I want autonomous mode to be enabled by default in all agent configurations, so that the system uses the most capable agent implementations without requiring explicit opt-in.

#### Acceptance Criteria

1. THE Polling_Agent_Config SHALL set autonomous to true by default
2. THE News_Agents_Config SHALL set autonomous to true by default for all three news agents
3. WHEN environment variables are not set, THE Configuration_Loader SHALL default autonomous mode to true
4. THE Configuration_Documentation SHALL reflect autonomous mode as the recommended default
5. THE Default_Config_Constants SHALL specify autonomous: true for all agent configurations

### Requirement 2: Environment Variable Default Updates

**User Story:** As a system administrator, I want environment variable examples to show autonomous mode enabled, so that new deployments use the optimal configuration by default.

#### Acceptance Criteria

1. THE .env.example File SHALL show autonomous mode environment variables set to true
2. THE .env.development.example File SHALL show autonomous mode enabled by default
3. THE .env.production.example File SHALL show autonomous mode enabled by default
4. THE .env.staging.example File SHALL show autonomous mode enabled by default
5. THE Environment_Variable_Comments SHALL explain that autonomous mode is now the default

### Requirement 3: Duplicate Agent Implementation Removal

**User Story:** As a developer, I want duplicate non-autonomous implementations of polling and news agents removed from the codebase, so that there is no confusion about which agent implementations to use.

#### Acceptance Criteria

1. WHEN the non-autonomous polling agent implementation exists in agents.ts, THE System SHALL remove createPollingIntelligenceAgentNode function
2. WHEN the non-autonomous news agent implementations exist, THE System SHALL remove createBreakingNewsAgentNode from event-intelligence.ts
3. WHEN the non-autonomous news agent implementations exist, THE System SHALL remove createMediaSentimentAgentNode from sentiment-narrative.ts
4. THE Autonomous_Agent_Files SHALL remain unchanged (autonomous-polling-agent.ts, autonomous-news-agents.ts)
5. THE Other_Agent_Implementations SHALL remain unchanged (probability baseline, risk assessment, and all other agents without autonomous versions)
6. IF shared utility functions exist in agents.ts, THEN THE System SHALL preserve them
7. THE Agent_Node_Exports SHALL reference only autonomous implementations for polling and news agents
8. THE Workflow_Integration SHALL use only autonomous agent nodes for polling and news agents

### Requirement 4: Unnecessary Markdown File Removal

**User Story:** As a developer, I want outdated and unnecessary documentation removed, so that the repository contains only relevant and current documentation.

#### Acceptance Criteria

1. THE System SHALL remove AWS sales pitch files from root directory
2. THE System SHALL remove AWS support case templates from root directory
3. THE System SHALL remove production deployment summary from root directory
4. THE System SHALL preserve critical operational documentation (README.md, DEPLOYMENT.md, CLI.md, CLI-MONITOR.md)
5. THE System SHALL remove all NOVA migration documentation from docs/ directory
6. THE System SHALL remove troubleshooting guides for completed migrations from docs/ directory
7. THE System SHALL remove E2E testing documentation from docs/ directory
8. THE System SHALL remove incident response and monitoring documentation from docs/ directory
9. THE System SHALL preserve essential technical documentation (DEPLOYMENT.md, EXAMPLES.md, RUNBOOK.md, OPIK_GUIDE.md, LLM_PROVIDERS.md)
10. THE System SHALL remove AWS support escalation response from scripts/ directory
11. THE System SHALL remove dashboard setup and deployment complete files from supabase/ directory
12. THE System SHALL preserve supabase/README.md

### Requirement 5: Configuration Consistency

**User Story:** As a developer, I want all configuration loading functions to consistently default to autonomous mode, so that the system behavior is predictable and uniform.

#### Acceptance Criteria

1. THE loadPollingAgentConfig Function SHALL parse environment variables with true as default for autonomous
2. THE loadNewsAgentsConfig Function SHALL parse environment variables with true as default for autonomous
3. THE DEFAULT_POLLING_AGENT_CONFIG Constant SHALL specify autonomous: true
4. THE DEFAULT_NEWS_AGENT_CONFIG Constant SHALL specify autonomous: true
5. THE Configuration_Schema SHALL validate autonomous mode settings correctly

### Requirement 6: Documentation Updates

**User Story:** As a developer, I want configuration documentation to reflect the new defaults, so that I understand the current system behavior without confusion.

#### Acceptance Criteria

1. THE Configuration_File_Comments SHALL state that autonomous mode is enabled by default
2. THE Configuration_Philosophy_Documentation SHALL explain the shift to autonomous-first approach
3. THE Environment_Variable_Documentation SHALL show examples with autonomous mode enabled
4. THE Migration_Guide SHALL explain how to disable autonomous mode if needed
5. THE Configuration_Examples SHALL demonstrate autonomous mode as the standard configuration

### Requirement 7: Backward Compatibility Preservation

**User Story:** As a system administrator, I want the ability to disable autonomous mode via environment variables, so that I can revert to non-autonomous behavior if needed.

#### Acceptance Criteria

1. WHEN POLLING_AGENT_AUTONOMOUS is set to false, THE System SHALL disable autonomous mode for polling agent
2. WHEN any news agent autonomous variable is set to false, THE System SHALL disable autonomous mode for that specific agent
3. THE Fallback_Mechanism SHALL continue to work when autonomous mode is disabled
4. THE Configuration_Validation SHALL accept both true and false values for autonomous settings
5. THE System SHALL log a warning when autonomous mode is explicitly disabled

### Requirement 8: File Removal Safety

**User Story:** As a developer, I want file removal to be safe and reversible, so that no critical functionality is accidentally deleted.

#### Acceptance Criteria

1. THE System SHALL verify that files marked for deletion are not imported by active code
2. THE System SHALL create a list of files to be deleted before removal
3. THE System SHALL preserve all files in the keep list regardless of other criteria
4. IF a file is referenced in active code, THEN THE System SHALL not delete it
5. THE Deletion_Process SHALL be documented for potential rollback

### Requirement 9: Configuration Loading Order

**User Story:** As a developer, I want configuration to load in a predictable order with correct precedence, so that environment variables properly override defaults.

#### Acceptance Criteria

1. THE Configuration_Loader SHALL apply defaults first
2. THE Configuration_Loader SHALL override defaults with environment variables second
3. THE Configuration_Loader SHALL validate the final configuration third
4. WHEN environment variables are missing, THE System SHALL use the new autonomous-enabled defaults
5. THE Configuration_Precedence SHALL be documented clearly

### Requirement 10: Testing Configuration Changes

**User Story:** As a developer, I want to verify that configuration changes work correctly, so that the system behaves as expected after the cleanup.

#### Acceptance Criteria

1. THE System SHALL load configuration successfully with no environment variables set
2. THE System SHALL default to autonomous mode when no explicit configuration is provided
3. THE System SHALL respect explicit autonomous=false environment variables
4. THE Configuration_Validation SHALL pass with the new defaults
5. THE Agent_Initialization SHALL succeed with autonomous mode enabled by default
