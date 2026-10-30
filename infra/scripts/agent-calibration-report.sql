-- ============================================================================
-- Agent calibration & shadow-consensus report
--
-- Answers the two questions the Slice-1 measurement exists for:
--
--   1. Are the intelligence agents' fair probabilities anchored to the market
--      price, or do they regress toward 0.5? (`slope` below. 1.0 = anchored,
--      < 1.0 = regresses toward 0.5, which is what makes the pipeline buy the
--      cheap token in every lopsided market.)
--
--   2. Does the agent-driven (shadow) config pick better directions than the
--      live one, and is it still only buying the cheaper token?
--
-- Run with psql against the Aurora cluster:
--   psql "$DATABASE_URL" -f infra/scripts/agent-calibration-report.sql
--
-- Safe to run at any time. Read-only.
-- ============================================================================

\echo '=============================================================='
\echo '1. PER-AGENT CALIBRATION  (fair = intercept + slope * market)'
\echo '   slope > 1.00 : tracks price, produces favourite-side conviction'
\echo '   slope ~ 1.00 : well anchored'
\echo '   slope < 0.90 : regresses toward 0.5 -> cheap-token bias source'
\echo '=============================================================='

WITH pairs AS (
  SELECT
    am.agent_name,
    ar.market_probability_at_execution::float8 AS m,
    am.fair_probability::float8 AS f
  FROM agent_memory am
  JOIN analysis_results ar ON ar.id = am.result_id
  WHERE ar.market_probability_at_execution IS NOT NULL
    AND ar.executed_at > NOW() - INTERVAL '90 days'
),
stats AS (
  SELECT
    agent_name,
    COUNT(*) AS n,
    AVG(m) AS mean_m,
    AVG(f) AS mean_f,
    AVG(m * f) AS mean_mf,
    AVG(m * m) AS mean_mm
  FROM pairs
  GROUP BY agent_name
)
SELECT
  agent_name,
  n AS samples,
  ROUND(mean_m::numeric, 3) AS avg_market,
  ROUND(mean_f::numeric, 3) AS avg_forecast,
  ROUND(
    CASE
      WHEN (mean_mm - mean_m * mean_m) > 0.0001
        THEN (mean_mf - mean_m * mean_f) / (mean_mm - mean_m * mean_m)
      ELSE NULL
    END::numeric, 3
  ) AS slope,
  ROUND(
    CASE
      WHEN (mean_mm - mean_m * mean_m) > 0.0001
        THEN mean_f - ((mean_mf - mean_m * mean_f) / (mean_mm - mean_m * mean_m)) * mean_m
      ELSE NULL
    END::numeric, 3
  ) AS intercept,
  CASE
    WHEN (mean_mm - mean_m * mean_m) <= 0.0001 THEN 'not identifiable'
    WHEN (mean_mf - mean_m * mean_f) / (mean_mm - mean_m * mean_m) < 0.90 THEN 'REGRESSIVE (bias source)'
    WHEN (mean_mf - mean_m * mean_f) / (mean_mm - mean_m * mean_m) > 1.10 THEN 'extrapolating'
    ELSE 'anchored'
  END AS verdict
FROM stats
WHERE n >= 12
ORDER BY slope ASC NULLS LAST, samples DESC;

\echo ''
\echo '=============================================================='
\echo '2. FORECAST vs PRICE BY MARKET BUCKET  (the bias, made visible)'
\echo '   For each price bucket: the average agent forecast.'
\echo '   If avg_forecast sits inside the bucket on lopsided markets,'
\echo '   agents are ignoring the price and the ensemble will point at'
\echo '   the cheaper token.'
\echo '=============================================================='

