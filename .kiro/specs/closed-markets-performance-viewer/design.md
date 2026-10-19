# Design Document: Closed Markets Performance Viewer

## Overview

The Closed Markets Performance Viewer transforms the existing aggregate performance dashboard into a comprehensive closed markets browser with detailed per-market performance analysis. This feature enables users to verify AI recommendation accuracy through interactive visualizations, profit/loss simulations, and risk-adjusted performance metrics.

### Goals

- Display closed markets using familiar homepage UI patterns for consistency
- Provide detailed performance analysis for each closed market through a dedicated Performance tab
- Enable profit/loss simulation with configurable investment amounts
- Visualize recommendation accuracy and timing through interactive charts
- Calculate and display risk-adjusted returns and calibration metrics
- Support baseline strategy comparisons to demonstrate AI value-add
- Ensure mobile responsiveness and data export capabilities

### Non-Goals

- Real-time trading execution from the performance page
- Backtesting against custom strategies beyond provided baselines
- Historical price data editing or manual outcome adjustments
- Performance tracking for active (unresolved) markets

### Success Metrics

- User engagement: Time spent on performance page and tab interactions
- Data completeness: Percentage of closed markets with complete performance data
- Export usage: Number of CSV exports per user session
- Mobile usage: Performance page views from mobile devices
- Accuracy transparency: User confidence in AI recommendations based on historical performance

## Architecture

### High-Level Component Structure


```
┌─────────────────────────────────────────────────────────────────┐
│                     Performance Page (Route)                     │
│  /app/performance/page.tsx                                       │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PerformanceFilters                                        │  │
│  │  - Timeframe, Category, Confidence filters                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PerformanceMetrics (Aggregate)                           │  │
│  │  - Win Rate, Avg ROI, Total Profit, Avg Resolution Time  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ClosedMarketsList (Enhanced)                             │  │
│  │  - Market cards using homepage UI pattern                 │  │
│  │  - Pagination support                                     │  │
│  │  - Click navigation to market detail                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Market Detail View (Enhanced)                       │
│  /app/market/[slug]/page.tsx                                     │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  MarketDetails (Existing)                                 │  │
│  │  - Standard market information                            │  │
│  │  - Trading disabled for closed markets                    │  │
│  │  - Resolution outcome displayed prominently               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TabNavigation (New)                                      │  │
│  │  - Overview | Performance (conditional)                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PerformanceTab (New)                                     │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  InvestmentSimulator                                │  │  │
│  │  │  - Investment amount input                          │  │  │
│  │  │  - Cumulative P/L chart                             │  │  │
│  │  │  - Fee-adjusted calculations                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  AccuracyMetrics                                    │  │  │
│  │  │  - Accuracy percentage                              │  │  │
│  │  │  - Confidence correlation                           │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  PriceChartWithMarkers                              │  │  │
│  │  │  - Historical price line                            │  │  │
│  │  │  - Entry/exit point overlays                        │  │  │
│  │  │  - Interactive tooltips                             │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  RecommendationTimeline                             │  │  │
│  │  │  - Chronological recommendation list                │  │  │
│  │  │  - Click to highlight on chart                      │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  RiskMetrics                                        │  │  │
│  │  │  - Sharpe ratio, max drawdown, volatility          │  │  │
│  │  │  - Tooltips for explanations                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  CalibrationAnalysis                                │  │  │
│  │  │  - Confidence vs outcome scatter plot               │  │  │
│  │  │  - Calibration error metrics                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  BaselineComparison                                 │  │  │
│  │  │  - Buy-and-hold baseline                            │  │  │
│  │  │  - Random strategy baseline                         │  │  │
│  │  │  - Statistical significance                         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  ExportButton                                       │  │  │
│  │  │  - CSV export with all metrics                      │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Request
    ↓
Performance Page Component
    ↓
usePerformanceData Hook (TanStack Query)
    ↓
API Route: /api/tradewizard/performance
    ↓
Supabase Query: v_closed_markets_performance view
    ↓
Data Transformation & Calculation
    ↓
Response with PerformanceData
    ↓
Component Rendering
```

### State Management Strategy

- **Server State**: TanStack React Query for all data fetching and caching
- **UI State**: React useState for local component state (filters, expanded items, selected tabs)
- **URL State**: Next.js searchParams for shareable filter states
- **Computed State**: useMemo for expensive calculations (ROI, risk metrics)



## Components and Interfaces

### New Components

#### 1. ClosedMarketsGrid
**Location**: `components/Performance/ClosedMarketsGrid.tsx`

Displays closed markets using homepage card pattern with pagination.

```typescript
interface ClosedMarketsGridProps {
  markets: ClosedMarketPerformance[];
  isLoading: boolean;
  onMarketClick: (marketSlug: string) => void;
}
```

**Responsibilities**:
- Render market cards in grid layout
- Handle pagination (20 markets per page)
- Display "no recommendations" indicator for markets without AI analysis
- Show resolution outcome alongside market title
- Navigate to market detail on click

#### 2. PerformanceTab
**Location**: `components/Trading/Markets/PerformanceTab.tsx`

Container component for all performance analysis features.

```typescript
interface PerformanceTabProps {
  marketId: string;
  conditionId: string;
  resolvedOutcome: string;
  resolutionDate: string;
}
```

**Responsibilities**:
- Fetch market-specific performance data
- Coordinate child components
- Handle loading and error states
- Manage tab visibility based on recommendation existence

#### 3. InvestmentSimulator
**Location**: `components/Performance/InvestmentSimulator.tsx`

Simulates profit/loss based on user-specified investment amount.

```typescript
interface InvestmentSimulatorProps {
  recommendations: RecommendationWithOutcome[];
  marketResolution: string;
  onInvestmentChange: (amount: number) => void;
}

interface SimulationResult {
  totalProfitLoss: number;
  totalROI: number;
  perRecommendationResults: Array<{
    recommendationId: string;
    profitLoss: number;
    roi: number;
    entryPrice: number;
    exitPrice: number;
    fees: number;
  }>;
  cumulativeTimeSeries: Array<{
    timestamp: string;
    cumulativePL: number;
  }>;
}
```

**Responsibilities**:
- Accept investment amount input (default: $100)
- Calculate P/L for each recommendation
- Account for Polymarket fees (2% on winning positions)
- Handle incomplete recommendations (use final resolution price)
- Display cumulative P/L chart over time

#### 4. PriceChartWithMarkers
**Location**: `components/Performance/PriceChartWithMarkers.tsx`

Price chart with entry/exit point overlays.

```typescript
interface PriceChartWithMarkersProps {
  priceHistory: Array<{ timestamp: string; price: number }>;
  recommendations: Array<{
    id: string;
    entryTimestamp: string;
    entryPrice: number;
    exitTimestamp?: string;
    exitPrice?: number;
    isProfitable: boolean;
    details: RecommendationDetails;
  }>;
  highlightedPeriod?: { start: string; end: string };
}
```

**Responsibilities**:
- Render price line chart using Recharts
- Overlay entry markers (green/red based on profitability)
- Overlay exit markers when available
- Show tooltips on marker hover with full recommendation details
- Highlight periods when clicked from timeline
- Use distinct styling for profitable vs unprofitable periods

#### 5. RecommendationTimeline
**Location**: `components/Performance/RecommendationTimeline.tsx`

Chronological list of all recommendations for the market.

