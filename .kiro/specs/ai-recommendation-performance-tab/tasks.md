# Implementation Plan: AI Recommendation Performance Tab

## Overview

Implement the Performance tab on the market details page. The previous attempt was reverted due to three root-cause bugs: (1) the hook used hardcoded resolved-market cache settings for all markets, (2) the component displayed `roiRealized: 0` from the API for active markets instead of computing live P&L from `currentMarketPrice`, and (3) the sub-component split was missing. This plan addresses all three in strict dependency order.

## Tasks

- [x] 1. Create performance utility helpers
  - Create `utils/performanceHelpers.ts` exporting `computeLivePnL`, `computeRecommendationStatus`, `formatPrice`, `formatProbability`, `formatROI`, and the `RecommendationStatus` type + `STATUS_BADGE_MAP` constant
  - `computeLivePnL(rec, currentYesPrice)` - returns `null` for NO_TRADE or non-finite entry; for LONG_YES: `((currentYesPrice - entryMid) / entryMid) * 100`; for LONG_NO: `((noCurrent - noEntry) / noEntry) * 100`
  - `computeRecommendationStatus(rec, currentYesPrice)` - returns one of `"in-entry-zone" | "above-target" | "below-stop" | "between-entry-and-target" | "pending"` per the design's zone logic for both LONG_YES and LONG_NO
  - `formatPrice(v)` / `formatProbability(v)` / `formatROI(v)` - each returns `"N/A"` for null/undefined/NaN/Infinity/-Infinity; otherwise `toFixed(2)`, `(v*100).toFixed(1)+"%"`, and `±X.XX%` respectively
  - _Requirements: 3.2, 9.1, 11.1, 11.2, 11.3, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 1.1 Write unit tests for `computeLivePnL`
    - LONG_YES with known entry/current → expected P&L value
    - LONG_NO with known entry/current → expected P&L value
    - NO_TRADE → null; zero entry midpoint → null; non-finite entry → null
    - _Requirements: 3.2, 11.7_

  - [ ]* 1.2 Write unit tests for `computeRecommendationStatus`
    - Each of the 5 status values for LONG_YES and LONG_NO
    - NO_TRADE → "pending"; invalid price (0, NaN, Infinity) → "pending"
    - _Requirements: 9.1, 3.3–3.7_

  - [ ]* 1.3 Write unit tests for format helpers
    - null, NaN, Infinity, -Infinity → "N/A" for all three formatters
    - Valid values → correct formatted strings
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 11.1, 11.2_

  - [ ]* 1.4 Write property test for `computeLivePnL` (Property 4)
    - `// Feature: ai-recommendation-performance-tab, Property 4: Live P&L is computed from currentMarketPrice, not API placeholder`
    - Generate LONG_YES/LONG_NO recs with valid entry zones and random currentPrice in (0,1); assert result !== 0 (the API placeholder) and matches the formula
    - **Property 4: Live P&L is computed from currentMarketPrice, not API placeholder**
    - **Validates: Requirements 11.7, 3.2**

  - [ ]* 1.5 Write property test for `computeRecommendationStatus` (Property 5)
    - `// Feature: ai-recommendation-performance-tab, Property 5: Recommendation status computation is correct for all price zones`
    - Generate LONG_YES recs with valid zones and random price; assert each status matches the correct zone condition; repeat for LONG_NO with inverted logic
    - **Property 5: Recommendation status computation is correct for all price zones**
    - **Validates: Requirements 9.1, 3.3–3.7**

  - [ ]* 1.6 Write property test for format helpers (Property 8)
    - `// Feature: ai-recommendation-performance-tab, Property 8: Non-finite numeric fields display "N/A"`
    - Generate null/undefined/NaN/Infinity/-Infinity; assert all three formatters return "N/A"
    - **Property 8: Non-finite numeric fields display "N/A"**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 5.5**

  - [ ]* 1.7 Write property test for ROI formatting (Property 9)
    - `// Feature: ai-recommendation-performance-tab, Property 9: ROI formatting is consistent with API rounding`
    - Generate float in [-100, 200]; assert `formatROI` output matches `/^[+-]\d+\.\d{2}%$/`
    - **Property 9: ROI formatting is consistent with API rounding**
    - **Validates: Requirements 11.1**

  - [ ]* 1.8 Write property test for probability formatting (Property 10)
    - `// Feature: ai-recommendation-performance-tab, Property 10: Probability formatting is consistent`
    - Generate float in [0, 1]; assert `formatProbability` output matches `/^\d+\.\d%$/`
    - **Property 10: Probability formatting is consistent**
    - **Validates: Requirements 11.2**

