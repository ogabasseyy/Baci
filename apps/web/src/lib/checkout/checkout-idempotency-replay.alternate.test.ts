import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { prepareCheckoutIdempotencyReplay } from './checkout-idempotency-replay';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from './order-idempotency';
import { buildLegacyOrderIdempotencyPayload } from './order-idempotency-legacy';

const retry = {
  merchant_id: '11111111-1111-1111-1111-111111111111',
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  items: [{ price: 1000, quantity: 1 }],
  delivery_method: 'door' as const,
  shipping_provider: 'TOPSHIP',
};

function client(storedHash: string, probeError: string | null = null) {
  return {
    rpc: vi.fn(async (name: string, params?: Record<string, string>) => {
      if (name === 'is_storefront_order_idempotency_hash') {
        return {
          data: params?.p_checkout_request_hash === storedHash,
          error: probeError,
        };
      }
      return {
        data: name === 'is_legacy_storefront_order_idempotency_key',
        error: null,
      };
    }),
  } as unknown as SupabaseClient;
}

async function replay(supabase: SupabaseClient) {
  return prepareCheckoutIdempotencyReplay({
    payload: retry,
    alternatePayloads: [{ ...retry, shipping_provider: undefined }],
    canonicalDeliveryMethod: retry.delivery_method,
    canonicalAirportType: undefined,
    merchantId: retry.merchant_id,
    requestIdempotencyKey: 'checkout-1',
    supabase,
  });
}

describe('quote cleanup alternate replay hash precedence', () => {
  it.each([
    true,
    false,
  ])('preserves a confirmed alternate when later legacy detection succeeds (legacy hash: %s)', async (legacy) => {
    // The original omitted provider; a retry after quote cleanup adds delivery
    // metadata and resolves provider. The stored match must remain authoritative.
    const original = { ...retry, shipping_provider: undefined };
    const storedHash = hashOrderIdempotencyPayload(
      legacy
        ? buildLegacyOrderIdempotencyPayload(original)
        : buildOrderIdempotencyPayload(original)
    );
    await expect(replay(client(storedHash))).resolves.toEqual({
      adoptedAlternateShippingProvider: null,
      checkoutRequestHash: storedHash,
      isLegacyIdempotencyReplay: true,
    });
  });

  it('returns the matched per-provider alternate carrier for the RPC', async () => {
    // Quote cleanup left the provider unresolved, so the route probes one
    // alternate per carrier. The stored match identifies the original
    // carrier; the RPC must receive it, not the unresolved null.
    const current = { ...retry, shipping_provider: null };
    const topshipAlternate = { ...retry, shipping_provider: 'TOPSHIP' };
    const storedHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload(topshipAlternate)
    );
    const result = await prepareCheckoutIdempotencyReplay({
      payload: current,
      alternatePayloads: [
        { ...retry, shipping_provider: 'GIGL' },
        topshipAlternate,
      ],
      canonicalDeliveryMethod: retry.delivery_method,
      canonicalAirportType: undefined,
      merchantId: retry.merchant_id,
      requestIdempotencyKey: 'checkout-1',
      supabase: client(storedHash),
    });
    expect(result).toEqual({
      adoptedAlternateShippingProvider: 'TOPSHIP',
      checkoutRequestHash: storedHash,
      isLegacyIdempotencyReplay: true,
    });
  });

  it('fails closed when alternate lookup fails instead of choosing a legacy hash', async () => {
    await expect(
      replay(client('not-stored', 'probe unavailable'))
    ).rejects.toThrow('Alternate checkout request hash probe failed');
  });
});
