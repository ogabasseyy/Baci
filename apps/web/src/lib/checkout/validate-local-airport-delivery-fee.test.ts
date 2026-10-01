import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { LocalAirportDeliveryFeeMismatchError } from '@/lib/checkout/local-airport-delivery-fee-mismatch-error';
import { validateLocalAirportDeliveryFee } from '@/lib/checkout/validate-local-airport-delivery-fee';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const GOFASTER_QUOTE_ID = '11111111-1111-4111-8111-111111111111';

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

describe('validateLocalAirportDeliveryFee', () => {
  it('accepts a server-verified GIGL GoFaster airport quote at its stored price', async () => {
    const result = await validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([validGoFasterQuote]),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: false,
      localAirportShippingFee: null,
    });
  });

  it('allows a confirmed idempotent replay after the provider quote expires', async () => {
    const result = await validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'airport-provider-retry-key',
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase(
        [
          {
            ...validGoFasterQuote,
            expires_at: '2020-01-01T00:00:00.000Z',
          },
        ],
        true
      ),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: null,
    });
  });

  it('rejects a selected road quote instead of bypassing the fixed airport fee', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 12_000,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([
        { ...validGoFasterQuote, provider_rate_id: 'GIGL_30_0_1_0_0_4' },
      ]),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });

  it('rejects an eligible airport quote relabeled as non-airport delivery', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'door',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([validGoFasterQuote]),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'DELIVERY_METADATA_MISMATCH',
      status: 400,
    });
  });

  it('derives airport delivery for legacy provider-quote requests without a method', async () => {
    const result = await validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([validGoFasterQuote]),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: false,
      localAirportShippingFee: null,
      resolvedDeliveryMethod: 'airport',
      resolvedAirportType: 'delivery',
    });
  });

  it('rejects an international GIGL rate id as an airport quote', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([
        { ...validGoFasterQuote, provider_rate_id: 'GIGL_INTL_2_0_0_1' },
      ]),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });

  it('rejects a GIGL quote when the submitted provider is missing', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 18_500,
      supabase: mockSupabase([validGoFasterQuote]),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });

  it('rejects a merchant-configured rate on the airport path', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      shippingFee: 35_000,
      shippingRateId: '22222222-2222-4222-8222-222222222222',
      supabase: mockSupabase(null),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });

  it('rejects local airport delivery without a complete destination address', async () => {
    const promise = validateLocalAirportDeliveryFee({
      airportType: 'delivery',
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      shippingFee: 35_000,
      supabase: mockSupabase(null),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_ADDRESS_REQUIRED',
      status: 400,
    });
  });

  it('rejects a provider quote whose submitted fee differs from the stored price', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      selectedQuoteId: GOFASTER_QUOTE_ID,
      shippingAddress: validAirportAddress,
      shippingFee: 17_500,
      shippingProvider: 'GIGL',
      supabase: mockSupabase([validGoFasterQuote]),
    });

    await expect(promise).rejects.toBeInstanceOf(
      LocalAirportDeliveryFeeMismatchError
    );
  });

  it('allows a confirmed idempotent replay to keep the original local airport fee', async () => {
    const result = await validateLocalAirportDeliveryFee({
      airportType: 'delivery',
      deliveryMethod: 'airport',
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'airport-retry-key',
      shippingAddress: {
        address: '12 Airport Road',
        city: 'Ikeja',
        state: 'Lagos',
      },
      shippingFee: 25_000,
      supabase: mockSupabase(null, true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: 35_000,
    });
  });
});
