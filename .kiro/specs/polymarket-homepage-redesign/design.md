# Design Document

## Overview

This design document outlines the architecture and implementation approach for redesigning the TradeWizard homepage to match Polymarket's political markets layout. The redesign transforms the current generic market display into a politics-focused interface that mirrors Polymarket's clean, professional design patterns while maintaining TradeWizard's AI-powered intelligence features.

The design emphasizes a clean, minimal aesthetic with politics as the primary category, enhanced tag navigation without browser scrollbars, and support for both simple Yes/No markets and complex multi-option markets. The interface will seamlessly integrate with Polymarket's events.json API structure while providing fallback handling for data inconsistencies.

## Architecture

### Component Architecture

The redesigned homepage follows a modular component architecture built on Next.js 16.1.4 with React 19:

```
Homepage
├── PoliticsHero (new)
├── PoliticsTagBar (enhanced)
│   ├── PoliticsHeadline
│   ├── RelatedTagsScroller
│   └── CustomScrollControls
├── MarketGrid (enhanced)
│   ├── PoliticalMarketCard (enhanced)
│   │   ├── MarketImage
│   │   ├── MarketInfo
│   │   ├── SimpleOutcomes (Yes/No)
│   │   └── ComplexOutcomes (Multi-option)
│   └── EmptyState
└── LoadingState
```

### Data Flow Architecture

The data flow follows a server-side rendering approach with client-side interactivity:

```
Polymarket API → Server Component → Data Processing → Component Props → Client Components
```

1. **Server-Side Data Fetching**: Homepage server component fetches political markets using `getEvents()` with politics tag filter
2. **Data Processing**: Parse events.json structure, extract market outcomes and probabilities
3. **Component Rendering**: Pass processed data to client components for interactive features
4. **Client-Side Filtering**: Tag selection updates URL and triggers server-side re-fetch

### State Management

The design uses Next.js built-in state management patterns:

- **Server State**: Market data fetched server-side and passed as props
- **URL State**: Current tag filter stored in URL search parameters
- **Client State**: UI interactions (hover states, scroll positions) managed with React hooks
- **Error State**: Fallback handling for malformed data and failed API calls

## Components and Interfaces

### PoliticsTagBar Component

Enhanced version of the existing CategoriesBar with politics-focused design:

```typescript
interface PoliticsTagBarProps {
  currentTag: string;
  relatedTags: PoliticalTag[];
}

interface PoliticalTag {
  label: string;
  slug: string;
  count?: number;
  isActive: boolean;
}
```

**Key Features:**
- Prominent "Politics" headline with primary styling
- Horizontal scrollable related tags without browser scrollbars
- Custom scroll controls with smooth animations
- Visual hierarchy emphasizing politics as primary category

### Enhanced MarketCard Component

Extended to support both simple and complex market formats:

```typescript
interface EnhancedMarketCardProps {
  id: string;
  title: string;
  image: string;
  volume: string;
  isNew?: boolean;
  marketType: 'simple' | 'complex';
  outcomes: SimpleOutcome[] | ComplexOutcome[];
}

interface SimpleOutcome {
  name: 'Yes' | 'No';
  probability: number;
  color: 'yes' | 'no';
}

interface ComplexOutcome {
  category: string; // groupItemTitle
  options: SimpleOutcome[];
}
```

**Key Features:**
- Dynamic layout based on market type
- Professional hover states and transitions
- Fallback image handling with gradient backgrounds
- Volume display with compact notation
- New market badges

### Data Processing Layer

Server-side utilities for processing Polymarket API data:

```typescript
interface ProcessedEvent {
  id: string;
  title: string;
  image: string;
  volume: number;
  isNew: boolean;
  marketType: 'simple' | 'complex';
  outcomes: ProcessedOutcome[];
  tags: string[];
}

interface ProcessedOutcome {
  name: string;
  probability: number;
  category?: string;
}
```

**Processing Functions:**
- `parseMarketOutcomes()`: Extract and validate outcomes from JSON strings
- `determineMarketType()`: Classify markets as simple or complex based on structure
- `formatMarketData()`: Transform API response to component-friendly format
- `handleDataFallbacks()`: Provide defaults for malformed data

## Data Models

### Event Data Model

Based on Polymarket's events.json structure:

```typescript
interface PolymarketEvent {
  id: string;
  title: string;
  description: string;
  image: string;
  volume: number;
  new: boolean;
  active: boolean;
  closed: boolean;
  markets: PolymarketMarket[];
  tags: PolymarketTag[];
}

interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: string; // JSON string
  outcomePrices: string; // JSON string
  groupItemTitle?: string;
  volume: string;
  image: string;
}

interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
}
```

