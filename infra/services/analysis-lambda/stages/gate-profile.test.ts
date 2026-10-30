import { describe, expect, it } from 'vitest';
import {
  deriveEdgeFloor,
  evaluateAction,
  MAX_ACTIONABLE_DIVERGENCE,
  runConsensusEngine,
} from './consensus-engine';
import type { CrossExamResult, FusedSignal, Thesis } from '../lib/types';

function thesis(direction: 'bull' | 'bear', fairProbability: number): Thesis {
  return { direction, fairProbability, keyArguments: ['argument'], confidence: 0.7 };
}

function fused(
  weightedFairProbability: number,
  options: Partial<FusedSignal> = {},
): FusedSignal {
  return {
    weightedFairProbability,
    fusionConfidence: 0.7,
    signalAlignment: 0.8,
    signalDisagreement: 0.2,
    conflictMap: [],
    ...options,
  };
}

const agreeingDebate: CrossExamResult = { bullScore: 2, bearScore: -2 };
const splitDebate: CrossExamResult = { bullScore: 0, bearScore: 0 };
const bearWins: CrossExamResult = { bullScore: -1, bearScore: 2 };

describe('deriveEdgeFloor', () => {
  it('charges the observed spread plus slippage', () => {
    expect(deriveEdgeFloor(0.02)).toBeCloseTo(0.025, 10);
    expect(deriveEdgeFloor(0.05)).toBeCloseTo(0.055, 10);
  });

  it('floors and caps the requirement', () => {
    expect(deriveEdgeFloor(0.0001)).toBeCloseTo(0.015, 10);
    expect(deriveEdgeFloor(0.5)).toBeCloseTo(0.08, 10);
  });

  it('falls back to a sane default when the spread is unknown', () => {
    expect(deriveEdgeFloor(undefined)).toBeCloseTo(0.025, 10);
    expect(deriveEdgeFloor(Number.NaN)).toBeCloseTo(0.025, 10);
  });
});

describe('evaluateAction - profiles', () => {
  it('strict requires a flat 4c edge regardless of spread', () => {
    // 3.5c edge on a 1c-spread market: tradeable economically, rejected by the
    // flat floor.
    const result = evaluateAction(0.535, 0.5, false, 'low', {
      profile: 'strict',
      spread: 0.01,
    });
    expect(result.action).toBe('NO_TRADE');
    expect(result.reason).toBe('edge_below_threshold');
    expect(result.edgeFloor).toBeCloseTo(0.04, 10);
  });

  it('actionable clears the same edge because it prices the real friction', () => {
    const result = evaluateAction(0.535, 0.5, false, 'low', {
      profile: 'actionable',
      spread: 0.01,
    });
    expect(result.action).toBe('LONG_YES');
    expect(result.edgeFloor).toBeCloseTo(0.015, 10);
  });

  it('actionable charges more on a wide market', () => {
    const result = evaluateAction(0.535, 0.5, false, 'low', {
      profile: 'actionable',
      spread: 0.06,
    });
    expect(result.action).toBe('NO_TRADE');
    expect(result.edgeFloor).toBeCloseTo(0.065, 10);
  });

  it('keeps the divergence cap in both profiles', () => {
    for (const profile of ['strict', 'actionable'] as const) {
      const result = evaluateAction(0.5 + MAX_ACTIONABLE_DIVERGENCE + 0.01, 0.5, false, 'low', {
        profile,
        spread: 0.01,
      });
      expect(result.action).toBe('NO_TRADE');
      expect(result.reason).toBe('divergence_cap');
    }
  });

  it('scales the floor with high liquidity risk in both profiles', () => {
    const result = evaluateAction(0.53, 0.5, false, 'high', {
      profile: 'actionable',
      spread: 0.01,
    });
    expect(result.edgeFloor).toBeCloseTo(0.0225, 10);
    expect(result.action).toBe('LONG_YES');
  });
});

