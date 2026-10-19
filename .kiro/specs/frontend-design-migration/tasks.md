# Implementation Plan: Frontend Design Migration

## Overview

This plan migrates the existing Next.js 16 frontend to the new TradeWizard visual identity using a strangler pattern. Work proceeds in phases: foundation (tokens, fonts, motion), primitives (UI components, tier-gating), shell (navigation, middleware, auth cookie bridge), then pages one route at a time. All existing hooks, providers, and lib clients remain frozen - only markup, styling, and routing change.

All work happens inside `tradewizard-frontend/`. No backend code is modified.

## Tasks

- [x] 1. Phase 0 - Token System and Typography
  - [x] 1.1 Replace globals.css with OKLch token system
    - Replace `app/globals.css` with the new file defined in the design document
    - Define all 11 OKLch color tokens for dark and light themes
    - Wire tokens through Tailwind 4 `@theme inline` directive
    - Add `prefers-reduced-motion` global rule
    - Remove existing background mesh gradients and custom scrollbar styles
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.10, 2.11, 20.3_

  - [x] 1.2 Update root layout with new font pipeline
    - Update `app/layout.tsx` to load Inter and JetBrains Mono via `next/font/google`
    - Expose as `--font-sans` and `--font-mono` CSS variables on `<html>`
    - Remove existing Geist font imports
    - Add synchronous inline `<script>` in `<head>` that reads `localStorage.getItem('tw-theme')` and sets `data-theme` attribute before hydration
    - Set default `data-theme="dark"` when no stored preference and no `prefers-color-scheme: light`
    - _Requirements: 1.5, 1.7, 1.8, 1.9_

  - [x] 1.3 Create motion tokens utility
    - Create `utils/motion.ts` with duration tokens (fast=150ms, base=200ms, slow=400ms), easing curves, and common Framer Motion variants (fadeIn, slideUp, pulseAi)
    - _Requirements: 20.1, 20.2_


- [ ] 2. Phase 1 - UI Primitive Library
  - [x] 2.1 Create Card, Button, and Badge primitives
    - Create `components/ui/Card.tsx` with variants default, elevated, ai; 12px radius, hairline border, surface background
    - Create `components/ui/Button.tsx` with variants primary, secondary, ai, yes, no, ghost, danger; sizes sm, md, lg; loading state
    - Create `components/ui/Badge.tsx` with tones neutral, accent, ai, yes, no, warning, muted; sizes sm, md
    - All must use OKLch tokens and render focus-visible rings
    - _Requirements: 2.1, 2.2, 2.3, 2.10, 18.2_

  - [x] 2.2 Create ProbabilityBar and MetricStat primitives
    - Create `components/ui/ProbabilityBar.tsx` accepting cents (0-100), optional aiCents, variants thin/thick
    - Create `components/ui/MetricStat.tsx` with label, value, optional sub, tone (default, profit, loss, ai, warning)
    - _Requirements: 2.4, 2.5_

  - [x] 2.3 Create Modal primitive with focus trap
    - Create `components/ui/Modal.tsx` rendering into a React portal
    - Implement keyboard focus trap (Tab cycles within modal)
    - Close on Escape key and overlay click
    - Return focus to previously focused element on close
    - _Requirements: 2.6, 2.7, 18.8_

  - [x] 2.4 Create Toggle, Tabs, Expandable, and Slider primitives
    - Create `components/ui/Toggle.tsx` with checked, onChange, label, description, disabled props
    - Create `components/ui/Tabs.tsx` with ArrowLeft/ArrowRight keyboard navigation between tab triggers
    - Create `components/ui/Expandable.tsx` using native `<details>`/`<summary>` elements
    - Create `components/ui/Slider.tsx` with min, max, step, value, onChange, label, format props
    - _Requirements: 2.8, 2.9, 2.10_

  - [x] 2.5 Create barrel export for UI primitives
    - Create `components/ui/index.ts` re-exporting all primitives
    - _Requirements: 2.1_