```typescript
interface RecommendationTimelineProps {
  recommendations: RecommendationWithOutcome[];
  onRecommendationClick: (recommendationId: string) => void;
  selectedRecommendationId?: string;
}
```

**Responsibilities**:
- Display recommendations in chronological order
- Show timestamp, type (LONG_YES/LONG_NO/NO_TRADE), confidence
- Display market price at recommendation time
- Show individual ROI for each recommendation
- Highlight selected recommendation
- Trigger chart highlighting on click

#### 6. AccuracyMetrics
**Location**: `components/Performance/AccuracyMetrics.tsx`

Displays recommendation accuracy statistics.

```typescript
interface AccuracyMetricsProps {
  recommendations: RecommendationWithOutcome[];
}

interface AccuracyStats {
  totalRecommendations: number;
  correctRecommendations: number;
  accuracyPercentage: number;
  averageConfidence: number;
  confidenceAccuracyCorrelation: number;
}
```

**Responsibilities**:
- Calculate accuracy percentage
- Count correct vs total recommendations
- Calculate average confidence level
- Compute correlation between confidence and accuracy
- Display metrics in card format

#### 7. RiskMetrics
**Location**: `components/Performance/RiskMetrics.tsx`

Calculates and displays risk-adjusted performance metrics.

```typescript
interface RiskMetricsProps {
  returns: number[];
  timestamps: string[];
}

interface RiskMetricsData {
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  riskAdjustedReturn: number;
}
```

**Responsibilities**:
- Calculate Sharpe ratio (assuming risk-free rate of 0)
- Calculate maximum drawdown percentage
- Calculate return volatility (standard deviation)
- Display metrics with explanatory tooltips
- Show alongside raw ROI metrics

#### 8. CalibrationAnalysis
**Location**: `components/Performance/CalibrationAnalysis.tsx`

Analyzes confidence level calibration.

```typescript
interface CalibrationAnalysisProps {
  recommendations: Array<{
    confidence: 'high' | 'moderate' | 'low';
    fairProbability: number;
    wasCorrect: boolean;
  }>;
}
```

**Responsibilities**:
- Display scatter plot (confidence vs outcome)
- Calculate calibration error
- Highlight strong calibration (high confidence + correct)
- Highlight poor calibration (high confidence + incorrect)
- Show average confidence for accurate vs inaccurate predictions

#### 9. BaselineComparison
**Location**: `components/Performance/BaselineComparison.tsx`

Compares AI performance against baseline strategies.

```typescript
interface BaselineComparisonProps {
  aiReturns: number[];
  firstRecommendationPrice: number;
  finalPrice: number;
  marketDuration: number;
}

interface BaselineResults {
  buyAndHold: {
    roi: number;
    profitLoss: number;
  };
  randomStrategy: {
    roi: number;
    profitLoss: number;
    iterations: number;
  };
  aiPerformance: {
    roi: number;
    profitLoss: number;
  };
  statisticalSignificance: {
    pValue: number;
    isSignificant: boolean;
  };
}
```

**Responsibilities**:
- Calculate buy-and-hold baseline (enter at first recommendation, exit at resolution)
- Calculate random entry/exit baseline (Monte Carlo simulation, 1000 iterations)
- Compare AI performance to baselines
- Calculate statistical significance (t-test)
- Highlight when AI outperforms baselines

#### 10. ExportButton
**Location**: `components/Performance/ExportButton.tsx`

Exports performance data to CSV.

```typescript
interface ExportButtonProps {
  marketTitle: string;
  performanceData: PerformanceExportData;
}
```

**Responsibilities**:
- Generate CSV with all performance metrics
- Include timestamps, recommendations, prices, calculated metrics
- Trigger browser download
- Name file: `{market-title}-performance-{timestamp}.csv`

### Enhanced Existing Components

#### MarketDetails
**Location**: `components/Trading/Markets/MarketDetails.tsx`

**Enhancements**:
- Add tab navigation (Overview | Performance)
- Conditionally render Performance tab only for closed markets with recommendations
- Disable trading actions for closed markets
- Display resolution outcome prominently
- Pass market data to PerformanceTab

#### ClosedMarketsList
**Location**: `components/Performance/ClosedMarketsList.tsx`

**Enhancements**:
- Refactor to use homepage card pattern instead of list view
- Add pagination support
- Improve mobile responsiveness
- Add "no recommendations" visual indicator



## Data Models

### Extended Types

```typescript
// Extends existing ClosedMarketPerformance from usePerformanceData
interface EnhancedClosedMarketPerformance extends ClosedMarketPerformance {
  // Existing fields from database view
  market_id: string;
  condition_id: string;
  question: string;
  event_type: string;
  status: string;
  resolved_outcome: string;
  recommendation_id: string;
  direction: "LONG_YES" | "LONG_NO" | "NO_TRADE";
  fair_probability: number;
  market_edge: number;
  expected_value: number;
  confidence: "high" | "moderate" | "low";
  entry_zone_min: number;
  entry_zone_max: number;
  explanation: string;
  recommendation_was_correct: boolean;
  roi_realized: number;
  edge_captured: number;
  market_probability_at_recommendation: number;
  resolution_date: string;
  recommendation_created_at: string;
  days_to_resolution: number;
  total_agents: number;
  agents_in_agreement: number;
  
  // New computed fields
  hasRecommendations: boolean;
  slug: string; // For navigation
  priceHistory?: PricePoint[];
}

interface PricePoint {
  timestamp: string;
  price: number;
  volume?: number;
}

interface RecommendationWithOutcome {
  id: string;
  marketId: string;
  direction: "LONG_YES" | "LONG_NO" | "NO_TRADE";
  confidence: "high" | "moderate" | "low";
  fairProbability: number;
  marketEdge: number;
  expectedValue: number;
  entryZoneMin: number;
  entryZoneMax: number;
  targetZoneMin?: number;
  targetZoneMax?: number;
  explanation: string;
  catalysts: string[];
  risks: string[];
  createdAt: string;
  
  // Outcome data
  actualOutcome: string;
  wasCorrect: boolean;
  roiRealized: number;
  edgeCaptured: number;
  marketPriceAtRecommendation: number;
  resolutionDate: string;
  
  // For chart markers
  entryPrice: number;
  exitPrice?: number;
  exitTimestamp?: string;
}

interface PerformanceMetrics {
  accuracy: {
    total: number;
    correct: number;
    percentage: number;
    byConfidence: {
      high: { total: number; correct: number; percentage: number };
      moderate: { total: number; correct: number; percentage: number };
      low: { total: number; correct: number; percentage: number };
    };
  };
  
  roi: {
    total: number;
    average: number;
    best: number;
    worst: number;
    byRecommendation: Array<{ id: string; roi: number }>;
  };
  
  risk: {
    sharpeRatio: number;
    maxDrawdown: number;
    volatility: number;
    riskAdjustedReturn: number;
  };
  
  calibration: {
    calibrationError: number;
    avgConfidenceCorrect: number;
    avgConfidenceIncorrect: number;
    confidenceAccuracyCorrelation: number;
  };
  
  baseline: {
    buyAndHold: { roi: number; profitLoss: number };
    randomStrategy: { roi: number; profitLoss: number };
    aiOutperformance: { roi: number; isSignificant: boolean; pValue: number };
  };
}

interface SimulatedTrade {
  recommendationId: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  entryFee: number;
  exitFee: number;
  grossProfitLoss: number;
  netProfitLoss: number;
  roi: number;
  timestamp: string;
}

interface CumulativePerformance {
  timestamp: string;
  cumulativePL: number;
  cumulativeROI: number;
  tradeCount: number;
}
```

