# Design Document: Opik Observability Integration for DOA

## Overview

This design document specifies the implementation of Opik observability integration for the DOA (Debate-Oriented Agents) Python project. The integration provides comprehensive LLM tracing, cost tracking, and performance monitoring for the multi-agent market analysis workflow.

The design follows the established patterns from tradewizard-agents TypeScript implementation, adapted for Python with LangChain/LangGraph and the Gradient AI platform.

### Key Design Goals

1. **Automatic LLM Tracing**: All LangChain/LangGraph LLM invocations automatically traced via OpikCallbackHandler
2. **Custom Metrics Tracking**: Analysis cycles, agent performance, and cost metrics tracked via OpikMonitorIntegration
3. **Minimal Code Changes**: Integration through configuration and callback handlers without modifying existing nodes
4. **Graceful Degradation**: Observability failures don't break core workflow functionality
5. **Type Safety**: Dataclasses and type hints for all configuration and metrics

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     DOA Workflow                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         LangGraph Workflow Execution                 │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐   │  │
│  │  │ Node 1 │→ │ Node 2 │→ │ Node 3 │→ │ Node N │   │  │
│  │  └────────┘  └────────┘  └────────┘  └────────┘   │  │
│  │       ↓           ↓           ↓           ↓         │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │      OpikCallbackHandler (Automatic)        │  │  │
│  │  │  - Traces all LLM invocations               │  │
│  │  │  - Records tokens, latency, costs           │  │
│  │  │  - Sends to Opik platform                   │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │    OpikMonitorIntegration (Custom Metrics)          │  │
│  │  - Tracks analysis cycles                           │  │
│  │  - Records agent performance                        │  │
│  │  - Aggregates costs and durations                   │  │
│  │  - Generates trace URLs                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
                  ┌────────────────┐
                  │  Opik Platform │
                  │  - Traces      │
                  │  - Metrics     │
                  │  - Dashboard   │
                  └────────────────┘
```

### Integration Points

1. **Configuration Layer** (`config.py`): Add OpikConfig dataclass
2. **Workflow Layer** (`main.py`): Create and pass OpikCallbackHandler
3. **Monitoring Layer** (new `utils/opik_integration.py`): Custom metrics tracking
4. **Environment** (`.env`): Opik configuration variables

## Components and Interfaces

### 1. Configuration Module (`config.py`)

#### OpikConfig Dataclass

```python
@dataclass
class OpikConfig:
    """Opik observability configuration."""
    api_key: Optional[str]
    project_name: str
    workspace: Optional[str]
    base_url: Optional[str]
    track_costs: bool
    
    def validate(self) -> List[str]:
        """Validate Opik configuration."""
        errors = []
        
        if self.api_key and not self.api_key.strip():
            errors.append("OPIK_API_KEY must be non-empty if provided")
        
        if not self.project_name or not self.project_name.strip():
            errors.append("OPIK_PROJECT_NAME is required")
        
        if self.base_url and not self.base_url.startswith(("http://", "https://")):
            errors.append("OPIK_BASE_URL must be a valid URL")
        
        return errors
    
    def is_enabled(self) -> bool:
        """Check if Opik tracking is enabled."""
        return bool(self.api_key and self.api_key.strip())
```

#### EngineConfig Extension

```python
@dataclass
class EngineConfig:
    # ... existing fields ...
    opik: OpikConfig
    
    def validate(self) -> None:
        """Validate all configuration sections."""
        all_errors = []
        # ... existing validations ...
        all_errors.extend(self.opik.validate())
        
        if all_errors:
            raise ConfigurationError(...)
```

#### Configuration Loading

```python
def load_config() -> EngineConfig:
    """Load configuration from environment variables."""
    # ... existing code ...
    
    # Opik configuration
    opik = OpikConfig(
        api_key=os.getenv("OPIK_API_KEY"),
        project_name=os.getenv("OPIK_PROJECT_NAME", "doa-market-analysis"),
        workspace=os.getenv("OPIK_WORKSPACE"),
        base_url=os.getenv("OPIK_URL_OVERRIDE"),
        track_costs=os.getenv("OPIK_TRACK_COSTS", "true").lower() == "true"
    )
    
    config = EngineConfig(
        # ... existing fields ...
        opik=opik
    )
    
    config.validate()
    return config
