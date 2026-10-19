# Design Document

## Overview

The Automated Market Monitor is a production-ready background service that transforms TradeWizard from a manual CLI tool into an autonomous intelligence platform. It continuously discovers trending political markets, schedules analysis workflows, manages API quota budgets, and persists all results to Supabase PostgreSQL.

The system is designed around three core principles:

1. **Cost-Conscious Operation** - Stays within free-tier API quotas by limiting analysis to top 1-3 markets per day
2. **Reliable Persistence** - Uses Supabase PostgreSQL for all data storage and LangGraph checkpointing
3. **Production Readiness** - Runs as a long-lived service with comprehensive error handling, logging, and monitoring

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTOMATED MARKET MONITOR                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                    Scheduler                            │    │
│  │  - Cron-based scheduling (default: 24h interval)        │    │
│  │  - Triggers market discovery and analysis              │    │
│  │  - Manages update cycles for existing markets          │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Market Discovery Engine                    │    │
│  │  - Fetch active markets from Polymarket                │    │
│  │  - Filter for political event types                    │    │
│  │  - Rank by trending score (volume, liquidity)          │    │
│  │  - Select top N markets (default: 3)                   │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              API Quota Manager                          │    │
│  │  - Track API usage per source                          │    │
│  │  - Enforce daily quota limits                          │    │
│  │  - Reduce market count if approaching limits           │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │           Market Intelligence Engine                    │    │
│  │  - Run full analysis workflow (MVP + Advanced)         │    │
│  │  - Generate trade recommendations                      │    │
│  │  - Use Supabase PostgreSQL for checkpointing          │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Database Persistence Layer                 │    │
│  │  - Store markets, recommendations, signals             │    │
│  │  - Track market state and analysis history             │    │
│  │  - Manage LangGraph checkpoints                        │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │   Supabase    │
                │  PostgreSQL   │
                └───────────────┘
```

### Component Interaction Flow

```
1. Scheduler triggers → Market Discovery
2. Market Discovery → Fetch markets from Polymarket
3. Market Discovery → Rank and select top N markets
4. API Quota Manager → Check if within budget
5. For each selected market:
   a. Market Intelligence Engine → Run analysis workflow
   b. Database Persistence → Store results in Supabase
   c. API Quota Manager → Update usage counters
6. Scheduler → Wait for next interval
```

## Components and Interfaces

### 1. Scheduler

**Responsibility**: Manage timing of market discovery and analysis cycles

**Interface**:
```typescript
interface Scheduler {
  /**
   * Start the scheduler
   * @param interval - Analysis interval in milliseconds (default: 24 hours)
   */
  start(interval: number): void;
  
  /**
   * Stop the scheduler gracefully
   */
  stop(): Promise<void>;
  
  /**
   * Manually trigger an analysis cycle
   */
  triggerNow(): Promise<void>;
  
  /**
   * Get next scheduled run time
   */
  getNextRun(): Date;
}
```

**Implementation**:
```typescript
class CronScheduler implements Scheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  start(interval: number = 24 * 60 * 60 * 1000): void {
    // Run immediately on start
    this.runAnalysisCycle();
    
    // Schedule recurring runs
    this.intervalId = setInterval(() => {
      this.runAnalysisCycle();
    }, interval);
  }
  
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Wait for current cycle to complete
    while (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  private async runAnalysisCycle(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Analysis cycle already running, skipping');
      return;
    }
    
    this.isRunning = true;
    try {
      await marketDiscovery.discoverAndAnalyze();
    } catch (error) {
      logger.error('Analysis cycle failed', error);
    } finally {
      this.isRunning = false;
    }
  }
}
```

### 2. Market Discovery Engine

**Responsibility**: Discover and rank trending political markets

**Interface**:
```typescript
interface MarketDiscoveryEngine {
  /**
   * Discover and select top trending markets
   * @param limit - Maximum number of markets to select
   * @returns Selected markets with ranking scores
   */
  discoverMarkets(limit: number): Promise<RankedMarket[]>;
  