### Database Schema Considerations

The existing database schema already supports this feature through:

**Tables**:
- `markets`: Contains market metadata and status
- `recommendations`: Stores AI recommendations
- `recommendation_outcomes`: Links recommendations to actual outcomes
- `agent_signals`: Individual agent predictions

**Views**:
- `v_closed_markets_performance`: Primary data source (already exists)
- Provides all necessary fields for performance analysis

**New Requirements**:
- Price history storage: Need to add `market_price_history` table or fetch from Polymarket API
- Caching layer for expensive calculations (use React Query cache)

**Proposed New Table** (if price history not available from API):

```sql
CREATE TABLE market_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL REFERENCES markets(id),
  timestamp TIMESTAMPTZ NOT NULL,
  price DECIMAL(10, 8) NOT NULL,
  volume DECIMAL(20, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_market_timestamp UNIQUE (market_id, timestamp)
);

CREATE INDEX idx_market_price_history_market_id ON market_price_history(market_id);
CREATE INDEX idx_market_price_history_timestamp ON market_price_history(timestamp);
```



## API and Data Fetching Strategy

### API Routes

#### 1. Enhanced Performance Endpoint
**Route**: `/api/tradewizard/performance`

**Existing Functionality**:
- Returns aggregate performance data
- Supports filtering by timeframe, category, confidence

**New Enhancements**:
```typescript
// Query Parameters
interface PerformanceQueryParams {
  timeframe?: "all" | "30d" | "90d" | "1y";
  category?: string;
  confidence?: "all" | "high" | "moderate" | "low";
  limit?: number;
  offset?: number; // For pagination
  includeSlug?: boolean; // Include market slug for navigation
}

// Response includes pagination metadata
interface PerformanceResponse {
  closedMarkets: EnhancedClosedMarketPerformance[];
  summary: PerformanceSummary;
  performanceByConfidence: PerformanceByConfidence[];
  performanceByAgent: PerformanceByAgent[];
  monthlyPerformance: MonthlyPerformance[];
  performanceByCategory: PerformanceByCategory[];
  calculatedMetrics: CalculatedMetrics;
  filters: FilterState;
  pagination: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}
```

#### 2. Market Performance Detail Endpoint
**Route**: `/api/tradewizard/performance/[marketId]`

**Purpose**: Fetch detailed performance data for a single market

```typescript
interface MarketPerformanceDetailResponse {
  market: {
    id: string;
    conditionId: string;
    question: string;
    description: string;
    eventType: string;
    resolvedOutcome: string;
    resolutionDate: string;
    slug: string;
  };
  recommendations: RecommendationWithOutcome[];
  priceHistory: PricePoint[];
  metrics: PerformanceMetrics;
  agentSignals: Array<{
    agentName: string;
    direction: string;
    confidence: number;
    fairProbability: number;
  }>;
}
```

**Implementation**:
```typescript
// app/api/tradewizard/performance/[marketId]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const { marketId } = params;
  
  // Fetch from Supabase
  const { data: recommendations, error } = await supabase
    .from('v_closed_markets_performance')
    .select('*')
    .eq('market_id', marketId)
    .order('recommendation_created_at', { ascending: true });
    
  if (error) throw error;
  
  // Fetch price history (from Polymarket API or database)
  const priceHistory = await fetchPriceHistory(marketId);
  
  // Calculate metrics
  const metrics = calculatePerformanceMetrics(recommendations, priceHistory);
  
  return Response.json({
    market: recommendations[0], // Market info from first record
    recommendations,
    priceHistory,
    metrics,
  });
}
```

#### 3. Price History Endpoint
**Route**: `/api/polymarket/price-history/[conditionId]`

**Purpose**: Fetch historical price data for a market

```typescript
interface PriceHistoryQueryParams {
  startDate?: string;
  endDate?: string;
  interval?: "1h" | "1d"; // Granularity
}

interface PriceHistoryResponse {
  conditionId: string;
  prices: PricePoint[];
  metadata: {
    firstPrice: number;
    lastPrice: number;
    highPrice: number;
    lowPrice: number;
    totalVolume: number;
  };
}
```

**Data Source Options**:
1. Polymarket Gamma API (if available)
2. Stored in `market_price_history` table
3. Fallback: Reconstruct from order book snapshots

### Custom Hooks

#### useMarketPerformance
```typescript
export function useMarketPerformance(marketId: string) {
  return useQuery({
    queryKey: ['market-performance', marketId],
    queryFn: async () => {
      const response = await fetch(`/api/tradewizard/performance/${marketId}`);
      if (!response.ok) throw new Error('Failed to fetch market performance');
      return response.json() as Promise<MarketPerformanceDetailResponse>;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes (closed markets don't change)
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}
```

#### usePriceHistory
```typescript
export function usePriceHistory(conditionId: string, options?: PriceHistoryQueryParams) {
  return useQuery({
    queryKey: ['price-history', conditionId, options],
    queryFn: async () => {
      const params = new URLSearchParams(options as any);
      const response = await fetch(`/api/polymarket/price-history/${conditionId}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch price history');
      return response.json() as Promise<PriceHistoryResponse>;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}
```

#### useSimulatedPortfolio
```typescript
export function useSimulatedPortfolio(
  recommendations: RecommendationWithOutcome[],
  investmentAmount: number
) {
  return useMemo(() => {
    return calculateSimulatedPortfolio(recommendations, investmentAmount);
  }, [recommendations, investmentAmount]);
}

function calculateSimulatedPortfolio(
  recommendations: RecommendationWithOutcome[],
  investmentAmount: number
): {
  trades: SimulatedTrade[];
  cumulative: CumulativePerformance[];
  summary: {
    totalPL: number;
    totalROI: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
  };
} {
  const POLYMARKET_FEE = 0.02; // 2% on winning positions
  const trades: SimulatedTrade[] = [];
  const cumulative: CumulativePerformance[] = [];
  
  let cumulativePL = 0;
  
  recommendations.forEach((rec) => {
    const entryPrice = rec.marketPriceAtRecommendation;
    const exitPrice = rec.exitPrice || (rec.actualOutcome === 'YES' ? 1 : 0);
    
    // Calculate shares purchased
    const shares = investmentAmount / entryPrice;
    
    // Calculate gross P/L
    const grossPL = shares * (exitPrice - entryPrice);
    
    // Apply fees (only on winning positions)
    const fees = grossPL > 0 ? grossPL * POLYMARKET_FEE : 0;
    const netPL = grossPL - fees;
    
    const roi = (netPL / investmentAmount) * 100;
    
    trades.push({
      recommendationId: rec.id,
      entryPrice,
      exitPrice,
      shares,
      entryFee: 0, // Polymarket doesn't charge entry fees
      exitFee: fees,
      grossProfitLoss: grossPL,
      netProfitLoss: netPL,
      roi,
      timestamp: rec.createdAt,
    });
    
    cumulativePL += netPL;
    
    cumulative.push({
      timestamp: rec.createdAt,
      cumulativePL,
      cumulativeROI: (cumulativePL / (investmentAmount * trades.length)) * 100,
      tradeCount: trades.length,
    });
  });
  
  const wins = trades.filter(t => t.netProfitLoss > 0);
  const losses = trades.filter(t => t.netProfitLoss < 0);
  
  return {
    trades,
    cumulative,
    summary: {
      totalPL: cumulativePL,
      totalROI: (cumulativePL / (investmentAmount * trades.length)) * 100,
      winRate: (wins.length / trades.length) * 100,
      avgWin: wins.reduce((sum, t) => sum + t.netProfitLoss, 0) / wins.length || 0,
      avgLoss: losses.reduce((sum, t) => sum + t.netProfitLoss, 0) / losses.length || 0,
    },
  };
}
```

### Caching Strategy

**TanStack Query Configuration**:
```typescript
// providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes default
      gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
      refetchOnWindowFocus: false, // Closed markets don't change
      retry: 2,
    },
  },
});
```

**Cache Keys**:
- `['performance', filters]` - Aggregate performance data
- `['market-performance', marketId]` - Single market performance
- `['price-history', conditionId, options]` - Price history
- `['closed-markets', filters, page]` - Paginated closed markets list



## Performance Optimization Strategies

### 1. Data Fetching Optimization

**Pagination**:
- Load 20 markets per page on performance page
- Implement infinite scroll or "Load More" button
- Prefetch next page on scroll proximity

**Lazy Loading**:
- Load Performance tab data only when tab is clicked
- Defer price history fetch until chart is visible
- Use React.lazy() for heavy chart components

**Query Optimization**:
```typescript
// Prefetch next page
const prefetchNextPage = () => {
  queryClient.prefetchQuery({
    queryKey: ['closed-markets', filters, currentPage + 1],
    queryFn: () => fetchClosedMarkets(filters, currentPage + 1),
  });
};

