# Requirements Document

## Introduction

The AI Recommendation Performance Tab is a new tab on the market details page (`/market/[slug]`) in the TradeWizard frontend. It surfaces how the multi-agent AI system's trade recommendations have performed against real Polymarket price movements - both for markets that are still active (live tracking) and markets that have already resolved (final graded results).

The tab must handle the full lifecycle of a recommendation: from the moment it is generated (entry zone, target zone, stop-loss), through intraday price movement, to final resolution. It must degrade gracefully when data is missing, and it must never block or break the rest of the market details page.

This feature was previously attempted and reverted. The requirements below are written to be exhaustive, covering every edge case and data-source concern that caused the previous implementation to fail.

---

## Glossary

- **Recommendation**: A trade signal stored in the `recommendations` Supabase table, containing `direction` (LONG_YES / LONG_NO / NO_TRADE), `entry_zone_min/max`, `target_zone_min/max`, `stop_loss`, `fair_probability`, `market_edge`, `confidence`, and `explanation`.
- **Active Market**: A market where `status != 'resolved'` and `closed = false` in Polymarket. Recommendations exist but no final outcome is known.
- **Resolved Market**: A market where `status = 'resolved'` and `resolved_outcome` is set (YES or NO). Final grading is possible.
- **Grading**: The process of determining whether a recommendation was correct and calculating ROI. Two methods exist: price-history grading (did target/stop get hit intraday?) and resolution grading (did the market resolve in the recommended direction?).
- **Price History**: Time-series YES-token price data fetched from the Polymarket CLOB API (`/prices-history?market={tokenId}&interval=max&fidelity=60`).
- **Entry Price**: The midpoint of `entry_zone_min` and `entry_zone_max` at the time the recommendation was generated.
- **ROI**: Return on investment calculated as `(exit_price - entry_price) / entry_price * 100`, expressed as a percentage.
- **Edge**: The difference between the AI's `fair_probability` and the market's implied probability at the time of recommendation.
- **Confidence Level**: Derived from `confidence` field: `high`, `moderate`, or `low`.
- **NO_TRADE**: A recommendation direction indicating the AI found no actionable edge. These are excluded from accuracy and ROI calculations.
- **Performance_Tab**: The new React component added as a tab in `MarketDetails.tsx`.
- **Performance_API**: The existing Next.js API route at `/api/tradewizard/performance/[marketId]`.
- **CLOB_API**: The Polymarket Central Limit Order Book API used for live prices and price history.
- **Supabase**: The PostgreSQL database storing markets, recommendations, agent_signals, and recommendation_outcomes.
- **TabType**: The union type in `MarketDetails.tsx` that controls which tab is active.

---

## Requirements

### Requirement 1: Performance Tab Visibility and Integration

**User Story:** As a trader, I want to see a "Performance" tab on every market details page, so that I can evaluate the AI's track record for that specific market before deciding to follow its recommendations.

#### Acceptance Criteria

1. THE Performance_Tab SHALL be rendered as a tab option in the `MarketDetails` component's `tabs` array alongside the existing Overview, AI Insights, Price Chart, Agent Debate, Data Flow, and Time Travel tabs.
2. WHEN a user navigates to any market details page, THE Performance_Tab SHALL be visible in the tab navigation regardless of whether the market is active or resolved.
3. WHEN a user clicks the Performance tab, THE Performance_Tab SHALL render within the existing `min-h-[300px] sm:min-h-[400px]` content area without layout shift.
4. THE Performance_Tab SHALL use the `performance` tab ID and a `BarChart3` or `TrendingUp` icon consistent with the existing tab icon style.
5. THE `TabType` union in `MarketDetails.tsx` SHALL be extended to include `'performance'` as a valid tab value.
6. WHEN the Performance tab is active, THE MarketDetails component SHALL pass `market.conditionId`, `market.closed`, `market.winningOutcome`, and `market.endDate` as props to the Performance_Tab component.

