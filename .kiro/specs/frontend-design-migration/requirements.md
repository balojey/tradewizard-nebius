# Requirements Document

## Introduction

This feature migrates the existing Next.js 16 frontend at `tradewizard-frontend/` to the new TradeWizard visual identity defined in `docs/design/TradeWizard/`. The migration is a strangler rollout: a new foundation layer (OKLch tokens, UI primitives, tier-gating system, app shell) is introduced first, then pages are swapped one route at a time. Backend (Lambdas, AgentCore, SQL, CDK) remains frozen; all 50+ existing hooks and lib clients (`cognito-auth`, `api-client`, `websocket-client`, `magic`) keep their public contracts unchanged. The visible product changes; the wire protocol does not.

The migration also reorganizes routes: `/` becomes the marketing landing for unauthenticated users (with middleware redirecting authed users to `/markets`); the markets feed moves from `/` to `/markets`; market detail moves from `/market/[slug]` to `/markets/[slug]`; and several redundant routes (`/history`, `/orders`, `/positions`, `/wallet`, `/performance`) are folded into the tabbed `/portfolio` page.

## Glossary

- **Frontend**: The Next.js 16 application at `tradewizard-frontend/`. The system under design in this spec.
- **Token_System**: The OKLch CSS custom-property palette plus the Tailwind 4 `@theme` directive that exposes utility classes for those tokens. Defined in `app/globals.css`.
- **UI_Primitive**: A shared, single-responsibility React component under `components/ui/` (Card, Button, Badge, ProbabilityBar, MetricStat, Modal, Toggle, Tabs, Expandable, Slider, LockOverlay, UpgradePrompt, TierGate).
- **App_Shell**: The product-app layout primitive (`components/shell/AppShell.tsx`) that composes the sticky navigation, main content area, and optional banner slot.
- **App_Nav**: The new sticky navigation bar component (`components/shell/AppNav.tsx`) used inside App_Shell.
- **Marketing_Shell**: The unauthenticated landing-page layout primitive (`components/shell/MarketingShell.tsx`).
- **Auth_Shell**: The login-page centered-card layout primitive (`components/shell/AuthShell.tsx`).
- **TierGate**: The component that conditionally renders or locks a region based on the user's plan (`components/ui/TierGate.tsx`).
- **Plan**: The user's subscription tier - one of `free`, `starter`, `pro`, `elite`.
- **Plan_Capability_Matrix**: The frontend constant (`constants/plans.ts::PLAN_CAPABILITIES`) that lists per-plan recurring intervals, notification channels, PM concurrent session limit, and persona-customization entitlement.
- **Routing_Middleware**: The Next.js App Router middleware (`middleware.ts`) that redirects authenticated users away from `/` to `/markets` and unauthenticated users away from protected routes to `/login`.
- **Auth_Cookie_Bridge**: The additive `providers/AuthProvider.tsx` change that mirrors the existing id token from localStorage into a non-HttpOnly `tw_id_token` cookie so Routing_Middleware can read auth state at the edge.
- **PM**: Portfolio Manager - autonomous trading sessions per market.
- **Persona**: One of six trading strategies (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider) selected once globally and applied to all PM sessions.
- **Tier_Switcher**: The development-only floating overlay component that overrides Plan locally for visual QA. Tree-shaken from production builds.
- **Existing_Hook**: Any hook under `tradewizard-frontend/hooks/` listed in the steering document. Treated as a frozen contract by this spec.

## Requirements

### Requirement 1: OKLch Token System

**User Story:** As a frontend developer, I want a single source of truth for color, typography, and radius tokens, so that every page renders the new brand identity consistently and theme-switching works across all surfaces.

#### Acceptance Criteria

1. THE Frontend SHALL define the eleven OKLch color tokens (`--bg`, `--surface`, `--surface-2`, `--fg`, `--muted`, `--border`, `--accent`, `--ai`, `--yes`, `--no`, `--warning`) in `app/globals.css` with the exact values specified in `docs/design/TradeWizard/brand-spec.md`.
2. THE Frontend SHALL expose every color token as a Tailwind utility class via the `@theme inline` directive (e.g., `bg-bg`, `bg-surface`, `text-fg`, `border-border`, `text-yes`, `text-no`, `text-ai`, `text-accent`, `text-warning`).
3. WHEN the `data-theme` attribute on the `<html>` element is `"dark"`, THE Frontend SHALL resolve every color token to its dark-theme value.
4. WHEN the `data-theme` attribute on the `<html>` element is `"light"`, THE Frontend SHALL resolve every color token to its light-theme value.
5. THE Frontend SHALL set the default `data-theme` value to `"dark"` for users with no stored preference and no `prefers-color-scheme: light` media query match.
6. WHEN the user clicks the theme toggle in App_Nav, THE Frontend SHALL update the `data-theme` attribute and persist the chosen value in `localStorage` under the key `tw-theme`.
7. WHEN a page first loads, THE Frontend SHALL apply the persisted `data-theme` value before any React component renders, using a synchronous inline script in the document head.
8. THE Frontend SHALL load `Inter` and `JetBrains Mono` via `next/font/google` and expose them as `--font-sans` and `--font-mono` CSS variables.
9. THE Frontend SHALL declare the display font stack (`--font-display`) with `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif` so Apple devices surface SF Pro automatically.
10. THE Frontend SHALL remove the existing background mesh gradients and the existing custom scrollbar styles from `app/globals.css`.

