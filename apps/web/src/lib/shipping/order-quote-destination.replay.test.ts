import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from '@/schemas/orders';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import { enrichShippingAddressWithQuoteDestination } from './order-quote-destination';
import { createSupabaseRpcMock } from './test-helpers/create-supabase-rpc-mock';

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const address = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  country: undefined,
  countryCode: undefined,
  postalCode: undefined,
};
const coordinates = { latitude: 6.6018, longitude: 3.3515 };
const orderInput = {
  merchant_id: merchantId,
  customer_email: 'test@example.com',
  customer_name: 'Test Customer',
  payment_method: 'card',
  items: [{ productId: 'product-1', name: 'Phone', quantity: 1, price: 1000 }],
  subtotal: 1000,
};
const request = {
  merchantId,
  sessionId: 'session-1',
  shipmentType: 'domestic' as const,
  receiver: {
    ...address,
    ...coordinates,
    name: 'Test Customer',
    phone: '',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 1000 }],
};

describe.each([
  'GIGL',
  'TOPSHIP',
])('checkout destination confirmed replays for %s', (provider) => {
  const context = {
    isNewOrder: true,
    merchantId,
    shippingProvider: provider,
    shippingFee: 2500,
    items: orderInput.items,
  };

  it('skips only the expiry check for a confirmed replay and still adopts the pin', async () => {
    // Arrange — a same-key retry arrives after its quote expired, but the
    // merchant-scoped key already has an order.
    const parsed = orderCreateSchema.parse({
      ...orderInput,
      shipping_address: address,
    });

    // Act
    const destination = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider,
        price: 2500,
        quote_request: request,
        expires_at: new Date(0).toISOString(),
      }) as unknown as SupabaseClient,
      'quote-1',
      parsed.shipping_address ?? address,
      { ...context, isConfirmedReplay: true }
    );

    // Assert — expiry is skipped yet every deterministic check still runs,
    // so the retry reproduces the first attempt's adopted pin exactly.
    expect(destination).toMatchObject(coordinates);
    expect(() =>
      assertQuoteReceiverMatchesOrder(request, {
        shipping_address: destination ?? null,
      })
    ).not.toThrow();
  });

  it('passes the address through untouched for a confirmed replay after quote cleanup', async () => {
    // Arrange — the quote row was cleaned up after the order was created,
    // but the merchant-scoped key already has an order.
    const parsed = orderCreateSchema.parse({
      ...orderInput,
      shipping_address: address,
    });

    // Act
    const destination = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock(null) as unknown as SupabaseClient,
      'quote-1',
      parsed.shipping_address ?? address,
      { ...context, isConfirmedReplay: true }
    );

    // Assert — no provenance left to re-validate; the order RPC's hash
    // comparison stays authoritative for replay-vs-conflict.
    expect(destination).toEqual(parsed.shipping_address ?? address);
  });

  it('skips mutable item checks for a confirmed replay after catalog drift', async () => {
    // Arrange — the merchant changed product shipping metadata after the
    // order was created; the retry rebuilds validation items from the
    // current catalog rows.
    const parsed = orderCreateSchema.parse({
      ...orderInput,
      shipping_address: address,
    });

    // Act
    const destination = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider,
        price: 2500,
        quote_request: request,
      }) as unknown as SupabaseClient,
      'quote-1',
      parsed.shipping_address ?? address,
      {
        ...context,
        isConfirmedReplay: true,
        items: [{ ...orderInput.items[0], weight: 2 }],
      }
    );

    // Assert — physical metadata is not hash-significant, so the retry
    // still reproduces the first attempt's adopted pin for the RPC replay.
    expect(destination).toMatchObject(coordinates);
  });
});
