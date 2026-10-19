import type { PolymarketMarket, MarketStatus } from "@/hooks/useMarkets";

/**
 * Determines if a market is ending soon (within 7 days)
 */
export function isMarketEndingSoon(market: PolymarketMarket): boolean {
  if (!market.endDateIso && !market.endDate) return false;
  
  try {
    const endDate = new Date(market.endDateIso || market.endDate!);
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return endDate <= sevenDaysFromNow && endDate > now;
  } catch (error) {
    console.warn(`Failed to parse end date for market ${market.id}:`, error);
    return false;
  }
}

/**
 * Filters markets based on their status
 */
export function filterMarketsByStatus(
  markets: PolymarketMarket[], 
  status: MarketStatus
): PolymarketMarket[] {
  switch (status) {
    case "all":
      return markets;
    
    case "active":
      return markets.filter(market => market.active && !market.closed);
    
    case "closed":
      return markets.filter(market => market.closed);
    
    case "ending-soon":
      return markets.filter(market => 
        market.active && !market.closed && isMarketEndingSoon(market)
      );
    
    default:
      return markets;
  }
}

/**
 * Counts markets by status for display in filter UI
 */
export function getMarketStatusCounts(markets: PolymarketMarket[]) {
  const active = markets.filter(market => market.active && !market.closed);
  const closed = markets.filter(market => market.closed);
  const endingSoon = markets.filter(market => 
    market.active && !market.closed && isMarketEndingSoon(market)
  );

  return {
    all: markets.length,
    active: active.length,
    closed: closed.length,
    endingSoon: endingSoon.length,
  };
}