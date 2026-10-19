import { NextRequest, NextResponse } from "next/server";

interface PricePoint {
  timestamp: string;
  price: number;
  volume?: number;
}

interface RouteContext {
  params: Promise<{ conditionId: string }>;
}

interface PolymarketPricePoint {
  t: number; // Unix timestamp
  p: number; // Price
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { conditionId } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const interval = searchParams.get("interval") || "1d";

    if (!conditionId) {
      return NextResponse.json(
        { error: "Condition ID is required" },
        { status: 400 }
      );
    }

    console.log(`[Price History API] Request: conditionId=${conditionId}, interval=${interval}`);

    // Map interval to Polymarket fidelity
    const fidelityMap: Record<string, number> = {
      "1h": 1,    // 1-minute resolution
      "1d": 15,   // 15-minute resolution
    };

    const fidelity = fidelityMap[interval] || 15;

    // Fetch price history from Polymarket CLOB API
    let priceHistory: PricePoint[] = [];
    let dataSource = "real";

    try {
      // First, we need to get the token ID for this condition
      // For now, we'll try to fetch directly with condition ID
      const priceHistoryUrl = new URL("https://clob.polymarket.com/prices-history");
      priceHistoryUrl.searchParams.set("market", conditionId);
      priceHistoryUrl.searchParams.set("interval", "max");
      priceHistoryUrl.searchParams.set("fidelity", fidelity.toString());

      console.log(`[Price History API] Fetching from: ${priceHistoryUrl.toString()}`);

      const response = await fetch(priceHistoryUrl.toString(), {
        headers: {
          "Accept": "application/json",
          "User-Agent": "TradeWizard/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Polymarket API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[Price History API] Received ${data.history?.length || 0} price points`);

      if (data.history && Array.isArray(data.history) && data.history.length > 0) {
        // Convert Polymarket price data to our format
        priceHistory = data.history
          .map((point: PolymarketPricePoint) => {
            const timestamp = new Date(point.t * 1000);
            const price = Number(point.p.toFixed(4));

            return {
              timestamp: timestamp.toISOString(),
              price,
            };
          })
          .filter((point: PricePoint) => {
            // Apply date filters if provided
            if (startDate && new Date(point.timestamp) < new Date(startDate)) {
              return false;
            }
            if (endDate && new Date(point.timestamp) > new Date(endDate)) {
              return false;
            }
            return true;
          });

        console.log(`[Price History API] Converted ${priceHistory.length} price points`);
      } else {
        console.warn(`[Price History API] No price history data received`);
        throw new Error("No price history data available");
      }
    } catch (error) {
      console.warn(`[Price History API] Failed to fetch real price data:`, error);
      
      // Fallback to synthetic data
      dataSource = "synthetic";
      console.log(`[Price History API] Falling back to synthetic data`);

      const endTime = endDate ? new Date(endDate).getTime() : Date.now();
      const startTime = startDate 
        ? new Date(startDate).getTime() 
        : endTime - (30 * 24 * 60 * 60 * 1000); // 30 days default

      const points = Math.min(200, Math.floor((endTime - startTime) / (60 * 60 * 1000)));
      let price = 0.5;
      const volatility = 0.015;

      for (let i = 0; i < points; i++) {
        const timeOffset = (i / (points - 1)) * (endTime - startTime);
        const timestamp = new Date(startTime + timeOffset);
        
        const randomWalk = (Math.random() - 0.5) * volatility;
        price = Math.max(0.01, Math.min(0.99, price + randomWalk));
        
        priceHistory.push({
          timestamp: timestamp.toISOString(),
          price: Number(price.toFixed(4)),
        });
      }

      console.log(`[Price History API] Generated ${priceHistory.length} synthetic points`);
    }

    if (priceHistory.length === 0) {
      return NextResponse.json(
        { 
          error: "No price history available for this market",
          conditionId,
        },
        { status: 404 }
      );
    }

    // Calculate metadata
    const prices = priceHistory.map(p => p.price);
    const metadata = {
      firstPrice: prices[0],
      lastPrice: prices[prices.length - 1],
      highPrice: Math.max(...prices),
      lowPrice: Math.min(...prices),
      totalVolume: 0, // Not available from this endpoint
    };

    console.log(`[Price History API] Returning ${priceHistory.length} points (${dataSource} data)`);

    return NextResponse.json({
      conditionId,
      prices: priceHistory,
      metadata,
      dataSource,
    });
  } catch (error) {
    console.error("[Price History API] Internal server error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
