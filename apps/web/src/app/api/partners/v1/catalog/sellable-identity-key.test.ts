import { describe, expect, it } from 'vitest';
import { sellableIdentityKey } from './sellable-identity-key';

describe('sellableIdentityKey', () => {
  it('normalizes optional variant and offer ids to null', () => {
    expect(
      sellableIdentityKey({
        productId: 'prod-1',
        condition: 'new',
      })
    ).toBe(
      sellableIdentityKey({
        productId: 'prod-1',
        variantId: undefined,
        offerId: undefined,
        condition: 'new',
      })
    );
  });

  it('produces distinct keys for different variants, offers, and conditions', () => {
    const base = sellableIdentityKey({
      productId: 'prod-1',
      variantId: 'var-1',
      condition: 'new',
    });
    const otherCondition = sellableIdentityKey({
      productId: 'prod-1',
      variantId: 'var-1',
      condition: 'used',
    });
    const otherVariant = sellableIdentityKey({
      productId: 'prod-1',
      variantId: 'var-2',
      condition: 'new',
    });
    const offerScoped = sellableIdentityKey({
      productId: 'prod-1',
      offerId: 'var-1',
      condition: 'new',
    });

    expect(
      new Set([base, otherCondition, otherVariant, offerScoped]).size
    ).toBe(4);
  });
});
