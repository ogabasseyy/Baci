import type { CartSnapshot } from '@baci/shared/cart';
import { describe, expect, it } from 'vitest';
import { projectChatwootCartReview } from './cart-review-projection';

function makeCart(lineCount = 1, overrides: Partial<CartSnapshot> = {}) {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    id: `line-${index}`,
    item: { productId: `product-${index}` },
    quantity: 2,
    unitPriceMinor: 100,
    lineTotalMinor: 200,
  }));
  return {
    cartId: 'cart-1',
    merchantId: 'merchant-1',
    state: 'active' as const,
    version: 8,
    lines,
    currency: 'NGN',
    subtotalMinor: lineCount * 200,
    totalMinor: lineCount * 200,
    estimatedTotals: false,
    expiresAt: '2026-11-08T12:00:00.000Z',
    ...overrides,
  } satisfies CartSnapshot;
}

function names(lineCount: number) {
  return Object.fromEntries(
    Array.from({ length: lineCount }, (_, index) => [
      `product-${index}`,
      `Server product ${index}`,
    ])
  );
}

describe('projectChatwootCartReview', () => {
  it('projects canonical public line fields and subtotal', () => {
    expect(projectChatwootCartReview(makeCart(), names(1))).toEqual({
      cartVersion: 8,
      currency: 'NGN',
      estimatedTotals: false,
      items: [
        {
          lineId: 'line-0',
          name: 'Server product 0',
          productId: 'product-0',
          variantId: null,
          condition: null,
          quantity: 2,
          unitPriceMinor: 100,
          lineTotalMinor: 200,
        },
      ],
      itemsSubtotalMinor: 200,
    });
  });

  it('accepts the shared-cart maximum of 20 lines and rejects more', () => {
    expect(
      projectChatwootCartReview(makeCart(20), names(20))?.items
    ).toHaveLength(20);
    expect(projectChatwootCartReview(makeCart(21), names(21))).toBeNull();
  });

  it.each([
    ['negative version', { version: -1 }],
    ['fractional version', { version: 1.5 }],
    ['invalid currency', { currency: 'ngn' }],
    ['negative subtotal', { subtotalMinor: -1 }],
    ['mismatched subtotal', { subtotalMinor: 199 }],
  ])('rejects %s', (_label, overrides) => {
    expect(
      projectChatwootCartReview(makeCart(1, overrides), names(1))
    ).toBeNull();
  });

  it('rejects a line whose product has no merchant-scoped name', () => {
    expect(projectChatwootCartReview(makeCart(), {})).toBeNull();
  });
});