- [x] 3. Phase 1 - Tier-Gating System
  - [x] 3.1 Create plan capabilities constant and useCurrentPlan hook
    - Create `constants/plans.ts` with Plan type, Interval type, Channel type, PlanCapabilities interface, PLAN_CAPABILITIES record, PLAN_RANK record, and planAtLeast utility function
    - Create `hooks/useCurrentPlan.ts` that wraps existing `useSubscription` hook and derives plan, intervals, channels, pmSessionLimit, canCustomizePersona without new network calls
    - _Requirements: 3.1, 3.2, 3.3, 3.9, 3.10, 3.11, 3.12_

  - [x] 3.2 Create TierGate, LockOverlay, and UpgradePrompt components
    - Create `components/ui/TierGate.tsx` with plan, feature, showLocked (default true), upgradeHref props; three resolution branches (render children / lock overlay / nothing)
    - Create `components/ui/LockOverlay.tsx` with backdrop-blur, lock icon, feature name, and upgrade link
    - Create `components/ui/UpgradePrompt.tsx` with variants free-to-starter, starter-to-pro, pro-to-elite; banner styling matching mock-up
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.13_

  - [x] 3.3 Create navigation constants
    - Create `constants/navigation.ts` with APP_NAV_ITEMS array (Markets, Portfolio, PM, Insights, Plan, Settings) including requires field for tier-gated links
    - _Requirements: 4.4, 4.5_


- [x] 4. Phase 2 - App Shell, Navigation, and Middleware
  - [x] 4.1 Create AppShell and AppNav components
    - Create `components/shell/AppShell.tsx` composing AppNav + main content area + optional banner slot
    - Create `components/shell/AppNav.tsx` with sticky top bar (56px height, max-w 1200px), brand mark linking to /markets, primary nav links from constants/navigation.ts, right cluster (WalletBadge, CreditBadge, ThemeToggle, avatar)
    - Active link styling via usePathname()
    - Mobile (<768px): hamburger trigger with slide-down menu
    - Hide PM link when plan is free or starter via TierGate showLocked=false
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 19.4_

  - [x] 4.2 Create CreditBadge, WalletBadge, and ThemeToggle shell components
    - Create `components/shell/CreditBadge.tsx` reusing existing CreditBalance hook; show "∞ credits" for elite
    - Create `components/shell/WalletBadge.tsx` reading WalletProvider context; hover panel with total balance, committed capital (sum of active PM sessions), available
    - Create `components/shell/ThemeToggle.tsx` toggling data-theme on html, persisting to localStorage('tw-theme')
    - _Requirements: 4.10, 4.11, 4.12, 1.6_

  - [x] 4.3 Create MarketingShell and AuthShell components
    - Create `components/shell/MarketingShell.tsx` with transparent nav (blurs on scroll), hero area, footer
    - Create `components/shell/AuthShell.tsx` with centered 400px card, logo + tagline, footer note
    - Neither renders AppNav
    - _Requirements: 4.9_

  - [x] 4.4 Implement Auth Cookie Bridge in AuthProvider
    - Add side-effect to `providers/AuthProvider.tsx` that mirrors id token into non-HttpOnly `tw_id_token` cookie (Secure; SameSite=Lax; Path=/; Max-Age=token TTL) on setTokens
    - Clear cookie on clearTokens (sign-out, refresh failure)
    - Do NOT modify the public AuthProvider context shape or lib/cognito-auth.ts
    - _Requirements: 5.5, 5.6, 5.8, 5.11, 17.1, 17.3_

  - [x] 4.5 Implement routing middleware
    - Create `middleware.ts` in the frontend root
    - Redirect authenticated users from `/` to `/markets` (307)
    - Redirect unauthenticated users from protected routes to `/login?next=<path>` (307)
    - Public routes: `/`, `/login`, `/api/*`, static assets
    - Only check cookie presence and unexpired exp claim (no crypto validation)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_


- [x] 5. Phase 3a - Markets Feed Page
  - [x] 5.1 Create Markets feed page at /markets
    - Create `app/markets/page.tsx` inside AppShell
    - Page header with title + search bar (250ms debounce via useDebounce + useMarketSearch)
    - Category filter chips from usePoliticalCategories (client-side filtering)
    - UpgradePrompt for free users
    - Trending Now horizontal carousel (CSS scroll-snap)
    - Markets grid with MarketCard components
    - Sidebar (300px right column on ≥1024px) with Trending and AI Spotlight cards
    - Skeleton loading state, error card with Retry button
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 19.1_

  - [x] 5.2 Create MarketCard component
    - Create `components/markets/MarketCard.tsx` displaying thumbnail (next/image), title, category, volume, end date, ProbabilityBar, Buy YES / Buy NO buttons
    - TierGate plan=starter row for recurring analysis lock
    - Click navigates to /markets/[slug]
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 5.3 Add legacy redirect from /market/[slug] to /markets/[slug]
    - Create `app/market/[slug]/page.tsx` (or use next.config.ts redirects) returning 308 permanent redirect preserving slug
    - _Requirements: 6.10_


