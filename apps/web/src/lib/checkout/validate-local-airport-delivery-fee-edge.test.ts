import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { validateLocalAirportDeliveryFee } from '@/lib/checkout/validate-local-airport-delivery-fee';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const GOFASTER_QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_RATE_ID = '22222222-2222-4222-8222-222222222222';

function mockSupabase(quote: unknown, replay = false): SupabaseClient {
  const rpc = vi.fn((name: string) => {
    if (name === 'get_checkout_shipping_quote') {
      return Promise.resolve({ data: quote, error: null });
    }
    return Promise.resolve({ data: replay, error: null });
  });

  return { rpc } as unknown as SupabaseClient;
}

const validGoFasterQuote = {
  expires_at: '2099-01-01T00:00:00.000Z',
  price: 18_500,
  provider: 'GIGL',
  provider_rate_id: 'GIGL_30_0_1_0_1_4',
};

const validAirportAddress = {
  address: '12 Airport Road',
  city: 'Ikeja',
  state: 'Lagos',
};

describe('validateLocalAirportDeliveryFee edge cases', () => {
  it('allows a confirmed replay with a synthetic airport marker before address validation', async () => {
    const result = await validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'airport-synthetic-retry',
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: {
        address: 'Airport Delivery',
        city: 'Airport',
        state: 'Nigeria',
      },
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase(null, true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: null,
    });
  });

  it('allows a confirmed replay when the provider quote has been deleted', async () => {
    const result = await validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'airport-deleted-quote-retry',
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase(null, true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: null,
    });
  });

  it('recovers a metadata-free provider replay after its quote has been deleted', async () => {
    const result = await validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'metadata-free-airport-retry',
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase(null, true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: false,
      isIdempotentOrderReplay: true,
      localAirportShippingFee: null,
    });
  });

  it('rejects a merchant rate combined with a derived airport quote', async () => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      shippingRateId: MERCHANT_RATE_ID,
      supabase: mockSupabase([validGoFasterQuote]),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });
});
