import { describe, expect, it } from 'vitest';
import {
  computePriceVolatility,
  deriveLiquidityRisk,
  type PricePoint,
} from './data-preparation';

function point(price: number): PricePoint {
  return {
    timestamp: 0,
    datetimeUtc: '2026-01-01 00:00:00',
    price,
  };
}

describe('computePriceVolatility', () => {
  it('returns zero for fewer than two points', () => {
    expect(computePriceVolatility([])).toBe(0);
    expect(computePriceVolatility([point(0.5)])).toBe(0);
  });

  it('returns zero for a flat series', () => {
    expect(computePriceVolatility([point(0.5), point(0.5), point(0.5)])).toBe(0);
  });

  it('computes population standard deviation for a short series', () => {
    expect(computePriceVolatility([point(0.5), point(0.6)])).toBeCloseTo(0.05, 6);
  });
});

describe('deriveLiquidityRisk', () => {
  it('marks a wide spread as high risk', () => {
    expect(deriveLiquidityRisk({ spread: 0.05, liquidity: 100_000 })).toBe('high');
  });

  it('marks shallow liquidity as high risk', () => {
    expect(deriveLiquidityRisk({ spread: 0.01, liquidity: 1_000 })).toBe('high');
  });

  it('marks a tight, deep market as low risk', () => {
    expect(deriveLiquidityRisk({ spread: 0.01, liquidity: 50_000 })).toBe('low');
  });

  it('defaults to medium when data is missing', () => {
    expect(deriveLiquidityRisk({})).toBe('medium');
  });
});