```

### 2. Opik Integration Module (`utils/opik_integration.py`)

#### Data Models

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime

@dataclass
class AgentCycleMetrics:
    """Agent performance metrics per cycle."""
    agent_name: str
    execution_count: int = 0
    total_duration: float = 0.0
    average_duration: float = 0.0
    total_cost: float = 0.0
    average_cost: float = 0.0
    success_count: int = 0
    error_count: int = 0
    average_confidence: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0

@dataclass
class AnalysisCycleMetrics:
    """Analysis cycle metrics for Opik tracking."""
    cycle_id: str
    timestamp: int
    markets_discovered: int = 0
    markets_analyzed: int = 0
    markets_updated: int = 0
    total_duration: float = 0.0
    total_cost: float = 0.0
    success_count: int = 0
    error_count: int = 0
    agent_metrics: Dict[str, AgentCycleMetrics] = field(default_factory=dict)

@dataclass
class AggregateMetrics:
    """Aggregate metrics across all cycles."""
    total_cycles: int
    total_markets_analyzed: int
    total_cost: float
    average_cost_per_market: float
    average_duration_per_market: float
    success_rate: float
    top_agents: List[Dict[str, any]]
```

#### OpikMonitorIntegration Class

```python
import logging
from typing import Optional, List
from opik.integrations.langchain import OpikCallbackHandler

logger = logging.getLogger(__name__)

class OpikMonitorIntegration:
    """Opik integration manager for DOA workflow."""
    
    def __init__(self, config: 'EngineConfig'):
        """Initialize Opik integration with configuration."""
        self.config = config
        self.current_cycle_metrics: Optional[AnalysisCycleMetrics] = None
        self.cycle_history: List[AnalysisCycleMetrics] = []
        
        if config.opik.is_enabled():
            logger.info(f"Opik integration enabled for project: {config.opik.project_name}")
        else:
            logger.info("Opik integration disabled (no API key)")
    
    def create_opik_handler(self) -> Optional[OpikCallbackHandler]:
        """
        Create Opik callback handler for workflow execution.
        
        Returns:
            OpikCallbackHandler if enabled, None otherwise
        """
        if not self.config.opik.is_enabled():
            return None
        
        try:
            handler = OpikCallbackHandler(
                project_name=self.config.opik.project_name,
                workspace=self.config.opik.workspace,
            )
            logger.info("OpikCallbackHandler created successfully")
            return handler
        except Exception as e:
            logger.error(f"Failed to create OpikCallbackHandler: {e}", exc_info=True)
            return None
    
    def start_cycle(self) -> str:
        """
        Start tracking an analysis cycle.
        
        Returns:
            Unique cycle ID
        """
        import time
        
        cycle_id = f"cycle_{int(time.time() * 1000)}"
        self.current_cycle_metrics = AnalysisCycleMetrics(
            cycle_id=cycle_id,
            timestamp=int(time.time() * 1000)
        )
        
        logger.info(f"[OpikMonitor] Started tracking cycle: {cycle_id}")
        return cycle_id
    
    def record_discovery(self, market_count: int) -> None:
        """Record market discovery in current cycle."""
        if not self.current_cycle_metrics:
            logger.warning("[OpikMonitor] No active cycle to record discovery")
            return
        
        self.current_cycle_metrics.markets_discovered = market_count
        logger.info(f"[OpikMonitor] Recorded discovery: {market_count} markets")
    
    def record_analysis(
        self,
        condition_id: str,
        duration: float,
        cost: float,
        success: bool,
        agent_signals: Optional[List['AgentSignal']] = None,
        error: Optional[str] = None
    ) -> None:
        """
        Record market analysis in current cycle.
        
        Args:
            condition_id: Market condition ID
            duration: Analysis duration in milliseconds
            cost: Analysis cost in USD
            success: Whether analysis succeeded
            agent_signals: List of agent signals from analysis
            error: Error message if analysis failed
        """
        if not self.current_cycle_metrics:
            logger.warning("[OpikMonitor] No active cycle to record analysis")
            return
        
        # Update cycle totals
        self.current_cycle_metrics.markets_analyzed += 1
        self.current_cycle_metrics.total_duration += duration
        self.current_cycle_metrics.total_cost += cost
        
        if success:
            self.current_cycle_metrics.success_count += 1
        else:
            self.current_cycle_metrics.error_count += 1
        
        # Update agent metrics
        if agent_signals:
            for signal in agent_signals:
                self._update_agent_metrics(signal, duration, cost, success)
        
        # Log trace URL
        trace_url = self.get_trace_url(condition_id)
        logger.info(f"[OpikMonitor] Analysis recorded: {condition_id}")
        logger.info(f"[OpikMonitor] Opik Trace: {trace_url}")
        
        if error:
            logger.error(f"[OpikMonitor] Analysis error: {error}")
    
    def record_update(self, condition_id: str) -> None:
        """Record market update in current cycle."""
        if not self.current_cycle_metrics:
            logger.warning("[OpikMonitor] No active cycle to record update")
            return
        
        self.current_cycle_metrics.markets_updated += 1
        logger.info(f"[OpikMonitor] Recorded update: {condition_id}")
    
    def end_cycle(self) -> Optional[AnalysisCycleMetrics]:
        """
        End current cycle and store metrics.
        
        Returns:
            Completed cycle metrics or None if no active cycle
        """
        if not self.current_cycle_metrics:
            logger.warning("[OpikMonitor] No active cycle to end")
            return None
        
        metrics = self.current_cycle_metrics
        self.cycle_history.append(metrics)
        
        # Keep only last 100 cycles
        if len(self.cycle_history) > 100:
            self.cycle_history.pop(0)
        
        logger.info(f"[OpikMonitor] Cycle ended: {metrics.cycle_id}")
        logger.info(f"[OpikMonitor] Cycle summary: "
                   f"discovered={metrics.markets_discovered}, "
                   f"analyzed={metrics.markets_analyzed}, "
                   f"updated={metrics.markets_updated}, "
                   f"duration={metrics.total_duration / 1000:.2f}s, "
                   f"cost=${metrics.total_cost:.4f}, "
                   f"success={metrics.success_count}, "
                   f"errors={metrics.error_count}")
        
        self.current_cycle_metrics = None
        return metrics
    
    def get_current_cycle_metrics(self) -> Optional[AnalysisCycleMetrics]:
        """Get current cycle metrics."""
        return self.current_cycle_metrics
    
    def get_cycle_history(self) -> List[AnalysisCycleMetrics]:
        """Get cycle history."""
        return self.cycle_history.copy()
    
    def get_aggregate_metrics(self) -> AggregateMetrics:
        """
        Get aggregate metrics across all cycles.
        
        Returns:
            Aggregate metrics summary
        """
        if not self.cycle_history:
            return AggregateMetrics(
                total_cycles=0,
                total_markets_analyzed=0,
                total_cost=0.0,
                average_cost_per_market=0.0,
                average_duration_per_market=0.0,
                success_rate=0.0,
                top_agents=[]
            )
        
        total_markets = sum(c.markets_analyzed for c in self.cycle_history)
        total_cost = sum(c.total_cost for c in self.cycle_history)
        total_duration = sum(c.total_duration for c in self.cycle_history)
        total_success = sum(c.success_count for c in self.cycle_history)
        total_errors = sum(c.error_count for c in self.cycle_history)
        
        # Aggregate agent metrics
        agent_aggregates: Dict[str, Dict[str, float]] = {}
        
        for cycle in self.cycle_history:
            for agent_name, metrics in cycle.agent_metrics.items():
                if agent_name not in agent_aggregates:
                    agent_aggregates[agent_name] = {
                        'total_cost': 0.0,
                        'total_duration': 0.0,
                        'count': 0
                    }
                agent_aggregates[agent_name]['total_cost'] += metrics.total_cost
                agent_aggregates[agent_name]['total_duration'] += metrics.total_duration
                agent_aggregates[agent_name]['count'] += metrics.execution_count
        
        # Calculate top agents
        top_agents = [
            {
                'agent_name': name,
                'average_cost': data['total_cost'] / data['count'],
                'average_duration': data['total_duration'] / data['count']
            }
            for name, data in agent_aggregates.items()
        ]
        top_agents.sort(key=lambda x: x['average_cost'], reverse=True)
        top_agents = top_agents[:10]
        
        return AggregateMetrics(
            total_cycles=len(self.cycle_history),
            total_markets_analyzed=total_markets,
            total_cost=total_cost,
            average_cost_per_market=total_cost / total_markets if total_markets > 0 else 0.0,
            average_duration_per_market=total_duration / total_markets if total_markets > 0 else 0.0,
            success_rate=total_success / (total_success + total_errors) if (total_success + total_errors) > 0 else 0.0,
            top_agents=top_agents
        )
    
    def get_trace_url(self, condition_id: str) -> str:
        """
        Get Opik trace URL for a market analysis.
        
        Args:
            condition_id: Market condition ID
            
        Returns:
            Opik dashboard URL for the trace
        """
        base_url = self.config.opik.base_url or "https://www.comet.com/opik"
        workspace = self.config.opik.workspace or "default"
        project_name = self.config.opik.project_name
        
        return f"{base_url}/{workspace}/projects/{project_name}/traces?search={condition_id}"
    
    def log_dashboard_link(self) -> None:
        """Log Opik dashboard link."""
        base_url = self.config.opik.base_url or "https://www.comet.com/opik"
        workspace = self.config.opik.workspace or "default"
        project_name = self.config.opik.project_name
        
        dashboard_url = f"{base_url}/{workspace}/projects/{project_name}"
        logger.info(f"[OpikMonitor] Opik Dashboard: {dashboard_url}")
    
    def _update_agent_metrics(
        self,
        signal: 'AgentSignal',
        duration: float,
        cost: float,
        success: bool
    ) -> None:
        """Update agent metrics in current cycle."""
        if not self.current_cycle_metrics:
            return
        
        agent_name = signal.agent_name
        metrics = self.current_cycle_metrics.agent_metrics.get(agent_name)
        
        if metrics is None:
            metrics = AgentCycleMetrics(agent_name=agent_name)
            self.current_cycle_metrics.agent_metrics[agent_name] = metrics
        
        # Update counts
        metrics.execution_count += 1
        if success:
            metrics.success_count += 1
        else:
            metrics.error_count += 1
        
        # Update totals
        metrics.total_duration += duration
        metrics.total_cost += cost
        
        # Update averages
        metrics.average_duration = metrics.total_duration / metrics.execution_count
        metrics.average_cost = metrics.total_cost / metrics.execution_count
        
        # Update confidence (running average)
        n = metrics.execution_count
        metrics.average_confidence = (
            (metrics.average_confidence * (n - 1) + signal.confidence) / n
        )


def create_opik_monitor_integration(config: 'EngineConfig') -> OpikMonitorIntegration:
    """Create Opik monitor integration instance."""
    return OpikMonitorIntegration(config)
```

