import { NextRequest, NextResponse } from "next/server";

// Public endpoint to fetch market prices without authentication
// This uses Polymarket's Gamma API which provides market data including current prices

export async function POST(request: NextRequest) {
  try {
    const { tokenIds } = await request.json();

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      return NextResponse.json(
        { error: "tokenIds array is required" },
        { status: 400 }
      );
    }

    console.log(`Fetching prices for ${tokenIds.length} tokens`);

    // Instead of using the orderbook API (which might have CORS issues),
    // let's try to get prices from the markets themselves via Gamma API
    const priceMap: Record<string, { bidPrice: number; askPrice: number; midPrice: number; spread: number }> = {};

    try {
      // Fetch markets data from Gamma API to get current prices
      const response = await fetch(
        `https://gamma-api.polymarket.com/events?closed=false&limit=100`,
        {
          headers: {
            "Content-Type": "application/json",
          },
          next: { revalidate: 30 }, // Cache for 30 seconds
        }
      );

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const events = await response.json();

      // Extract prices from market data
      for (const event of events) {
        if (!event.markets) continue;

        for (const market of event.markets) {
          if (!market.clobTokenIds || !market.outcomePrices) continue;

          try {
            const marketTokenIds = JSON.parse(market.clobTokenIds);
            const prices = JSON.parse(market.outcomePrices);

            marketTokenIds.forEach((tokenId: string, index: number) => {
              if (tokenIds.includes(tokenId) && prices[index]) {
                const price = parseFloat(prices[index]);
                if (price > 0 && price < 1) {
                  // Use the market price as both bid and ask (no spread data available)
                  priceMap[tokenId] = {
                    bidPrice: price,
                    askPrice: price,
                    midPrice: price,
                    spread: 0,
                  };
                }
              }
            });
          } catch (error) {
            console.warn(`Failed to parse market data for market ${market.id}`);
          }
        }
      }

      console.log(`Successfully fetched ${Object.keys(priceMap).length}/${tokenIds.length} prices from Gamma API`);

    } catch (error) {
      console.error("Error fetching from Gamma API:", error);
      
      // Fallback: try individual orderbook requests (might have CORS issues)
      console.log("Falling back to orderbook API...");
      
      const pricePromises = tokenIds.slice(0, 10).map(async (tokenId: string) => { // Limit to 10 to avoid rate limits
        try {
          const response = await fetch(
            `https://clob.polymarket.com/book?token_id=${tokenId}`,
            {
              headers: {
                "Content-Type": "application/json",
              },
              next: { revalidate: 10 },
            }
          );

          if (!response.ok) {
            return { tokenId, bidPrice: null, askPrice: null };
          }

          const orderbook = await response.json();
          
          let bidPrice = 0;
          let askPrice = 0;

          if (orderbook.bids && orderbook.bids.length > 0) {
            bidPrice = parseFloat(orderbook.bids[0].price);
          }

          if (orderbook.asks && orderbook.asks.length > 0) {
            askPrice = parseFloat(orderbook.asks[0].price);
          }

          return {
            tokenId,
            bidPrice: bidPrice > 0 ? bidPrice : null,
            askPrice: askPrice > 0 ? askPrice : null,
          };
        } catch (error) {
          return { tokenId, bidPrice: null, askPrice: null };
        }
      });

      const fallbackPrices = await Promise.all(pricePromises);
      
      fallbackPrices.forEach(({ tokenId, bidPrice, askPrice }) => {
        if (bidPrice !== null && askPrice !== null) {
          const midPrice = (bidPrice + askPrice) / 2;
          const spread = askPrice - bidPrice;
          priceMap[tokenId] = { bidPrice, askPrice, midPrice, spread };
        } else if (bidPrice !== null) {
          priceMap[tokenId] = { 
            bidPrice, 
            askPrice: bidPrice, 
            midPrice: bidPrice, 
            spread: 0 
          };
        } else if (askPrice !== null) {
          priceMap[tokenId] = { 
            bidPrice: askPrice, 
            askPrice, 
            midPrice: askPrice, 
            spread: 0 
          };
        }
      });

      console.log(`Fallback fetched ${Object.keys(priceMap).length} additional prices`);
    }

    return NextResponse.json(priceMap);
  } catch (error) {
    console.error("Error fetching public prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}