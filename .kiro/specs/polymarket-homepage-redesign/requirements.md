# Requirements Document

## Introduction

This specification defines the requirements for redesigning the TradeWizard homepage to match Polymarket's political markets layout. The redesign will transform the current generic market display into a politics-focused interface that mirrors Polymarket's clean, professional design patterns while maintaining TradeWizard's unique AI-powered intelligence features.

## Glossary

- **Event**: A top-level market grouping that contains multiple related markets (e.g., "Trump Deportation Numbers" event contains multiple threshold markets)
- **Market**: An individual prediction market within an event with specific outcomes and prices
- **Simple_Market**: A market with only Yes/No outcomes (binary prediction)
- **Complex_Market**: A market with multiple option categories followed by Yes/No outcomes (e.g., Fed decision ranges)
- **Tag_Filter**: A category label used to filter and organize markets by topic
- **Politics_Tag**: The primary "Politics" tag that serves as the main category filter
- **Related_Tags**: Secondary tags displayed alongside Politics (e.g., "Trump", "Elections", "U.S. Politics")
- **Outcome_Button**: Interactive element displaying market outcome with probability percentage
- **Market_Card**: Visual component displaying market information, image, and outcome buttons
- **Tag_Bar**: Horizontal navigation component containing Politics headline and related tag filters

## Requirements

### Requirement 1: Politics-Focused Market Display

**User Story:** As a political prediction market trader, I want to see a homepage focused primarily on political markets, so that I can quickly access the most relevant trading opportunities.

#### Acceptance Criteria

1. THE Homepage SHALL display markets filtered by the "Politics" tag as the primary content
2. WHEN the homepage loads, THE System SHALL fetch events where tags include "Politics" (slug: "politics")
3. THE Homepage SHALL prioritize political markets over other categories in the default view
4. WHEN no political markets are available, THE System SHALL display a message indicating no political markets found
5. THE Homepage SHALL maintain the existing market card grid layout for consistency

### Requirement 2: Clean Tag Navigation Interface

**User Story:** As a user, I want to see related political tags displayed cleanly next to the Politics headline, so that I can filter to specific political topics without ugly browser scrolling.

#### Acceptance Criteria

1. THE Tag_Bar SHALL display "Politics" as the primary headline with prominent styling
2. WHEN Politics is selected, THE Tag_Bar SHALL show related tags horizontally without browser scroll bars
3. THE Related_Tags SHALL include "Trump", "Elections", "U.S. Politics", "Immigration", "World" based on Polymarket data
4. THE Tag_Bar SHALL use custom scrolling controls instead of browser default scroll bars
5. WHEN a related tag is clicked, THE System SHALL filter markets to show only that tag's content
6. THE Tag_Bar SHALL maintain visual hierarchy with Politics as the primary category

### Requirement 3: Simple Market Display Format

**User Story:** As a trader, I want to see simple Yes/No markets displayed with clear outcome buttons, so that I can quickly understand the betting options and probabilities.

#### Acceptance Criteria

1. WHEN displaying a Simple_Market, THE Market_Card SHALL show exactly two outcome buttons
2. THE Outcome_Button SHALL display the outcome name (e.g., "Yes", "No") and probability percentage
3. THE Simple_Market SHALL parse outcomes from the first market in the event's markets array
4. WHEN outcomes array contains ["Yes", "No"], THE System SHALL display both options with their respective probabilities
5. THE Outcome_Button SHALL use color coding (green for Yes, red for No) to indicate outcome type

### Requirement 4: Complex Market Display Format

**User Story:** As a trader, I want to see complex markets with multiple options displayed clearly, so that I can understand all available betting categories and their probabilities.

#### Acceptance Criteria

1. WHEN displaying a Complex_Market, THE Market_Card SHALL show the option category title followed by Yes/No buttons
2. THE Complex_Market SHALL display the groupItemTitle as the option category (e.g., "250-500k", "Fed 50+ bps decrease")
3. WHEN an event contains multiple markets with different groupItemTitle values, THE System SHALL display each as a separate option
4. THE Complex_Market SHALL show Yes/No probabilities for each option category
5. THE Market_Card SHALL accommodate variable numbers of option categories without layout breaking

### Requirement 5: Polymarket API Data Integration

**User Story:** As a system administrator, I want the homepage to integrate seamlessly with Polymarket's events.json data structure, so that market information is accurate and up-to-date.

#### Acceptance Criteria

1. THE System SHALL parse the events.json structure with events containing markets arrays
2. WHEN processing market data, THE System SHALL extract outcomes from JSON.parse(market.outcomes)
3. THE System SHALL extract probabilities from JSON.parse(market.outcomePrices)
4. THE System SHALL handle both negRisk and standard market types from the API
5. THE System SHALL use event.tags array to filter markets by political categories
6. WHEN market data is malformed, THE System SHALL provide fallback display with default Yes/No options

### Requirement 6: Professional Visual Design

**User Story:** As a user, I want the homepage to have a clean, professional appearance matching Polymarket's design standards, so that the platform feels trustworthy and polished.

#### Acceptance Criteria

1. THE Homepage SHALL use a clean, minimal design aesthetic matching Polymarket's visual style
2. THE Market_Card SHALL display high-quality market images when available from event.image
3. THE Tag_Bar SHALL use subtle borders and spacing to separate sections cleanly
4. THE Outcome_Button SHALL have hover states and smooth transitions for professional interaction
5. THE Homepage SHALL maintain consistent typography and color schemes throughout
6. THE Layout SHALL be responsive and work well on desktop, tablet, and mobile devices

### Requirement 7: Market Information Display

**User Story:** As a trader, I want to see essential market information like volume and status, so that I can assess market liquidity and activity.

#### Acceptance Criteria

1. THE Market_Card SHALL display trading volume using event.volume formatted with compact notation
2. WHEN a market is new, THE Market_Card SHALL show a "New" badge using event.new flag
3. THE Market_Card SHALL display market images from event.image or market.image as fallback
4. THE Market_Card SHALL show market title from event.title with proper text truncation
5. THE Market_Card SHALL link to individual market pages using event.id for navigation

### Requirement 8: Tag Filtering Functionality

**User Story:** As a user, I want to filter markets by specific political tags, so that I can focus on particular areas of political prediction markets.

#### Acceptance Criteria

1. WHEN a tag is selected, THE System SHALL filter events where tags array contains the selected tag slug
2. THE System SHALL support filtering by primary tags like "trump", "elections", "immigration"
3. WHEN "All" is selected, THE System SHALL show all political markets without additional filtering
4. THE Tag_Filter SHALL update the URL to reflect the current filter selection
5. THE System SHALL maintain filter state when navigating back to the homepage

### Requirement 9: Error Handling and Fallbacks

**User Story:** As a user, I want the homepage to work reliably even when some market data is unavailable, so that I can always access available markets.

#### Acceptance Criteria

1. WHEN market image fails to load, THE Market_Card SHALL display a fallback gradient background
2. WHEN market outcomes cannot be parsed, THE System SHALL show default Yes/No options with 50% probabilities
3. WHEN no markets match the selected filter, THE System SHALL display an appropriate "no markets found" message
4. WHEN API data is unavailable, THE System SHALL show a loading state or error message
5. THE System SHALL gracefully handle malformed JSON in outcomes and outcomePrices fields