#### Formatting Utilities

```python
def format_cycle_metrics(metrics: AnalysisCycleMetrics) -> str:
    """
    Format cycle metrics for logging.
    
    Args:
        metrics: Cycle metrics to format
        
    Returns:
        Human-readable string representation
    """
    from datetime import datetime
    
    lines = [
        f"Cycle: {metrics.cycle_id}",
        f"Timestamp: {datetime.fromtimestamp(metrics.timestamp / 1000).isoformat()}",
        f"Markets Discovered: {metrics.markets_discovered}",
        f"Markets Analyzed: {metrics.markets_analyzed}",
        f"Markets Updated: {metrics.markets_updated}",
        f"Total Duration: {metrics.total_duration / 1000:.2f}s",
        f"Total Cost: ${metrics.total_cost:.4f}",
        f"Success: {metrics.success_count}",
        f"Errors: {metrics.error_count}",
    ]
    
    if metrics.success_count + metrics.error_count > 0:
        success_rate = metrics.success_count / (metrics.success_count + metrics.error_count) * 100
        lines.append(f"Success Rate: {success_rate:.1f}%")
    
    if metrics.agent_metrics:
        lines.append("\nAgent Performance:")
        for agent_name, agent_metrics in metrics.agent_metrics.items():
            lines.append(
                f"  {agent_name}: {agent_metrics.execution_count} executions, "
                f"avg {agent_metrics.average_duration:.0f}ms, "
                f"avg ${agent_metrics.average_cost:.4f}, "
                f"confidence {agent_metrics.average_confidence:.2f}"
            )
    
    return "\n".join(lines)


def format_aggregate_metrics(metrics: AggregateMetrics) -> str:
    """
    Format aggregate metrics for logging.
    
    Args:
        metrics: Aggregate metrics to format
        
    Returns:
        Human-readable string representation
    """
    lines = [
        "Aggregate Metrics (All Cycles):",
        f"Total Cycles: {metrics.total_cycles}",
        f"Total Markets Analyzed: {metrics.total_markets_analyzed}",
        f"Total Cost: ${metrics.total_cost:.4f}",
        f"Average Cost per Market: ${metrics.average_cost_per_market:.4f}",
        f"Average Duration per Market: {metrics.average_duration_per_market / 1000:.2f}s",
        f"Success Rate: {metrics.success_rate * 100:.1f}%",
    ]
    
    if metrics.top_agents:
        lines.append("\nTop Agents by Cost:")
        for agent in metrics.top_agents:
            lines.append(
                f"  {agent['agent_name']}: "
                f"avg ${agent['average_cost']:.4f}, "
                f"avg {agent['average_duration'] / 1000:.2f}s"
            )
    
    return "\n".join(lines)
```