- [x] 6. Phase 3b - Market Detail Page
  - [x] 6.1 Create Market Detail page at /markets/[slug]
    - Create `app/markets/[slug]/page.tsx` inside AppShell
    - Breadcrumb, market header (image + title + stats)
    - Two-column layout: left (chart, order book, description, analysis history) + right (AI panel, sticky on ≥1024px)
    - Chart panel with usePriceHistory and time-range tabs (1H, 1D, 1W, 1M, ALL)
    - Order book panel (top 3 YES + 3 NO; collapsible on mobile)
    - _Requirements: 8.1, 8.2, 8.3, 19.2, 19.5_

  - [x] 6.2 Create AI Intelligence panel
    - Recommendation badge, quick-buy buttons, confidence meter, thesis section, edge visualization
    - Expandable sections: Agent Signals, Bull vs Bear Debate, Consensus, Position Sizing, Risk Factors, Key Catalysts
    - Source data from useMarketAnalysis, useAgentSignals, useTradeRecommendation
    - _Requirements: 8.7, 8.8_

  - [x] 6.3 Create Trade Execution section
    - Tabs for Buy YES / Buy NO, order-type buttons (Market / Limit)
    - Amount input, optional limit-price input, summary row (price, shares, max payout, potential profit)
    - Quick-buy scrolls to this section and pre-selects side
    - Submit invokes useClobOrder or useQuickTrade; render typed-error UI on failure
    - Mobile: pin to bottom of viewport with safe-area inset
    - _Requirements: 8.4, 8.5, 8.6, 19.6_

  - [x] 6.4 Create Analysis Modal with progress pipeline
    - "Get Analysis" / "Refresh Analysis" button opens modal
    - Eleven-stage progress pipeline driven by useAnalysisProgress
    - Each stage transitions pending → active → done
    - aria-live="polite" region for screen reader announcements
    - _Requirements: 8.9, 8.10, 18.4_

  - [x] 6.5 Create PM Activation card on market detail
    - TierGate plan=pro wrapping activation card
    - Investment amount input, invoke usePortfolioActivation on submit
    - Locked state with link to /account/subscription for non-pro users
    - _Requirements: 8.11, 8.12, 8.13_


- [x] 7. Phase 3c - Landing Page
  - [x] 7.1 Create Landing page at /
    - Replace `app/page.tsx` with the marketing landing inside MarketingShell
    - Hero section, How It Works pipeline (4 steps), Features grid (6 cards), Autonomous Trading section (3 cards), Pricing grid (4 plan cards from constants/plans.ts), CTA, footer
    - All CTAs link to /login
    - No authenticated API requests, no data hooks
    - Static server-rendered content
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 6.1_


- [x] 8. Phase 3d - Login Page
  - [x] 8.1 Rebuild Login page with AuthShell
    - Rewrite `app/login/page.tsx` inside AuthShell
    - Centered 400px card with brand mark, email input, Send Magic Link button, footer note
    - Sent-state with "Check your inbox" message and Resend Link button
    - On successful auth: navigate to ?next param if valid protected path, else /markets
    - Do NOT modify lib/cognito-auth.ts
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 5.9, 5.10_


- [x] 9. Phase 3e - Insights Page
  - [x] 9.1 Create Insights page at /insights
    - Create `app/insights/page.tsx` inside AppShell
    - Page header with title + "+ New Analysis" button
    - UpgradePrompt for free users
    - Two-column layout: left (running analyses, recent analyses with infinite scroll) + right sidebar (Credit Usage, Agent Accuracy, Upcoming Deliveries)
    - Running analyses: one card per in-flight analysis with 11-stage pipeline from useAnalysisProgress
    - Recent analyses: cards from useAnalysisResults with recommendation pill, edge, confidence, agent count, recurring badge, edge viz, 14-agent consensus row
    - Bull vs Bear expandable: full for non-free, preview + UpgradePrompt for free
    - Credit Usage card from useSubscription
    - Agent Accuracy card from useAgentSignals aggregate
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 6.4_


