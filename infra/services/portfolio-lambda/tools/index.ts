/**
 * Portfolio_Lambda tool registry.
 *
 * Exports the read-only tool set used by the portfolio persona agent.
 * All tools are read-only - no state mutation or order placement.
 *
 * Tools:
 * - get_market_data: Current market prices, volume, liquidity from Polymarket CLOB
 * - get_order_book: Order book depth (bids/asks) for spread analysis
 * - read_full_analysis: Full analysis result from S3 for decision context
 * - get_trade_history: Recent trade history for the session from RDS
 * - get_session_performance: Session performance metrics from RDS
 * - get_agent_accuracy: Historical agent accuracy leaderboard from RDS
 *
 * Requirements: 2.4, 3.5
 */

import { getMarketDataTool } from './market-data';
import { getOrderBookTool } from './order-book';
import { readFullAnalysisTool } from './analysis-reader';
import { getTradeHistoryTool } from './trade-history';
import { getSessionPerformanceTool } from './session-performance';
import { getAgentAccuracyTool } from './agent-accuracy';

/**
 * Get the portfolio agent's read-only tool set.
 * Returns all 6 tools that the persona agent can use during reasoning.
 */
export function getPortfolioTools() {
  return [
    getMarketDataTool,
    getOrderBookTool,
    readFullAnalysisTool,
    getTradeHistoryTool,
    getSessionPerformanceTool,
    getAgentAccuracyTool,
  ];
}
