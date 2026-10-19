# Requirements Document

## Introduction

The Autonomous Portfolio Manager is a system of AI-powered trading agents that users can activate per market to autonomously execute, monitor, and manage prediction market positions on Polymarket. Each user selects a single trading persona (configured in their account settings) that defines the Portfolio Manager's risk appetite, position sizing strategy, entry/exit logic, and monitoring behavior across all their activations. Portfolio managers consume the existing TradeWizard analysis pipeline (14-agent debate protocol) as their intelligence source and translate recommendations into executed trades with ongoing position management.

The Portfolio Manager operates continuously on a market as long as it has capital available. It enters positions when analysis shows opportunity, monitors and exits when conditions change, and re-enters if a subsequent analysis reveals new opportunity - even after having previously exited. A session only truly ends when the user manually stops it, the market resolves, or the investment capital is fully depleted. The manager has full order flexibility: it can place limit orders, market orders, and simultaneous buy/sell orders (e.g., buy at one price and immediately list to sell at a higher price for profit-taking).

This feature is included with Pro ($49/mo) and Elite ($149/mo) plan subscriptions. The portfolio manager does not trigger its own analysis - it requires the user to have an active recurring analysis subscription on the market, and it consumes those analysis results as they are delivered. The user's recurring analysis credits are consumed as normal.

## Glossary

- **Portfolio_Manager**: An autonomous agent activated per market that executes trades, monitors positions, and manages exits on behalf of the user
- **Persona**: A trading strategy profile selected once by the user in account settings, defining the Portfolio_Manager's behavior across all market activations
- **Activation**: The act of deploying a Portfolio_Manager to a specific market with a specified investment amount
- **Position_Guard**: A monitoring sub-agent that continuously watches an active position for exit signals, stale market conditions, and market regime changes
- **Investment_Amount**: The USDC.e amount the user allocates to a specific market activation, updatable on the fly provided the wallet balance supports it
- **Kill_Switch**: A mechanism that immediately halts all autonomous trading activity and exits all positions
- **Conviction_Score**: A composite metric (0.0 to 1.0) derived from the analysis pipeline's consensus probability, edge size, and signal alignment that determines position sizing
- **Regime_Shift**: A significant change in market conditions (probability swing > 15%, volume spike > 3x, or new catalyst) that triggers re-evaluation of the current position
- **Stale_Market**: A market with declining volume, widening spreads, or no meaningful price movement over an extended period, signaling reduced opportunity
- **Exit_Signal**: A condition detected by the Position_Guard indicating the Portfolio_Manager should reduce or close its position (regime shift, goal achieved, stale market, or contradicting analysis)
- **Session**: The full lifecycle of a Portfolio_Manager activation on a specific market, from activation until user termination, market resolution, or capital depletion. The manager may enter and exit positions multiple times within a single Session.

## Requirements

### Requirement 1: Portfolio Manager Activation

**User Story:** As a Pro or Elite plan subscriber, I want to activate an autonomous portfolio manager on a specific market with a specified investment amount, so that trades are executed and managed on my behalf without manual intervention.

#### Acceptance Criteria

1. WHEN a user selects "Activate Portfolio Manager" on a market page, THE Activation_Service SHALL present an activation form requesting the Investment_Amount in USDC.e with a minimum of $5 and a maximum equal to the user's current wallet balance
2. WHEN a user confirms activation, THE Activation_Service SHALL verify the user holds a Pro or Elite subscription before creating the Session
3. IF a user with a Free or Starter plan attempts activation, THEN THE Activation_Service SHALL reject the request with a message indicating the required plan tier (Pro or Elite)
4. WHEN a user confirms activation, THE Activation_Service SHALL verify the user's wallet balance covers the specified Investment_Amount and reject the activation with a message indicating the insufficient balance if the wallet balance is less than the Investment_Amount
5. THE Activation_Service SHALL limit each user to a maximum of 3 concurrent active Sessions on the Pro plan and 10 concurrent active Sessions on the Elite plan
6. IF a user attempts to exceed their concurrent Session limit, THEN THE Activation_Service SHALL reject the activation and display the current active Session count and the maximum allowed for their plan
7. WHEN a Session is successfully created, THE Activation_Service SHALL record the market ID, Investment_Amount, user's active Persona, and activation timestamp in the portfolio_manager_sessions table
8. WHEN a user confirms activation, THE Activation_Service SHALL verify that the user has an active recurring analysis subscription (any interval: 1h, 4h, 12h, or 1d) on the target market before creating the Session
9. IF the user does not have an active recurring analysis subscription on the target market, THEN THE Activation_Service SHALL reject the activation with a message instructing the user to set up recurring analysis on that market first
10. IF a user attempts to activate a Portfolio_Manager on a market that has already resolved, THEN THE Activation_Service SHALL reject the activation with a message indicating the market is no longer active
11. IF a user attempts to activate a Portfolio_Manager on a market where they already have an active Session, THEN THE Activation_Service SHALL reject the activation with a message indicating an active Session already exists for that market