### Requirement 2: UI Primitive Library

**User Story:** As a frontend developer, I want a small library of reusable UI primitives, so that pages compose the new design without duplicating styling or accessibility logic.

#### Acceptance Criteria

1. THE Frontend SHALL provide `Card`, `Button`, `Badge`, `ProbabilityBar`, `MetricStat`, `Modal`, `Toggle`, `Tabs`, `Expandable`, `Slider`, `LockOverlay`, and `UpgradePrompt` UI_Primitive components under `components/ui/`.
2. THE `Card` UI_Primitive SHALL render with a 12px border radius, a 1px hairline border using the `--border` token, and the `--surface` token as its background.
3. THE `Button` UI_Primitive SHALL support `variant` values `primary`, `secondary`, `ai`, `yes`, `no`, `ghost`, and `danger`, mapping each to a documented combination of color tokens.
4. THE `ProbabilityBar` UI_Primitive SHALL accept a `cents` value in the inclusive range `[0, 100]` and render a fill width equal to `cents` percent of its container width.
5. WHERE the `aiCents` prop is provided to `ProbabilityBar`, THE `ProbabilityBar` SHALL render a secondary marker positioned at `aiCents` percent of its container width.
6. THE `Modal` UI_Primitive SHALL render its children inside a React portal, trap keyboard focus within the modal while open, and return focus to the previously focused element when closed.
7. WHEN the user presses the `Escape` key while a `Modal` is open, THE `Modal` SHALL invoke its `onClose` callback.
8. THE `Tabs` UI_Primitive SHALL move focus between tab triggers when the user presses `ArrowLeft` or `ArrowRight` while a tab trigger has focus.
9. THE `Expandable` UI_Primitive SHALL render using the native `<details>` and `<summary>` elements so it toggles on `Enter` or `Space` without additional JavaScript.
10. THE Frontend SHALL render a visible focus ring on every interactive UI_Primitive when the element is focused via keyboard, using `focus-visible` styling that is not removed by `outline: none`.
11. WHEN the user has set `prefers-reduced-motion: reduce` at the operating system level, THE Frontend SHALL skip non-essential decorative animations and reduce all CSS transition and animation durations to no more than 0.01 milliseconds.

### Requirement 3: Tier-Gating System

**User Story:** As a paying user, I want the UI to clearly indicate which features my plan unlocks and which require an upgrade, so that I can make informed decisions about which plan to choose.

#### Acceptance Criteria

1. THE Frontend SHALL define `PLAN_CAPABILITIES` in `constants/plans.ts` with one entry per Plan listing recurring intervals, notification channels, PM concurrent session limit, and a persona-customization boolean.
2. THE Frontend SHALL provide a `useCurrentPlan` hook that returns the user's Plan and a derived capability struct without making any new network request.
3. THE `useCurrentPlan` hook SHALL derive its return value exclusively from the existing `useSubscription` hook return value.
4. WHERE the user's Plan satisfies the `plan` prop required by a TierGate, THE TierGate SHALL render its children without any lock overlay or visual modification.
5. WHERE the user's Plan does not satisfy the `plan` prop required by a TierGate AND the TierGate's `showLocked` prop is `true`, THE TierGate SHALL render its children inside a relative wrapper that shows a backdrop-blurred lock overlay containing the feature name and a link to `/account/subscription`.
6. WHERE the user's Plan does not satisfy the `plan` prop required by a TierGate AND the TierGate's `showLocked` prop is `false`, THE TierGate SHALL render no output for that region.
7. THE Frontend SHALL render an `UpgradePrompt` banner at the top of the markets, market detail, insights, portfolio, and settings pages whenever the user's Plan is `free` and the page contains capabilities the Plan does not unlock.
8. THE Frontend SHALL render the variant of `UpgradePrompt` that targets the next-higher Plan when the user's Plan is `starter` and the page contains capabilities only available at `pro` or above.
9. THE Plan_Capability_Matrix SHALL list `free` with intervals `["once"]`, channels `["in_app"]`, PM session limit `0`, and persona customization disabled.
10. THE Plan_Capability_Matrix SHALL list `starter` with intervals `["once","1d"]`, channels `["in_app","email","push"]`, PM session limit `0`, and persona customization disabled.
11. THE Plan_Capability_Matrix SHALL list `pro` with intervals `["once","1h","4h","12h","1d"]`, channels `["in_app","email","push","webhook"]`, PM session limit `3`, and persona customization disabled.
12. THE Plan_Capability_Matrix SHALL list `elite` with intervals `["once","1h","4h","12h","1d"]`, channels `["in_app","email","push","webhook"]`, PM session limit `10`, and persona customization enabled.
13. THE Frontend SHALL treat the Plan_Capability_Matrix as a UI affordance only and SHALL continue to honor every typed error returned by the backend (`InsufficientCreditsError`, `PlanRestrictionError`, `NotFoundError`).

### Requirement 4: App Shell and Navigation

**User Story:** As a user, I want a unified header showing my credit balance, wallet, and tier on every page, so that I always know my account state and can navigate consistently.

#### Acceptance Criteria