// Prefetch on hover
<MarketCard
  onMouseEnter={() => {
    queryClient.prefetchQuery({
      queryKey: ['market-performance', market.id],
      queryFn: () => fetchMarketPerformance(market.id),
    });
  }}
/>
```

### 2. Computation Optimization

**Memoization**:
```typescript
// Expensive calculations
const metrics = useMemo(
  () => calculatePerformanceMetrics(recommendations),
  [recommendations]
);

const simulatedPortfolio = useMemo(
  () => calculateSimulatedPortfolio(recommendations, investmentAmount),
  [recommendations, investmentAmount]
);

const riskMetrics = useMemo(
  () => calculateRiskMetrics(returns),
  [returns]
);
```

**Web Workers** (for heavy calculations):
```typescript
// utils/performance-worker.ts
// Calculate risk metrics in background thread
self.addEventListener('message', (e) => {
  const { type, data } = e.data;
  
  if (type === 'CALCULATE_RISK_METRICS') {
    const metrics = calculateRiskMetrics(data.returns);
    self.postMessage({ type: 'RISK_METRICS_RESULT', data: metrics });
  }
});

// Hook to use worker
export function useRiskMetricsWorker(returns: number[]) {
  const [metrics, setMetrics] = useState<RiskMetricsData | null>(null);
  
  useEffect(() => {
    const worker = new Worker(new URL('./performance-worker.ts', import.meta.url));
    
    worker.postMessage({ type: 'CALCULATE_RISK_METRICS', data: { returns } });
    
    worker.onmessage = (e) => {
      if (e.data.type === 'RISK_METRICS_RESULT') {
        setMetrics(e.data.data);
      }
    };
    
    return () => worker.terminate();
  }, [returns]);
  
  return metrics;
}
```

### 3. Rendering Optimization

**Virtual Scrolling** (for long lists):
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function RecommendationTimeline({ recommendations }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: recommendations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Estimated row height
    overscan: 5,
  });
  
  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <RecommendationItem recommendation={recommendations[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Chart Optimization**:
```typescript
// Downsample price data for chart rendering
function downsamplePriceData(
  data: PricePoint[],
  maxPoints: number = 200
): PricePoint[] {
  if (data.length <= maxPoints) return data;
  
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, index) => index % step === 0);
}

// Use in chart component
const chartData = useMemo(
  () => downsamplePriceData(priceHistory, 200),
  [priceHistory]
);
```

**Code Splitting**:
```typescript
// Lazy load heavy components
const PriceChartWithMarkers = lazy(() => import('./PriceChartWithMarkers'));
const CalibrationAnalysis = lazy(() => import('./CalibrationAnalysis'));

// Use with Suspense
<Suspense fallback={<LoadingState />}>
  <PriceChartWithMarkers {...props} />
</Suspense>
```

### 4. Mobile Optimization

**Responsive Data Loading**:
```typescript
// Load less data on mobile
const isMobile = useMediaQuery('(max-width: 768px)');
const pageSize = isMobile ? 10 : 20;
const chartPoints = isMobile ? 100 : 200;
```

**Touch Interactions**:
```typescript
// Use react-use-gesture for better touch handling
import { useGesture } from '@use-gesture/react';

