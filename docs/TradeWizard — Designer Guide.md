# TradeWizard - Product Design Guide

> A reference document for the product designer to understand what TradeWizard is, who it serves, how it works, and what the UI/UX must communicate.

---

## 1. What Is TradeWizard?

TradeWizard is an AI-powered intelligence and autonomous trading platform for prediction markets. It sits on top of Polymarket (a regulated prediction market) and transforms raw market data into actionable trading recommendations through a multi-agent debate system - and can now execute those recommendations autonomously through the Portfolio Manager.

**The one-liner:** "The intelligence and execution layer for real-world prediction markets."

**The analogy:** Imagine a professional trading desk with analysts, forecasters, strategists, and risk managers - all operating 24/7 in their own secure offices, debating each other, browsing the web for research, and producing a single clear recommendation. Now imagine that same desk also has a portfolio manager who evaluates opportunities, reasons about risk in natural language, and executes trades for you while you sleep - but with a compliance officer (deterministic guardrails) who validates every decision before it goes through. That's TradeWizard.

**What it is NOT:**
- Not a market/exchange (Polymarket handles that)
- Not a wallet app (though it integrates wallet functionality)
- Not a news aggregator (though agents autonomously browse the web for research)
- Not a gambling platform (it's intelligence-driven, explainable, probability-based)
- Not a "set and forget" black box (full transparency into every autonomous decision)
- Not a rule-based bot (AI agents reason in natural language, not fixed if/then rules)

---

## 2. Who Are the Users?

### Primary Persona: The Informed Trader
- Politically engaged, data-curious
- Trades prediction markets but wants an edge
- Values explainability - wants to know *why* a trade makes sense
- Comfortable with probability thinking but not a quant
- Subscription-friendly, high engagement

### Secondary Persona: The Curious Newcomer
- Interested in politics/events, new to prediction markets
- Needs guidance and confidence before placing trades
- Attracted by the "AI analyst" value prop
- Converts from free tier after seeing quality of analysis

### Tertiary Persona: The Power User
- Active trader, multiple markets simultaneously
- Wants recurring analysis, real-time alerts, webhook integrations
- Cares about speed, density of information, and customization
- Likely on Pro or Elite plans

### Quaternary Persona: The Autonomous Trader
- Wants the AI to handle execution, not just analysis
- Trusts the system enough to let it trade on their behalf
- Values control through personas and risk guardrails rather than manual order entry
- Appreciates that the AI reasons in natural language (not opaque formulas) - can read *why* it made each decision
- Monitors a dashboard rather than placing individual trades
- Likely on Pro (3 markets) or Elite (10 markets) plans

---

## 3. Core Value Proposition (What the UI Must Communicate)

The platform must make users feel:

1. **Confident** - "I understand why this trade makes sense"
2. **Informed** - "I have more context than the average trader"
3. **Guided** - "I know what to do, when to do it, and how much to risk"
4. **In control** - "I make the final decision, the AI advises - or executes with my rules"
5. **Protected** - "Even when the AI trades for me, guardrails prevent catastrophic outcomes"

The UI should never feel like:
- A black box ("trust us, buy this")
- Overwhelming data dumps
- A gambling interface
- A generic chatbot
- An uncontrollable autonomous system

---

## 4. The Product Experience (Key User Flows)

### Flow 1: Market Discovery
```
User opens app
  → Sees curated list of live prediction markets
  → Each market shows: question, current probability, volume, expiry
  → Can search, filter by category (politics, economics, courts, etc.)
  → Taps a market to see detail
```

**Design intent:** Feel like browsing a curated intelligence feed, not a betting slip. Markets should feel like "questions about the future" not "bets."

---

### Flow 2: Market Detail & Intelligence
```
User views a specific market
  → Sees market fundamentals (probability, liquidity, expiry, resolution criteria)
  → Sees AI intelligence panel (if analysis exists):
    - Recommendation: LONG YES / LONG NO / NO TRADE
    - Edge vs market price
    - Key catalysts
    - Risk factors
    - Confidence level
  → "Get Analysis" button (if no recent analysis)
  → Can place trades directly from this view
```

**Design intent:** The intelligence panel is the hero. It should feel like reading a concise analyst note - not a wall of text. Progressive disclosure: summary first, details on demand.

---

### Flow 3: Requesting Analysis
```
User taps "Get Analysis"
  → Modal/sheet appears:
    - One-time analysis (single execution)
    - Recurring analysis (1h, 4h, 12h, 1d intervals)
  → Shows credit cost (always 1 credit per delivery)
  → Shows current credit balance
  → User confirms
  → Loading state while analysis runs (typically 30-90 seconds)
  → Result delivered via push/in-app notification
  → User views full analysis detail
```

**Design intent:** This is the core monetization moment. It should feel premium and intentional - like commissioning a research report, not clicking a random button. The credit cost should be visible but not anxiety-inducing.

---

### Flow 4: Analysis Result (The Crown Jewel)
```
User receives analysis result
  → Summary card: action (BUY YES/NO), edge, EV, confidence
  → Expandable sections:
    1. Core Thesis - why this trade makes sense (2-3 sentences)
    2. Agent Signals - what each AI agent found (direction, confidence, key drivers)
    3. Bull vs Bear Debate - competing theses with cross-examination scores
    4. Consensus - final probability, disagreement level, confidence band
    5. Position Sizing - aggressive/conservative/neutral perspectives
    6. Risk Factors - what could go wrong, failure scenarios
    7. Key Catalysts - upcoming events that could move the market
```

**Design intent:** This is where TradeWizard's value is most visible. The analysis must feel:
- **Structured** - clear hierarchy, scannable
- **Explainable** - every claim has reasoning behind it
- **Actionable** - the user knows exactly what to do
- **Trustworthy** - shows the work, not just the conclusion

The "debate" aspect is a differentiator. Showing that agents disagreed, challenged each other, and arrived at a consensus builds trust. It's not one AI guessing - it's a committee deliberating.

---

### Flow 5: Trading Execution
```
User decides to act on recommendation
  → Sees entry zone, target, stop-loss
  → Adjusts position size (guided by risk philosophy)
  → Places order (limit or market)
  → Sees confirmation
  → Position appears in portfolio
```

**Design intent:** Execution should be frictionless once the decision is made. The analysis view should flow naturally into the trade view. Don't make users context-switch.

**Alternative path (Pro/Elite):** If the user has a Portfolio Manager active on this market, the analysis result is consumed automatically - no manual execution needed. The market page should show "Portfolio Manager will evaluate this analysis" to reinforce that the autonomous system is handling it.

---

### Flow 6: Portfolio & Performance
```
User views their positions
  → Active positions with P&L (manual + autonomous)
  → Historical trades with outcomes
  → Performance metrics (win rate, ROI, etc.)
  → Analysis history (past recommendations and their accuracy)
  → Portfolio Manager sessions (if active) with autonomous trade history
```

**Design intent:** Reinforce confidence through transparency. Show that the AI's recommendations have a track record. This drives retention and upgrades. Manual trades and autonomous trades should be visually distinguishable (e.g., a "🤖" badge on PM-managed positions) but live in the same portfolio view.

---

### Flow 7: Subscription & Credits
```
User manages their plan
  → Current plan + credit balance (always visible in header/nav)
  → Plan comparison (Free → Starter → Pro → Elite)
  → Credit pack purchases (top-up without changing plan)
  → Billing history
  → Cancel/downgrade flow
```

**Design intent:** Credits should feel like a resource you spend wisely, not a paywall that blocks you. The free tier should give enough value to demonstrate quality. Upgrades should feel like unlocking more power, not removing restrictions.

---

### Flow 8: Authentication (Magic Link)
```
User signs up / logs in
  → Enters email
  → Receives magic link (no password)
  → Clicks link → authenticated
  → Lands on markets page
```

**Design intent:** Zero friction. No passwords, no complexity. The auth flow should feel invisible - get users to value as fast as possible.

---

### Flow 9: Notifications & Delivery Settings
```
User configures how they receive analysis
  → Toggle channels: in-app, email, push, webhook
  → Set quiet hours (don't disturb between X and Y)
  → Set probability shift threshold (only notify on significant changes)
  → Webhook URL for programmatic delivery (Pro+)
```

**Design intent:** Power users want control over delivery. This should feel like configuring a professional alert system, not a notification spam panel.

---

### Flow 10: Portfolio Manager - Persona Selection (Account Settings)
```
User navigates to Account Settings → Trading Persona
  → Sees 6 persona cards with visual identity:
    - The Sniper (aggressive, high-conviction, rare trades)
    - The Scalper (moderate, rapid small-edge exploitation)
    - The Contrarian (aggressive, fades crowd consensus)
    - The Catalyst Hunter (moderate, event-driven positioning)
    - The Hedge Architect (conservative, multi-position spreads)
    - The Momentum Rider (aggressive, trend-following with pyramiding)
  → Each card shows: risk level badge, entry philosophy, monitoring style, exit behavior
  → User selects one persona (applies to ALL future market activations)
  → Default selection: The Scalper (if user hasn't chosen yet)
  → Elite users can customize parameters:
    - Exit sensitivity (1-5 scale)
    - Monitoring frequency (5-60 min)
    - Position sizing aggressiveness (0.5x-2.0x)
  → Pro users see default parameters (read-only)
```

**Design intent:** This is a personality quiz meets trading strategy selection. Each persona should feel like a distinct character with a clear philosophy - not a configuration panel. Users should identify with their persona. The selection should feel like choosing a playstyle, not filling out a form.

**Visual concept:** Each persona as a character card with:
- An icon/avatar that embodies the strategy (crosshair for Sniper, lightning for Scalper, etc.)
- Risk level badge (Conservative / Moderate / Aggressive) with color coding
- 2-3 sentence philosophy statement
- Key stats: typical trade frequency, position size range, hold duration

---

### Flow 11: Portfolio Manager - Activation
```
User views a market with active recurring analysis
  → Sees "Activate Portfolio Manager" button (Pro/Elite only)
  → Taps button → Activation modal appears:
    - Investment Amount input (USDC.e, min $5, max = wallet balance)
    - Shows active persona name + risk level
    - Shows wallet balance
    - Shows current active session count vs limit (e.g., "2/3 active" for Pro)
    - Prerequisite check: ✓ Recurring analysis active (or ✗ with setup prompt)
  → User confirms
  → Session created → Portfolio Manager begins watching for analysis results
  → Market page now shows "Portfolio Manager Active" badge with status
```

**Design intent:** Activation should feel like deploying a specialist to a mission. The investment amount is the "budget" you're giving your AI trader. The prerequisite check (recurring analysis required) should feel logical - "the manager needs intelligence to act on." Show the persona prominently so users remember what strategy governs this market.

**Gating visibility:** Free/Starter users should see the "Activate Portfolio Manager" button in a disabled/locked state with a clear upgrade prompt. This drives conversion by showing what's possible.

---

### Flow 12: Portfolio Manager - Dashboard
```
User navigates to Portfolio Manager dashboard
  → Sees aggregate stats bar: total invested, total unrealized P&L, total realized P&L, active sessions count
  → Sees list of all sessions, each showing:
    - Market name + current probability
    - Status badge (Analyzing / Positioned / Watching / Exiting / Paused)
    - Persona name + icon
    - Investment utilization (% in positions vs available)
    - Unrealized P&L (color-coded green/red)
    - Realized P&L (cumulative)
  → Global Kill Switch button (prominent, red, requires confirmation)
  → Taps a session → Session detail view:
    - Capital breakdown: in positions / in pending orders / available / realized P&L
    - Current position (if any): direction, entry price, current price, unrealized P&L
    - Trade history (paginated): entries, exits, P&L per trade, reasoning
    - Decision log: what the manager decided on each analysis cycle and why
    - Controls: Pause / Resume / Stop / Adjust Investment
  → All data updates in real-time via WebSocket
```

**Design intent:** This is the "mission control" view. It should feel like monitoring a fleet of autonomous agents working on your behalf. The key tension to resolve: users need to feel in control without being overwhelmed by every micro-decision. The status badges and P&L colors provide at-a-glance health. The detail view provides full transparency for those who want it.

**Critical UX elements:**
- **Kill Switch** - must be visually prominent and unmistakable. This is the emergency brake. Red, always visible, requires confirmation ("Exit ALL positions across ALL markets?")
- **Session status** - clear state machine visualization. Users should instantly know if their manager is actively trading, watching for opportunity, or paused.
- **P&L display** - real-time, color-coded, both per-session and aggregate. This is the primary feedback loop.
- **Decision reasoning** - every "no action" decision should be explainable. Users should see "Skipped: edge only 4%, Sniper requires >10%" - this builds trust that the system is disciplined.

---

### Flow 13: Portfolio Manager - Risk Alerts & Kill Switch
```
Session hits 30% loss threshold
  → Warning notification: "Session approaching loss limit (30% of investment lost)"
  → Dashboard shows amber warning badge on session
  → Position sizing automatically reduced by 50% for subsequent trades

Session hits 45% loss threshold
  → Critical notification: "Emergency exit triggered - session loss limit reached"
  → All positions exited at market price
  → Session terminated

Global portfolio hits 40% total loss
  → Kill Switch auto-triggered
  → ALL sessions terminated, ALL positions exited
  → Notification on ALL channels (overrides quiet hours)
  → Dashboard shows Kill Switch active state
  → User must manually reset Kill Switch to re-enable trading
```

**Design intent:** Risk controls should feel like a safety net, not a punishment. The progressive escalation (warning → reduction → exit) gives users time to react. The Kill Switch should feel like pulling a fire alarm - dramatic, intentional, and reassuring that it exists. After triggering, the "reset" action should require deliberate re-engagement.

---

### Flow 14: Portfolio Manager - Notifications
```
Every autonomous action generates a notification:
  → Trade placed: "🎯 Sniper entered YES on [Market] - $50 at 0.42 (edge: 12%)"
  → Position exited: "📤 Exited [Market] - +$8.50 profit (regime shift detected)"
  → Risk warning: "⚠️ [Market] session at 30% loss - position sizing reduced"
  → Kill Switch: "🚨 KILL SWITCH TRIGGERED - all positions exited"
  → Daily summary: "📊 Daily Report: 3 sessions active, +$24 realized today"
```

**Design intent:** Every notification should answer "what happened, why, and what's the impact?" in one glance. The user should never wonder what their autonomous manager is doing. Notifications are the trust bridge between "I'm not watching" and "I know what's happening."

---

## 5. The Multi-Agent Debate System (What to Visualize)

This is TradeWizard's intellectual core and biggest design opportunity. The system runs on Nebius Token Factory - each analysis spawns a fleet of AI agents that autonomously browse the web, reason about markets, and debate each other using the Strands SDK framework. The system works in 11 stages:

### Simplified Mental Model for Users

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   📊 GATHER          Up to 14 AI agents research the   │
│                      market from different angles       │
│         ↓                                              │
│   ⚖️  DEBATE          Agents argue bull vs bear case,  │
│                      challenge each other's logic       │
│         ↓                                              │
│   🎯 CONSENSUS       System calculates probability,    │
│                      detects disagreement, builds       │
│                      confidence level                   │
│         ↓                                              │
│   💡 RECOMMEND       Final action with entry/exit,     │
│                      position sizing, risk guidance     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Agent Categories (for visual grouping)

| Category | Agents | What They Do |
|----------|--------|--------------|
| Market Structure | Market Microstructure, Probability Baseline | Order books, liquidity, base probability |
| Event Intelligence | Breaking News, Event Impact | Real-time news, event repricing |
| Polling & Stats | Polling Intelligence, Historical Pattern | Polls, demographics, past outcomes |
| Sentiment | Media Sentiment, Social Sentiment, Narrative Velocity | News tone, social buzz, story spread |
| Price Action | Momentum, Mean Reversion | Technical patterns, overreaction detection |
| Event Scenarios | Catalyst, Tail Risk | Upcoming events, surprise risk |
| Risk Philosophy | Aggressive, Conservative, Neutral | Position sizing perspectives |

### What to Show Users About the Debate

- **Agent agreement/disagreement** - a visual indicator of how aligned agents are (high alignment = high confidence)
- **Individual agent signals** - direction (YES/NO/NEUTRAL), confidence level, key reasoning
- **Cross-examination results** - which thesis survived scrutiny, which was weakened
- **Consensus probability vs market price** - the "edge" visualization
- **When consensus fails** - the system honestly says "too much uncertainty to recommend" (this builds trust)

---

## 6. Information Hierarchy & Density

### Level 1: Glanceable (Cards, Lists, Headers)
- Market name + current probability
- Recommendation badge (BUY YES / BUY NO / NO TRADE)
- Credit balance
- Edge percentage
- Portfolio Manager: session status badge + unrealized P&L

### Level 2: Scannable (Market Detail, Analysis Summary, PM Dashboard)
- Core thesis (2-3 sentences)
- Entry/target/stop zones
- Key catalysts list
- Confidence indicator
- Agent agreement visualization
- Portfolio Manager: capital utilization bar, last decision summary, session controls

### Level 3: Deep Dive (Full Analysis, Agent Details, PM Session Detail)
- Individual agent signals with reasoning
- Bull vs bear thesis full text
- Cross-examination scores per test
- Risk philosophy breakdowns
- Historical accuracy of agents on this market type
- Portfolio Manager: full decision log with AI reasoning, trade history, conviction scores, guardrail interventions

**Design principle:** Most users live at Level 1-2. Power users drill into Level 3. The UI should make Level 1-2 feel complete on its own, with Level 3 as optional depth.

---

## 7. Key Design Principles

### 1. Intelligence-First Interface
The AI analysis is the primary content, not an add-on sidebar. Markets without analysis should feel incomplete - nudging users toward requesting one.

### 2. Explainability as Trust
Every number, every recommendation has a "why" behind it. The UI should make it easy to trace from conclusion → reasoning → data. This is what separates TradeWizard from "AI says buy."

### 3. Professional but Accessible
The aesthetic should feel like a Bloomberg terminal crossed with a modern fintech app. Dense enough for power users, clean enough for newcomers. Think: Robinhood's simplicity meets Bloomberg's depth.

### 4. Confidence Through Transparency
Show when the system is uncertain. Show when agents disagree. Show when it refuses to recommend. This honesty builds more trust than always having an answer.

### 5. Progressive Disclosure
Don't overwhelm. Summary → Detail → Deep Dive. Each level should feel satisfying on its own.

### 6. Real-Time Feel
Analysis delivery, price updates, and notifications should feel instant. Loading states should communicate progress ("Agents researching..." → "Debating theses..." → "Building consensus...").

### 7. Credit Economy Awareness
Users should always know their credit balance and what things cost. But it should feel empowering ("I'm spending a credit to get professional-grade analysis") not restrictive.

---

## 8. Subscription Tiers & Feature Gating

| Feature | Free | Starter ($19/mo) | Pro ($49/mo) | Elite ($149/mo) |
|---------|------|-------------------|--------------|-----------------|
| Credits/month | 5 | 50 | 200 | Unlimited |
| Analysis type | One-time only | One-time + daily | All intervals | All intervals |
| Notifications | In-app only | In-app + email + push | All channels | All channels |
| Webhook delivery | ✗ | ✗ | ✓ | ✓ |
| Credit packs | ✓ | ✓ | ✓ | ✓ |
| Portfolio Manager | ✗ | ✗ | ✓ (3 markets) | ✓ (10 markets) |
| Persona customization | ✗ | ✗ | ✗ (defaults only) | ✓ (full tuning) |

**Design implication:** Gated features should be visible but clearly marked as requiring an upgrade. Don't hide them - show users what they're missing to drive conversion. The Portfolio Manager is the strongest upgrade driver from Starter → Pro, and persona customization drives Pro → Elite.

---

## 9. Emotional Design Goals

| Moment | User Should Feel |
|--------|-----------------|
| First visit | "This is serious, professional, and different from other trading apps" |
| Reading an analysis | "I understand this market better than 95% of traders now" |
| Placing a trade | "I'm making an informed decision backed by real analysis" |
| Receiving a notification | "My AI team is watching the market for me" |
| Viewing performance | "This system actually works - my decisions are improving" |
| Hitting credit limit | "I want more of this - worth upgrading" |
| System says NO TRADE | "I trust this - it's honest, not just trying to make me trade" |
| Selecting a persona | "This matches how I think about risk - it gets me" |
| Activating Portfolio Manager | "I'm deploying my own AI trader - this is the future" |
| Watching autonomous trades | "It's doing exactly what I would do, but faster and 24/7" |
| Seeing a skipped opportunity | "Good - it's disciplined, not reckless" |
| Reading AI reasoning in decision log | "I can follow its logic - it thinks like a real trader" |
| Seeing a guardrail rejection | "The safety system caught that - I'm protected even from the AI's overconfidence" |
| Kill Switch exists | "I have an emergency brake - I'm safe even if things go wrong" |
| Daily summary arrives | "My portfolio is being managed while I live my life" |
| Manager exits at a loss | "It cut losses quickly - better than I would have" |
| Seeing conviction score | "It's honest about how sure it is - high conviction = strong signal" |

---

## 10. Visual & Interaction Concepts to Explore

### The "Debate" Visualization
- Agents as nodes in a network, with connections showing agreement/disagreement
- Bull vs Bear as two sides of a scale, with cross-examination tipping it
- A "confidence meter" that fills as agents align
- Timeline showing how the analysis progressed through stages

### The "Edge" Visualization
- Market price vs TradeWizard's consensus as two points on a probability bar
- The gap between them is the "edge" - make this visually prominent
- Color-code: green when edge favors action, amber when marginal, red when no trade

### Agent Signals
- Each agent as a card/chip with direction arrow + confidence bar
- Group by category with visual clustering
- Highlight disagreements (agents pointing different directions)

### Analysis Progress (Loading State)
- Show the 11 stages as a pipeline
- Animate progress through stages as analysis runs
- "Deploying agents to secure environment..." → "Browsing the web for context..." → "14 agents analyzing..." → "Debating theses..." → "Reaching consensus..."
- This turns a wait into engagement
- The "secure environment" framing reinforces that agents run in isolated microVMs (trust signal)

### Credit Balance
- Always visible, like a fuel gauge
- Subtle animation when a credit is spent
- Clear "top up" affordance when running low

### Portfolio Manager Dashboard
- Session cards as "mission tiles" - each market is a mission your AI is running
- Status as a state machine visualization: Watching → Analyzing → Positioned → Exiting → Watching (cycle)
- Capital utilization as a stacked bar: green (available), blue (in positions), amber (in pending orders)
- P&L as a running ticker with color transitions (neutral → green on profit, neutral → red on loss)
- Kill Switch as a physical-feeling button - large, red, with a "lift cover" confirmation pattern
- Trade history as a timeline with entry/exit pairs connected by lines showing hold duration and P&L
- Decision log entries with expandable AI reasoning (truncated preview → full 500+ char explanation)
- Conviction score as a subtle meter/badge on each decision (0.0 = uncertain, 1.0 = highly convicted)
- Guardrail interventions marked with a distinct "safety" icon (shield/lock) - not an error state

### Persona Selection
- Each persona as a character card with distinct visual identity
- Risk level as a color spectrum: green (conservative) → amber (moderate) → red (aggressive)
- Selection feels like choosing a character in a game - personality-driven, not config-driven
- Active persona shown as a small badge/avatar throughout the app (header, dashboard, market pages)
- Elite customization as "tuning dials" - sliders with clear min/max labels

### Autonomous Trade Notifications
- Entry notifications with a "deployed" feeling - like sending a unit into action
- Exit notifications with clear outcome: profit (green checkmark) or loss (red X) + amount
- Risk warnings with escalating urgency: amber background → red background → full-screen alert
- Daily summaries as a "morning briefing" card - scannable, positive framing even on flat days

---

## 11. Competitive Positioning (What Makes Us Different)

| Competitor | What They Offer | What TradeWizard Adds |
|------------|----------------|----------------------|
| Polymarket (raw) | Markets + execution | Intelligence layer, explainable recommendations, autonomous execution |
| Generic AI chatbots | One-shot answers | Multi-agent debate in isolated microVMs, structured analysis, memory, autonomous trading |
| Trading signal services | "Buy X" alerts | Full reasoning chain, risk philosophy, transparency, auto-execution |
| Bloomberg Terminal | Professional data | AI-native, retail-accessible, prediction-market-specific |
| Copy-trading platforms | Follow other traders | AI-driven personas with natural language reasoning, transparent decision logs, risk guardrails |
| Trading bots | Rule-based automation | Intelligence-driven (14-agent debate), persona-based AI reasoning (not if/then rules), explainable decisions with conviction scores |

**The positioning:** TradeWizard is the first platform where AI doesn't just give you an answer - it shows you the debate that produced it, and can execute the conclusion autonomously with full transparency into every decision. The Portfolio Manager reasons like a human trader (in natural language, with self-assessed conviction) but is held accountable by deterministic safety guardrails that no amount of AI confidence can override.

---

## 12. Technical Constraints for Design

- **Analysis takes 30-90 seconds** - design for async delivery, not instant response. Agents run on Nebius Token Factory, browsing the web and reasoning autonomously.
- **WebSocket for real-time** - results appear as push notifications / live updates
- **Mobile-first consideration** - many users will check on mobile
- **Dark mode expected** - trading/finance users strongly prefer dark interfaces
- **Data density varies** - some markets have rich analysis (14 agents), others are simpler (3 agents)
- **Passwordless auth** - no password fields, just email + magic link
- **Credit system** - every analysis costs 1 credit regardless of complexity
- **Portfolio Manager uses hybrid architecture** - an AI agent reasons about opportunities in natural language (persona-specific), then deterministic guardrails validate every decision before execution. The agent is read-only and never touches the trading API directly.
- **Portfolio Manager is event-driven** - trades happen when analysis arrives (not continuously), so status can be "watching" for hours between actions
- **Position monitoring runs every 5-30 minutes** - depending on persona, so P&L updates are near-real-time but not tick-by-tick
- **Kill Switch is atomic** - stored in DynamoDB, checked before AND after agent reasoning. Propagation takes up to 30 seconds for 10 sessions; design loading/confirmation states accordingly.
- **Session limits are plan-gated** - Pro: 3 concurrent, Elite: 10 concurrent. Show count clearly.
- **Persona is global** - one persona governs all markets. Changing persona only affects future activations, not active sessions.
- **Recurring analysis is a prerequisite** - Portfolio Manager cannot be activated without it. Design the activation flow to handle this dependency gracefully.
- **Conviction is AI-generated** - the Portfolio Manager agent self-assesses its conviction (0-1) using natural language reasoning, not a fixed formula. This makes the decision log more human-readable and explainable.
- **Agent decisions can be rejected** - if the AI proposes a trade that violates hard limits (position too large, capital conservation broken), the system rejects it silently and logs the reason. The decision log should show these rejections transparently.

---

## 13. Summary: The Design Challenge

TradeWizard's design challenge is making a complex multi-agent AI system feel simple, trustworthy, and actionable to everyday traders - whether they're reading analysis or letting the AI trade autonomously on their behalf.

The UI must:
1. Make intelligence the hero (not charts, not order books)
2. Build trust through transparency and explainability
3. Guide users from curiosity → understanding → action → confidence
4. Scale from "5 free analyses" to "unlimited power user with autonomous trading" without feeling different
5. Make the debate/consensus process visible and engaging, not hidden
6. Feel premium enough to justify $19-149/month subscriptions
7. Make autonomous trading feel safe, transparent, and controllable - not scary
8. Present the Portfolio Manager as a natural evolution: analysis → recommendation → execution
9. Balance information density (power users want every decision logged) with simplicity (casual users want P&L and status)
10. Make risk controls feel empowering ("I have guardrails") not restrictive ("the system won't let me")
11. Communicate the hybrid architecture naturally - AI reasoning + deterministic safety - without requiring users to understand the technical split
12. Make AI-generated conviction scores and natural language reasoning feel like reading a human analyst's notes, not a machine's output

**The north star:** When a user activates a Portfolio Manager, they should feel like they just hired a disciplined, transparent, tireless trading specialist who reasons about every opportunity, explains every decision in plain language, reports back to them - and who they can fire with one button press. The safety guardrails should feel like the compliance department that keeps even the best trader honest.

---

## 14. The Portfolio Manager - Design Deep Dive

### The Core UX Tension

The Portfolio Manager introduces a fundamental tension: **autonomy vs control**. Users want the system to trade for them (that's the value), but they also want to feel in control (that's the trust). The design must resolve this by making every autonomous action visible, explainable, and overridable.

**Resolution strategy:** The system uses a hybrid architecture - an AI agent reasons about opportunities in natural language (like a human analyst writing a memo), then deterministic guardrails validate every decision before execution. The agent is read-only and can never touch the trading API directly. This means:
- The AI can be creative, nuanced, and persona-specific in its reasoning
- But hard limits (position size ≤ 50%, capital conservation, minimum $5) are enforced by code, not by the AI's judgment
- Every trade, every skip, every risk decision is logged and notified
- The user is never surprised

**What this means for design:** The decision log should show BOTH the AI's reasoning ("Edge 12%, strong alignment, entering with 30% conviction") AND any guardrail interventions ("Rejected: proposed size exceeded 50% cap → reduced to 50%"). This dual-layer transparency builds trust in both the AI's intelligence and the system's safety.

### Persona as Identity

The 6 personas are not just configuration - they're identity. Users should feel an emotional connection to their chosen persona.

| Persona | Archetype | Visual Tone | Key Emotion |
|---------|-----------|-------------|-------------|
| The Sniper | Patient assassin | Precise, minimal, dark | "I only strike when I'm certain" |
| The Scalper | Speed demon | Fast, electric, dynamic | "I'm always moving, always earning" |
| The Contrarian | Rebel thinker | Bold, contrasting, unconventional | "I see what others miss" |
| The Catalyst Hunter | Event detective | Alert, time-sensitive, focused | "I'm positioned before the crowd reacts" |
| The Hedge Architect | Chess master | Structured, balanced, methodical | "I build positions, not bets" |
| The Momentum Rider | Wave surfer | Flowing, directional, energetic | "I ride the trend until it breaks" |

### Dashboard Information Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PORTFOLIO MANAGER                                    [🚨 KILL] │
├─────────────────────────────────────────────────────────────────┤
│  Total Invested: $450    Unrealized: +$23    Realized: +$67     │
│  Active Sessions: 3/3                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🎯 "Will Trump win 2024?"          [POSITIONED]         │   │
│  │ Sniper • $150 invested • 33% utilized                   │   │
│  │ LONG YES @ 0.42 → now 0.48         +$9.50 unrealized    │   │
│  │ [Pause] [Stop] [Details →]                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🎯 "Fed rate cut by March?"        [WATCHING]           │   │
│  │ Sniper • $200 invested • 0% utilized                    │   │
│  │ No position - waiting for edge > 10%                    │   │
│  │ Last decision: "Edge 7%, below threshold" (2h ago)      │   │
│  │ [Pause] [Stop] [Details →]                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚡ "Bitcoin > $100k by June?"       [ANALYZING]          │   │
│  │ Sniper • $100 invested • 45% utilized                   │   │
│  │ LONG YES @ 0.35 → now 0.33         -$2.10 unrealized    │   │
│  │ New analysis arriving... evaluating exit criteria        │   │
│  │ [Pause] [Stop] [Details →]                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Session Status States

| Status | Visual | Meaning |
|--------|--------|---------|
| Watching | 👁️ Neutral/grey | Has capital, waiting for entry criteria to be met |
| Analyzing | 🔄 Blue/pulsing | New analysis arrived, evaluating decision |
| Positioned | 🎯 Green/active | Holding a position, Position Guard monitoring |
| Exiting | ⚡ Amber/urgent | Exit triggered, orders being placed |
| Paused | ⏸️ Muted/dimmed | User paused, or recurring analysis cancelled - no new trades, existing positions monitored |
| Cooldown | 🕐 Muted/ticking | Recently exited at a loss - 30-minute re-entry block active |
| Completed | ✓ Settled/grey | Market resolved or user stopped - final P&L shown |
| Terminated | ✗ Red/final | Kill switch, risk limit, or subscription downgrade - session ended |

**Note on backend vs UI states:** The backend tracks 5 states (active, paused, exiting, completed, terminated). The UI splits "active" into sub-states (Watching, Analyzing, Positioned, Cooldown) for clarity. The designer should map these appropriately.

### The Decision Log (Trust Builder)

The decision log is the single most important trust-building element of the Portfolio Manager. It shows users that the AI is disciplined, rational, and transparent. Each entry includes the AI agent's natural language reasoning and self-assessed conviction score.

```
┌─────────────────────────────────────────────────────────────────┐
│  DECISION LOG - "Will Trump win 2024?"                          │
├─────────────────────────────────────────────────────────────────┤
│  Today 14:30  │ SKIP     │ "Edge 7% but alignment weak (0.6).  │
│               │          │  Sniper requires >10% with strong    │
│               │          │  alignment. Waiting." (conviction: 0.3)│
│  Today 10:30  │ HOLD     │ "Position +$4.20, momentum intact.  │
│               │          │  No regime shift detected. Holding." │
│               │          │  (conviction: 0.8)                   │
│  Yesterday    │ ENTER    │ "Edge 12%, alignment 0.85, catalyst  │
│               │          │  approaching. Entering $50 limit."   │
│               │          │  (conviction: 0.9)                   │
│  2 days ago   │ SKIP     │ "Edge 5%, insufficient for Sniper   │
│               │          │  threshold. Market too quiet."       │
│               │          │  (conviction: 0.2)                   │
│  3 days ago   │ SKIP     │ "Consensus failed (disagreement 35%)│
│               │          │  - no reliable signal to act on."    │
│               │          │  (conviction: 0.1)                   │
│  4 days ago   │ REJECTED │ "Agent proposed 60% allocation but   │
│               │          │  guardrail capped at 50%. No trade." │
│               │          │  ⚠️ Safety gate intervention          │
└─────────────────────────────────────────────────────────────────┘
```

Key design elements:
- Every "SKIP" entry builds trust - it shows the system is selective, not trigger-happy
- **Conviction scores** are AI-generated (the agent self-assesses how confident it is), displayed as a subtle 0-1 indicator
- **REJECTED** entries (guardrail interventions) should be visually distinct - they show the safety system working
- Natural language reasoning makes the log readable by non-technical users
- The reasoning is 500+ characters from the AI - show a truncated preview with "expand" for full text

### Kill Switch Design

The Kill Switch deserves special design attention. It's the ultimate safety control.

**Visual requirements:**
- Always visible on the Portfolio Manager dashboard (not buried in a menu)
- Red color, distinct from all other UI elements
- Two-step confirmation: "Exit ALL positions across ALL markets? This cannot be undone."
- After triggering: dashboard shows "KILL SWITCH ACTIVE" state with a "Reset" button
- Reset requires deliberate action (not accidental tap)

**After Kill Switch triggers:**
- All session cards show "Terminated" state
- Final P&L for each session displayed
- Clear message: "All autonomous trading halted. Reset Kill Switch to re-enable."

### Investment Amount Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│  CAPITAL ALLOCATION - $150 invested                             │
├─────────────────────────────────────────────────────────────────┤
│  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ▲ In positions: $50 (33%)                                      │
│  ░ In pending orders: $0 (0%)                                   │
│  ▒ Available: $100 (67%)                                        │
│  Realized P&L: +$12.50                                          │
│                                                                 │
│  [+ Add Funds]  [- Withdraw Available]                          │
└─────────────────────────────────────────────────────────────────┘
```

### Risk Escalation Visual Language

| Level | Trigger | Visual Treatment |
|-------|---------|-----------------|
| Normal | Loss < 30% | Standard P&L display |
| Warning | Loss hits 30% | Amber badge, position sizing reduced by 50%, "⚠️ Reduced sizing" indicator |
| Critical | Loss hits 45% | Red badge, "Emergency exit in progress", session terminating |
| Kill Switch | Total portfolio loss 40% | Full-screen alert, all sessions terminated |

### Edge Cases the Designer Must Handle

| Scenario | What to Show |
|----------|-------------|
| Recurring analysis cancelled | Session auto-pauses. Show: "⏸️ Paused - recurring analysis required. [Set up analysis →]" |
| Subscription downgrade (Pro/Elite → lower) | 24-hour grace period. Show countdown: "Sessions will close in 23h. Upgrade to keep trading." |
| 30-minute cooldown after loss | Show: "🕐 Cooldown (28 min remaining) - waiting before re-entry after loss" |
| Market resolves while positioned | Show: "✓ Market resolved: [outcome]. Redemption: +$X. Session complete." |
| API failure (Polymarket down) | Show: "⚠️ Trading paused - exchange unavailable. Monitoring continues." |
| Wallet balance insufficient at activation | Reject with: "Insufficient balance. You have $X, minimum is $5." |
| No recurring analysis at activation | Reject with: "Portfolio Manager requires recurring analysis. [Set up now →]" |
| Session limit reached | Reject with: "3/3 sessions active (Pro limit). Stop a session or upgrade to Elite (10 markets)." |
| Agent decision rejected by guardrails | Show in decision log: "⚠️ Proposed trade rejected - [reason]. No order placed." This is a safety feature, not an error. |
| Agent reasoning timeout | Show: "⏳ Agent reasoning took too long - skipping this cycle. Will retry on next analysis." |
| Kill switch activated during agent reasoning | Show: "🚨 Kill Switch activated - agent decision discarded, all positions exiting." |

---

## 15. Design Principles - Portfolio Manager Specific

### 1. Autonomy with Accountability
Every autonomous action is logged, notified, and explainable. The user can always answer "why did it do that?" by checking the decision log. The AI agent's natural language reasoning (500+ characters per decision) makes this genuinely readable - not just numbers and codes.

### 2. Progressive Trust Building
Users start by watching the manager make decisions (Watching → SKIP cycles). Trust builds as they see disciplined behavior. Only then does the manager enter positions. The first few "skipped" decisions are actually the most important trust signals.

### 3. Control at Every Level
- **Macro control**: Kill Switch (stop everything - atomic, checked before AND after AI reasoning)
- **Session control**: Pause/Resume/Stop per market
- **Capital control**: Adjust investment amount on the fly
- **Strategy control**: Persona selection defines behavior
- **Safety control**: Deterministic guardrails that the AI cannot override (position limits, capital conservation)

### 4. Failure as a Feature
When the manager exits at a loss, cuts a position early, refuses to enter, or has its decision rejected by guardrails - these are features, not bugs. The UI should frame risk management positively: "Exited early to protect capital" not "Lost money." Guardrail rejections should feel like "the safety system caught an edge case" not "the AI is broken."

### 5. The Manager is Not You
The Portfolio Manager should feel like a separate entity working for you - not an extension of your finger tapping buttons. It has its own personality (persona), its own reasoning style, its own discipline. It thinks in natural language, assesses its own conviction, and explains every decision. You hired it; you can fire it.

### 6. Two Layers of Intelligence (New)
The system has two distinct layers that the UI should subtly communicate:
- **The AI brain** (AgentCore): Reasons about markets, reads analysis, considers persona strategy, generates natural language explanations and conviction scores. This is the "creative" layer.
- **The safety gates** (deterministic code): Validates every AI decision against hard limits before execution. Position size caps, capital conservation, kill switch, cooldowns. This is the "compliance" layer.

The design should make users feel that both layers are working for them - the AI finds opportunities, the guardrails prevent catastrophe. Neither alone is sufficient; together they create trustworthy autonomy.