1. THE Frontend SHALL provide an App_Shell component that wraps every authenticated page with App_Nav and an optional banner slot.
2. THE App_Nav SHALL render a sticky top bar with maximum content width 1200px and a height of 56 pixels.
3. THE App_Nav SHALL display the brand mark (logo dot + name "TradeWizard") on the left, primary navigation links in the center, and a right cluster containing WalletBadge, CreditBadge, ThemeToggle, and the user avatar.
4. THE App_Nav primary navigation links SHALL be `Markets`, `Portfolio`, `PM`, `Insights`, `Plan`, and `Settings`, in that order.
5. WHEN the user's Plan is `free` or `starter`, THE App_Nav SHALL hide the `PM` navigation link entirely.
6. WHEN the current pathname matches a navigation link's href, THE App_Nav SHALL apply the active styling (full-opacity foreground color, weight 600) to that link.
7. WHEN the user clicks the brand mark in the App_Nav, THE Frontend SHALL navigate to `/markets`.
8. WHILE the viewport width is less than 768 pixels, THE App_Nav SHALL replace the inline links with a hamburger trigger that reveals a slide-down menu containing the same links.
9. THE Frontend SHALL provide Marketing_Shell and Auth_Shell components for unauthenticated surfaces; neither shell SHALL render the App_Nav.
10. THE CreditBadge SHALL display the user's current credit balance using the existing CreditBalance hook surface and SHALL display "∞ credits" when the user's Plan is `elite`.
11. THE WalletBadge SHALL read wallet state from the existing WalletProvider context and SHALL show a hover-revealed detail panel with three rows: total wallet balance, committed capital, and available balance.
12. THE WalletBadge SHALL compute committed capital as the sum of invested amounts across the user's active PM sessions returned by the existing `usePortfolioSessions` hook.

### Requirement 5: Authentication-aware Routing

**User Story:** As an authenticated user, I want clicking a bookmark or shared link to land me in the right part of the app without ever seeing the marketing page, and as a visitor I want the marketing page to load instantly without auth detection flicker.

#### Acceptance Criteria

1. THE Frontend SHALL implement Routing_Middleware in `middleware.ts` that runs before any page renders.
2. WHEN a request arrives at `/` AND the request includes a non-empty `tw_id_token` cookie with an unexpired `exp` claim, THE Routing_Middleware SHALL respond with a 307 redirect to `/markets`.
3. WHEN a request arrives at any protected route (`/markets`, `/markets/[slug]`, `/insights`, `/portfolio`, `/portfolio-manager`, `/account`, `/account/*`) AND the request does not include a non-empty `tw_id_token` cookie with an unexpired `exp` claim, THE Routing_Middleware SHALL respond with a 307 redirect to `/login` with the original path captured in a `next` query parameter.
4. THE Routing_Middleware SHALL treat `/`, `/login`, `/api/*`, and static asset paths as public.
5. THE Frontend SHALL implement Auth_Cookie_Bridge in `providers/AuthProvider.tsx` so that whenever the provider stores tokens, it also writes a non-HttpOnly `tw_id_token` cookie with `Secure; SameSite=Lax; Path=/; Max-Age=<token TTL>` carrying the same id token value.
6. THE Frontend SHALL clear the `tw_id_token` cookie whenever AuthProvider clears tokens (sign-out, refresh failure, manual disconnect).
7. THE Routing_Middleware SHALL only check the cookie's presence and the unexpired `exp` claim, and SHALL NOT attempt cryptographic JWT validation.
8. IF a request to a backend endpoint returns a 401 status, THEN THE existing `lib/api-client.ts` 401 handler SHALL clear the localStorage tokens, clear the `tw_id_token` cookie via AuthProvider, and redirect the user to `/login`.
9. WHEN the user completes Magic Link sign-in on `/login` AND the URL contains a `next` query parameter pointing to a relative path under the protected route set, THE Frontend SHALL navigate to the value of `next` after sign-in.
10. WHEN the user completes Magic Link sign-in on `/login` AND no valid `next` query parameter is present, THE Frontend SHALL navigate to `/markets` after sign-in.
11. THE `lib/cognito-auth.ts` module SHALL NOT be modified by this migration.
12. THE backend Lambda authorizers SHALL continue to authenticate every request via the `Authorization: Bearer` header injected by `lib/api-client.ts`.

### Requirement 6: Page Mapping and Legacy Route Redirects

**User Story:** As a user with bookmarked URLs from the previous version, I want my old links to keep working, so that I am not stranded by the migration.

#### Acceptance Criteria

1. THE Frontend SHALL serve the landing page mock-up (`landing.html`) at `/` for unauthenticated users.
2. THE Frontend SHALL serve the markets feed mock-up (`markets.html`) at `/markets`.
3. THE Frontend SHALL serve the market detail mock-up (`market-detail.html`) at `/markets/[slug]`.
4. THE Frontend SHALL serve the insights mock-up (`insights.html`) at `/insights`.
5. THE Frontend SHALL serve the portfolio mock-up (`portfolio.html`) at `/portfolio`.
6. THE Frontend SHALL serve the portfolio-manager mock-up (`portfolio-manager.html`) at `/portfolio-manager`.
7. THE Frontend SHALL serve the persona-selection mock-up (`persona-selection.html`) at `/account/persona`.
8. THE Frontend SHALL serve the subscription mock-up (`subscription.html`) at `/account/subscription`.
9. THE Frontend SHALL serve the settings mock-up (`settings.html`) at `/account`.
10. WHEN a request arrives at `/market/[slug]` (singular), THE Frontend SHALL respond with a 308 permanent redirect to `/markets/[slug]` (plural) preserving the slug value.
11. WHEN a request arrives at any of `/history`, `/orders`, `/positions`, `/wallet`, or `/performance`, THE Frontend SHALL respond with a 307 redirect to `/portfolio` with a `tab` query parameter selecting the corresponding tab (history, orders, positions, wallet, or performance).
12. WHEN a request arrives at `/account/portfolio`, THE Frontend SHALL respond with a 307 redirect to `/account/persona`.

