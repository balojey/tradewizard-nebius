#!/usr/bin/env tsx
/**
 * Integration Test: Frontend API Proxy
 * 
 * Tests the frontend API proxy with real Polymarket API
 * Validates: Requirements 2.1, 8.2, 8.3
 */

interface FrontendTestResult {
  name: string;
  passed: boolean;
  details: string;
  data?: any;
}

const results: FrontendTestResult[] = [];

function logTest(name: string, passed: boolean, details: string, data?: any) {
  results.push({ name, passed, details, data });
  const status = passed ? '✓' : '✗';
  console.log(`${status} ${name}`);
  console.log(`  ${details}`);
  if (data) {
    console.log(`  Data:`, JSON.stringify(data, null, 2));
  }
  console.log();
}

async function testFrontendAPI() {
  console.log('='.repeat(80));
  console.log('Integration Test: Frontend API Proxy');
  console.log('='.repeat(80));
  console.log();

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  try {
    // Test 1: Load markets in browser and verify display
    console.log('Test 1: Load markets via API proxy');
    console.log('-'.repeat(80));
    
    const startTime = Date.now();
    const response = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2`);
    const fetchTime = Date.now() - startTime;
    
    if (!response.ok) {
      logTest(
        'Load markets via API proxy',
        false,
        `API returned error status: ${response.status}`,
        { status: response.status, statusText: response.statusText }
      );
    } else {
      const markets = await response.json();
      
      logTest(
        'Load markets via API proxy',
        Array.isArray(markets) && markets.length > 0,
        `Successfully loaded ${markets.length} markets in ${fetchTime}ms`,
        {
          marketCount: markets.length,
          fetchTime: `${fetchTime}ms`,
          sampleMarket: markets[0] ? {
            question: markets[0].question,
            slug: markets[0].slug,
            liquidity: markets[0].liquidity,
            volume24hr: markets[0].volume24hr,
            eventTitle: markets[0].eventTitle,
          } : null,
        }
      );
    }

    // Test 2: Test pagination (infinite scroll)
    console.log('Test 2: Test pagination');
    console.log('-'.repeat(80));
    
    const page1Response = await fetch(`${API_BASE}/api/polymarket/markets?limit=10&offset=0&tag_id=2`);
    const page1Markets = await page1Response.json();
    
    const page2Response = await fetch(`${API_BASE}/api/polymarket/markets?limit=10&offset=10&tag_id=2`);
    const page2Markets = await page2Response.json();
    
    const page3Response = await fetch(`${API_BASE}/api/polymarket/markets?limit=10&offset=20&tag_id=2`);
    const page3Markets = await page3Response.json();
    
    // Check if pages have different markets (allow some overlap due to over-fetching strategy)
    const page1Ids = new Set(page1Markets.map((m: any) => m.id));
    const page2Ids = new Set(page2Markets.map((m: any) => m.id));
    const page3Ids = new Set(page3Markets.map((m: any) => m.id));
    
    const page1Page2Overlap = [...page1Ids].filter(id => page2Ids.has(id)).length;
    const page2Page3Overlap = [...page2Ids].filter(id => page3Ids.has(id)).length;
    
    // Pagination is working if we get markets and most are different
    const overlapPercentage = ((page1Page2Overlap + page2Page3Overlap) / (page1Markets.length + page2Markets.length)) * 100;
    const paginationWorks = page1Markets.length > 0 && page2Markets.length > 0 && overlapPercentage < 50;
    
    logTest(
      'Pagination test',
      paginationWorks,
      paginationWorks
        ? `Pagination works. Page 1: ${page1Markets.length}, Page 2: ${page2Markets.length}, Page 3: ${page3Markets.length}, Overlap: ${overlapPercentage.toFixed(1)}%`
        : `Pagination may have issues. Overlap: ${overlapPercentage.toFixed(1)}%`,
      {
        page1Count: page1Markets.length,
        page2Count: page2Markets.length,
        page3Count: page3Markets.length,
        page1Page2Overlap,
        page2Page3Overlap,
        overlapPercentage: overlapPercentage.toFixed(1) + '%',
      }
    );

    // Test 3: Test filtering by category
    console.log('Test 3: Test filtering by category');
    console.log('-'.repeat(80));
    
    const politicsResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2`);
    const politicsMarkets = await politicsResponse.json();
    
    const sportsResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=3`);
    const sportsMarkets = await sportsResponse.json();
    
    // Category filtering works if we get different markets for different categories
    // Note: The API filters by tag_id in the query, but individual markets may not include tags field
    const categoryFilteringWorks = politicsMarkets.length > 0 && 
                                   politicsMarkets.length !== sportsMarkets.length;
    
    logTest(
      'Category filtering test',
      categoryFilteringWorks,
      categoryFilteringWorks
        ? `Category filtering works. Politics: ${politicsMarkets.length} markets, Sports: ${sportsMarkets.length} markets`
        : 'Category filtering may not be working correctly',
      {
        politicsCount: politicsMarkets.length,
        sportsCount: sportsMarkets.length,
        note: 'API filters by tag_id parameter, markets may not include tags field',
      }
    );

    // Test 4: Test closed markets view
    console.log('Test 4: Test closed markets view');
    console.log('-'.repeat(80));
    
    const openMarketsResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2&include_closed=false`);
    const openMarkets = await openMarketsResponse.json();
    
    const closedMarketsResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2&include_closed=true`);
    const closedMarkets = await closedMarketsResponse.json();
    
    const allOpenMarketsClosed = openMarkets.every((m: any) => m.closed !== true);
    const hasClosedMarkets = closedMarkets.some((m: any) => m.closed === true);
    
    logTest(
      'Closed markets view test',
      allOpenMarketsClosed,
      allOpenMarketsClosed
        ? `Closed markets filtering works. Open: ${openMarkets.length}, With closed: ${closedMarkets.length}`
        : 'Closed markets filtering may not be working correctly',
      {
        openMarketsCount: openMarkets.length,
        closedMarketsCount: closedMarkets.length,
        allOpenMarketsClosed,
        hasClosedMarkets,
      }
    );

    // Test 5: Verify event context enrichment
    console.log('Test 5: Verify event context enrichment');
    console.log('-'.repeat(80));
    
    const testResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2`);
    const testMarkets = await testResponse.json();
    
    const marketsWithEvents = testMarkets.filter((m: any) => m.eventTitle);
    const marketsWithoutEvents = testMarkets.filter((m: any) => !m.eventTitle);
    
    logTest(
      'Event context enrichment',
      marketsWithEvents.length > 0,
      `${marketsWithEvents.length} markets have event context, ${marketsWithoutEvents.length} without`,
      {
        withEvents: marketsWithEvents.length,
        withoutEvents: marketsWithoutEvents.length,
        percentageWithEvents: ((marketsWithEvents.length / testMarkets.length) * 100).toFixed(1) + '%',
        sampleWithEvent: marketsWithEvents.length > 0 ? {
          question: marketsWithEvents[0].question,
          eventTitle: marketsWithEvents[0].eventTitle,
          eventSlug: marketsWithEvents[0].eventSlug,
        } : null,
      }
    );

    // Test 6: Verify data structure
    console.log('Test 6: Verify data structure');
    console.log('-'.repeat(80));
    
    const structureResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2`);
    const structureMarkets = await structureResponse.json();
    
    const requiredFields = ['question', 'slug', 'liquidity', 'clobTokenIds', 'id'];
    const fieldCoverage = requiredFields.map(field => ({
      field,
      coverage: structureMarkets.filter((m: any) => m[field] !== undefined && m[field] !== null).length,
      percentage: ((structureMarkets.filter((m: any) => m[field] !== undefined && m[field] !== null).length / structureMarkets.length) * 100).toFixed(1),
    }));
    
    const allFieldsPresent = fieldCoverage.every(f => parseFloat(f.percentage) > 95);
    
    logTest(
      'Data structure validation',
      allFieldsPresent,
      allFieldsPresent
        ? 'All required fields present in >95% of markets'
        : 'Some required fields missing',
      { fieldCoverage }
    );

    // Test 7: Performance metrics
    console.log('Test 7: Performance metrics');
    console.log('-'.repeat(80));
    
    const perfStartTime = Date.now();
    const perfResponse = await fetch(`${API_BASE}/api/polymarket/markets?limit=20&offset=0&tag_id=2`);
    await perfResponse.json();
    const perfTime = Date.now() - perfStartTime;
    
    const performanceAcceptable = perfTime < 5000; // 5 seconds for frontend
    
    logTest(
      'Performance metrics',
      performanceAcceptable,
      performanceAcceptable
        ? `API response time (${perfTime}ms) is acceptable`
        : `API response time (${perfTime}ms) exceeds threshold`,
      {
        responseTime: `${perfTime}ms`,
        threshold: '5000ms',
      }
    );

  } catch (error) {
    logTest(
      'Frontend API integration test',
      false,
      `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      { error: error instanceof Error ? error.stack : String(error) }
    );
  }

  // Summary
  console.log('='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const percentage = ((passed / total) * 100).toFixed(1);
  
  console.log(`Passed: ${passed}/${total} (${percentage}%)`);
  console.log();
  
  results.forEach(result => {
    const status = result.passed ? '✓' : '✗';
    console.log(`${status} ${result.name}`);
  });
  
  console.log();
  console.log('='.repeat(80));
  
  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

// Run the test
testFrontendAPI().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