  /**
   * Fetch all active political markets from Polymarket
   */
  fetchPoliticalMarkets(): Promise<PolymarketMarket[]>;
  
  /**
   * Rank markets by trending score
   */
  rankMarkets(markets: PolymarketMarket[]): RankedMarket[];
}
```

**Ranking Algorithm**:
```typescript
function calculateTrendingScore(market: PolymarketMarket): number {
  // Weighted scoring formula
  const volumeScore = Math.log10(market.volume24h + 1) * 0.4;
  const liquidityScore = Math.log10(market.liquidity + 1) * 0.3;
  const recencyScore = calculateRecencyScore(market.createdAt) * 0.2;
  const activityScore = (market.trades24h / 100) * 0.1;
  
  return volumeScore + liquidityScore + recencyScore + activityScore;
}

function calculateRecencyScore(createdAt: number): number {
  const ageInDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  // Newer markets get higher scores (exponential decay)
  return Math.exp(-ageInDays / 30); // 30-day half-life
}
```

**Market Filtering**:
```typescript
function filterPoliticalMarkets(markets: PolymarketMarket[]): PolymarketMarket[] {
  const politicalKeywords = [
    'election', 'president', 'senate', 'congress', 'governor',
    'court', 'supreme court', 'ruling', 'verdict',
    'policy', 'legislation', 'bill', 'law',
    'geopolitical', 'war', 'conflict', 'treaty'
  ];
  
  return markets.filter(market => {
    const text = `${market.question} ${market.description}`.toLowerCase();
    return politicalKeywords.some(keyword => text.includes(keyword));
  });
}
```

### 3. API Quota Manager

**Responsibility**: Track and enforce API usage limits

**Interface**:
```typescript
interface APIQuotaManager {
  /**
   * Check if API call is within quota
   * @param source - API source (newsapi, twitter, reddit)
   * @returns true if within quota, false otherwise
   */
  canMakeRequest(source: string): boolean;
  
  /**
   * Record an API call
   * @param source - API source
   * @param count - Number of calls (default: 1)
   */
  recordUsage(source: string, count: number): void;
  
  /**
   * Get current usage for a source
   */
  getUsage(source: string): number;
  
  /**
   * Reset usage counters (called daily)
   */
  resetUsage(): void;
  
  /**
   * Get recommended market count based on remaining quota
   */
  getRecommendedMarketCount(): number;
}
```

**Implementation**:
```typescript
class QuotaManager implements APIQuotaManager {
  private usage: Map<string, number> = new Map();
  private quotas: Map<string, number> = new Map();
  private lastReset: Date = new Date();
  
  constructor(config: QuotaConfig) {
    this.quotas.set('newsapi', config.newsApiQuota || 100);
    this.quotas.set('twitter', config.twitterQuota || 500);
    this.quotas.set('reddit', config.redditQuota || 60);
  }
  
  canMakeRequest(source: string): boolean {
    const current = this.usage.get(source) || 0;
    const limit = this.quotas.get(source) || Infinity;
    return current < limit * 0.8; // Stay under 80% of quota
  }
  
  recordUsage(source: string, count: number = 1): void {
    const current = this.usage.get(source) || 0;
    this.usage.set(source, current + count);
  }
  
  getRecommendedMarketCount(): number {
    // Estimate API calls per market
    const callsPerMarket = {
      newsapi: 1,
      twitter: 3,
      reddit: 2
    };
    
    // Calculate how many markets we can analyze
    let maxMarkets = Infinity;
    for (const [source, quota] of this.quotas) {
      const remaining = quota - (this.usage.get(source) || 0);
      const marketsForSource = Math.floor(remaining / callsPerMarket[source]);
      maxMarkets = Math.min(maxMarkets, marketsForSource);
    }
    
    return Math.max(1, Math.min(3, maxMarkets)); // Between 1 and 3
  }
  
