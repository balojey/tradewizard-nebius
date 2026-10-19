# YouTube Description

---

TradeWizard - An AI hedge fund for real-world outcomes, built to know when to stay out.

Prediction markets let you trade real-world events - elections, court rulings, economic policy - but they offer markets without intelligence. TradeWizard is the missing layer: a multi-agent AI system that produces explainable, probability-driven trade recommendations on Polymarket, with an autonomous Portfolio Manager governed by hard, machine-checked limits.

This video walks through both the product experience and the systems architecture behind it.

-

⚙️ Systems Architecture

• 11-stage analysis workflow on AWS Lambda + Strands Agents SDK (TypeScript)
• 14 specialized intelligence agents running in parallel on Amazon Bedrock (Nova 2 Lite)
• Per-agent isolated memory from Aurora PostgreSQL - no cross-agent anchoring
• Tools: NewsData.io, Serper search/scrape, sandboxed shell (Python + bash), Polymarket CLOB & Gamma APIs
• Zod-validated typed signals with structured fallback on parse failure

🛡️ Three Deterministic Gates (non-LLM)

1. Signal Fusion - weighted aggregation scaled by leaderboard accuracy + divergence penalty
2. Adversarial Debate - bull & bear theses each face 5 cross-examination tests (evidence, causality, timing, liquidity, tail risk)
3. Consensus Engine - computes final probability; fails to NO_TRADE if disagreement is greater than 30% or expected value ≤ 0

🤖 Autonomous Portfolio Manager (Bounded Autonomy)

• Agent decides → separate executor enforces (read-only tool layer on the agent)
• Mandatory stop-loss and take-profit on every position
• 50% per-session loss limit, 40% cross-session cap
• 30-minute cooldown after loss exit
• Token ID resolved by outcome string (never array index)
• Mutual exclusion between Trade Executor and Position Guard
• Kill switch fails closed - one click exits all positions, terminates all sessions

☁️ AWS-Native Infrastructure

Lambda (Node.js 20) · Aurora PostgreSQL Serverless v2 · DynamoDB (dedup, connections, rate limits) · SQS FIFO + DLQ · EventBridge Scheduler · SNS fan-out · S3 · API Gateway (REST + WebSocket) · Cognito Custom Auth · SES · CloudWatch · Amplify Hosting

💰 Market-Level Analysis Pool

One Bedrock execution per market per hour, shared across all users. 10,000 requests on the same market = 1 invocation. Users pay only for results they receive, exactly once.

📊 Closed-Loop Learning

Every recommendation is scored against actual market resolution. Every agent has a public accuracy leaderboard. Signal weights evolve with outcome data.

-

🏗️ Built With

AWS CDK · AWS Lambda · Amazon Bedrock · Amazon Nova 2 Lite · Strands Agents SDK · Aurora PostgreSQL Serverless v2 · DynamoDB · SQS · SNS · EventBridge · API Gateway · Cognito · SES · S3 · CloudWatch · Amplify Hosting · Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query · Polymarket CLOB API · viem · USDC.e on Polygon · Zod · Vitest

-

#TradeWizard #PredictionMarkets #Polymarket #MultiAgentAI #AWSBedrock #StrandsSDK #SystemsDesign #AITrading #ServerlessArchitecture #AmazonNova #AutonomousAgents #MachineLearning #TypeScript #AWS #Hackathon
