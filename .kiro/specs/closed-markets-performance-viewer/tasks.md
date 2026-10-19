# Implementation Plan: Closed Markets Performance Viewer

## Overview

This implementation plan transforms the existing aggregate performance dashboard into a comprehensive closed markets browser with detailed per-market performance analysis. The feature enables users to verify AI recommendation accuracy through interactive visualizations, profit/loss simulations, and risk-adjusted performance metrics.

The implementation follows a phased approach: database and API setup, core component implementation, performance calculations, chart visualizations, testing, integration, mobile optimization, and error handling.

## Tasks

- [x] 1. Database and API Infrastructure Setup
  - [x] 1.1 Create market price history table (if not using Polymarket API)
    - Create migration file for `market_price_history` table with proper indexes
    - Add constraints for price range (0-1) and unique market_id/timestamp pairs
    - Create indexes on market_id and timestamp for efficient queries
    - _Requirements: 6.1, 11.2_

  - [x] 1.2 Enhance existing performance API endpoint
    - Add pagination parameters (limit, offset) to `/api/tradewizard/performance`
    - Add includeSlug parameter for navigation support
    - Implement pagination metadata in response (total, hasMore)
    - Maintain backward compatibility with existing aggregate view
    - _Requirements: 1.1, 1.6, 11.1_

  - [x] 1.3 Create market performance detail API endpoint
    - Create `/api/tradewizard/performance/[marketId]/route.ts`
    - Fetch recommendations from v_closed_markets_performance view filtered by market_id
    - Calculate performance metrics using helper functions
    - Return market details, recommendations, and calculated metrics
    - _Requirements: 3.1, 11.3_

  - [x] 1.4 Create price history API endpoint
    - Create `/api/polymarket/price-history/[conditionId]/route.ts`
    - Fetch historical price data from Polymarket API or database
    - Support startDate, endDate, and interval query parameters
    - Return price points with metadata (first, last, high, low prices)
    - _Requirements: 6.1, 11.2_

- [x] 2. Core Data Fetching Hooks
  - [x] 2.1 Create useMarketPerformance hook
    - Implement TanStack Query hook for fetching single market performance
    - Set staleTime to 10 minutes (closed markets don't change)
    - Handle loading, error, and success states
    - _Requirements: 3.1, 11.4_

  - [x] 2.2 Create usePriceHistory hook
    - Implement TanStack Query hook for fetching price history
    - Support optional query parameters (startDate, endDate, interval)
    - Set staleTime to 30 minutes for caching
    - _Requirements: 6.1, 11.4_

  - [x] 2.3 Enhance usePerformanceData hook for pagination
    - Convert to useInfiniteQuery for pagination support
    - Implement getNextPageParam for infinite scroll
    - Add pagination state management
    - _Requirements: 1.6, 11.4_

- [x] 3. Performance Calculation Utilities
  - [x] 3.1 Implement investment simulation calculator
    - Create calculateSimulatedPortfolio function
    - Calculate shares purchased based on entry price and investment amount
    - Calculate gross P/L using entry and exit prices
    - Apply 2% Polymarket fees only on winning positions
    - Handle recommendations without exit prices (use resolution price)
    - Generate cumulative P/L time series
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.7_

  - [x]* 3.2 Write property test for investment simulation
    - **Property 8: Investment simulation calculation correctness**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.7**
    - Generate random recommendations and investment amounts
    - Verify fees applied only to winning positions (2% of gross profit)
    - Verify net P/L equals gross P/L minus fees
    - Verify total P/L equals sum of individual trades
    - Run 100 iterations minimum

  - [x] 3.3 Implement accuracy metrics calculator
    - Create calculateAccuracyMetrics function
    - Calculate total, correct, and accuracy percentage
    - Calculate accuracy by confidence level (high, moderate, low)
    - Calculate average confidence and confidence-accuracy correlation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 3.4 Write property test for accuracy calculation
    - **Property 10: Accuracy calculation correctness**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - Generate random recommendations with wasCorrect boolean
    - Verify accuracy equals (correct / total) * 100
    - Verify correct count matches filter of wasCorrect=true
    - Run 100 iterations minimum

  - [x] 3.5 Implement risk metrics calculator
    - Create calculateRiskMetrics function
    - Calculate Sharpe ratio (assuming risk-free rate of 0)
    - Calculate maximum drawdown percentage
    - Calculate return volatility (standard deviation)
    - Handle edge cases (zero volatility, insufficient data)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x]* 3.6 Write property test for risk metrics
    - **Property 18: Risk metrics calculation correctness**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - Generate random return series
    - Verify Sharpe ratio formula: avgReturn / stdDev
    - Verify max drawdown is largest peak-to-trough decline
    - Verify volatility equals standard deviation of returns
    - Run 100 iterations minimum

  - [x] 3.7 Implement calibration analysis calculator
    - Create calculateCalibrationMetrics function
    - Calculate calibration error (mean absolute difference)
    - Calculate average confidence for correct vs incorrect predictions
    - Calculate confidence-accuracy correlation
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 3.8 Implement baseline comparison calculator
    - Create calculateBaselineComparison function
    - Calculate buy-and-hold ROI (enter at first rec, exit at resolution)
    - Calculate random strategy ROI (Monte Carlo simulation, 1000 iterations)
    - Calculate statistical significance using t-test
    - Compare AI performance to baselines
    - _Requirements: 12.1, 12.2, 12.5_

  - [x]* 3.9 Write property test for baseline comparison
    - **Property 25: Baseline strategy calculation correctness**
    - **Validates: Requirements 12.1, 12.2**
    - Generate random price series and recommendation timing
    - Verify buy-and-hold ROI formula: (finalPrice - firstRecPrice) / firstRecPrice
    - Verify random strategy is average of Monte Carlo iterations
    - Run 100 iterations minimum

