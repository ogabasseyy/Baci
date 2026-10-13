import { describe, expect, it } from 'vitest';
import { finiteSigned } from './finite-signed';

describe('finiteSigned', () => {
  it('rejects non-finite FOCUS billing costs', () => {
    expect(() => finiteSigned(Number.NaN, 'EffectiveCost')).toThrow(
      'billing row has an invalid EffectiveCost'
    );
  });

  it('allows signed costs including credits', () => {
    expect(finiteSigned(-4.2, 'EffectiveCost')).toBe(-4.2);
    expect(finiteSigned(9, 'EffectiveCost')).toBe(9);
  });
});