  resetUsage(): void {
    this.usage.clear();
    this.lastReset = new Date();
  }
}
```

### 4. Database Persistence Layer

**Responsibility**: Store and retrieve market data from Supabase PostgreSQL

**Database Schema**:

```sql
-- Markets table
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,
  market_probability DECIMAL(5,4),
  volume_24h DECIMAL(20,2),
  liquidity DECIMAL(20,2),
  status TEXT NOT NULL DEFAULT 'active', -- active, inactive, resolved
  resolved_outcome TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_analyzed_at TIMESTAMP WITH TIME ZONE,
  trending_score DECIMAL(10,4)
);

CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_last_analyzed ON markets(last_analyzed_at);
CREATE INDEX idx_markets_trending_score ON markets(trending_score DESC);

-- Recommendations table
CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- LONG_YES, LONG_NO, NO_TRADE
  fair_probability DECIMAL(5,4),
  market_edge DECIMAL(5,4),
  expected_value DECIMAL(10,4),
  confidence TEXT NOT NULL, -- high, moderate, low
  entry_zone_min DECIMAL(5,4),
  entry_zone_max DECIMAL(5,4),
  target_zone_min DECIMAL(5,4),
  target_zone_max DECIMAL(5,4),
  explanation TEXT,
  catalysts JSONB,
  risks JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_recommendations_market_id ON recommendations(market_id);
CREATE INDEX idx_recommendations_created_at ON recommendations(created_at DESC);

-- Agent signals table
CREATE TABLE agent_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES recommendations(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  fair_probability DECIMAL(5,4),
  confidence DECIMAL(3,2),
  direction TEXT NOT NULL,
  key_drivers JSONB,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_signals_market_id ON agent_signals(market_id);
CREATE INDEX idx_agent_signals_recommendation_id ON agent_signals(recommendation_id);

-- Analysis history table
CREATE TABLE analysis_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL, -- initial, update, manual
  status TEXT NOT NULL, -- success, failed, partial
  duration_ms INTEGER,
  cost_usd DECIMAL(10,4),
  agents_used JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analysis_history_market_id ON analysis_history(market_id);
CREATE INDEX idx_analysis_history_created_at ON analysis_history(created_at DESC);

-- LangGraph checkpoints table (for workflow state)
CREATE TABLE langgraph_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (thread_id, checkpoint_id)
);

CREATE INDEX idx_langgraph_checkpoints_thread_id ON langgraph_checkpoints(thread_id);
```

**Interface**:
```typescript
interface DatabasePersistence {
  /**
   * Store or update a market
   */
  upsertMarket(market: MarketData): Promise<string>; // Returns market_id
  
  /**
   * Store a recommendation
   */
  storeRecommendation(marketId: string, recommendation: TradeRecommendation): Promise<string>;
  
  /**
   * Store agent signals
   */
  storeAgentSignals(marketId: string, recommendationId: string, signals: AgentSignal[]): Promise<void>;
  
  /**
   * Record analysis history
   */
  recordAnalysis(marketId: string, analysis: AnalysisRecord): Promise<void>;
  
  /**
   * Get markets needing update
   */
  getMarketsForUpdate(updateInterval: number): Promise<MarketData[]>;
  
  /**
   * Mark market as resolved
   */
  markMarketResolved(marketId: string, outcome: string): Promise<void>;
  
  /**
   * Get latest recommendation for a market
   */
  getLatestRecommendation(marketId: string): Promise<TradeRecommendation | null>;
}
```

### 5. Monitor Service

**Responsibility**: Main service orchestrator

**Interface**:
```typescript
interface MonitorService {
  /**
   * Initialize the monitor service
   */
  initialize(): Promise<void>;
  
  /**
   * Start the monitor
   */
  start(): Promise<void>;
  
  /**
   * Stop the monitor gracefully
   */
  stop(): Promise<void>;
  
  /**
   * Get service health status
   */
  getHealth(): HealthStatus;
  
  /**
   * Manually trigger analysis for a specific market
   */
  analyzeMarket(conditionId: string): Promise<TradeRecommendation>;
}
```

**Implementation**:
```typescript
class AutomatedMarketMonitor implements MonitorService {
  private scheduler: Scheduler;
  private discovery: MarketDiscoveryEngine;
  private quotaManager: APIQuotaManager;
  private database: DatabasePersistence;
  private engine: MarketIntelligenceEngine;
  private isRunning: boolean = false;
  
