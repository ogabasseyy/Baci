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

  it('keeps the same condition with a different offer distinct', () => {
    const offerA = {
      ...baseItem,
      offerId: '44444444-4444-4444-8444-444444444444',
    };
    const offerB = {
      ...baseItem,
      offerId: '55555555-5555-4555-8555-555555555555',
    };

    expect(cartLineIdentity(offerA)).not.toBe(cartLineIdentity(offerB));
    expect(cartLineIdentity(baseItem)).not.toBe(cartLineIdentity(offerA));
  });

  it('treats an omitted offer as the same identity', () => {
    expect(cartLineIdentity(baseItem)).toBe(
      cartLineIdentity({ ...baseItem, offerId: undefined })
    );
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

describe('cart identity compatibility', () => {
  const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const variantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('matches product UUIDs regardless of letter case', () => {
    expect(cartLineIdentity({ productId })).toBe(
      cartLineIdentity({ productId: productId.toUpperCase() })
    );
  });

  it('matches variant UUIDs regardless of letter case', () => {
    expect(cartLineIdentity({ productId, variantId })).toBe(
      cartLineIdentity({ productId, variantId: variantId.toUpperCase() })
    );
  });

  it('matches offer UUIDs regardless of letter case', () => {
    const offerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(cartLineIdentity({ productId, offerId })).toBe(
      cartLineIdentity({ productId, offerId: offerId.toUpperCase() })
    );
  });

  it('preserves an explicitly empty option as distinct from an absent option', () => {
    expect(
      cartLineIdentity({ productId, options: { engraving: '' } })
    ).not.toBe(cartLineIdentity({ productId }));
  });

  it('preserves option value case even when UUIDs are normalized', () => {
    expect(
      cartLineIdentity({ productId, options: { engraving: 'AbC' } })
    ).not.toBe(cartLineIdentity({ productId, options: { engraving: 'abc' } }));
  });

  it('does not collide when option values contain separator characters', () => {
    expect(
      cartLineIdentity({ productId, options: { color: 'red::storage=128GB' } })
    ).not.toBe(
      cartLineIdentity({
        productId,
        options: { color: 'red', storage: '128GB' },
      })
    );
  });

  it('normalizes without modifying caller selections', () => {
    const options = Object.freeze({ storage: '256GB', engraving: '' });
    const item = Object.freeze({
      productId: productId.toUpperCase(),
      variantId: variantId.toUpperCase(),
      options,
    });
    cartLineIdentity(item);
    expect(item.productId).toBe(productId.toUpperCase());
    expect(item.variantId).toBe(variantId.toUpperCase());
    expect(item.options).toEqual({ storage: '256GB', engraving: '' });
  });
});
