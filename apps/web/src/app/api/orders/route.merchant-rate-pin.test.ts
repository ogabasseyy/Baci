import './shipping-route.test-support';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from '@/lib/checkout/order-idempotency';
import {
  LAGOS_RATE_ID,
  primeAdminShippingRateClient,
  primeStorefrontClient,
  shippingRatesRpcPayload,
} from './merchant-rate-route.test-fixtures';
import { POST } from './route';
import {
  baseOrderPayload,
  resetShippingRouteMocks,
} from './shipping-route.test-fixtures';

describe('POST /api/orders — merchant rate destination pin', () => {
  beforeEach(resetShippingRouteMocks);
  it('bugfix: binds the destination pin for merchant-rate orders with a stray selected_quote_id', async () => {
    // Arrange — a buggy client sends a stray selected_quote_id alongside
    // shipping_rate_id. The route treats this as a merchant-rate (effectively
    // quote-less) order and nulls the effective quote, so the idempotency hash
    // must bind the destination pin. Otherwise a retry with the same key but a
    // different pin recomputes the same hash and the RPC replays the first
    // destination instead of reporting a conflict.
    const STRAY_QUOTE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const pinnedAddress = {
      address: '15 Marina Road',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 6.5244,
      longitude: 3.3792,
    };
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'stray-quote-pin-key' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_address: pinnedAddress,
          shipping_rate_id: LAGOS_RATE_ID,
          shipping_fee: 1500,
          selected_quote_id: STRAY_QUOTE_ID,
        }),
      })
    );

    // Assert
    expect(response.status).toBe(201);
    const createCall = (
      supabase.rpc as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.find(([name]) => name === 'create_storefront_order');
    const rpcParams = createCall?.[1] as
      | { p_checkout_request_hash?: string }
      | undefined;
    const quotedPinHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...baseOrderPayload,
        shipping_address: pinnedAddress,
        shipping_fee: 1500,
        shipping_provider: null,
        selected_quote_id: STRAY_QUOTE_ID,
        shipping_rate_id: LAGOS_RATE_ID,
        discount_amount: 0,
        discount_code: null,
        gift_wrapping_fee: 0,
      })
    );
    const quoteLessPinHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...baseOrderPayload,
        shipping_address: pinnedAddress,
        shipping_fee: 1500,
        shipping_provider: null,
        selected_quote_id: null,
        shipping_rate_id: LAGOS_RATE_ID,
        discount_amount: 0,
        discount_code: null,
        gift_wrapping_fee: 0,
      })
    );
    expect(quoteLessPinHash).not.toBe(quotedPinHash);
    expect(rpcParams?.p_checkout_request_hash).toBe(quoteLessPinHash);
  });
});