  async initialize(): Promise<void> {
    // Connect to Supabase
    await this.database.connect();
    
    // Initialize LangGraph with PostgreSQL checkpointer
    this.engine = createEngine({
      checkpointer: new PostgresSaver(this.database.getConnection())
    });
    
    // Set up signal handlers for graceful shutdown
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
    
    logger.info('Monitor initialized successfully');
  }
  
  async start(): Promise<void> {
    this.isRunning = true;
    
    // Start scheduler
    const interval = parseInt(process.env.ANALYSIS_INTERVAL_HOURS || '24') * 60 * 60 * 1000;
    this.scheduler.start(interval);
    
    // Start daily quota reset
    this.startQuotaResetScheduler();
    
    logger.info('Monitor started', { interval });
  }
  
  async stop(): Promise<void> {
    logger.info('Stopping monitor gracefully...');
    this.isRunning = false;
    
    await this.scheduler.stop();
    await this.database.disconnect();
    
    logger.info('Monitor stopped');
    process.exit(0);
  }
  
  private async discoverAndAnalyze(): Promise<void> {
    try {
      // Get recommended market count based on quota
      const maxMarkets = this.quotaManager.getRecommendedMarketCount();
      
      // Discover markets
      const markets = await this.discovery.discoverMarkets(maxMarkets);
      logger.info(`Discovered ${markets.length} markets for analysis`);
      
      // Analyze each market
      for (const market of markets) {
        try {
          await this.analyzeMarket(market.conditionId);
        } catch (error) {
          logger.error(`Failed to analyze market ${market.conditionId}`, error);
          // Continue with next market
        }
      }
      
      // Update existing markets
      await this.updateExistingMarkets();
      
    } catch (error) {
      logger.error('Discovery and analysis cycle failed', error);
    }
  }
  
  async analyzeMarket(conditionId: string): Promise<TradeRecommendation> {
    const startTime = Date.now();
    
    try {
      // Run Market Intelligence Engine
      const result = await this.engine.analyzeMarket(conditionId);
      
      // Store results in database
      const marketId = await this.database.upsertMarket({
        conditionId,
        ...result.mbd
      });
      
      const recommendationId = await this.database.storeRecommendation(
        marketId,
        result.recommendation
      );
      
      await this.database.storeAgentSignals(
        marketId,
        recommendationId,
        result.agentSignals
      );
      
      // Record analysis
      await this.database.recordAnalysis(marketId, {
        type: 'initial',
        status: 'success',
        durationMs: Date.now() - startTime,
        costUsd: result.cost,
        agentsUsed: result.agentSignals.map(s => s.agentName)
      });
      
      logger.info(`Market analyzed successfully`, {
        conditionId,
        direction: result.recommendation.direction,
        duration: Date.now() - startTime
      });
      
      return result.recommendation;
      
    } catch (error) {
      logger.error(`Market analysis failed`, { conditionId, error });
      throw error;
    }
  }
  
  private async updateExistingMarkets(): Promise<void> {
    const updateInterval = parseInt(process.env.UPDATE_INTERVAL_HOURS || '24') * 60 * 60 * 1000;
    const markets = await this.database.getMarketsForUpdate(updateInterval);
    
    logger.info(`Updating ${markets.length} existing markets`);
    
    for (const market of markets) {
      try {
        await this.analyzeMarket(market.conditionId);
      } catch (error) {
        logger.error(`Failed to update market ${market.conditionId}`, error);
      }
    }
  }
}
```

## Configuration

### Environment Variables

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Scheduling
ANALYSIS_INTERVAL_HOURS=24
UPDATE_INTERVAL_HOURS=24
MAX_MARKETS_PER_CYCLE=3

# API Quotas (daily limits)
NEWS_API_DAILY_QUOTA=100
TWITTER_API_DAILY_QUOTA=500
REDDIT_API_DAILY_QUOTA=60

# Service
LOG_LEVEL=info
HEALTH_CHECK_PORT=3000
ENABLE_MANUAL_TRIGGERS=true

# Existing Market Intelligence Engine vars
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
# ... etc
```

