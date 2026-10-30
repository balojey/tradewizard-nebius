import { describe, expect, it } from 'vitest';
import type { AgentSignal } from './types';
import type { CalibrationMap } from './calibration';
import {
  deriveCostFloor,
  mirrorCalibrationMap,
  mirrorSignals,
  runShadowConsensus,
  SHADOW_CONSENSUS_DEFAULTS,
} from './shadow-consensus';

/** The 12 directional agents (risk/tail are non-directional by design). */
const DIRECTIONAL_AGENTS = [
  'polling_intelligence',
  'market_microstructure',
  'momentum',
  'probability_baseline',
  'breaking_news',
  'narrative_velocity',
  'historical_patterns',
  'event_impact',
  'catalyst_identification',
  'mean_reversion',
  'media_sentiment',
  'social_sentiment',
];

function signalsAt(fairProbability: number, confidence = 0.8): AgentSignal[] {
  return DIRECTIONAL_AGENTS.map((agentName) => ({
    agentName,
    direction: 'NEUTRAL' as const,
    confidence,
    fairProbability,
    keyDrivers: [],
    riskFactors: [],
    timestamp: new Date(0).toISOString(),
  }));
}

function signalsFrom(fairs: number[], confidence = 0.8): AgentSignal[] {
  return DIRECTIONAL_AGENTS.slice(0, fairs.length).map((agentName, i) => ({
    agentName,
    direction: 'NEUTRAL' as const,
    confidence,
    fairProbability: fairs[i],
    keyDrivers: [],
    riskFactors: [],
    timestamp: new Date(0).toISOString(),
  }));
}

/** An agent that habitually emits `intercept + slope * market`. */
const REGRESSIVE: CalibrationMap = {
  ...Object.fromEntries(
    DIRECTIONAL_AGENTS.map((agentName) => [
      agentName,
      { intercept: 0.1, slope: 0.8, samples: 200 },
    ]),
  ),
};

function habitAt(market: number): number {
  return 0.1 + 0.8 * market;
}

describe('runShadowConsensus - the production bias regression', () => {
  it('does NOT buy the cheap token just because agents regress toward 0.5', () => {
    // 0.80 market. Every agent emits its habitual 0.74 - which is not a
    // bearish view, it is the agent's null output. The live pipeline reads it
    // as a -6pt edge and recommends LONG_NO (buying the 0.20 token). The
    // de-biased config must see no edge at all.
    const market = 0.8;
    const signals = signalsAt(habitAt(market));

    const result = runShadowConsensus({
      signals,
      marketProbability: market,
      calibration: REGRESSIVE,
    });

    expect(result.action).toBe('NO_TRADE');
    expect(result.edge).toBeCloseTo(0, 6);
    expect(result.voteScore).toBeCloseTo(0, 6);
    expect(result.abstainShare).toBe(1);
  });

  it('takes the FAVOURITE side when the majority genuinely finds it underpriced', () => {
    // Same 0.80 market, but agents find a real +8pt mispricing: they emit
    // 0.82 where their habit alone would produce 0.74.
    const market = 0.8;
    const signals = signalsAt(0.82);

    const result = runShadowConsensus({
      signals,
      marketProbability: market,
      calibration: REGRESSIVE,
      spread: 0.03, // cost floor 0.035 - the old fixed 4c gate would block this
    });

    expect(result.action).toBe('LONG_YES');
    expect(result.edge).toBeCloseTo(0.08, 6);
    expect(result.voteScore).toBeCloseTo(1, 6);
  });

  it('is the calibration, not the aggregation, that unlocks the favourite side', () => {
    // Identical signals with no calibration history: the habit is read as
    // bearish, so the edge is only 2pt and fails the cost floor.
    const market = 0.8;
    const signals = signalsAt(0.82);

    const result = runShadowConsensus({
      signals,
      marketProbability: market,
      calibration: {},
      spread: 0.03,
    });

    expect(result.action).toBe('NO_TRADE');
    expect(result.edge).toBeCloseTo(0.02, 6);
  });
});

