/**
 * Utility functions for fetching and handling market resolution data
 */

import type { PolymarketMarket } from "@/hooks/useMarkets";

interface CLOBMarketToken {
  outcome: string;
  price: number;
  token_id: string;
  winner: boolean;
}

interface CLOBMarket {
  closed: boolean;
  condition_id: string;
  tokens: CLOBMarketToken[];
  end_date_iso: string;
  question: string;
}

/**
 * Fetches resolution data for closed markets from the CLOB API
 */
export async function fetchMarketResolutionData(conditionId: string): Promise<{
  winningOutcome?: string;
  winningTokenId?: string;
  resolvedAt?: string;
} | null> {
  try {
    // Note: This would require CLOB API access, which needs authentication
    // For now, we'll return null and handle resolution data differently
    // In a production environment, you'd call the CLOB API here
    
    // const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`);
    // const market: CLOBMarket = await response.json();
    
    // if (market.closed && market.tokens) {
    //   const winningToken = market.tokens.find(token => token.winner);
    //   if (winningToken) {
    //     return {
    //       winningOutcome: winningToken.outcome,
    //       winningTokenId: winningToken.token_id,
    //       resolvedAt: market.end_date_iso,
    //     };
    //   }
    // }
    
    return null;
  } catch (error) {
    console.warn(`Failed to fetch resolution data for market ${conditionId}:`, error);
    return null;
  }
}

/**
 * Enhances markets with resolution data for closed markets
 */
export async function enhanceMarketsWithResolutionData(
  markets: PolymarketMarket[]
): Promise<PolymarketMarket[]> {
  const closedMarkets = markets.filter(market => market.closed && market.conditionId);
  
  if (closedMarkets.length === 0) {
    return markets;
  }

  // For now, we'll simulate resolution data based on final prices
  // In production, this would fetch from CLOB API
  const enhancedMarkets = markets.map(market => {
    if (!market.closed || !market.outcomePrices) {
      return market;
    }

    try {
      const prices = JSON.parse(market.outcomePrices);
      const outcomes = market.outcomes ? JSON.parse(market.outcomes) : ['Yes', 'No'];
      
      // Find the outcome with the highest final price (closest to 1.0)
      let winningIndex = 0;
      let highestPrice = 0;
      
      prices.forEach((price: string, index: number) => {
        const priceNum = parseFloat(price);
        if (priceNum > highestPrice) {
          highestPrice = priceNum;
          winningIndex = index;
        }
      });

      // Only consider it a clear winner if the price is above 0.9
      if (highestPrice > 0.9) {
        return {
          ...market,
          winningOutcome: outcomes[winningIndex],
          resolvedAt: market.endDateIso || market.endDate,
        };
      }
    } catch (error) {
      console.warn(`Failed to parse outcome data for market ${market.id}:`, error);
    }

    return market;
  });

  return enhancedMarkets;
}

/**
 * Determines if a market has a clear resolution outcome
 */
export function hasResolutionData(market: PolymarketMarket): boolean {
  return market.closed && !!market.winningOutcome;
}

/**
 * Gets a human-readable resolution status for a market
 */
export function getResolutionStatus(market: PolymarketMarket): {
  status: 'resolved' | 'closed' | 'active';
  outcome?: string;
  resolvedAt?: string;
} {
  if (market.closed) {
    if (market.winningOutcome) {
      return {
        status: 'resolved',
        outcome: market.winningOutcome,
        resolvedAt: market.resolvedAt,
      };
    }
    return { status: 'closed' };
  }
  
  return { status: 'active' };
}