- [x] 2. Update `useMarketPerformance` hook
  - Add `isResolved?: boolean` to `UseMarketPerformanceOptions` interface
  - When `isResolved: true` → `staleTime: 10 * 60 * 1000`, `refetchInterval: false`, `refetchOnWindowFocus: false`
  - When `isResolved: false` (default) → `staleTime: 60 * 1000`, `refetchInterval: 60 * 1000`, `refetchOnWindowFocus: true`
  - Keep `retry: 2` and exponential `retryDelay` unchanged
  - _Requirements: 2.8, 2.9, 8.3, 8.6_

  - [ ]* 2.1 Write unit tests for hook cache options
    - `isResolved: true` → staleTime 10min, no refetchInterval, refetchOnWindowFocus false
    - `isResolved: false` → staleTime 60s, refetchInterval 60s, refetchOnWindowFocus true
    - `marketId: null` → query disabled (no fetch)
    - _Requirements: 2.8, 2.9, 8.3_

- [x] 3. Create `RecommendationStatusBadge` component
  - Create `components/Trading/Markets/RecommendationStatusBadge.tsx`
  - Props: `status: RecommendationStatus` (imported from `utils/performanceHelpers`)
  - Renders a `<span>` with label and color classes from `STATUS_BADGE_MAP`; always includes a text label (not color-only)
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 10.3_

- [x] 4. Create `ConfidenceBreakdownTable` component
  - Create `components/Trading/Markets/ConfidenceBreakdownTable.tsx`
  - Props: `byConfidence: AccuracyMetrics["byConfidence"]` (imported from `useMarketPerformance`)
  - Renders rows only for confidence levels where `total > 0`; omits zero-count rows entirely
  - Reuses the existing card styling (`bg-white/5 border border-white/10 rounded-lg`)
  - _Requirements: 4.6, 4.7_

  - [ ]* 4.1 Write unit tests for `ConfidenceBreakdownTable`
    - Zero-count confidence level → row not rendered
    - All three levels present → all three rows rendered
    - _Requirements: 4.6, 4.7_

  - [ ]* 4.2 Write property test for confidence breakdown (Property 11)
    - `// Feature: ai-recommendation-performance-tab, Property 11: Confidence breakdown omits zero-count levels`
    - Generate array of recs with random confidence/direction; compute which levels have tradeable recs; assert rendered rows match exactly
    - **Property 11: Confidence breakdown omits zero-count levels**
    - **Validates: Requirements 4.6, 4.7**

- [x] 5. Create `AgentSignalsSection` component
  - Create `components/Trading/Markets/AgentSignalsSection.tsx`
  - Props: `agentSignals: AgentSignal[]` (imported from `useMarketPerformance`)
  - Renders a `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3` of signal cards; LONG_YES in green, LONG_NO in red; omits section entirely when `agentSignals.length === 0`
  - Uses `formatProbability` from `utils/performanceHelpers` for the probability display
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. Create `LiveTrackingSection` component
  - Create `components/Trading/Markets/LiveTrackingSection.tsx`
  - Props: `recommendations: RecommendationWithOutcome[]`, `currentMarketPrice: number`
  - For each recommendation: compute status via `computeRecommendationStatus`, render `<RecommendationStatusBadge>`, compute live P&L via `computeLivePnL` (NOT `rec.roiRealized`), display entry zone / target zone / stop-loss using `formatPrice`
  - NO_TRADE recs rendered with neutral style and excluded from P&L display
  - Show "Pending" badge (gray) instead of final accuracy verdict
  - Show data quality warning banner when `entryZoneMin === 0 && entryZoneMax === 0`
  - _Requirements: 3.1, 3.2, 3.3, 3.8, 3.9, 3.10, 5.5, 11.7_

  - [ ]* 6.1 Write unit tests for `LiveTrackingSection`
    - Active market rec → live P&L shown (not 0 placeholder)
    - NO_TRADE rec → neutral style, excluded from P&L
    - Zero entry zone → "N/A" for price fields + data quality warning
    - _Requirements: 3.2, 3.10, 5.5, 11.7_

- [x] 7. Create `ResolvedMarketSection` component
  - Create `components/Trading/Markets/ResolvedMarketSection.tsx`
  - Props: `recommendations: RecommendationWithOutcome[]`, `metrics: PerformanceMetrics`, `winningOutcome?: string`, `endDate?: string`, `priceHistory: Array<{timestamp: string; price: number}>`
  - Renders: (a) Market Resolution summary card (outcome, resolution date, total recs count), (b) `<ROIMetrics>` from `components/Performance/ROIMetrics`, (c) `<ConfidenceBreakdownTable>`, (d) recommendation list with `wasCorrect`, `roiRealized` (from API - not recomputed), `gradedByPriceHistory` "Intraday" badge, close date logic per Req 11.5
  - When `priceHistory.length > 0`: lazy-load `PriceChartWithMarkers` via `React.lazy` + `Suspense`
  - When `priceHistory.length === 0`: show "Price chart unavailable" notice
  - When all recs are NO_TRADE: show "No tradeable recommendations" in place of metrics
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 5.8, 8.1, 8.2, 11.4, 11.5, 11.6_

  - [ ]* 7.1 Write unit tests for `ResolvedMarketSection`
    - `priceHistory: []` → "Price chart unavailable" notice shown, no chart rendered
    - `gradedByPriceHistory: true` → "Intraday" badge shown
    - All NO_TRADE → "No tradeable recommendations" shown
    - `exitTimestamp` present → shown as close date; absent → "Resolved at market close"
    - _Requirements: 4.3, 4.8, 4.9, 5.8, 11.5_

