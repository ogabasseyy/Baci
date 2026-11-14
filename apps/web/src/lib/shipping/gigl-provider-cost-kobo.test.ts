import { describe, expect, it } from 'vitest';
import { toProviderCostKobo } from './gigl-provider-cost-kobo';

describe('toProviderCostKobo', () => {
  it('converts naira to whole kobo, rounding float noise', () => {
    expect(toProviderCostKobo(8941.43)).toBe(894_143);
    expect(toProviderCostKobo(0.1 + 0.2 + 100)).toBe(10_030);
  });

  it('rejects non-finite costs', () => {
    expect(() => toProviderCostKobo(Number.NaN)).toThrow(
      'GIGL provider cost must be finite'
    );
    expect(() => toProviderCostKobo(Number.POSITIVE_INFINITY)).toThrow(
      'GIGL provider cost must be finite'
    );
  });

  it('rejects zero, negative and sub-kobo costs', () => {
    for (const cost of [0, -5, 0.001]) {
      expect(() => toProviderCostKobo(cost)).toThrow(
        'GIGL provider cost must be positive'
      );
    }
  });

  it('rejects costs too large for a safe integer kobo amount', () => {
    expect(() => toProviderCostKobo(1e300)).toThrow(
      'GIGL provider cost is too large'
    );
  });
});
