import { describe, expect, it } from 'vitest';
import { finiteNonnegative } from './finite-nonnegative';

describe('finiteNonnegative', () => {
  it('rejects negative FOCUS billing quantities', () => {
    expect(() => finiteNonnegative(-1, 'ConsumedQuantity')).toThrow(
      'billing row has an invalid ConsumedQuantity'
    );
  });

  it('returns finite non-negative quantities', () => {
    expect(finiteNonnegative(0, 'ConsumedQuantity')).toBe(0);
    expect(finiteNonnegative(12.5, 'ConsumedQuantity')).toBe(12.5);
  });
});
