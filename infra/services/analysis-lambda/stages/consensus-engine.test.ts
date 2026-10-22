import { describe, expect, it } from 'vitest';
import {
  calculateConsensus,
  determineAction,
  MAX_ACTIONABLE_DIVERGENCE,
  runConsensusEngine,
} from './consensus-engine';
import type { CrossExamResult, FusedSignal, Thesis } from '../lib/types';

function thesis(direction: 'bull' | 'bear', fairProbability: number): Thesis {
  return {
    direction,
    fairProbability,
    keyArguments: ['argument'],
    confidence: 0.7,
  };
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

describe('calculateConsensus', () => {
  it('uses the anchored fusion probability instead of averaging role-play theses', () => {
    const result = calculateConsensus(
      thesis('bull', 0.85),
      thesis('bear', 0.25),
      { bullScore: 1, bearScore: 1 },
      fused(0.83),
    );

    // The old 60/40 thesis blend would have produced ~0.66 here.
    expect(result.probability).toBeCloseTo(0.83, 4);
    expect(result.failed).toBe(false);
  });

  it('fails consensus when disagreement is above the threshold', () => {
    const result = calculateConsensus(
      thesis('bull', 0.8),
      thesis('bear', 0.2),
      { bullScore: 0, bearScore: 0 },
      fused(0.5, { signalDisagreement: 0.45, fusionConfidence: 0.8 }),
    );

    expect(result.failed).toBe(true);
  });

  it('fails consensus when confidence is too low', () => {
    const result = calculateConsensus(
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      { bullScore: 0, bearScore: 0 },
      fused(0.55, { fusionConfidence: 0.05, signalDisagreement: 0.1 }),
    );

    expect(result.failed).toBe(true);
  });

  it('reduces confidence when the stronger role-play thesis disagrees with fusion', () => {
    const aligned = calculateConsensus(
      thesis('bull', 0.8),
      thesis('bear', 0.2),
      { bullScore: 2, bearScore: -2 },
      fused(0.75),
    );
    const divergent = calculateConsensus(
      thesis('bull', 0.25),
      thesis('bear', 0.15),
      { bullScore: -2, bearScore: 2 },
      fused(0.75),
    );

    expect(divergent.confidence).toBeLessThan(aligned.confidence);
  });
});

describe('determineAction', () => {
  it('returns NO_TRADE when consensus failed', () => {
    expect(determineAction(0.9, 0.5, true, 'low')).toBe('NO_TRADE');
  });

  it('blocks edges larger than the divergence limit', () => {
    expect(
      determineAction(0.5, 0.8, false, 'low'),
    ).toBe('NO_TRADE');
    expect(
      determineAction(0.8 + MAX_ACTIONABLE_DIVERGENCE + 0.001, 0.8, false, 'low'),
    ).toBe('NO_TRADE');
  });

  it('acts on a credible edge', () => {
    expect(determineAction(0.58, 0.5, false, 'low')).toBe('LONG_YES');
    expect(determineAction(0.42, 0.5, false, 'low')).toBe('LONG_NO');
  });

  it('ignores edges inside the threshold', () => {
    expect(determineAction(0.52, 0.5, false, 'low')).toBe('NO_TRADE');
  });

  it('requires a larger edge under high liquidity risk', () => {
    expect(determineAction(0.08, 0.0, false, 'low')).toBe('LONG_YES');
    expect(determineAction(0.08, 0.0, false, 'high')).toBe('NO_TRADE');
  });
});

describe('runConsensusEngine', () => {
  it('flags the divergence guard when the edge is implausibly large', () => {
    const result = runConsensusEngine(
      fused(0.33),
      thesis('bull', 0.4),
      thesis('bear', 0.2),
      { bullScore: 0, bearScore: 0 },
      0.81,
      'medium',
    );

    expect(result.action).toBe('NO_TRADE');
    expect(result.divergenceGuardTriggered).toBe(true);
  });

  it('does not flag the guard for a normal edge', () => {
    const result = runConsensusEngine(
      fused(0.58),
      thesis('bull', 0.6),
      thesis('bear', 0.4),
      { bullScore: 0, bearScore: 0 },
      0.5,
      'low',
    );

    expect(result.action).toBe('LONG_YES');
    expect(result.divergenceGuardTriggered).toBe(false);
  });
});