- [x] 4. Checkpoint - Ensure calculation utilities are tested
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Core UI Components - Closed Markets Grid
  - [x] 5.1 Create ClosedMarketsGrid component
    - Create component at `components/Performance/ClosedMarketsGrid.tsx`
    - Render market cards in responsive grid layout (1 col mobile, 2 col tablet, 3 col desktop)
    - Display market title, resolution outcome, and "no recommendations" indicator
    - Handle click navigation to market detail view
    - Show loading skeleton during data fetch
    - _Requirements: 1.2, 1.4, 1.5, 2.1_

  - [x] 5.2 Implement pagination controls
    - Add "Load More" button or infinite scroll
    - Display current page and total count
    - Prefetch next page on scroll proximity
    - Handle loading state during pagination
    - _Requirements: 1.6_

  - [x]* 5.3 Write property test for pagination activation
    - **Property 3: Pagination activation for >20 markets**
    - **Validates: Requirements 1.6**
    - Generate random market counts (0-100)
    - Verify pagination controls visible when count > 20
    - Verify pagination controls hidden when count <= 20
    - Run 100 iterations minimum

  - [x]* 5.4 Write unit tests for ClosedMarketsGrid
    - Test rendering with empty markets array
    - Test rendering with markets containing no recommendations
    - Test click navigation to market detail
    - Test loading state display

- [x] 6. Core UI Components - Performance Tab Container
  - [x] 6.1 Create PerformanceTab component
    - Create component at `components/Trading/Markets/PerformanceTab.tsx`
    - Fetch market performance data using useMarketPerformance hook
    - Coordinate child components (simulator, charts, metrics)
    - Handle loading and error states
    - Display empty state if no recommendations
    - _Requirements: 3.1, 3.2, 15.4_

  - [x] 6.2 Create TabNavigation component
    - Create reusable tab navigation component
    - Support Overview and Performance tabs
    - Handle active tab state
    - Apply consistent styling with existing UI patterns
    - _Requirements: 3.3_

  - [x]* 6.3 Write property test for tab visibility
    - **Property 6: Performance tab conditional rendering**
    - **Validates: Requirements 3.1, 3.2**
    - Generate markets with varying recommendation counts (0-10)
    - Verify Performance tab visible only when recommendations > 0
    - Verify Performance tab hidden when recommendations = 0
    - Run 100 iterations minimum

  - [x]* 6.4 Write unit tests for PerformanceTab
    - Test loading state display
    - Test error state with retry button
    - Test empty state when no recommendations
    - Test successful data rendering

- [x] 7. Investment Simulator Component
  - [x] 7.1 Create InvestmentSimulator component
    - Create component at `components/Performance/InvestmentSimulator.tsx`
    - Add investment amount input with default $100
    - Use useSimulatedPortfolio hook for calculations
    - Display total P/L, total ROI, win rate
    - Display cumulative P/L chart using Recharts
    - Show per-recommendation results in expandable list
    - _Requirements: 4.1, 4.2, 4.6, 4.8_

  - [x] 7.2 Create useSimulatedPortfolio hook
    - Implement useMemo hook wrapping calculateSimulatedPortfolio
    - Recalculate only when recommendations or investment amount changes
    - Return trades, cumulative series, and summary metrics
    - _Requirements: 4.2, 11.4_

  - [x]* 7.3 Write property test for cumulative P/L chart
    - **Property 9: Cumulative P/L chart rendering correctness**
    - **Validates: Requirements 4.6**
    - Generate random simulated trades with timestamps
    - Verify chart data points in chronological order
    - Verify cumulative values increase/decrease correctly
    - Run 100 iterations minimum

  - [x]* 7.4 Write unit tests for InvestmentSimulator
    - Test default investment amount of $100
    - Test investment amount change updates calculations
    - Test handling of zero recommendations
    - Test cumulative chart rendering