### Requirement 7: Markets Feed Page

**User Story:** As a trader, I want to browse prediction markets in a dense, AI-augmented feed, so that I can discover opportunities quickly.

#### Acceptance Criteria

1. WHEN the user navigates to `/markets`, THE Frontend SHALL render the markets feed inside App_Shell with a page header (title + search bar), category filter chips, an optional UpgradePrompt, a Trending Now horizontal carousel, a markets grid, and a sidebar containing Trending and AI Spotlight cards.
2. THE markets grid SHALL render one MarketCard per market returned by the existing `useMarkets` (or `useMarketSearch` when a search query is active) hook.
3. EACH MarketCard SHALL display the market thumbnail, title, category, volume, end date, a ProbabilityBar with the YES probability in cents, and a pair of Buy YES / Buy NO action buttons.
4. WHERE the user's Plan does not entitle them to recurring analysis, EACH MarketCard SHALL render a `<TierGate plan="starter">` row showing a lock icon with the text "Recurring analysis" and a link to `/account/subscription`.
5. WHEN the user clicks any MarketCard, THE Frontend SHALL navigate to `/markets/[slug]` for that market.
6. WHEN the user clicks a category filter chip, THE Frontend SHALL filter the visible markets by that category using the existing `usePoliticalCategories` hook's category list and the existing market data without making a new network request.
7. WHEN the user types a query in the search input, THE Frontend SHALL invoke the existing `useMarketSearch` hook with that query after a 250-millisecond debounce.
8. THE markets feed SHALL render a skeleton state for the markets grid while `useMarkets` is in its `isLoading` state.
9. IF `useMarkets` returns an error, THEN THE Frontend SHALL render an error card with the error message and a "Retry" button that re-runs the query.

### Requirement 8: Market Detail Page

**User Story:** As a trader, I want a single page where I can view the price chart, order book, AI intelligence panel, request analysis, place trades, and activate the Portfolio Manager for a market, so that I can act on a recommendation without leaving the page.

#### Acceptance Criteria

1. WHEN the user navigates to `/markets/[slug]`, THE Frontend SHALL render the market detail page inside App_Shell with a breadcrumb, market header (image + title + stats), a two-column layout containing a left column (chart, order book, market description, analysis history panel) and a right column (AI Intelligence panel - sticky on viewports ≥1024px).
2. THE chart panel SHALL render the market's price history using the existing `usePriceHistory` hook and SHALL provide tabs for `1H`, `1D`, `1W`, `1M`, and `ALL` time ranges.
3. THE order book panel SHALL render the top six orders (three YES + three NO) using the existing market hook surface.
4. WHEN the user clicks Buy YES or Buy NO in the AI panel's quick-buy area, THE Frontend SHALL scroll to the trade execution section and pre-select the corresponding side.
5. THE trade execution section SHALL provide tabs for `Buy YES` and `Buy NO`, and order-type buttons for `Market` and `Limit`, an amount input, an optional limit-price input, and a summary row (price, shares, max payout, potential profit).
6. WHEN the user submits a trade, THE Frontend SHALL invoke the existing `useClobOrder` or `useQuickTrade` hook with the entered amount, side, and order type, and SHALL render the existing typed-error UI on failure.
7. THE AI Intelligence panel SHALL render a recommendation badge, quick-buy buttons, a confidence meter, a thesis section, an edge visualization, and the following expandable sections: Agent Signals, Bull vs Bear Debate, Consensus, Position Sizing, Risk Factors, Key Catalysts.
8. THE AI Intelligence panel SHALL source its data from the existing `useMarketAnalysis`, `useAgentSignals`, and `useTradeRecommendation` hooks.
9. WHEN the user clicks the "Refresh Analysis" or "Get Analysis" button, THE Frontend SHALL open the analysis modal.
10. WHILE an analysis is in flight, THE analysis modal SHALL render an eleven-stage progress pipeline driven by the existing `useAnalysisProgress` hook, with each stage transitioning from `pending` to `active` to `done` based on the hook's `stage` and `status` values.
11. WHERE the user's Plan satisfies `pro` or higher, THE market detail page SHALL render a Portfolio Manager activation card below the trade execution section.
12. WHERE the user's Plan does not satisfy `pro`, THE Portfolio Manager activation card SHALL render in its locked state with a link to `/account/subscription`.
13. WHEN the user clicks "Activate Portfolio Manager", THE Frontend SHALL invoke the existing `usePortfolioActivation` hook with the entered investment amount and optional profit-target percentage.

### Requirement 9: Insights Page

