import { describe, expect, it } from 'vitest';
import { reviewedChatwootCheckoutItems } from './chatwoot-checkout-reviewed-items';
import {
  checkoutDisplayCart,
  checkoutReview,
} from './chatwoot-checkout-test-fixtures';

const [line] = checkoutReview.lines;
if (!line) throw new Error('fixture needs a line');

describe('reviewedChatwootCheckoutItems', () => {
  it('returns the reviewed lines priced from the server review', () => {
    const items = reviewedChatwootCheckoutItems(
      checkoutReview,
      checkoutDisplayCart
    );

    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ price: 1000, quantity: 2 });
  });

  it('rejects a non-NGN review', () => {
    expect(
      reviewedChatwootCheckoutItems(
        { ...checkoutReview, currency: 'USD' },
        checkoutDisplayCart
      )
    ).toBeNull();
  });

  it('rejects an unavailable line or count', () => {
    expect(
      reviewedChatwootCheckoutItems(
        { ...checkoutReview, lines: [{ ...line, available: false }] },
        checkoutDisplayCart
      )
    ).toBeNull();
    expect(
      reviewedChatwootCheckoutItems(
        { ...checkoutReview, unavailableCount: 1 },
        checkoutDisplayCart
      )
    ).toBeNull();
  });

  it('rejects a subtotal that moved or a display cart that lost its shell', () => {
    expect(
      reviewedChatwootCheckoutItems(
        { ...checkoutReview, subtotalMinor: 250_000 },
        checkoutDisplayCart
      )
    ).toBeNull();
    expect(reviewedChatwootCheckoutItems(checkoutReview, [])).toBeNull();
  });
});
