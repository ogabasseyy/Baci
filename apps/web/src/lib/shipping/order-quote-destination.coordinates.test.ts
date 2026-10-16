import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from '@/lib/checkout/order-idempotency';
import { orderCreateSchema } from '@/schemas/orders';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import { enrichShippingAddressWithQuoteDestination } from './order-quote-destination';
import { createSupabaseRpcMock } from './test-helpers/create-supabase-rpc-mock';
import type { QuoteRequest } from './types';

const destination = {
  address: '12 Synthetic Street',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
  postalCode: undefined,
};
const receiver = {
  ...destination,
  name: 'Synthetic Buyer',
  phone: '08000000000',
  latitude: 6.6,
  longitude: 3.35,
};
const request: QuoteRequest = {
  merchantId: 'merchant-current',
  sessionId: 'synthetic-session',
  shipmentType: 'domestic',
  receiver,
  items: [{ name: 'Synthetic phone', quantity: 1, weight: 1, value: 100_000 }],
};

async function enrich(quoteRequest: unknown = request) {
  return enrichShippingAddressWithQuoteDestination(
    createSupabaseRpcMock({
      provider: 'GIGL',
      provider_rate_id: 'GIGL_4_0',
      quote_request: quoteRequest,
    }) as unknown as SupabaseClient,
    'quote-1',
    destination,
    { merchantId: 'merchant-current', shippingProvider: 'GIGL' },
    { persistAttestedCoordinates: true }
  );
}

describe('GIGL checkout attested destination coordinates', () => {
  it('persists the bound quote pin so an unchanged checkout destination passes the booking guard', async () => {
    // This is the production failure: all text matches but the order lost
    // coordinates present on its selected quote. Keep that guard fail-closed.
    expect(() =>
      assertQuoteReceiverMatchesOrder(request, {
        shipping_address: destination,
      })
    ).toThrow(
      expect.objectContaining({ code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH' })
    );

    const persisted = await enrich();

    expect(persisted).toMatchObject({ latitude: 6.6, longitude: 3.35 });
    expect(() =>
      assertQuoteReceiverMatchesOrder(request, {
        shipping_address: persisted ?? null,
      })
    ).not.toThrow();
  });

  it.each([
    { latitude: 6.6, longitude: undefined },
    { latitude: undefined, longitude: 3.35 },
    { latitude: Number.NaN, longitude: 3.35 },
    { latitude: 6.6, longitude: Number.POSITIVE_INFINITY },
    { latitude: 91, longitude: 3.35 },
    { latitude: 6.6, longitude: -181 },
    { latitude: '6.6', longitude: 3.35 },
  ])('rejects an incomplete or invalid attested pin: %j', async (coordinates) => {
    await expect(
      enrich({ ...request, receiver: { ...receiver, ...coordinates } })
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
    });
  });

  it('keeps legacy unpinned quotes unpinned', async () => {
    const persisted = await enrich({
      ...request,
      receiver: { ...receiver, latitude: undefined, longitude: undefined },
    });

    expect(persisted).not.toHaveProperty('latitude');
    expect(persisted).not.toHaveProperty('longitude');
  });

  it('does not attach pins to callers that did not opt into new-order creation', async () => {
    const persisted = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider: 'GIGL',
        provider_rate_id: 'GIGL_4_0',
        quote_request: request,
      }) as unknown as SupabaseClient,
      'quote-1',
      destination,
      { merchantId: 'merchant-current', shippingProvider: 'GIGL' }
    );

    expect(persisted).not.toHaveProperty('latitude');
    expect(persisted).not.toHaveProperty('longitude');
  });

  it('takes coordinates from the validated quote after untrusted checkout body pins are stripped', async () => {
    const parsedAddress = orderCreateSchema.parse({
      merchant_id: '11111111-1111-4111-8111-111111111111',
      customer_email: 'synthetic@example.test',
      customer_name: 'Synthetic Buyer',
      items: [
        {
          product_id: '22222222-2222-4222-8222-222222222222',
          name: 'Synthetic phone',
          quantity: 1,
          price: 100_000,
        },
      ],
      subtotal: 100_000,
      payment_method: 'card',
      shipping_address: { ...destination, latitude: 0, longitude: 0 },
    }).shipping_address;
    expect(parsedAddress).not.toHaveProperty('latitude');
    expect(parsedAddress).not.toHaveProperty('longitude');

    const persisted = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider: 'GIGL',
        provider_rate_id: 'GIGL_4_0',
        quote_request: request,
      }) as unknown as SupabaseClient,
      'quote-1',
      parsedAddress,
      { merchantId: 'merchant-current', shippingProvider: 'GIGL' },
      { persistAttestedCoordinates: true }
    );

    expect(persisted).toMatchObject({ latitude: 6.6, longitude: 3.35 });
  });

  it('preserves the pre-release checkout idempotency hash when attested pins are persisted', async () => {
    const persisted = await enrich();
    const payload = {
      merchant_id: 'merchant-current',
      selected_quote_id: 'quote-1',
      customer_email: 'synthetic@example.test',
      customer_name: 'Synthetic Buyer',
      items: [{ product_id: 'product-1', quantity: 1, price: 100_000 }],
    };
    const hash = (
      shipping_address: Parameters<
        typeof buildOrderIdempotencyPayload
      >[0]['shipping_address']
    ) =>
      hashOrderIdempotencyPayload(
        buildOrderIdempotencyPayload({ ...payload, shipping_address })
      );

    expect(hash(persisted)).toBe(hash(destination));
  });
});