### Requirement 2: Portfolio Manager Personas

**User Story:** As a trader, I want to choose a trading persona that defines how my portfolio manager behaves across all markets, so that autonomous trading matches my risk appetite and trading philosophy.

#### Acceptance Criteria

1. THE Persona_Registry SHALL provide the following six personas, each with distinct trading behavior:
   - **The Sniper**: High-conviction, concentrated bets. Only enters when edge > 10% and signal alignment > 0.8. Allocates 30–50% of available Investment_Amount per trade on rare, high-confidence opportunities. May watch a market for multiple analysis cycles before acting. Exits when Conviction_Score drops below 0.5 or edge narrows below 5%.
   - **The Scalper**: Rapid, small-edge exploitation. Enters on edges as low as 3% with signal alignment ≥ 0.5. Allocates 5–15% of available Investment_Amount per trade. Only enters markets with bid-ask spread ≤ 2%. High trade frequency, exits when edge drops below 1% or signal alignment drops below 0.4.
   - **The Contrarian**: Fades crowd consensus. Enters when social sentiment diverges from fundamental probability by more than 20 percentage points (e.g., sentiment implies 70% but fundamental analysis shows ≤ 50%). Allocates 20–35% of available Investment_Amount per trade. Buys fear, sells euphoria. Targets mean-reversion opportunities where markets overreact to news. Exits when sentiment-fundamental divergence narrows to within 5 percentage points.
   - **The Catalyst Hunter**: Event-driven specialist. Identifies upcoming catalysts (debates, rulings, data releases) and positions before the event. Allocates 20–40% of available Investment_Amount per trade. Exits immediately after catalyst resolution regardless of outcome. All positions are time-boxed to the catalyst event window.
   - **The Hedge Architect**: Multi-position strategist. Builds positions across related markets to reduce directional exposure. Allocates a maximum of 20% of available Investment_Amount per individual position. Targets consistent gains through spread trades and relative value. Focuses on market inefficiencies between correlated outcomes.
   - **The Momentum Rider**: Trend-following specialist. Enters when price momentum confirms the analysis direction (3 consecutive price moves in the same direction). Allocates 15–25% of available Investment_Amount for initial entry. Adds to winning positions (pyramiding) from remaining Investment_Amount up to a maximum total allocation of 60% of Investment_Amount in a single market. Exits when price reverses by more than 10% from the local peak or when 2 consecutive analysis cycles show weakening signal alignment.
2. WHEN a user views Persona details in settings, THE Persona_Registry SHALL display the Persona's risk level classification: Conservative (Hedge Architect), Moderate (Scalper, Catalyst Hunter), Aggressive (Sniper, Contrarian, Momentum Rider)
3. THE Persona_Registry SHALL display a description of each Persona's entry philosophy, monitoring style, and exit behavior to help users make an informed selection
4. THE Persona_Registry SHALL enforce that each Persona's per-trade allocation never exceeds the maximum position size limit defined by the Risk_Engine (50% of Session Investment_Amount as specified in Requirement 8, criterion 4)
5. IF a Persona's entry criteria reference market data that is unavailable (e.g., sentiment data for the Contrarian, or catalyst schedule for the Catalyst Hunter), THEN THE Portfolio_Manager SHALL skip the trade opportunity and log the reason as "insufficient data for persona entry evaluation"

### Requirement 3: Persona Selection and Configuration

**User Story:** As a trader, I want to select my portfolio manager persona once in my account settings, so that all my market activations use a consistent trading strategy without per-market configuration.

#### Acceptance Criteria