**User Story:** As a user with multiple recurring analyses, I want a dedicated page that lists all my analyses with their progress and credit usage, so that I can monitor my AI spend and review recent recommendations.

#### Acceptance Criteria

1. WHEN the user navigates to `/insights`, THE Frontend SHALL render the insights page inside App_Shell with a page header (title + "+ New Analysis" button), an optional UpgradePrompt, a two-column layout containing a left column (running analyses, recent analyses) and a right sidebar (Credit Usage, Agent Accuracy, Upcoming Deliveries).
2. THE running analyses section SHALL render one card per in-flight analysis using the existing `useAnalysisProgress` hook to show the eleven-stage pipeline progress.
3. THE recent analyses section SHALL render one card per completed analysis using the existing `useAnalysisResults` hook with infinite-scroll pagination.
4. EACH analysis card SHALL display the market name and thumbnail, the recommendation pill (BUY YES / BUY NO / NO TRADE), edge in cents, confidence percentage, agent count, an optional recurring-interval badge, an edge visualization with market and AI markers, and a 14-agent consensus row.
5. WHERE the user's Plan is not `free`, THE analysis card SHALL also render the Bull vs Bear debate summary expandable.
6. WHERE the user's Plan is `free`, THE Bull vs Bear debate summary SHALL be rendered in a collapsed/preview state with an UpgradePrompt below it.
7. THE Credit Usage sidebar card SHALL show the current balance, monthly cap, used-this-month count, active recurring count, and reset date sourced from the existing `useSubscription` hook.
8. THE Agent Accuracy sidebar card SHALL list the top six agents by 30-day accuracy using the existing `useAgentSignals` hook's aggregate data.

### Requirement 10: Portfolio Page

**User Story:** As a trader, I want a single tabbed page that consolidates my positions, analysis history, closed trades, wallet, and performance metrics, so that I do not have to navigate between five separate pages to manage my account.

#### Acceptance Criteria

1. WHEN the user navigates to `/portfolio`, THE Frontend SHALL render the portfolio page inside App_Shell with a four-card summary row (Total Value, Unrealized P&L, Win Rate, AI Accuracy) and a tab list with at least the tabs `positions`, `history`, `closed`.
2. THE summary cards SHALL source their values from the existing `usePortfolioStats` and `usePerformanceData` hooks.
3. WHEN the URL contains a `tab` query parameter matching one of the tab ids, THE Frontend SHALL activate that tab on initial render.
4. THE Active Positions tab SHALL render a positions table using the existing `useUserPositions` hook.
5. THE Active Positions tab SHALL render a Portfolio Manager summary card above the positions table.
6. WHERE the user's Plan does not satisfy `pro`, THE Portfolio Manager summary card SHALL render in its locked state with a link to `/account/subscription`.
7. THE Analysis History tab SHALL render the user's analysis history using the existing `useAnalysisResults` hook.
8. THE Closed Trades tab SHALL render the user's closed trades using the existing `useUserPositions` hook with the resolved-positions filter.
9. THE portfolio page SHALL render a performance chart visualization at the bottom using the existing `usePerformanceData` hook.

### Requirement 11: Portfolio Manager Dashboard

**User Story:** As a Pro or Elite user, I want a dedicated dashboard for my autonomous Portfolio Manager sessions with kill-switch and per-session controls, so that I can monitor and intervene in live trading.

#### Acceptance Criteria

1. WHEN the user navigates to `/portfolio-manager` AND the user's Plan satisfies `pro`, THE Frontend SHALL render the portfolio-manager dashboard inside App_Shell with a page header (title + persona badge + Kill Switch button), a four-card stats bar (Committed Capital, Unrealized P&L, Realized P&L, Active Sessions), a sessions list, and a session detail panel.
2. WHEN the user navigates to `/portfolio-manager` AND the user's Plan does not satisfy `pro`, THE Frontend SHALL render the page in its locked state with an UpgradePrompt linking to `/account/subscription`.
3. THE sessions list SHALL render one SessionCard per active or completed session returned by the existing `usePortfolioSessions` hook.
4. EACH SessionCard SHALL display the market name and current probability, persona icon, invested amount, utilization percentage, current position direction, unrealized and realized P&L, and a status badge with one of `Watching`, `Positioned`, `Cooldown`, `Completed`, or `Terminated`.
5. WHEN the user clicks a SessionCard, THE Frontend SHALL toggle a session detail panel showing tabs for Capital, Decision Log, and Trade History.
6. THE Capital tab SHALL show in-positions, pending-orders, available, and realized-P&L amounts plus a capital utilization bar with three segments.
7. THE Decision Log tab SHALL render decisions returned by the existing `usePortfolioSession` hook with an action label (Skip, Hold, Enter, Exit, Rejected) and a reason string.
8. THE Trade History tab SHALL render trades returned by the existing `usePortfolioTrades` hook.
9. WHEN the user clicks "Pause", "Resume", or "Stop" on a SessionCard, THE Frontend SHALL invoke the corresponding mutation on the existing `usePortfolioActions` hook.
10. WHEN the user clicks the Kill Switch button in the page header, THE Frontend SHALL render a confirmation modal explaining that all positions across all sessions will be exited.
11. WHEN the user confirms the Kill Switch, THE Frontend SHALL invoke the kill-switch mutation on the existing `usePortfolioActions` hook and SHALL render a kill-active banner above the stats bar.
12. THE portfolio-manager page SHALL subscribe to the existing `usePortfolioWebSocket` hook so session and trade updates appear in real time without a manual refresh.
13. THE portfolio-manager UI SHALL NOT add any control that bypasses or weakens the existing PM safety enforcement (mandatory stop-loss, mandatory take-profit, capital conservation, concurrent session limit, kill-switch totality).