- [x] 8. Accuracy and ROI Metrics Components
  - [x] 8.1 Create AccuracyMetrics component
    - Create component at `components/Performance/AccuracyMetrics.tsx`
    - Display total recommendations, correct count, accuracy percentage
    - Display accuracy breakdown by confidence level
    - Display average confidence and correlation metrics
    - Use card layout with icons and color coding
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 8.2 Write unit tests for AccuracyMetrics
    - Test accuracy calculation display
    - Test confidence level breakdown
    - Test handling of zero recommendations
    - Test correlation display

  - [x] 8.3 Create ROI metrics display section
    - Add ROI metrics to PerformanceTab or AccuracyMetrics
    - Display total ROI, average ROI, best ROI, worst ROI
    - Use color coding (green for positive, red for negative)
    - Add tooltips for metric explanations
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 8.4 Write property test for ROI metrics
    - **Property 15: ROI metrics calculation correctness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
    - Generate random recommendations with ROI values
    - Verify total ROI is sum of individual ROIs
    - Verify average ROI is mean of individual ROIs
    - Verify best ROI is maximum value
    - Verify worst ROI is minimum value
    - Run 100 iterations minimum

- [x] 9. Price Chart with Markers Component
  - [x] 9.1 Create PriceChartWithMarkers component
    - Create component at `components/Performance/PriceChartWithMarkers.tsx`
    - Render price line chart using Recharts LineChart
    - Overlay entry markers at recommendation timestamps
    - Overlay exit markers when available
    - Use green markers for profitable, red for unprofitable
    - Implement marker hover tooltips with recommendation details
    - Support highlighted period from timeline clicks
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [x] 9.2 Implement chart data downsampling
    - Create downsamplePriceData utility function
    - Limit chart to 200 data points for performance
    - Use memoization to avoid recalculation
    - _Requirements: 11.4_

  - [x]* 9.3 Write property test for marker placement
    - **Property 12: Price chart marker placement correctness**
    - **Validates: Requirements 6.2, 6.3**
    - Generate random recommendations with timestamps
    - Verify entry markers appear at recommendation creation times
    - Verify exit markers appear at exit signal times when available
    - Run 100 iterations minimum

  - [x]* 9.4 Write unit tests for PriceChartWithMarkers
    - Test chart rendering with price data
    - Test marker rendering for recommendations
    - Test tooltip display on marker hover
    - Test profitability color coding
    - Test handling of incomplete price data

- [x] 10. Recommendation Timeline Component
  - [x] 10.1 Create RecommendationTimeline component
    - Create component at `components/Performance/RecommendationTimeline.tsx`
    - Display recommendations in chronological order
    - Show timestamp, type (LONG_YES/LONG_NO), confidence
    - Show market price at recommendation time
    - Show individual ROI for each recommendation
    - Highlight selected recommendation
    - Trigger chart highlighting on click
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 10.2 Implement virtual scrolling for long lists
    - Use @tanstack/react-virtual for performance
    - Set estimated row height and overscan
    - Handle dynamic list updates
    - _Requirements: 11.4_

  - [x]* 10.3 Write property test for timeline ordering
    - **Property 16: Recommendation timeline chronological ordering**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
    - Generate random recommendations with timestamps
    - Verify timeline displays all recommendations
    - Verify chronological order (ascending by timestamp)
    - Verify all required fields visible (timestamp, type, confidence, price, ROI)
    - Run 100 iterations minimum

  - [x]* 10.4 Write unit tests for RecommendationTimeline
    - Test rendering with multiple recommendations
    - Test chronological ordering
    - Test click highlighting interaction
    - Test selected recommendation styling

- [x] 11. Checkpoint - Ensure core components are functional
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Risk Metrics Component
  - [x] 12.1 Create RiskMetrics component
    - Create component at `components/Performance/RiskMetrics.tsx`
    - Display Sharpe ratio, max drawdown, volatility
    - Add explanatory tooltips for each metric
    - Use card layout consistent with other metrics
    - Handle null values (display "N/A")
    - _Requirements: 9.1, 9.2, 9.3_

  - [x]* 12.2 Write unit tests for RiskMetrics
    - Test metric display with valid data
    - Test "N/A" display for null values
    - Test tooltip rendering
    - Test handling of zero volatility

