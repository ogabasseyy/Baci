import { describe, expect, it } from 'vitest';
import { isActivated } from './plan-activation';

describe('isActivated', () => {
  it('activates at the 5% threshold and stays inactive below it', () => {
    // Arrange & Act & Assert
    expect(isActivated(500_000, 10_000_000)).toBe(true);
    expect(isActivated(499_999, 10_000_000)).toBe(false);
  });

  it('rejects invalid contributions and zero prices', () => {
    // Arrange & Act & Assert
    expect(() => isActivated(-1, 10_000_000)).toThrow(RangeError);
    expect(() => isActivated(500_000, 0)).toThrow(RangeError);
  });
});