### 3. Workflow Integration (`main.py`)

#### OpikCallbackHandler Creation

```python
def build_market_analysis_graph(config: EngineConfig) -> StateGraph:
    """Build the LangGraph workflow for market analysis."""
    logger.info("Building market analysis workflow graph")
    
    # ... existing code ...
    
    # Create workflow graph
    workflow = StateGraph(GraphState)
    
    # ... add all nodes ...
    
    logger.info("Workflow graph construction complete")
    return workflow


def create_checkpointer(config: EngineConfig):
    """Create appropriate checkpointer based on configuration."""
    # ... existing implementation ...


async def analyze_market(
    condition_id: str,
    config: Optional[EngineConfig] = None,
    thread_id: Optional[str] = None
) -> AnalysisResult:
    """
    Analyze a prediction market and generate trade recommendation.
    """
    start_time = time.time()
    
    # Validate and load config
    if not condition_id:
        raise ValueError("condition_id is required")
    
    if config is None:
        config = load_config()
    
    if thread_id is None:
        thread_id = str(uuid.uuid4())[:8]
    
    logger.info("=" * 80)
    logger.info("TRADEWIZARD MARKET ANALYSIS")
    logger.info("=" * 80)
    logger.info(f"Condition ID: {condition_id}")
    logger.info(f"Thread ID: {thread_id}")
    
    try:
        # Build workflow graph
        workflow = build_market_analysis_graph(config)
        
        # Create checkpointer
        checkpointer = create_checkpointer(config)
        
        # Create Opik callback handler if enabled
        opik_handler = None
        if config.opik.is_enabled():
            try:
                from opik.integrations.langchain import OpikCallbackHandler
                opik_handler = OpikCallbackHandler(
                    project_name=config.opik.project_name,
                    workspace=config.opik.workspace,
                )
                logger.info("Opik tracking enabled")
            except Exception as e:
                logger.warning(f"Failed to create Opik handler: {e}")
                logger.warning("Continuing without Opik tracking")
        
        # Compile graph with checkpointer
        graph = workflow.compile(checkpointer=checkpointer)
        
        logger.info("Workflow graph compiled successfully")
        
        # Initialize state
        initial_state: GraphState = {
            "condition_id": condition_id,
            "agent_signals": [],
            "agent_errors": [],
            "audit_log": [],
            "memory_context": {}
        }
        
        # Create config for graph invocation
        graph_config = {
            "configurable": {"thread_id": thread_id}
        }
        
        # Add Opik handler to callbacks if enabled
        if opik_handler:
            graph_config["callbacks"] = [opik_handler]
        
        # Invoke graph
        logger.info("Starting workflow execution...")
        final_state = await graph.ainvoke(initial_state, graph_config)
        
        duration_s = time.time() - start_time
        
        logger.info("=" * 80)
        logger.info("WORKFLOW EXECUTION COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Duration: {duration_s:.2f}s")
        
        # ... rest of existing code ...
        
        return result
    
    except Exception as e:
        duration_s = time.time() - start_time
        logger.error(f"Market analysis failed after {duration_s:.2f}s: {e}", exc_info=True)
        raise
```

