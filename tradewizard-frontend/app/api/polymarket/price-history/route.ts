import { NextRequest, NextResponse } from "next/server";

interface PriceHistoryPoint {
  timestamp: string;
  price: number;
}

interface PriceHistoryRequest {
  conditionId: string;
  tokenId: string;
  /** Optional second token ID (NO token) to fetch both lines */
  noTokenId?: string;
  timeRange: '1H' | '4H' | '1D' | '7D' | '30D';
}

interface PolymarketPricePoint {
  t: number; // Unix timestamp
  p: number; // Price
}

async function fetchTokenPriceHistory(
  tokenId: string,
  interval: string,
  fidelity: number
): Promise<{ points: PriceHistoryPoint[]; dataSource: 'real' | 'synthetic' }> {
  try {
    const url = new URL('https://clob.polymarket.com/prices-history');
    url.searchParams.set('market', tokenId);
    url.searchParams.set('interval', interval);
    url.searchParams.set('fidelity', fidelity.toString());

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TradeWizard/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.history && Array.isArray(data.history) && data.history.length > 0) {
      const points: PriceHistoryPoint[] = data.history.map((point: PolymarketPricePoint) => ({
        timestamp: new Date(point.t * 1000).toISOString(),
        price: Number(point.p.toFixed(4)),
      }));
      return { points, dataSource: 'real' };
    }

    throw new Error('No price history data available');
  } catch (error) {
    // Return empty - caller handles fallback
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { conditionId, tokenId, noTokenId, timeRange }: PriceHistoryRequest = await request.json();

    if (!conditionId || !tokenId) {
      return NextResponse.json(
        { error: "Missing required parameters: conditionId and tokenId" },
        { status: 400 }
      );
    }

    // Map time ranges to Polymarket intervals and fidelity
    const timeRangeConfig = {
      '1H': { interval: '1h', fidelity: 1 },    // 1-minute resolution
      '4H': { interval: '6h', fidelity: 5 },    // 5-minute resolution
      '1D': { interval: '1d', fidelity: 15 },   // 15-minute resolution
      '7D': { interval: '1w', fidelity: 60 },   // 1-hour resolution
      '30D': { interval: 'max', fidelity: 240 }, // 4-hour resolution
    }[timeRange] || { interval: '1d', fidelity: 15 };

    let yesData: PriceHistoryPoint[] = [];
    let noData: PriceHistoryPoint[] = [];
    let dataSource: 'real' | 'synthetic' = 'real';

    // Fetch YES token price history
    try {
      const yesResult = await fetchTokenPriceHistory(
        tokenId,
        timeRangeConfig.interval,
        timeRangeConfig.fidelity
      );
      yesData = yesResult.points;
      dataSource = yesResult.dataSource;
    } catch (error) {
      console.warn(`[Price History API] Failed to fetch YES token data:`, error);
      dataSource = 'synthetic';
    }

    // Fetch NO token price history if noTokenId is provided
    if (noTokenId) {
      try {
        const noResult = await fetchTokenPriceHistory(
          noTokenId,
          timeRangeConfig.interval,
          timeRangeConfig.fidelity
        );
        noData = noResult.points;
      } catch (error) {
        console.warn(`[Price History API] Failed to fetch NO token data:`, error);
        // If we have YES data, derive NO data as complement (1 - yesPrice)
        if (yesData.length > 0) {
          noData = yesData.map((p) => ({
            timestamp: p.timestamp,
            price: Number((1 - p.price).toFixed(4)),
          }));
        }
      }
    } else if (yesData.length > 0) {
      // If no noTokenId provided, derive NO data as complement
      noData = yesData.map((p) => ({
        timestamp: p.timestamp,
        price: Number((1 - p.price).toFixed(4)),
      }));
    }

    // If we still have no YES data, generate synthetic
    if (yesData.length === 0) {
      dataSource = 'synthetic';

      const timeRangeHours = {
        '1H': 1,
        '4H': 4,
        '1D': 24,
        '7D': 168,
        '30D': 720,
      }[timeRange] || 24;

      const endTime = Date.now();
      const startTime = endTime - (timeRangeHours * 60 * 60 * 1000);

      // Try to get current price for more realistic synthetic data
      let currentPrice = 0.5;
      try {
        const currentPriceResponse = await fetch(
          `https://clob.polymarket.com/midpoint?token_id=${tokenId}`,
          { headers: { 'Accept': 'application/json', 'User-Agent': 'TradeWizard/1.0' } }
        );
        if (currentPriceResponse.ok) {
          const priceData = await currentPriceResponse.json();
          if (priceData.mid) {
            currentPrice = parseFloat(priceData.mid);
          }
        }
      } catch {}

      const points = Math.min(timeRangeHours * 4, 200);
      const volatility = 0.015;
      let price = currentPrice * (0.95 + Math.random() * 0.1);

      for (let i = 0; i < points; i++) {
        const timeOffset = (i / (points - 1)) * (timeRangeHours * 60 * 60 * 1000);
        const timestamp = new Date(startTime + timeOffset).toISOString();

        const meanReversion = (currentPrice - price) * 0.002;
        const randomWalk = (Math.random() - 0.5) * volatility;
        price = Math.max(0.01, Math.min(0.99, price + meanReversion + randomWalk));

        yesData.push({ timestamp, price: Number(price.toFixed(4)) });
        noData.push({ timestamp, price: Number((1 - price).toFixed(4)) });
      }

      // Ensure last point matches current price
      if (yesData.length > 0) {
        yesData[yesData.length - 1].price = currentPrice;
        noData[noData.length - 1].price = Number((1 - currentPrice).toFixed(4));
      }
    }

    if (yesData.length === 0) {
      return NextResponse.json(
        { error: "No price history available for this market", conditionId, tokenId, timeRange },
        { status: 404 }
      );
    }

    return NextResponse.json({
      conditionId,
      tokenId,
      timeRange,
      data: yesData,
      noData,
      dataSource,
      points: yesData.length,
    });
  } catch (error) {
    console.error("[Price History API] Internal server error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
