import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY,
}));

import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

describe('shipping quote route proof', () => {
  beforeEach(() => vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's'.repeat(32)));

  it('domain-binds the exact complete payload text', () => {
    const left = createShippingQuoteRouteProof({
      action: 'persist_authenticated_admin_gigl_quote',
      merchantId: 'merchant-1',
      subjectId: 'order-1',
      now: '2026-09-03T10:00:00.000Z',
      payload: { quote: { z: 1, a: 2 }, attestation: { order_id: 'order-1' } },
    });
    const right = createShippingQuoteRouteProof({
      action: 'persist_authenticated_admin_gigl_quote',
      merchantId: 'merchant-1',
      subjectId: 'order-1',
      now: '2026-09-03T10:00:00.000Z',
      payload: { quote: { z: 1, a: 2 }, attestation: { order_id: 'order-1' } },
    });
    expect(left.payload_text).toBe(right.payload_text);
    expect(left.signature).toBe(right.signature);
    expect(left.version).toBe('baci-shipping-quote-proof:v1');
  });

  it('rejects payload substitution because payload text is signed directly', () => {
    const proof = createShippingQuoteRouteProof({
      action: 'persist_refreshed_order_shipping_quote',
      merchantId: 'merchant-1',
      subjectId: 'order-1',
      now: '2026-09-03T10:00:00.000Z',
      payload: { order_id: 'order-1', quote: { price: 1_000 } },
    });
    expect(proof.payload_text).not.toBe(
      JSON.stringify({ order_id: 'order-1', quote: { price: 2_000 } })
    );
  });

  it('fails closed when the server secret is unavailable', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(() =>
      createShippingQuoteRouteProof({
        action: 'refresh',
        merchantId: 'merchant-1',
        subjectId: 'order-1',
        payload: {},
      })
    ).toThrow('missing_shipping_quote_rpc_server_secret');
  });
});
