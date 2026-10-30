# TradeWizard - Voiceover Script (ElevenLabs)

Plain spoken text only. Punctuation drives pacing. Em-dashes and ellipses for longer pauses.

---

## Full Version (≈ 3:10 at ~180 wpm)

Prediction markets aggregate the world's information into a single number - a probability. In theory, anyone can trade them. In practice, almost nobody trades them well.

TradeWizard is the intelligence layer prediction markets have been missing. The reason it works is not one giant model. It is seven of them, on Nebius Token Factory.

Every analysis, and every portfolio decision, goes through Token Factory's OpenAI-compatible API - open models from NVIDIA, Qwen, OpenAI, DeepSeek, Moonshot, and MiniMax, behind one endpoint. The prompts, the tools, and the pipelines do not know which one answers.

The workflow is eleven stages on serverless Lambda, with the Strands Agents SDK in TypeScript. We pull price history and related markets from the Polymarket CLOB and Gamma APIs. Each agent loads only its own prior signals from Aurora Postgres - cross-agent history creates anchoring, and we want independent reasoners.

Then the league fires. Fourteen specialized agents run in parallel - microstructure, polling, news, sentiment, narrative, price action, and scenario.

This is where Token Factory earns its place. Agents are assigned capabilities, not model names, and the environment resolves each one. NVIDIA Nemotron 3 Super takes the agentic bucket - news and autonomous research - because that work is tool-heavy: call a source, read the result, decide what to do next. Qwen takes the numeric and analytical agents. GPT OSS 120 B takes sentiment. DeepSeek V4 Pro takes scenario reasoning. Kimi K3 takes the non-tool synthesis stages. MiniMax M3 makes the portfolio decisions.

Swapping a model is an environment variable, not a refactor. And a tool-using agent can never resolve to the non-tool model - the registry throws before an analysis starts, instead of silently degrading a tool call.

Then the part most AI trading products skip. Three deterministic, non-LLM gates. Nebius runs the inference. Our code decides whether anything happens.

Signal fusion - the market price is the prior, but each agent is de-biased against its own calibration line before it votes, so a no-view stops counting as a bearish call. What survives has to earn its way through an evidence-scaled filter, and the stage reports its own noise floor.

Adversarial debate - a bull thesis and a bear thesis each face five cross-examination tests. Evidence. Causality. Timing. Liquidity. Tail risk.

Consensus - the edge must clear the cost of the trade, plus two standard errors of ensemble noise. If disagreement crosses thirty percent, or confidence falls below twenty, or expected value is not positive, the system emits no-trade. A deterministic check the models cannot override. No-trade is not a failure mode. It is a feature.

For execution, an autonomous Portfolio Manager decides, and a separate executor enforces. Read-only tools, mandatory stop-loss and take-profit, hard loss caps, and a kill switch that fails closed.

The substrate is serverless - Lambda, Aurora Postgres, DynamoDB, SQS, SNS. A market-level analysis pool dedupes execution, so ten thousand requests on one market become one Token Factory run.

And we do not guess about the models. Every recommendation is scored when it resolves. Every agent's accuracy and price calibration feed the next run. And every analysis stores a shadow consensus nobody sees - so swapping a model in a bucket can be measured, not argued about.

Fourteen specialists. Seven capability buckets on Nebius Token Factory. Three deterministic gates. One kill switch.

TradeWizard. An AI hedge fund for real-world outcomes - built to know when to stay out.

---

## Short Version (≈ 70s at ~160 wpm)

Prediction markets aggregate the world's information into a single probability. Almost nobody trades them well. TradeWizard is the intelligence layer they have been missing - fourteen specialized agents running in parallel on Nebius Token Factory.

Seven capability buckets, not one model. NVIDIA Nemotron 3 Super takes the tool-heavy news and research agents. Qwen, GPT OSS, DeepSeek, Kimi, and MiniMax cover the rest. Swapping one is an environment variable, not a refactor.

Three deterministic, non-LLM gates sit between the models and the user. The models argue. The code decides. If agents disagree by more than thirty percent, or the edge does not clear the cost of the trade, the system emits no-trade. No model can override that.

For execution, an autonomous Portfolio Manager trades inside limits the user pre-approves. The agent decides, a separate executor enforces, and the kill switch fails closed.

A market-level analysis pool dedupes execution, so cost scales with markets - not traffic.

Fourteen specialists. Seven capability buckets on Nebius. Three deterministic gates. One kill switch. TradeWizard - an AI hedge fund for real-world outcomes.

---

## Model Names, As Spoken

Reference for the voice pass, not for the microphone.

| Capability | Spoken as | In the script |
|------------|-----------|---------------|
| `agentic` | NVIDIA Nemotron 3 Super | named |
| `fast` | Qwen 3, thirty B | "Qwen" |
| `analytical` | Qwen 3, two thirty-five B | "Qwen" |
| `reasoning` | GPT OSS, one twenty B | named |
| `deep_reasoning` | DeepSeek V4 Pro | named |
| `non_tool` | Kimi K3 | named |
| `default` | MiniMax M3 | named |

Pronunciation: Nemotron - NEH-mo-tron. Qwen - "kwen", one syllable. DeepSeek - "deep-seek". Kimi - "KEE-mee". MiniMax - "mini-max".

If the catalog changes, update the capability table in the README first, then only the model names in the middle paragraphs. The structure of the script does not depend on them.
