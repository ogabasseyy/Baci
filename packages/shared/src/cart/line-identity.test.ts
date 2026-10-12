import { describe, expect, it } from 'vitest';
import { cartLineIdentity } from './line-identity';
import type { CartItemIdentity } from './types';

const baseItem: CartItemIdentity = {
  condition: 'new',
  options: { color: 'red', storage: '128gb' },
  productId: '11111111-1111-4111-8111-111111111111',
  variantId: '22222222-2222-4222-8222-222222222222',
};

describe('cartLineIdentity', () => {
  it('returns a stable key for the same identity', () => {
    expect(cartLineIdentity(baseItem)).toBe(cartLineIdentity({ ...baseItem }));
  });

  it('keeps the same product with a different variant distinct', () => {
    const other = {
      ...baseItem,
      variantId: '33333333-3333-4333-8333-333333333333',
    };

    expect(cartLineIdentity(baseItem)).not.toBe(cartLineIdentity(other));
  });

  it('keeps a missing variant distinct from a present variant', () => {
    const { variantId: _dropped, ...withoutVariant } = baseItem;

    expect(cartLineIdentity(baseItem)).not.toBe(
      cartLineIdentity(withoutVariant)
    );
  });

  it('keeps the same product and variant with a different condition distinct', () => {
    const other = { ...baseItem, condition: 'used' as const };

    expect(cartLineIdentity(baseItem)).not.toBe(cartLineIdentity(other));
  });

  it('keeps the same product with different options distinct', () => {
    const other = {
      ...baseItem,
      options: { color: 'blue', storage: '128gb' },
    };

    expect(cartLineIdentity(baseItem)).not.toBe(cartLineIdentity(other));
  });

  it('matches regardless of option ordering', () => {
    const reordered = {
      ...baseItem,
      options: { storage: '128gb', color: 'red' },
    };

    expect(cartLineIdentity(baseItem)).toBe(cartLineIdentity(reordered));
  });

  it('treats missing and empty options as the same identity', () => {
    const { options: _dropped, ...withoutOptions } = baseItem;

    expect(cartLineIdentity(withoutOptions)).toBe(
      cartLineIdentity({ ...withoutOptions, options: {} })
    );
  });

  it('does not grant validity to unknown option values through normalization', () => {
    const foreign = {
      ...baseItem,
      options: { color: 'not-a-real-color<script>', storage: '128gb' },
    };
    const key = cartLineIdentity(foreign);

    expect(key).not.toBe(cartLineIdentity(baseItem));
    expect(key).toContain('not-a-real-color<script>');
  });

  it('keeps unknown option keys distinct instead of dropping them', () => {
    const withExtra = {
      ...baseItem,
      options: { ...baseItem.options, injected: 'x' },
    };

    expect(cartLineIdentity(baseItem)).not.toBe(cartLineIdentity(withExtra));
    expect(cartLineIdentity(withExtra)).toContain('injected');
  });
});
