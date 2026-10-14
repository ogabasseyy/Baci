import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from '@/schemas/orders';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import {
  enrichShippingAddressWithQuoteDestination,
  type OrderShippingAddressForQuote,
} from './order-quote-destination';
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
])('checkout destination coordinate provenance for %s', (provider) => {
  const context = {
    isNewOrder: true,
    merchantId,
    shippingProvider: provider,
    shippingFee: 2500,
    items: orderInput.items,
  };

  function enrich(
    shippingAddress: OrderShippingAddressForQuote,
    receiver: Record<string, unknown> = request.receiver
  ) {
    return enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider,
        price: 2500,
        quote_request: { ...request, receiver },
      }) as unknown as SupabaseClient,
      'quote-1',
      shippingAddress,
      context
    );
  }

  it('preserves valid coordinates through order input validation', () => {
    const result = orderCreateSchema.parse({
      ...orderInput,
      shipping_address: { ...address, ...coordinates },
    });
    expect(result.shipping_address).toEqual({ ...address, ...coordinates });
  });

  it.each([
    { latitude: 6.6 },
    { longitude: 3.3 },
    { latitude: 91, longitude: 3.3 },
    { latitude: 6.6, longitude: -181 },
    { latitude: Number.NaN, longitude: 3.3 },
    { latitude: 6.6, longitude: Number.POSITIVE_INFINITY },
    { latitude: '6.6', longitude: '3.3' },
    { latitude: null, longitude: null },
  ])('rejects invalid order coordinates %j', (pair) => {
    expect(
      orderCreateSchema.safeParse({
        ...orderInput,
        shipping_address: { ...address, ...pair },
      }).success
    ).toBe(false);
  });

  it('copies the validated checkout quote pin into an order without a pin', async () => {
    const parsed = orderCreateSchema.parse({
      ...orderInput,
      shipping_address: address,
    });
    const destination = await enrich(parsed.shipping_address ?? address);
    expect(destination).toMatchObject(coordinates);
    // Exercise the real booking guard, which continues to require both pins.
    expect(() =>
      assertQuoteReceiverMatchesOrder(request, {
        shipping_address: destination ?? null,
      })
    ).not.toThrow();
  });

  it('adopts a domestic composed quote pin and passes the real booking guard', async () => {
    const composedAddress = {
      ...address,
      address: '12 Test Street, Ikeja, Lagos',
    };
    const composedReceiver = {
      ...request.receiver,
      address: composedAddress.address,
    };
    const destination = await enrich(composedAddress, composedReceiver);
    expect(destination).toMatchObject(coordinates);
    expect(() =>
      assertQuoteReceiverMatchesOrder(
        { ...request, receiver: composedReceiver },
        { shipping_address: destination ?? null }
      )
    ).not.toThrow();
  });

  it('does not backfill an existing order from address text alone', async () => {
    const supabase = createSupabaseRpcMock({
      provider,
      price: 2500,
      quote_request: request,
    });
    await expect(
      enrichShippingAddressWithQuoteDestination(
        supabase as unknown as SupabaseClient,
        'quote-1',
        address,
        { ...context, isNewOrder: false }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts matching pins including zero coordinates', async () => {
    const zero = { latitude: 0, longitude: 0 };
    await expect(
      enrich({ ...address, ...zero }, { ...request.receiver, ...zero })
    ).resolves.toMatchObject(zero);
  });

  it('preserves an existing matching pin rather than replacing it', async () => {
    const existingPin = {
      ...coordinates,
      latitude: coordinates.latitude + 1e-7,
    };
    const supabase = createSupabaseRpcMock({
      provider,
      price: 2500,
      quote_request: request,
    });
    await expect(
      enrichShippingAddressWithQuoteDestination(
        supabase as unknown as SupabaseClient,
        'quote-1',
        { ...address, ...existingPin },
        { ...context, isNewOrder: false }
      )
    ).resolves.toMatchObject(existingPin);
  });

  it('rejects a conflicting pin without overwriting it', async () => {
    const destination = { ...address, ...coordinates, latitude: 6.7 };
    await expect(enrich(destination)).rejects.toMatchObject({ status: 400 });
    expect(destination.latitude).toBe(6.7);
  });

  it('rejects a partial stored order pin', async () => {
    await expect(enrich({ ...address, latitude: 6.6 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each([
    { latitude: 6.6, longitude: undefined },
    { latitude: 91, longitude: 3.3 },
    { latitude: '6.6', longitude: '3.3' },
  ])('rejects malformed saved quote coordinates %j', async (pair) => {
    await expect(
      enrich(address, { ...request.receiver, ...pair })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a pinned order with a quote lacking its pin', async () => {
    await expect(
      enrich(
        { ...address, ...coordinates },
        {
          ...request.receiver,
          latitude: undefined,
          longitude: undefined,
        }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { shippingFee: 2501 },
    { shippingProvider: 'OTHER' },
    { items: [{ ...orderInput.items[0], quantity: 2 }] },
    { items: [{ ...orderInput.items[0], price: 1001 }] },
  ])('rejects changed checkout context before adopting the pin: %j', async (change) => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider,
          price: 2500,
          quote_request: request,
        }) as unknown as SupabaseClient,
        'quote-1',
        address,
        { ...context, ...change }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an expired quote before adopting the pin', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider,
          price: 2500,
          quote_request: request,
          expires_at: new Date(0).toISOString(),
        }) as unknown as SupabaseClient,
        'quote-1',
        address,
        context
      )
    ).rejects.toMatchObject({ code: 'INTERNATIONAL_QUOTE_EXPIRED' });
  });

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

  it('rejects a quote request from another merchant before adopting the pin', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider,
          price: 2500,
          quote_request: { ...request, merchantId: 'another-merchant' },
        }) as unknown as SupabaseClient,
        'quote-1',
        address,
        context
      )
    ).rejects.toMatchObject({ code: 'INTERNATIONAL_QUOTE_MERCHANT_MISMATCH' });
  });

  it('still rejects changed address text even when coordinates match', async () => {
    await expect(
      enrich({ ...address, ...coordinates, address: '99 Other Street' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