describe('runShadowConsensus - direction and magnitude', () => {
  it('takes LONG_NO when the weighted majority is genuinely bearish', () => {
    const result = runShadowConsensus({
      signals: signalsAt(0.5),
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });
    expect(result.action).toBe('LONG_NO');
    expect(result.voteScore).toBeCloseTo(-1, 6);
  });

  it('lets confident agents outvote more numerous indifferent ones', () => {
    // Three high-weight, confident agents are bearish; eight low-confidence
    // agents sit marginally bullish. Headcount would go YES; weighted voting
    // should not.
    const signals: AgentSignal[] = [
      ...['polling_intelligence', 'market_microstructure', 'momentum'].map((agentName) => ({
        agentName,
        direction: 'NEUTRAL' as const,
        confidence: 0.95,
        fairProbability: 0.4,
        keyDrivers: [],
        riskFactors: [],
        timestamp: new Date(0).toISOString(),
      })),
      ...['media_sentiment', 'social_sentiment', 'mean_reversion', 'catalyst_identification'].map(
        (agentName) => ({
          agentName,
          direction: 'NEUTRAL' as const,
          confidence: 0.35,
          fairProbability: 0.62,
          keyDrivers: [],
          riskFactors: [],
          timestamp: new Date(0).toISOString(),
        }),
      ),
    ];

    const result = runShadowConsensus({
      signals,
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });

    expect(result.action).toBe('LONG_NO');
    expect(result.voteScore).toBeLessThan(0);
  });

  it('requires a quorum, so a split ensemble stays out', () => {
    const result = runShadowConsensus({
      signals: signalsFrom([0.7, 0.7, 0.7, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.7),
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });
    expect(result.action).toBe('NO_TRADE');
    expect(result.reason).toContain('no majority');
  });

  it('requires the edge to clear the round-trip cost floor', () => {
    // 4pt of de-biased edge clears the quorum (0.04 / 0.05 = 0.8) but not a
    // 5-cent spread plus slippage (0.055).
    const result = runShadowConsensus({
      signals: signalsAt(0.64),
      marketProbability: 0.6,
      calibration: {},
      spread: 0.05,
    });
    expect(result.action).toBe('NO_TRADE');
    expect(result.reason).toContain('cost floor');
  });

  it('ignores non-directional risk/tail agents', () => {
    const base = signalsAt(0.61);
    const withRiskAgents: AgentSignal[] = [
      ...base,
      {
        agentName: 'risk_assessment',
        direction: 'NO',
        confidence: 1,
        fairProbability: 0.05,
        keyDrivers: [],
        riskFactors: [],
        timestamp: new Date(0).toISOString(),
      },
      {
        agentName: 'tail_risk',
        direction: 'NO',
        confidence: 1,
        fairProbability: 0.02,
        keyDrivers: [],
        riskFactors: [],
        timestamp: new Date(0).toISOString(),
      },
    ];

    const withThem = runShadowConsensus({
      signals: withRiskAgents,
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });
    const without = runShadowConsensus({
      signals: base,
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });

    expect(withThem.action).toBe(without.action);
    expect(withThem.voteScore).toBeCloseTo(without.voteScore, 10);
    expect(withThem.edge).toBeCloseTo(without.edge, 10);
  });

  it('reports an empty ensemble as NO_TRADE rather than crashing', () => {
    const result = runShadowConsensus({
      signals: [],
      marketProbability: 0.5,
    });
    expect(result.action).toBe('NO_TRADE');
    expect(result.voteScore).toBe(0);
    expect(result.abstainShare).toBe(1);
  });
});

describe('runShadowConsensus - symmetry', () => {
  it('mirrors every continuous output in the opposite outcome space', () => {
    const market = 0.3;
    const signals = signalsFrom([0.25, 0.3, 0.35, 0.4, 0.2, 0.45, 0.28, 0.33]);
    const spread = 0.02;

    const yes = runShadowConsensus({ signals, marketProbability: market, calibration: REGRESSIVE, spread });
    const no = runShadowConsensus({
      signals: mirrorSignals(signals),
      marketProbability: 1 - market,
      calibration: mirrorCalibrationMap(REGRESSIVE),
      spread,
    });

    expect(no.voteScore).toBeCloseTo(-yes.voteScore, 3);
    expect(no.edge).toBeCloseTo(-yes.edge, 3);
    expect(no.fairProbability).toBeCloseTo(1 - yes.fairProbability, 3);
    expect(no.costFloor).toBeCloseTo(yes.costFloor, 10);
    expect(no.abstainShare).toBeCloseTo(yes.abstainShare, 10);
  });

  it('mirrors the action (LONG_YES <-> LONG_NO)', () => {
    // An 0.70 forecast against a 0.60 market is the mirror image of an 0.30
    // forecast against a 0.40 market.
    const bullish = runShadowConsensus({
      signals: signalsAt(0.7),
      marketProbability: 0.6,
      calibration: {},
      spread: 0.01,
    });
    const bearish = runShadowConsensus({
      signals: signalsAt(0.3),
      marketProbability: 0.4,
      calibration: {},
      spread: 0.01,
    });

    expect(bullish.action).toBe('LONG_YES');
    expect(bearish.action).toBe('LONG_NO');
    expect(bearish.voteScore).toBeCloseTo(-bullish.voteScore, 6);
  });
});

describe('deriveCostFloor', () => {
  it('charges the observed spread plus a slippage buffer', () => {
    expect(deriveCostFloor(0.01)).toBeCloseTo(0.015, 10);
    expect(deriveCostFloor(0.04)).toBeCloseTo(0.045, 10);
  });

  it('falls back to the default when the spread is unknown', () => {
    expect(deriveCostFloor(undefined)).toBe(SHADOW_CONSENSUS_DEFAULTS.defaultCostFloor);
    expect(deriveCostFloor(Number.NaN)).toBe(SHADOW_CONSENSUS_DEFAULTS.defaultCostFloor);
  });

  it('clamps to sane bounds', () => {
    expect(deriveCostFloor(0.0001)).toBe(SHADOW_CONSENSUS_DEFAULTS.minCostFloor);
    expect(deriveCostFloor(0.9)).toBe(SHADOW_CONSENSUS_DEFAULTS.maxCostFloor);
  });
});