### Requirement 12: Persona Selection Page

**User Story:** As a Pro or Elite user, I want to choose one of six trading personas to govern all my Portfolio Manager sessions, and as an Elite user, I want to fine-tune the persona's parameters.

#### Acceptance Criteria

1. WHEN the user navigates to `/account/persona`, THE Frontend SHALL render the persona selection page inside App_Shell with a six-card grid where each card represents one of the personas Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider.
2. EACH persona card SHALL display the persona icon, name, risk badge (Aggressive / Moderate / Conservative), philosophy paragraph, and three persona statistics (Frequency, Position size range, Hold duration).
3. THE Frontend SHALL highlight the currently selected persona using the value returned by the existing `usePersonaSettings` hook.
4. WHEN the user clicks a persona card, THE Frontend SHALL update the local selection state and SHALL NOT persist the choice until the user clicks Save Persona.
5. WHEN the user clicks Save Persona, THE Frontend SHALL invoke the existing `usePersonaSettings` mutation with the selected persona id.
6. WHERE the user's Plan satisfies `elite`, THE page SHALL render a Customize Parameters section with sliders for Exit Sensitivity, Monitoring Frequency, and Sizing Aggression sourced from the existing `usePersonaParams` hook.
7. WHERE the user's Plan does not satisfy `elite`, THE Customize Parameters section SHALL be rendered in its locked state with a link to `/account/subscription`.
8. WHEN the Elite user adjusts a slider, THE Frontend SHALL invoke the existing `usePersonaParams` mutation with the updated value, applying any client-side validation already present in that hook.

### Requirement 13: Subscription Page

**User Story:** As a user, I want to compare plans, upgrade or downgrade, buy credit packs, and view my billing history, all from one page that uses on-chain USDC.e payments without altering the existing payment mechanics.

#### Acceptance Criteria

1. WHEN the user navigates to `/account/subscription`, THE Frontend SHALL render the subscription page inside App_Shell with a current-plan summary card, a four-card plan grid (Free, Starter, Pro, Elite), a credit packs section, a billing history table, and a cancel-subscription action.
2. THE current-plan summary card SHALL display the plan name, plan description, current credit balance, monthly credit allowance, and a credit-usage progress bar sourced from the existing `useSubscription` hook.
3. EACH plan card SHALL display the plan name, monthly price, credits-included line, a feature list, and an action button labeled `Upgrade`, `Downgrade`, or `Current Plan` based on the user's current Plan.
4. WHEN the user clicks the action button on a non-current plan card, THE Frontend SHALL invoke the existing `useChangePlan` (upgrade) or open a downgrade-confirmation modal (downgrade) and on confirm invoke the existing `useChangePlan` mutation.
5. THE credit packs section SHALL render exactly two cards corresponding to the backend's `pack_20` (20 credits for $9) and `pack_50` (50 credits for $19) entries from `infra/services/shared/plans.ts::CREDIT_PACKS`.
6. WHEN the user clicks a credit-pack card, THE Frontend SHALL invoke the existing `usePurchaseCredits` mutation with the corresponding pack id.
7. THE billing history table SHALL render entries returned by the existing wallet-subscription hooks with columns Date, Description, Amount, and Status.
8. WHEN the user clicks "Cancel Subscription", THE Frontend SHALL render a confirmation modal explaining that the plan remains active until the end of the current billing cycle and unused credits will be lost.
9. WHEN the user confirms cancellation, THE Frontend SHALL invoke the existing `useCancelSubscription` mutation.
10. THE subscription page SHALL NOT modify the existing on-chain USDC.e transfer flow, transaction-hash verification, or ERC-20 `transferFrom` allowance for auto-renewal.

### Requirement 14: Settings Page

**User Story:** As a user, I want to configure delivery channels, quiet hours, alert thresholds, and recurring-analysis notification preferences, with each option clearly labeled with its required plan.

#### Acceptance Criteria

1. WHEN the user navigates to `/account`, THE Frontend SHALL render the settings page inside App_Shell with sections for Delivery Channels, Quiet Hours, Alert Thresholds, Recurring Analysis Notifications, and Trading Persona.
2. THE Delivery Channels section SHALL render Toggle controls for In-app, Email, Push, and Webhook channels using the existing `useNotificationPreferences` hook.
3. WHERE the user's Plan does not allow Email channel (currently `free`), THE Email Toggle SHALL render with a lock overlay containing a link to `/account/subscription`.
4. WHERE the user's Plan does not allow Push channel (currently `free`), THE Push Toggle SHALL render with a lock overlay containing a link to `/account/subscription`.
5. WHERE the user's Plan does not allow Webhook channel (currently `free` or `starter`), THE Webhook Toggle and webhook URL input SHALL render with a lock overlay containing a link to `/account/subscription`.
6. WHEN the user enters a webhook URL and clicks Test, THE Frontend SHALL invoke the existing `useNotificationPreferences` test action, which validates that the URL uses HTTPS on the backend and surfaces the typed error if it does not.
7. THE Quiet Hours section SHALL provide an enable Toggle and From/To time inputs sourced from the existing `useNotificationPreferences` hook.
8. THE Alert Thresholds section SHALL provide a probability-shift Toggle and a slider for the minimum shift percentage in the inclusive range `[1, 20]`, sourced from the existing `useNotificationPreferences` hook.
9. THE Trading Persona section on the settings page SHALL display the user's currently selected persona from the existing `usePersonaSettings` hook with a "Change Persona" link to `/account/persona`.
10. WHERE the user's Plan does not satisfy `pro`, THE Trading Persona section SHALL render in its locked state with a link to `/account/subscription`.

