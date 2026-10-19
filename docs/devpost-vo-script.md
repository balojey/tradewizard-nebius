# TradeWizard - Voiceover Script (ElevenLabs)

Plain spoken text only. Punctuation drives pacing. Em-dashes and ellipses for longer pauses.

---

## Full Version (≈ 2:55)

Prediction markets aggregate the world's information into a single number - a probability. In theory, anyone can trade them. In practice, almost nobody can trade them well.

TradeWizard is the intelligence layer prediction markets have been missing. We turn Polymarket into a guided, probability-driven trading experience - backed by a multi-agent system engineered to be auditable, bounded, and willing to refuse.

The analysis workflow is eleven stages, running on AWS Lambda with the Strands Agents SDK in TypeScript, on top of Amazon Bedrock and Nova 2 Lite. We start by pulling price history and related markets from the Polymarket CLOB and Gamma APIs. Then each agent loads its own prior signals from Aurora Postgres - only its own, because cross-agent history creates anchoring, and we want independent reasoners. An autonomous research agent gathers real-time context through NewsData and Serper.

Then the league fires. Fourteen specialized agents run in parallel - microstructure, polling, news, sentiment, narrative, price action, and scenario. Each emits a typed signal validated through Zod schemas, with structured fallback when the model produces something unparseable.

Now the part most AI trading products skip. Three deterministic, non-LLM gates sit between the agents and the user.

Signal fusion - weighted aggregation across all fourteen signals, scaled by historical accuracy from a closed-loop leaderboard, with a divergence penalty when agent estimates spread too far apart.

Adversarial debate - a bull thesis and a bear thesis each face five cross-examination tests. Evidence. Causality. Timing. Liquidity. Tail risk. Ten tests, structured and scored.

And the consensus engine, which computes a final probability and a disagreement index. If disagreement crosses thirty percent, consensus fails and the system emits no-trade. If expected value is non-positive, no-trade. These are deterministic checks the model cannot override. No-trade is not a failure mode. It's a feature.

For users who want execution, we built an autonomous Portfolio Manager under one principle. The agent decides. A separate executor validates and places the order.

The Portfolio Manager's tools are read-only. It cannot place an order itself. Its output is a structured decision the Trade Executor enforces against machine-checked invariants. Stop-loss and take-profit are mandatory on every trade. Loss limits at fifty percent per session, forty across sessions. Thirty-minute cooldown after a loss exit. Token IDs resolved by outcome string, never by array index. Trade Executor and Position Guard are mutually exclusive on the same position. The kill switch fails closed.

The platform is serverless and AWS-native. Lambda for compute. Aurora Postgres for durable state, scaling to half an ACU at idle. DynamoDB for the one-hour dedup cache, WebSocket connections, and rate limits. SQS FIFO for the analysis queue. SNS fan-out delivers results in parallel through WebSocket, email, push, and webhook.

A market-level analysis pool dedupes execution across users. Ten thousand requests on the same popular market become one Bedrock invocation. Users only pay for results they actually receive, exactly once.

Every recommendation is scored after the take-profit or stop-loss is hit. Every agent's accuracy feeds back into signal weighting. The intelligence compounds.

Fourteen specialists. Three deterministic gates. One kill switch.

TradeWizard. An AI hedge fund for real-world outcomes - built to know when to stay out.

---

## Short Version (≈ 75s)

Prediction markets aggregate the world's information into a single probability. Almost nobody trades them well. TradeWizard is the intelligence layer they've been missing - a multi-agent AI system running on AWS Lambda and Amazon Bedrock that explains every recommendation it makes.

Fourteen specialized agents run in parallel through an eleven-stage workflow. Their signals pass through three deterministic, non-LLM gates - signal fusion, adversarial debate, and a consensus engine. If agents disagree by more than thirty percent, or expected value isn't positive, the system emits no-trade. The model can't override it.

For execution, an autonomous Portfolio Manager trades inside hard limits the user pre-approves. The agent decides - but a separate executor enforces. Mandatory stop-loss. Mandatory take-profit. Loss caps at fifty percent per session, forty across sessions. A kill switch that fails closed.

The whole platform is serverless. A market-level analysis pool dedupes execution across users, so cost scales with markets - not traffic.

Fourteen specialists. Three deterministic gates. One kill switch. TradeWizard - an AI hedge fund for real-world outcomes.