### 4. Environment Configuration (`.env`)

```bash
# ============================================
# Opik Observability Configuration
# ============================================

# Opik API key for authentication (required for tracking)
# Get your API key at: https://www.comet.com/opik
OPIK_API_KEY=your_opik_api_key

# Opik project name for organizing traces
OPIK_PROJECT_NAME=doa-market-analysis

# Opik workspace (optional, defaults to your default workspace)
OPIK_WORKSPACE=your_workspace_name

# Custom Opik instance URL (optional, for self-hosted Opik)
# Leave empty to use Comet's cloud instance
OPIK_URL_OVERRIDE=

# Enable cost tracking in Opik traces
OPIK_TRACK_COSTS=true
```

## Data Models

### Configuration Models

```python
@dataclass
class OpikConfig:
    """Opik observability configuration."""
    api_key: Optional[str]
    project_name: str
    workspace: Optional[str]
    base_url: Optional[str]
    track_costs: bool
```

### Metrics Models

```python
@dataclass
class AgentCycleMetrics:
    """Agent performance metrics per cycle."""
    agent_name: str
    execution_count: int
    total_duration: float
    average_duration: float
    total_cost: float
    average_cost: float
    success_count: int
    error_count: int
    average_confidence: float
    total_input_tokens: int
    total_output_tokens: int

@dataclass
class AnalysisCycleMetrics:
    """Analysis cycle metrics."""
    cycle_id: str
    timestamp: int
    markets_discovered: int
    markets_analyzed: int
    markets_updated: int
    total_duration: float
    total_cost: float
    success_count: int
    error_count: int
    agent_metrics: Dict[str, AgentCycleMetrics]

@dataclass
class AggregateMetrics:
    """Aggregate metrics across cycles."""
    total_cycles: int
    total_markets_analyzed: int
    total_cost: float
    average_cost_per_market: float
    average_duration_per_market: float
    success_rate: float
    top_agents: List[Dict[str, any]]
```

