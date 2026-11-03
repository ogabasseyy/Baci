import { describe, expect, it } from 'vitest';
import { toSnapshot } from './gigl-pricing-snapshot';

describe('toSnapshot', () => {
  it('builds a naira snapshot with margin = price - cost', () => {
    expect(toSnapshot(894_143, 990_000)).toEqual({
      providerCost: 8941.43,
      platformMargin: 958.57,
      price: 9900,
      marginBasisPoints: 1000,
      pricingVersion: 'gigl_platform_margin_v1',
    });
  });

  it('rejects a charge that overflows a safe integer', () => {
    expect(() => toSnapshot(100, Number.MAX_SAFE_INTEGER + 2)).toThrow(
      'GIGL provider cost is too large'
    );
    expect(() => toSnapshot(100, Number.POSITIVE_INFINITY)).toThrow(
      'GIGL provider cost is too large'
    );
  });
});
