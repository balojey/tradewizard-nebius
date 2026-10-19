import { describe, expect, it } from 'vitest';
import { fuseSignals } from './signal-fusion';
import type { AgentSignal } from '../lib/types';

function signal(
  agentName: string,
  direction: AgentSignal['direction'],
  fairProbability: number,
  confidence = 0.8,
): AgentSignal {
  return {
    agentName,
    direction,
    confidence,
    fairProbability,
    keyDrivers: [],
    riskFactors: [],
    timestamp: new Date().toISOString(),
  };
}

describe('fuseSignals', () => {
  it('ignores neutral signals at P(YES)=0.5', () => {
    const onlyNeutral = fuseSignals(
      [
        signal('market_microstructure', 'NEUTRAL', 0.5),
        signal('breaking_news', 'NEUTRAL', 0.5),
      ],
      {},
    );

    // Uninformative signals must not manufacture a 0.5 fair value.
    expect(onlyNeutral.weightedFairProbability).toBe(0.5);
    expect(onlyNeutral.fusionConfidence).toBe(0);
  });

  it('does not let neutral signals pull a bearish consensus upward', () => {
    const bearish = fuseSignals(
      [
        signal('market_microstructure', 'NO', 0.15),
        signal('probability_baseline', 'NO', 0.15),
        signal('breaking_news', 'NEUTRAL', 0.5),
        signal('media_sentiment', 'NEUTRAL', 0.5),
      ],
      {},
    );

    expect(bearish.weightedFairProbability).toBeCloseTo(0.15, 2);
  });

  it('treats failed-agent fallbacks (neutral, 0.5) as uninformative', () => {
    const withFallbacks = fuseSignals(
      [
        signal('market_microstructure', 'NO', 0.12),
        signal('breaking_news', 'NEUTRAL', 0.5, 0.3),
        signal('media_sentiment', 'NEUTRAL', 0.5, 0.3),
      ],
      {},
    );

    expect(withFallbacks.weightedFairProbability).toBeCloseTo(0.12, 2);
  });

  it('still blends multiple informative views', () => {
    const mixed = fuseSignals(
      [
        signal('market_microstructure', 'YES', 0.7),
        signal('breaking_news', 'NO', 0.3),
      ],
      {},
    );

    expect(mixed.weightedFairProbability).toBeCloseTo(0.5, 1);
  });
});