- [x] 10. Phase 3f - Portfolio Page and Legacy Redirects
  - [x] 10.1 Create Portfolio page at /portfolio
    - Create `app/portfolio/page.tsx` inside AppShell
    - Four-card summary row (Total Value, Unrealized P&L, Win Rate, AI Accuracy) from usePortfolioStats + usePerformanceData
    - Tabs: positions, history, closed (activate from ?tab query param)
    - Active Positions tab: PM summary card (TierGate plan=pro) + positions table from useUserPositions
    - Analysis History tab: from useAnalysisResults
    - Closed Trades tab: from useUserPositions with resolved filter
    - Performance chart at bottom from usePerformanceData
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 6.5_

  - [x] 10.2 Add legacy route redirects for folded pages
    - Add redirects for `/history` → `/portfolio?tab=history`, `/orders` → `/portfolio?tab=orders`, `/positions` → `/portfolio?tab=positions`, `/wallet` → `/portfolio?tab=wallet`, `/performance` → `/portfolio?tab=performance` (307)
    - Add redirect `/account/portfolio` → `/account/persona` (307)
    - _Requirements: 6.11, 6.12_


- [x] 11. Phase 3g - Portfolio Manager Dashboard
  - [x] 11.1 Create Portfolio Manager dashboard at /portfolio-manager
    - Create `app/portfolio-manager/page.tsx` inside AppShell
    - TierGate plan=pro wrapping entire page; locked state with UpgradePrompt for non-pro
    - Page header: title + persona badge + Kill Switch button
    - Stats bar: 4 MetricStats (Committed Capital, Unrealized P&L, Realized P&L, Active Sessions)
    - Sessions list: SessionCard per session from usePortfolioSessions with status badges (Watching, Positioned, Cooldown, Completed, Terminated)
    - SessionCard click toggles detail panel with Capital / Decision Log / Trade History tabs
    - Pause/Resume/Stop controls invoking usePortfolioActions
    - Kill Switch confirmation modal → kill-switch mutation → kill-active banner
    - Real-time updates via usePortfolioWebSocket
    - Do NOT add controls that bypass PM safety enforcement
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 6.6_


- [x] 12. Phase 3h - Persona Selection Page
  - [x] 12.1 Create Persona Selection page at /account/persona
    - Create `app/account/persona/page.tsx` inside AppShell
    - Six-card grid: Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider
    - Each card: persona icon, name, risk badge, philosophy paragraph, 3 stats (Frequency, Position size range, Hold duration)
    - Highlight current selection from usePersonaSettings
    - Click card updates local state; Save Persona button invokes usePersonaSettings mutation
    - Elite: Customize Parameters section with sliders (Exit Sensitivity, Monitoring Frequency, Sizing Aggression) from usePersonaParams
    - Non-elite: locked state with link to /account/subscription
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 6.7_


- [x] 13. Phase 3i - Subscription Page
  - [x] 13.1 Create Subscription page at /account/subscription
    - Create `app/account/subscription/page.tsx` inside AppShell
    - Current-plan summary card (plan name, description, credit balance, monthly allowance, usage bar) from useSubscription
    - Four plan cards (Free, Starter, Pro, Elite) with price, credits, features, action button (Upgrade/Downgrade/Current)
    - Upgrade invokes useChangePlan; downgrade opens confirmation modal then invokes useChangePlan
    - Credit packs section: two cards (pack_20: 20 credits/$9, pack_50: 50 credits/$19) invoking usePurchaseCredits
    - Billing history table from wallet-subscription hooks
    - Cancel subscription button → confirmation modal → useCancelSubscription
    - Do NOT modify on-chain USDC.e transfer flow
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 6.8_


- [x] 14. Phase 3j - Settings Page
  - [x] 14.1 Create Settings page at /account
    - Create `app/account/page.tsx` inside AppShell
    - Delivery Channels section: Toggle controls for In-app, Email, Push, Webhook from useNotificationPreferences; lock overlays per plan
    - Webhook URL input with Test button (validates HTTPS on backend)
    - Quiet Hours section: enable Toggle + From/To time inputs
    - Alert Thresholds section: probability-shift Toggle + slider (1-20%)
    - Trading Persona section: current persona display from usePersonaSettings + "Change Persona" link to /account/persona; locked for non-pro
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 6.9_


- [x] 15. Phase 4 - Tier-Aware Variants and Responsive Polish
  - [x] 15.1 Wire UpgradePrompt banners across all pages
    - Add UpgradePrompt (free-to-starter) on markets, market detail, insights, portfolio, settings pages when plan is free
    - Add UpgradePrompt (starter-to-pro) when plan is starter and page has pro+ features
    - Verify TierGate lock overlays render correctly on all gated regions
    - _Requirements: 3.7, 3.8_

  - [x] 15.2 Implement responsive breakpoints across all pages
    - ≥1024px: full grid layouts (sidebar 300px, AI panel 360px sticky)
    - 768-1023px: sidebar below grid, AI panel below chart
    - <768px: hamburger nav, single column, order book collapsed to top 3+3
    - <430px: tighter padding, 44px min tap targets
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_