---

### Requirement 2: Data Fetching Architecture

**User Story:** As a developer, I want the Performance tab to fetch data through a clean, well-defined hook, so that data fetching logic is separated from rendering and can be tested independently.

#### Acceptance Criteria

1. THE Performance_Tab SHALL use the existing `useMarketPerformance(conditionId)` hook to fetch performance data from `/api/tradewizard/performance/[marketId]`.
2. WHEN `conditionId` is null or undefined, THE Performance_Tab SHALL render an empty state without making any API calls.
3. THE Performance_API SHALL accept both resolved and active markets - it SHALL NOT return a 404 for active markets that have recommendations.
4. WHEN the market is active (not resolved), THE Performance_API SHALL return recommendations with `actualOutcome: "Pending"`, `wasCorrect: null`, and `roiRealized: 0` for each recommendation.
5. WHEN the market is resolved, THE Performance_API SHALL grade each recommendation using price-history grading first, falling back to resolution-based grading if price history is unavailable or no threshold was hit.
6. THE Performance_API SHALL return a `priceHistory` array of `{ timestamp: string; price: number }` objects for resolved markets when price history is available from the CLOB API.
7. IF the CLOB API is unavailable or returns an error, THEN THE Performance_API SHALL continue and return recommendations graded by resolution only, without failing the entire request.
8. THE `useMarketPerformance` hook SHALL use a `staleTime` of 10 minutes for resolved markets and 60 seconds for active markets to avoid redundant API calls.
9. WHEN the market is active, THE `useMarketPerformance` hook SHALL set `refetchInterval` to 60 seconds so live performance data stays current.

---

### Requirement 3: Active Market - Live Performance Tracking

**User Story:** As a trader watching an active market, I want to see how the AI's current and past recommendations are tracking against the live price, so that I can assess whether the trade thesis is playing out.

#### Acceptance Criteria

1. WHEN the market is active, THE Performance_Tab SHALL display a "Live Tracking" section showing each recommendation's direction, entry zone, target zone, stop-loss, and the current market price.
2. WHEN the market is active, THE Performance_Tab SHALL display the current unrealized P&L for each recommendation as `(current_price - entry_midpoint) / entry_midpoint * 100` for LONG_YES, and `((1 - current_price) - (1 - entry_midpoint)) / (1 - entry_midpoint) * 100` for LONG_NO.
3. WHILE the market is active, THE Performance_Tab SHALL visually indicate whether the current price is within the entry zone, above the target zone, or below the stop-loss for each recommendation.
4. WHEN the current price has crossed the target zone for a LONG_YES recommendation, THE Performance_Tab SHALL display a "Target Reached" indicator in green.
5. WHEN the current price has crossed below the stop-loss for a LONG_YES recommendation, THE Performance_Tab SHALL display a "Stop Hit" indicator in red.
6. WHEN the current price has crossed the target zone for a LONG_NO recommendation (YES price ≤ target_zone_max), THE Performance_Tab SHALL display a "Target Reached" indicator in green.
7. WHEN the current price has crossed above the stop-loss for a LONG_NO recommendation (YES price ≥ stop_loss), THE Performance_Tab SHALL display a "Stop Hit" indicator in red.
8. THE Performance_Tab SHALL accept a `currentMarketPrice` prop (the live YES token price) passed from `MarketDetails` to enable live P&L calculation without an additional API call.
9. WHILE the market is active, THE Performance_Tab SHALL display a "Pending" badge instead of a final accuracy verdict, making clear that results are not yet final.
10. IF a recommendation has `direction = 'NO_TRADE'`, THEN THE Performance_Tab SHALL display it in the list with a neutral style and SHALL exclude it from P&L calculations.

---

### Requirement 4: Resolved Market - Final Performance Results

**User Story:** As a trader reviewing a closed market, I want to see the definitive performance record of the AI's recommendations, so that I can evaluate the AI's accuracy and calibration over time.

