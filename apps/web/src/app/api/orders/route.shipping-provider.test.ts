import './shipping-route.test-support';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import {
  baseOrderPayload,
  buildMockSupabase,
  MERCHANT_ID,
  resetShippingRouteMocks,
} from './shipping-route.test-fixtures';

async function readJson(response: Response) {
  return JSON.parse(await response.text());
}

describe('POST /api/orders — TOPSHIP provider and replay', () => {
  beforeEach(resetShippingRouteMocks);
  function topshipQuote(expires_at: string) {
    return {
      provider: 'TOPSHIP',
      provider_rate_id: 'TOPSHIP_DOM_1',
      price: 2500,
      expires_at,
      quote_request: {
        merchantId: MERCHANT_ID,
        sessionId: 'session-1',
        shipmentType: 'domestic',
        receiver: {
          name: 'Test Customer',
          phone: '08012345678',
          address: '12 Allen Avenue, Ikeja, Lagos',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
          latitude: 6.5244,
          longitude: 3.3792,
        },
        items: [{ name: 'Widget', quantity: 1, weight: 1, value: 1000 }],
      },
    };
  }

  function topshipOrderBody(options: { omitProvider?: boolean } = {}) {
    return {
      ...baseOrderPayload,
      subtotal: 1000,
      shipping_fee: 2500,
      selected_quote_id: '22222222-2222-4222-8222-222222222222',
      ...(options.omitProvider ? {} : { shipping_provider: 'TOPSHIP' }),
      shipping_address: {
        address: '12 Allen Avenue, Ikeja, Lagos',
        city: 'Ikeja',
        state: 'Lagos',
      },
    };
  }

  it('replays a confirmed same-key TOPSHIP retry after its quote expires', async () => {
    // Arrange — the shopper retries with the same Idempotency-Key after the
    // one-hour quote expired, but the key already has an order. The retry
    // must reach the order RPC (which replays on a matching hash) instead of
    // 400ing on the stale expiry.
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {
        has_storefront_order_idempotency_key: { data: true, error: null },
      },
      {
        productRows: [{ id: 'p-1', name: 'Widget', price: 1000 }],
        shippingQuote: topshipQuote('2020-01-01T00:00:00.000Z'),
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'topship-expired-replay-key' },
        body: JSON.stringify(topshipOrderBody()),
      })
    );

    // Assert
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('still rejects an expired TOPSHIP quote on a first attempt', async () => {
    // Arrange — same expired quote, but no Idempotency-Key, so there is no
    // confirmed replay to protect.
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [{ id: 'p-1', name: 'Widget', price: 1000 }],
        shippingQuote: topshipQuote('2020-01-01T00:00:00.000Z'),
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(topshipOrderBody()),
      })
    );

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_EXPIRED',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('accepts a TOPSHIP quote that omits the redundant shipping_provider', async () => {
    // Arrange — the merchant-scoped quote row is authoritative for the
    // provider, so a client that sends only the quote id plus fee must still
    // validate and adopt the pin instead of 400ing on provider mismatch.
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [{ id: 'p-1', name: 'Widget', price: 1000 }],
        shippingQuote: topshipQuote(
          new Date(Date.now() + 3_600_000).toISOString()
        ),
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(topshipOrderBody({ omitProvider: true })),
      })
    );

    // Assert
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_selected_quote_id: '22222222-2222-4222-8222-222222222222',
      })
    );
  });

  it('persists the quote-derived provider when shipping_provider is omitted', async () => {
    // Arrange — same omitted-provider checkout: validation accepts the
    // merchant-scoped quote as authoritative, so the stored hash and order
    // RPC must carry its carrier instead of null (fulfillment rejects a
    // quote without a carrier).
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [{ id: 'p-1', name: 'Widget', price: 1000 }],
        shippingQuote: topshipQuote(
          new Date(Date.now() + 3_600_000).toISOString()
        ),
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(topshipOrderBody({ omitProvider: true })),
      })
    );

    // Assert
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_selected_quote_id: '22222222-2222-4222-8222-222222222222',
        p_shipping_provider: 'TOPSHIP',
      })
    );
    // The validated quote's carrier is reused from enrichment: deriving it
    // must not cost another quote lookup. Two remain: enrichment itself and
    // the airport-delivery classification probe.
    expect(
      supabase.rpc.mock.calls.filter(
        ([name]) => name === 'get_checkout_shipping_quote'
      )
    ).toHaveLength(2);
  });
});