describe('runConsensusEngine - actionable thesis handling', () => {
  it('strict still vetoes when the winning thesis points the other way', () => {
    const result = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      bearWins,
      0.5,
      'low',
      { profile: 'strict', spread: 0.01 },
    );
    expect(result.action).toBe('NO_TRADE');
    expect(result.noTradeReason).toBe('thesis_veto');
  });

  it('actionable keeps the trade and haircuts confidence instead', () => {
    const result = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      bearWins,
      0.5,
      'low',
      { profile: 'actionable', spread: 0.01 },
    );
    expect(result.action).toBe('LONG_YES');
    expect(result.noTradeReason).toBeUndefined();
    // Still recorded, so the disagreement is visible downstream.
    expect(result.thesisVetoTriggered).toBe(true);
    expect(result.thesisConfidenceFactor).toBeLessThan(1);
  });

  it('actionable does not punish a tied debate, strict does', () => {
    const strict = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      splitDebate,
      0.5,
      'low',
      { profile: 'strict', spread: 0.01 },
    );
    const actionable = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      splitDebate,
      0.5,
      'low',
      { profile: 'actionable', spread: 0.01 },
    );

    expect(strict.action).toBe('NO_TRADE');
    expect(actionable.action).toBe('LONG_YES');
    expect(actionable.thesisConfidenceFactor).toBe(1);
  });

  it('stops refusing mid-range markets, which the flat floor could never price', () => {
    // 0.62 market, 4.5c edge. Under strict the 4c floor happens to pass, but a
    // 3c edge would not. With a 1c spread the actionable profile trades both.
    const actionable = runConsensusEngine(
      fused(0.53),
      thesis('bull', 0.55),
      thesis('bear', 0.45),
      agreeingDebate,
      0.5,
      'low',
      { profile: 'actionable', spread: 0.01 },
    );
    expect(actionable.action).toBe('LONG_YES');
    expect(actionable.edgeFloor).toBeCloseTo(0.015, 10);
    expect(actionable.gateProfile).toBe('actionable');
  });

  it('reports the cost-based floor it used', () => {
    const result = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      agreeingDebate,
      0.5,
      'low',
      { profile: 'actionable', spread: 0.03 },
    );
    expect(result.edgeFloor).toBeCloseTo(0.035, 10);
  });
});

describe('evaluateAction - significance floor', () => {
  it('refuses an edge that clears costs but not ensemble noise', () => {
    // 5c edge on a 1c spread pays for the trade, but the ensemble's own standard
    // error is 3c, so 2 sigma requires 6c. That is drift, not signal.
    const result = evaluateAction(0.55, 0.5, false, 'low', {
      profile: 'actionable',
      spread: 0.01,
      fairValueStandardError: 0.03,
    });

    expect(result.action).toBe('NO_TRADE');
    expect(result.reason).toBe('edge_below_significance');
    expect(result.significanceFloor).toBeCloseTo(0.06, 10);
    expect(result.edgeFloor).toBeCloseTo(0.06, 10);
  });

  it('trades the same edge when the ensemble is tight', () => {
    const result = evaluateAction(0.55, 0.5, false, 'low', {
      profile: 'actionable',
      spread: 0.01,
      fairValueStandardError: 0.005,
    });

    expect(result.action).toBe('LONG_YES');
    expect(result.edgeFloor).toBeCloseTo(0.015, 10);
  });

  it('reports the cost floor when cost is the binding constraint', () => {
    const result = evaluateAction(0.53, 0.5, false, 'low', {
      profile: 'actionable',
      spread: 0.05,
      fairValueStandardError: 0.005,
    });

    expect(result.action).toBe('NO_TRADE');
    expect(result.reason).toBe('edge_below_threshold');
    expect(result.edgeFloor).toBeCloseTo(0.055, 10);
  });

  it('does not apply the significance floor to the strict profile', () => {
    const result = evaluateAction(0.55, 0.5, false, 'low', {
      profile: 'strict',
      spread: 0.01,
      fairValueStandardError: 0.03,
    });
    expect(result.action).toBe('LONG_YES');
    expect(result.significanceFloor).toBe(0);
  });
});