WITH bucketed AS (
  SELECT
    CASE
      WHEN ar.market_probability_at_execution < 0.20 THEN '1. <0.20'
      WHEN ar.market_probability_at_execution < 0.35 THEN '2. 0.20-0.35'
      WHEN ar.market_probability_at_execution < 0.50 THEN '3. 0.35-0.50'
      WHEN ar.market_probability_at_execution < 0.65 THEN '4. 0.50-0.65'
      WHEN ar.market_probability_at_execution < 0.80 THEN '5. 0.65-0.80'
      ELSE '6. >=0.80'
    END AS price_bucket,
    ar.market_probability_at_execution::float8 AS m,
    am.fair_probability::float8 AS f
  FROM agent_memory am
  JOIN analysis_results ar ON ar.id = am.result_id
  WHERE ar.market_probability_at_execution IS NOT NULL
    AND ar.executed_at > NOW() - INTERVAL '90 days'
)
SELECT
  price_bucket,
  COUNT(*) AS signals,
  ROUND(AVG(m)::numeric, 3) AS avg_market,
  ROUND(AVG(f)::numeric, 3) AS avg_forecast,
  ROUND((AVG(f) - AVG(m))::numeric, 3) AS avg_gap,
  ROUND(AVG(CASE WHEN f < m THEN 1.0 ELSE 0.0 END)::numeric * 100, 1) AS pct_bearish
FROM bucketed
GROUP BY price_bucket
ORDER BY price_bucket;

\echo ''
\echo '=============================================================='
\echo '3. LIVE vs SHADOW ACTION MIX  (is the shadow still one-sided?)'
\echo '   A healthy config produces BOTH long_yes and long_no across'
\echo '   price buckets. If shadow_action is long_no for every cheap'
\echo '   bucket and never long_yes for favourites, the bias is still'
\echo '   there and the calibration fit needs more data.'
\echo '=============================================================='

SELECT
  CASE
    WHEN market_probability_at_execution < 0.35 THEN '1. market <0.35'
    WHEN market_probability_at_execution < 0.65 THEN '2. market 0.35-0.65'
    ELSE '3. market >=0.65'
  END AS price_bucket,
  COUNT(*) AS analyses,
  COUNT(*) FILTER (WHERE recommendation = 'LONG_YES') AS live_long_yes,
  COUNT(*) FILTER (WHERE recommendation = 'LONG_NO')  AS live_long_no,
  COUNT(*) FILTER (WHERE recommendation = 'NO_TRADE') AS live_no_trade,
  COUNT(*) FILTER (WHERE shadow_action = 'LONG_YES')  AS shadow_long_yes,
  COUNT(*) FILTER (WHERE shadow_action = 'LONG_NO')   AS shadow_long_no,
  COUNT(*) FILTER (WHERE shadow_action = 'NO_TRADE')  AS shadow_no_trade
FROM analysis_results
WHERE shadow_action IS NOT NULL
  AND market_probability_at_execution IS NOT NULL
GROUP BY price_bucket
ORDER BY price_bucket;

\echo ''
\echo '=============================================================='
\echo '4. REALISED P&L: LIVE vs SHADOW  (fixed horizon, same moves)'
\echo '   live_pnl / shadow_pnl are per-share P&L in probability'
\echo '   points over SHADOW_PNL_HORIZON_HOURS. NO_TRADE rows'
\echo '   contribute 0, so compare avg_pnl over the ACTED rows only'
\echo '   and read actionable_pct as coverage.'
\echo '=============================================================='

SELECT
  horizon_hours,
  COUNT(*) AS analyses,
  ROUND(AVG(horizon_move)::numeric, 4) AS avg_price_move,
  COUNT(*) FILTER (WHERE recommendation IN ('LONG_YES','LONG_NO')) AS live_acted,
  COUNT(*) FILTER (WHERE shadow_action IN ('LONG_YES','LONG_NO')) AS shadow_acted,
  ROUND((COUNT(*) FILTER (WHERE recommendation IN ('LONG_YES','LONG_NO')))::numeric
        / NULLIF(COUNT(*), 0) * 100, 1) AS live_actionable_pct,
  ROUND((COUNT(*) FILTER (WHERE shadow_action IN ('LONG_YES','LONG_NO')))::numeric
        / NULLIF(COUNT(*), 0) * 100, 1) AS shadow_actionable_pct,
  ROUND(SUM(live_pnl)::numeric, 3) AS live_pnl_total,
  ROUND(SUM(shadow_pnl)::numeric, 3) AS shadow_pnl_total,
  ROUND(AVG(live_pnl) FILTER (WHERE recommendation IN ('LONG_YES','LONG_NO'))::numeric, 4) AS live_avg_pnl,
  ROUND(AVG(shadow_pnl) FILTER (WHERE shadow_action IN ('LONG_YES','LONG_NO'))::numeric, 4) AS shadow_avg_pnl
