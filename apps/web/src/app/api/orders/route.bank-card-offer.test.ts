import { expect, it, vi } from 'vitest';
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

it('passes the shopper’s post-discount total to atomic bank-offer checkout', async () => {
  primeAdminOrderCurrencyRead();
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
    supabase.rpc.mockImplementation(async (...args: unknown[]) => ({
      data:
        args[0] === 'create_storefront_bank_card_offer_order'
          ? ({ total: 95, idempotency_replayed: false } as never)
          : null,
      error: null,
    }));
    const res = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'bank-offer-expected-total' },
        body: JSON.stringify({
          ...baseOrderPayload,
          merchant_id: MERCHANT_ID.toUpperCase(),
          items: [
            { product_id: productId, quantity: 1, price: 100, name: 'Widget' },
          ],
          subtotal: 100,
          expected_total: 95,
          payment_method: 'bank_card_offer',
          bank_card_offer_id: 'black-friday',
        }),
      })
    );
    expect(res.status, await res.text()).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_bank_card_offer_order',
      expect.objectContaining({
        p_order: expect.objectContaining({ expected_total: 95 }),
        p_quote: expect.objectContaining({ discountKobo: 500 }),
      })
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
