/**
 * Test script: Correct flow for fetching related markets (sibling outcomes) on Polymarket
 *
 * On Polymarket, every market is binary (YES/NO). Multi-outcome questions like
 * "Which AI company will win?" are modeled as an EVENT containing multiple binary
 * markets - one per outcome. These sibling markets share a parent event.
 *
 * The correct flow to discover siblings:
 *   1. CLOB API: GET /markets/{condition_id} → returns market_slug (+ tokens, prices, etc.)
 *   2. Gamma API: GET /markets/slug/{market_slug} → returns full market details including events[].slug
 *   3. Gamma API: GET /events/slug/{event_slug} → returns the event with ALL sibling markets
 *
 * Usage:
 *   npx tsx infra/scripts/test-related-markets-flow.ts <condition_id>
 *
 * Example:
 *   npx tsx infra/scripts/test-related-markets-flow.ts 0x123abc...
 */

const CLOB_API_URL = 'https://clob.polymarket.com';
const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const FETCH_TIMEOUT_MS = 15_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClobMarket {
  condition_id: string;
  question: string;
  market_slug: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  neg_risk: boolean;
  neg_risk_market_id?: string;
  active: boolean;
  closed: boolean;
  [key: string]: unknown;
}

interface GammaMarket {
  id: string;
  question: string | null;
  conditionId: string;
  slug: string | null;
  outcomes: string | null;
  outcomePrices: string | null;
  clobTokenIds: string | null;
  volume: string | null;
  liquidity: string | null;
  active: boolean | null;
  closed: boolean | null;
  endDateIso: string | null;
  groupItemTitle: string | null;
  negRiskOther: boolean | null;
  events: Array<{
    id: string;
    slug: string | null;
    title: string | null;
    negRisk: boolean | null;
    markets: GammaMarket[];
  }>;
  [key: string]: unknown;
}

