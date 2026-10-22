/**
 * Local diagnostic harness for the intelligence-agents stage.
 *
 * Loads infra/.env.dev (Bedrock models + NewsData/Serper keys), builds a
 * realistic agent context with a synthetic price-history CSV, and runs the
 * full 14-agent parallel stage so failures can be reproduced and inspected
 * outside Lambda.
 *
 * Usage:
 *   npx tsx scripts/debug-agents-local.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function loadEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.warn(`[debug] env file not found: ${path}`);
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
process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'bedrock';

// Build a small but realistic price history CSV for the shell-tool agents.
const csvPath = '/tmp/price-history-debug.csv';
const rows = ['timestamp,price,volume'];
let price = 0.42;
for (let i = 0; i < 120; i++) {
  price = Math.max(0.01, Math.min(0.99, price + (Math.random() - 0.5) * 0.03));
  const ts = new Date(Date.now() - (120 - i) * 3600_000).toISOString();
  rows.push(`${ts},${price.toFixed(4)},${Math.round(500 + Math.random() * 5000)}`);
}
writeFileSync(csvPath, rows.join('\n'), 'utf8');

async function main(): Promise<void> {
  // Import after env is loaded so the model registry sees the config.
  const { runIntelligenceAgents } = await import(
    '../services/analysis-lambda/stages/intelligence-agents'
  );

  const context = {
    marketQuestion:
      'Will the incumbent party win the next national election scheduled for November 2026?',
    csvPath,
    relatedMarketsJsonPath: '',
    priceHistorySummary:
      'Price ranged 0.35-0.50 over the last 5 days, currently ~0.43. Volume steady.',
    relatedMarketsSummary: '',
    webResearchBrief: 'Web research unavailable.',
    historicalEntries: [],
    currentMarketProbability: 0.43,
    marketEndDate: '2026-11-30T00:00:00Z',
    liquidity: 25_000,
    spread: 0.02,
    priceVolatility: 0.03,
    marketBriefing:
      'Market ID: debug-market\nLiquidity: medium\nResolution: 2026-11-30',
  };

  const start = Date.now();
  const result = await runIntelligenceAgents(context);
  console.log('\n========== RESULT ==========');
  console.log(`duration=${Date.now() - start}ms`);
  console.log(`successful (${result.successfulAgents.length}):`, result.successfulAgents.join(', '));
  console.log(`failed (${result.failedAgents.length}):`, result.failedAgents.join(', '));
  console.log(`aborted=${result.aborted}`);
  for (const signal of result.signals) {
    console.log(
      `  ${signal.agentName.padEnd(24)} ${signal.direction.padEnd(8)} ` +
        `conf=${signal.confidence.toFixed(2)} p=${signal.fairProbability.toFixed(2)}`,
    );
  }
}

main().catch((error) => {
  console.error('[debug] harness failed:', error);
  process.exit(1);
});