## Deployment

### Docker Deployment

**Dockerfile**:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/monitor.js"]
```

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  market-monitor:
    build: .
    container_name: tradewizard-monitor
    restart: unless-stopped
    env_file:
      - .env.production
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
```

### Systemd Service

**tradewizard-monitor.service**:
```ini
[Unit]
Description=TradeWizard Market Monitor
After=network.target

[Service]
Type=simple
User=tradewizard
WorkingDirectory=/opt/tradewizard
ExecStart=/usr/bin/node /opt/tradewizard/dist/monitor.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tradewizard-monitor
Environment="NODE_ENV=production"
EnvironmentFile=/opt/tradewizard/.env

[Install]
WantedBy=multi-user.target
```

## Error Handling

### Retry Strategy

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 1000;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, { error });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Unreachable');
}
```

### Graceful Degradation

- If external data APIs fail, use cached data
- If Supabase connection fails, queue writes for retry
- If analysis fails for one market, continue with others
- If quota exceeded, reduce market count for next cycle

## Monitoring and Observability

### Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    lastAnalysis: monitor.getLastAnalysisTime(),
    nextScheduledRun: monitor.getNextScheduledRun(),
    database: monitor.isDatabaseConnected(),
    quotaStatus: monitor.getQuotaStatus()
  };
  
  res.json(health);
});
```

### Metrics

Track and log:
- Markets discovered per cycle
- Markets analyzed per cycle
- Analysis success rate
- Average analysis duration
- Total cost per cycle
- API quota usage
- Database connection health

### Opik Integration

All analysis workflows are traced via Opik for debugging and cost tracking.

## Testing Strategy

### Unit Tests

- Test market ranking algorithm
- Test quota management logic
- Test database operations
- Test scheduler timing
- Test error handling

### Integration Tests

- Test full discovery and analysis cycle
- Test Supabase connection and queries
- Test LangGraph checkpointing
- Test graceful shutdown
- Test quota enforcement

### End-to-End Tests

- Deploy to staging environment
- Run for 48 hours
- Verify markets are discovered and analyzed
- Verify data is stored correctly
- Verify quota limits are respected
- Verify service restarts gracefully

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Market selection count enforcement

*For any* analysis cycle, the number of markets selected for analysis should never exceed the configured maximum (default: 3).

**Validates: Requirements 1.4, 4.3**

### Property 2: API quota respect

*For any* API source with a configured daily quota, the total number of API calls in a 24-hour period should not exceed the quota limit.

**Validates: Requirements 4.2, 4.4**

### Property 3: Database persistence completeness

*For any* successfully completed market analysis, the system should store a market record, recommendation record, and all agent signal records in Supabase.

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 4: Scheduled execution reliability

*For any* configured analysis interval, the system should trigger market discovery within 5% of the scheduled time (allowing for execution duration).

**Validates: Requirements 2.1, 2.2**

### Property 5: Graceful shutdown completeness

*For any* shutdown signal (SIGTERM, SIGINT), the system should complete the current analysis before exiting, and no analysis should be left in a partial state.

**Validates: Requirements 7.3**

### Property 6: Market update interval enforcement

*For any* market with a last analysis timestamp, the system should not re-analyze it until the configured update interval has elapsed.

**Validates: Requirements 3.2**

### Property 7: Error isolation

*For any* market analysis failure, the system should continue processing remaining markets in the queue without crashing.

**Validates: Requirements 10.4**

### Property 8: Quota reset timing

*For any* 24-hour period, the API quota counters should reset exactly once at the configured reset time.

**Validates: Requirements 4.5**

### Property 9: Health check accuracy

*For any* health check request, the returned status should accurately reflect the current state of all system components (database, scheduler, quota).

**Validates: Requirements 7.5, 7.6**

### Property 10: Configuration validation

*For any* invalid configuration (missing required variables, invalid values), the system should log validation errors and exit with a non-zero code before starting any operations.

**Validates: Requirements 8.3**