1. THE Settings_Page SHALL provide a Persona selection interface where the user chooses one active Persona from the available six options
2. WHEN a user selects a new Persona, THE Settings_Service SHALL apply the new Persona to all future activations without affecting currently active Sessions (active Sessions continue with the Persona they were started with)
3. THE Settings_Service SHALL store the user's selected Persona in the user profile and default to "The Scalper" for users who have not made a selection
4. WHERE the user holds an Elite subscription, THE Settings_Service SHALL allow modification of Persona parameters including exit sensitivity (integer scale from 1 to 5, where 1 is most conservative and 5 is most aggressive), monitoring frequency (integer range: 5-60 minutes in 5-minute increments), and position sizing aggressiveness (range: 0.5x-2.0x of default in 0.1x increments)
5. WHERE the user holds a Pro subscription, THE Settings_Service SHALL provide Personas with default parameters only, without customization capability
6. WHEN customized parameters are saved, THE Settings_Service SHALL validate that all values fall within the defined ranges (exit sensitivity: 1-5, monitoring frequency: 5-60 minutes, position sizing: 0.5x-2.0x) and reject out-of-range values with an error message indicating the parameter name and its allowed range
7. WHEN a Persona selection or parameter customization is successfully saved, THE Settings_Service SHALL confirm the save to the user and display the active Persona configuration
8. IF an Elite user's subscription downgrades to Pro, THEN THE Settings_Service SHALL revert all customized Persona parameters to their default values and retain the user's selected Persona

### Requirement 4: Trade Execution

**User Story:** As a user with an active portfolio manager, I want the system to autonomously place orders on Polymarket using any order type the strategy requires, so that I capture trading opportunities and lock in profits without manual order entry.

#### Acceptance Criteria

1. WHEN an analysis result is delivered for an active Session's market, THE Portfolio_Manager SHALL evaluate the recommendation against the active Persona's entry criteria and either proceed to position sizing (if criteria are met) or log the evaluation as "no action" and take no further trading action for that analysis cycle
2. WHEN the Persona's entry criteria are met and the Session has available Investment_Amount, THE Portfolio_Manager SHALL calculate position size using the Persona's sizing rules and the Conviction_Score (a value from 0.0 to 1.0 derived from consensus confidence, edge magnitude, and signal alignment), with a minimum position size of $5 USDC.e
3. THE Portfolio_Manager SHALL place limit orders, market orders, or combinations thereof as determined by the Persona's strategy logic and the current order book state (spread width and available depth)
4. WHEN the Persona's strategy calls for immediate execution (e.g., Scalper on tight spreads, or urgent exit), THE Portfolio_Manager SHALL use market orders
5. WHEN the Persona's strategy calls for price improvement (e.g., Sniper waiting for optimal entry), THE Portfolio_Manager SHALL use limit orders at the target price
6. WHEN the Portfolio_Manager acquires a position, THE Portfolio_Manager SHALL place a limit sell order at the Persona's stop-loss price to provide mechanical downside protection, and SHALL place an additional limit sell order at the Persona's target exit price when the Persona defines a target exit (Sniper, Scalper, Catalyst Hunter, and Hedge Architect always define targets; Momentum Rider and Contrarian do not, as they use dynamic exits managed by the Position_Guard)
7. WHEN either the stop-loss or take-profit limit sell order is filled, THE Portfolio_Manager SHALL cancel the other outstanding sell order for that position and record the exit
8. IF a limit order is not filled within the Persona's patience window (Scalper: 15 minutes, Catalyst Hunter: 1 hour, Sniper: 4 hours, others: 2 hours), THEN THE Portfolio_Manager SHALL cancel the unfilled order and log the missed opportunity
9. WHEN an order is filled, THE Portfolio_Manager SHALL record the order type, entry price, position size, fill timestamp, and associated analysis ID in the portfolio_manager_trades table
10. IF the calculated position size would exceed the Session's remaining available Investment_Amount, THEN THE Portfolio_Manager SHALL reject the order and log the rejection reason without placing any trade
11. IF the order book liquidity at the target price is insufficient to fill the calculated position size without exceeding 2% slippage, THEN THE Portfolio_Manager SHALL reduce position size to fit available liquidity, or skip the trade entirely if the reduced size would fall below the $5 USDC.e minimum
12. IF order placement on the Polymarket CLOB API fails, THEN THE Portfolio_Manager SHALL retry up to 3 times with exponential backoff (1 second, 2 seconds, 4 seconds), and if all retries fail, log the failure with the error details, notify the user, and skip the trade for that analysis cycle

### Requirement 5: Position Monitoring and Exit Management

**User Story:** As a user with active positions managed by a portfolio manager, I want the system to continuously monitor market conditions for exit signals, stale markets, and regime changes, so that positions are managed intelligently beyond the mechanical stop-loss and take-profit orders already on the book.