### Requirement 15: Landing Page

**User Story:** As a visitor, I want a marketing page that explains TradeWizard's value, shows pricing, and gives me a clear path to sign up.

#### Acceptance Criteria

1. WHEN an unauthenticated user navigates to `/`, THE Frontend SHALL render the landing page inside Marketing_Shell with hero, How It Works pipeline (4 steps), Features grid (6 cards), Autonomous Trading section (3 cards), Pricing grid (4 plan cards), CTA, and footer.
2. THE landing page Pricing grid SHALL display the same plan names, prices, and credit allowances as the subscription page, sourced from the same `constants/plans.ts` constants.
3. WHEN the user clicks "Get Started Free", "Sign in", "Subscribe", or any other primary CTA on the landing page, THE Frontend SHALL navigate to `/login`.
4. THE landing page SHALL NOT make any authenticated API request and SHALL NOT consume any data hook that requires authentication.
5. WHEN an authenticated user navigates to `/`, THE Routing_Middleware SHALL redirect them to `/markets` before the landing page renders.

### Requirement 16: Login Page

**User Story:** As a visitor or returning user, I want to sign in with a Magic Link sent to my email, so that I can access the app without a password.

#### Acceptance Criteria

1. WHEN the user navigates to `/login`, THE Frontend SHALL render the login page inside Auth_Shell with a centered 400-pixel-wide card containing the brand mark, an email input, a Send Magic Link button, and a footer note.
2. WHEN the user submits the email form with a valid email, THE Frontend SHALL invoke the existing Magic Link initiation flow via `lib/cognito-auth.ts` and SHALL render the "Check your inbox" sent-state.
3. WHEN the user clicks Resend Link in the sent-state, THE Frontend SHALL re-invoke the existing Magic Link initiation flow and SHALL display a transient confirmation.
4. WHEN the user completes Magic Link sign-in successfully, THE Frontend SHALL apply the route resolution defined in Requirements 5.9 and 5.10.
5. THE login page SHALL NOT modify the existing Cognito Custom Auth flow defined in `lib/cognito-auth.ts`.

### Requirement 17: Behavior Preservation Invariants

**User Story:** As a platform owner, I want the migration to leave every backend integration, real-time channel, and safety mechanism intact, so that user trust and capital are not at risk during a visual rollout.

#### Acceptance Criteria

1. THE Frontend SHALL preserve the provider composition order `AuthProvider → WalletProvider → QueryProvider → WebSocketProvider → TradingProvider` in `providers/index.tsx`.
2. THE Frontend SHALL NOT modify the public TypeScript shape of any existing hook under `hooks/` listed in the steering document.
3. THE Frontend SHALL NOT modify `lib/cognito-auth.ts`.
4. THE Frontend SHALL NOT modify `lib/websocket-client.ts` and SHALL preserve its exponential-backoff reconnection (1s → 30s) and 5-minute ping keepalive behavior.
5. THE Frontend SHALL NOT modify `lib/api-client.ts` other than additive non-behavior-changing helpers, and SHALL preserve the typed errors `ApiError`, `InsufficientCreditsError`, `PlanRestrictionError`, `NotFoundError`.
6. THE Frontend SHALL NOT modify `lib/magic.ts`.
7. THE Frontend SHALL NOT add any new authenticated API endpoint, hook, or backend dependency to support the migration. Only `useCurrentPlan` (a pure derivation of `useSubscription`), `useTheme` (a thin localStorage wrapper), and a re-export of framer-motion's `useReducedMotion` SHALL be added.
8. THE Frontend SHALL NOT modify any backend code under `infra/`, `tradewizard-agents/`, or any deployed Lambda, AgentCore application, SQL schema, or CDK stack.
9. THE Frontend SHALL NOT bypass or weaken any backend authorization check; the backend SHALL remain the sole source of truth for plan-based access decisions.
10. THE Frontend SHALL NOT add any control to the Portfolio Manager UI that bypasses or weakens existing PM safety enforcement (mandatory stop-loss, mandatory take-profit, capital conservation, concurrent session limit per plan, kill-switch totality).

### Requirement 18: Accessibility Baseline

**User Story:** As a user with low vision, motor impairments, or who relies on a screen reader, I want every screen to meet WCAG-AA, so that I can use TradeWizard with the same effectiveness as any other user.

#### Acceptance Criteria