## Error Handling

### Graceful Degradation Strategy

1. **OpikCallbackHandler Creation Failure**
   - Log warning with error details
   - Continue workflow execution without Opik tracking
   - Set opik_handler to None

2. **Opik API Call Failures**
   - Catch exceptions in OpikMonitorIntegration methods
   - Log errors but don't raise exceptions
   - Return fallback values (empty strings, None, etc.)

3. **Configuration Validation Errors**
   - Log warnings for invalid Opik configuration
   - Disable Opik tracking via is_enabled() check
   - Allow workflow to proceed normally

4. **Network Connectivity Issues**
   - OpikCallbackHandler handles retries internally
   - Workflow continues if Opik is unreachable
   - Errors logged for debugging

### Error Logging

```python
# Example error handling pattern
try:
    opik_handler = OpikCallbackHandler(
        project_name=config.opik.project_name,
        workspace=config.opik.workspace,
    )
    logger.info("Opik tracking enabled")
except Exception as e:
    logger.warning(f"Failed to create Opik handler: {e}")
    logger.warning("Continuing without Opik tracking")
    opik_handler = None
```

## Testing Strategy

### Unit Tests

1. **Configuration Tests** (`test_config.py`)
   - Test OpikConfig validation
   - Test is_enabled() logic
   - Test configuration loading from environment

2. **OpikMonitorIntegration Tests** (`test_opik_integration.py`)
   - Test cycle tracking (start, record, end)
   - Test agent metrics aggregation
   - Test trace URL generation
   - Test formatting utilities

3. **Integration Tests** (`test_workflow_opik.py`)
   - Test OpikCallbackHandler creation
   - Test workflow execution with Opik enabled
   - Test workflow execution with Opik disabled
   - Test graceful degradation on errors

### Property-Based Tests

Property-based tests will be added in the implementation phase based on the prework analysis below.



## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Configuration Validation Rejects Invalid Inputs

*For any* OpikConfig instance with invalid field values (empty api_key when provided, empty project_name, or malformed base_url), the validate() method should return a non-empty list of error messages describing the validation failures.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 2: Unique Cycle ID Generation

*For any* sequence of start_cycle() calls, each generated cycle_id should be unique and different from all previously generated cycle_ids within the same OpikMonitorIntegration instance.

**Validates: Requirements 5.2**

### Property 3: Metric Accumulation Correctness

*For any* sequence of record_analysis() calls with durations D1, D2, ..., Dn and costs C1, C2, ..., Cn, the cycle metrics should satisfy:
- markets_analyzed = n
- total_duration = sum(D1, D2, ..., Dn)
- total_cost = sum(C1, C2, ..., Cn)
- success_count = count of calls with success=True
- error_count = count of calls with success=False

**Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 7.6**

### Property 4: Agent Metrics Tracking Completeness

*For any* agent signal provided to record_analysis(), the OpikMonitorIntegration should track execution_count, total_duration, and total_cost for that agent, and these values should accumulate correctly across multiple calls.

**Validates: Requirements 6.2, 6.3, 6.4**

### Property 5: Average Calculation Correctness

*For any* agent with n executions, total_duration D, and total_cost C, the agent metrics should satisfy:
- average_duration = D / n
- average_cost = C / n
- average_confidence = running average of all confidence values

**Validates: Requirements 6.5, 6.6, 6.7**

### Property 6: Cost Calculation Formula

*For any* LLM invocation with input_tokens I, output_tokens O, and pricing model P, the calculated costs should satisfy:
- input_cost = (I / 1000) * P.input_price_per_1k
- output_cost = (O / 1000) * P.output_price_per_1k
- total_cost = input_cost + output_cost

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 7: Aggregate Metrics Summation

*For any* cycle history containing cycles C1, C2, ..., Cn, the aggregate metrics should satisfy:
- total_cycles = n
- total_markets_analyzed = sum of markets_analyzed across all cycles
- total_cost = sum of total_cost across all cycles

**Validates: Requirements 12.2, 12.3, 12.4**

### Property 8: Aggregate Average Calculations

*For any* aggregate metrics with total_markets_analyzed M, total_cost C, total_duration D, total_success S, and total_errors E, the calculated averages should satisfy:
- average_cost_per_market = C / M (when M > 0)
- average_duration_per_market = D / M (when M > 0)
- success_rate = S / (S + E) (when S + E > 0)

**Validates: Requirements 12.5, 12.6, 12.7**

### Property 9: Top Agents Ranking

*For any* aggregate metrics, the top_agents list should be sorted in descending order by average_cost, and should contain at most 10 agents.

**Validates: Requirements 12.8**

### Property 10: Trace URL Structure

*For any* condition_id, workspace, project_name, and base_url configuration, the generated trace URL should:
- Start with the base_url (or default Opik URL if not set)
- Contain the workspace
- Contain the project_name
- Contain the condition_id as a search parameter

**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

### Property 11: Formatted Output Completeness

*For any* AnalysisCycleMetrics or AggregateMetrics object, the formatted string output should contain all required fields: cycle_id/total_cycles, timestamp, markets_analyzed, duration, cost, success_count/success_rate, and agent performance data when present.

**Validates: Requirements 14.2, 14.4, 14.5, 14.6**

## Testing Strategy

### Dual Testing Approach

The Opik observability integration will use both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests** will verify:
- Specific configuration loading examples (Requirements 1.1-1.7)
- OpikCallbackHandler creation and integration (Requirements 3.1-3.3, 3.6)
- OpikMonitorIntegration method behavior (Requirements 4.2-4.7, 5.1, 5.8, 5.9)
- Error handling and graceful degradation (Requirements 10.1, 10.2, 10.4, 10.5, 10.6)
- Logging behavior (Requirements 11.1-11.7)
- Integration with existing workflow components (Requirements 13.2-13.7)
- Edge cases like missing API key (Requirement 1.6)

