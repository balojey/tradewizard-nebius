import { describe, expect, it } from 'vitest';
import { buildWeightsFromSignalRows } from './historical-context';

interface Row {
  agent_name: string;
  direction: string;
  fair_probability: string | number;
  outcome: number;
}

function rows(
  agent: string,
  probability: number,
  outcome: number,
  count = 4,
  direction = 'YES',
): Row[] {
  return Array.from({ length: count }, () => ({
    agent_name: agent,
    direction,
    fair_probability: probability,
    outcome,
  }));
}

describe('buildWeightsFromSignalRows', () => {
  it('rewards well-calibrated agents and penalizes confidently wrong ones', () => {
    const weights = buildWeightsFromSignalRows([
      ...rows('calibrated', 0.9, 1),
      ...rows('coin_flip', 0.5, 1),
      ...rows('confidently_wrong', 0.9, 0),
    ]);

    expect(weights.calibrated).toBeGreaterThan(weights.coin_flip);
    expect(weights.coin_flip).toBeGreaterThan(weights.confidently_wrong);
    expect(weights.calibrated).toBeGreaterThan(1.5);
    expect(weights.confidently_wrong).toBeLessThan(0.6);
  });

  it('ignores agents with fewer than two scored signals', () => {
    const weights = buildWeightsFromSignalRows(rows('one_sample', 0.9, 1, 1));

    expect(weights.one_sample).toBeUndefined();
  });

  it('clamps extreme inputs safely', () => {
    const weights = buildWeightsFromSignalRows([
      ...rows('perfect', 0.999, 1),
      ...rows('terrible', 0.001, 1),
    ]);

    expect(weights.perfect).toBeLessThanOrEqual(2.0);
    expect(weights.terrible).toBeGreaterThanOrEqual(0.4);
  });
});
