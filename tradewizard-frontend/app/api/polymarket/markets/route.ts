import { NextRequest, NextResponse } from "next/server";
import { GAMMA_API_URL } from "@/constants/api";

const MIN_LIQUIDITY_USD = 1000;
const MIN_LIQUIDITY_NON_EVERGREEN_USD = 5000;

const EVERGREEN_TAG_IDS = [2, 21, 84, 120, 144, 596, 1401, 100265, 100328, 100639];

// Allowed tag IDs - only markets with at least one of these tags will be shown
const ALLOWED_TAG_IDS = [2, 21, 84, 120, 144, 596, 1401, 100265, 100328];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get("limit") || "20";
  const offset = searchParams.get("offset") || "0";
  const tagId = searchParams.get("tag_id");
  const tagIds = searchParams.get("tag_ids"); // Comma-separated list for multi-tag fetch
  const includeClosed = searchParams.get("include_closed") === "true";
  const sortBy = searchParams.get("sort") || "volume"; // "volume" or "liquidity"

  try {
    const requestedLimit = parseInt(limit);
    const requestedOffset = parseInt(offset);
    
    // Fetch more than requested to account for filtering
    const fetchLimit = Math.max(requestedLimit * 3, 100);
    const fetchOffset = Math.floor(requestedOffset * 1.5); // Approximate offset accounting for filtering

    let events: any[] = [];

    if (tagIds) {
      // Multi-tag fetch: fetch from each tag in parallel and merge
      const tagIdList = tagIds.split(',').map(id => id.trim()).filter(Boolean);
      const perTagLimit = Math.max(Math.ceil(fetchLimit / Math.min(tagIdList.length, 4)), 30);
      // Distribute the offset across tags to paginate deeper
      const perTagOffset = Math.floor(requestedOffset / tagIdList.length);

      const fetches = tagIdList.map(async (tid) => {
        const url = `${GAMMA_API_URL}/events?closed=${includeClosed ? 'true' : 'false'}&order=volume24hr&ascending=false&limit=${perTagLimit}&offset=${perTagOffset}&tag_id=${tid}&related_tags=true`;
        const resp = await fetch(url, {
          headers: { "Content-Type": "application/json" },
          next: { revalidate: 60 },
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return Array.isArray(data) ? data : [];
      });

      const results = await Promise.all(fetches);
      // Deduplicate events by ID
      const seenEventIds = new Set<string>();
      for (const batch of results) {
        for (const event of batch) {
          if (!seenEventIds.has(event.id)) {
            seenEventIds.add(event.id);
            events.push(event);
          }
        }
      }
    } else {
      // Single tag or no tag fetch
      let url = `${GAMMA_API_URL}/events?closed=${includeClosed ? 'true' : 'false'}&order=volume24hr&ascending=false&limit=${fetchLimit}&offset=${fetchOffset}`;

      if (tagId) {
        url += `&tag_id=${tagId}&related_tags=true`;
      }

      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 60 },
      });

      if (!response.ok) {
        console.error("Gamma API error:", response.status);
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        console.error("Invalid response structure:", data);
        return NextResponse.json(
          { error: "Invalid API response" },
          { status: 500 }
        );
      }

      events = data;
    }

    const allMarkets: any[] = [];

    for (const event of events) {
      // For closed markets, we want to include ended/closed events
      if (!includeClosed && (event.ended || event.closed || !event.active)) continue;

      const markets = event.markets || [];

      for (const market of markets) {
        allMarkets.push({
          ...market,
          eventTitle: event.title,
          eventSlug: event.slug,
          eventId: event.id,
          eventIcon: event.image || event.icon,
          negRisk: event.negRisk || false,
        });
      }
    }

    const validMarkets = allMarkets.filter((market: any) => {
      // Basic validation that applies to all markets
      if (!market.clobTokenIds) return false;

      // When fetching without a specific tag (All/Trending with tag_ids), markets are already scoped.
      // When fetching without any tag filter, restrict to allowed tags only.
      if (!tagId && !tagIds) {
        const marketTagIds = market.tags?.map((t: any) => parseInt(t.id)) || [];
        const hasAllowedTag = ALLOWED_TAG_IDS.some((id) => marketTagIds.includes(id));
        if (!hasAllowedTag) return false;
      }

      // For closed markets, we have more relaxed validation criteria
      if (market.closed === true) {
        // If we're not including closed markets, filter them out
        if (!includeClosed) return false;
        
        // For closed markets, skip liquidity and price checks
        return true;
      }

      // Validation for open markets
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

      const marketTagIds =
        market.tags?.map((t: any) => parseInt(t.id)) || [];
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

    const sortedMarkets = validMarkets.sort((a: any, b: any) => {
      // Sort closed markets by end date (most recent first), then by volume
      if (a.closed && b.closed) {
        const aEndDate = new Date(a.endDateIso || a.endDate || 0).getTime();
        const bEndDate = new Date(b.endDateIso || b.endDate || 0).getTime();
        if (aEndDate !== bEndDate) {
          return bEndDate - aEndDate; // Most recent first
        }
        const aVolume = parseFloat(a.volume24hr || a.volume || "0");
        const bVolume = parseFloat(b.volume24hr || b.volume || "0");
        return bVolume - aVolume;
      }

      // If one is closed and one is open, prioritize open markets
      if (a.closed && !b.closed) return 1;
      if (!a.closed && b.closed) return -1;

      // For open markets, sort based on the requested sort signal
      if (sortBy === "liquidity") {
        const aLiq = parseFloat(a.liquidity || "0");
        const bLiq = parseFloat(b.liquidity || "0");
        return bLiq - aLiq;
      }

      // Default: sort by 24h volume (Trending)
      const aVol = parseFloat(a.volume24hr || a.volume || "0");
      const bVol = parseFloat(b.volume24hr || b.volume || "0");
      return bVol - aVol;
    });

    // Apply client-side pagination after filtering and sorting
    const startIndex = requestedOffset;
    const endIndex = startIndex + requestedLimit;
    const paginatedMarkets = sortedMarkets.slice(startIndex, endIndex);

    return NextResponse.json(paginatedMarkets);
  } catch (error) {
    console.error("Error fetching markets:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch markets",
      },
      { status: 500 }
    );
  }
}
