import { describe, expect, it } from 'vitest';
import { buildChatwootInlineReviewResponse } from './chatwoot-inline-review-response';

const snapshot = {
  cartVersion: 4,
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
      unitPriceMinor: 120_000,
      lineTotalMinor: 240_000,
    },
  ],
  itemsSubtotalMinor: 240_000,
};

describe('buildChatwootInlineReviewResponse', () => {
  it('returns only the safe exact-total review projection and caps its TTL', () => {
    expect(buildChatwootInlineReviewResponse('req-1', snapshot, 3_000, 1_000_000)).toEqual({
      requestId: 'req-1',
      status: 'ready',
      remainingTtlMs: 30 * 60 * 1000,
      cartVersion: 4,
      currency: 'NGN',
      subtotalMinor: 240_000,
      items: [{ name: 'Phone', quantity: 2, unitPriceMinor: 120_000, lineTotalMinor: 240_000 }],
    });
  });

  it.each([
    ['estimated totals', { ...snapshot, estimatedTotals: true }, 2_000],
    ['invalid snapshot', null, 2_000],
    ['expired session', snapshot, 999],
  ])('fails closed for %s', (_reason, input, sessionExpiresAt) => {
    expect(buildChatwootInlineReviewResponse('req-2', input, sessionExpiresAt, 1_000_000)).toEqual({
      requestId: 'req-2',
      status: 'unavailable',
    });
  });
});
