# Nebius Token Factory Integration

TradeWizard's inference layer runs on Nebius Token Factory. This document describes the boundary, the routing model, how credentials are handled, and what happens when inference fails.

The short version: the product's intelligence is a set of agent workflows, not a model. Token Factory supplies open models through an OpenAI-compatible API. The agent code, tools, deterministic gates, and execution path are unchanged by the provider.

## What runs on Token Factory

| Stage | Where it runs | Model bucket |
|-------|---------------|--------------|
| Web research (autonomous tool use) | Token Factory | `agentic` |
| 14 intelligence agents (parallel) | Token Factory | `fast`, `analytical`, `agentic`, `reasoning`, `deep_reasoning` |
| Thesis construction | Token Factory | `non_tool` |
| Cross-examination (10 tests) | Token Factory | `non_tool` |
| Risk philosophy (3 agents) | Token Factory | `non_tool` |
| Final recommendation | Token Factory | `non_tool` |
| Portfolio Manager decision | Token Factory | `default` |

## What does not run on Token Factory

- Signal fusion, consensus, expected-value rejection, and schema validation. These are deterministic application code and have no model dependency.
- Order validation, risk limits, cooldowns, kill-switch semantics, and CLOB execution.
- State, queueing, scheduling, delivery, authentication, and billing.

That split is deliberate. Inference can be swapped or throttled without changing the safety properties of the execution path.

## Architecture

```
Analysis Lambda
  │
  ├─ services/analysis-lambda/lib/multi-model.ts
  │    logical key → capability → model ID
  │
  └─ services/shared/ai-provider.ts
       ├─ resolveAiProvider()        AI_PROVIDER
       ├─ getNebiusApiKey()          Secrets Manager or env fallback
       ├─ getNebiusModelId()         NEBIUS_MODEL_<CAPABILITY>
       └─ createProviderModel()      Strands OpenAIModel
              │
              ▼
       https://api.tokenfactory.nebius.com/v1/
```

The analysis pipeline never constructs a vendor model directly. It calls `getModelForAgent()` or `getModelForStage()`, which resolves a logical key through the registry. This is why adding or replacing a model is an environment change, not a refactor.

## Capability routing

Tool-using stages and non-tool stages are separated at the capability level.

| Capability | Env var | Model ID | Used by | Tool calling |
|------------|---------|----------|---------|--------------|
| `fast` | `NEBIUS_MODEL_FAST` | `Qwen/Qwen3-30B-A3B-Instruct-2507` | market_microstructure, probability_baseline, momentum | Required |
| `analytical` | `NEBIUS_MODEL_ANALYTICAL` | `Qwen/Qwen3-235B-A22B-Instruct-2507` | risk_assessment, polling_intelligence, mean_reversion | Required |
| `agentic` | `NEBIUS_MODEL_AGENTIC` | `nvidia/nemotron-3-super-120b-a12b` | breaking_news, event_impact, historical_patterns, web_research | Required |
| `reasoning` | `NEBIUS_MODEL_REASONING` | `openai/gpt-oss-120b` | media_sentiment, social_sentiment, narrative_velocity | Required |
| `deep_reasoning` | `NEBIUS_MODEL_DEEP_REASONING` | `deepseek-ai/DeepSeek-V4-Pro` | catalyst_identification, tail_risk | Required |
| `non_tool` | `NEBIUS_MODEL_NON_TOOL` | `moonshotai/Kimi-K3` | thesis, cross_exam, risk_aggressive/conservative/neutral, recommendation | Not used |
| `default` | `NEBIUS_MODEL_DEFAULT` | `MiniMaxAI/MiniMax-M3` | Portfolio Manager persona decisions | Required |

The logical keys (`nova_micro`, `nova_lite`, `nemotron`, `gpt_oss`, `kimi_k2`, `llama_3_3`, `nova_2_lite`) are historical names kept so the agent assignments stay stable across providers. They are not claims about which vendor serves the model.

NVIDIA Nemotron 3 Super is assigned to the agentic bucket because those stages are tool-heavy. The news agents and the web-research stage call external sources, observe results, and decide what to do next. That is a different workload from a non-tool synthesis stage that receives a complete context window and produces structured output.

## Why capability buckets instead of model names

A pipeline that names models in agent code couples every prompt, tool, and fallback path to one vendor's catalog. TradeWizard assigns agents to capabilities instead:

```ts
market_microstructure: 'nova_micro'   // logical key
nova_micro: 'fast'                    // capability
fast: 'Qwen/Qwen3-30B-A3B-Instruct-2507' // active provider model
```

The middle layer is what makes the provider a configuration boundary. It also makes the tool-calling contract explicit: a capability either supports tools or it does not. The registry throws during construction if a tool-using agent resolves to `non_tool`, so a bad environment fails before the first user request.

## Provider configuration

```bash
AI_PROVIDER=nebius
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
NEBIUS_MAX_TOKENS=30000

NEBIUS_MODEL_FAST=Qwen/Qwen3-30B-A3B-Instruct-2507
NEBIUS_MODEL_ANALYTICAL=Qwen/Qwen3-235B-A22B-Instruct-2507
NEBIUS_MODEL_AGENTIC=nvidia/nemotron-3-super-120b-a12b
NEBIUS_MODEL_REASONING=openai/gpt-oss-120b
NEBIUS_MODEL_DEEP_REASONING=deepseek-ai/DeepSeek-V4-Pro
NEBIUS_MODEL_NON_TOOL=moonshotai/Kimi-K3
NEBIUS_MODEL_DEFAULT=MiniMaxAI/MiniMax-M3
```

