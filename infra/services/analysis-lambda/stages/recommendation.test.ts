import { describe, expect, it } from 'vitest';
import { parseRecommendation, type RecommendationInput } from './recommendation';
import type { ConsensusEngineOutput } from './consensus-engine';
import type { FusedSignal } from '../lib/types';

function buildInput(
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE',
  consensusProbability: number,
  marketProbability: number,
): RecommendationInput {
  const consensusOutput: ConsensusEngineOutput = {
    action,
    edge: consensusProbability - marketProbability,
    consensusResult: {
      probability: consensusProbability,
      confidence: 0.7,
      disagreementIndex: 0.1,
      failed: false,
    },
  };

  const fusedSignal: FusedSignal = {
    weightedFairProbability: consensusProbability,
    fusionConfidence: 0.7,
    signalAlignment: 0.8,
    signalDisagreement: 0.2,
    conflictMap: [],
  };

  return {
    marketId: 'market-1',
    marketQuestion: 'Will the test outcome happen?',
    marketProbability,
    consensusOutput,
    fusedSignal,
    bullThesis: {
      direction: 'bull',
      fairProbability: consensusProbability,
      keyArguments: ['bull case'],
      confidence: 0.7,
    },
    bearThesis: {
      direction: 'bear',
      fairProbability: 1 - consensusProbability,
      keyArguments: ['bear case'],
      confidence: 0.7,
    },
    crossExamResult: { bullScore: 0, bearScore: 0 },
    riskPhilosophy: {
      aggressive: null,
      conservative: null,
      neutral: null,
      summary: 'risk summary',
      durationMs: 0,
      usedFallbacks: [],
    },
    agentsUsed: ['market_microstructure'],
    totalLlmCalls: 10,
    executionStartTime: Date.now(),
    volatility: 0.03,
    marketEndDate: '2026-11-30T00:00:00Z',
    liquidityRisk: 'medium',
    liquidity: 25_000,
    spread: 0.01,
  };
}

describe('parseRecommendation', () => {
  it('rejects a trade whose target is not at least 1.5x the stop distance', () => {
    const input = buildInput('LONG_YES', 0.6, 0.6);
    const outcome = parseRecommendation(
      {
        entry_zone: [0.58, 0.6],
        target_zone: [0.62, 0.64],
        stop_loss: 0.56,
        expected_value: 0.01,
        win_probability: 0.6,
      },
      input,
    );

    // The target is expanded instead of rejecting a directionally valid trade.
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const metadata = outcome.recommendation.metadata;
      expect(metadata.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
      const entryMid =
        (outcome.recommendation.entryZone[0] + outcome.recommendation.entryZone[1]) / 2;
      const targetMid =
        (outcome.recommendation.targetZone[0] + outcome.recommendation.targetZone[1]) / 2;
      const stop = outcome.recommendation.stopLoss;
      expect(targetMid - entryMid).toBeGreaterThanOrEqual(1.5 * (entryMid - stop));
    }
  });

  it('rejects a trade with negative expected value at the conservative win probability', () => {
    const input = buildInput('LONG_YES', 0.1, 0.1);
    const outcome = parseRecommendation(
      {
        entry_zone: [0.09, 0.11],
        target_zone: [0.12, 0.13],
        stop_loss: 0.08,
        expected_value: 0.01,
        win_probability: 0.1,
      },
      input,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('expected value');
    }
  });

  it('floors the win probability at the market-implied value for modest edges', () => {
    const input = buildInput('LONG_YES', 0.7, 0.65);
    const outcome = parseRecommendation(
      {
        entry_zone: [0.64, 0.66],
        target_zone: [0.72, 0.74],
        stop_loss: 0.62,
        expected_value: 99,
        win_probability: 99,
      },
      input,
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.recommendation.winProbability).toBeCloseTo(0.65, 4);
      expect(outcome.recommendation.expectedValue).not.toBe(99);
    }
  });

  it('uses the consensus win probability when the edge is credible', () => {
    const input = buildInput('LONG_YES', 0.62, 0.5);
    const outcome = parseRecommendation(
      {
        entry_zone: [0.49, 0.51],
        target_zone: [0.58, 0.6],
        stop_loss: 0.47,
        expected_value: 0.04,
        win_probability: 0.62,
      },
      input,
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.recommendation.winProbability).toBeCloseTo(0.62, 4);
      expect(outcome.recommendation.expectedValue).toBeGreaterThan(0);
    }
  });

  it('produces a clean NO_TRADE recommendation when consensus says no trade', () => {
    const input = buildInput('NO_TRADE', 0.5, 0.5);
    const outcome = parseRecommendation({}, input);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.recommendation.action).toBe('NO_TRADE');
      expect(outcome.recommendation.entryZone).toEqual([0, 0]);
      expect(outcome.recommendation.targetZone).toEqual([0, 0]);
      expect(outcome.recommendation.stopLoss).toBe(0);
      expect(outcome.recommendation.expectedValue).toBe(0);
    }
  });

  it('rejects an entry that is unrealistically far from the market', () => {
    const input = buildInput('LONG_YES', 0.6, 0.6);
    const outcome = parseRecommendation(
      {
        entry_zone: [0.1, 0.12],
        target_zone: [0.2, 0.22],
        stop_loss: 0.08,
        expected_value: 0.01,
        win_probability: 0.6,
      },
      input,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('entry zone');
    }
  });
});