interface GammaEvent {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  negRisk: boolean | null;
  negRiskMarketID: string | null;
  active: boolean | null;
  closed: boolean | null;
  volume: number | null;
  liquidity: number | null;
  markets: GammaMarket[];
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as T;
  } catch (err: any) {
    if (err.cause) {
      throw new Error(`Fetch failed for ${url}\n  Reason: ${err.cause.message || err.cause}\n  (${err.message})`);
    }
    throw new Error(`Fetch failed for ${url}\n  ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Step 1: CLOB API - get market by condition_id (returns market_slug) ─────

async function step1_fetchClobMarket(conditionId: string): Promise<ClobMarket> {
  const url = `${CLOB_API_URL}/markets/${conditionId}`;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`STEP 1: Fetch market from CLOB API by condition_id`);
  console.log(`  GET ${url}`);
  console.log(`${'═'.repeat(70)}`);

  const market = await fetchJson<ClobMarket>(url);

  console.log(`\n  ✓ Response keys: ${Object.keys(market).join(', ')}`);
  console.log(`\n  Market details:`);
  console.log(`    question:      ${market.question}`);
  console.log(`    condition_id:  ${market.condition_id}`);
  console.log(`    market_slug:   ${market.market_slug}`);
  console.log(`    neg_risk:      ${market.neg_risk}`);
  console.log(`    active:        ${market.active}`);
  console.log(`    closed:        ${market.closed}`);

  if (market.tokens && market.tokens.length > 0) {
    console.log(`    tokens:`);
    for (const t of market.tokens) {
      console.log(`      - outcome: "${t.outcome}", price: ${t.price}, token_id: ${t.token_id.slice(0, 24)}...`);
    }
  }

  if (!market.market_slug) {
    throw new Error('CLOB response is missing market_slug - cannot proceed to Gamma API');
  }

  return market;
}

// ─── Step 2: Gamma API - get full market by slug (returns event slug) ────────

async function step2_fetchGammaMarket(marketSlug: string): Promise<GammaMarket> {
  // Try path-based endpoint first, fall back to query param variant
  const pathUrl = `${GAMMA_API_URL}/markets/slug/${marketSlug}`;
  const queryUrl = `${GAMMA_API_URL}/markets?slug=${marketSlug}`;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`STEP 2: Fetch full market details from Gamma API by slug`);
  console.log(`  Trying: GET ${pathUrl}`);
  console.log(`  Fallback: GET ${queryUrl}`);
  console.log(`${'═'.repeat(70)}`);

  let market: GammaMarket;

  try {
    market = await fetchJson<GammaMarket>(pathUrl);
  } catch (err: any) {
    console.log(`\n  ⚠ Path endpoint failed: ${err.message}`);
    console.log(`  Trying query parameter variant...`);

    const results = await fetchJson<GammaMarket[]>(queryUrl);
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`Gamma API returned no results for slug "${marketSlug}"`);
    }
    market = results[0];
  }

  console.log(`\n  ✓ Gamma market:`);
  console.log(`    id:             ${market.id}`);
  console.log(`    question:       ${market.question}`);
  console.log(`    conditionId:    ${market.conditionId}`);
  console.log(`    slug:           ${market.slug}`);
  console.log(`    outcomes:       ${market.outcomes}`);
  console.log(`    outcomePrices:  ${market.outcomePrices}`);
  console.log(`    groupItemTitle: ${market.groupItemTitle}`);
  console.log(`    volume:         ${market.volume}`);

  if (market.events && market.events.length > 0) {
    console.log(`\n  Parent event(s):`);
    for (const ev of market.events) {
      console.log(`    - id: ${ev.id}, slug: "${ev.slug}", title: "${ev.title}", negRisk: ${ev.negRisk}`);
    }
  } else {
    console.log(`\n  ⚠ No parent event found - this is a standalone market with no siblings`);
  }

  return market;
}

// ─── Step 3: Gamma API - get event by slug (returns ALL sibling markets) ─────

async function step3_fetchGammaEvent(eventSlug: string): Promise<GammaEvent> {
  const pathUrl = `${GAMMA_API_URL}/events/slug/${eventSlug}`;
  const queryUrl = `${GAMMA_API_URL}/events?slug=${eventSlug}`;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`STEP 3: Fetch event with ALL sibling markets from Gamma API`);
  console.log(`  Trying: GET ${pathUrl}`);
  console.log(`  Fallback: GET ${queryUrl}`);
  console.log(`${'═'.repeat(70)}`);

  let event: GammaEvent;

  try {
    event = await fetchJson<GammaEvent>(pathUrl);
  } catch (err: any) {
    console.log(`\n  ⚠ Path endpoint failed: ${err.message}`);
    console.log(`  Trying query parameter variant...`);

    const results = await fetchJson<GammaEvent[]>(queryUrl);
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`Gamma API returned no results for event slug "${eventSlug}"`);
    }
    event = results[0];
  }

  console.log(`\n  ✓ Event:`);
  console.log(`    id:          ${event.id}`);
  console.log(`    title:       ${event.title}`);
  console.log(`    slug:        ${event.slug}`);
  console.log(`    negRisk:     ${event.negRisk}`);
  console.log(`    active:      ${event.active}`);
  console.log(`    closed:      ${event.closed}`);
  console.log(`    volume:      ${event.volume}`);
  console.log(`    liquidity:   ${event.liquidity}`);

  const markets = event.markets || [];
  console.log(`\n  Sibling markets (${markets.length} total):`);
  console.log(`  ${'─'.repeat(60)}`);

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    let outcomes: string[] = [];
    let prices: string[] = [];
    try { outcomes = m.outcomes ? JSON.parse(m.outcomes) : []; } catch {}
    try { prices = m.outcomePrices ? JSON.parse(m.outcomePrices) : []; } catch {}

    const label = m.groupItemTitle || m.question || 'Unknown';
    const yesPrice = prices[0] ? parseFloat(prices[0]) : 0;

    console.log(`\n  [${i + 1}] ${label}`);
    console.log(`      conditionId:    ${m.conditionId}`);
    console.log(`      slug:           ${m.slug}`);
    console.log(`      outcomes:       ${JSON.stringify(outcomes)}`);
    console.log(`      YES price:      ${(yesPrice * 100).toFixed(1)}¢`);
    console.log(`      active:         ${m.active}`);
    console.log(`      volume:         ${m.volume}`);
  }

  return event;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const conditionId = process.argv[2];

  if (!conditionId) {
    console.error(`
Usage: npx tsx infra/scripts/test-related-markets-flow.ts <condition_id>

You need to provide a Polymarket condition ID to test with.
You can find one from the Polymarket URL or from your database.

Example:
  npx tsx infra/scripts/test-related-markets-flow.ts 0x1234abcd...
`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Polymarket: Fetch Related Markets (Sibling Outcomes) Flow Test     ║');
  console.log('║                                                                     ║');
  console.log('║  Correct flow:                                                      ║');
  console.log('║    1. CLOB API: /markets/{condition_id} → get market_slug           ║');
  console.log('║    2. Gamma API: /markets/slug/{slug} → get event slug              ║');
  console.log('║    3. Gamma API: /events/slug/{event_slug} → ALL sibling markets    ║');
  console.log('║                                                                     ║');
  console.log('║  Every Polymarket market is binary (YES/NO). Multi-outcome          ║');
  console.log('║  questions are events containing multiple sibling binary markets.   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Input condition_id: ${conditionId}`);

  // Step 1
  const clobMarket = await step1_fetchClobMarket(conditionId);

  // Step 2
  const gammaMarket = await step2_fetchGammaMarket(clobMarket.market_slug);

  if (!gammaMarket.events || gammaMarket.events.length === 0) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`RESULT: Standalone binary market - no parent event, no siblings.`);
    console.log(`${'═'.repeat(70)}\n`);
    return;
  }

  const eventSlug = gammaMarket.events[0].slug;
  if (!eventSlug) {
    throw new Error('Event exists but has no slug - cannot fetch event details');
  }

  // Step 3
  const event = await step3_fetchGammaEvent(eventSlug);

  // ─── Summary ───────────────────────────────────────────────────────────────
  const markets = event.markets || [];
  const targetIdx = markets.findIndex(m => m.conditionId === conditionId);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`SUMMARY`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Event title:     "${event.title}"`);
  console.log(`  Event slug:      ${event.slug}`);
  console.log(`  Neg risk event:  ${event.negRisk}`);
  console.log(`  Total markets:   ${markets.length}`);
  console.log(`  Target market:   #${targetIdx + 1} of ${markets.length}`);
  console.log(`  Sibling markets: ${Math.max(0, markets.length - 1)}`);

  if (markets.length > 1) {
    console.log(`\n  Probability distribution across outcomes:`);
    let totalProb = 0;
    for (const m of markets) {
      let prices: string[] = [];
      try { prices = m.outcomePrices ? JSON.parse(m.outcomePrices) : []; } catch {}
      const yesPrice = prices[0] ? parseFloat(prices[0]) : 0;
      totalProb += yesPrice;

      const label = m.groupItemTitle || m.question || 'Unknown';
      const isTarget = m.conditionId === conditionId;
      console.log(`    ${isTarget ? '→' : ' '} ${(yesPrice * 100).toFixed(1)}% - ${label}${isTarget ? ' ← TARGET' : ''}`);
    }
    console.log(`    ${'─'.repeat(50)}`);
    console.log(`    ${(totalProb * 100).toFixed(1)}% total (≈100% for neg_risk events)`);
  }

  console.log(`\n✓ Flow complete!\n`);
}

main().catch((error) => {
  console.error(`\n✗ Error: ${error.message}\n`);
  process.exit(1);
});