#### Acceptance Criteria

1. WHILE a Session has an open position, THE Position_Guard SHALL monitor the market's price, volume, spread, and order book at the Persona's configured monitoring interval (Scalper: every 5 minutes, Sniper: every 30 minutes, others: every 15 minutes)
2. WHEN a Regime_Shift is detected (probability swing > 15% from position entry price, volume spike > 3x the 24-hour rolling average, or a new catalyst identified by the analysis pipeline's event intelligence agents), THE Position_Guard SHALL re-evaluate the position using the most recent analysis result and current market data, and if the position is no longer justified, initiate an exit according to criterion 3
3. IF the fresh analysis recommendation contradicts the current position direction (LONG_YES position receives LONG_NO or NO_TRADE recommendation, or LONG_NO position receives LONG_YES or NO_TRADE recommendation), THEN THE Position_Guard SHALL cancel existing limit sell orders and place an immediate exit order within 1% of the current market price
4. WHEN the Position_Guard detects a Stale_Market condition (volume declining for 3 consecutive monitoring cycles AND spread widening beyond 5% of the token price), THE Position_Guard SHALL exit the position at market price to free capital for the Session's next opportunity
5. WHILE the Momentum Rider Persona has a position with unrealized profit > 5% AND the most recent analysis confirms the same directional recommendation with consensus confidence >= 70%, THE Position_Guard SHALL cancel the existing take-profit order and replace it with a new take-profit target set 50% further from the current price than the previous target
6. WHEN the Contrarian Persona's most recent analysis shows consensus probability moving toward the position's entry thesis by more than 10% (indicating sentiment normalization), THE Position_Guard SHALL begin scaling out by placing 3 equal-sized partial sell orders at 2%, 4%, and 6% above the current market price
7. THE Position_Guard SHALL NOT duplicate the mechanical stop-loss protection already provided by standing limit sell orders - its role is higher-level intelligence about when to override or adjust those standing orders based on new information
8. IF the Position_Guard triggers an exit due to Regime_Shift or Stale_Market and the exit order is not filled within 2 monitoring cycles, THEN THE Position_Guard SHALL cancel the unfilled order and re-attempt exit at the current market price

### Requirement 6: Investment Amount Management

**User Story:** As a trader, I want to specify how much money to invest in each market activation and update that amount on the fly, so that I maintain flexible control over my capital allocation.

#### Acceptance Criteria

1. WHEN activating a Portfolio_Manager, THE Activation_Service SHALL require the user to specify an Investment_Amount in USDC.e (minimum $5, no maximum beyond wallet balance)
2. WHEN a user requests to increase the Investment_Amount for an active Session, THE Investment_Service SHALL verify the user's wallet balance covers the additional amount before applying the increase
3. IF the user's wallet balance is insufficient to cover a requested Investment_Amount increase, THEN THE Investment_Service SHALL reject the request and display the current wallet balance alongside the requested increase amount
4. WHEN the Investment_Amount is increased, THE Investment_Service SHALL make the additional funds available to the Portfolio_Manager for the next trade decision cycle
5. WHEN a user requests to decrease the Investment_Amount for an active Session, THE Investment_Service SHALL only allow reduction of the uninvested portion (funds not currently held in open positions or locked in pending unfilled orders)
6. IF a user attempts to reduce Investment_Amount below the value currently committed (open positions plus funds locked in pending unfilled orders), THEN THE Investment_Service SHALL reject the request and display the committed amount breakdown
7. THE Investment_Service SHALL display the breakdown of the Investment_Amount into four categories: amount in open positions, amount locked in pending unfilled orders, amount available for new trades, and realized P&L returned to available balance

### Requirement 7: Session Lifecycle and Persistence

**User Story:** As a user, I want my portfolio manager sessions to persist on a market as long as capital remains, re-entering when new opportunities arise, so that I maximize returns without needing to manually reactivate.

#### Acceptance Criteria

1. WHILE a Session has available Investment_Amount above the minimum trade threshold ($5) and the market has not resolved, THE Portfolio_Manager SHALL continue consuming recurring analysis results as they are delivered and re-enter positions when the Persona's entry criteria are met - even after having previously exited
2. WHEN the underlying market resolves (outcome determined on Polymarket), THE Lifecycle_Manager SHALL detect the resolution within 5 minutes, close the Session, record the final P&L including any redemption proceeds, and deliver a resolution summary containing: final Session P&L, total trades executed, winning trade count, redemption amount received, and market outcome
3. IF a user's subscription downgrades from Pro or Elite to a lower tier, THEN THE Lifecycle_Manager SHALL terminate all active Sessions within a 24-hour grace period, exiting positions at market price and canceling all pending orders within 5 minutes of initiating termination
4. THE Lifecycle_Manager SHALL send a daily summary notification at 00:00 UTC to the user for each active Session including trades executed that day, current positions, unrealized P&L, and total realized P&L, delivered via the user's configured notification channels
5. WHEN a Session's available Investment_Amount falls below the minimum trade threshold ($5) through trading losses, THE Lifecycle_Manager SHALL mark the Session as terminated with a "capital depleted" classification and deliver a final report containing: total Session P&L, trade count, win rate, average hold duration, and remaining balance
6. WHEN a user manually stops a Session, THE Lifecycle_Manager SHALL exit all open positions at market price, cancel all pending orders within 60 seconds, and generate a comprehensive Session report with total P&L, trade count, win rate, and average hold duration
7. THE Lifecycle_Manager SHALL allow the Portfolio_Manager to cycle through multiple entry/exit sequences within a single Session, treating each as a distinct trade while maintaining cumulative Session statistics (total P&L, trade count, win rate, and average hold duration)

### Requirement 8: Risk Controls and Guardrails

**User Story:** As a trader using autonomous portfolio managers, I want safety mechanisms that protect my capital from excessive losses and system failures, so that autonomous trading does not result in catastrophic outcomes.

#### Acceptance Criteria

1. THE Risk_Engine SHALL enforce a maximum loss limit per Session (default: 50% of Investment_Amount) calculated as the sum of realized losses plus unrealized losses on open positions, and initiate a full exit sequence when the cumulative loss reaches 45% of Investment_Amount (the approach threshold)
2. THE Risk_Engine SHALL enforce a maximum total loss across all active Sessions (default: 40% of total invested capital across all Sessions) calculated as the sum of realized losses plus unrealized losses across all active Sessions, and trigger the Kill_Switch when the limit is reached
3. WHEN the Kill_Switch is triggered, THE Risk_Engine SHALL cancel all pending orders across all Sessions, exit all open positions at market price, and suspend all Portfolio_Manager activity until the user manually re-enables trading via the Dashboard Kill_Switch reset control
4. THE Risk_Engine SHALL limit maximum position size per single trade to 50% of the Session's current available Investment_Amount (funds not currently held in open positions) regardless of Persona sizing rules
5. IF the Polymarket CLOB API becomes unreachable (no response within 10 seconds) or returns errors for 3 consecutive attempts spaced 30 seconds apart, THEN THE Risk_Engine SHALL pause all Portfolio_Manager activity and notify the user via their preferred notification channel
6. WHEN a Session's cumulative loss (realized losses plus unrealized losses on open positions) reaches 30% of Investment_Amount, THE Risk_Engine SHALL send a warning notification to the user and reduce the Persona's calculated position size by 50% for all subsequent trades in that Session
7. THE Risk_Engine SHALL prevent the Portfolio_Manager from re-entering a market within 30 minutes of any exit that resulted in a realized loss (sell price lower than buy price), regardless of whether the exit was triggered by stop-loss, regime shift, or manual intervention
8. IF the Risk_Engine initiates a full exit sequence and the market order cannot be filled within 60 seconds due to insufficient liquidity, THEN THE Risk_Engine SHALL place an aggressive limit order at 5% worse than the current best bid and notify the user that the emergency exit is pending

### Requirement 9: User Dashboard and Controls

**User Story:** As a user managing autonomous portfolio managers, I want a real-time dashboard showing all active sessions, positions, and performance, so that I can monitor and override autonomous decisions when needed.

#### Acceptance Criteria

1. THE Dashboard SHALL display all active Sessions with their current status (analyzing, positioned, exiting, watching, completed), Persona name, market name, unrealized P&L, realized P&L, and Investment_Amount utilization shown as the percentage and absolute value of Investment_Amount currently held in open positions versus available for new trades
2. THE Dashboard SHALL update all displayed Session data (status, P&L, utilization) via WebSocket push within 5 seconds of any state change in the underlying Session
3. WHEN a user clicks on an active Session, THE Dashboard SHALL show the trade history for that Session paginated at 20 trades per page, including entries, exits, P&L per trade, and the analysis reasoning that triggered each decision
4. THE Dashboard SHALL provide a per-Session "Pause" control that halts new trade entries and cancels any pending unfilled orders while maintaining existing position monitoring by the Position_Guard
5. WHEN a user activates the "Resume" control on a paused Session, THE Dashboard SHALL restore the Session to active status, allowing the Portfolio_Manager to evaluate new trade entries on the next analysis cycle
6. WHEN a user activates the per-Session "Stop" control, THE Dashboard SHALL present a confirmation prompt requiring explicit user approval before exiting all positions at market price and terminating the Session
7. WHEN a user activates the global Kill_Switch button, THE Dashboard SHALL present a confirmation prompt requiring explicit user approval before triggering the Risk_Engine Kill_Switch across all Sessions
8. THE Dashboard SHALL display aggregate portfolio statistics: total invested across all Sessions, total unrealized P&L, total realized P&L, and number of active Sessions

### Requirement 10: Analysis Pipeline Integration

**User Story:** As a portfolio manager system, I want to consume the user's existing recurring analysis results as my intelligence source, so that trading decisions are backed by the full multi-agent debate protocol without the portfolio manager needing to trigger its own analysis runs.

#### Acceptance Criteria

1. WHEN a user activates a Portfolio_Manager on a market, THE Activation_Service SHALL verify that the user has an active recurring analysis subscription (any interval: 1h, 4h, 12h, or 1d) on that same market, and reject the activation if no recurring analysis exists with a message instructing the user to set up recurring analysis first
2. THE Portfolio_Manager SHALL NOT schedule or trigger its own analysis runs - it exclusively consumes analysis results delivered by the user's existing recurring analysis subscription for that market
3. WHEN a recurring analysis result is delivered for a market with an active Portfolio_Manager Session, THE Portfolio_Manager SHALL receive the result via the existing EventBridge analysis-complete event and evaluate the recommendation against the Persona's entry criteria and the current position state before deciding on one action: enter, hold, exit, or no action
4. IF the user cancels their recurring analysis subscription on a market with an active Portfolio_Manager Session, THEN THE Portfolio_Manager SHALL pause the Session (no new trades) and notify the user that the Session requires an active recurring analysis to operate
5. THE Portfolio_Manager SHALL store each analysis-to-action decision in the portfolio_manager_decisions table including: the analysis result ID, the chosen action (enter/hold/exit/no_action), the Persona's entry criteria evaluation outcome, the current position state at decision time, the Conviction_Score if applicable, and a reasoning summary of no more than 500 characters
6. THE Portfolio_Manager SHALL consume analysis results at whatever interval the user has configured for their recurring analysis - the user controls the analysis cadence, not the persona

### Requirement 11: Notification and Transparency

**User Story:** As a user with active portfolio managers, I want detailed notifications about every autonomous action taken on my behalf, so that I maintain full visibility into what the system is doing with my capital.

#### Acceptance Criteria

1. WHEN the Portfolio_Manager places an order, THE Notification_Service SHALL deliver a notification within 10 seconds containing the market name, direction (YES/NO), order type (limit or market), position size in USDC.e, price (limit price for limit orders, execution price for market orders), and a one-sentence reasoning summary from the triggering analysis
2. WHEN a position is exited, THE Notification_Service SHALL deliver a notification within 10 seconds containing the exit reason (target reached, regime shift, stale market, contradicting analysis, or risk limit), entry price, exit price, realized P&L in USDC.e, and hold duration
3. WHEN the Kill_Switch is triggered, THE Notification_Service SHALL deliver a notification via all enabled channels (WebSocket, email, push) within 10 seconds, regardless of quiet hours settings, containing the trigger reason and the number of Sessions affected
4. WHEN a Session is paused due to API failure or risk limit, THE Notification_Service SHALL deliver a notification explaining the pause reason, the affected Session's market name, and the required user action to resume
5. THE Notification_Service SHALL respect the user's existing notification channel preferences for routine trade notifications but override quiet hours for Kill_Switch events, Session loss warnings (30% threshold from Risk_Engine), and API failure pauses
6. IF a notification delivery attempt fails on a channel (WebSocket disconnected, email bounce, or push delivery failure), THEN THE Notification_Service SHALL retry delivery up to 3 times with exponential backoff (2 seconds, 4 seconds, 8 seconds) and, if all retries fail, attempt delivery on the next available enabled channel