function PriceChart({ data }: Props) {
  const [zoom, setZoom] = useState(1);
  
  const bind = useGesture({
    onPinch: ({ offset: [scale] }) => {
      setZoom(scale);
    },
  });
  
  return <div {...bind()}>{/* Chart */}</div>;
}
```

### 5. Bundle Size Optimization

**Tree Shaking**:
```typescript
// Import only needed Recharts components
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
// Instead of: import * as Recharts from 'recharts';
```

**Dynamic Imports**:
```typescript
// Load CSV export library only when needed
async function exportToCSV(data: any) {
  const { unparse } = await import('papaparse');
  const csv = unparse(data);
  downloadFile(csv, 'performance.csv');
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies and consolidations:

**Redundancy Analysis**:
1. Properties 1.1, 1.3, 1.4, 1.5 all relate to displaying closed markets correctly - can be consolidated into comprehensive display properties
2. Properties 5.1, 5.2, 5.3 all relate to accuracy calculation - can be combined into one accuracy property
3. Properties 7.1-7.5 all relate to ROI calculations - can be consolidated
4. Properties 8.1-8.5 all relate to recommendation timeline display - can be combined
5. Properties 4.2-4.5 all relate to P/L calculation logic - can be consolidated into comprehensive calculation properties

**Consolidated Properties**:

### Property 1: Closed Markets Retrieval and Sorting
*For any* database query on the performance page, all returned markets should have status='closed' and be sorted by resolution_date in descending order.

**Validates: Requirements 1.1, 1.3**

### Property 2: Market Display Completeness
*For any* closed market displayed on the performance page, the rendered output should contain the market title, resolution outcome, and a visual indicator if no recommendations exist.

**Validates: Requirements 1.4, 1.5**

### Property 3: Pagination Activation
*For any* closed markets list with more than 20 items, pagination controls should be active and functional.

**Validates: Requirements 1.6**

### Property 4: Market Navigation
*For any* closed market card click, the application should navigate to the market detail view without page reload.

**Validates: Requirements 2.1**

### Property 5: Trading Disabled for Closed Markets
*For any* closed market in the detail view, all trading action buttons should be disabled or hidden.

**Validates: Requirements 2.3**

### Property 6: Performance Tab Conditional Rendering
*For any* closed market, the Performance tab should be visible if and only if the market has at least one AI recommendation.

**Validates: Requirements 3.1, 3.2**

### Property 7: Tab Navigation Without Page Reload
*For any* Performance tab click, the content should display without changing the browser URL path.

**Validates: Requirements 3.3**

### Property 8: Investment Simulation Calculation
*For any* set of recommendations and investment amount, the simulated portfolio calculation should:
- Calculate P/L for each recommendation using entry/exit prices
- Use final resolution price for recommendations without exit points
- Apply 2% Polymarket fees on winning positions only
- Sum to produce accurate total P/L and ROI

**Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.7**

### Property 9: Cumulative P/L Chart Rendering
*For any* set of simulated trades, the cumulative P/L chart should display data points in chronological order with cumulative values increasing/decreasing correctly.

**Validates: Requirements 4.6**

### Property 10: Accuracy Calculation
*For any* set of recommendations, accuracy percentage should equal (correct_predictions / total_predictions) * 100, where a prediction is correct if the recommended direction matches the actual outcome.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 11: Confidence Metrics
*For any* set of recommendations, the average confidence and confidence-accuracy correlation should be calculated correctly using standard statistical formulas.

**Validates: Requirements 5.4, 5.5**

### Property 12: Price Chart Marker Placement
*For any* recommendation, entry and exit markers should appear on the price chart at timestamps matching the recommendation creation and exit signal times.

**Validates: Requirements 6.2, 6.3**

### Property 13: Marker Tooltip Display
*For any* entry or exit marker hover event, a tooltip should display containing the full recommendation details.

**Validates: Requirements 6.4**

### Property 14: Profitability Visual Distinction
*For any* recommendation period on the chart, the visual styling should reflect whether the recommendation was profitable (green) or unprofitable (red).

**Validates: Requirements 6.5**

### Property 15: ROI Metrics Calculation
*For any* set of recommendations, the system should correctly calculate and display total ROI, average ROI, best ROI (maximum), and worst ROI (minimum).

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 16: Recommendation Timeline Ordering and Completeness
*For any* set of recommendations, the timeline should display all recommendations in chronological order with timestamp, type, confidence, market price, and individual ROI visible for each.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 17: Timeline-Chart Interaction
*For any* recommendation click in the timeline, the corresponding period should be highlighted on the price chart.

**Validates: Requirements 8.6**

### Property 18: Risk Metrics Calculation
*For any* set of returns, Sharpe ratio, maximum drawdown, and volatility should be calculated using standard financial formulas.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 19: Calibration Analysis
*For any* set of recommendations, the calibration scatter plot should correctly plot confidence levels against outcomes, and calibration error should be calculated as the mean absolute difference between predicted probabilities and actual outcomes.

**Validates: Requirements 10.1, 10.2**

### Property 20: Calibration Highlighting
*For any* recommendation with high confidence, it should be visually highlighted as strong calibration if correct, or poor calibration if incorrect.

**Validates: Requirements 10.3, 10.4**

### Property 21: Confidence Segmentation
*For any* set of recommendations, average confidence should be calculated separately for accurate and inaccurate predictions.

**Validates: Requirements 10.5**

### Property 22: Query Filtering
*For any* database query from the performance page, only markets with status='closed' should be returned, and only recommendations for the specific market should be fetched in the detail view.

**Validates: Requirements 11.1, 11.3**

### Property 23: Calculation Caching
*For any* repeated performance calculation with identical inputs, the cached result should be returned without recomputation.

**Validates: Requirements 11.4**

### Property 24: Loading State Display
*For any* data fetch operation, a loading indicator should be displayed until data is available or an error occurs.

**Validates: Requirements 11.5**

### Property 25: Baseline Strategy Calculation
*For any* market with recommendations, buy-and-hold ROI should be calculated as (final_price - first_recommendation_price) / first_recommendation_price, and random strategy ROI should be the average of Monte Carlo simulations.

**Validates: Requirements 12.1, 12.2**

### Property 26: Performance Comparison Display
*For any* market performance view, AI performance and baseline strategies should be displayed side-by-side with visual highlighting when AI outperforms.

**Validates: Requirements 12.3, 12.4**

### Property 27: Statistical Significance
*For any* AI vs baseline comparison, statistical significance should be calculated using a t-test with p-value < 0.05 indicating significance.

**Validates: Requirements 12.5**

### Property 28: CSV Export Completeness
*For any* export action, the generated CSV should include all performance metrics: timestamps, recommendations, prices, ROI, accuracy, risk metrics, and be named with market title and export timestamp.

**Validates: Requirements 13.2, 13.3, 13.5**

### Property 29: CSV Download Trigger
*For any* export button click, a CSV file should download to the user's device.

**Validates: Requirements 13.4**

### Property 30: Mobile Layout Activation
*For any* viewport with width < 768px, the mobile-optimized layout should activate with vertically stacked charts and touch-friendly controls.

**Validates: Requirements 14.1, 14.2, 14.3, 14.5**

### Property 31: Mobile Text Readability
*For any* mobile viewport, all text and numbers should maintain minimum readable font sizes (14px for body, 12px for labels).

**Validates: Requirements 14.4**

### Property 32: Error Handling for Incomplete Data
*For any* market with incomplete price history or recommendations missing entry/exit data, appropriate warning messages should be displayed and incomplete data should be excluded from calculations.

**Validates: Requirements 15.1, 15.2**

### Property 33: Database Error Handling
*For any* failed database query, an error message and retry option should be displayed to the user.

**Validates: Requirements 15.3**

### Property 34: Empty State Display
*For any* query returning zero closed markets, an empty state message should be displayed.

**Validates: Requirements 15.4**

### Property 35: Division by Zero Handling
*For any* calculation encountering division by zero, the result should display "N/A" instead of throwing an error.

**Validates: Requirements 15.5**



## Error Handling

### Error Categories and Strategies

#### 1. Data Fetching Errors

**Scenario**: API request fails or times out

**Handling**:
```typescript
function PerformanceTab({ marketId }: Props) {
  const { data, error, isLoading, refetch } = useMarketPerformance(marketId);
  
  if (error) {
    return (
      <ErrorState
        title="Failed to load performance data"
        message={error.message}
        action={{
          label: "Retry",
          onClick: refetch,
        }}
      />
    );
  }
  
  // ... render content
}
```

**User Experience**:
- Display clear error message
- Provide retry button
- Log error details for debugging
- Fallback to cached data if available

#### 2. Incomplete Data Errors

**Scenario**: Market has recommendations but missing price history

**Handling**:
```typescript
function PriceChartWithMarkers({ priceHistory, recommendations }: Props) {
  if (!priceHistory || priceHistory.length < 2) {
    return (
      <div className="p-6 border border-yellow-500/20 bg-yellow-500/5 rounded-lg">
        <div className="flex items-center gap-2 text-yellow-400 mb-2">
          <AlertTriangle className="w-5 h-5" />
          <span className="font-medium">Incomplete Price Data</span>
        </div>
        <p className="text-sm text-gray-400">
          Historical price data is incomplete for this market. 
          Some performance metrics may be unavailable.
        </p>
      </div>
    );
  }
  
  // ... render chart
}
```

**User Experience**:
- Display warning banner
- Explain what data is missing
- Show available metrics
- Don't block entire UI

#### 3. Calculation Errors

**Scenario**: Division by zero or invalid input

**Handling**:
```typescript
function calculateROI(entryPrice: number, exitPrice: number): number | null {
  if (entryPrice === 0) {
    console.warn('Cannot calculate ROI: entry price is zero');
    return null;
  }
  
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

// In component
function ROIDisplay({ roi }: { roi: number | null }) {
  return (
    <div className="text-2xl font-bold">
      {roi !== null ? `${roi.toFixed(2)}%` : 'N/A'}
    </div>
  );
}
```

**User Experience**:
- Display "N/A" for invalid calculations
- Don't crash the application
- Log warnings for debugging

#### 4. Missing Recommendations

**Scenario**: Closed market has no AI recommendations

**Handling**:
```typescript
function MarketDetails({ market }: Props) {
  const hasRecommendations = market.recommendations?.length > 0;
  
  return (
    <div>
      <TabNavigation>
        <Tab>Overview</Tab>
        {hasRecommendations && <Tab>Performance</Tab>}
      </TabNavigation>
      
      {!hasRecommendations && (
        <div className="mt-4 p-4 border border-gray-700 rounded-lg bg-gray-800/50">
          <div className="flex items-center gap-2 text-gray-400">
            <Info className="w-4 h-4" />
            <span className="text-sm">
              No AI analysis was performed for this market
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

**User Experience**:
- Hide Performance tab
- Display informational message
- Don't show as error (it's expected)

#### 5. Export Errors

**Scenario**: CSV generation or download fails

**Handling**:
```typescript
async function handleExport() {
  try {
    setExporting(true);
    const csv = generateCSV(performanceData);
    downloadFile(csv, `${marketTitle}-performance-${Date.now()}.csv`);
    toast.success('Performance data exported successfully');
  } catch (error) {
    console.error('Export failed:', error);
    toast.error('Failed to export data. Please try again.');
  } finally {
    setExporting(false);
  }
}
```

**User Experience**:
- Show loading state during export
- Display success/error toast
- Allow retry
- Don't block UI

#### 6. Mobile Rendering Errors

**Scenario**: Chart library fails on mobile device

**Handling**:
```typescript
function PriceChart({ data }: Props) {
  const [renderError, setRenderError] = useState(false);
  
  if (renderError) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-400 mb-4">
          Chart rendering is not supported on this device
        </p>
        <button onClick={() => exportToCSV(data)}>
          Download Data Instead
        </button>
      </div>
    );
  }
  
  return (
    <ErrorBoundary
      fallback={<ChartFallback />}
      onError={() => setRenderError(true)}
    >
      <ResponsiveContainer>
        <LineChart data={data}>
          {/* ... */}
        </LineChart>
      </ResponsiveContainer>
    </ErrorBoundary>
  );
}
```

### Error Boundary Implementation

```typescript
// components/shared/ErrorBoundary.tsx
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // Log to error tracking service (e.g., Sentry)
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    
    return this.props.children;
  }
}
```

### Validation and Guards

```typescript
// Validate recommendation data before calculations
function validateRecommendation(rec: any): rec is RecommendationWithOutcome {
  return (
    rec &&
    typeof rec.id === 'string' &&
    typeof rec.fairProbability === 'number' &&
    rec.fairProbability >= 0 &&
    rec.fairProbability <= 1 &&
    typeof rec.marketPriceAtRecommendation === 'number' &&
    rec.marketPriceAtRecommendation >= 0 &&
    rec.marketPriceAtRecommendation <= 1
  );
}

