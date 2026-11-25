import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.unstubAllEnvs());
  it('offers instalments only for an NGN review on the local Oxygen staging backend', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3451');
    const buildReview = (currency: string) =>
      buildChatwootInlineReviewResponse('req-1', { ...snapshot, currency }, 2_000, 1_000_000);
    expect(buildReview('NGN')).toMatchObject({ paySmallSmallAvailable: true });
    expect(buildReview('USD')).not.toHaveProperty('paySmallSmallAvailable');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test');
    expect(buildReview('NGN')).not.toHaveProperty('paySmallSmallAvailable');
  });
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