#### Acceptance Criteria

1. WHEN the market is resolved, THE Performance_Tab SHALL display a "Market Resolution" summary card showing the final outcome (YES/NO), resolution date, and total number of recommendations made.
2. WHEN the market is resolved, THE Performance_Tab SHALL display the graded result for each recommendation: whether it was correct, the ROI realized, and whether it was graded by price history or by resolution.
3. WHEN a recommendation was graded by price history, THE Performance_Tab SHALL display an "Intraday" badge to distinguish it from resolution-graded recommendations.
4. WHEN the market is resolved, THE Performance_Tab SHALL display aggregate accuracy metrics: total recommendations (excluding NO_TRADE), correct count, and accuracy percentage.
5. WHEN the market is resolved, THE Performance_Tab SHALL display ROI metrics: total ROI, average ROI, best ROI, and worst ROI across all tradeable recommendations.
6. WHEN the market is resolved, THE Performance_Tab SHALL display a confidence breakdown table showing accuracy and count for high, moderate, and low confidence recommendations separately.
7. IF a confidence level has zero recommendations, THEN THE Performance_Tab SHALL omit that confidence level row from the breakdown table.
8. WHEN the market is resolved and price history is available, THE Performance_Tab SHALL render a price chart overlaid with entry zone, target zone, stop-loss, and recommendation creation timestamps as markers.
9. WHEN the market is resolved and price history is unavailable, THE Performance_Tab SHALL display the recommendation list and metrics without the price chart, showing a "Price chart unavailable" notice instead.

---

### Requirement 5: Empty and Edge Case Handling

**User Story:** As a trader visiting a market with no AI analysis, I want to see a clear explanation rather than a broken or blank tab, so that I understand why no performance data is available.

#### Acceptance Criteria

1. WHEN no recommendations exist for the market, THE Performance_Tab SHALL display an empty state with the message "No AI Analysis Available" and an explanation that the AI system may not have had sufficient data or confidence to generate predictions.
2. WHEN the market is active and has no recommendations yet, THE Performance_Tab SHALL display the empty state with a secondary message indicating that analysis may be generated as the market develops.
3. IF the Performance_API returns an error, THEN THE Performance_Tab SHALL display an error state with a "Retry" button that re-triggers the `refetch` function from `useMarketPerformance`.
4. WHEN the Performance_Tab is loading data, THE Performance_Tab SHALL display a loading skeleton that matches the approximate layout of the loaded content.
5. IF a recommendation has `entry_zone_min = 0` and `entry_zone_max = 0` (missing price data), THEN THE Performance_Tab SHALL display "N/A" for all price-dependent fields for that recommendation and SHALL display a data quality warning banner.
6. WHEN the market resolved before any recommendation was generated (e.g., market closed within minutes of creation), THE Performance_Tab SHALL display the empty state rather than an error.
7. IF `conditionId` is present but the market does not exist in the Supabase `markets` table, THEN THE Performance_API SHALL return a 404 and THE Performance_Tab SHALL display the error state with a message indicating the market has not been analyzed.
8. WHEN all recommendations for a market have `direction = 'NO_TRADE'`, THE Performance_Tab SHALL display the recommendation list but SHALL show "No tradeable recommendations" in place of accuracy and ROI metrics.

---

### Requirement 6: Price Chart with Recommendation Markers

**User Story:** As a trader, I want to see a price chart that shows where the AI made its recommendations relative to actual price movement, so that I can visually assess the quality of the AI's timing and price targets.

#### Acceptance Criteria