### UI State Models

Client-side state management interfaces:

```typescript
interface TagFilterState {
  currentTag: string;
  availableTags: PoliticalTag[];
  isLoading: boolean;
}

interface MarketDisplayState {
  markets: ProcessedEvent[];
  hasError: boolean;
  errorMessage?: string;
  isEmpty: boolean;
}
```

## Error Handling

### Graceful Degradation Strategy

The design implements comprehensive error handling to ensure reliable user experience:

1. **Image Loading Failures**
   - Fallback to gradient backgrounds with political theme colors
   - Maintain card layout consistency even without images

2. **Data Parsing Errors**
   - Default to Yes/No outcomes with 50% probabilities
   - Log errors for monitoring while displaying functional UI

3. **API Failures**
   - Show loading states during data fetching
   - Display appropriate error messages for different failure types
   - Provide retry mechanisms where applicable

4. **Malformed Market Data**
   - Validate JSON parsing for outcomes and prices
   - Skip invalid markets rather than breaking entire display
   - Maintain minimum viable market information

### Error Boundary Implementation

```typescript
interface ErrorBoundaryState {
  hasError: boolean;
  errorType: 'network' | 'parsing' | 'rendering';
  fallbackData?: ProcessedEvent[];
}
```

## Testing Strategy

### Dual Testing Approach

The testing strategy combines unit tests for specific functionality with property-based tests for comprehensive coverage:

**Unit Testing Focus:**
- Component rendering with various market types
- Data parsing edge cases and error conditions
- Tag filtering functionality
- Image fallback behavior
- URL state management

**Property-Based Testing Focus:**
- Market data processing across random input variations
- UI consistency with different market configurations
- Error handling robustness with malformed data
- Performance with varying data sizes

### Testing Configuration

- **Framework**: Vitest with React Testing Library
- **Property Testing**: fast-check for randomized input testing
- **Minimum Iterations**: 100 per property test
- **Test Tagging**: Each property test references design document properties
- **Coverage Target**: 90% for critical user paths

The testing approach ensures both specific edge cases are handled correctly and the system maintains reliability across the full spectrum of possible Polymarket API responses.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Politics Market Filtering
*For any* set of market events with mixed tags, when the homepage loads with politics filter, all displayed markets should contain the "Politics" tag in their tags array
**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Tag-Based Market Filtering  
*For any* selected tag and any set of market events, when a tag filter is applied, all displayed markets should contain that tag slug in their tags array, and when "All" is selected, no additional tag filtering should be applied
**Validates: Requirements 8.1, 8.3, 8.5**

### Property 3: Market Type Display Consistency
*For any* market event, when displayed as a market card, simple markets should show exactly two outcome buttons while complex markets should show category titles with their respective Yes/No options
**Validates: Requirements 3.1, 3.2, 4.1, 4.2**

### Property 4: API Data Parsing Round-Trip
*For any* valid Polymarket events.json structure, parsing the events array, extracting market outcomes from JSON strings, and processing probabilities should produce valid market display data with all required fields populated
**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 5: Image Display Priority
*For any* market event, the market card should display images in priority order (event.image first, then market.image fallback, then gradient fallback), and image loading failures should gracefully fall back to the next option
**Validates: Requirements 6.2, 7.3, 9.1**

### Property 6: Market Information Completeness
*For any* market event, the market card should display volume in compact notation, show "New" badge when event.new is true, display truncated titles, and generate correct navigation links using event.id
**Validates: Requirements 7.1, 7.2, 7.4, 7.5**

### Property 7: Graceful Data Degradation
*For any* malformed market data (invalid JSON in outcomes/prices, missing fields, API failures), the system should provide functional fallbacks (default Yes/No with 50% probabilities, appropriate error messages) without breaking the UI
**Validates: Requirements 9.2, 9.4, 9.5**

### Property 8: Tag Navigation Behavior
*For any* tag selection, the tag bar should update URL parameters, maintain visual hierarchy with Politics as primary, and provide custom scroll controls without browser scrollbars
**Validates: Requirements 2.2, 2.4, 2.5, 2.6, 8.4**

### Property 9: Outcome Button Consistency
*For any* market outcomes, outcome buttons should display both name and probability percentage, use appropriate color coding (green for Yes, red for No), and maintain hover states with smooth transitions
**Validates: Requirements 3.2, 3.5, 6.4**

### Property 10: Layout Responsiveness
*For any* viewport size (desktop, tablet, mobile), the market grid layout should maintain proper spacing, card proportions, and tag bar functionality without horizontal overflow
**Validates: Requirements 1.5, 4.5, 6.6**