FROM analysis_results
WHERE pnl_scored_at IS NOT NULL
GROUP BY horizon_hours
ORDER BY horizon_hours;

\echo ''
\echo '=============================================================='
\echo '5. SHADOW P&L BY SIDE  (the decisive check)'
\echo '   If long_yes-on-favourites loses money, the shadow config'
\echo '   must NOT replace the live one. If it is flat or positive'
\echo '   while the live underdog bets lose, switch.'
\echo '=============================================================='

SELECT
  shadow_action,
  CASE
    WHEN shadow_action = 'LONG_YES' AND market_probability_at_execution >= 0.5 THEN 'favourite (YES >=0.5)'
    WHEN shadow_action = 'LONG_YES' THEN 'cheap token (YES <0.5)'
    WHEN shadow_action = 'LONG_NO'  AND market_probability_at_execution <  0.5 THEN 'favourite (NO >=0.5)'
    WHEN shadow_action = 'LONG_NO'  THEN 'cheap token (NO <0.5)'
    ELSE 'no trade'
  END AS side,
  COUNT(*) AS n,
  ROUND(AVG(horizon_move)::numeric, 4) AS avg_move,
  ROUND(SUM(shadow_pnl)::numeric, 3) AS total_pnl,
  ROUND(AVG(shadow_pnl)::numeric, 4) AS avg_pnl,
  ROUND((COUNT(*) FILTER (WHERE shadow_pnl > 0))::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS hit_pct
FROM analysis_results
WHERE pnl_scored_at IS NOT NULL
GROUP BY shadow_action, side
ORDER BY side;

\echo ''
\echo '=============================================================='
\echo '0. WHY NO_TRADE?  (run this first when everything is NO_TRADE)'
\echo '   Live gates in order of precedence:'
\echo '     consensus_failed        -> disagreement > 0.30 or confidence < 0.20'
\echo '     divergence_cap          -> |edge| > 0.15 (model error)'
\echo '     edge_below_threshold    -> |edge| <= spread + slippage (1.5c-8c)'
\echo '     edge_below_significance -> |edge| <= MIN_EDGE_SIGMA x ensemble std error'
\echo '     thesis_veto             -> strict profile only: cross-exam disagreed'
\echo ''
\echo '   Read this before touching thresholds:'
\echo '     edge_below_threshold    -> the market is too wide for the edge we find;'
\echo '                                widen universe or accept thinner markets.'
\echo '     edge_below_significance -> the agents disagree more with each other than'
\echo '                                they disagree with the market. That is a'
\echo '                                signal-quality problem, not a threshold one.'
\echo '                                Lower MIN_EDGE_SIGMA to trade anyway.'
\echo '=============================================================='

SELECT
  COALESCE(no_trade_reason, CASE WHEN recommendation = 'NO_TRADE' THEN 'unrecorded' ELSE 'traded' END) AS gate,
  COUNT(*) AS analyses,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct,
  ROUND(AVG(edge)::numeric, 4) AS avg_edge,
  ROUND(AVG(market_probability_at_execution)::numeric, 3) AS avg_market,
  ROUND(AVG(shadow_edge)::numeric, 4) AS avg_shadow_edge
FROM analysis_results
GROUP BY gate
ORDER BY analyses DESC;
