import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-disabled';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-disabled-no-admin-key';
  return { client: null as SupabaseClient | null, getQuotes: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => fakes.client,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw Error('ADMIN_FORBIDDEN');
  },
}));
vi.mock('@/lib/shipping', () => ({
  shippingService: { getQuotes: fakes.getQuotes },
}));
vi.mock('@/env', async (original) => ({
  ...(await original<object>()),
  getSupabaseServiceRoleKey: () => 'local-disabled-no-admin-key',
}));

import { GET, POST } from '../../src/app/api/shipping/quotes/route';
import { createCommerceEngineFixture } from './cart-engine-fixture';
import { prepareCommerceCatalog } from './catalog-fixture';
import { startCommerceDataApi } from './data-api';

it('actual quote routes persist and read mocked carrier output through normal anonymous Data API with no order, payment, or booking', async () => {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  try {
    const { merchant } = await prepareCommerceCatalog(f);
    // Owned synthetic provider configuration; provider I/O itself is mocked below.
    await f.pool.query(
      'UPDATE merchant_feature_settings SET shipping_providers=\'["gigl"]\'::jsonb WHERE merchant_id=$1',
      [merchant]
    );
    api = await startCommerceDataApi(f);
    fakes.client = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = randomUUID();
    const id = randomUUID();
    const quote = {
      id,
      provider: 'GIGL',
      serviceTier: 'Standard',
      carrierName: 'Synthetic carrier',
      displayName: 'Synthetic carrier',
      price: 1800,
      providerCost: 1500,
      platformMargin: 300,
      currency: 'NGN',
      estimatedDays: 3,
      pickupIncluded: true,
      insuranceIncluded: false,
      expiresAt: new Date(Date.now() + 600000),
    };
    fakes.getQuotes.mockResolvedValue({
      quotes: { featured: [quote], all: [quote] },
      sessionId: session,
      expiresAt: quote.expiresAt.toISOString(),
    });
    const headers = {
      'Content-Type': 'application/json',
      Host: 'qa1.localhost',
      'x-merchant-slug': 'qa1',
    };
    const r = await POST(
      new NextRequest('http://qa1.localhost/api/shipping/quotes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          merchantId: merchant,
          sessionId: session,
          shipmentType: 'domestic',
          supports_merchant_rates: true,
          receiver: {
            name: 'Synthetic QA',
            address: '2 Synthetic Road, Ikeja, Lagos',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [
            {
              name: 'Synthetic device',
              hsCode: '851712',
              weight: 1,
              quantity: 1,
              value: 250,
            },
          ],
        }),
      })
    );
    expect(r.status).toBe(200);
    const value = await r.json();
    const serverSession = String(value.sessionId);
    expect(serverSession).not.toBe(session);
    expect(serverSession).toMatch(/^[a-f0-9-]{36}$/);
    expect(value.quotes.all).toContainEqual(
      expect.objectContaining({ id, price: 1800 })
    );
    expect(JSON.stringify(value)).not.toContain('providerCost');
    expect(fakes.getQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: merchant }),
      ['GIGL']
    );
    const readToken = r.headers.get('x-baci-quote-read-token');
    expect(readToken).toBeTruthy();
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');
    const deniedCache = await GET(
      new NextRequest(
        `http://qa1.localhost/api/shipping/quotes?sessionId=${serverSession}`,
        { headers }
      )
    );
    expect(deniedCache.status).toBe(403);
    const cached = await GET(
      new NextRequest(
        `http://qa1.localhost/api/shipping/quotes?sessionId=${serverSession}`,
        { headers: { ...headers, 'x-baci-quote-read-token': readToken ?? '' } }
      )
    );
    expect(cached.status).toBe(200);
    const safe = await cached.json();
    expect(safe.quotes.all[0]).toMatchObject({ id, price: 1800 });
    expect(JSON.stringify(safe)).not.toContain('provider_cost');
    expect(JSON.stringify(safe)).not.toContain('quote_request');
    const wrongSession = await GET(
      new NextRequest(
        'http://qa1.localhost/api/shipping/quotes?sessionId=other',
        { headers: { ...headers, 'x-baci-quote-read-token': readToken ?? '' } }
      )
    );
    expect(wrongSession.status).toBe(403);
    await f.pool.query('DELETE FROM vault.decrypted_secrets');
    const unavailable = await POST(
      new NextRequest('http://qa1.localhost/api/shipping/quotes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          merchantId: merchant,
          sessionId: session,
          shipmentType: 'domestic',
          receiver: {
            name: 'Synthetic QA',
            address: '2 Synthetic Road, Ikeja, Lagos',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [
            {
              name: 'Synthetic device',
              hsCode: '851712',
              weight: 1,
              quantity: 1,
              value: 250,
            },
          ],
        }),
      })
    );
    expect(unavailable.status).toBe(503);
    expect(fakes.getQuotes).toHaveBeenCalledTimes(1);
    const deny = await fakes.client.from('shipping_quotes').select('price');
    expect(deny.error).toBeTruthy();
    const forged = await fakes.client.rpc('persist_storefront_shipping_quote', {
      p_quote: { id, merchant_id: merchant, price: 1 },
      p_route_proof: { signature: 'forged' },
    });
    expect(forged.error).toBeTruthy();
    expect(
      (await f.pool.query('SELECT count(*) FROM shipping_quotes')).rows[0].count
    ).toBe('1');
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    fakes.client = null;
    await api?.close();
    await f.close();
  }
});