1. THE Frontend SHALL render text using foreground/background token combinations that achieve a contrast ratio of at least 4.5:1 for body text and at least 3:1 for large text and UI components, in both light and dark themes.
2. THE Frontend SHALL render a visible keyboard focus indicator on every interactive element (links, buttons, inputs, sliders, toggles, tab triggers, expandable summaries, modal close buttons) when the element is focused via keyboard.
3. THE Frontend SHALL NOT render meaningful information using color alone; YES/NO, status, and tier indicators SHALL include a text label or icon in addition to color.
4. THE Frontend SHALL render the analysis-progress region with `role="status"` and `aria-live="polite"` so screen readers announce stage changes.
5. THE Frontend SHALL render decorative pulse dots and gradient accents with `aria-hidden="true"` so screen readers do not announce them.
6. THE Frontend SHALL provide explicit `aria-label` attributes on Buy YES, Buy NO, Kill Switch, Stop Session, and trade-execution buttons indicating the action and the relevant context (price, market, or session).
7. WHEN the user has set `prefers-reduced-motion: reduce`, THE Frontend SHALL skip non-essential decorative animations.
8. WHILE a Modal is open, THE Frontend SHALL trap keyboard focus within the modal and return focus to the previously focused element when the modal closes.

### Requirement 19: Responsive Layout

**User Story:** As a user on any device size, I want the trading-dense surfaces to remain readable and usable, so that I can act on a recommendation from a phone, tablet, or desktop.

#### Acceptance Criteria

1. WHILE the viewport width is at least 1024 pixels, THE Frontend SHALL render the markets feed sidebar in a 300-pixel right column.
2. WHILE the viewport width is at least 1024 pixels, THE Frontend SHALL render the market detail AI panel as a sticky 360-pixel right column.
3. WHILE the viewport width is between 768 and 1023 pixels, THE Frontend SHALL flow the AI panel below the chart and SHALL render the markets sidebar below the markets grid.
4. WHILE the viewport width is less than 768 pixels, THE App_Nav SHALL replace its inline link list with a hamburger trigger that reveals the menu in a slide-down overlay.
5. WHILE the viewport width is less than 768 pixels, THE Frontend SHALL collapse the order book to the top three YES and top three NO orders with a "View all" expander.
6. WHILE the viewport width is less than 768 pixels AND a trade order is being composed, THE trade execution panel SHALL pin to the bottom of the viewport with safe-area inset padding.
7. WHILE the viewport width is less than 430 pixels, THE Frontend SHALL render every interactive control with a minimum tap-target size of 44 pixels.

### Requirement 20: Animation and Motion

**User Story:** As a user, I want motion that feels purposeful and quick, never theatrical, and that respects my reduced-motion setting.

#### Acceptance Criteria

1. THE Frontend SHALL define motion duration tokens in a single module (`utils/motion.ts`) with values fast=150ms, base=200ms, slow=400ms.
2. THE Frontend SHALL NOT animate any decorative motion for longer than 400 milliseconds.
3. WHEN the user has set `prefers-reduced-motion: reduce`, THE Frontend SHALL render any motion-bearing component in a static end-state.
4. THE Frontend SHALL render the live "websocket connected" indicator with a 2-second pulse animation when reduced-motion is not set.

### Requirement 21: Tier-Switcher Development Tool

**User Story:** As a developer or designer, I want to preview every page as each plan tier without changing my actual subscription, so that I can verify lock states and upgrade prompts.

#### Acceptance Criteria

1. WHEN `process.env.NODE_ENV` is not equal to `"production"` AND `localStorage.getItem('tw-debug')` equals `"1"`, THE Frontend SHALL render the Tier_Switcher floating overlay anchored bottom-center.
2. WHEN `process.env.NODE_ENV` equals `"production"`, THE Frontend SHALL NOT include the Tier_Switcher component code in the bundle.
3. WHEN the user clicks a tier button on the Tier_Switcher, THE Frontend SHALL update a local override that takes precedence over `useCurrentPlan` for the current session and SHALL persist the choice in `localStorage` under the key `tw-tier-override`.
4. THE Tier_Switcher override SHALL only affect UI affordances and SHALL NOT alter any network request or backend response.

### Requirement 22: Migration Sequencing and Cleanup

**User Story:** As a release manager, I want each migration phase to be independently shippable so that we can roll forward or back at any point without breaking the live application.

#### Acceptance Criteria

1. THE Frontend SHALL ship the Token_System and font pipeline (Phase 0) without modifying any existing route or page.
2. THE Frontend SHALL ship the UI_Primitive library and TierGate system (Phase 1) without modifying any existing route or page.
3. THE Frontend SHALL ship the App_Shell, App_Nav, Marketing_Shell, Auth_Shell, and Routing_Middleware (Phase 2) without modifying the page rendered at `/` (which still shows the legacy markets feed at this point).
4. THE Frontend SHALL ship the new markets feed at `/markets` (Phase 3a) before any change to `/` so authenticated users have a destination for the middleware redirect.
5. THE Frontend SHALL ship the new market detail at `/markets/[slug]` and the 308 redirect from the legacy `/market/[slug]` (Phase 3b) before any change to `/`.
6. THE Frontend SHALL replace the page at `/` with the marketing landing AND activate the Routing_Middleware redirect from `/` to `/markets` for authenticated users in the same release (Phase 3c).
7. AFTER all per-page migration phases complete, THE Frontend SHALL delete the legacy `/history`, `/orders`, `/positions`, `/wallet`, and `/performance` page files (Phase 5) and SHALL keep only redirect handlers from those paths.