1. WHEN price history data is available, THE Performance_Tab SHALL render a line chart of the YES token price over time using the existing `Recharts` library.
2. THE Performance_Tab SHALL overlay horizontal reference lines on the chart for each recommendation's entry zone midpoint (blue), target zone midpoint (green), and stop-loss (red).
3. THE Performance_Tab SHALL render a vertical marker on the chart at the timestamp of each recommendation's creation.
4. WHEN a recommendation was graded by price history, THE Performance_Tab SHALL render a second vertical marker at the exit timestamp.
5. THE chart SHALL use the same dark theme styling (bg-white/5, border-white/10) consistent with the rest of the market details page.
6. THE chart SHALL be responsive and SHALL not overflow its container on mobile viewports.
7. WHEN there are multiple recommendations, THE Performance_Tab SHALL use distinct colors or labels to differentiate markers for each recommendation.
8. THE chart x-axis SHALL display human-readable dates and THE y-axis SHALL display prices as percentages (0–100¢) consistent with the rest of the UI.

---

### Requirement 7: Agent Signal Breakdown

**User Story:** As a trader, I want to see which individual AI agents contributed to each recommendation and what their signals were, so that I can understand the reasoning behind the AI's performance.

#### Acceptance Criteria

1. WHEN agent signals are available for the market, THE Performance_Tab SHALL display a grid of agent signal cards showing each agent's name, direction, and probability estimate.
2. THE Performance_Tab SHALL style LONG_YES agent signals in green and LONG_NO signals in red, consistent with the existing `PerformanceTab.tsx` styling.
3. WHEN no agent signals are available, THE Performance_Tab SHALL omit the agent signals section entirely rather than showing an empty grid.
4. THE Performance_Tab SHALL display agent signals fetched from the `agentSignals` array returned by the Performance_API, which queries the `agent_signals` table joined to the market.
5. WHERE multiple recommendations exist for a market, THE Performance_Tab SHALL display agent signals associated with the most recent recommendation by default.

---

### Requirement 8: Caching and Performance

**User Story:** As a developer, I want the Performance tab to be efficient and not cause unnecessary re-renders or API calls, so that the market details page remains fast.

#### Acceptance Criteria

1. THE Performance_Tab SHALL be wrapped in a React `Suspense` boundary so that lazy-loaded chart components do not block the initial render of the tab.
2. THE Performance_Tab SHALL lazy-load the price chart component using `React.lazy` to avoid including Recharts in the initial bundle for users who never open the Performance tab.
3. THE `useMarketPerformance` hook SHALL set `refetchOnWindowFocus: false` for resolved markets, since resolved market data is immutable.
4. THE Performance_Tab SHALL be wrapped in an `ErrorBoundary` component (the existing `components/shared/ErrorBoundary.tsx`) so that a rendering error in the Performance tab does not crash the entire market details page.
5. THE Performance_Tab SHALL memoize expensive calculations (e.g., confidence breakdown aggregation, ROI totals) using `useMemo` to avoid recalculation on every render.
6. WHEN the user switches away from the Performance tab and back, THE Performance_Tab SHALL not re-fetch data if the cached data is still within the stale time window.

---

### Requirement 9: Active Market - Recommendation Status Indicators

**User Story:** As a trader on an active market, I want each recommendation to show a clear status badge indicating where the current price stands relative to the recommendation's zones, so that I can quickly assess the trade at a glance.

#### Acceptance Criteria

1. THE Performance_Tab SHALL compute a status for each active-market recommendation: `"in-entry-zone"`, `"above-target"`, `"below-stop"`, `"between-entry-and-target"`, or `"pending"` based on the current YES token price.
2. WHEN the status is `"in-entry-zone"`, THE Performance_Tab SHALL display a blue "In Entry Zone" badge.
3. WHEN the status is `"above-target"` for LONG_YES, THE Performance_Tab SHALL display a green "Target Reached" badge.
4. WHEN the status is `"below-stop"` for LONG_YES, THE Performance_Tab SHALL display a red "Stop Hit" badge.
5. WHEN the status is `"between-entry-and-target"`, THE Performance_Tab SHALL display a yellow "Tracking" badge.
6. WHEN the status is `"pending"` (price data unavailable), THE Performance_Tab SHALL display a gray "Pending" badge.
7. THE status computation SHALL be performed client-side using the `currentMarketPrice` prop and SHALL NOT require an additional API call.