// Use in calculations
function calculateMetrics(recommendations: any[]) {
  const validRecs = recommendations.filter(validateRecommendation);
  
  if (validRecs.length === 0) {
    return null; // No valid data
  }
  
  // Proceed with calculations
}
```



## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests to ensure comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property-based tests**: Verify universal properties across all inputs using randomized testing

Both approaches are complementary and necessary. Unit tests catch concrete bugs and validate specific scenarios, while property-based tests verify general correctness across a wide range of inputs.

### Property-Based Testing Configuration

**Library**: `fast-check` (JavaScript/TypeScript property-based testing library)

**Configuration**:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    // ... other config
    timeout: 30000, // 30s for property tests with many iterations
  },
});
```

**Test Structure**:
```typescript
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Performance Calculations', () => {
  it('Property 8: Investment simulation calculations', () => {
    /**
     * Feature: closed-markets-performance-viewer
     * Property 8: For any set of recommendations and investment amount,
     * the simulated portfolio calculation should calculate P/L correctly
     * with fees applied only to winning positions.
     */
    fc.assert(
      fc.property(
        fc.array(recommendationArbitrary(), { minLength: 1, maxLength: 20 }),
        fc.float({ min: 1, max: 10000 }),
        (recommendations, investmentAmount) => {
          const result = calculateSimulatedPortfolio(recommendations, investmentAmount);
          
          // Verify each trade has correct fee application
          result.trades.forEach((trade) => {
            if (trade.netProfitLoss > 0) {
              // Winning trade should have fees
              expect(trade.exitFee).toBeGreaterThan(0);
              expect(trade.exitFee).toBe(trade.grossProfitLoss * 0.02);
            } else {
              // Losing trade should have no fees
              expect(trade.exitFee).toBe(0);
            }
            
            // Net P/L should equal gross P/L minus fees
            expect(trade.netProfitLoss).toBe(trade.grossProfitLoss - trade.exitFee);
          });
          
          // Total P/L should equal sum of individual trades
          const sumOfTrades = result.trades.reduce((sum, t) => sum + t.netProfitLoss, 0);
          expect(result.summary.totalPL).toBeCloseTo(sumOfTrades, 2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Arbitrary generators for property tests
function recommendationArbitrary() {
  return fc.record({
    id: fc.uuid(),
    entryPrice: fc.float({ min: 0.01, max: 0.99 }),
    exitPrice: fc.float({ min: 0, max: 1 }),
    actualOutcome: fc.constantFrom('YES', 'NO'),
    createdAt: fc.date().map(d => d.toISOString()),
  });
}
```

**Minimum Iterations**: Each property test must run at least 100 iterations to ensure adequate coverage through randomization.

### Unit Testing Strategy

Unit tests focus on specific examples, edge cases, and integration points:

#### 1. Component Rendering Tests

```typescript
// components/Performance/InvestmentSimulator.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { InvestmentSimulator } from './InvestmentSimulator';

describe('InvestmentSimulator', () => {
  it('should display default investment amount of $100', () => {
    render(<InvestmentSimulator recommendations={[]} marketResolution="YES" />);
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });
  
  it('should update calculations when investment amount changes', () => {
    const recommendations = [mockRecommendation({ roiRealized: 0.15 })];
    const { rerender } = render(
      <InvestmentSimulator 
        recommendations={recommendations} 
        marketResolution="YES" 
      />
    );
    
    const input = screen.getByLabelText('Investment Amount');
    fireEvent.change(input, { target: { value: '200' } });
    
    // Verify P/L doubled
    expect(screen.getByText('$30.00')).toBeInTheDocument(); // 200 * 0.15
  });
  
  it('should handle zero recommendations gracefully', () => {
    render(<InvestmentSimulator recommendations={[]} marketResolution="YES" />);
    expect(screen.getByText('No recommendations available')).toBeInTheDocument();
  });
});
```

#### 2. Calculation Logic Tests

