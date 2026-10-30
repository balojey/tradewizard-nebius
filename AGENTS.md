# AGENTS.md

TradeWizard: AI prediction-trading platform for Polymarket. Two independent Node packages (own `package.json` / `node_modules`, no shared code): `infra/` (AWS CDK + Lambda backend) and `tradewizard-frontend/` (Next.js 16 App Router). Read `.kiro/steering/{product,structure,tech}.md` for the authoritative architecture before big changes — the root/infra READMEs are long but partially stale.

## Commands

### infra/
```bash
npm run build        # tsc typecheck (no bundling)
npm test             # vitest (shared email sender tests + future suites)
npm run synth:dev    # cdk synth -c env=development   (env context is required)
npm run diff:dev     # cdk diff -c env=development
./deploy.sh up dev   # full deploy: loads .env.dev, then CDK + CLOB/Resend/Nebius creds + DB migration + SES
./deploy.sh up dev --skip-db   # CDK-only, fastest iteration
./deploy.sh status dev
```
- `deploy.sh` loads gitignored `.env.dev` / `.env.prod` (fallback `.env`); env vars there feed `lib/config.ts` and CDK. `--skip-agents` is NOT supported (only `--skip-db`); docs referencing it are wrong.
- `down prod` requires typing the env name; dev asks for Enter.
- Lambda handlers are `infra/services/<service>/handler.ts`, wired in `lib/compute-stack.ts`.

### tradewizard-frontend/
```bash
npm run dev / build / start / lint
npx tsc --noEmit     # typecheck (no script exists; build does it in CI)
```
- No test runner. Amplify CI (`amplify.yml`) builds with Node 20 (`nvm use 20`).

## Architecture gotchas

- **User identity**: cross-service contracts (DynamoDB, SNS, EventBridge) use the internal `users.id` UUID, never the Cognito `cognito_sub`. Translate at the boundary via `getUserIdByCognitoSub()` in `infra/services/shared/db.ts`. Handlers receive the JWT `sub` from API Gateway; always resolve before touching Aurora/DynamoDB.
- **DB schema**: one consolidated, idempotent file `infra/sql/001-schema.sql` (deploy.sh runs it via psql, safe to re-run). Do not create new `NNN-*.sql` files without coordinating deploy.sh; docs referencing split `001-initial-schema.sql` / `003-portfolio-manager.sql` are stale.
- **Analysis pipeline**: all 14 intelligence agents run on every market (no conditional selection). Prompts live in `analysis-lambda/stages/intelligence-agents.ts`; logical model assignments live in `analysis-lambda/lib/multi-model.ts` and resolve through `services/shared/ai-provider.ts` to Nebius Token Factory (`AI_PROVIDER=nebius`, the default in `compute-stack.ts` and `ai-provider.ts`). `signal-fusion`, `consensus-engine`, and `lib/shadow-consensus.ts` are deterministic (no LLM) — keep them that way. `analysis-orchestrator` is a thin dispatcher invoking `analysis-lambda` via `@aws-sdk/client-lambda`.
- **Gates between the agents and the user**: `stages/signal-fusion.ts` de-biases each agent forecast against its own fitted calibration line (`lib/calibration.ts`, fits in `stages/historical-context.ts#fetchAgentCalibration`, seed in `lib/calibration-seed.ts`) and applies evidence-scaled pass-through plus a Kish effective-sample-size standard error (`fairValueStandardError`). `stages/consensus-engine.ts` turns that into a decision through `GATE_PROFILE` (`actionable` default, `strict` for the old flat-4c behaviour), persisting a machine-readable `no_trade_reason`. Never move these decisions into a prompt.
- **Shadow consensus is measurement only**: `lib/shadow-consensus.ts` computes an agent-driven (vote-based, calibrated) decision next to the live one and never influences the recommendation. It is stored as `shadow_*` columns on `analysis_results` and graded against the live decision by `recommendation-scorer` on a fixed `SHADOW_PNL_HORIZON_HOURS` move; inspect with `infra/scripts/agent-calibration-report.sql`. Only promote it into the live path when the shadow P&L justifies it.
- **AI provider**: `AI_PROVIDER=nebius` (Nebius Token Factory) is the default. Nebius uses the OpenAI-compatible Token Factory API via Strands `OpenAIModel` and the `tw-{env}-nebius-api-key` secret (`NEBIUS_API_KEY` in `.env` feeds deploy.sh). It only changes model inference; Polymarket order execution stays in the portfolio executor. Tool-using agents must map to tool-capable capabilities (`fast`, `analytical`, `agentic`, `reasoning`, `deep_reasoning`, `default`); `non_tool` is only for stages without tools. Validate IDs/tool calling with `infra/scripts/validate-nebius.ts`.
- **Env knobs**: `AI_PROVIDER=nebius`, `NEBIUS_MODEL_*`, `ANALYSIS_HISTORY_DEPTH` (default 5, clamped 1–20), and the deterministic gate knobs `FUSION_MAX_PASS_THROUGH` (0.6), `GATE_PROFILE` (`actionable`), `MIN_ACTIONABLE_EDGE` (0.04), `MIN_EDGE_SIGMA` (2), `MAX_ACTIONABLE_DIVERGENCE` (0.15), `SHADOW_PNL_HORIZON_HOURS` (24) set in compute-stack; see `infra/.env.example`. `FUSION_SHRINKAGE` is still read as a legacy fallback for the pass-through.
- **Portfolio manager** lambdas lazy-load Polymarket CLOB credentials from Secrets Manager `tw-{env}-clob-credentials` (`services/shared/clob-credentials.ts`) and refuse to place/cancel orders when empty. Set `CLOB_API_KEY/SECRET/PASSPHRASE` in `.env.dev` and re-deploy.
- **Email delivery**: all transactional email goes through `services/shared/email.ts`. Resend is primary (`EMAIL_PROVIDER=resend`, key in Secrets Manager `tw-{env}-resend-api-key`, `RESEND_API_KEY` in `.env` feeds deploy.sh); SES is retained but disabled unless `EMAIL_PROVIDER=ses`. Senders: `email-delivery` (analysis), `portfolio-notification` (portfolio events), `system-email-delivery` (subscription renewal/trial/downgrade notices). Do not add direct SES/Resend calls elsewhere.
- **Frontend provider order matters**: `providers/index.tsx` composes Auth → Wallet → Query → WebSocket → Trading. Auth outermost; WebSocket inside Query (it invalidates query cache). Auth tokens: localStorage `tw_*` keys; `middleware.ts` guards `/markets`, `/insights`, `/portfolio*`, `/account` via `tw_id_token` cookie.

## Stale sources

- `docs/agentcore-migration.md` describes a legacy architecture already replaced by the self-hosted Strands SDK Lambdas. `infra/README.md` and root `README.md` contain outdated file names, flags, and agent-count details — trust `.kiro/steering/` and the code over them.