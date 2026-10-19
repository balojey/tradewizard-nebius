# Design Brief - Portfolio Manager Updates

> For the UI/UX designer. Three backend features have been implemented that need frontend surfaces.

---

## Context

Three changes were made to the Portfolio Manager backend:

1. **Committed Capital** - The system now tracks how much of a user's wallet balance is "committed" to active Portfolio Manager sessions. Users cannot over-commit (activation and investment increases are rejected if wallet balance minus committed capital is insufficient).

2. **Optional Profit Target** - Users can now set a return goal at activation time (e.g., "stop at 100% return"). When the session's total P&L hits that target, the system automatically exits positions and terminates the session.

3. **Analysis History for the AI Agent** - The Portfolio Manager agent can now read the user's past analyses on a market (not just the current one). This doesn't require a new UI surface, but the decision log will now reference historical trend data in its reasoning.

---

## 1. Committed Capital - Balance Partitioning

### What Changed (Backend)

When a user activates a Portfolio Manager session with $100, that $100 is now "committed." If their wallet holds $500 and they have two sessions at $100 each, their available balance for new sessions is $300 - not $500.

The `/portfolio/stats` API now returns a `totalCommittedCapital` field. The activation endpoint returns `committedCapital` in its response.

### What the User Needs to Understand

- "I have $500 in my wallet"
- "I've committed $200 to active Portfolio Manager sessions"
- "I have $300 available for new sessions or other spending"
- "When a session ends, that capital is released back to available"

### Design Requirements

#### A. Wallet / Balance Display (Global)

Wherever the user sees their USDC.e balance (header, wallet page, etc.), consider showing a breakdown:

```
Wallet Balance: $500.00
├── Available: $300.00
└── Committed to Portfolio Manager: $200.00
```

This could be:
- A tooltip/popover on the balance number in the header
- A dedicated section on the wallet page
- A subtle secondary line under the main balance (e.g., "$300 available" in smaller text)

**Don't** make the committed amount feel like a loss or deduction. Frame it as "deployed" or "working for you." The money isn't gone - it's allocated.

#### B. Activation Modal - Available Balance

The activation modal currently shows "Wallet Balance" next to the investment amount input. Update this to show **available balance** (wallet minus committed):

```
Investment Amount: [____] USDC.e

Available Balance: $300.00
  (Wallet: $500.00 - $200.00 committed to 2 active sessions)
```

If the user tries to enter more than available, show inline validation:
- "Exceeds available balance. You have $300.00 available after accounting for active sessions."

#### C. Portfolio Dashboard - Stats Bar

The aggregate stats bar at the top of the Portfolio Manager dashboard should include committed capital:

```
┌──────────────────────────────────────────────────────────────────┐
│  Committed: $200.00  │  Unrealized: +$12.50  │  Realized: +$45.00  │  Sessions: 2/3  │
└──────────────────────────────────────────────────────────────────┘
```

"Committed" replaces or supplements "Total Invested" - it's the same number but the word "committed" better communicates that this capital is reserved.

#### D. Session Cards - Investment Badge

Each session card already shows investment amount. No change needed here, but ensure it's clear that this amount is "locked in" while the session is active.

### Emotional Goal

The user should feel: "My capital is organized and accounted for. I know exactly what's deployed and what's free. The system won't let me accidentally over-commit."

---

## 2. Optional Profit Target

### What Changed (Backend)

The activation request now accepts an optional `profitTargetPct` field (e.g., `100` means "stop when I've made 100% return on my investment"). When the session's P&L reaches that percentage of the investment amount, the system exits positions and terminates with reason `profit_target_reached`.

### What the User Needs to Understand

- "I can set a goal for my manager - like 'make me 2x and stop'"
- "This is optional - if I don't set one, the manager runs until I stop it or something else terminates it"
- "When the target is hit, positions are exited and the session ends automatically"
- "I get a notification when the target is reached"

### Design Requirements

#### A. Activation Modal - Profit Target Input

Add an optional field below the investment amount:

```
Investment Amount: [$100.00] USDC.e

Profit Target (optional): [____] %
  "Stop and exit when profit reaches this % of investment"
  
  Examples: 50% = stop at $150 total, 100% = stop at $200 total (2x)
```

**Interaction details:**
- Default: empty (no target - runs indefinitely)
- Input type: number with % suffix
- Min: 1%, Max: 10,000%
- Show a calculated dollar amount as the user types: "Target: +$100.00 profit → session ends at $200.00 total"
- Optional toggle approach: "Set a profit goal?" [toggle] → reveals the input when enabled

**Don't** make this feel mandatory. Many users will want their manager to run indefinitely. The field should feel like a nice-to-have, not a required decision.

#### B. Session Detail - Target Progress

If a session has a profit target, show progress toward it:

```
Profit Target: 100% ($100.00 profit)
Progress: ████████░░░░░░░░ 47% ($47.00 / $100.00)
```

This could be:
- A progress bar on the session detail page
- A small indicator on the session card in the dashboard list
- Part of the capital breakdown section

When approaching the target (>80%), consider an amber "approaching target" visual cue.

#### C. Session Card - Target Badge

On the dashboard session list, sessions with a profit target should show a small badge or indicator:

```
[Market Name]                    🎯 100% target
Sniper • $100 invested          Progress: 47%
Unrealized: +$12.00
```

Sessions without a target show nothing extra (they run indefinitely - that's the default).

#### D. Termination Notification

When a session hits its profit target, the notification should feel celebratory:

```
🎯 PROFIT TARGET REACHED

Your Sniper on "Will X happen?" hit its 100% target!
Invested: $100.00 → Final: $204.50 (+104.5%)
Positions exited. Capital released to your available balance.
```

#### E. Session History - Terminated Sessions

In the session history (completed/terminated sessions), show the termination reason clearly:

```
[Market Name]                    ✅ Target reached
Sniper • Ran for 12 days        Final P&L: +$104.50 (+104.5%)
```

vs other termination reasons:
```
[Market Name]                    🏁 Market resolved
[Market Name]                    ⏹️ Stopped by you
[Market Name]                    ⚠️ Loss limit reached
```

### Emotional Goal

The user should feel: "I can set a goal and walk away. The system will take profits for me when I'm satisfied. It's like setting a take-profit on the entire session, not just one trade."

---

## 3. Analysis History in Decision Reasoning

### What Changed (Backend)

The Portfolio Manager agent can now read the user's past analyses on a market. This means its decision reasoning (visible in the decision log) will now reference historical trends:

> "Confidence has increased across the last 3 analyses (0.72 → 0.78 → 0.84). Edge has widened from 5% to 12%. Signal alignment consistently above 0.8. Trend supports entry."

or:

> "Previous analysis recommended LONG_YES with 0.82 confidence, but current analysis flipped to LONG_NO. Contradicting signal - skipping entry until trend stabilizes."

### Design Requirements

No new UI surfaces needed. However, the decision log entries may now be richer and reference "previous analyses." Ensure:

- The decision reasoning text area can handle slightly longer explanations (the 500-char limit still applies, but entries will be more information-dense)
- If the reasoning mentions "last 3 analyses" or "previous analysis," it should be clear this refers to the user's own analysis history on that market - not some external data source
- Consider a subtle "📊 Used analysis history" badge on decision log entries where the agent referenced historical data (the backend could flag this in a future iteration, but for now it's just richer text)

### Emotional Goal

The user should feel: "My manager is getting smarter over time - it remembers what happened before and uses that context. It's not just reacting to one data point."

---

## 4. Summary of Frontend Surfaces to Update

| Surface | Change | Priority |
|---------|--------|----------|
| Activation Modal | Add available balance (wallet - committed), add optional profit target input | High |
| Wallet/Balance display | Show committed vs available breakdown | High |
| Portfolio Dashboard stats bar | Add `totalCommittedCapital` | Medium |
| Session Detail page | Show profit target progress (if set) | Medium |
| Session Cards (dashboard list) | Show target badge + progress (if set) | Medium |
| Termination notifications | New "profit target reached" celebration state | Medium |
| Session history | Show termination reason badges | Low |
| Decision log | No structural change - just richer text content | None (automatic) |

---

## 5. Edge Cases to Design For

- **User has no active sessions:** Available balance = wallet balance. No "committed" line needed (or show "$0 committed").
- **User's wallet balance drops below committed amount** (they spent funds externally): The system doesn't block existing sessions, but new activations/increases will fail. Show a warning: "Your wallet balance ($150) is below your committed amount ($200). Active sessions continue, but you cannot activate new ones until balance is restored."
- **Profit target set very low (e.g., 1%):** Valid - the session might terminate after one successful trade. No special handling needed.
- **Profit target set very high (e.g., 5000%):** Valid - effectively means "run forever unless I'm incredibly lucky." No special handling needed.
- **Session terminated by profit target while user is offline:** They'll see the notification and the session in "completed" state with the celebration badge when they return.
- **Multiple sessions hit targets simultaneously:** Each gets its own notification. The dashboard updates in real-time via WebSocket.

---

## 6. Data Available from the API

### Activation Request (POST /portfolio/sessions)
```json
{
  "marketId": "0x...",
  "investmentAmount": 100,
  "profitTargetPct": 100  // optional, null = no target
}
```

### Activation Response
```json
{
  "sessionId": "uuid",
  "status": "active",
  "profitTargetPct": 100,       // null if not set
  "committedCapital": 200       // total committed across all active sessions (including this new one)
}
```

### Portfolio Stats (GET /portfolio/stats)
```json
{
  "totalInvested": 200,
  "totalCommittedCapital": 200,  // same as totalInvested for active sessions
  "totalUnrealizedPnl": 12.5,
  "totalRealizedPnl": 45.0,
  "activeSessionCount": 2
}
```

### Session Detail (includes new field)
```json
{
  "id": "uuid",
  "investmentAmount": 100,
  "profitTargetPct": 100,       // null if not set
  "realizedPnl": 47.0,
  "unrealizedPnl": 12.0,
  // ... other existing fields
}
```

### Termination Reasons (for badge/icon mapping)
- `user_stopped` - user manually stopped
- `market_resolved` - market ended
- `capital_depleted` - ran out of money
- `kill_switch` - emergency stop
- `subscription_downgrade` - plan changed
- `risk_limit` - hit 50% session loss
- `profit_target_reached` - 🎯 hit the goal (NEW)