```typescript
// utils/performance-calculations.test.ts
describe('calculateROI', () => {
  it('should calculate positive ROI correctly', () => {
    const roi = calculateROI(0.5, 0.75);
    expect(roi).toBe(50); // (0.75 - 0.5) / 0.5 * 100
  });
  
  it('should calculate negative ROI correctly', () => {
    const roi = calculateROI(0.75, 0.5);
    expect(roi).toBe(-33.33);
  });
  
  it('should return null for zero entry price', () => {
    const roi = calculateROI(0, 0.5);
    expect(roi).toBeNull();
  });
  
  it('should handle edge case of entry price = exit price', () => {
    const roi = calculateROI(0.5, 0.5);
    expect(roi).toBe(0);
  });
});

describe('calculateSharpeRatio', () => {
  it('should calculate Sharpe ratio correctly', () => {
    const returns = [0.05, 0.10, -0.03, 0.08, 0.12];
    const sharpe = calculateSharpeRatio(returns);
    
    const avgReturn = 0.064;
    const stdDev = 0.0565;
    const expectedSharpe = avgReturn / stdDev;
    
    expect(sharpe).toBeCloseTo(expectedSharpe, 2);
  });
  
  it('should return null for zero volatility', () => {
    const returns = [0.05, 0.05, 0.05];
    const sharpe = calculateSharpeRatio(returns);
    expect(sharpe).toBeNull();
  });
});
```

#### 3. Hook Tests

```typescript
// hooks/useMarketPerformance.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMarketPerformance } from './useMarketPerformance';

describe('useMarketPerformance', () => {
  it('should fetch market performance data', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    
    const { result } = renderHook(() => useMarketPerformance('market-123'), { wrapper });
    
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    
    expect(result.current.data).toHaveProperty('recommendations');
    expect(result.current.data).toHaveProperty('metrics');
  });
  
  it('should handle fetch errors gracefully', async () => {
    // Mock fetch to fail
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
    
    const queryClient = new QueryClient();
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    
    const { result } = renderHook(() => useMarketPerformance('invalid-id'), { wrapper });
    
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
```

#### 4. Integration Tests

```typescript
// app/performance/page.integration.test.tsx
describe('Performance Page Integration', () => {
  it('should display closed markets and navigate to detail view', async () => {
    render(<PerformancePage />);
    
    // Wait for markets to load
    await waitFor(() => {
      expect(screen.getByText('Performance Dashboard')).toBeInTheDocument();
    });
    
    // Verify markets are displayed
    const marketCards = screen.getAllByRole('article');
    expect(marketCards.length).toBeGreaterThan(0);
    
    // Click on first market
    fireEvent.click(marketCards[0]);
    
    // Verify navigation occurred
    await waitFor(() => {
      expect(window.location.pathname).toMatch(/\/market\//);
    });
  });
  
  it('should filter markets by confidence level', async () => {
    render(<PerformancePage />);
    
    await waitFor(() => {
      expect(screen.getByText('Performance Dashboard')).toBeInTheDocument();
    });
    
    // Select high confidence filter
    const confidenceFilter = screen.getByLabelText('Confidence');
    fireEvent.change(confidenceFilter, { target: { value: 'high' } });
    
    // Verify filtered results
    await waitFor(() => {
      const badges = screen.getAllByText('HIGH');
      expect(badges.length).toBeGreaterThan(0);
    });
  });
});
```

### Property Test Examples

#### Property 10: Accuracy Calculation
```typescript
it('Property 10: Accuracy calculation correctness', () => {
  /**
   * Feature: closed-markets-performance-viewer
   * Property 10: For any set of recommendations, accuracy percentage
   * should equal (correct_predictions / total_predictions) * 100
   */
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          wasCorrect: fc.boolean(),
          direction: fc.constantFrom('LONG_YES', 'LONG_NO'),
          actualOutcome: fc.constantFrom('YES', 'NO'),
        }),
        { minLength: 1, maxLength: 100 }
      ),
      (recommendations) => {
        const metrics = calculateAccuracyMetrics(recommendations);
        
        const correctCount = recommendations.filter(r => r.wasCorrect).length;
        const expectedAccuracy = (correctCount / recommendations.length) * 100;
        
        expect(metrics.accuracyPercentage).toBeCloseTo(expectedAccuracy, 2);
        expect(metrics.totalRecommendations).toBe(recommendations.length);
        expect(metrics.correctRecommendations).toBe(correctCount);
      }
    ),
    { numRuns: 100 }
  );
});
```