- [x] 8. Checkpoint - verify sub-components compile and render in isolation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Rewrite `PerformanceTab` component
  - Fully rewrite `components/Trading/Markets/PerformanceTab.tsx` with the new props interface:
    ```ts
    interface PerformanceTabProps {
      conditionId: string | null;
      isResolved: boolean;
      winningOutcome?: string;
      endDate?: string;
      currentMarketPrice: number;
    }
    ```
  - Call `useMarketPerformance(conditionId, { isResolved })` - passes `isResolved` to hook
  - Wrap entire return in `<ErrorBoundary resetKeys={[conditionId ?? ""]}>`
  - `conditionId === null` → render `<EmptyState>` immediately, no hook call
  - `isLoading` → render `<LoadingState>`
  - `error` → render `<ErrorState onRetry={refetch}>`
  - Empty recommendations → render `<EmptyState title="No AI Analysis Available">`
  - `isResolved === false` → render `<LiveTrackingSection>` + `<AgentSignalsSection>`
  - `isResolved === true` → render `<ResolvedMarketSection>` + `<AgentSignalsSection>`
  - Memoize confidence breakdown aggregation and ROI totals with `useMemo`
  - _Requirements: 1.3, 2.1, 2.2, 5.1, 5.2, 5.3, 5.4, 8.4, 8.5_

  - [ ]* 9.1 Write unit tests for `PerformanceTab`
    - `conditionId: null` → empty state rendered, no fetch triggered
    - Loading state → skeleton rendered
    - Error state → `<ErrorState>` with retry button
    - Empty recommendations → `<EmptyState>` with "No AI Analysis Available"
    - `isResolved: false` → `LiveTrackingSection` rendered, `ResolvedMarketSection` absent
    - `isResolved: true` → `ResolvedMarketSection` rendered, `LiveTrackingSection` absent
    - `priceHistory: []` on resolved → "Price chart unavailable" notice shown
    - _Requirements: 2.2, 5.1, 5.2, 5.3, 5.4, 8.4_

  - [ ]* 9.2 Write property test for recommendation card count (Property 7)
    - `// Feature: ai-recommendation-performance-tab, Property 7: Recommendation card count matches API array length`
    - Generate array of 0–20 recs; render `PerformanceTab` with mocked data; assert `data-testid="recommendation-card"` count equals array length
    - **Property 7: Recommendation card count matches API array length**
    - **Validates: Requirements 12.1**

  - [ ]* 9.3 Write property test for NO_TRADE exclusion (Property 6)
    - `// Feature: ai-recommendation-performance-tab, Property 6: NO_TRADE recommendations are excluded from all aggregate calculations`
    - Generate mixed recs including NO_TRADE; assert metrics totals equal tradeable-only subset counts
    - **Property 6: NO_TRADE recommendations are excluded from all aggregate calculations**
    - **Validates: Requirements 3.10, 5.8, 11.6**

- [x] 10. Integrate Performance tab into `MarketDetails`
  - In `components/Trading/Markets/MarketDetails.tsx`:
    - Extend `TabType` to `'overview' | 'ai-insights' | 'debate' | 'data-flow' | 'chart' | 'time-travel' | 'performance'`
    - Add `{ id: 'performance', label: 'Performance', icon: BarChart3 }` to the `tabs` array (always shown, not conditional)
    - Add import for `PerformanceTab`
    - Add render block: `{activeTab === 'performance' && (<PerformanceTab conditionId={market.conditionId || null} isResolved={market.closed} winningOutcome={market.winningOutcome} endDate={market.endDate} currentMarketPrice={yesPrice} />)}`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.8_

- [x] 11. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Test files follow the design's specified locations: `utils/__tests__/performanceHelpers.test.ts`, `hooks/__tests__/useMarketPerformance.test.ts`, `components/Trading/Markets/__tests__/PerformanceTab.test.tsx`, etc.
- Property tests require `vitest`, `@testing-library/react`, `jsdom`, and `fast-check` dev dependencies (not yet installed per design doc)
- The API route (`app/api/tradewizard/performance/[marketId]/route.ts`) requires no changes - it already handles both active and resolved markets correctly
- `AccuracyMetrics` from `components/Performance/AccuracyMetrics.tsx` is NOT reused in `ResolvedMarketSection` because it depends on `lib/performance-calculations` and `lib/data-validation` with a different `RecommendationWithOutcome` type; use `ConfidenceBreakdownTable` + `ROIMetrics` instead
