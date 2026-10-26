import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithCsrf } from '@/lib/api-client';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';

import {
  prepareSharedCartCheckout,
  reviewedCheckoutItems,
  type SharedCartCheckoutReview,
} from './shared-cart-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

function _snapshot(overrides: Record<string, unknown> = {}) {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 3,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

describe('shared-cart-client checkout prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const REVIEW_SNAPSHOT = {
    cartId: '22222222-2222-4222-8222-222222222222',
    cartVersion: 3,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 25000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
  };

  it('prepares checkout and returns the session reference', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({
        replayed: false,
        sessionReused: false,
        snapshot: REVIEW_SNAPSHOT,
      })
    );

    const result = await prepareSharedCartCheckout({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });

    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/cart/checkout',
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = vi.mocked(fetchWithCsrf).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });
    expect(result).toEqual({
      ok: true,
      replayed: false,
      review: {
        cartId: '22222222-2222-4222-8222-222222222222',
        cartVersion: 3,
        checkoutSessionId: '55555555-5555-4555-8555-555555555555',
        currency: 'NGN',
        generation: 1,
        lines: [],
        merchantId: '11111111-1111-4111-8111-111111111111',
        subtotalMinor: 25000,
        unavailableCount: 0,
      },
      sessionReused: false,
    });
  });

  it('surfaces refresh_required with the live version', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'refresh_required',
          currentVersion: 4,
          error: 'Cart changed.',
        },
        409
      )
    );

    const result = await prepareSharedCartCheckout({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });

    expect(result).toEqual({
      code: 'refresh_required',
      currentVersion: 4,
      ok: false,
      retryable: false,
    });
  });

  it('fails closed on malformed snapshots and transport errors', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ replayed: false, sessionReused: false, snapshot: {} })
    );

    await expect(
      prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-1',
      })
    ).resolves.toMatchObject({ code: 'temporarily_unavailable', ok: false });

    vi.mocked(fetchWithCsrf).mockRejectedValueOnce(new Error('offline'));
    await expect(
      prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-1',
      })
    ).resolves.toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
  });
});

describe('reviewedCheckoutItems', () => {
  const line = {
    assuranceRate: null,
    available: true,
    condition: null,
    effectiveUnitPriceMinor: 12000,
    hasAssurance: false,
    id: 'line-1',
    lastUnitPriceMinor: 15000,
    manageStock: true,
    negotiatedUnitPriceMinor: 12000,
    negotiationInvalidated: false,
    negotiationStatus: 'accepted',
    options: {},
    priceChanged: true,
    productId: '44444444-4444-4444-8444-444444444444',
    quantity: 2,
    stockQty: 5,
    unavailableReason: null,
    validatedUnitPriceMinor: 15000,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
  } satisfies SharedCartCheckoutReview['lines'][number];
  const review: SharedCartCheckoutReview = {
    cartId: '22222222-2222-4222-8222-222222222222',
    cartVersion: 3,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    currency: 'NGN',
    generation: 1,
    lines: [line],
    merchantId: '11111111-1111-4111-8111-111111111111',
    subtotalMinor: 24000,
    unavailableCount: 0,
  };
  const shell = {
    cartItemId: 'line-1',
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Phone',
    price: 150,
    product_id: '44444444-4444-4444-8444-444444444444',
    quantity: 1,
    serverLineId: 'line-1',
  } as never;

  it('uses reviewed quantity and effective prices over display values', () => {
    const items = reviewedCheckoutItems([shell], review);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      negotiatedPrice: 120,
      price: 150,
      quantity: 2,
    });
    expect(buildCheckoutOrderItems(items ?? [])[0]).toMatchObject({
      price: 120,
      value: 240,
    });
  });

  it.each([
    'pending',
    'rejected',
  ] as const)('submits catalog price without a proposal for a reviewed %s negotiation', (negotiationStatus) => {
    const items = reviewedCheckoutItems([shell], {
      ...review,
      lines: [{ ...line, negotiationStatus, effectiveUnitPriceMinor: 15000 }],
    });
    expect(items?.[0].negotiatedPrice).toBeUndefined();
    expect(items?.[0].negotiationStatus).toBe(negotiationStatus);
    expect(buildCheckoutOrderItems(items ?? [])[0]).toMatchObject({
      price: 150,
    });
    expect(buildCheckoutOrderItems(items ?? [])[0]).toMatchObject({
      value: 300,
    });
  });

  it('drops an invalidated negotiation', () => {
    const items = reviewedCheckoutItems([shell], {
      ...review,
      lines: [{ ...line, negotiationInvalidated: true }],
    });
    expect(items?.[0].negotiatedPrice).toBeUndefined();
  });

  it('returns null when a reviewed line has no display shell', () => {
    expect(reviewedCheckoutItems([], review)).toBeNull();
  });

  it('returns null when the display cart includes unimported lines not in the review', () => {
    const legacyShell = {
      cartItemId: 'legacy-1',
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Legacy Prize',
      price: 0,
      product_id: '99999999-9999-4999-8999-999999999999',
      quantity: 1,
    } as never;
    expect(reviewedCheckoutItems([shell, legacyShell], review)).toBeNull();
  });

  it('never restores voucher credentials from the display shell', () => {
    const voucherShell = Object.assign({}, shell, {
      quizAwardId: 'award-shell',
      quizVoucherToken: 'token-shell',
    }) as never;
    const cleared = reviewedCheckoutItems([voucherShell], review);
    expect(cleared?.[0].quizAwardId).toBeUndefined();
    expect(cleared?.[0].quizVoucherToken).toBeUndefined();
    const reviewedPair = reviewedCheckoutItems([voucherShell], {
      ...review,
      lines: [{ ...line, voucherAwardId: 'award-1', voucherToken: 'token-1' }],
    });
    expect(reviewedPair?.[0].quizAwardId).toBe('award-1');
    expect(reviewedPair?.[0].quizVoucherToken).toBe('token-1');
    const partialPair = reviewedCheckoutItems([voucherShell], {
      ...review,
      lines: [{ ...line, voucherAwardId: 'award-1', voucherToken: null }],
    });
    expect(partialPair?.[0].quizAwardId).toBeUndefined();
    expect(partialPair?.[0].quizVoucherToken).toBeUndefined();
  });
});

describe('shared-cart-client checkout cart pin', () => {
  it('rejects a review for a different cart than submitted', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({
        replayed: false,
        sessionReused: false,
        snapshot: {
          cartId: '99999999-9999-4999-8999-999999999999',
          cartVersion: 3,
          checkoutSessionId: '55555555-5555-4555-8555-555555555555',
          estimates: {
            currency: 'NGN',
            lineCount: 1,
            subtotalMinor: 25000,
            unavailableCount: 0,
          },
          generation: 1,
          lines: [],
          merchantId: '11111111-1111-4111-8111-111111111111',
        },
      })
    );
    const result = await prepareSharedCartCheckout({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-mismatch',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('refresh_required');
  });
});