#### Property 3: Pagination Activation
```typescript
it('Property 3: Pagination activates for >20 markets', () => {
  /**
   * Feature: closed-markets-performance-viewer
   * Property 3: For any closed markets list with more than 20 items,
   * pagination controls should be active and functional
   */
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }),
      (marketCount) => {
        const markets = Array.from({ length: marketCount }, (_, i) => 
          mockClosedMarket({ id: `market-${i}` })
        );
        
        const { container } = render(<ClosedMarketsList markets={markets} />);
        
        const paginationControls = container.querySelector('[data-testid="pagination"]');
        
        if (marketCount > 20) {
          expect(paginationControls).toBeInTheDocument();
          expect(paginationControls).not.toHaveAttribute('disabled');
        } else {
          expect(paginationControls).not.toBeInTheDocument();
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

#### Property 16: Timeline Ordering
```typescript
it('Property 16: Recommendation timeline chronological ordering', () => {
  /**
   * Feature: closed-markets-performance-viewer
   * Property 16: For any set of recommendations, the timeline should
   * display all recommendations in chronological order
   */
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          id: fc.uuid(),
          createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date() })
            .map(d => d.toISOString()),
        }),
        { minLength: 2, maxLength: 50 }
      ),
      (recommendations) => {
        const { container } = render(
          <RecommendationTimeline recommendations={recommendations} />
        );
        
        const timelineItems = container.querySelectorAll('[data-testid="timeline-item"]');
        const timestamps = Array.from(timelineItems).map(
          item => new Date(item.getAttribute('data-timestamp')!).getTime()
        );
        
        // Verify chronological order (ascending)
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Coverage Goals

- **Unit Test Coverage**: Minimum 80% line coverage
- **Property Test Coverage**: All 35 correctness properties must have corresponding property tests
- **Integration Test Coverage**: All major user flows (view markets, navigate to detail, interact with tabs, export data)
- **Edge Case Coverage**: Empty states, error states, incomplete data, mobile viewports

### Testing Commands

```bash
# Run all tests
npm test

# Run unit tests only
npm test -- --grep -v "Property"

# Run property tests only
npm test -- --grep "Property"

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- performance-calculations.test.ts

# Watch mode for development
npm test -- --watch
```



## Integration Points with Existing Codebase

### 1. Performance Page Enhancement

**File**: `app/performance/page.tsx`

**Current State**: Displays aggregate performance metrics and closed markets list

**Required Changes**:
- Replace `ClosedMarketsList` with `ClosedMarketsGrid` component
- Add pagination support using TanStack Query's infinite query pattern
- Enhance market cards to use homepage UI pattern
- Add click handlers for navigation to market detail

**Integration Pattern**:
```typescript
// Use existing usePerformanceData hook with pagination
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['closed-markets', filters],
  queryFn: ({ pageParam = 0 }) => fetchClosedMarkets(filters, pageParam),
  getNextPageParam: (lastPage, pages) => {
    return lastPage.hasMore ? pages.length * 20 : undefined;
  },
  initialPageParam: 0,
});
```

### 2. Market Detail View Enhancement

**File**: `app/market/[slug]/page.tsx` and `components/Trading/Markets/MarketDetails.tsx`

**Current State**: Displays market information and trading interface

**Required Changes**:
- Add tab navigation component
- Conditionally render Performance tab for closed markets with recommendations
- Disable trading actions when market is closed
- Display resolution outcome prominently

**Integration Pattern**:
```typescript
function MarketDetails({ market }: Props) {
  const isClosed = market.status === 'closed';
  const hasRecommendations = market.recommendations?.length > 0;
  const [activeTab, setActiveTab] = useState<'overview' | 'performance'>('overview');
  
  return (
    <div>
      {/* Existing market header */}
      <MarketHeader market={market} />
      
      {/* Resolution banner for closed markets */}
      {isClosed && (
        <ResolutionBanner 
          outcome={market.resolvedOutcome} 
          date={market.resolutionDate} 
        />
      )}
      
      {/* Tab navigation */}
      <TabNavigation>
        <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          Overview
        </Tab>
        {isClosed && hasRecommendations && (
          <Tab active={activeTab === 'performance'} onClick={() => setActiveTab('performance')}>
            Performance
          </Tab>
        )}
      </TabNavigation>
      
      {/* Tab content */}
      {activeTab === 'overview' ? (
        <MarketOverview market={market} tradingDisabled={isClosed} />
      ) : (
        <PerformanceTab 
          marketId={market.id}
          conditionId={market.conditionId}
          resolvedOutcome={market.resolvedOutcome}
          resolutionDate={market.resolutionDate}
        />
      )}
    </div>
  );
}
```

### 3. Shared Component Reuse

**Homepage Market Card Pattern**:
- Reuse card styling from `components/Trading/Markets/MarketCard.tsx`
- Adapt for closed market display with resolution outcome
- Maintain consistent hover effects and animations

**Chart Components**:
- Leverage existing Recharts configuration from `components/Performance/PerformanceCharts.tsx`
- Extend with marker overlay functionality
- Reuse responsive container patterns

**Loading and Error States**:
- Use existing `components/shared/LoadingState.tsx`
- Use existing `components/shared/ErrorState.tsx`
- Use existing `components/shared/EmptyState.tsx`

### 4. API Route Integration

**Existing Route**: `/api/tradewizard/performance`

**Enhancement Strategy**:
- Add pagination parameters to existing endpoint
- Maintain backward compatibility with current aggregate view
- Add optional `includeSlug` parameter for navigation support

**New Routes**:
- `/api/tradewizard/performance/[marketId]` - Market-specific performance
- `/api/polymarket/price-history/[conditionId]` - Historical price data

### 5. Database View Usage

**Existing View**: `v_closed_markets_performance`

**Current Usage**: Already used by performance page for aggregate metrics

**New Usage Patterns**:
- Filter by specific market_id for detail view
- Join with price history data (if stored in database)
- Leverage existing indexes for efficient queries

### 6. Hook Composition

**Existing Hooks to Leverage**:
- `usePerformanceData` - Extend for pagination
- `usePriceHistory` - New hook following existing patterns
- `useDebounce` - For investment amount input
- `useInfiniteScroll` - For pagination

**New Hooks to Create**:
- `useMarketPerformance` - Fetch single market performance
- `useSimulatedPortfolio` - Calculate P/L simulations
- `useRiskMetrics` - Calculate risk-adjusted returns

### 7. Styling Integration

**Tailwind Classes**: Reuse existing design system
- Card styles: `bg-white/5 border border-white/10 rounded-xl`
- Hover effects: `hover:bg-white/10 transition-all duration-300`
- Text colors: `text-white`, `text-gray-400`, `text-emerald-400`, `text-red-400`
- Spacing: Consistent with existing `gap-4`, `p-6`, `space-y-4` patterns

**Framer Motion**: Reuse existing animation patterns
- Stagger animations for list items
- Fade-in transitions for tab content
- Expand/collapse animations for accordions

### 8. Mobile Responsiveness

**Existing Patterns**: Follow mobile optimization from `styles/mobile-optimizations.css`
- Breakpoints: `md:` (768px), `lg:` (1024px)
- Stack layouts vertically on mobile
- Touch-friendly button sizes (min 44px)
- Readable font sizes (min 14px body, 12px labels)

## Deployment Considerations

### Database Migrations

If price history storage is required:

```sql
-- Migration: Add market_price_history table
-- File: tradewizard-agents/src/database/migrations/add-price-history.sql

CREATE TABLE IF NOT EXISTS market_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  price DECIMAL(10, 8) NOT NULL CHECK (price >= 0 AND price <= 1),
  volume DECIMAL(20, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_market_timestamp UNIQUE (market_id, timestamp)
);

CREATE INDEX idx_market_price_history_market_id ON market_price_history(market_id);
CREATE INDEX idx_market_price_history_timestamp ON market_price_history(timestamp DESC);

-- Add index to markets table for closed market queries
CREATE INDEX IF NOT EXISTS idx_markets_status_resolution 
  ON markets(status, resolution_date DESC) 
  WHERE status = 'closed';
```

### Environment Variables

No new environment variables required. Existing configuration sufficient:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Polymarket API credentials (if price history fetched from API)

### Performance Monitoring

**Metrics to Track**:
- Page load time for performance page
- Time to interactive for Performance tab
- API response times for market performance endpoint
- Cache hit rates for TanStack Query
- Chart rendering performance on mobile devices

**Monitoring Tools**:
- Next.js built-in analytics
- Vercel Analytics (if deployed on Vercel)
- Browser Performance API for client-side metrics

### Rollout Strategy

**Phase 1**: Performance Page Enhancement
- Deploy closed markets grid with pagination
- Verify data fetching and display
- Test mobile responsiveness

**Phase 2**: Market Detail Performance Tab
- Add tab navigation to market detail view
- Implement basic performance metrics display
- Deploy investment simulator

**Phase 3**: Advanced Analytics
- Add risk metrics calculations
- Implement calibration analysis
- Add baseline comparisons

**Phase 4**: Polish and Optimization
- Add export functionality
- Optimize chart rendering
- Implement advanced caching strategies

### Rollback Plan

If issues arise:
1. Feature flag to disable Performance tab
2. Revert to existing ClosedMarketsList component
3. Database migrations are additive (no data loss)
4. API routes are backward compatible

## Future Enhancements

### Potential Additions (Out of Scope for Initial Release)

1. **Custom Baseline Strategies**: Allow users to define their own baseline strategies for comparison

2. **Portfolio Tracking**: Track multiple markets as a portfolio with aggregate metrics

3. **Performance Alerts**: Notify users when closed markets demonstrate specific performance patterns

4. **Advanced Filtering**: Filter by agent consensus level, market category, time to resolution

5. **Comparative Analysis**: Compare performance across different market categories or time periods

6. **Machine Learning Insights**: Identify patterns in successful vs unsuccessful recommendations

7. **Social Sharing**: Share performance results on social media with generated images

8. **Historical Backtesting**: Test current AI model against historical closed markets

9. **Performance Leaderboard**: Rank markets by AI performance metrics

10. **API Access**: Provide programmatic access to performance data for external analysis

## Summary

This design provides a comprehensive architecture for the Closed Markets Performance Viewer feature. Key highlights:

- **Reuses existing patterns**: Leverages homepage UI, existing hooks, and database views
- **Scalable architecture**: Pagination, caching, and optimization strategies for performance
- **Comprehensive testing**: Dual approach with unit tests and property-based tests
- **Mobile-first**: Responsive design with touch-friendly interactions
- **Error resilient**: Graceful degradation and clear error messaging
- **Extensible**: Modular component design allows for future enhancements

The implementation follows TradeWizard's existing architectural patterns while introducing new capabilities for users to verify AI recommendation accuracy and value through detailed performance analysis.

