import { describe, expect, it } from 'vitest';
import {
  cartItemToIdentity,
  displayLineMatchesAddLane,
  isCartCondition,
} from './shared-cart-display-identity';

describe('display identity normalization', () => {
  it('preserves condition, variants and selected options without changing the source', () => {
    const source = {
      id: 'phone',
      variantId: '128gb',
      condition: 'used',
      selectedColor: 'green',
      selectedStorage: '128GB',
      variantAttributes: { network: '5G' },
    };
    expect(cartItemToIdentity(source)).toEqual({
      productId: 'phone',
      variantId: '128gb',
      condition: 'used',
      options: { network: '5G', color: 'green', storage: '128GB' },
    });
    expect(source.variantAttributes).toEqual({ network: '5G' });
  });
  it('keeps an exact offer id on the delegated identity', () => {
    expect(
      cartItemToIdentity({
        id: 'phone',
        condition: 'used',
        offerId: '44444444-4444-4444-8444-444444444444',
      })
    ).toEqual({
      productId: 'phone',
      condition: 'used',
      offerId: '44444444-4444-4444-8444-444444444444',
    });
  });
  it('omits unsupported conditions and empty optional identity fields', () => {
    expect(
      cartItemToIdentity({ id: 'phone', condition: 'unsupported' })
    ).toEqual({ productId: 'phone' });
    expect(isCartCondition(undefined)).toBe(false);
  });
  it('matches add lanes only when every attachment agrees', () => {
    const line = {
      negotiatedPrice: 12.5,
      negotiationStatus: 'accepted' as const,
      quizAwardId: 'award',
      quizVoucherToken: 'token',
    };
    expect(
      displayLineMatchesAddLane(line as never, {
        negotiatedUnitPriceMinor: 1250,
        negotiationStatus: 'accepted',
        voucherAwardId: 'award',
        voucherToken: 'token',
      })
    ).toBe(true);
    expect(
      displayLineMatchesAddLane(line as never, { voucherToken: 'token' })
    ).toBe(false);
    expect(displayLineMatchesAddLane({} as never, {})).toBe(true);
  });
});
