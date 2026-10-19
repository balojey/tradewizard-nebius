/**
 * Model bake-off for a single intelligence-agent role.
 *
 * Runs the real social_sentiment system prompt against candidate Bedrock
 * models with mock news/search tools (no external API calls), and measures
 * how often each model (a) uses tools through the proper channel and
 * (b) returns a parseable signal JSON.
 *
 * Usage: npx tsx scripts/bakeoff-models.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

function loadEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(join(__dirname, '..', '.env.dev'));
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const REPETITIONS = parseInt(process.env.BAKEOFF_REPS || '4', 10);
const ROLE = (process.env.BAKEOFF_ROLE || 'social_sentiment') as
  | 'social_sentiment'
  | 'market_microstructure';

const MODELS: Record<string, string> = {
  'Nova Micro (current)': 'us.amazon.nova-micro-v1:0',
  'Nova Lite (current)': 'us.amazon.nova-lite-v1:0',
  'Nova Pro': 'us.amazon.nova-pro-v1:0',
  'Nova 2 Lite (current)': 'global.amazon.nova-2-lite-v1:0',
  'Claude Haiku 4.5': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'Claude Sonnet 4.5': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'Claude Sonnet 4.6': 'us.anthropic.claude-sonnet-4-6',
  'Nemotron Super (current)': 'nvidia.nemotron-super-3-120b',
  'GPT-OSS 120B (current)': 'openai.gpt-oss-120b-1:0',
  'Qwen3 Next 80B': 'qwen.qwen3-next-80b-a3b',
  'GLM-5': 'zai.glm-5',
  'Devstral 2 123B': 'mistral.devstral-2-123b',
  'Mistral Large 3': 'mistral.mistral-large-3-675b-instruct',
  'MiniMax M2.5': 'minimax.minimax-m2.5',
  'Kimi K2.5': 'moonshotai.kimi-k2.5',
};

async function main(): Promise<void> {
  const { AGENT_SYSTEM_PROMPTS } = await import(
    '../services/analysis-lambda/stages/intelligence-agents'
  );
  const { Agent, tool } = await import('@strands-agents/sdk');
  const { extractJson } = await import('../services/analysis-lambda/lib/json-extractor');
  const { createProviderModel } = await import('../services/shared/ai-provider');

  const newsSchema = z.object({
    action: z.enum(['fetchLatestNews', 'fetchArchiveNews']),
    query: z.string().optional(),
    queryInTitle: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
    timeWindow: z.enum(['1h', '6h', '12h', '24h', '48h']).optional(),
    sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
  });

  const searchSchema = z.object({
    action: z.enum(['search', 'scrape']),
    query: z.string().optional(),
    url: z.string().optional(),
    numResults: z.number().int().min(1).max(20).optional(),
    timeRange: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
    country: z.string().length(2).optional(),
  });

  const makeTools = (onCall: () => void) => [
    tool({
      name: 'news_search',
      description: 'Search for news articles about a topic.',
      inputSchema: newsSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: async (): Promise<any> => {
        onCall();
        return {
          totalResults: 1,
          articles: [
            {
              title: 'Poll shows incumbent party trailing by 8 points',
              url: 'https://example.com/a',
              source: { name: 'Example News' },
              content: { description: 'Democrats lead the generic ballot by 8 points.' },
              metadata: { publishedAt: '2026-10-01' },
            },
          ],
        };
      },
    }),
    tool({
      name: 'search_web',
      description: 'Search the web or scrape a webpage.',
      inputSchema: searchSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: async (): Promise<any> => {
        onCall();
        return {
          results: [
            {
              title: 'Incumbent party struggles in 2026 midterms',
              snippet: 'Recent polling shows a challenging environment for the incumbent party.',
              url: 'https://example.com/b',
            },
          ],
        };
      },
    }),
  ];

  const priceCsv = '/tmp/bakeoff-price-history.csv';
  const rows = ['timestamp,price,volume'];
  let price = 0.43;
  for (let i = 0; i < 60; i++) {
    price = Math.max(0.05, Math.min(0.95, price + (Math.random() - 0.5) * 0.02));
    rows.push(`${Date.now() - (60 - i) * 3600_000},${price.toFixed(4)},${1000 + i}`);
  }
  writeFileSync(priceCsv, rows.join('\n'), 'utf8');

  const prompt =
    `## Market Question\nWill the incumbent party win the next national election scheduled for November 2026?\n\n` +
    `## Market Briefing\nMarket ID: bakeoff\nLiquidity: medium\nResolution: 2026-11-30\n\n` +
    (ROLE === 'market_microstructure'
      ? `## Price History Data\nFull price history CSV is available at: ${priceCsv}\nUse the shell_analysis tool to analyze it.\n\n`
      : '') +
    `## Price History Summary\nPrice ranged 0.35-0.50 over the last 5 days, currently ~0.43. Volume steady with a slight uptick in the last 24h.\n\n` +
    `## Related Markets Summary\nSibling races show the incumbent party polling 3-5 points behind in most competitive districts.\n\n` +
    `## Web Research Brief\nRecent national polling shows the incumbent party trailing the opposition by roughly 8 points on the generic ballot. Economic sentiment is negative, with inflation cited as the top concern. Several incumbent retirements have made defenses harder.\n\n` +
    `## Instructions\nAnalyze the market from your specialized perspective and respond with a JSON object containing: direction, confidence, fairProbability, keyDrivers, and riskFactors.`;

  const systemPrompt = AGENT_SYSTEM_PROMPTS[ROLE];

  interface Row {
    model: string;
    ok: number;
    runs: number;
    toolUse: number;
    latencies: number[];
    errors: string[];
  }

  const CONCURRENT = process.env.BAKEOFF_CONCURRENT === 'true';

  const runOnce = async (
    row: Row,
    modelId: string,
    sharedModel?: ReturnType<typeof createProviderModel>,
  ): Promise<void> => {
    let toolCalls = 0;
    const tools = makeTools(() => {
      toolCalls++;
    });
    const model =
      sharedModel ??
      createProviderModel({ provider: 'bedrock', modelId, region: 'us-east-1', maxTokens: 5120 });
    const agent = new Agent({ model, systemPrompt, tools, printer: false });
    const start = Date.now();
    try {
      const result = await Promise.race([
        agent.invoke(prompt),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 120s')), 120_000)),
      ]);
      row.latencies.push(Date.now() - start);
      const text = String(result);
      if (toolCalls > 0) row.toolUse++;
      const json = extractJson(text);
      const dirOk = json && ['YES', 'NO', 'NEUTRAL'].includes(String(json.direction).toUpperCase());
      const confOk = json && typeof json.confidence === 'number';
      if (dirOk && confOk) row.ok++;
      else row.errors.push(`parse:${(text || '').slice(0, 60).replace(/\s+/g, ' ')}`);
    } catch (error) {
      row.errors.push(
        `throw:${(error instanceof Error ? error.message : String(error)).slice(0, 80)}`,
      );
    }
  };

  const evaluate = async (label: string, modelId: string): Promise<Row> => {
    const row: Row = { model: label, ok: 0, runs: REPETITIONS, toolUse: 0, latencies: [], errors: [] };
    if (CONCURRENT) {
      // One shared model instance, REPETITIONS concurrent agents (mirrors the
      // pipeline, where 3 agents share a model inside one Lambda).
      const shared = createProviderModel({
        provider: 'bedrock',
        modelId,
        region: 'us-east-1',
        maxTokens: 5120,
      });
      await Promise.all(
        Array.from({ length: REPETITIONS }, () => runOnce(row, modelId, shared)),
      );
    } else {
      for (let r = 0; r < REPETITIONS; r++) {
        await runOnce(row, modelId, undefined);
      }
    }
    return row;
  };

  const entries = Object.entries(MODELS);
  const results: Row[] = await Promise.all(
    entries.map(([label, id]) => evaluate(label, id)),
  );

  console.log(`\nROLE: ${ROLE}  (${REPETITIONS} runs/model, mock tools)\n`);
  console.log(`${'MODEL'.padEnd(26)} ${'OK'.padEnd(6)} ${'TOOL'.padEnd(6)} ${'AVG LAT'.padEnd(9)} NOTES`);
  for (const r of results.sort((a, b) => b.ok - a.ok)) {
    const avg = r.latencies.length
      ? `${Math.round(r.latencies.reduce((s, x) => s + x, 0) / r.latencies.length)}ms`
      : '-';
    const note = r.errors.length ? r.errors[0].slice(0, 70) : '';
    console.log(
      `${r.model.padEnd(26)} ${`${r.ok}/${r.runs}`.padEnd(6)} ${`${r.toolUse}/${r.runs}`.padEnd(6)} ${avg.padEnd(9)} ${note}`,
    );
  }
}

main().catch((error) => {
  console.error('[bakeoff] failed:', error);
  process.exit(1);
});
