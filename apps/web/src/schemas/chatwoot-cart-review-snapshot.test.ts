import { describe, expect, it } from 'vitest';
import { chatwootCartReviewSnapshotSchema } from './chatwoot-cart-review-snapshot';

describe('chatwootCartReviewSnapshotSchema', () => {
  const snapshot = {
    cartVersion: 1,
    currency: 'NGN',
    estimatedTotals: false,
    items: [
      {
        lineId: 'line-1',
        name: 'Phone',
        productId: 'product-1',
        variantId: null,
        condition: null,
        quantity: 2,
        unitPriceMinor: 100,
        lineTotalMinor: 200,
      },
    ],
    itemsSubtotalMinor: 200,
  };

  it('accepts a bounded canonical cart snapshot', () => {
    expect(chatwootCartReviewSnapshotSchema.safeParse(snapshot).success).toBe(
      true
    );
  });

  it.each([
    ['unsupported currency format', { ...snapshot, currency: 'NG' }],
    ['lowercase currency', { ...snapshot, currency: 'ngn' }],
    ['negative version', { ...snapshot, cartVersion: -1 }],
    ['unknown field', { ...snapshot, checkoutSessionId: 'secret' }],
    [
      'empty item name',
      { ...snapshot, items: [{ ...snapshot.items[0], name: '' }] },
    ],
    [
      'zero quantity',
      { ...snapshot, items: [{ ...snapshot.items[0], quantity: 0 }] },
    ],
    [
      'quantity over limit',
      { ...snapshot, items: [{ ...snapshot.items[0], quantity: 1001 }] },
    ],
    [
      'fractional unit price',
      { ...snapshot, items: [{ ...snapshot.items[0], unitPriceMinor: 10.5 }] },
    ],
    [
      'invalid nullable field type',
      { ...snapshot, items: [{ ...snapshot.items[0], variantId: 42 }] },
    ],
    [
      'too many cart lines',
      { ...snapshot, items: Array(21).fill(snapshot.items[0]) },
    ],
  ])('rejects %s', (_label, value) => {
    expect(chatwootCartReviewSnapshotSchema.safeParse(value).success).toBe(
      false
    );
  });
});