- [x] 13. Calibration Analysis Component
  - [x] 13.1 Create CalibrationAnalysis component
    - Create component at `components/Performance/CalibrationAnalysis.tsx`
    - Render scatter plot using Recharts ScatterChart
    - Plot confidence levels vs outcomes
    - Calculate and display calibration error
    - Highlight strong calibration (high confidence + correct)
    - Highlight poor calibration (high confidence + incorrect)
    - Display average confidence for accurate vs inaccurate predictions
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x]* 13.2 Write property test for calibration analysis
    - **Property 19: Calibration analysis calculation correctness**
    - **Validates: Requirements 10.1, 10.2**
    - Generate random recommendations with confidence and outcomes
    - Verify calibration error is mean absolute difference
    - Verify scatter plot data points match recommendations
    - Run 100 iterations minimum

  - [x]* 13.3 Write unit tests for CalibrationAnalysis
    - Test scatter plot rendering
    - Test calibration error calculation
    - Test highlighting of strong/poor calibration
    - Test average confidence segmentation

- [x] 14. Baseline Comparison Component
  - [x] 14.1 Create BaselineComparison component
    - Create component at `components/Performance/BaselineComparison.tsx`
    - Display AI performance, buy-and-hold, and random strategy ROIs
    - Show side-by-side comparison with visual bars
    - Highlight when AI outperforms baselines
    - Display statistical significance (p-value)
    - Add explanatory text for each baseline
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x]* 14.2 Write unit tests for BaselineComparison
    - Test baseline calculation display
    - Test AI outperformance highlighting
    - Test statistical significance display
    - Test handling of insufficient data

- [x] 15. Export Functionality
  - [x] 15.1 Create ExportButton component
    - Create component at `components/Performance/ExportButton.tsx`
    - Generate CSV with all performance metrics
    - Include timestamps, recommendations, prices, calculated metrics
    - Trigger browser download on click
    - Name file: `{market-title}-performance-{timestamp}.csv`
    - Show loading state during export
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 15.2 Implement CSV generation utility
    - Create generatePerformanceCSV function
    - Use dynamic import for papaparse library
    - Format data for CSV export
    - Handle special characters in market titles
    - _Requirements: 13.2, 13.3_

  - [x]* 15.3 Write property test for CSV export completeness
    - **Property 28: CSV export completeness**
    - **Validates: Requirements 13.2, 13.3, 13.5**
    - Generate random performance data
    - Verify CSV includes all required fields
    - Verify filename format matches specification
    - Run 100 iterations minimum

  - [x]* 15.4 Write unit tests for ExportButton
    - Test export button click triggers download
    - Test loading state during export
    - Test error handling for failed export
    - Test CSV content structure

- [x] 16. Integration with Existing Pages
  - [x] 16.1 Enhance performance page with ClosedMarketsGrid
    - Update `app/performance/page.tsx`
    - Replace existing ClosedMarketsList with ClosedMarketsGrid
    - Add pagination support using useInfiniteQuery
    - Implement click navigation to market detail
    - Maintain existing aggregate metrics display
    - _Requirements: 1.1, 1.2, 1.6, 2.1_

  - [x] 16.2 Enhance market detail view with Performance tab
    - Update `app/market/[slug]/page.tsx` and `components/Trading/Markets/MarketDetails.tsx`
    - Add TabNavigation component
    - Conditionally render Performance tab for closed markets with recommendations
    - Disable trading actions when market is closed
    - Display resolution outcome prominently
    - Pass market data to PerformanceTab
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x]* 16.3 Write integration test for performance page flow
    - Test closed markets display and navigation
    - Test pagination functionality
    - Test filter application
    - Test navigation to market detail

  - [x]* 16.4 Write integration test for market detail performance tab
    - Test tab navigation without page reload
    - Test Performance tab visibility based on recommendations
    - Test trading disabled for closed markets
    - Test all performance components render correctly