- [x] 16. Phase 5 - Polish, Cleanup, and Testing
  - [x] 16.1 Create Tier Switcher dev tool
    - Create `components/Debug/TierSwitcher.tsx` rendering only when NODE_ENV !== 'production' AND localStorage('tw-debug') === '1'
    - Floating bottom-center pill overriding useCurrentPlan via context for the session
    - Persist choice in localStorage('tw-tier-override')
    - Tree-shaken from production builds
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [x] 16.2 Delete legacy page files
    - Remove old page files for `/history`, `/orders`, `/positions`, `/wallet`, `/performance` (keep only redirect handlers)
    - Remove old `/market/[slug]` page file (keep redirect)
    - Clean up unused components from old design (old Header, old Home components)
    - _Requirements: 22.7_

  - [x] 16.3 Accessibility audit pass
    - Verify contrast ratios ≥4.5:1 for body text, ≥3:1 for large text/UI in both themes
    - Verify focus-visible rings on all interactive elements
    - Verify color is not the only signal (text labels on YES/NO, status badges)
    - Add aria-labels on Buy YES, Buy NO, Kill Switch, Stop Session buttons
    - Add aria-hidden="true" on decorative pulse dots and gradient accents
    - Verify semantic HTML (nav, main, aside, section, proper heading nesting)
    - _Requirements: 18.1, 18.2, 18.3, 18.5, 18.6, 18.7_

  - [ ]* 16.4 Write property tests for tier-gating and plan capabilities
    - Install fast-check as devDependency
    - Property: TierGate resolution monotonicity (planAtLeast true → renders children; false → overlay or nothing)
    - Property: Capability monotonicity (higher plan includes all lower plan capabilities)
    - Property: ProbabilityBar fill width equals cents% (±0.5% rounding)
    - Property: Theme toggle round-trip (set → read → matches)
    - _Requirements: 3.4, 3.5, 3.6, 2.4_

  - [ ]* 16.5 Write plan capability drift-detection test
    - Load frontend PLAN_CAPABILITIES and backend constants (infra/services/shared/plans.ts, credits.ts, portfolio-types.ts, notification-preferences handler)
    - Assert frontend matches backend for intervals, channels, PM session limits, credit packs
    - _Requirements: 3.13_

  - [ ]* 16.6 Write UI primitive unit tests
    - Install @testing-library/react, vitest, jsdom as devDependencies
    - Card: render test for each variant
    - Button: render test for each variant + loading state
    - Modal: focus-trap test (Tab cycles), Escape closes
    - TierGate: three resolution branches for each plan rank
    - useCurrentPlan: mock useSubscription for all four plans
    - _Requirements: 2.1, 2.6, 2.7, 3.4, 3.5, 3.6_

  - [x] 16.7 Verify behavior preservation invariants
    - Confirm provider composition order unchanged in providers/index.tsx
    - Confirm lib/cognito-auth.ts, lib/websocket-client.ts, lib/api-client.ts, lib/magic.ts are unmodified (or only additive non-behavior-changing helpers)
    - Confirm no new authenticated API endpoints or hooks added beyond useCurrentPlan and useTheme
    - Run `npm run build` to verify TypeScript strict mode passes
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 22.1, 22.2, 22.3_


- [x] 17. Integration Verification - Page Interconnection
  - [x] 17.1 Verify all navigation flows and cross-page links
    - Walk every link in AppNav and confirm it resolves to the correct page (Markets, Portfolio, PM, Insights, Plan, Settings)
    - Verify brand mark navigates to /markets
    - Verify MarketCard click navigates to /markets/[slug]
    - Verify all UpgradePrompt CTAs link to /account/subscription
    - Verify all TierGate lock overlays link to /account/subscription
    - Verify "Change Persona" link on settings page navigates to /account/persona
    - Verify "+ New Analysis" button on insights page opens the analysis modal
    - Verify "Get Started" and all landing page CTAs navigate to /login
    - Verify post-login redirect honors ?next param and defaults to /markets
    - Verify all legacy redirects work: /market/[slug] → /markets/[slug] (308), /history → /portfolio?tab=history (307), /orders → /portfolio?tab=orders, /positions → /portfolio?tab=positions, /wallet → /portfolio?tab=wallet, /performance → /portfolio?tab=performance, /account/portfolio → /account/persona
    - Verify tab query param activates correct tab on /portfolio
    - Verify middleware redirects: authenticated user at / → /markets, unauthenticated user at /markets → /login?next=/markets
    - Run `npm run build` to confirm no broken imports or dead routes
    - _Requirements: 4.4, 4.7, 5.2, 5.3, 5.9, 5.10, 6.10, 6.11, 6.12, 7.5, 15.3, 22.4, 22.5, 22.6_

