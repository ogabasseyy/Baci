import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createCommerceEngineFixture } from './cart-engine-fixture.ts';
import { prepareCommerceCatalog } from './catalog-fixture.ts';
import { startCommerceDataApi } from './data-api.ts';

test('loopback Data API verifies signed normal anon role, strips private reads and refuses remote auth', async () => {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  try {
    const { merchant } = await prepareCommerceCatalog(f);
    api = await startCommerceDataApi(f);
    const client = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
      },
    });
    const r = await client.rpc('get_storefront_shipping_rates', {
      p_merchant_id: merchant,
    });
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.equal(r.data.rates[0].base_amount, 1500);
    const variants = await client.rpc('get_storefront_product_variants', {
      p_product_ids: ['33333333-3333-4333-8333-333333333333'],
    });
    assert.equal(variants.error, null, JSON.stringify(variants.error));
    const denied = await client.from('merchants').select('user_id');
    assert.ok(denied.error);
    const bad = await fetch(`${api.url}/rest/v1/merchants?select=id`, {
      headers: { Authorization: 'Bearer forged' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(bad.status, 401);
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count,
      '0'
    );
  } finally {
    await api?.close();
    await f.close();
  }
});