**Property-Based Tests** will verify:
- Configuration validation with random invalid inputs (Property 1)
- Cycle ID uniqueness across many generations (Property 2)
- Metric accumulation with random sequences of analyses (Property 3)
- Agent metrics tracking with random agent signals (Property 4)
- Average calculations with random data (Property 5)
- Cost calculations with random token counts (Property 6)
- Aggregate metrics with random cycle histories (Property 7, 8)
- Agent ranking with random agent data (Property 9)
- URL generation with random configuration values (Property 10)
- Formatted output completeness with random metrics (Property 11)

### Property-Based Testing Configuration

- **Testing Library**: Hypothesis (Python property-based testing library)
- **Minimum Iterations**: 100 examples per property test
- **Test Tagging**: Each property test will include a comment referencing its design property
  - Format: `# Feature: opik-observability-integration, Property N: [property description]`

### Test Organization

```
doa/
├── utils/
│   ├── opik_integration.py          # Implementation
│   └── test_opik_integration.py     # Unit tests
│       ├── test_opik_config_validation
│       ├── test_cycle_tracking
│       ├── test_agent_metrics
│       ├── test_cost_calculation
│       ├── test_aggregate_metrics
│       ├── test_trace_url_generation
│       └── test_formatting_utilities
├── test_opik_integration_properties.py  # Property-based tests
│   ├── test_property_1_config_validation
│   ├── test_property_2_unique_cycle_ids
│   ├── test_property_3_metric_accumulation
│   ├── test_property_4_agent_tracking
│   ├── test_property_5_average_calculations
│   ├── test_property_6_cost_formula
│   ├── test_property_7_aggregate_summation
│   ├── test_property_8_aggregate_averages
│   ├── test_property_9_agent_ranking
│   ├── test_property_10_url_structure
│   └── test_property_11_formatted_output
└── test_workflow_opik_integration.py    # Integration tests
    ├── test_opik_handler_creation
    ├── test_workflow_with_opik_enabled
    ├── test_workflow_with_opik_disabled
    └── test_graceful_degradation
```

### Example Property Test

```python
from hypothesis import given, strategies as st
import pytest

# Feature: opik-observability-integration, Property 3: Metric Accumulation Correctness
@given(
    analyses=st.lists(
        st.tuples(
            st.floats(min_value=0, max_value=10000),  # duration
            st.floats(min_value=0, max_value=100),    # cost
            st.booleans()                              # success
        ),
        min_size=1,
        max_size=50
    )
)
def test_property_3_metric_accumulation(analyses):
    """
    Property: For any sequence of record_analysis() calls, metrics should
    accumulate correctly.
    """
    config = create_test_config()
    integration = OpikMonitorIntegration(config)
    
    integration.start_cycle()
    
    expected_duration = 0
    expected_cost = 0
    expected_success = 0
    expected_error = 0
    
    for duration, cost, success in analyses:
        integration.record_analysis(
            condition_id=f"test_{len(analyses)}",
            duration=duration,
            cost=cost,
            success=success
        )
        expected_duration += duration
        expected_cost += cost
        if success:
            expected_success += 1
        else:
            expected_error += 1
    
    metrics = integration.get_current_cycle_metrics()
    
    assert metrics.markets_analyzed == len(analyses)
    assert abs(metrics.total_duration - expected_duration) < 0.01
    assert abs(metrics.total_cost - expected_cost) < 0.01
    assert metrics.success_count == expected_success
    assert metrics.error_count == expected_error
```

### Integration Testing

Integration tests will verify:
1. OpikCallbackHandler is correctly passed to LangGraph workflow
2. Workflow executes successfully with Opik enabled
3. Workflow executes successfully with Opik disabled
4. Graceful degradation when Opik API is unavailable
5. Compatibility with all checkpointer types (Memory, SQLite, PostgreSQL)
6. Independence of Opik tracking and database persistence

### Manual Testing Checklist

- [ ] Verify Opik traces appear in dashboard after workflow execution
- [ ] Verify trace URLs are clickable and navigate to correct traces
- [ ] Verify cost tracking matches actual LLM usage
- [ ] Verify agent performance metrics are accurate
- [ ] Verify cycle summaries are logged correctly
- [ ] Verify graceful degradation when API key is invalid
- [ ] Verify workflow continues when Opik is unreachable
