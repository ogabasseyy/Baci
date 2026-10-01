import { describe, expect, it } from 'vitest';
import { purchasingPowerKobo } from './purchasing-power-kobo';

describe('purchasingPowerKobo', () => {
  it('sums confirmed principal and verified paid interest', () => {
    // Arrange & Act & Assert
    expect(purchasingPowerKobo(10_000_000, 250_000)).toBe(10_250_000);
    expect(purchasingPowerKobo(0, 0)).toBe(0);
  });

  it('accepts a total exactly at the safe-integer boundary', () => {
    // Arrange & Act & Assert
    expect(purchasingPowerKobo(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it('rejects a total past the safe-integer boundary instead of rounding', () => {
    // Arrange & Act & Assert
    expect(() => purchasingPowerKobo(Number.MAX_SAFE_INTEGER, 2)).toThrow(
      RangeError
    );
  });

  it('rejects negative and non-integer operands', () => {
    // Arrange & Act & Assert
    expect(() => purchasingPowerKobo(-1, 0)).toThrow(RangeError);
    expect(() => purchasingPowerKobo(0, 1.5)).toThrow(RangeError);
  });
});