---

### Requirement 10: Accessibility and Responsive Design

**User Story:** As a user on any device, I want the Performance tab to be readable and usable, so that I can access performance data on mobile and desktop alike.

#### Acceptance Criteria

1. THE Performance_Tab SHALL use responsive grid layouts (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`) for metric cards, consistent with the existing market details page layout.
2. THE Performance_Tab SHALL use `text-sm` for body text and `text-xs` for labels, consistent with the existing tab content styling.
3. ALL color-coded indicators (green for correct, red for incorrect) SHALL include a text label in addition to color so that the information is not conveyed by color alone.
4. THE price chart SHALL have a minimum height of 200px on mobile and 300px on desktop to remain readable.
5. THE Performance_Tab SHALL not introduce horizontal scrolling on viewports narrower than 375px.
6. ALL interactive elements (retry button, tab navigation) SHALL be keyboard-navigable and SHALL have visible focus indicators.

---

### Requirement 11: Data Consistency and Correctness

**User Story:** As a developer, I want the performance calculations to be deterministic and consistent with the grading logic in the Performance_API, so that the UI never shows contradictory data.

#### Acceptance Criteria

1. THE Performance_Tab SHALL display ROI values rounded to 2 decimal places, consistent with the `Math.round(roi * 100) / 100` rounding applied in the Performance_API.
2. THE Performance_Tab SHALL display probability values as percentages with 1 decimal place (e.g., `63.4%`), consistent with the existing `PerformanceTab.tsx` formatting.
3. THE Performance_Tab SHALL display prices in the `0.00` format (2 decimal places as a fraction of $1), consistent with the existing recommendation display in `PerformanceTab.tsx`.
4. FOR ALL resolved recommendations, THE Performance_Tab SHALL display the `wasCorrect` value returned by the API without re-computing it client-side, ensuring consistency with the server-side grading logic.
5. WHEN a recommendation has `gradedByPriceHistory: true`, THE Performance_Tab SHALL use `exitTimestamp` as the close date; WHEN `gradedByPriceHistory: false`, THE Performance_Tab SHALL display "Resolved at market close" as the close date.
6. THE Performance_Tab SHALL treat `direction = 'NO_TRADE'` recommendations as excluded from all accuracy and ROI aggregate calculations, consistent with the `calculateMarketMetrics` function in the Performance_API.
7. FOR ALL active market recommendations, THE Performance_Tab SHALL display `roiRealized` as the live unrealized P&L computed from `currentMarketPrice`, NOT the `roiRealized: 0` placeholder returned by the API for active markets.

---

### Requirement 12: Parser and Data Transformation Correctness

**User Story:** As a developer, I want the data transformation from the API response to the UI to be correct and round-trippable, so that no data is lost or corrupted between the API and the rendered output.

#### Acceptance Criteria

1. WHEN the Performance_API returns a `recommendations` array, THE Performance_Tab SHALL render exactly the same number of recommendation cards as items in the array.
2. THE Performance_Tab SHALL correctly parse `entryZoneMin` and `entryZoneMax` as numbers and SHALL display "N/A" if either is null or NaN.
3. THE Performance_Tab SHALL correctly parse `targetZoneMin`, `targetZoneMax`, and `stopLoss` as numbers and SHALL display "N/A" if any are null or NaN.
4. THE Performance_Tab SHALL correctly parse `fairProbability` and `marketEdge` as numbers and SHALL display "N/A" if either is null or NaN.
5. FOR ALL numeric fields, THE Performance_Tab SHALL apply `isFinite(value)` validation before rendering, displaying "N/A" for non-finite values (Infinity, -Infinity, NaN).
6. THE `useMarketPerformance` hook's response type SHALL match the `MarketPerformanceDetailResponse` interface exactly, and any new fields added to the API response SHALL be reflected in the TypeScript interface before use in the component.
