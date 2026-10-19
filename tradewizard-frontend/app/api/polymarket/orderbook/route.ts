import { NextRequest, NextResponse } from "next/server";

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookResponse {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  hash: string;
}

/**
 * GET /api/polymarket/orderbook?token_id=TOKEN_ID
 * Fetches the full order book for a token from the Polymarket CLOB API.
 */
export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("token_id");

    if (!tokenId) {
      return NextResponse.json(
        { error: "token_id query parameter is required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `https://clob.polymarket.com/book?token_id=${tokenId}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "TradeWizard/1.0",
        },
        next: { revalidate: 5 }, // Cache for 5 seconds
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `CLOB API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data: OrderBookResponse = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    });
  } catch (error) {
    console.error("[Orderbook API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order book" },
      { status: 500 }
    );
  }
}