Optional per-capability limits override `NEBIUS_MAX_TOKENS`:

```bash
NEBIUS_MODEL_FAST_MAX_TOKENS=
NEBIUS_MODEL_ANALYTICAL_MAX_TOKENS=
NEBIUS_MODEL_AGENTIC_MAX_TOKENS=
NEBIUS_MODEL_REASONING_MAX_TOKENS=
NEBIUS_MODEL_DEEP_REASONING_MAX_TOKENS=
NEBIUS_MODEL_NON_TOOL_MAX_TOKENS=
NEBIUS_MODEL_DEFAULT_MAX_TOKENS=
```

Set `AI_PROVIDER=nebius` explicitly in `.env.dev` / `.env.prod`; `.env.example` ships with Nebius selected.

## Credentials

`deploy.sh` stores `NEBIUS_API_KEY` in Secrets Manager as `tw-{env}-nebius-api-key` with the shape:

```json
{ "apiKey": "..." }
```

The Lambda receives only the secret ARN (`NEBIUS_API_KEY_SECRET_ARN`). At runtime, `getNebiusApiKey()` reads the secret, extracts only the `apiKey` field, and caches it in-process for five minutes. An environment variable fallback exists for local development; it is not the production path. The key never reaches the browser.

The `apiKey`-only extraction is intentional. CDK creates the secret resource with a generated placeholder when no value is supplied; the provider ignores any secret value that does not parse as the expected JSON shape, so an unpopulated secret fails cleanly instead of producing a confusing 401.

## Model construction

Token Factory exposes the OpenAI-compatible Chat Completions surface. Strands defaults to the Responses API, so the provider explicitly selects the chat surface:

```ts
new OpenAIModel({
  api: 'chat',
  modelId: spec.modelId,
  maxTokens: spec.maxTokens,
  apiKey: async () => getNebiusApiKey(),
  clientConfig: { baseURL: getNebiusBaseUrl() },
});
```

Everything above that constructor is provider-neutral: Strands agents, tool definitions, structured output extraction, and the deterministic pipeline.

## Validation before deployment

Catalog IDs change. Tool-calling support varies by model. Both are checked before an analysis runs:

```bash
cd infra
set -a; source .env.dev; set +a
npx tsx scripts/validate-nebius.ts
```

The validator checks:

1. Every configured `NEBIUS_MODEL_*` ID exists in `/v1/models`.
2. Every tool-capable capability returns a `tool_calls` response.
3. The model can emit JSON that the pipeline's extractor can parse.

Run it after changing a model ID, not after a failed analysis.

## Failure behavior

| Failure | Behavior |
|---------|----------|
| Missing model ID with `AI_PROVIDER=nebius` | Cold-start validation throws; the Lambda does not start an incomplete run |
| Missing/invalid API key | `getNebiusApiKey()` throws; the analysis fails before agent execution |
| Tool-using agent mapped to `non_tool` | Registry construction throws |
| One agent returns invalid JSON | That agent's signal is excluded; valid signals continue |
| More than 10 of 14 agents fail | Workflow aborts to `NO_TRADE`; the user is refunded |
| Token Factory throttling | Treated as partial agent failure; valid signals continue, coverage rules decide whether to proceed |
| Provider outage mid-run | Deterministic gates still execute; incomplete coverage forces `NO_TRADE` rather than a low-confidence recommendation |

The system does not retry indefinitely. A provider that is slow or unavailable is a reason to return no trade, not a reason to lower the evidence threshold.

## Observability and cost

- **Inference cost** is per-token on Token Factory. The market-level analysis pool limits fresh runs to one per market per hour, so cost scales with distinct markets rather than user requests.
- **Model routing** is logged by logical key and model ID, which makes it possible to attribute latency and failures to a capability.
- **Agent coverage** is tracked per run. A degraded run is visible in the result metadata rather than silently presented as a full analysis.
- **Rate limits** are account-level and dynamic. The system does not assume a fixed RPM budget; it observes failures and degrades through the same path as any other partial agent failure.

## Local development

```bash
# Optional: use a local env fallback instead of Secrets Manager
export AI_PROVIDER=nebius
export NEBIUS_API_KEY=...
export NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/

# Validate the configured catalog
cd infra
npx tsx scripts/validate-nebius.ts

# Run the provider tests
npm test -- services/shared/ai-provider.test.ts
```

The tests cover provider selection, capability mapping, tool-calling invariants, model construction for both providers, and key extraction/caching.

## Files to read

- `infra/services/shared/ai-provider.ts` - provider selection, capability mapping, key handling, model factory.
- `infra/services/analysis-lambda/lib/multi-model.ts` - agent/stage assignments and registry construction.
- `infra/services/portfolio-lambda/lib/model.ts` - portfolio model resolution.
- `infra/scripts/validate-nebius.ts` - catalog, tool-calling, and JSON validation.
- `infra/lib/compute-stack.ts` - secret provisioning and Lambda environment wiring.
