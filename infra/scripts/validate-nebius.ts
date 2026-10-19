/**
 * Nebius Token Factory validation script.
 *
 * Run manually before setting AI_PROVIDER=nebius:
 *
 *   cd infra
 *   set -a; source .env.dev; set +a
 *   npx tsx scripts/validate-nebius.ts
 *
 * It verifies:
 * 1. The API key works and lists available models.
 * 2. Every configured NEBIUS_MODEL_* ID exists in the account's catalog.
 * 3. Tool-using capabilities actually return OpenAI-style tool calls.
 * 4. The model can emit JSON that the analysis pipeline's extractor can parse.
 *
 * Exit code is non-zero if any configured capability fails.
 */

import OpenAI from 'openai';
import { extractJson } from '../services/analysis-lambda/lib/json-extractor';

interface CapabilityCheck {
  name: string;
  envName: string;
  requiresTools: boolean;
}

const CAPABILITIES: CapabilityCheck[] = [
  { name: 'FAST', envName: 'NEBIUS_MODEL_FAST', requiresTools: true },
  { name: 'ANALYTICAL', envName: 'NEBIUS_MODEL_ANALYTICAL', requiresTools: true },
  { name: 'AGENTIC', envName: 'NEBIUS_MODEL_AGENTIC', requiresTools: true },
  { name: 'REASONING', envName: 'NEBIUS_MODEL_REASONING', requiresTools: true },
  { name: 'DEEP_REASONING', envName: 'NEBIUS_MODEL_DEEP_REASONING', requiresTools: true },
  { name: 'NON_TOOL', envName: 'NEBIUS_MODEL_NON_TOOL', requiresTools: false },
  { name: 'DEFAULT', envName: 'NEBIUS_MODEL_DEFAULT', requiresTools: true },
];

const TOOL_DEFINITION: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_market_price',
    description: 'Get the current price for a prediction market.',
    parameters: {
      type: 'object',
      properties: {
        marketId: {
          type: 'string',
          description: 'Polymarket condition/market identifier',
        },
      },
      required: ['marketId'],
    },
  },
};

interface CheckResult {
  capability: string;
  modelId: string;
  exists: boolean;
  toolCall: boolean | null;
  json: boolean;
  latencyMs: number;
  error?: string;
}

async function main(): Promise<void> {
  const apiKey = (process.env.NEBIUS_API_KEY || '').trim();
  if (!apiKey) {
    console.error('NEBIUS_API_KEY is not set. Source .env.dev first.');
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL:
      process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1/',
  });

  console.log('Fetching Nebius model catalog...');
  const modelPage = await client.models.list();
  const modelIds = new Set(modelPage.data.map((model) => model.id));

  console.log(`\nAvailable models (${modelIds.size}):`);
  for (const id of [...modelIds].sort()) {
    console.log(`  - ${id}`);
  }

  const results: CheckResult[] = [];

  for (const capability of CAPABILITIES) {
    const modelId = (process.env[capability.envName] || '').trim();

    if (!modelId) {
      console.warn(`\n[SKIP] ${capability.name}: ${capability.envName} is not set`);
      continue;
    }

    console.log(`\n[CHECK] ${capability.name}: ${modelId}`);

    if (!modelIds.has(modelId)) {
      results.push({
        capability: capability.name,
        modelId,
        exists: false,
        toolCall: null,
        json: false,
        latencyMs: 0,
        error: 'Model ID not present in /v1/models',
      });
      console.error('  FAIL: model ID is not in the catalog');
      continue;
    }

    const start = Date.now();
    let toolCall: boolean | null = null;
    let jsonOk = false;
    let error: string | undefined;

    try {
      if (capability.requiresTools) {
        const response = await client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: 'user',
              content:
                'Call the get_market_price tool for marketId "test-market". Do not answer without using the tool.',
            },
          ],
          tools: [TOOL_DEFINITION],
          tool_choice: 'auto',
          temperature: 0,
          // Reasoning models may spend tokens thinking before emitting the
          // tool call, so keep some headroom.
          max_tokens: 1024,
        });

        const call = response.choices[0]?.message?.tool_calls?.[0];
        toolCall =
          call?.type === 'function' && call.function.name === 'get_market_price';
      }

      const jsonResponse = await client.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: 'user',
            content:
              'Market: "Will the Federal Reserve cut rates in 2026?" Analyze it and return ONLY a JSON object with keys "direction" (YES or NO) and "confidence" (0 to 1). No markdown fences, no prose.',
          },
        ],
        temperature: 0,
        // Reasoning models can consume several thousand tokens before emitting
        // the final JSON; this is a capability check, not a latency benchmark.
        max_tokens: 4096,
      });

      const content = jsonResponse.choices[0]?.message?.content || '';
      jsonOk = extractJson(content) !== null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const latencyMs = Date.now() - start;
    results.push({
      capability: capability.name,
      modelId,
      exists: true,
      toolCall,
      json: jsonOk,
      latencyMs,
      error,
    });

    if (error) {
      console.error(`  FAIL: ${error}`);
    } else {
      console.log(
        `  toolCall=${toolCall === null ? 'n/a' : toolCall ? 'yes' : 'NO'} json=${jsonOk ? 'yes' : 'NO'} latency=${latencyMs}ms`
      );
    }
  }

  const failures = results.filter(
    (result) =>
      !result.exists ||
      !result.json ||
      (result.toolCall === false) ||
      result.error !== undefined
  );

  console.log('\nSummary:');
  for (const result of results) {
    const status = failures.includes(result) ? 'FAIL' : 'PASS';
    console.log(
      `  [${status}] ${result.capability.padEnd(15)} ${result.modelId} (${result.latencyMs}ms)`
    );
  }

  if (results.length === 0) {
    console.error('\nNo NEBIUS_MODEL_* values configured.');
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} capability check(s) failed.`);
    process.exit(1);
  }

  console.log('\nAll configured Nebius capabilities passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
