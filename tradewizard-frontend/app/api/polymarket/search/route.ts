import { NextRequest, NextResponse } from "next/server";
import { GAMMA_API_URL } from "@/constants/api";

// Allowed tag IDs - only markets with at least one of these tags are shown
const ALLOWED_TAG_IDS = [2, 21, 84, 120, 144, 596, 1401, 100265, 100328];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const status = searchParams.get("status") || "all"; // all, active, closed
  const limit = parseInt(searchParams.get("limit") || "20");

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters long" },
      { status: 400 }
    );
  }

  try {
    const searchQuery = query.trim();
    
    // Use Polymarket's public search endpoint
    const searchUrl = `${GAMMA_API_URL}/public-search?q=${encodeURIComponent(searchQuery)}`;
    
    const response = await fetch(searchUrl, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }

    const searchData = await response.json();
    const allMarkets: any[] = [];
    const marketIds = new Set<string>();

    // Extract markets from events in search results
    if (searchData.events && Array.isArray(searchData.events)) {
      searchData.events.forEach((event: any) => {
        if (!event.markets || !Array.isArray(event.markets)) return;

        // Check if this event belongs to an allowed category
        const eventTagIds = event.tags?.map((t: any) => parseInt(t.id)) || [];
        const hasAllowedTag = ALLOWED_TAG_IDS.some((id) => eventTagIds.includes(id));
        if (!hasAllowedTag) return;
        
        event.markets.forEach((market: any) => {
          // Apply status filter
          if (status === "active" && (market.closed || !market.active)) return;
          if (status === "closed" && !market.closed) return;
          
          // Add market if not already included
          if (!marketIds.has(market.id)) {
            allMarkets.push({
              ...market,
              eventTitle: event.title,
              eventSlug: event.slug,
              eventId: event.id,
              eventIcon: event.image || event.icon,
              negRisk: event.negRisk || false,
            });
            marketIds.add(market.id);
          }
        });
      });
    }

    // Sort markets by relevance and activity
    allMarkets.sort((a, b) => {
      // Prioritize exact matches in question title
      const aExactMatch = a.question?.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0;
      const bExactMatch = b.question?.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0;
      
      if (aExactMatch !== bExactMatch) {
        return bExactMatch - aExactMatch;
      }
      
      // Then sort by volume/activity
      const aVolume = parseFloat(a.volume24hr || a.volume || "0");
      const bVolume = parseFloat(b.volume24hr || b.volume || "0");
      
      return bVolume - aVolume;
    });

    // Return only markets, limited to requested amount
    const results = {
      markets: allMarkets.slice(0, limit),
      events: [], // Removed as requested - only return markets
      profiles: [], // Not available without authenticated search
    };

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error performing search:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Search failed",
      },
      { status: 500 }
    );
  }
}