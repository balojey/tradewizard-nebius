/**
 * Test script to verify the markets API proxy works with real Polymarket API
 * Tests both with and without event context
 */

const GAMMA_API_URL = "https://gamma-api.polymarket.com";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

async function testDirectMarketsEndpoint(): Promise<TestResult> {
  try {
    const url = `${GAMMA_API_URL}/markets?closed=false&order=volume24hr&ascending=false&limit=10&offset=0&tag_id=2`;
    
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return {
        name: "Direct Markets Endpoint",
        passed: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const markets = await response.json();

    if (!Array.isArray(markets)) {
      return {
        name: "Direct Markets Endpoint",
        passed: false,
        error: "Response is not an array",
      };
    }

    return {
      name: "Direct Markets Endpoint",
      passed: true,
      details: {
        marketsReceived: markets.length,
        sampleMarket: markets[0] ? {
          id: markets[0].id,
          question: markets[0].question,
          hasEvents: !!markets[0].events,
          eventsCount: markets[0].events?.length || 0,
        } : null,
      },
    };
  } catch (error) {
    return {
      name: "Direct Markets Endpoint",
      passed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testEventContextEnrichment(): Promise<TestResult> {
  try {
    const url = `${GAMMA_API_URL}/markets?closed=false&order=volume24hr&ascending=false&limit=20&offset=0&tag_id=2`;
    
    const response = await fetch(url);
    const markets = await response.json();

    if (!Array.isArray(markets)) {
      return {
        name: "Event Context Enrichment",
        passed: false,
        error: "Response is not an array",
      };
    }

    const marketsWithEvents = markets.filter(
      (m: any) => m.events && Array.isArray(m.events) && m.events.length > 0
    );
    const marketsWithoutEvents = markets.filter(
      (m: any) => !m.events || !Array.isArray(m.events) || m.events.length === 0
    );

    return {
      name: "Event Context Enrichment",
      passed: true,
      details: {
        totalMarkets: markets.length,
        marketsWithEvents: marketsWithEvents.length,
        marketsWithoutEvents: marketsWithoutEvents.length,
        sampleWithEvent: marketsWithEvents[0] ? {
          marketId: marketsWithEvents[0].id,
          marketQuestion: marketsWithEvents[0].question,
          eventTitle: marketsWithEvents[0].events[0].title,
          eventSlug: marketsWithEvents[0].events[0].slug,
        } : null,
        sampleWithoutEvent: marketsWithoutEvents[0] ? {
          marketId: marketsWithoutEvents[0].id,
          marketQuestion: marketsWithoutEvents[0].question,
        } : null,
      },
    };
  } catch (error) {
    return {
      name: "Event Context Enrichment",
      passed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testFilteringLogic(): Promise<TestResult> {
  try {
    const url = `${GAMMA_API_URL}/markets?closed=false&order=volume24hr&ascending=false&limit=50&offset=0&tag_id=2`;
    
    const response = await fetch(url);
    const markets = await response.json();

    if (!Array.isArray(markets)) {
      return {
        name: "Filtering Logic",
        passed: false,
        error: "Response is not an array",
      };
    }

    const MIN_LIQUIDITY_USD = 1000;
    const MIN_LIQUIDITY_NON_EVERGREEN_USD = 5000;
    const EVERGREEN_TAG_IDS = [2, 21, 120, 596, 1401, 100265, 100639];

    const validMarkets = markets.filter((market: any) => {
      if (!market.clobTokenIds) return false;
      if (market.closed === true) return false;
      if (market.acceptingOrders === false) return false;

      if (market.outcomePrices) {
        try {
          const prices = JSON.parse(market.outcomePrices);
          const hasTradeablePrice = prices.some((price: string) => {
            const priceNum = parseFloat(price);
            return priceNum >= 0.05 && priceNum <= 0.95;
          });
          if (!hasTradeablePrice) return false;
        } catch {
          return false;
        }
      }

      const marketTagIds = market.tags?.map((t: any) => parseInt(t.id)) || [];
      const hasEvergreenTag = EVERGREEN_TAG_IDS.some((id) =>
        marketTagIds.includes(id)
      );
      const liquidity = parseFloat(market.liquidity || "0");

      if (!hasEvergreenTag && liquidity < MIN_LIQUIDITY_NON_EVERGREEN_USD) {
        return false;
      }
      if (liquidity < MIN_LIQUIDITY_USD) return false;

      return true;
    });

    return {
      name: "Filtering Logic",
      passed: true,
      details: {
        totalMarkets: markets.length,
        validMarkets: validMarkets.length,
        filteredOut: markets.length - validMarkets.length,
        filterRate: `${((validMarkets.length / markets.length) * 100).toFixed(1)}%`,
      },
    };
  } catch (error) {
    return {
      name: "Filtering Logic",
      passed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testClosedMarkets(): Promise<TestResult> {
  try {
    const url = `${GAMMA_API_URL}/markets?closed=true&order=volume24hr&ascending=false&limit=10&offset=0&tag_id=2`;
    
    const response = await fetch(url);
    const markets = await response.json();

    if (!Array.isArray(markets)) {
      return {
        name: "Closed Markets",
        passed: false,
        error: "Response is not an array",
      };
    }

    const closedMarkets = markets.filter((m: any) => m.closed === true);

    return {
      name: "Closed Markets",
      passed: true,
      details: {
        totalMarkets: markets.length,
        closedMarkets: closedMarkets.length,
        sampleClosedMarket: closedMarkets[0] ? {
          id: closedMarkets[0].id,
          question: closedMarkets[0].question,
          endDate: closedMarkets[0].endDate || closedMarkets[0].endDateIso,
        } : null,
      },
    };
  } catch (error) {
    return {
      name: "Closed Markets",
      passed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function runTests() {
  console.log("🧪 Testing Markets API with Real Polymarket API\n");
  console.log("=" .repeat(60));

  const tests = [
    testDirectMarketsEndpoint,
    testEventContextEnrichment,
    testFilteringLogic,
    testClosedMarkets,
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    const result = await test();
    results.push(result);

    console.log(`\n${result.passed ? "✅" : "❌"} ${result.name}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    if (result.details) {
      console.log(`   Details:`, JSON.stringify(result.details, null, 2));
    }
  }

  console.log("\n" + "=".repeat(60));
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n📊 Results: ${passedCount}/${results.length} tests passed`);

  if (passedCount === results.length) {
    console.log("✅ All tests passed!");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    process.exit(1);
  }
}

runTests();
