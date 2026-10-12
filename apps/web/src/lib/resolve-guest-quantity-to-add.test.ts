import { describe, expect, it } from 'vitest';
import { resolveGuestQuantityToAdd } from './resolve-guest-quantity-to-add';

describe('resolveGuestQuantityToAdd', () => {
  it('falls back to the link quantity without a handoff target', () => {
    expect(resolveGuestQuantityToAdd(undefined, 2, 3)).toBe(3);
  });

  it('tops up to the handoff target without overshooting', () => {
    expect(resolveGuestQuantityToAdd(5, 2, 1)).toBe(3);
  });

  it('never shrinks an already-transferred line', () => {
    expect(resolveGuestQuantityToAdd(2, 5, 1)).toBe(0);
    expect(resolveGuestQuantityToAdd(2, 2, 1)).toBe(0);
  });
});