- [x] 17. Mobile Optimization
  - [x] 17.1 Implement responsive layouts
    - Add mobile breakpoints to all components
    - Stack charts vertically on mobile (< 768px)
    - Use single column grid for market cards on mobile
    - Ensure touch-friendly button sizes (min 44px)
    - _Requirements: 14.1, 14.2, 14.5_

  - [x] 17.2 Optimize chart rendering for mobile
    - Reduce data points for mobile (100 instead of 200)
    - Implement touch gestures for chart interaction
    - Use smaller font sizes for mobile labels
    - Test chart performance on mobile devices
    - _Requirements: 14.3, 11.4_

  - [x] 17.3 Ensure text readability on mobile
    - Set minimum font sizes (14px body, 12px labels)
    - Test contrast ratios for accessibility
    - Ensure number formatting fits mobile screens
    - _Requirements: 14.4_

  - [x]* 17.4 Write property test for mobile layout activation
    - **Property 30: Mobile layout activation**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.5**
    - Test viewport widths from 320px to 1920px
    - Verify mobile layout activates at < 768px
    - Verify desktop layout activates at >= 768px
    - Run 100 iterations minimum

  - [x]* 17.5 Write unit tests for mobile responsiveness
    - Test component rendering at mobile viewport
    - Test touch-friendly button sizes
    - Test vertical stacking of charts
    - Test text readability at mobile sizes

- [x] 18. Error Handling and Edge Cases
  - [x] 18.1 Implement data fetching error handling
    - Add error boundaries to all major components
    - Display clear error messages with retry buttons
    - Log errors for debugging
    - Fallback to cached data when available
    - _Requirements: 15.3_

  - [x] 18.2 Handle incomplete data scenarios
    - Display warning banners for missing price history
    - Show "N/A" for calculations with insufficient data
    - Exclude incomplete recommendations from calculations
    - Provide explanatory messages for missing data
    - _Requirements: 15.1, 15.2_

  - [x] 18.3 Implement calculation error handling
    - Handle division by zero (return null, display "N/A")
    - Validate input data before calculations
    - Log warnings for invalid data
    - Don't crash application on calculation errors
    - _Requirements: 15.5_

  - [x] 18.4 Add empty state handling
    - Display empty state message when no closed markets
    - Display empty state when no recommendations
    - Provide helpful guidance in empty states
    - _Requirements: 15.4_

  - [x]* 18.5 Write property test for error handling
    - **Property 32: Error handling for incomplete data**
    - **Validates: Requirements 15.1, 15.2**
    - Generate recommendations with missing fields
    - Verify warning messages displayed
    - Verify incomplete data excluded from calculations
    - Run 100 iterations minimum

  - [x]* 18.6 Write property test for division by zero
    - **Property 35: Division by zero handling**
    - **Validates: Requirements 15.5**
    - Generate edge cases with zero values
    - Verify "N/A" displayed instead of error
    - Verify application doesn't crash
    - Run 100 iterations minimum

  - [x]* 18.7 Write unit tests for error scenarios
    - Test API fetch failure handling
    - Test incomplete price history handling
    - Test missing recommendations handling
    - Test calculation errors handling

- [x] 19. Performance Optimization
  - [x] 19.1 Implement memoization for expensive calculations
    - Use useMemo for all metric calculations
    - Use useCallback for event handlers
    - Memoize chart data transformations
    - _Requirements: 11.4_

  - [x] 19.2 Implement code splitting
    - Lazy load PriceChartWithMarkers component
    - Lazy load CalibrationAnalysis component
    - Use React.lazy() and Suspense
    - Add loading fallbacks
    - _Requirements: 11.4_

  - [x] 19.3 Configure TanStack Query caching
    - Set staleTime for closed market data (10-30 minutes)
    - Set gcTime for garbage collection (30 minutes)
    - Disable refetchOnWindowFocus for closed markets
    - Implement prefetching for next page and hovered markets
    - _Requirements: 11.4_

  - [x]* 19.4 Write unit tests for caching behavior
    - Test cache hit for repeated queries
    - Test staleTime configuration
    - Test prefetching behavior

- [x] 20. Final Checkpoint - Comprehensive Testing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Documentation and Polish
  - [x] 21.1 Add component documentation
    - Document props and usage for all new components
    - Add JSDoc comments to utility functions
    - Document API endpoints and response formats
    - _Requirements: All_

  - [x] 21.2 Add accessibility features
    - Ensure keyboard navigation works for all interactive elements
    - Add ARIA labels to charts and interactive components
    - Test with screen readers
    - Ensure color contrast meets WCAG standards
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 21.3 Final integration testing
    - Test complete user flow from performance page to market detail
    - Test all filters and pagination
    - Test export functionality end-to-end
    - Test mobile experience on real devices
    - _Requirements: All_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at reasonable breaks
- Property tests validate universal correctness properties across randomized inputs
- Unit tests validate specific examples, edge cases, and integration points
- All components follow existing TradeWizard UI patterns for consistency
- Mobile-first approach ensures responsive design from the start
- Error handling is built into each component for resilience
- Performance optimization is integrated throughout implementation
