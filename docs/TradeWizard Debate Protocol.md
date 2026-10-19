# TradeWizard Debate Protocol

## Overview

The TradeWizard Debate Protocol is a structured framework that allows multiple specialized AI agents to analyze prediction markets, debate outcomes, and generate a portfolio of trading strategies. This protocol ensures explainable, probability-driven, and continuously improving trading recommendations.

|  |
| :---- |

## 1\. Core Principles

* **Adversarial reasoning:** Agents challenge assumptions.  
* **Independent signal generation:** Prevents groupthink.  
* **Probability discipline:** All claims map to probabilities.  
* **Explainability:** Every trade has traceable logic.  
* **Continuous learning:** Agents evolve based on performance.

|  |
| :---- |

## 2\. Debate Lifecycle

1. Market Detected  
2. Signal Ingestion  
3. Independent Theses  
4. Cross Examination  
5. Probability Resolution  
6. Strategy Construction  
7. Portfolio Decision

This cycle repeats continuously as new data arrives.

|  |
| :---- |

## 3\. Phase I - Market Framing & Context Lock

**Owner:** Market Ingestion Agent

**Inputs:** Contract rules, expiry, current market probability, liquidity, volatility

**Outputs:** Market Briefing Document (MBD)

**MBD Example:**

| {   "market\_id": "...",   "event\_type": "election",   "expiry": "timestamp",   "resolution\_criteria": "...",   "current\_probability": 0.63,   "liquidity\_score": 8.4,   "volatility\_regime": "medium",   "key\_catalysts": \[\] } |
| :---- |

|  |
| :---- |

## 4\. Phase II - Independent Signal Generation

Each intelligence agent generates independent analysis.

**Agents:**

* Breaking News Agent  
* Polling Intelligence Agent  
* Historical Pattern Agent  
* Media Sentiment Agent  
* Social Sentiment Agent  
* Order Book Agent  
* Mispricing Agent

**Signal Object Example:**

| {   "agent": "Polling Intelligence Agent",   "confidence": 0.78,   "direction": "YES",   "fair\_probability": 0.71,   "key\_drivers": \[\],   "risk\_factors": \[\] } |
| :---- |

|  |
| :---- |

## 5\. Phase III - Thesis Construction

**Agents:** Bull Thesis Agent, Bear Thesis Agent

**Thesis Memo Example:**

| {   "position": "YES",   "fair\_probability": 0.72,   "market\_probability": 0.63,   "edge": 0.09,   "core\_thesis": "...",   "catalysts": \[\],   "failure\_conditions": \[\],   "confidence\_score": 0.81 } |
| :---- |

|  |
| :---- |

## 6\. Phase IV - Cross-Examination

Agents challenge each other's assumptions using:

* Evidence Test  
* Causality Test  
* Timing Test  
* Liquidity Test  
* Tail Risk Test

**Cross-Examination Loop:**  
Bull Claim → Bear Rebuttal → Event Stress Test → Tail Risk Scenario → Mispricing Model

|  |
| :---- |

## 7\. Phase V - Probability Court (Consensus Engine)

**Inputs:** All signals, thesis memos, cross-examination scores, historical calibration

**Output Example:**

| {   "market\_id": "...",   "consensus\_probability": 0.69,   "confidence\_band": \[0.62, 0.75\],   "disagreement\_index": 0.21,   "regime": "event-driven" } |
| :---- |

|  |
| :---- |

## 8\. Phase VI - Strategy Construction

**Strategy Families:**

* Directional: Core Long/Short, Reversion, Mispricing Arbitrage  
* Timing: Momentum Breakout, Mean Reversion, Liquidity Sweep, Volatility Expansion  
* Event: Pre/Post Event, Binary Shock, Timeline Mispricing  
* Risk Structure: Hedged Long, Tail Hedge, Spread Trade, Correlation Pair

**Strategy Object Example:**

| {   "strategy\_id": "TW-STRAT-091",   "family": "Event-Driven",   "type": "Pre-Debate Positioning",   "direction": "LONG YES",   "edge\_source": "Narrative Velocity \+ Poll Momentum",   "entry\_zone": \[0.58, 0.61\],   "target\_zone": \[0.69, 0.73\],   "stop\_zone": \[0.54, 0.56\],   "time\_horizon": "5-12 days",   "expected\_value": 0.21,   "win\_probability": 0.67,   "convexity": "medium",   "liquidity\_score": 8.2,   "correlation\_group": "Election 2026 Senate",   "risk\_weight": "medium" } |
| :---- |

**Strategy Stack:** Each market may produce 8–14 strategies.

|  |
| :---- |

## 9\. Phase VII - Risk Committee

**Agents:** Aggressive, Conservative, Neutral

**Portfolio Construction:**

* Position sizing  
* Hedging overlays  
* Correlation limits  
* Drawdown controls

**Portfolio Example:**

| Strategy | Allocation | Role |
| :---- | :---- | :---- |
| Core Long | 30% | Conviction |
| Momentum Breakout | 20% | Acceleration |
| Mean Reversion | 15% | Volatility |
| Event Pre-Position | 20% | Catalyst |
| Tail Hedge | 10% | Protection |
| Neutral Spread | 5% | Stability |

|  |
| :---- |

## 10\. Final Authority - Portfolio Manager Agent

Produces **final trade plan** for the user:

| {   "market\_id": "...",   "trade": "BUY YES",   "size": "$2,500",   "entry": 0.63,   "expected\_value": "$430",   "confidence": 0.82,   "hedge": "Tail-risk NO",   "review\_trigger": "next debate" } |
| :---- |

|  |
| :---- |

## 11\. Continuous Learning Loop

After resolution, the Model Evaluation Agent updates:

* Brier Score (probability accuracy)  
* EV Realization (strategy quality)  
* Drawdown (risk discipline)  
* Timing Efficiency (execution quality)

This ensures TradeWizard **self-improves over time**.

|  |
| :---- |

## 12\. Summary

TradeWizard’s Debate Protocol enables:

* Multiple strategies per market  
* Portfolio-level trade construction  
* Explainable, probability-driven decisions  
* Continuous learning and improvement  
* Professional-grade intelligence for everyday users

