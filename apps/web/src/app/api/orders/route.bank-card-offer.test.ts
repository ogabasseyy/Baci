import { expect, it, vi } from 'vitest';
import { computeOrderNegotiationDiscount } from '@/lib/checkout/order-negotiation-discount';
import {
  authenticateApiRequest,
  NextRequest,
  POST,
} from './route.order-test-mocks.test-support';
import {
  baseOrderPayload,
  buildPilotMockSupabase,
  MERCHANT_ID,
  mockAuthUser,
  primeAdminOrderCurrencyRead,
} from './route.redvault-pilot-fixtures.test-support';

const effects = vi.hoisted(() => ({ purge: vi.fn(), record: vi.fn() }));

vi.mock('@/lib/checkout/schedule-checkout-product-blog-purge', () => ({
  scheduleCheckoutProductBlogPurge: effects.purge,
}));
vi.mock('@/lib/events/record-platform-order-created-event', () => ({
  recordPlatformOrderCreatedEvent: effects.record,
}));

vi.mock('@/lib/checkout/order-negotiation-discount', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@/lib/checkout/order-negotiation-discount');
  return {
    ...actual,
    computeOrderNegotiationDiscount: vi.fn(
      actual.computeOrderNegotiationDiscount
    ),
  };
});

vi.mock('@/config/bank-card-offers', () => ({
  BANK_CARD_OFFERS: [
    {
      id: 'black-friday',
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      bankCode: '035',
      verifiedIssuerName: 'Wema Bank',
      cardBrands: ['visa'],
      eligibleProductIds: ['11111111-1111-4111-8111-111111111111'],
      discountBasisPoints: 500,
      maximumDiscountKobo: 5000,
      startsAt: '2025-01-01T00:00:00Z',
      endsAt: '2035-01-01T00:00:00Z',
      approvedTermsReference: 'test-terms',
      enabled: true,
    },
  ],
}));

it.each([
  { quantity: 1, expectedTotal: 95, status: 201 },
  { quantity: 1, expectedTotal: 95, status: 200 },
  { quantity: 1, expectedTotal: 95, status: 403, csrf: false },
  { quantity: 1, expectedTotal: 95, status: 201, csrf: false, bearer: true },
  {
    quantity: 10_001,
    expectedTotal: 95,
    status: 409,
    errorCode: 'BANK_CARD_OFFER_CART_INVALID',
  },
  { quantity: 1, expectedTotal: undefined, status: 409 },
  {
    quantity: 1,
    expectedTotal: 94.05,
    negotiatedDiscount: 1,
    status: 409,
    errorCode: 'BANK_CARD_OFFER_UNAVAILABLE',
  },
  { quantity: 1, expectedTotal: 100, status: 409 },
  {
    quantity: 1,
    expectedTotal: 95.02,
    shipping: 0.005,
    gift: 0.01,
    status: 409,
    errorCode: 'BANK_CARD_OFFER_AMOUNT_INVALID',
  },
  {
    quantity: 1,
    expectedTotal: 95.03,
    shipping: 0.01,
    gift: 0.02,
    status: 201,
  },
])('handles bank-offer checkout with quantity $quantity and expected total $expectedTotal', async ({
  quantity,
  expectedTotal,
  status,
  shipping = 0,
  gift = 0,
  errorCode,
  negotiatedDiscount,
  csrf = true,
  bearer = false,
}) => {
  primeAdminOrderCurrencyRead();
  if (negotiatedDiscount) {
    vi.mocked(computeOrderNegotiationDiscount).mockResolvedValueOnce({
      totalDiscount: negotiatedDiscount,
      rejectionCode: null,
    });
  }
  effects.purge.mockClear();
  effects.record.mockClear();
  vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'synthetic-order-test-proof');
  try {
    const productId = '11111111-1111-4111-8111-111111111111';
    const supabase = buildPilotMockSupabase({
      productRows: [
        { id: productId, name: 'Widget', price: 100, slug: 'widget' },
      ],
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: {
        ...mockAuthUser(productId),
        email: baseOrderPayload.customer_email,
      },
      error: null,
      supabase: supabase as never,
    });
    const order = {
      id: 'bank-offer-order',
      total: expectedTotal,
      created_at: '2026-11-19T18:42:00.000Z',
    };
    supabase.rpc.mockImplementation(async (...args: unknown[]) => ({
      data: (args[0] === 'create_storefront_bank_card_offer_order' ||
      (status === 200 && args[0] === 'get_bank_card_offer_checkout_replay')
        ? order
        : null) as never,
      error: null,
    }));
    const submit = (merchantId: string) =>
      POST(
        new NextRequest('http://localhost/api/orders', {
          method: 'POST',
          headers: {
            'Idempotency-Key': 'bank-offer-expected-total',
            ...(csrf
              ? {
                  cookie: 'csrf-token=checkout-proof',
                  'x-csrf-token': 'checkout-proof',
                }
              : {}),
            ...(bearer ? { authorization: 'Bearer test-mobile-token' } : {}),
          },
          body: JSON.stringify({
            ...baseOrderPayload,
            merchant_id: merchantId,
            items: [
              {
                product_id: productId,
                quantity,
                price: 100 - (negotiatedDiscount ?? 0),
                name: 'Widget',
              },
            ],
            subtotal: 100 * quantity,
            shipping_fee: shipping,
            gift_wrapping_fee: gift,
            expected_total: expectedTotal,
            payment_method: 'bank_card_offer',
            bank_card_offer_id: 'black-friday',
          }),
        })
      );
    const res = await submit(MERCHANT_ID.toUpperCase());
    const response = await res.json();
    expect(res.status, JSON.stringify(response)).toBe(status);
    if (status === 403) {
      expect(response.error).toBe('Invalid CSRF token');
      expect(supabase.rpc).not.toHaveBeenCalled();
      return;
    }
    if (status === 409) {
      expect(response.code).toBe(
        errorCode ??
          (expectedTotal === undefined || expectedTotal === 100
            ? 'BANK_CARD_OFFER_TOTAL_MISMATCH'
            : 'BANK_CARD_OFFER_UNAVAILABLE')
      );
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'create_storefront_bank_card_offer_order',
        expect.anything()
      );
      return;
    }
    expect(effects.purge).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        merchantSlug: 'test-merchant',
      })
    );
    expect(effects.record).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        value: expectedTotal,
        eventTimestamp: order.created_at,
      })
    );
    if (status === 200) {
      expect(response.idempotency).toEqual({ replayed: true });

      const lowercaseReplay = await submit(MERCHANT_ID.toLowerCase());

      expect(lowercaseReplay.status).toBe(200);
      await expect(lowercaseReplay.json()).resolves.toEqual(response);
      const replayArgs = supabase.rpc.mock.calls
        .filter(([name]) => name === 'get_bank_card_offer_checkout_replay')
        .map(([, args]) => args);
      expect(replayArgs).toHaveLength(2);
      expect(replayArgs[0]).toMatchObject({
        p_merchant_id: MERCHANT_ID.toLowerCase(),
        p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(replayArgs[1]).toEqual(replayArgs[0]);
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'create_storefront_bank_card_offer_order',
        expect.anything()
      );
      return;
    }
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_bank_card_offer_order',
      expect.objectContaining({
        p_order: expect.objectContaining({
          expected_total: expectedTotal,
          shipping_fee: shipping,
          gift_wrapping_fee: gift,
        }),
        p_quote: expect.objectContaining({ discountKobo: 500 }),
      })
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
