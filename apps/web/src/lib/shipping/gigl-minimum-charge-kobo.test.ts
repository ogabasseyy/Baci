import { describe, expect, it } from 'vitest';
import { minimumChargeKobo } from './gigl-minimum-charge-kobo';

describe('minimumChargeKobo', () => {
  it('adds the 10% margin floor', () => {
    expect(minimumChargeKobo(1_000_000)).toBe(1_100_000);
  });

  it('ceils a fractional kobo charge', () => {
    // 100,001 * 1.1 = 110,001.1 -> 110,002
    expect(minimumChargeKobo(100_001)).toBe(110_002);
    expect(minimumChargeKobo(894_143)).toBe(983_558);
  });
});