- [ ] 18. Integration Verification - Frontend-Backend Contract Lock
  - [x] 18.1 Verify all hook consumption matches backend API contracts
    - For each page, confirm every hook call passes parameters the backend expects and handles every response shape the backend returns
    - Confirm useMarkets, useMarketSearch, useMarketAnalysis, useAgentSignals, useTradeRecommendation, usePriceHistory, useAnalysisResults, useAnalysisProgress, useSubscription, useNotificationPreferences, usePortfolioSessions, usePortfolioSession, usePortfolioTrades, usePortfolioStats, usePortfolioActions, usePortfolioActivation, usePersonaSettings, usePersonaParams, useClobOrder, useQuickTrade, useUserPositions, usePerformanceData, usePolygonBalances all consume their existing return types without modification
    - Confirm no new API endpoints are called from any page
    - _Requirements: 17.2, 17.7, 17.8, 17.9_

  - [x] 18.2 Verify error handling surfaces backend errors correctly
    - Confirm InsufficientCreditsError (402) renders "Top up credits" CTA linking to /account/subscription#packs
    - Confirm PlanRestrictionError (403) renders UpgradePrompt matching the locked feature
    - Confirm NotFoundError (404) renders 404 card with link back to parent page
    - Confirm 401 from api-client clears tokens, clears tw_id_token cookie, redirects to /login
    - Confirm generic errors render Alert with error message and Retry button
    - _Requirements: 5.8, 17.5, 17.9_

  - [x] 18.3 Verify auth token flow end-to-end
    - Confirm AuthProvider writes tw_id_token cookie on login and clears it on logout/refresh-failure
    - Confirm middleware reads cookie and redirects correctly
    - Confirm api-client still injects Authorization: Bearer header on every request (not the cookie)
    - Confirm WebSocket connects with token as query parameter (unchanged)
    - Confirm backend Lambda authorizers are never bypassed by frontend routing
    - _Requirements: 5.5, 5.6, 5.8, 5.11, 5.12, 17.3, 17.4_

  - [x] 18.4 Verify tier-gating does not leak backend-gated features
    - For each plan (free, starter, pro, elite), confirm that UI-locked features cannot be triggered via direct URL manipulation or browser console
    - Confirm that even if TierGate is bypassed client-side, backend returns PlanRestrictionError (403) for unauthorized actions
    - Confirm PM activation, recurring analysis intervals, webhook config, and persona customization all fail gracefully when plan doesn't qualify
    - Confirm kill-switch, stop-loss, take-profit enforcement is never weakened by UI changes
    - _Requirements: 3.13, 11.13, 17.9, 17.10_

  - [x] 18.5 Run full build and type-check
    - Run `npm run build` in tradewizard-frontend/ - must pass with zero errors
    - Run `npm run lint` - must pass
    - Confirm no TypeScript errors related to hook return type mismatches
    - Confirm no unused imports or dead code from the migration
    - _Requirements: 17.1, 17.2, 22.1, 22.2, 22.3_

## Notes

- Tasks marked with `*` are optional property/unit tests that can be deferred for faster delivery
- Each task references specific requirement IDs for traceability
- The strangler sequence ensures each phase is independently shippable without breaking the live app
- All existing hooks (~52) are consumed unchanged - no hook signatures are modified
- Backend code (infra/, tradewizard-agents/) is completely frozen
- The only new hooks are `useCurrentPlan` (derives from useSubscription) and theme utilities
- Mock-up files in `docs/design/TradeWizard/` are the visual source of truth for each page

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["13.1"] },
    { "id": 13, "tasks": ["14.1"] },
    { "id": 14, "tasks": ["15.1", "15.2"] },
    { "id": 15, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7"] },
    { "id": 16, "tasks": ["17.1"] },
    { "id": 17, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5"] }
  ]
}
```
